export const sleep = (ms: number, signal?: AbortSignal): Promise<void> => {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      return reject(new DOMException('Aborted', 'AbortError'));
    }

    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);

    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };

    signal?.addEventListener('abort', onAbort, { once: true });
  });
};

/**
 * Generates a human-like random jitter delay
 * e.g., base=3s, jitter=1.2s -> random float between 1.8s and 4.2s
 */
export const getHumanJitterDelay = (baseSeconds: number, jitterSeconds: number): number => {
  const min = Math.max(0.5, baseSeconds - jitterSeconds);
  const max = baseSeconds + jitterSeconds;
  const random = Math.random() * (max - min) + min;
  return Math.round(random * 1000);
};

export class LifecycleWatchdog {
  private controller: AbortController = new AbortController();
  private currentTaskId: number = 0;

  public get signal(): AbortSignal {
    return this.controller.signal;
  }

  public get taskId(): number {
    return this.currentTaskId;
  }

  public renew(): number {
    this.controller.abort();
    this.controller = new AbortController();
    return ++this.currentTaskId;
  }

  public isCurrent(taskId: number): boolean {
    return !this.controller.signal.aborted && this.currentTaskId === taskId;
  }

  public abort() {
    this.controller.abort();
  }
}
