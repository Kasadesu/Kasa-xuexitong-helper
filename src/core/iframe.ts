/**
 * Checks if a given DOM element or any of its ancestors (including across iframe boundaries) has the official completed class
 */
export const isFinishedTask = (element: Element | null): boolean => {
  let cur: Element | null = element;
  let depth = 0;

  while (cur && depth < 20) {
    const className = typeof cur.className === 'string' ? cur.className : '';
    if (className.split(/\s+/).includes('ans-job-finished') || cur.classList?.contains('ans-job-finished')) {
      return true;
    }

    // Check sibling or parent job icon finished indicator
    if (typeof cur.parentElement?.querySelector === 'function' && cur.parentElement.querySelector('.ans-job-icon.ans-job-finished')) {
      return true;
    }

    if (cur.parentElement) {
      cur = cur.parentElement;
    } else {
      // Reached the root of the current document; traverse up across iframe boundary if possible
      try {
        const ownerDoc = cur.ownerDocument;
        const win = ownerDoc?.defaultView;
        if (win && win.frameElement && win.frameElement !== cur) {
          cur = win.frameElement;
          depth++;
        } else {
          break;
        }
      } catch {
        break; // Stop at cross-origin iframe security boundary
      }
    }
  }

  return false;
};

/**
 * Determines whether the given iframe is an internal child / descendant of an existing task container.
 * Such inner iframes (e.g. video player nested inside ans-insertvideo-module) must not be scheduled as standalone tasks.
 */
export const isInternalChildOfTask = (iframe: HTMLIFrameElement): boolean => {
  try {
    // 1. Check parent window's frameElement (if this iframe is inside another task iframe)
    const win = iframe.ownerDocument?.defaultView;
    if (win && win.frameElement && win.frameElement !== iframe) {
      let host: Element | null = win.frameElement;
      let depth = 0;

      while (host && depth < 10) {
        const hostCls = typeof host.className === 'string' ? host.className : '';
        const hostSrc = (host as HTMLIFrameElement).src || '';

        if (
          hostCls.includes('ans-insertvideo-module') ||
          hostCls.includes('ans-work-module') ||
          hostCls.includes('ans-module') ||
          hostCls.includes('ans-attach-ct') ||
          hostSrc.includes('modules/video') ||
          hostSrc.includes('modules/work') ||
          hostSrc.includes('video') ||
          hostSrc.includes('work') ||
          host.parentElement?.classList?.contains('ans-attach-ct') ||
          host.parentElement?.classList?.contains('ans-insertvideo-module') ||
          host.parentElement?.classList?.contains('ans-work-module')
        ) {
          return true;
        }

        if (host.parentElement) {
          host = host.parentElement;
        } else {
          const outerDoc: Document | null = host.ownerDocument;
          const outerWin: (Window & typeof globalThis) | null = (outerDoc?.defaultView as any) ?? null;
          if (outerWin && outerWin.frameElement && outerWin.frameElement !== host) {
            host = outerWin.frameElement;
            depth++;
          } else {
            break;
          }
        }
      }
    }

    // 2. Check enclosing ancestors in the same document
    let parent = iframe.parentElement;
    while (parent) {
      const cls = typeof parent.className === 'string' ? parent.className : '';
      if (
        cls.includes('ans-attach-online') ||
        cls.includes('ans-insertvideo-module') ||
        cls.includes('ans-work-module')
      ) {
        // If there's an outer container already holding a primary task iframe
        if (typeof parent.querySelectorAll === 'function') {
          const siblings = Array.from(parent.querySelectorAll('iframe'));
          if (siblings.length > 1 && siblings[0] !== iframe) {
            return true;
          }
        }
      }
      parent = parent.parentElement;
    }
  } catch {
    // Cross-origin access error ignored
  }

  return false;
};

/**
 * Recursively retrieves all nested iframes in document tree
 */
export const getAllNestedIframes = (root: Element): HTMLIFrameElement[] => {
  const result: HTMLIFrameElement[] = [];
  const directIframes = Array.from(root.querySelectorAll('iframe'));

  for (const iframe of directIframes) {
    result.push(iframe);
    try {
      if (iframe.contentDocument && iframe.contentDocument.documentElement) {
        const nested = getAllNestedIframes(iframe.contentDocument.documentElement);
        result.push(...nested);
      }
    } catch {
      // Cross-origin iframe security error ignored
    }
  }

  return result;
};

/**
 * Waits until the iframe content document is fully loaded
 */
export const waitIframeLoaded = async (iframe: HTMLIFrameElement, signal?: AbortSignal): Promise<void> => {
  if (!iframe.isConnected) return;

  try {
    if (iframe.contentDocument?.readyState === 'complete' && iframe.contentDocument.URL !== 'about:blank') {
      return;
    }
  } catch {
    return;
  }

  return new Promise<void>((resolve, reject) => {
    let checkTimer: number;

    const cleanup = () => {
      clearInterval(checkTimer);
      iframe.removeEventListener('load', onLoad);
      signal?.removeEventListener('abort', onAbort);
    };

    const onLoad = () => {
      cleanup();
      resolve();
    };

    const onAbort = () => {
      cleanup();
      reject(new DOMException('Aborted', 'AbortError'));
    };

    signal?.addEventListener('abort', onAbort, { once: true });
    iframe.addEventListener('load', onLoad, { once: true });

    checkTimer = window.setInterval(() => {
      try {
        if (!iframe.isConnected || iframe.contentDocument?.readyState === 'complete') {
          cleanup();
          resolve();
        }
      } catch {
        cleanup();
        resolve();
      }
    }, 300);
  });
};
