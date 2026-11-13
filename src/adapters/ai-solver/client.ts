import { store } from '../../store';
import { Question, RemoteModelItem } from '../../types';
import { buildAiPrompt } from './prompt';
import { parseAiResponse } from './parser';

export const DEFAULT_REASONING_EFFORTS = ['none', 'low', 'medium', 'high', 'max'];

/**
 * Parses raw JSON from /models endpoint, preserving full metadata for each model.
 */
export const parseModelsFromJson = (
  raw: any
): { ids: string[]; items: RemoteModelItem[] } => {
  try {
    const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const list = Array.isArray(data) ? data : data?.data || data?.models || [];
    if (!Array.isArray(list)) return { ids: [], items: [] };

    const itemMap = new Map<string, RemoteModelItem>();
    for (const item of list) {
      if (!item) continue;
      let modelId = '';
      let modelObj: RemoteModelItem;
      if (typeof item === 'string') {
        modelId = item.trim();
        modelObj = { id: modelId };
      } else if (typeof item === 'object' && typeof item.id === 'string') {
        modelId = item.id.trim();
        modelObj = { ...item, id: modelId };
      } else {
        continue;
      }

      if (modelId && !itemMap.has(modelId)) {
        itemMap.set(modelId, modelObj);
      }
    }

    const sortedIds = Array.from(itemMap.keys()).sort((a, b) => a.localeCompare(b));
    const sortedItems = sortedIds.map((id) => itemMap.get(id)!);
    return { ids: sortedIds, items: sortedItems };
  } catch (e) {
    return { ids: [], items: [] };
  }
};

/**
 * 封装带防重入 settled 锁、外部信号 abort 联动与外层 JS 硬超时的 GM_xmlhttpRequest 执行器
 */
interface XhrGuardOptions<T> {
  signal?: AbortSignal;
  hardTimeoutMs: number;
  onAbortResult: () => T;
  onTimeoutResult: () => T;
  execute: (
    safeResolve: (value: T) => void,
    setReq: (req: any) => void
  ) => void;
}

const runGuardedXhr = <T>(options: XhrGuardOptions<T>): Promise<T> => {
  return new Promise<T>((resolve) => {
    let settled = false;
    let reqInstance: any = null;
    let timer: any = null;

    const cleanup = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (options.signal && onSignalAbort) {
        options.signal.removeEventListener('abort', onSignalAbort);
      }
    };

    const safeResolve = (val: T) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(val);
    };

    const onSignalAbort = () => {
      try {
        if (reqInstance && typeof reqInstance.abort === 'function') {
          reqInstance.abort();
        }
      } catch {}
      safeResolve(options.onAbortResult());
    };

    if (options.signal?.aborted) {
      safeResolve(options.onAbortResult());
      return;
    }

    if (options.signal) {
      options.signal.addEventListener('abort', onSignalAbort, { once: true });
    }

    timer = setTimeout(() => {
      try {
        if (reqInstance && typeof reqInstance.abort === 'function') {
          reqInstance.abort();
        }
      } catch {}
      safeResolve(options.onTimeoutResult());
    }, options.hardTimeoutMs);

    try {
      options.execute(safeResolve, (r) => {
        reqInstance = r;
      });
    } catch {
      safeResolve(options.onTimeoutResult());
    }
  });
};

/**
 * Fetches available models from OpenAI-compatible /models endpoint
 * and caches both model IDs and full model metadata into store.
 */
export const fetchRemoteModels = async (baseUrl: string, apiKey: string): Promise<string[]> => {
  if (!baseUrl.trim()) {
    store.addLog('获取模型列表失败: Base URL 不能为空', 'warning');
    return [];
  }

  let cleanBase = baseUrl.trim().replace(/\/+$/, '');
  if (cleanBase.endsWith('/chat/completions')) {
    cleanBase = cleanBase.replace(/\/chat\/completions$/, '');
  }
  let endpoint = cleanBase;
  if (!endpoint.endsWith('/models')) {
    endpoint += '/models';
  }

  const headers: Record<string, string> = {
    Accept: 'application/json'
  };
  if (apiKey.trim()) {
    headers['Authorization'] = `Bearer ${apiKey.trim()}`;
  }

  // @ts-ignore
  const xhr = typeof GM_xmlhttpRequest !== 'undefined' ? GM_xmlhttpRequest : null;

  if (!xhr) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 15000);
    try {
      const res = await window.fetch(endpoint, {
        method: 'GET',
        headers,
        signal: controller.signal
      });

      if (res.ok) {
        const json = await res.json();
        const parsed = parseModelsFromJson(json);
        if (parsed.ids.length > 0) {
          store.updateConfig({
            cachedModelList: parsed.ids,
            cachedModelItems: parsed.items
          });
        }
        return parsed.ids;
      } else {
        const errText = await res.text().catch(() => '');
        store.addLog(`拉取模型列表失败 HTTP ${res.status}: ${errText.slice(0, 100)}`, 'error');
        return [];
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        store.addLog('拉取模型列表超时（15秒）', 'error');
      } else {
        store.addLog(`拉取模型列表失败 (fetch): ${String(err)}`, 'error');
      }
      return [];
    } finally {
      window.clearTimeout(timer);
    }
  }

  return runGuardedXhr<string[]>({
    hardTimeoutMs: 18000,
    onAbortResult: () => [],
    onTimeoutResult: () => {
      store.addLog('拉取模型列表超时（18秒）', 'error');
      return [];
    },
    execute: (safeResolve, setReq) => {
      const req = xhr({
        url: endpoint,
        method: 'GET',
        headers,
        timeout: 15000,
        onload: (res: any) => {
          try {
            if (res.status >= 200 && res.status < 300) {
              const parsed = parseModelsFromJson(res.responseText);
              if (parsed.ids.length > 0) {
                store.updateConfig({
                  cachedModelList: parsed.ids,
                  cachedModelItems: parsed.items
                });
              }
              safeResolve(parsed.ids);
            } else {
              store.addLog(`拉取模型列表失败 HTTP ${res.status}: ${res.responseText.slice(0, 100)}`, 'error');
              safeResolve([]);
            }
          } catch (err) {
            store.addLog(`解析模型列表失败: ${String(err)}`, 'error');
            safeResolve([]);
          }
        },
        onerror: (err: any) => {
          store.addLog(`拉取模型列表失败，网络错误: ${String(err)}`, 'error');
          safeResolve([]);
        },
        ontimeout: () => {
          store.addLog('拉取模型列表超时（15秒）', 'error');
          safeResolve([]);
        },
        onabort: () => {
          safeResolve([]);
        }
      });
      setReq(req);
    }
  });
};

/**
 * Returns the list of supported reasoning efforts for a given model.
 * 1. If upstream explicitly provides `supported_reasoning_effort`, returns upstream levels.
 * 2. Otherwise returns full levels: ['none', 'low', 'medium', 'high', 'max'].
 * Never force locks or disables the reasoning effort selector.
 */
export const getModelSupportedReasoningEfforts = (
  modelId: string,
  metaList?: RemoteModelItem[]
): string[] => {
  const cleanId = (modelId || '').trim();
  const items = metaList || store.config.cachedModelItems || [];
  const target = items.find(
    (item) => item && typeof item.id === 'string' && item.id.toLowerCase() === cleanId.toLowerCase()
  );

  if (target && Array.isArray(target.supported_reasoning_effort) && target.supported_reasoning_effort.length > 0) {
    const list = target.supported_reasoning_effort.map((e) => String(e).trim()).filter(Boolean);
    if (!list.includes('none')) {
      return ['none', ...list];
    }
    return list;
  }

  return [...DEFAULT_REASONING_EFFORTS];
};

export type ModelReasoningCapability = 'supported' | 'built_in' | 'unsupported';

/**
 * Detects whether a given model supports reasoning_effort parameter, has built-in fixed reasoning, or does not support reasoning effort.
 */
export const detectModelReasoningCapability = (
  modelId: string,
  modelMeta?: any
): ModelReasoningCapability => {
  if (modelMeta?.supported_parameters?.includes?.('reasoning_effort')) {
    return 'supported';
  }

  const id = (modelId || '').toLowerCase().trim();
  if (!id) return 'unsupported';

  // 1. Built-in fixed reasoning models (e.g., deepseek-reasoner, deepseek-r1, r1, qwq, etc.)
  if (
    id.includes('deepseek-reasoner') ||
    id.includes('deepseek-r1') ||
    /(^|[^a-z0-9])r1($|[^a-z0-9])/.test(id) ||
    id.includes('qwq')
  ) {
    return 'built_in';
  }

  // 2. Models supporting reasoning_effort parameter (e.g., o1, o3, o3-mini, o1-preview, etc.)
  if (
    /(^|[^a-z0-9])(o1|o3)($|[^a-z0-9])/.test(id) ||
    id.includes('o1-') ||
    id.includes('o3-') ||
    id.includes('o1_') ||
    id.includes('o3_') ||
    id.includes('deepseek-flash') ||
    id.includes('deepseek-v4-flash') ||
    id.includes('deepseek-v4-pro') ||
    id.includes('v4-flash') ||
    id.includes('v4-pro')
  ) {
    return 'supported';
  }

  // 3. Normal chat models without reasoning_effort support (e.g., deepseek-chat, gpt-4o, gpt-4o-mini, qwen, claude, etc.)
  return 'unsupported';
};

/**
 * Universal OpenAI-compatible Chat Completion Requester with automatic retry and parameter fallback
 */
export const queryAiAnswer = async (
  question: Question,
  paperContext?: string,
  signal?: AbortSignal
): Promise<string[]> => {
  if (signal?.aborted) {
    return [];
  }
  if (!store.config.aiApiKey.trim()) {
    store.reloadConfig();
  }
  const { aiApiKey, aiBaseUrl, aiModel, reasoningEffort } = store.config;

  if (!aiApiKey.trim()) {
    store.addLog('未配置 AI API Key，请点击面板右上角齿轮填入后答题', 'warning');
    return [];
  }

  // Normalize baseUrl
  let endpoint = aiBaseUrl.trim().replace(/\/+$/, '');
  if (!endpoint.endsWith('/chat/completions')) {
    endpoint += '/chat/completions';
  }

  const targetModel = aiModel.trim() || 'deepseek-flash';
  const isReasoning =
    (reasoningEffort && reasoningEffort !== 'none') ||
    detectModelReasoningCapability(targetModel) !== 'unsupported';

  const messages = buildAiPrompt(
    question.type,
    question.title,
    question.options,
    paperContext,
    question.images,
    question.subType
  );

  const formatMessages = (forcePlainText: boolean) => {
    if (!forcePlainText) return messages;
    return messages.map((m) => {
      if (typeof m.content === 'string') return m;
      if (Array.isArray(m.content)) {
        const textParts = m.content
          .filter((p: any) => p && p.type === 'text')
          .map((p: any) => p.text)
          .join('\n');
        return { role: m.role, content: textParts };
      }
      return m;
    });
  };

  const buildPayload = (
    includeReasoningEffort: boolean,
    fallbackEffort?: string,
    forcePlainText = false
  ) => {
    const p: any = {
      model: targetModel,
      messages: formatMessages(forcePlainText),
      temperature: isReasoning ? 0.2 : 0.1,
      stream: false
    };
    const eff = fallbackEffort || reasoningEffort;
    if (includeReasoningEffort && eff && eff !== 'none') {
      p.reasoning_effort = eff;
    }
    return JSON.stringify(p);
  };

  const extractAnswersFromData = (data: any): string[] => {
    const msg = data?.choices?.[0]?.message;
    const rawContent = msg?.content || '';
    let answers = parseAiResponse(rawContent, question.type);
    if (answers.length === 0 && msg?.reasoning_content) {
      answers = parseAiResponse(String(msg.reasoning_content), question.type);
    }
    return answers;
  };

  const sendSingleRequest = async (bodyStr: string): Promise<{ ok: boolean; status: number; answers: string[]; errText: string }> => {
    if (signal?.aborted) {
      return { ok: false, status: 0, answers: [], errText: '' };
    }

    // @ts-ignore
    const xhr = typeof GM_xmlhttpRequest !== 'undefined' ? GM_xmlhttpRequest : null;

    if (!xhr) {
      const controller = new AbortController();
      const onExternalAbort = () => controller.abort();
      signal?.addEventListener('abort', onExternalAbort, { once: true });
      const timer = window.setTimeout(() => controller.abort(), 60000);
      try {
        const res = await window.fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${aiApiKey.trim()}`
          },
          body: bodyStr,
          signal: controller.signal
        });

        if (signal?.aborted) {
          return { ok: false, status: 0, answers: [], errText: '' };
        }

        if (res.ok) {
          const data = await res.json();
          return { ok: true, status: res.status, answers: extractAnswersFromData(data), errText: '' };
        } else {
          const errText = await res.text().catch(() => '');
          return { ok: false, status: res.status, answers: [], errText };
        }
      } catch (err: any) {
        if (signal?.aborted) {
          return { ok: false, status: 0, answers: [], errText: '' };
        }
        const errMsg = err?.name === 'AbortError' ? 'AI 请求超时（60秒）' : String(err);
        return { ok: false, status: 0, answers: [], errText: errMsg };
      } finally {
        window.clearTimeout(timer);
        signal?.removeEventListener('abort', onExternalAbort);
      }
    }

    return runGuardedXhr<{ ok: boolean; status: number; answers: string[]; errText: string }>({
      signal,
      hardTimeoutMs: 65000,
      onAbortResult: () => ({ ok: false, status: 0, answers: [], errText: '' }),
      onTimeoutResult: () => ({ ok: false, status: 0, answers: [], errText: 'AI 请求硬超时（65秒）' }),
      execute: (safeResolve, setReq) => {
        const req = xhr({
          url: endpoint,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${aiApiKey.trim()}`
          },
          data: bodyStr,
          timeout: 60000,
          onload: (res: any) => {
            if (signal?.aborted) {
              return safeResolve({ ok: false, status: 0, answers: [], errText: '' });
            }
            try {
              if (res.status >= 200 && res.status < 300) {
                const data = JSON.parse(res.responseText);
                safeResolve({ ok: true, status: res.status, answers: extractAnswersFromData(data), errText: '' });
              } else {
                safeResolve({ ok: false, status: res.status, answers: [], errText: String(res.responseText || '') });
              }
            } catch (err) {
              safeResolve({ ok: false, status: res.status || 0, answers: [], errText: `解析响应失败: ${String(err)}` });
            }
          },
          onerror: (err: any) => {
            if (signal?.aborted) {
              return safeResolve({ ok: false, status: 0, answers: [], errText: '' });
            }
            safeResolve({ ok: false, status: 0, answers: [], errText: `网络错误: ${String(err)}` });
          },
          ontimeout: () => {
            if (signal?.aborted) {
              return safeResolve({ ok: false, status: 0, answers: [], errText: '' });
            }
            safeResolve({ ok: false, status: 0, answers: [], errText: 'AI 请求超时（60秒）' });
          },
          onabort: () => {
            safeResolve({ ok: false, status: 0, answers: [], errText: '' });
          }
        });
        setReq(req);
      }
    });
  };

  const isMultimodalError = (status: number, errText: string): boolean => {
    if (status === 413) return true;
    const lower = (errText || '').toLowerCase();
    if (
      lower.includes('payload too large') ||
      lower.includes('entity too large') ||
      lower.includes('request too large')
    ) {
      return true;
    }
    if (status === 400 || status === 422) {
      return (
        lower.includes('image') ||
        lower.includes('vision') ||
        lower.includes('multimodal') ||
        lower.includes('content')
      );
    }
    return false;
  };

  const hasImages = Boolean(question.images && question.images.length > 0);
  let forcePlainText = false;

  // Attempt 1: Full configured request
  let firstRes = await sendSingleRequest(buildPayload(true, undefined, forcePlainText));
  if (signal?.aborted) return [];
  if (firstRes.ok && firstRes.answers.length > 0) {
    return firstRes.answers;
  }

  // Vision fallback: if model doesn't support images or payload too large
  // (HTTP 413, or HTTP 400/422 with multimodal/image/content error, or 'too large' text)
  if (
    hasImages &&
    !forcePlainText &&
    (firstRes.status === 413 ||
      isMultimodalError(firstRes.status, firstRes.errText) ||
      firstRes.status === 400 ||
      firstRes.status === 422)
  ) {
    store.addLog('检测到图片过大或当前模型不支持多模态识图，自动降级为纯文本重试', 'warning');
    forcePlainText = true;
    firstRes = await sendSingleRequest(buildPayload(true, undefined, forcePlainText));
    if (signal?.aborted) return [];
    if (firstRes.ok && firstRes.answers.length > 0) {
      return firstRes.answers;
    }
  }

  // Attempt 2: Automatic fallback retry if Attempt 1 failed or returned empty
  // 若包含图片且仍遭遇 413 或 400/422，立即强制纯文本
  if (
    hasImages &&
    (firstRes.status === 413 ||
      firstRes.status === 400 ||
      firstRes.status === 422 ||
      isMultimodalError(firstRes.status, firstRes.errText))
  ) {
    forcePlainText = true;
  }

  const isParamError = firstRes.status === 400 || firstRes.status === 422 || firstRes.status === 413;
  const hasEffort = Boolean(reasoningEffort && reasoningEffort !== 'none');
  const retryBody =
    isParamError && hasEffort
      ? reasoningEffort === 'max'
        ? buildPayload(true, 'high', forcePlainText)
        : buildPayload(false, undefined, forcePlainText)
      : buildPayload(!isParamError, undefined, forcePlainText);

  let secondRes = await sendSingleRequest(retryBody);
  if (signal?.aborted) return [];
  if (secondRes.ok && secondRes.answers.length > 0) {
    return secondRes.answers;
  }

  // Attempt 3: 终极保底重试（无论 Attempt 2 还是 Attempt 1，若带图或参数冲突失败，彻底强制纯文本 + 零 reasoning_effort）
  const ultimateForcePlain = hasImages ? true : forcePlainText;
  const thirdRes = await sendSingleRequest(buildPayload(false, undefined, ultimateForcePlain));
  if (signal?.aborted) return [];
  if (thirdRes.ok && thirdRes.answers.length > 0) {
    return thirdRes.answers;
  }

  if (signal?.aborted) return [];

  const finalErr = thirdRes.errText || secondRes.errText || firstRes.errText;
  const finalStatus = thirdRes.status || secondRes.status || firstRes.status;
  if (finalStatus > 0) {
    store.addLog(`AI 接口返回错误 HTTP ${finalStatus}: ${finalErr.slice(0, 100)}`, 'error');
  } else if (finalErr) {
    store.addLog(`AI 请求失败: ${finalErr.slice(0, 100)}`, 'error');
  }

  return [];
};
