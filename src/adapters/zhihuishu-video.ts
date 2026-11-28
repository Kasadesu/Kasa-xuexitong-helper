import { store } from '../store';
import { sleep, getHumanJitterDelay } from '../core/lifecycle';
import { IframeContext, Question } from '../types';
import { queryAiAnswer } from './ai-solver/client';
import {
  ParsedOptionItem,
  cleanQuestionTitle,
  detectQuestionType,
  isElementOrAncestorHidden,
  matchFallbackAnswer,
  normalizeText,
  selectBestOptions
} from './quiz';

let zhihuishuSwitchCooldownUntil = 0;
let lastCompletedLessonKey: string | null = null;
let sessionCompletedCourseScope = '';
const sessionCompletedLessonLabels = new Set<string>();

export const getZhihuishuSwitchCooldownUntil = (): number => zhihuishuSwitchCooldownUntil;

export const getLastCompletedZhihuishuLessonKey = (): string | null => lastCompletedLessonKey;

export const clearZhihuishuCompletionSuppression = (): void => {
  lastCompletedLessonKey = null;
  zhihuishuSwitchCooldownUntil = 0;
  sessionCompletedLessonLabels.clear();
  sessionCompletedCourseScope = '';
};

const getZhihuishuHref = (doc?: Document): string =>
  (doc as any)?.location?.href ??
  (typeof window !== 'undefined' ? window.location?.href || '' : '');

const getCourseScopeKey = (doc?: Document): string => {
  const href = getZhihuishuHref(doc);
  if (!href) return '';
  try {
    const parsed = new URL(href);
    const params = new URLSearchParams(parsed.search);
    const kept: string[] = [];
    for (const [k, v] of params.entries()) {
      if (!/(?:lesson|video|chapter|node|knowledge|study|point)/i.test(k)) {
        kept.push(`${k}=${v}`);
      }
    }
    kept.sort();
    return `${parsed.origin}${parsed.pathname}${kept.length ? '?' + kept.join('&') : ''}`;
  } catch {
    return href.split('#')[0];
  }
};

const syncSessionCourseScope = (doc: Document): void => {
  const scope = getCourseScopeKey(doc);
  if (scope && sessionCompletedCourseScope && scope !== sessionCompletedCourseScope) {
    sessionCompletedLessonLabels.clear();
  }
  if (scope) {
    sessionCompletedCourseScope = scope;
  }
};

const recordSessionCompletedLesson = (doc: Document, label: string): void => {
  syncSessionCourseScope(doc);
  const clean = label.replace(/\s+/g, ' ').trim();
  if (clean && clean !== '智慧树视频课程') {
    sessionCompletedLessonLabels.add(clean);
  }
};

const CHAPTER_HEADER_RE =
  /^\s*(?:第\s*[零一二三四五六七八九十百千0-9]+\s*[章单元篇部分]|Chapter\s*\d+|Unit\s*\d+|模块\s*[零一二三四五六七八九十0-9]+)(?:\s*[:：.\-—\s]\s*\S|\s*$)/i;
const CHAPTER_PREFIX_ONLY_RE =
  /^\s*(?:第\s*[零一二三四五六七八九十百千0-9]+\s*[章单元篇部分]|Chapter\s*\d+|Unit\s*\d+)\s*[:：]?$/i;
const AI_LESSON_NUMBER_RE = /^\s*\d+(?:\.\d+)+(?![\d.])\s*\S+/;
const AI_LESSON_CN_RE = /^\s*第\s*[零一二三四五六七八九十百千0-9]+\s*[节讲课](?:\s*[:：.\-—\s]|$)/;
const NON_VIDEO_ITEM_RE =
  /^\s*(?:\d+(?:\.\d+)*\s*)?(?:章节|单元|随堂|课后|阶段|综合|期末|期中|课程)?(?:测试|测验|小测|自测|作业|考试|讨论|主题讨论|问卷|答疑|阅读|课件|文档|资料|拓展阅读|参考资料)(?:\s*[一二三四五六七八九十\d]+)?\s*$/i;
const NAV_OR_HOME_ITEM_RE =
  /^\s*(?:首页|主页|主界面|返回|返回首页|返回主页|返回课程|返回学习|课程首页|课程主页|我的课程|学习中心|课程详情|课程目录|目录|知识图谱|图谱|AI学伴|智能体|AI互动室|互动室|成绩|学习成绩|学习进度|公告|课程公告|通知|讨论区|问答|笔记|个人中心|退出|退出登录|登录|帮助|设置|反馈)\s*$/i;
const NAV_BACK_PREFIX_RE = /^(?:返回|回到)(?:首页|主页|主界面|课程|上一页|列表|学习中心)/;
const FINISH_TOKEN_RE =
  /(?:^|[\s_-])(?:finish(?:ed)?|complet(?:e|ed)|done|learned|studied|icofinish|wancheng|circle-check|check-circle|check-filled|success-filled|success)(?:$|[\s_-])/i;
const UNFINISH_TOKEN_RE = /(?:un|in|not[-_]?|no[-_]?)(?:finish|complet|done|learn|stud)/i;
const ACTIVE_TOKEN_RE =
  /(?:^|[\s_-])(?:current_?play|current|active|selected|playing|is-active|is-current|highlight)(?:$|[\s_-])/i;
const INACTIVE_TOKEN_RE = /(?:in|un|not[-_]?)(?:active|current|selected)/i;
const EXPANDED_TOKEN_RE =
  /(?:^|[\s_-])(?:is-active|is-open|is-expanded|expanded|unfold|open)(?:$|[\s_-])/i;
const COLLAPSED_TOKEN_RE = /(?:^|[\s_-])(?:collapsed|closed|is-closed|fold)(?:$|[\s_-])/i;
const NON_HIGHLIGHT_BG_RE =
  /^(?:|none|transparent|rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\)|rgb\(\s*255\s*,\s*255\s*,\s*255\s*\)|rgba\(\s*255\s*,\s*255\s*,\s*255\s*,\s*1(?:\.0+)?\s*\)|#fff(?:fff)?)$/i;

const CN_DIGIT_MAP: Record<string, number> = {
  零: 0,
  〇: 0,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9
};

const parseChineseOrArabicNumber = (raw: string): number | null => {
  const s = (raw || '').replace(/\s+/g, '').trim();
  if (!s) return null;
  if (/^\d+$/.test(s)) return Number(s);
  if (s in CN_DIGIT_MAP) return CN_DIGIT_MAP[s];
  if (s === '十') return 10;
  const tenMatch = s.match(/^([一二三四五六七八九])?十([一二三四五六七八九])?$/);
  if (tenMatch) {
    const tens = tenMatch[1] ? CN_DIGIT_MAP[tenMatch[1]] : 1;
    const ones = tenMatch[2] ? CN_DIGIT_MAP[tenMatch[2]] : 0;
    return tens * 10 + ones;
  }
  return null;
};

const extractChapterHeaderNumber = (headerText: string): number | null => {
  const cnMatch = headerText.match(/第\s*([零〇一二两三四五六七八九十0-9]+)\s*[章单元篇部分]/);
  if (cnMatch) return parseChineseOrArabicNumber(cnMatch[1]);
  const enMatch = headerText.match(/(?:Chapter|Unit|模块)\s*([零〇一二两三四五六七八九十0-9]+)/i);
  if (enMatch) return parseChineseOrArabicNumber(enMatch[1]);
  return null;
};

const getNormalizedText = (el: Partial<HTMLElement> | null | undefined): string =>
  (el?.innerText || el?.textContent || '').replace(/\s+/g, ' ').trim();

const getElementClassString = (el: Partial<HTMLElement> | null | undefined): string => {
  if (!el) return '';
  if (typeof el.className === 'string') return el.className;
  if (typeof el.getAttribute === 'function') return el.getAttribute('class') || '';
  return '';
};

const isInsideHelperOrDialog = (el: HTMLElement): boolean =>
  typeof el.closest === 'function' &&
  !!el.closest(
    'kasa-helper-panel, .kasa-card, .dialog-test, .el-dialog, .el-dialog__wrapper, [role="dialog"], .el-overlay'
  );

const isInsideNavigationOrHeader = (el: HTMLElement): boolean => {
  if (typeof el.closest !== 'function') return false;
  return !!el.closest(
    'header, nav, [role="navigation"], [role="banner"], .main-header, .header-com, .top-box, .operate-btn, .ability-btn-box, [class*="navbar"], [class*="nav-bar"], [class*="topbar"], [class*="top-bar"], [class*="breadcrumb"], [class*="crumb"], [class*="go-back"], [class*="goback"], [class*="back-btn"], [class*="backBtn"], [class*="page-header"], [class*="site-header"], [class*="app-header"]'
  );
};

const isNavigatingAwayLink = (el: HTMLElement, doc: Document): boolean => {
  const linkEl =
    (el.tagName || '').toUpperCase() === 'A'
      ? el
      : typeof el.closest === 'function'
        ? el.closest<HTMLElement>('a')
        : null;
  if (!linkEl || typeof linkEl.getAttribute !== 'function') return false;
  const rawHref = (linkEl.getAttribute('href') || '').trim();
  if (!rawHref || rawHref === '#' || /^javascript:\s*(?:void\s*\(0\)|;)?$/i.test(rawHref)) {
    return false;
  }
  if (/^javascript:\s*history\.(?:back|go\s*\(\s*-)/i.test(rawHref)) {
    return true;
  }
  const curHref = getZhihuishuHref(doc);
  if (!curHref) {
    return /(?:^|\/)(?:home|myCourse|courseList|portal|login|main|courseDetail)(?:[/?#]|$)/i.test(
      rawHref
    );
  }
  try {
    const curUrl = new URL(curHref);
    const targetUrl = new URL(rawHref, curUrl);
    if (targetUrl.origin !== curUrl.origin) return true;
    if (
      /(?:^|\/)(?:home|myCourse|courseList|portal|login|main|courseDetail)(?:[/?#]|$)/i.test(
        targetUrl.pathname
      ) &&
      targetUrl.pathname !== curUrl.pathname
    ) {
      return true;
    }
    if (/\/study\b/i.test(curUrl.pathname) && !/\/study\b/i.test(targetUrl.pathname)) {
      return true;
    }
  } catch {
    // Ignore malformed href
  }
  return false;
};

const isSafeLessonClickTarget = (el: HTMLElement, doc: Document): boolean => {
  if (!el) return false;
  if (isInsideHelperOrDialog(el) || isInsideNavigationOrHeader(el)) return false;
  if (isControlDisabled(el) || isElementOrAncestorHidden(el, doc)) return false;
  const text = getNormalizedText(el);
  if (NAV_OR_HOME_ITEM_RE.test(text) || NAV_BACK_PREFIX_RE.test(text)) return false;
  if (isNavigatingAwayLink(el, doc)) return false;
  return true;
};

const isNonVideoCatalogItem = (item: HTMLElement): boolean => {
  const text = getNormalizedText(item);
  if (NON_VIDEO_ITEM_RE.test(text) || NAV_OR_HOME_ITEM_RE.test(text) || NAV_BACK_PREFIX_RE.test(text)) {
    return true;
  }

  const iconParts: string[] = [getElementClassString(item)];
  if (typeof item.querySelectorAll === 'function') {
    const icons = Array.from(
      item.querySelectorAll<HTMLElement>('svg, use, i, img, [class*="icon"]')
    );
    for (const ic of icons) {
      iconParts.push(getElementClassString(ic));
      if (typeof ic.getAttribute === 'function') {
        iconParts.push(
          ic.getAttribute('href') || '',
          ic.getAttribute('xlink:href') || '',
          ic.getAttribute('src') || '',
          ic.getAttribute('data-icon') || ''
        );
      }
    }
  }
  const iconHints = iconParts.join(' ');
  if (
    /(?:quiz|exam|homework|discuss|pencil|edit-icon|test-icon|doc-icon|pdf-icon)/i.test(iconHints) &&
    !/video|play/i.test(iconHints) &&
    !AI_LESSON_NUMBER_RE.test(text)
  ) {
    return true;
  }
  return false;
};

const isAiLessonItemFinished = (
  item: HTMLElement,
  doc: Document,
  options?: { ignoreSessionCache?: boolean }
): boolean => {
  if (
    item.classList?.contains('finish') ||
    item.classList?.contains('completed') ||
    item.classList?.contains('is-finish') ||
    item.classList?.contains('is-completed')
  ) {
    return true;
  }

  const selfCls = getElementClassString(item);
  if (FINISH_TOKEN_RE.test(selfCls) && !UNFINISH_TOKEN_RE.test(selfCls)) {
    return true;
  }

  if (typeof item.getAttribute === 'function') {
    for (const attr of ['data-status', 'data-finish', 'data-completed', 'data-learned']) {
      const val = (item.getAttribute(attr) || '').trim();
      if (/^(?:finished|completed|done|learned|studied|1|true)$/i.test(val)) {
        return true;
      }
    }
    for (const attr of ['aria-label', 'title']) {
      const val = (item.getAttribute(attr) || '').trim();
      if (/(?:已完成|已学完|completed|finished)/i.test(val) && !/未(?:完成|学完)/.test(val)) {
        return true;
      }
    }
  }

  const text = getNormalizedText(item);
  if (text) {
    if (!options?.ignoreSessionCache && sessionCompletedLessonLabels.has(text)) return true;
    if (/(?:已完成|已学完|100%)/.test(text) && !/未(?:完成|学完)/.test(text)) {
      return true;
    }
  }

  if (typeof item.querySelector === 'function') {
    const finishIcon = item.querySelector<HTMLElement>(
      '.finish-icon, .time_icofinish, .fl.time_icofinish, .finish, .icon-finish, [class*="icofinish"], [class*="finish-icon"]'
    );
    if (finishIcon && !isElementOrAncestorHidden(finishIcon, doc)) {
      return true;
    }
  }

  if (typeof item.querySelectorAll === 'function') {
    const children = Array.from(
      item.querySelectorAll<HTMLElement>(
        'i, svg, use, img, span, [class*="icon"], [class*="status"], [class*="check"], [class*="finish"]'
      )
    );
    for (const child of children) {
      if (isElementOrAncestorHidden(child, doc)) continue;
      const childCls = getElementClassString(child);
      if (FINISH_TOKEN_RE.test(childCls) && !UNFINISH_TOKEN_RE.test(childCls)) {
        return true;
      }
      if (typeof child.getAttribute === 'function') {
        const attrText = [
          child.getAttribute('href') || '',
          child.getAttribute('xlink:href') || '',
          child.getAttribute('src') || '',
          child.getAttribute('title') || '',
          child.getAttribute('aria-label') || '',
          child.getAttribute('alt') || ''
        ].join(' ');
        if (
          /(?:finish|complet|done|learned|studied|circle-check|check-circle|success|wancheng|checkmark|已完成|已学完)/i.test(
            attrText
          ) &&
          !/(?:unfinish|incomplet|not-finish|未完成|未学完)/i.test(attrText)
        ) {
          return true;
        }
      }
    }
  }

  return false;
};

const isAiLessonItemActive = (item: HTMLElement): boolean => {
  if (
    item.classList?.contains('current_play') ||
    item.classList?.contains('currentPlay') ||
    item.classList?.contains('active') ||
    item.classList?.contains('is-active') ||
    item.classList?.contains('selected') ||
    item.classList?.contains('is-selected') ||
    item.classList?.contains('current') ||
    item.classList?.contains('playing')
  ) {
    return true;
  }

  const cls = getElementClassString(item);
  if (ACTIVE_TOKEN_RE.test(cls) && !INACTIVE_TOKEN_RE.test(cls)) {
    return true;
  }

  if (typeof item.getAttribute === 'function') {
    if (
      item.getAttribute('aria-current') === 'true' ||
      item.getAttribute('aria-selected') === 'true' ||
      item.getAttribute('data-active') === 'true'
    ) {
      return true;
    }
  }

  if (typeof item.querySelector === 'function') {
    if (item.querySelector('.current_play, .currentPlay, .active, .is-active, .selected')) {
      return true;
    }
  }

  const parent = item.parentElement;
  if (parent) {
    const pCls = getElementClassString(parent);
    if (
      /(?:^|\s)(?:chapter-item|lesson-item|section-item)(?:\s|$)/.test(pCls) &&
      ACTIVE_TOKEN_RE.test(pCls) &&
      !INACTIVE_TOKEN_RE.test(pCls)
    ) {
      return true;
    }
  }

  return false;
};

const findActiveAiLessonIndex = (items: HTMLElement[], doc: Document): number => {
  const byAttrOrClass = items.findIndex((el) => isAiLessonItemActive(el));
  if (byAttrOrClass >= 0) return byAttrOrClass;

  if (items.length >= 2 && typeof doc.defaultView?.getComputedStyle === 'function') {
    const highlightedIndices: number[] = [];
    for (let i = 0; i < items.length; i++) {
      try {
        const bg = (doc.defaultView.getComputedStyle(items[i])?.backgroundColor || '').trim();
        if (bg && !NON_HIGHLIGHT_BG_RE.test(bg)) {
          highlightedIndices.push(i);
          continue;
        }
        const parent = items[i].parentElement;
        if (parent && /(?:^|\s)(?:chapter-item|lesson-item)(?:\s|$)/.test(getElementClassString(parent))) {
          const pBg = (doc.defaultView.getComputedStyle(parent)?.backgroundColor || '').trim();
          if (pBg && !NON_HIGHLIGHT_BG_RE.test(pBg)) {
            highlightedIndices.push(i);
          }
        }
      } catch {
        // Ignore computed style lookup error on mock nodes
      }
    }
    if (highlightedIndices.length === 1) {
      return highlightedIndices[0];
    }
  }

  return -1;
};

const getLessonIconFingerprint = (el: HTMLElement | null): string => {
  if (!el || typeof el.querySelectorAll !== 'function') return '';
  const icons = Array.from(el.querySelectorAll<HTMLElement>('img, svg, i, [class*="icon"]'));
  if (icons.length === 0) return '';
  return icons
    .map((ic) => {
      const tag = (ic.tagName || '').toUpperCase();
      const cls = getElementClassString(ic);
      const src = typeof ic.getAttribute === 'function' ? ic.getAttribute('src') || '' : '';
      const href =
        typeof ic.getAttribute === 'function'
          ? ic.getAttribute('href') || ic.getAttribute('xlink:href') || ''
          : '';
      const htmlHead = tag === 'SVG' && typeof ic.innerHTML === 'string' ? ic.innerHTML.slice(0, 120) : '';
      return `${tag}:${cls}:${src}:${href}:${htmlHead}`;
    })
    .join('|');
};

/**
 * Computes a stable identifier for the currently active Zhihuishu lesson item
 */
export const getZhihuishuLessonKey = (
  doc: Document,
  videoEl?: HTMLVideoElement | null
): string => {
  const currentPlayEl = doc ? findCurrentZhihuishuPlayElement(doc) : null;
  const titleEl =
    typeof doc?.querySelector === 'function'
      ? doc.querySelector<HTMLElement>(
          '.current_play .catalogue_title, #lessonOrder, .source-name, .video-title'
        )
      : null;
  const labelText = (
    titleEl?.innerText ||
    titleEl?.textContent ||
    getNormalizedText(currentPlayEl) ||
    ''
  ).trim();
  const vid =
    videoEl ??
    (typeof doc?.querySelector === 'function'
      ? doc.querySelector<HTMLVideoElement>(
          '#vjs_container_html5_api, video.vjs-tech, .videoArea video, video'
        )
      : null);
  const src = vid?.currentSrc || vid?.src || '';
  const href = getZhihuishuHref(doc);
  return `${href}::${labelText}::${src}`;
};

/**
 * Checks whether the given hostname or URL belongs to zhihuishu.com
 */
export const isZhihuishuHost = (urlOrHost?: string): boolean => {
  const raw =
    urlOrHost ??
    (typeof window !== 'undefined' ? window.location?.hostname || window.location?.href || '' : '');
  if (!raw || typeof raw !== 'string') return false;
  const trimmed = raw.trim();
  if (!trimmed) return false;

  try {
    if (/^https?:\/\//i.test(trimmed)) {
      const host = new URL(trimmed).hostname.toLowerCase();
      return host === 'zhihuishu.com' || host.endsWith('.zhihuishu.com');
    }
  } catch {
    // Fall through to string parsing
  }

  const hostOnly = trimmed.split('/')[0].split(':')[0].toLowerCase();
  return hostOnly === 'zhihuishu.com' || hostOnly.endsWith('.zhihuishu.com');
};

/**
 * Checks whether the current page is a Zhihuishu exam or homework page
 */
export const isZhihuishuExamPage = (doc?: Document, url?: string): boolean => {
  const targetUrl =
    url ??
    (doc as any)?.location?.href ??
    (typeof window !== 'undefined' ? window.location?.href || '' : '');
  if (!isZhihuishuHost(targetUrl)) return false;

  if (/(?:onlineexamh5new|stuExamWeb|examPaper|doHomework|doExam|homework)/i.test(targetUrl)) {
    return true;
  }

  const targetDoc = doc ?? (typeof document !== 'undefined' ? document : undefined);
  if (!targetDoc) return false;

  const examSel = '.examPaper_subject, .questionBox, .subject_item, .examQuestion_item';
  const isRealExamNode = (el: HTMLElement | null): boolean => {
    if (!el) return false;
    if (
      typeof el.closest === 'function' &&
      el.closest('.dialog-test, .el-dialog__wrapper, .el-dialog, [role="dialog"]')
    ) {
      return false;
    }
    if (isElementOrAncestorHidden(el, targetDoc)) {
      return false;
    }
    return true;
  };

  if (typeof targetDoc.querySelectorAll === 'function') {
    const matches = Array.from(targetDoc.querySelectorAll<HTMLElement>(examSel));
    if (matches.length > 0) {
      return matches.some((el) => isRealExamNode(el));
    }
  }

  if (typeof targetDoc.querySelector === 'function') {
    return isRealExamNode(targetDoc.querySelector<HTMLElement>(examSel));
  }

  return false;
};

/**
 * Checks whether the current page is a Zhihuishu video learning page (excluding exam/homework pages)
 */
export const isZhihuishuVideoPage = (doc?: Document, url?: string): boolean => {
  const targetUrl =
    url ??
    (doc as any)?.location?.href ??
    (typeof window !== 'undefined' ? window.location?.href || '' : '');
  if (!isZhihuishuHost(targetUrl)) return false;
  if (isZhihuishuExamPage(doc, targetUrl)) return false;

  if (/(?:studyvideoh5|studyh5|fusioncourseh5|videoStudy|liveCourse|learnPage|knowledgeStudy)/i.test(targetUrl)) {
    return true;
  }
  if (/wisdom-mooc\.zhihuishu\.com\/study(?:\/index)?\b/i.test(targetUrl)) {
    return true;
  }

  const targetDoc = doc ?? (typeof document !== 'undefined' ? document : undefined);
  if (targetDoc && typeof targetDoc.querySelector === 'function') {
    if (
      targetDoc.querySelector(
        '#vjs_container_html5_api, video.vjs-tech, .videoArea video, .clearfix.video, .current_play'
      )
    ) {
      return true;
    }
    if (/ai-smart-course/i.test(targetUrl) && targetDoc.querySelector('video')) {
      return true;
    }
  }

  return false;
};

/**
 * Finds a currently visible Zhihuishu in-video popup quiz dialog (classic .dialog-test or new AI 随堂练习 modal)
 */
export const findVisiblePopupTestDialog = (doc: Document): HTMLElement | null => {
  if (!doc || typeof doc.querySelectorAll !== 'function') return null;

  const isNotHelper = (el: HTMLElement): boolean =>
    !(typeof el.closest === 'function' && el.closest('kasa-helper-panel, .kasa-card'));

  const primaryCandidates = Array.from(
    doc.querySelectorAll<HTMLElement>('.dialog-test, .el-dialog__wrapper.dialog-test, [class*="dialog-test"]')
  );
  for (const el of primaryCandidates) {
    if (!isNotHelper(el)) continue;
    if (!isElementOrAncestorHidden(el, doc)) {
      return el;
    }
  }

  const wrapperCandidates = Array.from(doc.querySelectorAll<HTMLElement>('.el-dialog__wrapper'));
  for (const wrapper of wrapperCandidates) {
    if (!isNotHelper(wrapper)) continue;
    if (isElementOrAncestorHidden(wrapper, doc)) continue;
    if (wrapper.querySelector('.topic-item, .topic-title, .topic-list')) {
      return wrapper;
    }
  }

  // New AI course in-video practice modal ("AI随堂练习" + "[单选题]/[多选题]" + "提交作答")
  const aiModalCandidates = Array.from(
    doc.querySelectorAll<HTMLElement>(
      '.el-dialog, [role="dialog"], .el-overlay-dialog, .el-overlay, [class*="dialog"], [class*="modal"], [class*="popup"], [class*="practice"], [class*="exercise"], [class*="quiz"]'
    )
  ).filter((el) => {
    if (!isNotHelper(el) || isElementOrAncestorHidden(el, doc)) return false;
    const txt = (el.innerText || el.textContent || '').trim();
    if (!txt) return false;
    const hasPracticeHeader = /(?:AI随堂练习|随堂练习|随堂测验)/.test(txt);
    const hasPracticeActionOrType =
      /\[(?:单选|多选|判断)题?\]/.test(txt) || /(?:提交作答|继续学习|继续观看)/.test(txt);
    const hasTypeAndSubmit = /\[(?:单选|多选|判断)题?\]/.test(txt) && txt.includes('提交作答');
    return (hasPracticeHeader && hasPracticeActionOrType) || hasTypeAndSubmit;
  });

  if (aiModalCandidates.length > 0) {
    // Prefer the innermost matching dialog that still contains action buttons if available
    const withActionBtn = aiModalCandidates.filter((el) => {
      const txt = el.innerText || el.textContent || '';
      return /(?:提交作答|继续学习|继续观看|关闭|确定)/.test(txt) || !!el.querySelector?.('button');
    });
    const pool = withActionBtn.length > 0 ? withActionBtn : aiModalCandidates;
    const innermost = pool.find(
      (node, i, arr) =>
        !arr.some((other, j) => i !== j && typeof node.contains === 'function' && node.contains(other))
    );
    return innermost || pool[0];
  }

  return null;
};

const isPopupOptionSelected = (el: HTMLElement): boolean => {
  if (
    el.classList?.contains('active') ||
    el.classList?.contains('is-active') ||
    el.classList?.contains('is-checked') ||
    el.classList?.contains('selected') ||
    el.getAttribute?.('aria-checked') === 'true'
  ) {
    return true;
  }
  return !!el.querySelector?.('.active, .is-active, .is-checked, .selected, input:checked');
};

const isControlDisabled = (el: HTMLElement): boolean =>
  (el as HTMLButtonElement).disabled === true ||
  (typeof el.hasAttribute === 'function' && el.hasAttribute('disabled')) ||
  el.classList?.contains('disabled') === true ||
  el.classList?.contains('is-disabled') === true ||
  (typeof el.getAttribute === 'function' && el.getAttribute('aria-disabled') === 'true');

const ACTION_LABEL_RE =
  /^(?:提交作答|确认作答|提交答案|提交|继续学习|继续观看|继续播放|关闭|确定|完成|我知道了|知道了|好的)$/;

const collectPopupActionCandidates = (container: HTMLElement, doc: Document): HTMLElement[] => {
  if (typeof container.querySelectorAll !== 'function') return [];
  const raw = Array.from(
    container.querySelectorAll<HTMLElement>(
      'button, a, [role="button"], .btn, [class*="btn"], [class*="button"], [class*="submit"], [class*="close"], div, span'
    )
  );

  const unique: HTMLElement[] = [];
  for (const el of raw) {
    if (!unique.includes(el)) unique.push(el);
  }

  const filtered = unique.filter((btn) => {
    if (isControlDisabled(btn) || isElementOrAncestorHidden(btn, doc)) return false;
    if (typeof btn.closest === 'function' && btn.closest('kasa-helper-panel, .kasa-card')) {
      return false;
    }
    const tag = (btn.tagName || '').toUpperCase();
    const cls = typeof btn.className === 'string' ? btn.className : '';
    const role = btn.getAttribute?.('role') || '';
    const hasButtonHint =
      tag === 'BUTTON' ||
      tag === 'A' ||
      role === 'button' ||
      /(?:btn|button|submit|close)/i.test(cls);
    const compact = (btn.innerText || btn.textContent || '').replace(/\s+/g, '');
    if (!hasButtonHint) {
      return compact.length > 0 && compact.length <= 12 && ACTION_LABEL_RE.test(compact);
    }
    return true;
  });

  // Prefer semantic <button>/<a>/[role=button] over nested wrapper spans; otherwise keep innermost div/span
  return filtered.filter((node, i, arr) => {
    const tag = (node.tagName || '').toUpperCase();
    const isNativeBtn = tag === 'BUTTON' || tag === 'A' || node.getAttribute?.('role') === 'button';
    if (isNativeBtn) return true;
    return !arr.some(
      (other, j) => i !== j && typeof node.contains === 'function' && node.contains(other)
    );
  });
};

const findPopupCloseButton = (
  dialog: HTMLElement,
  doc: Document,
  options?: { excludeEl?: HTMLElement | null; postSubmit?: boolean }
): HTMLElement | null => {
  const candidates = collectPopupActionCandidates(dialog, doc).filter((btn) => {
    if (!options?.excludeEl) return true;
    const ex = options.excludeEl;
    if (btn === ex) return false;
    if (typeof ex.contains === 'function' && ex.contains(btn)) return false;
    if (typeof btn.contains === 'function' && btn.contains(ex)) return false;
    return true;
  });

  const priorityKeywords = options?.postSubmit
    ? ['继续学习', '继续观看', '继续播放', '关闭', '确定', '完成', '好的', '我知道了', '知道了']
    : ['提交作答', '确认作答', '提交答案', '关闭', '确定', '完成', '提交', '继续学习', '继续观看', '继续播放', '我知道了'];

  for (const kw of priorityKeywords) {
    for (const btn of candidates) {
      const compact = (btn.innerText || btn.textContent || '').replace(/\s+/g, '');
      if (options?.postSubmit && /提交作答|确认作答|提交答案|^提交$/.test(compact)) {
        continue;
      }
      if (compact.includes(kw)) {
        return btn;
      }
    }
  }

  if (typeof dialog.querySelectorAll === 'function') {
    const fallbackSelector = options?.postSubmit
      ? '.el-dialog__headerbtn, .close-btn, [class*="close"]'
      : '.dialog-footer .el-button--primary, .dialog-footer .btn, .btn, .el-dialog__headerbtn, .close-btn, [class*="close"]';
    const fallbackButtons = Array.from(dialog.querySelectorAll<HTMLElement>(fallbackSelector));
    for (const btn of fallbackButtons) {
      if (isControlDisabled(btn) || isElementOrAncestorHidden(btn, doc)) continue;
      if (options?.excludeEl && btn === options.excludeEl) continue;
      return btn;
    }
  }

  return null;
};

const isHeaderOrNoiseLine = (text: string): boolean => {
  const compact = text.replace(/\s+/g, '');
  if (!compact) return true;
  return (
    compact === 'AI随堂练习' ||
    compact === '随堂练习' ||
    compact === '随堂测验' ||
    compact.includes('以下所有内容均由AI生成') ||
    compact.includes('请注意甄别') ||
    ACTION_LABEL_RE.test(compact)
  );
};

const findVisiblePopupTitleElement = (dialog: HTMLElement, doc: Document): HTMLElement | null => {
  const titleSelector =
    '.topic-title, .question-title, .subject_describe, .question-stem, .stem, .topic-stem, .title';
  const rawCandidates =
    typeof dialog.querySelectorAll === 'function'
      ? Array.from(dialog.querySelectorAll<HTMLElement>(titleSelector))
      : [];
  if (rawCandidates.length > 0) {
    return (
      rawCandidates.find(
        (el) =>
          !isElementOrAncestorHidden(el, doc) &&
          !isHeaderOrNoiseLine((el.innerText || el.textContent || '').trim())
      ) ?? null
    );
  }
  if (typeof dialog.querySelector === 'function') {
    const single = dialog.querySelector<HTMLElement>(titleSelector);
    if (
      single &&
      !isElementOrAncestorHidden(single, doc) &&
      !isHeaderOrNoiseLine((single.innerText || single.textContent || '').trim())
    ) {
      return single;
    }
  }
  return null;
};

const extractPopupQuestionTitle = (dialog: HTMLElement, doc: Document): string => {
  const el = findVisiblePopupTitleElement(dialog, doc);
  const direct = (el?.innerText || el?.textContent || '').trim();
  if (direct) return direct;

  // Fallback for AI 随堂练习 where "1. [单选题]" and the stem live inside plain divs without dedicated title classes
  const rawLines = (dialog.innerText || dialog.textContent || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const kept: string[] = [];
  for (const line of rawLines) {
    if (isHeaderOrNoiseLine(line)) continue;
    if (/^[A-H]$/.test(line)) break;
    if (/^[A-H](?:[\.、．:：\)\]\s]+)\S+/.test(line) && !/^AI/i.test(line)) break;
    kept.push(line);
    if (kept.length >= 2 && !/^\d+\.\s*\[.*\]$/.test(kept[kept.length - 1])) {
      break;
    }
  }
  return kept.join(' ').trim();
};

const getPopupDialogSignature = (dialog: HTMLElement, doc: Document): string => {
  const titleText = extractPopupQuestionTitle(dialog, doc).slice(0, 80);
  const fallbackText = (dialog.innerText || dialog.textContent || '').trim().slice(0, 80);
  return titleText || fallbackText || 'popup-dialog';
};

/**
 * Detects visible Zhihuishu human-verification / security CAPTCHA modals (never interacts with or bypasses them)
 */
export const findVisibleZhihuishuCaptchaDialog = (doc: Document): HTMLElement | null => {
  if (!doc || typeof doc.querySelectorAll !== 'function') return null;

  const isNotHelper = (el: HTMLElement): boolean =>
    !(typeof el.closest === 'function' && el.closest('kasa-helper-panel, .kasa-card'));

  const knownCaptchaSelectors =
    '.yidun_modal, .yidun_popup, .geetest_panel, .geetest_box, .nc_wrapper, [class*="captcha-modal"], [class*="captchaModal"], [class*="safety-verify"], [class*="safetyVerify"], [class*="security-verify"], [class*="verify-dialog"], [class*="verifyDialog"]';
  const knownCandidates = Array.from(doc.querySelectorAll<HTMLElement>(knownCaptchaSelectors));
  for (const el of knownCandidates) {
    if (!isNotHelper(el) || isElementOrAncestorHidden(el, doc)) continue;
    const txt = getNormalizedText(el);
    if (/(?:AI随堂练习|随堂练习|随堂测验|\[(?:单选|多选|判断)题?\])/.test(txt)) continue;
    return el;
  }

  const modalCandidates = Array.from(
    doc.querySelectorAll<HTMLElement>(
      '.el-dialog, .el-dialog__wrapper, .el-overlay-dialog, .el-overlay, [role="dialog"], [class*="dialog"], [class*="modal"], [class*="popup"], [class*="verify"]'
    )
  ).filter((el) => {
    if (!isNotHelper(el) || isElementOrAncestorHidden(el, doc)) return false;
    const txt = getNormalizedText(el);
    if (!txt || txt.length > 300) return false;
    if (/(?:AI随堂练习|随堂练习|随堂测验|\[(?:单选|多选|判断)题?\]|提交作答)/.test(txt)) {
      return false;
    }
    if (/请完成安全验证|行为验证|人机验证|滑动拼图验证|安全校验/.test(txt)) {
      return true;
    }
    if (/安全验证/.test(txt) && /(?:点击|拖动|滑动|拼图|验证码|立方体|验证|刷新)/.test(txt)) {
      return true;
    }
    if (/请点击.*(?:大写|小写|汉字|字母|图形|颜色一样|依次点击)/.test(txt)) {
      return true;
    }
    return false;
  });

  if (modalCandidates.length === 0) return null;
  const innermost = modalCandidates.find(
    (node, i, arr) =>
      !arr.some((other, j) => i !== j && typeof node.contains === 'function' && node.contains(other))
  );
  return innermost || modalCandidates[0];
};

const notifyUserCaptchaRequired = (lessonTitle: string): void => {
  const title = '智慧树安全验证提醒';
  const body = `【${lessonTitle || '智慧树视频课程'}】弹出“请完成安全验证”，挂机已自动暂停，请手动完成验证！`;
  try {
    // @ts-ignore
    if (typeof GM_notification === 'function') {
      // @ts-ignore
      GM_notification({ title, text: body, timeout: 10000 });
    } else if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      new Notification(title, { body });
    }
  } catch {
    // Ignore notification restrictions
  }

  try {
    const AudioCtx = (globalThis as any).AudioContext || (globalThis as any).webkitAudioContext;
    if (typeof AudioCtx === 'function') {
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      osc.frequency.setValueAtTime(660, ctx.currentTime + 0.16);
      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.36);
      setTimeout(() => {
        try {
          void ctx.close?.();
        } catch {}
      }, 500);
    }
  } catch {
    // Ignore audio context autoplay restrictions
  }
};

/**
 * Dismisses lightweight Zhihuishu tip/guidance dialogs (e.g. "videoConfigTip01" with "好的")
 */
export const dismissZhihuishuTipDialog = (doc: Document): boolean => {
  if (!doc || typeof doc.querySelectorAll !== 'function') return false;
  if (findVisibleZhihuishuCaptchaDialog(doc)) return false;

  const activeQuizDialog = findVisiblePopupTestDialog(doc);
  const candidates = Array.from(
    doc.querySelectorAll<HTMLElement>(
      '.el-dialog, .el-dialog__wrapper, .el-message-box__wrapper, [role="dialog"], [class*="dialog"], [class*="modal"], [class*="tip"], [class*="popup"]'
    )
  ).filter((el) => {
    if (typeof el.closest === 'function' && el.closest('kasa-helper-panel, .kasa-card')) {
      return false;
    }
    if (isElementOrAncestorHidden(el, doc)) return false;
    if (
      activeQuizDialog &&
      (el === activeQuizDialog ||
        (typeof el.contains === 'function' && el.contains(activeQuizDialog)) ||
        (typeof activeQuizDialog.contains === 'function' && activeQuizDialog.contains(el)))
    ) {
      return false;
    }
    if (
      typeof el.querySelector === 'function' &&
      el.querySelector('.topic-item, .topic-title, .examPaper_subject, .questionBox')
    ) {
      return false;
    }
    const txt = (el.innerText || el.textContent || '').trim();
    if (!txt || /提交作答|\[(?:单选|多选|判断)题?\]|AI随堂练习|随堂练习/.test(txt)) {
      return false;
    }
    return /videoConfigTip/i.test(txt) || txt.length <= 220;
  });

  if (candidates.length === 0) return false;

  // Prefer innermost matching tip dialog
  const innermost =
    candidates.find(
      (node, i, arr) =>
        !arr.some((other, j) => i !== j && typeof node.contains === 'function' && node.contains(other))
    ) || candidates[0];

  const tipText = (innermost.innerText || innermost.textContent || '').trim();
  const isTipKeyMatch = /videoConfigTip/i.test(tipText);
  const dismissLabels = ['好的', '我知道了', '知道了', '继续观看', '继续学习'];
  const allLabels = isTipKeyMatch ? [...dismissLabels, '确定', '关闭'] : dismissLabels;

  const actionButtons = collectPopupActionCandidates(innermost, doc);
  for (const label of allLabels) {
    const matched = actionButtons.find((btn) => {
      const compact = (btn.innerText || btn.textContent || '').replace(/\s+/g, '');
      return compact === label || (isTipKeyMatch && compact.includes(label));
    });
    if (matched) {
      matched.click();
      store.addLog('已自动关闭智慧树提示弹窗', 'info');
      return true;
    }
  }

  return false;
};

const parsePopupOptions = (dialog: HTMLElement, doc: Document): ParsedOptionItem[] => {
  const rawNodes = Array.from(
    dialog.querySelectorAll<HTMLElement>(
      '.topic-item, ul.topic-list > li, .el-radio, .el-checkbox, .option-item, [class*="option-item"], [class*="answer-item"]'
    )
  );
  const deduped = rawNodes.filter(
    (node, i, arr) =>
      !isElementOrAncestorHidden(node, doc) &&
      !arr.some((other, j) => i !== j && typeof node.contains === 'function' && node.contains(other))
  );

  const parsed: ParsedOptionItem[] = [];
  for (const optEl of deduped) {
    const letterEl = optEl.querySelector<HTMLElement>(
      '.topic-option, .option-letter, .node_Lab, [class*="letter"], [class*="badge"]'
    );
    const textEl = optEl.querySelector<HTMLElement>(
      '.topic-text, .el-radio__label, .el-checkbox__label, .option-detail, .node_detail, [class*="text"], [class*="label"]'
    );
    const inputEl = optEl.querySelector<HTMLInputElement>('input[type="radio"], input[type="checkbox"]');
    const rawOptText = (textEl?.innerText || textEl?.textContent || optEl.innerText || optEl.textContent || '').trim();

    let letter = '';
    const letterBadge = (letterEl?.innerText || letterEl?.textContent || '').trim();
    const badgeMatch = letterBadge.match(/^([A-H])[\.、．:：\s]?$/i);
    if (badgeMatch) {
      letter = badgeMatch[1].toUpperCase();
    } else if (inputEl?.value && /^[A-H]$/i.test(inputEl.value.trim())) {
      letter = inputEl.value.trim().toUpperCase();
    } else {
      const prefixMatch = rawOptText.match(/^([A-H])[\.、．:：\s]+/);
      letter = prefixMatch ? prefixMatch[1].toUpperCase() : String.fromCharCode(65 + parsed.length);
    }

    const cleanOptText = rawOptText.replace(new RegExp(`^${letter}[\\.、．:：\\s]*`, 'i'), '').trim();
    const finalRawText = cleanOptText || rawOptText;
    if (!finalRawText && !inputEl) continue;

    const clickableEl =
      optEl.querySelector<HTMLElement>(
        'input[type="radio"], input[type="checkbox"], .el-radio__input, .el-checkbox__input, label'
      ) || optEl;

    parsed.push({
      el: optEl,
      clickableEl,
      rawText: finalRawText,
      cleanText: normalizeText(finalRawText),
      letter,
      dataValue: inputEl?.value?.trim() || undefined
    });
  }

  if (parsed.length > 0) {
    return parsed;
  }

  // Tier 2 fallback: circular "A / B / C / D" div/li rows without <input> or fixed option classes (new AI随堂练习)
  if (typeof dialog.querySelectorAll !== 'function') {
    return [];
  }

  const extractGenericOptionRow = (el: HTMLElement): { letter: string; text: string } | null => {
    const raw = (el.innerText || el.textContent || '').trim();
    if (!raw || raw.length >= 180 || isHeaderOrNoiseLine(raw)) return null;
    if (typeof el.closest === 'function' && el.closest('kasa-helper-panel, .kasa-card')) return null;
    const tag = (el.tagName || '').toUpperCase();
    if (tag === 'BUTTON' || tag === 'A' || el.getAttribute?.('role') === 'button') return null;

    // Separated format: "A 线性回归", "A\n线性回归", "A. 线性回归", "A、线性回归"
    const sepMatch = raw.match(/^([A-H])(?:[\.、．:：\)\]]\s*|\s+)([\s\S]+)$/);
    if (sepMatch) {
      const text = sepMatch[2].trim();
      if (text && !/^随堂练习/.test(text)) {
        return { letter: sepMatch[1].toUpperCase(), text };
      }
    }

    // Two-child badge layout where textContent concatenates without space (e.g. <span>A</span><span>线性回归</span>)
    const childNodes = (el as any).children
      ? Array.from((el as any).children as ArrayLike<HTMLElement>)
      : typeof el.querySelectorAll === 'function'
        ? Array.from(el.querySelectorAll<HTMLElement>('span, div, p'))
        : [];
    if (childNodes.length >= 2) {
      const firstText = (childNodes[0]?.innerText || childNodes[0]?.textContent || '').trim();
      if (/^[A-H]$/i.test(firstText)) {
        const restParts = childNodes
          .slice(1)
          .map((c) => (c.innerText || c.textContent || '').trim())
          .filter(Boolean);
        const combinedRest = restParts.join(' ').trim();
        if (combinedRest && !/^I随堂/.test(combinedRest)) {
          return { letter: firstText.toUpperCase(), text: combinedRest };
        }
      }
    }

    return null;
  };

  const genericCandidates = Array.from(dialog.querySelectorAll<HTMLElement>('li, div, p, label')).filter(
    (el) => !isElementOrAncestorHidden(el, doc) && !!extractGenericOptionRow(el)
  );
  const innermostRows = genericCandidates.filter(
    (node, i, arr) =>
      !arr.some((other, j) => i !== j && typeof node.contains === 'function' && node.contains(other))
  );

  const fallbackParsed: ParsedOptionItem[] = [];
  for (const optEl of innermostRows) {
    const info = extractGenericOptionRow(optEl);
    if (!info) continue;
    fallbackParsed.push({
      el: optEl,
      clickableEl: optEl,
      rawText: info.text,
      cleanText: normalizeText(info.text),
      letter: info.letter
    });
  }

  const distinctLetters = new Set(fallbackParsed.map((o) => o.letter));
  return distinctLetters.size >= 2 ? fallbackParsed : [];
};

/**
 * Automatically detects and solves Zhihuishu in-video popup quiz dialogs
 */
export const solveZhihuishuPopupTest = async (
  doc: Document,
  signal: AbortSignal,
  isCurrent: () => boolean,
  timing?: { reactionDelayMs?: number; closeDelayMs?: number; verifyCloseDelayMs?: number }
): Promise<boolean> => {
  const initialDialog = findVisiblePopupTestDialog(doc);
  if (!initialDialog) return false;

  const reactionDelay = timing?.reactionDelayMs ?? (1500 + Math.random() * 2500);
  store.addLog('检测到智慧树随堂弹题，正在模拟阅读题目...', 'info');

  if (reactionDelay > 0) {
    try {
      await sleep(reactionDelay, signal);
    } catch {
      return false;
    }
  }
  if (!isCurrent() || signal.aborted) return false;

  const activeDialog = findVisiblePopupTestDialog(doc);
  if (!activeDialog) return false;

  const tabItems = Array.from(activeDialog.querySelectorAll<HTMLElement>('.topic-num-item')).filter(
    (tab) => !isElementOrAncestorHidden(tab, doc)
  );
  const totalTabs = tabItems.length > 0 ? Math.min(tabItems.length, 10) : 1;
  const clickIntervalMs = timing ? 20 : 250;

  for (let qIdx = 0; qIdx < totalTabs; qIdx++) {
    if (!isCurrent() || signal.aborted) return false;

    if (tabItems.length > 0) {
      const tab = tabItems[qIdx];
      const isActiveTab =
        tab.classList?.contains('active') ||
        tab.classList?.contains('is-active') ||
        tab.classList?.contains('current');
      if (qIdx > 0 || !isActiveTab) {
        tab.click();
        try {
          await sleep(clickIntervalMs, signal);
        } catch {
          return false;
        }
        if (!isCurrent() || signal.aborted) return false;
      }
    }

    const rawTitle = extractPopupQuestionTitle(activeDialog, doc);
    const cleanTitle = cleanQuestionTitle(rawTitle);
    const parsedOptions = parsePopupOptions(activeDialog, doc);

    if (parsedOptions.length > 0) {
      const hasCheckboxes =
        (typeof activeDialog.querySelector === 'function' &&
          !!activeDialog.querySelector('input[type="checkbox"], .el-checkbox')) ||
        /多选/.test(rawTitle);
      const radioCount =
        typeof activeDialog.querySelectorAll === 'function'
          ? activeDialog.querySelectorAll('input[type="radio"], .el-radio').length
          : 0;
      const qType = detectQuestionType(
        rawTitle,
        hasCheckboxes,
        radioCount,
        activeDialog.innerText || activeDialog.textContent || ''
      );

      const questionObj: Question = {
        id: `zhs-popup-${Date.now()}-${qIdx}`,
        index: qIdx + 1,
        type: qType,
        title: cleanTitle || rawTitle,
        options: parsedOptions.map((o) => o.rawText),
        status: 'searching'
      };

      let answers: string[] = [];
      if (store.config.aiApiKey.trim()) {
        try {
          answers = await queryAiAnswer(questionObj, '智慧树视频随堂弹题', signal);
        } catch {
          answers = [];
        }
        if (!isCurrent() || signal.aborted) return false;
      }

      if (!answers || answers.length === 0) {
        answers = matchFallbackAnswer(
          cleanTitle || rawTitle,
          parsedOptions.map((o) => o.rawText),
          qIdx + 1
        );
      }

      let matchedOptions = selectBestOptions(parsedOptions, answers, qType);
      if (matchedOptions.length === 0) {
        matchedOptions = [parsedOptions[0]];
      }

      for (const optItem of matchedOptions) {
        if (!isCurrent() || signal.aborted) return false;

        const isElementUiOption =
          optItem.el.classList?.contains('el-radio') ||
          optItem.el.classList?.contains('el-checkbox') ||
          !!optItem.el.querySelector?.('.el-radio, .el-checkbox, .el-radio__input, .el-checkbox__input') ||
          optItem.el.classList?.contains('nodeLab') ||
          optItem.el.classList?.contains('topic-item') ||
          !!optItem.el.querySelector?.('.nodeLab');

        if (!isPopupOptionSelected(optItem.el)) {
          if (isElementUiOption) {
            const primaryClickTarget =
              optItem.el.matches?.('label.el-radio, label.el-checkbox, .el-radio, .el-checkbox, .nodeLab, .topic-item') ||
              typeof optItem.el.matches !== 'function'
                ? optItem.el
                : optItem.el.querySelector<HTMLElement>(
                    'label.el-radio, label.el-checkbox, .el-radio, .el-checkbox, .nodeLab, .el-radio__input, .el-checkbox__input'
                  ) || optItem.el;

            primaryClickTarget.click();
            try {
              await sleep(50, signal);
            } catch {
              return false;
            }
            if (!isCurrent() || signal.aborted) return false;

            if (!isPopupOptionSelected(optItem.el) && optItem.clickableEl !== primaryClickTarget) {
              optItem.clickableEl.click();
              try {
                await sleep(50, signal);
              } catch {
                return false;
              }
              if (!isCurrent() || signal.aborted) return false;
            }
          } else {
            optItem.el.click();
            await Promise.resolve();
            if (!isPopupOptionSelected(optItem.el) && optItem.clickableEl !== optItem.el) {
              optItem.clickableEl.click();
              await Promise.resolve();
            }
          }
        }

        try {
          await sleep(clickIntervalMs, signal);
        } catch {
          return false;
        }
      }

      store.addLog(
        `智慧树弹题第 ${qIdx + 1} 题已作答: [${matchedOptions.map((o) => o.letter).join(', ')}]`,
        'success'
      );
    }
  }

  const closeDelay = timing?.closeDelayMs ?? (800 + Math.random() * 700);
  if (closeDelay > 0) {
    try {
      await sleep(closeDelay, signal);
    } catch {
      return false;
    }
  }
  if (!isCurrent() || signal.aborted) return false;

  const dialogToClose = findVisiblePopupTestDialog(doc) || activeDialog;
  const primaryBtn = findPopupCloseButton(dialogToClose, doc, { postSubmit: false });
  const verifyCloseDelay = timing?.verifyCloseDelayMs ?? 350;
  if (primaryBtn) {
    primaryBtn.click();
    const btnLabel = (primaryBtn.innerText || primaryBtn.textContent || '').replace(/\s+/g, '');
    store.addLog(
      btnLabel.includes('提交')
        ? `已点击智慧树弹题【${btnLabel || '提交作答'}】按钮`
        : '已点击智慧树弹题关闭/确定按钮',
      'info'
    );
    if (verifyCloseDelay > 0) {
      try {
        await sleep(verifyCloseDelay, signal);
      } catch {
        return false;
      }
      if (!isCurrent() || signal.aborted) return false;
    }
  }

  // Phase 2: If post-submit explanation/result view stays open, click "继续学习 / 关闭 / 确定"
  const remainingDialog = findVisiblePopupTestDialog(doc);
  if (remainingDialog && primaryBtn) {
    const secondaryBtn = findPopupCloseButton(remainingDialog, doc, {
      excludeEl: primaryBtn,
      postSubmit: true
    });
    if (secondaryBtn) {
      secondaryBtn.click();
      store.addLog('已点击弹题提交后关闭/继续学习按钮', 'info');
      if (verifyCloseDelay > 0) {
        try {
          await sleep(verifyCloseDelay, signal);
        } catch {
          return false;
        }
        if (!isCurrent() || signal.aborted) return false;
      }
    }
  }

  return !findVisiblePopupTestDialog(doc);
};

const dedupeInnermostElements = (nodes: HTMLElement[]): HTMLElement[] => {
  const filtered = nodes.filter(
    (node, i, arr) =>
      !arr.some((other, j) => i !== j && typeof node.contains === 'function' && node.contains(other))
  );
  const unique: HTMLElement[] = [];
  for (const node of filtered) {
    if (!unique.includes(node)) unique.push(node);
  }
  return unique;
};

const hasSiblingIconOrControl = (el: HTMLElement, parent: HTMLElement): boolean => {
  const pCls = getElementClassString(parent);
  if (ACTIVE_TOKEN_RE.test(pCls) || FINISH_TOKEN_RE.test(pCls)) return true;
  const tag = (parent.tagName || '').toUpperCase();
  if (tag === 'LI' || tag === 'A' || tag === 'BUTTON') return true;
  const children = (parent as any).children
    ? Array.from((parent as any).children as ArrayLike<HTMLElement>)
    : [];
  return children.some((ch) => {
    if (ch === el) return false;
    const chTag = (ch.tagName || '').toUpperCase();
    const chCls = getElementClassString(ch);
    return (
      chTag === 'SVG' ||
      chTag === 'I' ||
      chTag === 'IMG' ||
      /(?:icon|status|check|dot|badge|num|time)/i.test(chCls)
    );
  });
};

const isInsideVideoHeaderOrBreadcrumb = (el: HTMLElement): boolean =>
  typeof el.closest === 'function' && !!el.closest('[class*="breadcrumb"], [class*="crumb"]');

/**
 * Discovers chapter accordion headers in Zhihuishu new AI course sidebars
 */
export const findZhihuishuChapterHeaders = (doc: Document): HTMLElement[] => {
  if (!doc || typeof doc.querySelectorAll !== 'function') return [];

  // Prefer native Element Plus / Ant Design collapse headers first so aria-expanded stays intact
  const nativeCollapseHeaders = Array.from(
    doc.querySelectorAll<HTMLElement>('.el-collapse-item__header, .ant-collapse-header')
  ).filter((el) => {
    if (
      isInsideHelperOrDialog(el) ||
      isInsideNavigationOrHeader(el) ||
      isElementOrAncestorHidden(el, doc)
    ) {
      return false;
    }
    if (isNavigatingAwayLink(el, doc)) return false;
    const text = getNormalizedText(el);
    if (text.length < 1 || text.length > 120) return false;
    if (NAV_OR_HOME_ITEM_RE.test(text) || NAV_BACK_PREFIX_RE.test(text)) return false;
    return CHAPTER_HEADER_RE.test(text) || (!AI_LESSON_NUMBER_RE.test(text) && !isNonVideoCatalogItem(el));
  });
  if (nativeCollapseHeaders.length > 0) {
    const dedupedNative = dedupeInnermostElements(nativeCollapseHeaders);
    const nativeChapterCount = dedupedNative.filter((el) =>
      CHAPTER_HEADER_RE.test(getNormalizedText(el))
    ).length;
    if (nativeChapterCount >= 1) {
      return dedupedNative;
    }
  }

  const explicitSelector = [
    '.el-collapse-item__header',
    '.ant-collapse-header',
    '.chapter-content-first',
    '.chapter-item-title',
    '[class*="chapter-first"]',
    '[class*="chapterFirst"]',
    '[class*="chapter-header"]',
    '[class*="chapterHeader"]',
    '[class*="chapter-title"]',
    '[class*="chapterTitle"]',
    '[class*="chapter_title"]',
    '[class*="chapter-top"]',
    '[class*="chapter-head"]',
    '[class*="unit-header"]',
    '[class*="section-header"]',
    '.el-sub-menu__title',
    '.el-submenu__title'
  ].join(', ');

  const rawExplicit = Array.from(doc.querySelectorAll<HTMLElement>(explicitSelector)).filter((el) => {
    if (
      isInsideHelperOrDialog(el) ||
      isInsideNavigationOrHeader(el) ||
      isElementOrAncestorHidden(el, doc)
    ) {
      return false;
    }
    const text = getNormalizedText(el);
    if (text.length < 1 || text.length > 120) return false;
    if (NAV_OR_HOME_ITEM_RE.test(text) || NAV_BACK_PREFIX_RE.test(text)) return false;
    if (isNavigatingAwayLink(el, doc)) return false;
    if (CHAPTER_HEADER_RE.test(text)) return true;
    const cls = getElementClassString(el);
    if (/(?:^|\s)el-sub-?menu__title(?:\s|$)/.test(cls)) {
      return false;
    }
    return text.length <= 80 && !AI_LESSON_NUMBER_RE.test(text) && !isNonVideoCatalogItem(el);
  });
  const explicitHeaders = dedupeInnermostElements(rawExplicit);
  const explicitChapterCount = explicitHeaders.filter((el) =>
    CHAPTER_HEADER_RE.test(getNormalizedText(el))
  ).length;
  if (explicitHeaders.length > 0 && explicitChapterCount >= 2) {
    return explicitHeaders;
  }

  const satisfiesSemanticChapter = (el: HTMLElement): boolean => {
    if (
      isInsideHelperOrDialog(el) ||
      isInsideNavigationOrHeader(el) ||
      isElementOrAncestorHidden(el, doc)
    ) {
      return false;
    }
    if (isInsideVideoHeaderOrBreadcrumb(el)) return false;
    if (isNavigatingAwayLink(el, doc)) return false;
    const text = getNormalizedText(el);
    if (text.length < 2 || text.length > 120) return false;
    if (NAV_OR_HOME_ITEM_RE.test(text) || NAV_BACK_PREFIX_RE.test(text)) return false;
    if (!CHAPTER_HEADER_RE.test(text)) return false;
    if (/(?:^|\s)\d+\.\d+(?![\d.])\s*\S/.test(text)) return false;
    const chapterMatches = text.match(/第\s*[零〇一二两三四五六七八九十百千0-9]+\s*[章单元篇部分]/g);
    return (chapterMatches?.length ?? 0) <= 1;
  };

  const semanticRaw = Array.from(
    doc.querySelectorAll<HTMLElement>('div, li, header, button, a, p, h2, h3, h4, section')
  ).filter(satisfiesSemanticChapter);

  const promoted = semanticRaw.map((el) => {
    let cur = el;
    for (let hop = 0; hop < 2; hop++) {
      if (!CHAPTER_PREFIX_ONLY_RE.test(getNormalizedText(cur))) break;
      const parent = cur.parentElement;
      if (!parent || !satisfiesSemanticChapter(parent)) break;
      cur = parent;
    }
    return cur;
  });

  const semanticHeaders = dedupeInnermostElements(promoted);
  if (semanticHeaders.length > explicitChapterCount) {
    return semanticHeaders;
  }
  return explicitHeaders.length > 0 ? explicitHeaders : semanticHeaders;
};

/**
 * Discovers visible video lesson items in Zhihuishu new AI course sidebars
 */
export const findZhihuishuAiLessonItems = (doc: Document): HTMLElement[] => {
  if (!doc || typeof doc.querySelectorAll !== 'function') return [];

  const scopeSelector = [
    '.chapter-content',
    '[class*="chapter-content"]',
    '[class*="chapterContent"]',
    '.el-collapse',
    '.ant-collapse',
    '[class*="catalog"]',
    '[class*="catalogue"]',
    '[class*="chapter-list"]',
    '[class*="chapterList"]',
    '[class*="course-catalog"]',
    '[class*="courseCatalog"]',
    '[class*="outline"]',
    '[class*="directory"]'
  ].join(', ');

  const scopeRoots = Array.from(doc.querySelectorAll<HTMLElement>(scopeSelector)).filter(
    (el) =>
      typeof el.querySelectorAll === 'function' &&
      !isInsideHelperOrDialog(el) &&
      !isInsideNavigationOrHeader(el) &&
      !isElementOrAncestorHidden(el, doc)
  );
  const topScopes = scopeRoots.filter(
    (el, i, arr) =>
      !arr.some((other, j) => i !== j && typeof other.contains === 'function' && other.contains(el))
  );

  // Priority selector for wisdom-mooc.zhihuishu.com/study/index AI & fusion shared courses
  const wisdomMoocSelector =
    '.chapter-content-second, [class*="chapter-content-second"], .item-box';

  const explicitLessonSelector = [
    '.chapter-content-second',
    '.item-box',
    '.lesson-item',
    '.section-item',
    '.node-item',
    '.chapter-lesson',
    '.knowledge-item',
    '.point-item',
    '[class*="lesson-item"]',
    '[class*="lessonItem"]',
    '[class*="section-item"]',
    '[class*="sectionItem"]',
    '[class*="node-item"]',
    '[class*="nodeItem"]',
    '[class*="knowledge-item"]',
    '[class*="knowledgeItem"]',
    '[class*="video-node"]',
    '[class*="videoNode"]'
  ].join(', ');

  const isValidLessonCandidate = (el: HTMLElement): boolean => {
    if (
      isInsideHelperOrDialog(el) ||
      isInsideNavigationOrHeader(el) ||
      isElementOrAncestorHidden(el, doc)
    ) {
      return false;
    }
    if (isNavigatingAwayLink(el, doc)) return false;
    const text = getNormalizedText(el);
    if (text.length < 1 || text.length > 120) return false;
    if (CHAPTER_HEADER_RE.test(text) || isNonVideoCatalogItem(el)) return false;
    return true;
  };

  const scanRoot = (root: Document | HTMLElement): HTMLElement[] => {
    if (typeof root.querySelectorAll !== 'function') return [];

    const wisdomMoocLessons = dedupeInnermostElements(
      Array.from(root.querySelectorAll<HTMLElement>(wisdomMoocSelector)).filter((el) => {
        if (!isValidLessonCandidate(el)) return false;
        const cls = getElementClassString(el);
        if (/(?:^|\s)item-box(?:\s|$)/.test(cls)) {
          const inCatalog =
            typeof el.closest !== 'function' ||
            !!el.closest('.chapter-content, .chapter-item, .el-collapse-item, .course-catalog, .catalog-com');
          if (!inCatalog) return false;
        }
        return true;
      })
    );
    if (wisdomMoocLessons.length > 0) return wisdomMoocLessons;

    const explicit = dedupeInnermostElements(
      Array.from(root.querySelectorAll<HTMLElement>(explicitLessonSelector)).filter(isValidLessonCandidate)
    );
    if (explicit.length > 0) return explicit;

    const semanticCandidates = Array.from(
      root.querySelectorAll<HTMLElement>('li, div, a, button, p')
    ).filter((el) => {
      if (
        isInsideHelperOrDialog(el) ||
        isInsideNavigationOrHeader(el) ||
        isElementOrAncestorHidden(el, doc)
      ) {
        return false;
      }
      if (isInsideVideoHeaderOrBreadcrumb(el) || isNavigatingAwayLink(el, doc)) return false;
      const text = getNormalizedText(el);
      if (text.length < 2 || text.length > 100) return false;
      if (!AI_LESSON_NUMBER_RE.test(text) && !AI_LESSON_CN_RE.test(text)) return false;
      if (CHAPTER_HEADER_RE.test(text) || isNonVideoCatalogItem(el)) return false;
      const numTokens = text.match(/\d+(?:\.\d+)+/g);
      return (numTokens?.length ?? 0) <= 1;
    });

    const innermost = dedupeInnermostElements(semanticCandidates);
    const promoted = innermost.map((el) => {
      const tag = (el.tagName || '').toUpperCase();
      if ((tag === 'SPAN' || tag === 'P' || tag === 'DIV') && el.parentElement) {
        const parent = el.parentElement;
        const pTag = (parent.tagName || '').toUpperCase();
        const pCls = getElementClassString(parent);
        const elText = getNormalizedText(el);
        const pText = getNormalizedText(parent);
        const isContainerCls =
          /(?:collapse-item__content|chap[_-]?body|chapter[_-]?body|lesson[_-]?list|node[_-]?list)/i.test(
            pCls
          );
        const canPromoteByText =
          tag === 'SPAN' || tag === 'P'
            ? pText === elText || (pText.startsWith(elText) && hasSiblingIconOrControl(el, parent))
            : pText === elText && hasSiblingIconOrControl(el, parent);
        if (
          ['LI', 'DIV', 'A', 'BUTTON'].includes(pTag) &&
          !isContainerCls &&
          !isInsideHelperOrDialog(parent) &&
          !isInsideVideoHeaderOrBreadcrumb(parent) &&
          !CHAPTER_HEADER_RE.test(pText) &&
          !isNonVideoCatalogItem(parent) &&
          !/(?:测试|测验|作业|考试)\s*$/.test(pText) &&
          pText.length <= 100 &&
          (pText.match(/\d+(?:\.\d+)+/g)?.length ?? 0) <= 1 &&
          canPromoteByText
        ) {
          return parent;
        }
      }
      return el;
    });

    return dedupeInnermostElements(promoted);
  };

  if (topScopes.length > 0) {
    const scopedItems: HTMLElement[] = [];
    for (const scope of topScopes) {
      for (const item of scanRoot(scope)) {
        if (!scopedItems.includes(item)) scopedItems.push(item);
      }
    }
    if (scopedItems.length > 0) return scopedItems;
  }

  return scanRoot(doc);
};

const findCurrentZhihuishuPlayElement = (doc: Document): HTMLElement | null => {
  if (!doc || typeof doc.querySelector !== 'function') return null;
  const classic = doc.querySelector<HTMLElement>(
    '.current_play, .currentPlay, .active.video, .chapter-content-second.current'
  );
  if (classic) return classic;

  const aiItems = findZhihuishuAiLessonItems(doc);
  if (aiItems.length === 0) return null;
  const activeIdx = findActiveAiLessonIndex(aiItems, doc);
  return activeIdx >= 0 ? aiItems[activeIdx] : null;
};

/**
 * Finds the next unfinished Zhihuishu video item or next-lesson button
 */
export const findNextZhihuishuVideoItem = (doc: Document): HTMLElement | null => {
  if (!doc || typeof doc.querySelectorAll !== 'function') return null;

  const directNextButtons = Array.from(doc.querySelectorAll<HTMLElement>('.next_lesson, .next_button'));
  for (const btn of directNextButtons) {
    if (isSafeLessonClickTarget(btn, doc)) {
      return btn;
    }
  }

  const rawItems = Array.from(
    doc.querySelectorAll<HTMLElement>('.clearfix.video, li.video, .file-item, .catalog-item, .video-item')
  );
  const items = rawItems.filter(
    (item, i, arr) =>
      !isInsideHelperOrDialog(item) &&
      !isInsideNavigationOrHeader(item) &&
      !arr.some((other, j) => i !== j && item.contains(other))
  );
  if (items.length > 0) {
    const isItemFinished = (item: HTMLElement): boolean => {
      if (item.classList?.contains('finish') || item.classList?.contains('completed')) {
        return true;
      }
      const finishIcon = item.querySelector<HTMLElement>(
        '.time_icofinish, .fl.time_icofinish, .finish, .icon-finish, [class*="icofinish"]'
      );
      return !!finishIcon && !isElementOrAncestorHidden(finishIcon, doc);
    };

    const isCurrentItem = (item: HTMLElement): boolean =>
      item.classList?.contains('current_play') ||
      item.classList?.contains('currentPlay') ||
      item.classList?.contains('active') ||
      !!item.querySelector?.('.current_play, .currentPlay, .active');

    const getClickableTarget = (item: HTMLElement): HTMLElement | null => {
      const inner = item.querySelector<HTMLElement>('a, .catalogue_title, .file-name, .video-title, [onclick]');
      if (inner && isSafeLessonClickTarget(inner, doc)) return inner;
      return isSafeLessonClickTarget(item, doc) ? item : null;
    };

    const currentIndex = items.findIndex(isCurrentItem);
    if (currentIndex >= 0) {
      for (let i = currentIndex + 1; i < items.length; i++) {
        if (!isItemFinished(items[i])) {
          const target = getClickableTarget(items[i]);
          if (target) return target;
        }
      }
      for (let i = 0; i < currentIndex; i++) {
        if (!isItemFinished(items[i])) {
          const target = getClickableTarget(items[i]);
          if (target) return target;
        }
      }
      return null;
    }

    for (const item of items) {
      if (!isItemFinished(item)) {
        const target = getClickableTarget(item);
        if (target) return target;
      }
    }

    return null;
  }

  // Tier 2: Zhihuishu new AI course & wisdom-mooc fusion course sidebar lesson discovery
  syncSessionCourseScope(doc);
  const aiItems = findZhihuishuAiLessonItems(doc);
  if (aiItems.length === 0) return null;

  const getAiClickTarget = (item: HTMLElement): HTMLElement | null => {
    const inner =
      typeof item.querySelector === 'function' ? item.querySelector<HTMLElement>('a, [onclick]') : null;
    if (inner && isSafeLessonClickTarget(inner, doc)) return inner;
    return isSafeLessonClickTarget(item, doc) ? item : null;
  };

  const currentIndex = findActiveAiLessonIndex(aiItems, doc);
  if (currentIndex >= 0) {
    for (let i = currentIndex + 1; i < aiItems.length; i++) {
      if (!isAiLessonItemFinished(aiItems[i], doc)) {
        const target = getAiClickTarget(aiItems[i]);
        if (target) return target;
      }
    }
    for (let i = 0; i < currentIndex; i++) {
      const item = aiItems[i];
      const text = getNormalizedText(item);
      if (sessionCompletedLessonLabels.has(text)) continue;
      if (/(?:未完成|未学习|未开始|学习中|\b0%)/.test(text) && !isAiLessonItemFinished(item, doc)) {
        const target = getAiClickTarget(item);
        if (target) return target;
      }
    }
    return null;
  }

  for (const item of aiItems) {
    if (!isAiLessonItemFinished(item, doc)) {
      const target = getAiClickTarget(item);
      if (target) return target;
    }
  }

  return null;
};

/**
 * Finds the next unfinished Zhihuishu video, expanding collapsed chapter accordions when needed
 */
export const findOrExpandNextZhihuishuVideoItem = async (
  doc: Document,
  signal: AbortSignal,
  isCurrent: () => boolean,
  options?: { expandDelayMs?: number; maxChapterExpands?: number }
): Promise<HTMLElement | null> => {
  if (!doc || !isCurrent() || signal.aborted) return null;

  const direct = findNextZhihuishuVideoItem(doc);
  if (direct) return direct;

  const headers = findZhihuishuChapterHeaders(doc);
  if (headers.length === 0) return null;

  const findChapterWrapper = (header: HTMLElement): HTMLElement | null => {
    if (typeof header.closest === 'function') {
      const explicitWrap = header.closest<HTMLElement>(
        '.el-collapse-item, .ant-collapse-item, [class*="chapter-item"], [class*="chapterItem"], [class*="chapter-box"], [class*="chapterBox"], [class*="chapter-wrap"], [class*="unit-item"], li'
      );
      if (
        explicitWrap &&
        !headers.some(
          (other) => other !== header && typeof explicitWrap.contains === 'function' && explicitWrap.contains(other)
        )
      ) {
        return explicitWrap;
      }
    }
    const parent = header.parentElement;
    if (
      parent &&
      !headers.some(
        (other) => other !== header && typeof parent.contains === 'function' && parent.contains(other)
      )
    ) {
      return parent;
    }
    return null;
  };

  const getSiblingContent = (header: HTMLElement): HTMLElement | null => {
    const nextSib = (header as any).nextElementSibling as HTMLElement | undefined;
    if (!nextSib || headers.includes(nextSib)) return null;
    if (headers.some((other) => typeof nextSib.contains === 'function' && nextSib.contains(other))) {
      return null;
    }
    return nextSib;
  };

  const isChapterExpanded = (header: HTMLElement, visibleLessons: HTMLElement[]): boolean => {
    const ariaExp =
      typeof header.getAttribute === 'function' ? header.getAttribute('aria-expanded') : null;
    if (ariaExp === 'true') return true;
    if (ariaExp === 'false') return false;

    const wrapper = findChapterWrapper(header);
    const combinedCls = `${getElementClassString(header)} ${getElementClassString(wrapper)}`;
    if (EXPANDED_TOKEN_RE.test(combinedCls) && !COLLAPSED_TOKEN_RE.test(combinedCls)) {
      return true;
    }

    if (wrapper && wrapper !== header && typeof wrapper.contains === 'function') {
      const hasVisibleLesson = visibleLessons.some(
        (lesson) => wrapper.contains(lesson) && !isElementOrAncestorHidden(lesson, doc)
      );
      if (hasVisibleLesson) return true;
    }

    const nextSib = getSiblingContent(header);
    if (nextSib && typeof nextSib.contains === 'function') {
      const hasVisibleLesson = visibleLessons.some(
        (lesson) => nextSib.contains(lesson) && !isElementOrAncestorHidden(lesson, doc)
      );
      if (hasVisibleLesson) return true;
    }

    return false;
  };

  const currentAiLessons = findZhihuishuAiLessonItems(doc);
  const activeLesson = findCurrentZhihuishuPlayElement(doc);

  let currentChapterIndex = -1;
  if (activeLesson) {
    currentChapterIndex = headers.findIndex((header) => {
      const wrapper = findChapterWrapper(header);
      if (wrapper && typeof wrapper.contains === 'function' && wrapper.contains(activeLesson)) {
        return true;
      }
      const nextSib = getSiblingContent(header);
      return !!(nextSib && typeof nextSib.contains === 'function' && nextSib.contains(activeLesson));
    });

    if (currentChapterIndex === -1) {
      const activeText = getNormalizedText(activeLesson);
      const numMatch = activeText.match(/^\s*(\d+)\.\d+/);
      if (numMatch) {
        const chapterNum = Number(numMatch[1]);
        currentChapterIndex = headers.findIndex(
          (header) => extractChapterHeaderNumber(getNormalizedText(header)) === chapterNum
        );
      }
    }
  }

  if (currentChapterIndex === -1) {
    for (let i = headers.length - 1; i >= 0; i--) {
      if (isChapterExpanded(headers[i], currentAiLessons)) {
        currentChapterIndex = i;
        break;
      }
    }
  }

  const startIdx = currentChapterIndex >= 0 ? currentChapterIndex + 1 : 0;
  const maxExpands = options?.maxChapterExpands ?? 20;
  const hasExplicitDelay = options?.expandDelayMs !== undefined;
  const expandDelayMs = hasExplicitDelay ? options!.expandDelayMs! : Math.round(1800 + Math.random() * 800);
  let expandsDone = 0;

  for (let i = startIdx; i < headers.length && expandsDone < maxExpands; i++) {
    if (!isCurrent() || signal.aborted) return null;
    if (findVisibleZhihuishuCaptchaDialog(doc)) return null;

    const header = headers[i];
    if (isChapterExpanded(header, findZhihuishuAiLessonItems(doc))) {
      continue;
    }

    const beforeSet = new Set(findZhihuishuAiLessonItems(doc));
    const headerTitle = getNormalizedText(header) || `第 ${i + 1} 章`;
    store.addLog(`当前章节已学完，正在展开下一章【${headerTitle}】...`, 'info');

    expandsDone++;
    header.click();

    const findExpandedCandidate = (): HTMLElement | null => {
      const nextAfterExpand = findNextZhihuishuVideoItem(doc);
      if (nextAfterExpand) return nextAfterExpand;

      const afterItems = findZhihuishuAiLessonItems(doc);
      const newlyAppeared = afterItems.filter((el) => !beforeSet.has(el));
      for (const item of newlyAppeared) {
        if (!isAiLessonItemFinished(item, doc)) {
          const innerTarget =
            typeof item.querySelector === 'function'
              ? item.querySelector<HTMLElement>('a, [onclick]')
              : null;
          if (innerTarget && isSafeLessonClickTarget(innerTarget, doc)) {
            return innerTarget;
          }
          if (isSafeLessonClickTarget(item, doc)) {
            return item;
          }
        }
      }
      return null;
    };

    const stepMs = hasExplicitDelay ? Math.max(10, expandDelayMs) : 300;
    const minWaitMs = hasExplicitDelay ? expandDelayMs : Math.min(expandDelayMs, 700);
    let waited = 0;
    while (waited < expandDelayMs) {
      const chunk = Math.min(stepMs, expandDelayMs - waited);
      try {
        await sleep(chunk, signal);
      } catch {
        return null;
      }
      waited += chunk;
      if (!isCurrent() || signal.aborted) return null;
      if (findVisibleZhihuishuCaptchaDialog(doc)) return null;

      if (waited >= minWaitMs) {
        const candidate = findExpandedCandidate();
        if (candidate) return candidate;
      }
    }

    const finalCandidate = findExpandedCandidate();
    if (finalCandidate) return finalCandidate;
  }

  return null;
};

/**
 * Handles Zhihuishu H5 video playback at strict 1.0x muted speed, popup quizzes, and chapter progression
 */
export const playZhihuishuVideoTask = async (
  doc: Document,
  context: IframeContext,
  options?: {
    pollIntervalMs?: number;
    switchWaitTimeoutMs?: number;
    chapterExpandDelayMs?: number;
    popupTiming?: { reactionDelayMs?: number; closeDelayMs?: number; verifyCloseDelayMs?: number };
  }
): Promise<void> => {
  return new Promise<void>((resolve) => {
    store.addLog('检测到智慧树视频课程页面，正在初始化播放任务', 'info');

    const initialUrl =
      (doc as any)?.location?.href ??
      (typeof window !== 'undefined' ? window.location?.href || '' : '');
    const hasHostContext = Boolean(initialUrl);

    let settled = false;
    let isStarted = false;
    let isSolvingPopup = false;
    let isHandlingFinish = false;
    let isRecoveringPause = false;
    let isWaitingForCaptcha = false;
    let captchaTitleTimer: ReturnType<typeof setInterval> | null = null;
    let savedDocTitle: string | null = null;
    let startedActiveEl: HTMLElement | null = null;
    let startedIconFingerprint = '';
    let videoElement: HTMLVideoElement | null = null;
    let checkInterval: ReturnType<typeof setInterval>;

    const restoreCaptchaTitle = () => {
      if (captchaTitleTimer) {
        clearInterval(captchaTitleTimer);
        captchaTitleTimer = null;
      }
      if (savedDocTitle !== null) {
        try {
          if (typeof (doc as any).title === 'string') {
            (doc as any).title = savedDocTitle;
          }
        } catch {}
        savedDocTitle = null;
      }
    };

    const enterCaptchaWait = () => {
      if (isWaitingForCaptcha) return;
      isWaitingForCaptcha = true;
      const lessonTitle = getLessonTitle();
      store.updateProgress({
        title: lessonTitle,
        status: 'paused',
        currentTime: '等待安全验证'
      });
      store.addLog(
        '检测到智慧树【请完成安全验证】弹窗，已自动暂停挂机以防风控跳回主页；请手动完成验证，通过后将自动继续播放！',
        'error'
      );
      try {
        if (typeof (doc as any).title === 'string') {
          if (savedDocTitle === null) {
            savedDocTitle = (doc as any).title;
          }
          const baseTitle = savedDocTitle;
          let flashFlag = false;
          (doc as any).title = `【请完成安全验证】${baseTitle}`;
          if (captchaTitleTimer) clearInterval(captchaTitleTimer);
          captchaTitleTimer = globalThis.setInterval(() => {
            flashFlag = !flashFlag;
            try {
              (doc as any).title = flashFlag
                ? `【刷课已暂停】${baseTitle}`
                : `【请完成安全验证】${baseTitle}`;
            } catch {}
          }, 1000);
        }
      } catch {}
      notifyUserCaptchaRequired(lessonTitle);
    };

    const exitCaptchaWait = async () => {
      if (!isWaitingForCaptcha) return;
      isWaitingForCaptcha = false;
      restoreCaptchaTitle();
      store.addLog('安全验证弹窗已关闭，正在自动恢复 1.0x 原速播放...', 'success');

      if (
        !settled &&
        !isHandlingFinish &&
        context.isCurrent() &&
        !context.signal.aborted &&
        videoElement &&
        videoElement.paused &&
        !isCurrentVideoFinished()
      ) {
        try {
          videoElement.playbackRate = 1.0;
          videoElement.muted = true;
          await videoElement.play();
          if (!settled) {
            store.updateProgress({ status: 'playing' });
          }
        } catch (err) {
          store.addLog(`安全验证通过后恢复播放失败，将在下次轮询重试: ${String(err)}`, 'warning');
        }
      }
    };

    const popupAttemptMap = new WeakMap<HTMLElement, number>();
    const popupSigAttempts = new Map<string, number>();
    let trippedPopupSig: string | null = null;

    const formatTime = (secs: number): string => {
      if (!secs || isNaN(secs)) return '00:00';
      const m = Math.floor(secs / 60).toString().padStart(2, '0');
      const s = Math.floor(secs % 60).toString().padStart(2, '0');
      return `${m}:${s}`;
    };

    const getLessonTitle = (): string => {
      const titleEl = doc.querySelector<HTMLElement>(
        '.current_play .catalogue_title, #lessonOrder, .source-name, .video-title'
      );
      const explicitTitle = (titleEl?.innerText || titleEl?.textContent || '').trim();
      if (explicitTitle) return explicitTitle;
      const activeEl = findCurrentZhihuishuPlayElement(doc);
      const activeTitle = getNormalizedText(activeEl);
      return activeTitle || '智慧树视频课程';
    };

    const isCurrentVideoFinished = (): boolean => {
      if (findVisibleZhihuishuCaptchaDialog(doc) || findVisiblePopupTestDialog(doc)) {
        return false;
      }
      const currentPlay = doc.querySelector<HTMLElement>('.current_play, .currentPlay');
      if (currentPlay && typeof currentPlay.querySelector === 'function') {
        const finishIcon = currentPlay.querySelector<HTMLElement>(
          '.finish-icon, .time_icofinish, .fl.time_icofinish, .finish, .icon-finish, [class*="icofinish"], [class*="finish-icon"]'
        );
        if (finishIcon && !isElementOrAncestorHidden(finishIcon, doc)) {
          return true;
        }
      }
      const activeEl = findCurrentZhihuishuPlayElement(doc);
      if (activeEl) {
        if (isAiLessonItemFinished(activeEl, doc, { ignoreSessionCache: true })) {
          return true;
        }
        if (
          startedActiveEl === activeEl &&
          startedIconFingerprint &&
          videoElement &&
          videoElement.duration > 0 &&
          videoElement.currentTime / videoElement.duration >= 0.8
        ) {
          const curFingerprint = getLessonIconFingerprint(activeEl);
          if (curFingerprint && curFingerprint !== startedIconFingerprint) {
            return true;
          }
        }
      }
      if (videoElement) {
        if (videoElement.ended) return true;
        if (videoElement.duration > 0 && videoElement.currentTime >= videoElement.duration - 1) {
          return true;
        }
      }
      return false;
    };

    const onTimeUpdate = () => {
      if (settled || isHandlingFinish) return;
      if (!videoElement) return;
      const cur = videoElement.currentTime || 0;
      const dur = videoElement.duration || 0;
      const pct = dur > 0 ? Math.min(100, (cur / dur) * 100) : 0;
      store.updateProgress({
        title: getLessonTitle(),
        percent: Math.round(pct * 10) / 10,
        currentTime: formatTime(cur),
        duration: formatTime(dur),
        status: videoElement.paused ? 'paused' : 'playing'
      });
    };

    const detachVideoListeners = (vid: HTMLVideoElement | null) => {
      if (!vid) return;
      vid.removeEventListener('timeupdate', onTimeUpdate);
      vid.removeEventListener('pause', onPause);
      vid.removeEventListener('ended', onEnded);
    };

    const cleanup = () => {
      clearInterval(checkInterval);
      restoreCaptchaTitle();
      detachVideoListeners(videoElement);
      context.signal.removeEventListener('abort', onAbort);
    };

    const finish = (pauseVideo = false) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (pauseVideo) {
        try {
          videoElement?.pause();
        } catch {
          // ignore
        }
      }
      resolve();
    };

    const onAbort = () => {
      finish(true);
    };

    const handleVideoFinished = async () => {
      if (settled || isHandlingFinish) return;
      isHandlingFinish = true;
      clearInterval(checkInterval);

      const prevCurrentPlayEl = findCurrentZhihuishuPlayElement(doc);
      const prevLessonTitle = getLessonTitle();
      const prevSrc = videoElement?.currentSrc || videoElement?.src || '';
      const prevCurrentTime = videoElement?.currentTime || 0;
      const prevWasFinishedPlayback = Boolean(
        videoElement &&
          (videoElement.ended ||
            (videoElement.duration > 0 && videoElement.currentTime >= videoElement.duration - 1))
      );

      store.updateProgress({
        title: prevLessonTitle,
        percent: 100,
        status: 'finished'
      });

      const completedKey = getZhihuishuLessonKey(doc, videoElement);
      recordSessionCompletedLesson(doc, prevLessonTitle);

      if (store.config.autoNextChapter && context.isCurrent() && !context.signal.aborted) {
        const nextItem = await findOrExpandNextZhihuishuVideoItem(
          doc,
          context.signal,
          context.isCurrent,
          { expandDelayMs: options?.chapterExpandDelayMs }
        );
        if (settled || !context.isCurrent() || context.signal.aborted) {
          return finish();
        }

        if (nextItem) {
          const delayMs = getHumanJitterDelay(
            store.config.randomDelayBase,
            store.config.randomDelayJitter
          );
          store.addLog(`智慧树当前视频已学完，将在 ${(delayMs / 1000).toFixed(1)} 秒后进入下一节`, 'info');
          try {
            await sleep(delayMs, context.signal);
          } catch {
            return finish();
          }
          if (!settled && context.isCurrent() && !context.signal.aborted) {
            if (findVisibleZhihuishuCaptchaDialog(doc)) {
              enterCaptchaWait();
              return finish();
            }
            if (!isSafeLessonClickTarget(nextItem, doc)) {
              zhihuishuSwitchCooldownUntil = Date.now() + 5000;
              store.addLog('检测到待点击切集目标为导航/返回元素，已自动拦截以防跳回主界面', 'warning');
              return finish();
            }
            try {
              videoElement?.pause();
            } catch {
              // ignore
            }
            const nextLabel = getNormalizedText(nextItem).slice(0, 40);
            store.addLog(
              nextLabel ? `触发智慧树下一节视频切换：【${nextLabel}】` : '触发智慧树下一节视频切换',
              'success'
            );
            nextItem.click();

            const switchWaitTimeoutMs = options?.switchWaitTimeoutMs ?? 4000;
            const pollStepMs = Math.min(250, Math.max(20, switchWaitTimeoutMs));
            const isLessonSwitched = (): boolean => {
              const curPlay = findCurrentZhihuishuPlayElement(doc);
              const curTitle = getLessonTitle();
              const curVid = doc.querySelector<HTMLVideoElement>(
                '#vjs_container_html5_api, video.vjs-tech, .videoArea video, video'
              );
              const curSrc = curVid?.currentSrc || curVid?.src || '';

              const curPlayHasFinishIcon = curPlay ? isAiLessonItemFinished(curPlay, doc) : false;

              const playNodeChanged =
                !!prevCurrentPlayEl &&
                !!curPlay &&
                curPlay !== prevCurrentPlayEl &&
                !curPlayHasFinishIcon;
              const titleChanged =
                !!curTitle && curTitle !== prevLessonTitle && !curPlayHasFinishIcon;
              const srcChanged = !!curSrc && curSrc !== prevSrc;
              const sameVideoRestarted =
                prevWasFinishedPlayback &&
                !!curVid &&
                !curVid.ended &&
                curVid.duration > 0 &&
                curVid.currentTime < Math.min(5, curVid.duration - 2) &&
                curVid.currentTime < prevCurrentTime - 2;
              const videoReset =
                !!curVid &&
                !curVid.ended &&
                (curVid !== videoElement ||
                  srcChanged ||
                  sameVideoRestarted ||
                  (curVid.duration > 0 && curVid.currentTime < curVid.duration - 2));

              if (playNodeChanged) {
                return !curVid || !curVid.ended || videoReset;
              }
              if (titleChanged || srcChanged || sameVideoRestarted) {
                return !curVid || videoReset;
              }
              return !!curVid && curVid !== videoElement && !curVid.ended;
            };

            let switched = isLessonSwitched();
            for (
              let waited = 0;
              !switched && waited < switchWaitTimeoutMs && !settled && context.isCurrent() && !context.signal.aborted;
              waited += pollStepMs
            ) {
              try {
                await sleep(pollStepMs, context.signal);
              } catch {
                return finish();
              }
              switched = isLessonSwitched();
            }

            if (switched) {
              lastCompletedLessonKey = null;
              zhihuishuSwitchCooldownUntil = 0;
            } else {
              zhihuishuSwitchCooldownUntil = Date.now() + 5000;
              store.addLog('智慧树切集等待超时，已进入短时防连跳冷却', 'warning');
            }
          }
        } else {
          lastCompletedLessonKey = completedKey;
          store.addLog('智慧树目录中未发现更多未完成视频', 'success');
        }
      } else {
        lastCompletedLessonKey = completedKey;
        store.addLog('智慧树当前视频已播放完成', 'success');
      }

      finish();
    };

    const onPause = async () => {
      if (settled || !context.isCurrent()) {
        return finish(true);
      }
      if (findVisibleZhihuishuCaptchaDialog(doc) || isWaitingForCaptcha) {
        enterCaptchaWait();
        return;
      }
      if (isHandlingFinish || isCurrentVideoFinished() || isRecoveringPause) {
        return;
      }
      if (findVisiblePopupTestDialog(doc) || isSolvingPopup) {
        store.updateProgress({ status: 'paused' });
        store.addLog('检测到智慧树随堂弹题暂停，交由自动答题逻辑处理', 'info');
        return;
      }

      isRecoveringPause = true;
      try {
        const jitterDelay = getHumanJitterDelay(
          store.config.randomDelayBase,
          store.config.randomDelayJitter
        );
        store.updateProgress({ status: 'paused' });
        store.addLog(`检测到智慧树视频被暂停，将在 ${(jitterDelay / 1000).toFixed(1)} 秒后自动恢复播放`, 'warning');

        try {
          await sleep(jitterDelay, context.signal);
        } catch {
          return finish(true);
        }

        if (settled || !context.isCurrent()) {
          return finish(true);
        }

        if (findVisibleZhihuishuCaptchaDialog(doc) || isWaitingForCaptcha) {
          enterCaptchaWait();
          return;
        }

        if (
          isHandlingFinish ||
          isCurrentVideoFinished() ||
          !videoElement ||
          !videoElement.paused ||
          findVisiblePopupTestDialog(doc) ||
          isSolvingPopup
        ) {
          return;
        }

        dismissZhihuishuTipDialog(doc);

        try {
          videoElement.playbackRate = 1.0;
          videoElement.muted = true;
          await videoElement.play();
          if (!settled) {
            store.updateProgress({ status: 'playing' });
          }
        } catch (err) {
          store.addLog(`智慧树视频恢复播放失败: ${String(err)}`, 'warning');
        }
      } finally {
        isRecoveringPause = false;
      }
    };

    const onEnded = () => {
      if (!settled && context.isCurrent()) {
        if (findVisibleZhihuishuCaptchaDialog(doc) || isWaitingForCaptcha) {
          enterCaptchaWait();
          return;
        }
        store.addLog('智慧树视频播放结束', 'info');
        void handleVideoFinished();
      }
    };

    context.signal.addEventListener('abort', onAbort, { once: true });

    const pollIntervalMs = options?.pollIntervalMs ?? 2000;
    checkInterval = globalThis.setInterval(async () => {
      try {
        if (settled || isHandlingFinish) return;

        if (!context.isCurrent() || context.signal.aborted) {
          return finish(true);
        }

        if (hasHostContext && !isZhihuishuVideoPage(doc)) {
          return finish(true);
        }

        // Rebind if SPA replaced the <video> element in-place
        if (isStarted && videoElement && videoElement.isConnected === false) {
          detachVideoListeners(videoElement);
          videoElement = null;
          isStarted = false;
        }

        if (isSolvingPopup) return;

        const captchaDialog = findVisibleZhihuishuCaptchaDialog(doc);
        if (captchaDialog) {
          enterCaptchaWait();
          return;
        }
        if (isWaitingForCaptcha) {
          await exitCaptchaWait();
          return;
        }

        dismissZhihuishuTipDialog(doc);

        const visibleDialog = findVisiblePopupTestDialog(doc);
        if (visibleDialog) {
          const dialogSig = getPopupDialogSignature(visibleDialog, doc);
          const elAttempts = popupAttemptMap.get(visibleDialog) ?? 0;
          const sigAttempts = dialogSig ? (popupSigAttempts.get(dialogSig) ?? 0) : 0;
          const currentAttempts = Math.max(elAttempts, sigAttempts);

          if (currentAttempts >= 2) {
            if (trippedPopupSig !== dialogSig) {
              trippedPopupSig = dialogSig;
              store.addLog(
                '智慧树随堂弹题未能自动关闭，已停止重试以防异常，请手动关闭弹窗',
                'error'
              );
            }
            return;
          }

          popupAttemptMap.set(visibleDialog, elAttempts + 1);
          if (dialogSig) {
            popupSigAttempts.set(dialogSig, sigAttempts + 1);
          }

          isSolvingPopup = true;
          try {
            const solved = await solveZhihuishuPopupTest(
              doc,
              context.signal,
              context.isCurrent,
              options?.popupTiming
            );
            if (solved) {
              popupAttemptMap.delete(visibleDialog);
              if (dialogSig) popupSigAttempts.delete(dialogSig);
              trippedPopupSig = null;

              if (
                !settled &&
                !isHandlingFinish &&
                context.isCurrent() &&
                !context.signal.aborted &&
                videoElement &&
                videoElement.paused &&
                !isCurrentVideoFinished()
              ) {
                try {
                  videoElement.playbackRate = 1.0;
                  videoElement.muted = true;
                  await videoElement.play();
                  if (!settled) {
                    store.updateProgress({ status: 'playing' });
                    store.addLog('智慧树弹题处理完毕，已恢复 1.0x 原速播放', 'success');
                  }
                } catch (err) {
                  store.addLog(`弹题关闭后恢复播放失败: ${String(err)}`, 'warning');
                }
              }
            } else {
              const stillVisible = findVisiblePopupTestDialog(doc);
              if (stillVisible) {
                const updatedAttempts = Math.max(
                  popupAttemptMap.get(stillVisible) ?? 0,
                  dialogSig ? (popupSigAttempts.get(dialogSig) ?? 0) : 0
                );
                if (updatedAttempts >= 2 && trippedPopupSig !== dialogSig) {
                  trippedPopupSig = dialogSig;
                  store.addLog(
                    '智慧树随堂弹题未能自动关闭，已停止重试以防异常，请手动关闭弹窗',
                    'error'
                  );
                }
              }
            }
          } finally {
            isSolvingPopup = false;
          }
          return;
        } else if (popupSigAttempts.size > 0 || trippedPopupSig !== null) {
          popupSigAttempts.clear();
          trippedPopupSig = null;
        }

        if (isCurrentVideoFinished()) {
          void handleVideoFinished();
          return;
        }

        if (!isStarted) {
          videoElement = doc.querySelector<HTMLVideoElement>(
            '#vjs_container_html5_api, video.vjs-tech, .videoArea video, video'
          );
          if (videoElement) {
            if (isCurrentVideoFinished()) {
              void handleVideoFinished();
              return;
            }

            isStarted = true;
            lastCompletedLessonKey = null;
            startedActiveEl = findCurrentZhihuishuPlayElement(doc);
            startedIconFingerprint = getLessonIconFingerprint(startedActiveEl);
            try {
              // Strictly enforce 1.0x original playback rate and muted autoplay
              videoElement.playbackRate = 1.0;
              videoElement.muted = true;

              videoElement.addEventListener('timeupdate', onTimeUpdate);
              videoElement.addEventListener('pause', onPause);
              videoElement.addEventListener('ended', onEnded);

              store.addLog('启动智慧树 1.0x 原速静音播放', 'info');
              await videoElement.play();
              if (settled || !context.isCurrent() || context.signal.aborted) {
                return finish(true);
              }
              onTimeUpdate();
            } catch (err) {
              detachVideoListeners(videoElement);
              if (!settled) {
                store.addLog(`智慧树自动播放受限，将在下次轮询重试: ${String(err)}`, 'warning');
                isStarted = false;
              }
            }
          }
        }
      } catch (err) {
        store.addLog(`智慧树视频轮询异常: ${String(err)}`, 'warning');
        finish(true);
      }
    }, pollIntervalMs);

    if (!context.isCurrent() || context.signal.aborted) {
      finish(true);
    }
  });
};
