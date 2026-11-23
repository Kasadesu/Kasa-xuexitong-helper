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

export const getZhihuishuSwitchCooldownUntil = (): number => zhihuishuSwitchCooldownUntil;

export const getLastCompletedZhihuishuLessonKey = (): string | null => lastCompletedLessonKey;

export const clearZhihuishuCompletionSuppression = (): void => {
  lastCompletedLessonKey = null;
  zhihuishuSwitchCooldownUntil = 0;
};

/**
 * Computes a stable identifier for the currently active Zhihuishu lesson item
 */
export const getZhihuishuLessonKey = (
  doc: Document,
  videoEl?: HTMLVideoElement | null
): string => {
  const currentPlayEl =
    typeof doc?.querySelector === 'function'
      ? doc.querySelector<HTMLElement>('.current_play, .currentPlay, .active.video')
      : null;
  const titleEl =
    typeof doc?.querySelector === 'function'
      ? doc.querySelector<HTMLElement>(
          '.current_play .catalogue_title, #lessonOrder, .source-name, .video-title'
        )
      : null;
  const labelText = (
    titleEl?.innerText ||
    titleEl?.textContent ||
    currentPlayEl?.innerText ||
    currentPlayEl?.textContent ||
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
  const href =
    (doc as any)?.location?.href ??
    (typeof window !== 'undefined' ? window.location?.href || '' : '');
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

  if (/(?:studyvideoh5|studyh5|fusioncourseh5|videoStudy|liveCourse)/i.test(targetUrl)) {
    return true;
  }

  const targetDoc = doc ?? (typeof document !== 'undefined' ? document : undefined);
  if (targetDoc && typeof targetDoc.querySelector === 'function') {
    return !!targetDoc.querySelector(
      '#vjs_container_html5_api, video.vjs-tech, .videoArea video, .clearfix.video, .current_play'
    );
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
 * Dismisses lightweight Zhihuishu tip/guidance dialogs (e.g. "videoConfigTip01" with "好的")
 */
export const dismissZhihuishuTipDialog = (doc: Document): boolean => {
  if (!doc || typeof doc.querySelectorAll !== 'function') return false;

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

/**
 * Finds the next unfinished Zhihuishu video item or next-lesson button
 */
export const findNextZhihuishuVideoItem = (doc: Document): HTMLElement | null => {
  if (!doc || typeof doc.querySelectorAll !== 'function') return null;

  const directNextButtons = Array.from(doc.querySelectorAll<HTMLElement>('.next_lesson, .next_button'));
  for (const btn of directNextButtons) {
    if (!isControlDisabled(btn) && !isElementOrAncestorHidden(btn, doc)) {
      return btn;
    }
  }

  const rawItems = Array.from(
    doc.querySelectorAll<HTMLElement>('.clearfix.video, li.video, .file-item, .catalog-item, .video-item')
  );
  const items = rawItems.filter(
    (item, i, arr) => !arr.some((other, j) => i !== j && item.contains(other))
  );
  if (items.length === 0) return null;

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

  const getClickableTarget = (item: HTMLElement): HTMLElement =>
    item.querySelector<HTMLElement>('a, .catalogue_title, .file-name, .video-title, [onclick]') || item;

  const currentIndex = items.findIndex(isCurrentItem);
  if (currentIndex >= 0) {
    for (let i = currentIndex + 1; i < items.length; i++) {
      if (!isItemFinished(items[i])) {
        return getClickableTarget(items[i]);
      }
    }
    for (let i = 0; i < currentIndex; i++) {
      if (!isItemFinished(items[i])) {
        return getClickableTarget(items[i]);
      }
    }
    return null;
  }

  for (const item of items) {
    if (!isItemFinished(item)) {
      return getClickableTarget(item);
    }
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
    let videoElement: HTMLVideoElement | null = null;
    let checkInterval: ReturnType<typeof setInterval>;

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
      return (titleEl?.innerText || titleEl?.textContent || '').trim() || '智慧树视频课程';
    };

    const isCurrentVideoFinished = (): boolean => {
      const currentPlay = doc.querySelector<HTMLElement>('.current_play, .currentPlay');
      if (currentPlay && typeof currentPlay.querySelector === 'function') {
        const finishIcon = currentPlay.querySelector<HTMLElement>(
          '.time_icofinish, .fl.time_icofinish, .finish, .icon-finish, [class*="icofinish"]'
        );
        if (finishIcon && !isElementOrAncestorHidden(finishIcon, doc)) {
          return true;
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
      store.updateProgress({
        title: getLessonTitle(),
        percent: 100,
        status: 'finished'
      });

      const completedKey = getZhihuishuLessonKey(doc, videoElement);

      if (store.config.autoNextChapter && context.isCurrent() && !context.signal.aborted) {
        const nextItem = findNextZhihuishuVideoItem(doc);
        if (nextItem) {
          const prevCurrentPlayEl = doc.querySelector<HTMLElement>(
            '.current_play, .currentPlay, .active.video'
          );
          const prevLessonTitle = getLessonTitle();
          const prevSrc = videoElement?.currentSrc || videoElement?.src || '';

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
            try {
              videoElement?.pause();
            } catch {
              // ignore
            }
            store.addLog('触发智慧树下一节视频切换', 'success');
            nextItem.click();

            const switchWaitTimeoutMs = options?.switchWaitTimeoutMs ?? 4000;
            const pollStepMs = Math.min(250, Math.max(20, switchWaitTimeoutMs));
            const isLessonSwitched = (): boolean => {
              const curPlay = doc.querySelector<HTMLElement>(
                '.current_play, .currentPlay, .active.video'
              );
              const curTitle = getLessonTitle();
              const curVid = doc.querySelector<HTMLVideoElement>(
                '#vjs_container_html5_api, video.vjs-tech, .videoArea video, video'
              );
              const curSrc = curVid?.currentSrc || curVid?.src || '';

              const curPlayHasFinishIcon = (() => {
                if (!curPlay || typeof curPlay.querySelector !== 'function') return false;
                const finishIcon = curPlay.querySelector<HTMLElement>(
                  '.time_icofinish, .fl.time_icofinish, .finish, .icon-finish, [class*="icofinish"]'
                );
                return !!finishIcon && !isElementOrAncestorHidden(finishIcon, doc);
              })();

              const playNodeChanged =
                !!prevCurrentPlayEl &&
                !!curPlay &&
                curPlay !== prevCurrentPlayEl &&
                !curPlayHasFinishIcon;
              const titleChanged =
                !!curTitle && curTitle !== prevLessonTitle && !curPlayHasFinishIcon;
              const srcChanged = !!curSrc && curSrc !== prevSrc;
              const videoReset =
                !!curVid &&
                !curVid.ended &&
                (curVid !== videoElement ||
                  srcChanged ||
                  (curVid.duration > 0 && curVid.currentTime < curVid.duration - 2));

              if (playNodeChanged) {
                return !curVid || !curVid.ended || videoReset;
              }
              if (titleChanged || srcChanged) {
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
