import { store } from '../store';
import { getAllNestedIframes, waitIframeLoaded, isFinishedTask, isInternalChildOfTask } from './iframe';
import { LifecycleWatchdog } from './lifecycle';
import { playMediaTask } from '../adapters/video';
import { readDocumentTask } from '../adapters/document';
import { doQuizTask } from '../adapters/quiz';
import { tryNavigateNextChapter } from './navigator';
import { IframeContext } from '../types';

export class ChapterScheduler {
  private watchdog = new LifecycleWatchdog();
  private isProcessing = false;
  private processedIframeDocs = new WeakSet<Document>();

  public start() {
    store.addLog('脚本已启动，正在检测页面任务', 'info');

    // Force MOOC v2 modern layout if not already
    const url = window.location.href;
    if (url.includes('chaoxing.com') && !url.includes('&mooc2=1') && url.includes('mycourse/studentstudy')) {
      window.location.href = url + '&mooc2=1';
      return;
    }

    // Listen for manual quiz trigger from UI button
    window.addEventListener('kasa:toggle-quiz', () => {
      if (store.isQuizRunning) {
        this.pauseQuiz();
      } else {
        this.triggerManualQuiz();
      }
    });

    window.addEventListener('kasa:manual-quiz', () => {
      if (store.isQuizRunning) {
        this.pauseQuiz();
      } else {
        this.triggerManualQuiz();
      }
    });

    // Observe document mutations to catch async iframe insertions
    const observer = new MutationObserver(() => this.triggerScan());
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['src']
    });

    // Heartbeat check every 2 seconds
    window.setInterval(() => this.triggerScan(), 2000);
    this.triggerScan();
  }

  public async triggerManualQuiz() {
    store.addLog('启动答题流程，正在扫描全页题目...', 'info');
    store.setQuizRunning(true);
    store.updateProgress({ status: 'playing' });
    this.processedIframeDocs.delete(document);
    const taskId = this.watchdog.renew();
    const signal = this.watchdog.signal;
    const isCurrent = () => this.watchdog.isCurrent(taskId);

    const context: IframeContext = {
      signal,
      isCurrent: () => isCurrent()
    };

    try {
      if (this.isStandaloneQuiz(document)) {
        await doQuizTask(null, document, context);
      } else {
        const allIframes = getAllNestedIframes(document.documentElement);
        let found = false;
        for (const iframe of allIframes) {
          if (!isCurrent() || signal.aborted) break;
          const iframeDoc = iframe.contentDocument;
          if (!iframeDoc) continue;
          const src = iframe.src || '';
          const isQuiz =
            src.includes('work') ||
            src.includes('quiz') ||
            iframe.classList.contains('ans-work-module') ||
            iframe.parentElement?.classList.contains('ans-work-module') ||
            this.isStandaloneQuiz(iframeDoc);
          if (isQuiz) {
            found = true;
            await doQuizTask(iframe, iframeDoc, context);
          }
        }
        if (!found) {
          await doQuizTask(null, document, context);
        }
      }
    } catch (err) {
      if ((err as Error)?.name !== 'AbortError') {
        store.addLog(`答题执行异常: ${String(err)}`, 'error');
      }
    } finally {
      store.setQuizRunning(false);
      if (!signal.aborted) {
        store.updateProgress({ status: 'finished' });
      }
    }
  }

  public pauseQuiz() {
    store.addLog('已暂停答题', 'warning');
    this.watchdog.renew();
    store.setQuizRunning(false);
    store.updateProgress({ status: 'paused' });
  }

  private isStandaloneQuiz(doc: Document): boolean {
    const hasQuestions = !!doc.querySelector(
      '.questionLi, .TiMu.newTiMu, .TiMu, div[data-id], .singleQues, div[id^="question"], div[id^="q_"]'
    );
    const hasOptions = !!doc.querySelector(
      'ul.Zy_ulTop, li.before-after, .num_option, input[type="radio"], input[type="checkbox"], textarea, .answerBg'
    );
    const isQuizUrl = /work\/|exam\/|quiz|dowork|doHomeWork|reVersionTest/i.test(window.location.href);
    return (hasQuestions && hasOptions) || (isQuizUrl && hasQuestions);
  }

  private async triggerScan() {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      await this.runPipeline();
    } catch (err) {
      if ((err as Error)?.name !== 'AbortError') {
        store.addLog(`调度异常: ${String(err)}`, 'error');
      }
    } finally {
      this.isProcessing = false;
    }
  }

  private async runPipeline() {
    const taskId = this.watchdog.taskId || this.watchdog.renew();
    const signal = this.watchdog.signal;

    const isCurrent = () => this.watchdog.isCurrent(taskId);

    // Step 0: Check if current top-level document is a standalone Homework / Exam page
    if (this.isStandaloneQuiz(document)) {
      if (!this.processedIframeDocs.has(document)) {
        this.processedIframeDocs.add(document);
        store.addLog('已检测到作业/测验页面，请点击右上角【开始答题】启动作答', 'info');
        store.updateProgress({
          title: '已检测到作业/测验，点击【开始答题】启动',
          status: 'idle',
          percent: 0,
          currentTime: '未开始'
        });
      }
      return;
    }

    // 1. Gather all iframes on page
    const allIframes = getAllNestedIframes(document.documentElement);
    if (!allIframes.length) return;

    let pendingTasksCount = 0;

    // 2. Process tasks sequentially
    for (const iframe of allIframes) {
      if (!isCurrent() || signal.aborted) return;
      if (!iframe.isConnected) continue;

      const src = iframe.src || '';
      if (src.startsWith('javascript:')) continue;

      await waitIframeLoaded(iframe, signal);
      if (!isCurrent() || signal.aborted || !iframe.isConnected) return;

      const iframeDoc = iframe.contentDocument;
      const iframeWin = iframe.contentWindow;
      if (!iframeDoc || !iframeWin) continue;

      // Skip internal child iframes that belong to an outer task container
      if (isInternalChildOfTask(iframe)) {
        continue;
      }

      // Skip already finished tasks
      if (isFinishedTask(iframe)) {
        continue;
      }

      // Check if this is an active task point container
      const hasJobIcon = iframe.parentElement?.querySelector('.ans-job-icon');
      const isRecognizedTask =
        hasJobIcon ||
        src.includes('video') ||
        src.includes('audio') ||
        src.includes('work') ||
        src.includes('quiz') ||
        src.includes('modules/') ||
        iframe.classList.contains('ans-work-module') ||
        iframe.parentElement?.classList.contains('ans-work-module');

      if (!isRecognizedTask) {
        continue;
      }

      if (this.processedIframeDocs.has(iframeDoc)) {
        continue;
      }

      pendingTasksCount++;
      const context: IframeContext = {
        signal,
        isCurrent: () => isCurrent() && iframe.isConnected && iframe.contentDocument === iframeDoc
      };

      if (src.includes('video')) {
        await playMediaTask('video', iframe, iframeDoc, context);
      } else if (src.includes('audio')) {
        await playMediaTask('audio', iframe, iframeDoc, context);
      } else if (['ppt', 'doc', 'pptx', 'docx', 'pdf'].some((t) => src.includes('modules/' + t))) {
        await readDocumentTask(iframeWin, context);
      } else if (
        src.includes('work') ||
        src.includes('quiz') ||
        iframe.classList.contains('ans-work-module') ||
        iframe.parentElement?.classList.contains('ans-work-module')
      ) {
        if (!isFinishedTask(iframe)) {
          if (!this.processedIframeDocs.has(iframeDoc)) {
            store.addLog('已检测到章节测验任务点，请点击右上角【开始答题】启动作答', 'info');
            store.updateProgress({
              title: '已检测到章节测验，点击【开始答题】启动',
              status: 'idle',
              percent: 0,
              currentTime: '未开始'
            });
            this.processedIframeDocs.add(iframeDoc);
          }
        }
        continue;
      }

      this.processedIframeDocs.add(iframeDoc);
    }

    // 3. When all tasks in current chapter are finished, navigate to next chapter!
    if (pendingTasksCount > 0 && isCurrent() && !signal.aborted) {
      // Re-verify that all visible jobs now have ans-job-finished
      const stillUnfinished = allIframes.some((ifr) => {
        const hasJob = ifr.parentElement?.querySelector('.ans-job-icon');
        return hasJob && !isFinishedTask(ifr);
      });

      if (!stillUnfinished) {
        this.watchdog.renew(); // Renew abort controller for the new chapter
        await tryNavigateNextChapter(document, signal, isCurrent);
      }
    }
  }
}
