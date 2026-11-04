import { store } from '../store';
import { isFinishedTask } from '../core/iframe';
import { sleep, getHumanJitterDelay } from '../core/lifecycle';
import { IframeContext } from '../types';

/**
 * Handles HTML5 Video / Audio playback with anti-detection pause recovery
 */
export const playMediaTask = async (
  mediaType: 'video' | 'audio',
  iframe: HTMLIFrameElement,
  iframeDocument: Document,
  context: IframeContext
): Promise<void> => {
  return new Promise<void>((resolve, reject) => {
    store.addLog(`发现一个${mediaType === 'video' ? '视频' : '音频'}任务点，正在初始化`, 'info');

    let settled = false;
    let isStarted = false;
    let mediaElement: HTMLMediaElement | null = null;
    let checkInterval: number;

    const formatTime = (secs: number) => {
      if (!secs || isNaN(secs)) return '00:00';
      const m = Math.floor(secs / 60).toString().padStart(2, '0');
      const s = Math.floor(secs % 60).toString().padStart(2, '0');
      return `${m}:${s}`;
    };

    const onTimeUpdate = () => {
      if (!mediaElement) return;
      const cur = mediaElement.currentTime || 0;
      const dur = mediaElement.duration || 0;
      const pct = dur > 0 ? Math.min(100, (cur / dur) * 100) : 0;
      store.updateProgress({
        title: mediaType === 'video' ? '视频播放任务点' : '音频播放任务点',
        percent: Math.round(pct * 10) / 10,
        currentTime: formatTime(cur),
        duration: formatTime(dur),
        status: mediaElement.paused ? 'paused' : 'playing'
      });
    };

    const cleanup = () => {
      clearInterval(checkInterval);
      if (mediaElement) {
        mediaElement.removeEventListener('timeupdate', onTimeUpdate);
        mediaElement.removeEventListener('pause', onPause);
        mediaElement.removeEventListener('ended', onEnded);
      }
      context.signal.removeEventListener('abort', onAbort);
    };

    const finish = () => {
      if (settled) return;
      settled = true;
      cleanup();
      store.updateProgress({ percent: 100, status: 'finished' });
      try {
        mediaElement?.pause();
      } catch {
        // ignore
      }
      resolve();
    };

    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };

    const onAbort = () => finish();

    // Catch pause events (anti-cheat blur pauses) and resume with jitter
    const onPause = async () => {
      if (settled || !context.isCurrent() || isFinishedTask(iframe)) {
        return finish();
      }

      const jitterDelay = getHumanJitterDelay(store.config.randomDelayBase, store.config.randomDelayJitter);
      store.addLog(`检测到媒体被暂停，将在 ${(jitterDelay / 1000).toFixed(1)} 秒后自动恢复播放`, 'warning');

      try {
        await sleep(jitterDelay, context.signal);
      } catch {
        return finish();
      }

      if (settled || !context.isCurrent() || isFinishedTask(iframe)) {
        return finish();
      }

      try {
        await mediaElement?.play();
      } catch (e) {
        fail(e);
      }
    };

    const onEnded = () => {
      if (context.isCurrent()) {
        store.addLog(`${mediaType === 'video' ? '视频' : '音频'}播放完毕，等待后台状态入库`, 'info');
      }
      finish();
    };

    context.signal.addEventListener('abort', onAbort, { once: true });

    // Polling watch loop
    checkInterval = window.setInterval(async () => {
      if (settled) return;

      if (!context.isCurrent()) {
        return finish();
      }

      // 1. Check if official completion checkmark has arrived
      if (isFinishedTask(iframe)) {
        store.addLog(`${mediaType === 'video' ? '视频' : '音频'}任务点官方确认完成`, 'success');
        return finish();
      }

      // 2. Discover media element
      if (!isStarted) {
        mediaElement = iframeDocument.querySelector<HTMLMediaElement>(mediaType);
        if (mediaElement) {
          // Check if already finished before starting playback
          if (mediaElement.duration > 0 && mediaElement.currentTime >= mediaElement.duration - 1) {
            store.addLog(`${mediaType === 'video' ? '视频' : '音频'}媒体已处于完播状态`, 'success');
            return finish();
          }

          isStarted = true;
          try {
            // Respect 1.0x native rate to defeat backend timestamp verification
            mediaElement.playbackRate = 1.0;
            mediaElement.muted = true; // Avoid browser autoplay policy blocks

            store.addLog('启动 1.0x 原速静音播放，已就绪', 'info');
            await mediaElement.play();

            if (settled || !context.isCurrent() || isFinishedTask(iframe)) {
              return finish();
            }

            mediaElement.addEventListener('timeupdate', onTimeUpdate);
            mediaElement.addEventListener('pause', onPause);
            mediaElement.addEventListener('ended', onEnded);

            if (mediaElement.ended) {
              onEnded();
            }
          } catch (err) {
            store.addLog(`自动播放被浏览器策略限制，将在重试: ${String(err)}`, 'warning');
            isStarted = false; // Allow retry on next tick
          }
        }
      } else if (mediaElement) {
        // Continuous check for already finished media
        if (mediaElement.duration > 0 && mediaElement.currentTime >= mediaElement.duration - 1) {
          store.addLog(`${mediaType === 'video' ? '视频' : '音频'}媒体已处于完播状态`, 'success');
          return finish();
        }
      }
    }, 1500);

    if (!context.isCurrent()) {
      finish();
    }
  });
};
