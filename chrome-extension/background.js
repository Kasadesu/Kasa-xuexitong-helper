// Chrome MV3 Service Worker for Kasa-xuexitong-helper
// Handles zero-hook visible tab capture (privacy & occlusion guarded) and CORS-free AI API requests

let lastCaptureAt = 0;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== 'object') {
    return false;
  }

  if (message.type === 'KASA_CAPTURE_VISIBLE_TAB') {
    const tab = sender && sender.tab;
    if (!tab || typeof tab.windowId !== 'number') {
      sendResponse({
        ok: false,
        code: 'NO_TAB_CONTEXT',
        error: '未获取到标签页上下文'
      });
      return false;
    }

    // Privacy guard: never capture a different active tab in the same window
    if (tab.active !== true) {
      sendResponse({
        ok: false,
        code: 'TAB_NOT_ACTIVE',
        error: '当前网课标签页未处于所在窗口激活状态，为防误截其他标签页已跳过截屏'
      });
      return false;
    }

    const doCapture = () => {
      const elapsed = Date.now() - lastCaptureAt;
      const waitMs = elapsed >= 550 ? 0 : 550 - elapsed;
      const run = () => {
        try {
          lastCaptureAt = Date.now();
          chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' }, (dataUrl) => {
            if (chrome.runtime.lastError || !dataUrl) {
              sendResponse({
                ok: false,
                code: 'CAPTURE_FAILED',
                error: (chrome.runtime.lastError && chrome.runtime.lastError.message) || '截屏返回空图像'
              });
              return;
            }
            sendResponse({ ok: true, dataUrl });
          });
        } catch (err) {
          sendResponse({
            ok: false,
            code: 'CAPTURE_FAILED',
            error: String(err)
          });
        }
      };

      if (waitMs > 0) {
        setTimeout(run, waitMs);
      } else {
        run();
      }
    };

    try {
      if (chrome.windows && typeof chrome.windows.get === 'function') {
        chrome.windows.get(tab.windowId, (win) => {
          if (!chrome.runtime.lastError && win && win.state === 'minimized') {
            sendResponse({
              ok: false,
              code: 'WINDOW_MINIMIZED',
              error: '当前浏览器窗口已最小化，无法截取题干画面（请保持独立窗口不最小化，可直接用其他窗口盖住）'
            });
            return;
          }
          doCapture();
        });
      } else {
        doCapture();
      }
    } catch (err) {
      sendResponse({
        ok: false,
        code: 'CAPTURE_FAILED',
        error: String(err)
      });
    }
    return true;
  }

  if (message.type === 'KASA_EXT_FETCH') {
    const url = typeof message.url === 'string' ? message.url : '';
    if (!/^https?:\/\//i.test(url)) {
      sendResponse({
        ok: false,
        status: 0,
        text: '',
        error: 'Invalid request URL'
      });
      return false;
    }

    const rawTimeout = Number(message.timeoutMs);
    const timeoutMs = Number.isFinite(rawTimeout)
      ? Math.min(Math.max(rawTimeout, 1000), 65000)
      : 60000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const fetchOpts = {
      method: typeof message.method === 'string' ? message.method : 'GET',
      headers: message.headers && typeof message.headers === 'object' ? message.headers : {},
      signal: controller.signal
    };
    if (message.body !== undefined && fetchOpts.method.toUpperCase() !== 'GET') {
      fetchOpts.body = message.body;
    }

    fetch(url, fetchOpts)
      .then(async (res) => {
        const text = await res.text().catch(() => '');
        sendResponse({
          ok: res.ok,
          status: res.status,
          text
        });
      })
      .catch((err) => {
        const isAbort = err && err.name === 'AbortError';
        sendResponse({
          ok: false,
          status: 0,
          text: '',
          error: isAbort ? '请求超时' : String(err)
        });
      })
      .finally(() => {
        clearTimeout(timer);
      });
    return true;
  }

  return false;
});
