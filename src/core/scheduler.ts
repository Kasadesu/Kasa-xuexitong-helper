import { store } from '../store';
import { getAllNestedIframes, waitIframeLoaded, isFinishedTask, isInternalChildOfTask } from './iframe';
import { LifecycleWatchdog } from './lifecycle';
import { playMediaTask } from '../adapters/video';
import { readDocumentTask } from '../adapters/document';
import { doQuizTask, getExamAutoResumeState, clearExamAutoResumeState } from '../adapters/quiz';
import {
  isZhihuishuHost,
  isZhihuishuVideoPage,
  playZhihuishuVideoTask,
  getZhihuishuLessonKey,
  getZhihuishuSwitchCooldownUntil,
  getLastCompletedZhihuishuLessonKey,
  clearZhihuishuCompletionSuppression
} from '../adapters/zhihuishu-video';
import { tryNavigateNextChapter } from './navigator';
import { IframeContext } from '../types';

export class ChapterScheduler {
  private watchdog = new LifecycleWatchdog();
  private isProcessing = false;
  private isAutoResuming = false;
  private isZhihuishuVideoRunning = false;
  private processedIframeDocs = new WeakSet<Document>();
  private scanDebounceTimer: number | null = null;

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

    // Observe document mutations with 500ms debounce to catch async iframe insertions without thrashing
    const observer = new MutationObserver(() => {
      if (this.scanDebounceTimer) {
        window.clearTimeout(this.scanDebounceTimer);
      }
      this.scanDebounceTimer = window.setTimeout(() => {
        this.scanDebounceTimer = null;
        this.triggerScan();
      }, 500);
    });
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

    let processed = false;
    try {
      if (this.isStandaloneQuiz(document)) {
        processed = true;
        await doQuizTask(null, document, context);
      } else {
        const allIframes = getAllNestedIframes(document.documentElement);
        let found = false;
        for (const iframe of allIframes) {
          if (!isCurrent() || signal.aborted) break;
          if (isInternalChildOfTask(iframe)) continue;
          const src = iframe.src || '';
          const looksLikeQuizFrame =
            src.includes('work') ||
            src.includes('quiz') ||
            src.includes('exam') ||
            iframe.classList.contains('ans-work-module') ||
            iframe.parentElement?.classList.contains('ans-work-module');
          if (looksLikeQuizFrame && !iframe.contentDocument) {
            await waitIframeLoaded(iframe, signal);
            if (!isCurrent() || signal.aborted) break;
          }
          const iframeDoc = iframe.contentDocument;
          if (!iframeDoc) continue;
          const isQuiz = looksLikeQuizFrame || this.isStandaloneQuiz(iframeDoc);
          if (isQuiz) {
            found = true;
            processed = true;
            await doQuizTask(iframe, iframeDoc, context);
          }
        }
        if (!found) {
          const hasAnyQuestions = !!document.querySelector(
            '.questionLi, .TiMu.newTiMu, .TiMu, div[data-id], .singleQues, div[id^="question"], .Zy_TItle, .examPaper_subject, .questionBox, .subject_item, .examQuestion_item'
          );
          if (hasAnyQuestions) {
            processed = true;
            await doQuizTask(null, document, context);
          } else {
            clearExamAutoResumeState();
            store.addLog('当前页面未检测到任何作业或测验任务点', 'warning');
            store.updateProgress({
              title: '未检测到作业/测验',
              status: 'idle',
              percent: 0,
              currentTime: '无任务'
            });
            return;
          }
        }
      }
    } catch (err) {
      clearExamAutoResumeState();
      if ((err as Error)?.name !== 'AbortError') {
        store.addLog(`答题执行异常: ${String(err)}`, 'error');
      }
    } finally {
      if (isCurrent()) {
        store.setQuizRunning(false);
        if (processed && !signal.aborted) {
          if (this.isStandaloneQuiz(document)) {
            this.processedIframeDocs.add(document);
          }
          if (store.progress.status !== 'paused') {
            store.updateProgress({ status: 'finished' });
          }
        }
      }
    }
  }

  public pauseQuiz() {
    clearExamAutoResumeState();
    this.isAutoResuming = false;
    store.addLog('已暂停答题', 'warning');
    this.watchdog.renew();
    store.setQuizRunning(false);
    store.updateProgress({ status: 'paused' });
  }

  private isQuizPageUrl(url?: string): boolean {
    const loc = typeof window !== 'undefined' ? window.location : undefined;
    const targetUrl = url ?? (loc?.href || `${loc?.pathname || ''}${loc?.search || ''}`);
    return /work\/|exam\/|quiz|dowork|doHomeWork|reVersionTest|reVersionPaper|doExam|examId=|onlineexamh5new|stuExamWeb|examPaper|doHomework/i.test(
      targetUrl
    );
  }

  private isStandaloneQuiz(doc: Document): boolean {
    if (isZhihuishuHost() && isZhihuishuVideoPage(doc)) {
      return false;
    }

    const questionSel =
      '.questionLi, .TiMu.newTiMu, .TiMu, div[data-id], .singleQues, div[id^="question"], div[id^="q_"], .examPaper_subject, .questionBox, .subject_item, .examQuestion_item';
    const optionSel =
      'ul.Zy_ulTop, li.before-after, .num_option, input[type="radio"], input[type="checkbox"], textarea, .answerBg, .subject_node, .nodeLab, .el-radio, .el-checkbox, .el-textarea__inner';

    const isOutsidePopup = (el: Element | null): boolean =>
      !!el &&
      !(
        typeof (el as HTMLElement).closest === 'function' &&
        (el as HTMLElement).closest('.dialog-test, .el-dialog__wrapper')
      );

    const rawQuestions =
      typeof doc.querySelectorAll === 'function'
        ? Array.from(doc.querySelectorAll<HTMLElement>(questionSel))
        : [];
    const hasQuestions =
      rawQuestions.length > 0
        ? rawQuestions.some((el) => isOutsidePopup(el))
        : typeof doc.querySelector === 'function' && isOutsidePopup(doc.querySelector(questionSel));

    const rawOptions =
      typeof doc.querySelectorAll === 'function'
        ? Array.from(doc.querySelectorAll<HTMLElement>(optionSel))
        : [];
    const hasOptions =
      rawOptions.length > 0
        ? rawOptions.some((el) => isOutsidePopup(el))
        : typeof doc.querySelector === 'function' && isOutsidePopup(doc.querySelector(optionSel));

    return (hasQuestions && hasOptions) || (this.isQuizPageUrl() && hasQuestions);
  }

  private async triggerScan() {
    if (this.isProcessing || store.isQuizRunning) return;
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
      const resumeState = getExamAutoResumeState();
      if (resumeState && resumeState.active) {
        if (!this.processedIframeDocs.has(document) && !this.isAutoResuming) {
          this.processedIframeDocs.add(document);
          this.isAutoResuming = true;
          store.addLog('检测到考试自动翻页续跑状态，正在继续下一题作答...', 'info');
          window.setTimeout(() => {
            this.isAutoResuming = false;
            if (!store.isQuizRunning && getExamAutoResumeState()?.active) {
              void this.triggerManualQuiz();
            }
          }, 50);
        }
        return;
      }

      if (!this.processedIframeDocs.has(document)) {
        this.processedIframeDocs.add(document);
        if (store.progress.status !== 'finished' && store.progress.status !== 'paused') {
          store.addLog('已检测到作业/测验页面，请点击右上角【开始答题】启动作答', 'info');
          store.updateProgress({
            title: '已检测到作业/测验，点击【开始答题】启动',
            status: 'idle',
            percent: 0,
            currentTime: '未开始'
          });
        }
      }
      return;
    }

    const clearStaleExamResumeIfSafe = () => {
      const isDocComplete =
        typeof document === 'undefined' ||
        document.readyState === undefined ||
        document.readyState === 'complete';
      if (
        isDocComplete &&
        !this.isQuizPageUrl() &&
        !store.isQuizRunning &&
        getExamAutoResumeState()?.active
      ) {
        clearExamAutoResumeState();
      }
    };

    // Step 0.5: Handle Zhihuishu H5 video learning pages directly (strict 1.0x muted playback & popup quiz handling)
    if (isZhihuishuVideoPage(document)) {
      clearStaleExamResumeIfSafe();
      if (Date.now() < getZhihuishuSwitchCooldownUntil()) {
        return;
      }
      const completedKey = getLastCompletedZhihuishuLessonKey();
      if (completedKey) {
        const currentKey = getZhihuishuLessonKey(document);
        if (currentKey === completedKey) {
          return;
        }
        clearZhihuishuCompletionSuppression();
      }
      if (!this.isZhihuishuVideoRunning) {
        this.isZhihuishuVideoRunning = true;
        try {
          await playZhihuishuVideoTask(document, { signal, isCurrent });
        } finally {
          this.isZhihuishuVideoRunning = false;
        }
      }
      return;
    }

    // 1. Gather all iframes on page
    const allIframes = getAllNestedIframes(document.documentElement);
    if (!allIframes.length) {
      clearStaleExamResumeIfSafe();
      return;
    }

    let pendingTasksCount = 0;
    let hasUnfinishedQuiz = false;

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
        src.includes('exam') ||
        src.includes('modules/') ||
        iframe.classList.contains('ans-work-module') ||
        iframe.parentElement?.classList.contains('ans-work-module') ||
        this.isStandaloneQuiz(iframeDoc);

      if (!isRecognizedTask) {
        continue;
      }

      const isQuizIframe =
        src.includes('work') ||
        src.includes('quiz') ||
        src.includes('exam') ||
        iframe.classList.contains('ans-work-module') ||
        iframe.parentElement?.classList.contains('ans-work-module') ||
        this.isStandaloneQuiz(iframeDoc);

      if (isQuizIframe) {
        hasUnfinishedQuiz = true;
        const resumeState = getExamAutoResumeState();
        if (resumeState && resumeState.active) {
          if (!this.processedIframeDocs.has(iframeDoc) && !this.isAutoResuming) {
            this.processedIframeDocs.add(iframeDoc);
            this.isAutoResuming = true;
            store.addLog('检测到考试自动翻页续跑状态，正在继续下一题作答...', 'info');
            window.setTimeout(() => {
              this.isAutoResuming = false;
              if (!store.isQuizRunning && getExamAutoResumeState()?.active) {
                void this.triggerManualQuiz();
              }
            }, 50);
          }
          continue;
        }
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
      }

      this.processedIframeDocs.add(iframeDoc);
    }

    if (!hasUnfinishedQuiz) {
      clearStaleExamResumeIfSafe();
    }

    // 3. When all tasks in current chapter are finished, navigate to next chapter!
    if (pendingTasksCount > 0 && !hasUnfinishedQuiz && isCurrent() && !signal.aborted) {
      // Re-verify that all visible jobs and quizzes now have ans-job-finished
      const stillUnfinished = allIframes.some((ifr) => {
        if (isInternalChildOfTask(ifr)) return false;
        const ifrSrc = ifr.src || '';
        const hasJob = ifr.parentElement?.querySelector('.ans-job-icon');
        const isQuiz =
          ifrSrc.includes('work') ||
          ifrSrc.includes('quiz') ||
          ifrSrc.includes('exam') ||
          ifr.classList.contains('ans-work-module') ||
          ifr.parentElement?.classList.contains('ans-work-module');
        return (hasJob || isQuiz) && !isFinishedTask(ifr);
      });

      if (!stillUnfinished) {
        this.watchdog.renew(); // Renew abort controller for the new chapter
        await tryNavigateNextChapter(document, signal, isCurrent);
      }
    }
  }
}
