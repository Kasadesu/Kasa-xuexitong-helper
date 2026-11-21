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
    if (typeof el.closest === 'function' && el.closest('.dialog-test, .el-dialog__wrapper')) {
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
 * Finds a currently visible Zhihuishu in-video popup quiz dialog
 */
export const findVisiblePopupTestDialog = (doc: Document): HTMLElement | null => {
  if (!doc || typeof doc.querySelectorAll !== 'function') return null;

  const primaryCandidates = Array.from(
    doc.querySelectorAll<HTMLElement>('.dialog-test, .el-dialog__wrapper.dialog-test, [class*="dialog-test"]')
  );
  for (const el of primaryCandidates) {
    if (typeof el.closest === 'function' && el.closest('kasa-helper-panel, .kasa-card')) {
      continue;
    }
    if (!isElementOrAncestorHidden(el, doc)) {
      return el;
    }
  }

  const wrapperCandidates = Array.from(doc.querySelectorAll<HTMLElement>('.el-dialog__wrapper'));
  for (const wrapper of wrapperCandidates) {
    if (typeof wrapper.closest === 'function' && wrapper.closest('kasa-helper-panel, .kasa-card')) {
      continue;
    }
    if (isElementOrAncestorHidden(wrapper, doc)) {
      continue;
    }
    if (wrapper.querySelector('.topic-item, .topic-title, .topic-list')) {
      return wrapper;
    }
  }

  return null;
};

const isPopupOptionSelected = (el: HTMLElement): boolean => {
  if (
    el.classList?.contains('active') ||
    el.classList?.contains('is-checked') ||
    el.classList?.contains('selected') ||
    el.getAttribute?.('aria-checked') === 'true'
  ) {
    return true;
  }
  return !!el.querySelector?.('.active, .is-checked, .selected, input:checked');
};

const isControlDisabled = (el: HTMLElement): boolean =>
  (el as HTMLButtonElement).disabled === true ||
  (typeof el.hasAttribute === 'function' && el.hasAttribute('disabled')) ||
  el.classList?.contains('disabled') === true ||
  el.classList?.contains('is-disabled') === true ||
  (typeof el.getAttribute === 'function' && el.getAttribute('aria-disabled') === 'true');

const findPopupCloseButton = (dialog: HTMLElement, doc: Document): HTMLElement | null => {
  const allButtons = Array.from(
    dialog.querySelectorAll<HTMLElement>(
      'button, a, .btn, [role="button"], .el-dialog__headerbtn, .close-btn, [class*="close"]'
    )
  );

  for (const btn of allButtons) {
    if (isControlDisabled(btn) || isElementOrAncestorHidden(btn, doc)) continue;
    const text = (btn.innerText || btn.textContent || '').replace(/\s+/g, '');
    if (
      text.includes('关闭') ||
      text.includes('确定') ||
      text.includes('完成') ||
      text.includes('提交') ||
      text.includes('我知道了')
    ) {
      return btn;
    }
  }

  const fallbackButtons = Array.from(
    dialog.querySelectorAll<HTMLElement>(
      '.dialog-footer .el-button--primary, .dialog-footer .btn, .btn, .el-dialog__headerbtn, .close-btn, [class*="close"]'
    )
  );
  for (const btn of fallbackButtons) {
    if (isControlDisabled(btn) || isElementOrAncestorHidden(btn, doc)) continue;
    return btn;
  }

  return null;
};

const findVisiblePopupTitleElement = (dialog: HTMLElement, doc: Document): HTMLElement | null => {
  const titleSelector = '.topic-title, .question-title, .title, .subject_describe';
  const rawCandidates =
    typeof dialog.querySelectorAll === 'function'
      ? Array.from(dialog.querySelectorAll<HTMLElement>(titleSelector))
      : [];
  if (rawCandidates.length > 0) {
    return rawCandidates.find((el) => !isElementOrAncestorHidden(el, doc)) ?? null;
  }
  if (typeof dialog.querySelector === 'function') {
    const single = dialog.querySelector<HTMLElement>(titleSelector);
    if (single && !isElementOrAncestorHidden(single, doc)) {
      return single;
    }
  }
  return null;
};

const getPopupDialogSignature = (dialog: HTMLElement, doc: Document): string => {
  const titleEl = findVisiblePopupTitleElement(dialog, doc);
  const titleText = (titleEl?.innerText || titleEl?.textContent || '').trim().slice(0, 80);
  const fallbackText = (dialog.innerText || dialog.textContent || '').trim().slice(0, 80);
  return titleText || fallbackText || 'popup-dialog';
};

const parsePopupOptions = (dialog: HTMLElement, doc: Document): ParsedOptionItem[] => {
  const rawNodes = Array.from(
    dialog.querySelectorAll<HTMLElement>('.topic-item, ul.topic-list > li, .el-radio, .el-checkbox')
  );
  const deduped = rawNodes.filter(
    (node, i, arr) =>
      !isElementOrAncestorHidden(node, doc) &&
      !arr.some((other, j) => i !== j && node.contains(other))
  );

  const parsed: ParsedOptionItem[] = [];
  for (const optEl of deduped) {
    const letterEl = optEl.querySelector<HTMLElement>('.topic-option, .option-letter, .node_Lab');
    const textEl = optEl.querySelector<HTMLElement>(
      '.topic-text, .el-radio__label, .el-checkbox__label, .option-detail, .node_detail'
    );
    const inputEl = optEl.querySelector<HTMLInputElement>('input[type="radio"], input[type="checkbox"]');
    const rawOptText = (textEl?.innerText || textEl?.textContent || optEl.innerText || optEl.textContent || '').trim();

    let letter = '';
    const letterBadge = (letterEl?.innerText || letterEl?.textContent || '').trim();
    const badgeMatch = letterBadge.match(/^([A-Z])[\.、．:：\s]?$/i);
    if (badgeMatch) {
      letter = badgeMatch[1].toUpperCase();
    } else if (inputEl?.value && /^[A-Z]$/i.test(inputEl.value.trim())) {
      letter = inputEl.value.trim().toUpperCase();
    } else {
      const prefixMatch = rawOptText.match(/^([A-Z])[\.、．:：\s]+/);
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

  return parsed;
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

    const titleEl = findVisiblePopupTitleElement(activeDialog, doc);
    const rawTitle = (titleEl?.innerText || titleEl?.textContent || '').trim();
    const cleanTitle = cleanQuestionTitle(rawTitle);
    const parsedOptions = parsePopupOptions(activeDialog, doc);

    if (parsedOptions.length > 0) {
      const hasCheckboxes =
        !!activeDialog.querySelector('input[type="checkbox"], .el-checkbox') || /多选/.test(rawTitle);
      const radioCount = activeDialog.querySelectorAll('input[type="radio"], .el-radio').length;
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
  const closeBtn = findPopupCloseButton(dialogToClose, doc);
  if (closeBtn) {
    closeBtn.click();
    store.addLog('已点击智慧树弹题关闭/确定按钮', 'info');
    const verifyCloseDelay = timing?.verifyCloseDelayMs ?? 300;
    if (verifyCloseDelay > 0) {
      try {
        await sleep(verifyCloseDelay, signal);
      } catch {
        return false;
      }
      if (!isCurrent() || signal.aborted) return false;
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
