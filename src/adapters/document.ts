import { store } from '../store';
import { sleep, getHumanJitterDelay } from '../core/lifecycle';
import { IframeContext } from '../types';

export const readDocumentTask = async (
  iframeWindow: Window,
  context: IframeContext
): Promise<void> => {
  store.addLog('发现文档/课件任务点，开始自动浏览', 'info');

  const doc = iframeWindow.document;
  const viewerFrame = doc.querySelector<HTMLIFrameElement>('#panView');
  const targetDoc = viewerFrame?.contentDocument || doc;
  const targetWin = viewerFrame?.contentWindow || iframeWindow;

  const scrollDown = () => {
    try {
      const scrollHeight = Math.max(
        targetDoc.body?.scrollHeight || 0,
        targetDoc.documentElement?.scrollHeight || 0
      );
      targetWin.scrollTo({ top: scrollHeight, behavior: 'smooth' });
    } catch {
      // ignore cross-origin scroll
    }
  };

  scrollDown();

  const delayMs = Math.max(
    4000,
    getHumanJitterDelay(store.config.randomDelayBase, store.config.randomDelayJitter)
  );

  try {
    await sleep(delayMs, context.signal);
  } catch {
    return;
  }

  if (!context.isCurrent()) return;

  scrollDown();
  store.addLog('文档阅读完成', 'success');
};
