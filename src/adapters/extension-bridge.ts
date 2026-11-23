import { sleep } from '../core/lifecycle';

export interface ExtensionCaptureResponse {
  ok: boolean;
  dataUrl?: string;
  code?: string;
  error?: string;
}

export interface ExtensionFetchResponse {
  ok: boolean;
  status: number;
  text: string;
  error?: string;
}

export interface StemCropResult {
  dataUrl: string | null;
  reason?: string;
  error?: string;
}

const getChromeApi = (): any => (globalThis as any)?.chrome;

/**
 * Returns true when running inside a Chrome MV3 extension content script context
 */
export const isChromeExtensionRuntime = (): boolean => {
  const chromeApi = getChromeApi();
  return Boolean(
    chromeApi &&
      chromeApi.runtime &&
      chromeApi.runtime.id &&
      typeof chromeApi.runtime.sendMessage === 'function'
  );
};

/**
 * Requests a privacy-guarded visible tab screenshot from the Chrome MV3 service worker
 */
export const captureVisibleTabViaExtension = (
  signal?: AbortSignal
): Promise<ExtensionCaptureResponse> => {
  if (!isChromeExtensionRuntime()) {
    return Promise.resolve({
      ok: false,
      code: 'NOT_EXTENSION',
      error: '当前非 Chrome 扩展运行环境'
    });
  }
  if (signal?.aborted) {
    return Promise.resolve({
      ok: false,
      code: 'ABORTED',
      error: '任务已中止'
    });
  }

  const chromeApi = getChromeApi();
  return new Promise<ExtensionCaptureResponse>((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const cleanup = () => {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      if (signal) {
        signal.removeEventListener('abort', onAbort);
      }
    };

    const safeResolve = (res: ExtensionCaptureResponse) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(res);
    };

    const onAbort = () => {
      safeResolve({
        ok: false,
        code: 'ABORTED',
        error: '截屏请求已中止'
      });
    };

    if (signal) {
      signal.addEventListener('abort', onAbort, { once: true });
    }

    timer = setTimeout(() => {
      safeResolve({
        ok: false,
        code: 'CAPTURE_TIMEOUT',
        error: '扩展后台截屏响应超时'
      });
    }, 8000);

    try {
      chromeApi.runtime.sendMessage({ type: 'KASA_CAPTURE_VISIBLE_TAB' }, (response: any) => {
        const lastErr = chromeApi.runtime?.lastError;
        if (lastErr) {
          safeResolve({
            ok: false,
            code: 'RUNTIME_ERROR',
            error: lastErr.message || String(lastErr)
          });
          return;
        }
        if (response && response.ok && typeof response.dataUrl === 'string' && response.dataUrl) {
          safeResolve({
            ok: true,
            dataUrl: response.dataUrl
          });
          return;
        }
        safeResolve({
          ok: false,
          code: response?.code || 'CAPTURE_FAILED',
          error: response?.error || '扩展截屏未返回图像'
        });
      });
    } catch (err) {
      safeResolve({
        ok: false,
        code: 'CAPTURE_ERROR',
        error: String(err)
      });
    }
  });
};

/**
 * Crops a full-tab screenshot data URL down to the target element rectangle with white fill & blank-frame guard
 */
export const cropDataUrlToElementRect = async (
  fullDataUrl: string,
  rect: { left: number; top: number; width: number; height: number },
  dpr: number,
  viewport: { width: number; height: number }
): Promise<StemCropResult> => {
  if (
    !fullDataUrl ||
    typeof Image === 'undefined' ||
    typeof document === 'undefined' ||
    typeof document.createElement !== 'function'
  ) {
    return { dataUrl: null, reason: 'NO_CANVAS_ENV' };
  }

  return new Promise<StemCropResult>((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const img = new Image();

    const cleanup = () => {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      img.onload = null;
      img.onerror = null;
    };

    const finish = (res: StemCropResult) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(res);
    };

    timer = setTimeout(() => {
      finish({ dataUrl: null, reason: 'IMAGE_LOAD_TIMEOUT' });
    }, 5000);

    img.onload = () => {
      try {
        const imgW = img.naturalWidth || img.width || 0;
        const imgH = img.naturalHeight || img.height || 0;
        if (imgW <= 0 || imgH <= 0) {
          return finish({ dataUrl: null, reason: 'EMPTY_IMAGE' });
        }

        const scaleX = viewport.width > 0 ? imgW / viewport.width : dpr || 1;
        const scaleY = viewport.height > 0 ? imgH / viewport.height : dpr || 1;

        const padCss = 8;
        const sx = Math.max(0, Math.floor((rect.left - padCss) * scaleX));
        const sy = Math.max(0, Math.floor((rect.top - padCss) * scaleY));
        const ex = Math.min(imgW, Math.ceil((rect.left + rect.width + padCss) * scaleX));
        const ey = Math.min(imgH, Math.ceil((rect.top + rect.height + padCss) * scaleY));

        const sw = ex - sx;
        const sh = ey - sy;
        if (sw <= 4 || sh <= 4) {
          return finish({ dataUrl: null, reason: 'OUT_OF_VIEWPORT' });
        }

        const MAX_SIDE = 1280;
        let outW = sw;
        let outH = sh;
        if (outW > MAX_SIDE || outH > MAX_SIDE) {
          if (outW >= outH) {
            outH = Math.max(1, Math.round((outH * MAX_SIDE) / outW));
            outW = MAX_SIDE;
          } else {
            outW = Math.max(1, Math.round((outW * MAX_SIDE) / outH));
            outH = MAX_SIDE;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = outW;
        canvas.height = outH;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          return finish({ dataUrl: null, reason: 'NO_2D_CONTEXT' });
        }

        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, outW, outH);
        ctx.drawImage(img as any, sx, sy, sw, sh, 0, 0, outW, outH);

        if (typeof ctx.getImageData === 'function') {
          try {
            const imgData = ctx.getImageData(0, 0, outW, outH);
            const data = imgData?.data;
            if (data && data.length >= 4) {
              const cols = Math.min(8, outW);
              const rows = Math.min(8, outH);
              let baseR = -1;
              let baseG = -1;
              let baseB = -1;
              let hasVariance = false;

              for (let gy = 0; gy < rows && !hasVariance; gy++) {
                const py = Math.min(outH - 1, Math.floor(((gy + 0.5) * outH) / rows));
                for (let gx = 0; gx < cols && !hasVariance; gx++) {
                  const px = Math.min(outW - 1, Math.floor(((gx + 0.5) * outW) / cols));
                  const offset = (py * outW + px) * 4;
                  if (offset + 2 >= data.length) continue;
                  const r = data[offset];
                  const g = data[offset + 1];
                  const b = data[offset + 2];
                  if (baseR === -1) {
                    baseR = r;
                    baseG = g;
                    baseB = b;
                  } else if (r !== baseR || g !== baseG || b !== baseB) {
                    hasVariance = true;
                  }
                }
              }

              if (!hasVariance && baseR !== -1) {
                return finish({ dataUrl: null, reason: 'BLANK_CAPTURE' });
              }
            }
          } catch {
            // Proceed to export if pixel inspection fails on non-standard canvas mock
          }
        }

        const outDataUrl = canvas.toDataURL('image/jpeg', 0.9);
        if (!outDataUrl || !outDataUrl.startsWith('data:image/')) {
          return finish({ dataUrl: null, reason: 'EXPORT_FAILED' });
        }
        finish({ dataUrl: outDataUrl });
      } catch (err) {
        finish({ dataUrl: null, reason: 'CROP_ERROR', error: String(err) });
      }
    };

    img.onerror = () => {
      finish({ dataUrl: null, reason: 'IMAGE_LOAD_ERROR' });
    };

    try {
      img.src = fullDataUrl;
    } catch (err) {
      finish({ dataUrl: null, reason: 'IMAGE_SRC_ERROR', error: String(err) });
    }
  });
};

/**
 * Automatically scrolls to a closed-DOM stem element, momentarily hides the helper overlay,
 * captures the visible tab via Chrome MV3 extension background, and crops only the stem rectangle
 */
export const captureClosedStemImage = async (
  timuEl: HTMLElement,
  doc: Document,
  signal?: AbortSignal
): Promise<StemCropResult> => {
  if (!isChromeExtensionRuntime()) {
    return { dataUrl: null, reason: 'NOT_EXTENSION' };
  }
  if (signal?.aborted) {
    return { dataUrl: null, reason: 'ABORTED' };
  }

  const stemCandidates: HTMLElement[] = [];
  if (typeof timuEl?.querySelectorAll === 'function') {
    try {
      stemCandidates.push(
        ...Array.from(
          timuEl.querySelectorAll<HTMLElement>(
            '.subject_describe, .smallStem_describe, .subject_stem, .question-stem, .stem-content, .question-title, .subject_title'
          )
        )
      );
    } catch {}
  } else if (typeof timuEl?.querySelector === 'function') {
    const single = timuEl.querySelector<HTMLElement>(
      '.subject_describe, .smallStem_describe, .subject_stem, .question-stem, .stem-content, .question-title, .subject_title'
    );
    if (single) stemCandidates.push(single);
  }
  if (timuEl) {
    stemCandidates.push(timuEl);
  }

  const isValidRect = (el: HTMLElement | null | undefined): boolean => {
    if (!el || typeof el.getBoundingClientRect !== 'function') return false;
    try {
      const r = el.getBoundingClientRect();
      return Boolean(r && r.width > 20 && r.height > 10);
    } catch {
      return false;
    }
  };

  const targetEl = stemCandidates.find((el) => isValidRect(el));
  if (!targetEl) {
    return { dataUrl: null, reason: 'NO_RECT' };
  }

  try {
    targetEl.scrollIntoView?.({ behavior: 'instant' as ScrollBehavior, block: 'center' });
  } catch {
    try {
      targetEl.scrollIntoView?.({ block: 'center' });
    } catch {}
  }

  try {
    await sleep(100, signal);
  } catch {
    return { dataUrl: null, reason: 'ABORTED' };
  }
  if (signal?.aborted) {
    return { dataUrl: null, reason: 'ABORTED' };
  }

  let rawRect: DOMRect | { left: number; top: number; width: number; height: number };
  try {
    rawRect = targetEl.getBoundingClientRect();
  } catch {
    return { dataUrl: null, reason: 'NO_RECT' };
  }

  let rectLeft = rawRect.left;
  let rectTop = rawRect.top;
  const rectWidth = rawRect.width;
  const rectHeight = rawRect.height;

  // Adjust coordinates if running inside a same-origin iframe
  const topWin: any = typeof window !== 'undefined' ? (window.top || window) : null;
  let topDoc: Document = doc;
  try {
    if (topWin?.document) {
      topDoc = topWin.document;
    }
  } catch {
    topDoc = doc;
  }

  try {
    let curWin: any = doc?.defaultView || (typeof window !== 'undefined' ? window : null);
    for (let depth = 0; depth < 5 && curWin && curWin !== curWin.top; depth++) {
      const frameEl = curWin.frameElement as HTMLElement | null;
      if (!frameEl || typeof frameEl.getBoundingClientRect !== 'function') break;
      const frameRect = frameEl.getBoundingClientRect();
      rectLeft += frameRect.left;
      rectTop += frameRect.top;
      curWin = curWin.parent;
    }
  } catch {
    // Cross-origin ancestor frame access restricted
  }

  const viewportWidth = Number(
    topWin?.innerWidth || topDoc?.documentElement?.clientWidth || doc?.documentElement?.clientWidth || 1280
  );
  const viewportHeight = Number(
    topWin?.innerHeight || topDoc?.documentElement?.clientHeight || doc?.documentElement?.clientHeight || 800
  );
  const dpr = Number(topWin?.devicePixelRatio || 1) || 1;

  const clampedLeft = Math.max(0, rectLeft);
  const clampedTop = Math.max(0, rectTop);
  const clampedRight = Math.min(viewportWidth, rectLeft + rectWidth);
  const clampedBottom = Math.min(viewportHeight, rectTop + rectHeight);
  const clampedWidth = clampedRight - clampedLeft;
  const clampedHeight = clampedBottom - clampedTop;

  if (clampedWidth <= 10 || clampedHeight <= 10) {
    return { dataUrl: null, reason: 'OUT_OF_VIEWPORT' };
  }

  // Temporarily hide helper UI overlays so they do not obscure the stem
  const savedPanels: Array<{ el: HTMLElement; visibility: string; opacity: string }> = [];
  const collectPanels = (targetDoc: Document | null | undefined) => {
    if (!targetDoc || typeof targetDoc.querySelectorAll !== 'function') return;
    try {
      const els = Array.from(targetDoc.querySelectorAll<HTMLElement>('kasa-helper-panel, .kasa-card'));
      for (const el of els) {
        if (!savedPanels.some((p) => p.el === el) && el?.style) {
          savedPanels.push({
            el,
            visibility: el.style.visibility || '',
            opacity: el.style.opacity || ''
          });
          el.style.visibility = 'hidden';
          el.style.opacity = '0';
        }
      }
    } catch {}
  };

  let captureRes: ExtensionCaptureResponse;
  try {
    collectPanels(topDoc);
    if (doc !== topDoc) collectPanels(doc);

    try {
      await sleep(60, signal);
    } catch {
      return { dataUrl: null, reason: 'ABORTED' };
    }
    if (signal?.aborted) {
      return { dataUrl: null, reason: 'ABORTED' };
    }

    captureRes = await captureVisibleTabViaExtension(signal);
  } finally {
    for (const saved of savedPanels) {
      try {
        saved.el.style.visibility = saved.visibility;
        saved.el.style.opacity = saved.opacity;
      } catch {}
    }
  }

  if (!captureRes.ok || !captureRes.dataUrl) {
    return {
      dataUrl: null,
      reason: captureRes.code || 'CAPTURE_FAILED',
      error: captureRes.error
    };
  }

  return cropDataUrlToElementRect(
    captureRes.dataUrl,
    {
      left: clampedLeft,
      top: clampedTop,
      width: clampedWidth,
      height: clampedHeight
    },
    dpr,
    { width: viewportWidth, height: viewportHeight }
  );
};

/**
 * Proxies HTTP(S) AI API requests through the Chrome MV3 extension background service worker to bypass page CORS
 */
export const fetchViaExtensionBackground = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string; timeoutMs?: number },
  signal?: AbortSignal
): Promise<ExtensionFetchResponse | null> => {
  if (!isChromeExtensionRuntime()) {
    return Promise.resolve(null);
  }
  if (signal?.aborted) {
    return Promise.resolve({ ok: false, status: 0, text: '', error: '请求已中止' });
  }

  const chromeApi = getChromeApi();
  const innerTimeout = init.timeoutMs ?? 60000;
  const hardTimeoutMs = innerTimeout + 5000;

  return new Promise<ExtensionFetchResponse | null>((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const cleanup = () => {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      if (signal) {
        signal.removeEventListener('abort', onAbort);
      }
    };

    const safeResolve = (res: ExtensionFetchResponse | null) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(res);
    };

    const onAbort = () => {
      safeResolve({ ok: false, status: 0, text: '', error: '请求已中止' });
    };

    if (signal) {
      signal.addEventListener('abort', onAbort, { once: true });
    }

    timer = setTimeout(() => {
      safeResolve({
        ok: false,
        status: 0,
        text: '',
        error: `扩展后台请求硬超时（${Math.round(hardTimeoutMs / 1000)}秒）`
      });
    }, hardTimeoutMs);

    try {
      chromeApi.runtime.sendMessage(
        {
          type: 'KASA_EXT_FETCH',
          url,
          method: init.method,
          headers: init.headers,
          body: init.body,
          timeoutMs: innerTimeout
        },
        (response: any) => {
          const lastErr = chromeApi.runtime?.lastError;
          if (lastErr) {
            safeResolve({
              ok: false,
              status: 0,
              text: '',
              error: lastErr.message || String(lastErr)
            });
            return;
          }
          if (response && typeof response === 'object') {
            safeResolve({
              ok: Boolean(response.ok),
              status: Number(response.status) || 0,
              text: String(response.text || ''),
              ...(response.error ? { error: String(response.error) } : {})
            });
            return;
          }
          safeResolve({
            ok: false,
            status: 0,
            text: '',
            error: '扩展后台未返回响应'
          });
        }
      );
    } catch (err) {
      safeResolve({
        ok: false,
        status: 0,
        text: '',
        error: String(err)
      });
    }
  });
};
