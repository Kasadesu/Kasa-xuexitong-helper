import { store } from '../store';
import { sleep, getHumanJitterDelay } from './lifecycle';

/**
 * Triggers native navigation to the next chapter with anti-detection human delay
 */
export const tryNavigateNextChapter = async (
  rootDocument: Document,
  signal: AbortSignal,
  isCurrent: () => boolean
): Promise<boolean> => {
  if (!store.config.autoNextChapter) {
    store.addLog('已关闭自动下一章节，在设置面板中可随时开启', 'warning');
    return false;
  }

  // 1. Check if there is a next chapter
  const nextIndicator = rootDocument.querySelector('#prevNextFocusNext');
  if (nextIndicator && (nextIndicator as HTMLElement).style.display === 'none') {
    store.addLog('已经到达最后一章节，自动学习完毕！', 'success');
    return false;
  }

  // 2. Human-like random jitter delay
  const delayMs = getHumanJitterDelay(store.config.randomDelayBase, store.config.randomDelayJitter);
  store.addLog(`本页任务点已全部完成，将在 ${(delayMs / 1000).toFixed(1)} 秒后前往下一章节`, 'info');

  try {
    await sleep(delayMs, signal);
  } catch {
    return false;
  }

  if (!isCurrent() || signal.aborted) {
    return false;
  }

  // 3. Find and trigger the native next chapter button
  const nextBtn =
    rootDocument.querySelector<HTMLElement>('.jb_btn.jb_btn_92.fr.fs14.nextChapter') ||
    rootDocument.querySelector<HTMLElement>('.nextChapter') ||
    rootDocument.querySelector<HTMLElement>('#prevNextFocusNext');

  if (nextBtn) {
    store.addLog('触发原生下一章节跳转', 'success');
    nextBtn.click();
    return true;
  } else {
    store.addLog('未找到下一章节跳转按钮，可能已至课程末尾', 'warning');
    return false;
  }
};
