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
    try {
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), 15000);
      const res = await window.fetch(endpoint, {
        method: 'GET',
        headers,
        signal: controller.signal
      });
      window.clearTimeout(timer);

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
    }
  }

  return new Promise<string[]>((resolve) => {
    xhr({
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
            resolve(parsed.ids);
          } else {
            store.addLog(`拉取模型列表失败 HTTP ${res.status}: ${res.responseText.slice(0, 100)}`, 'error');
            resolve([]);
          }
        } catch (err) {
          store.addLog(`解析模型列表失败: ${String(err)}`, 'error');
          resolve([]);
        }
      },
      onerror: (err: any) => {
        store.addLog(`拉取模型列表失败，网络错误: ${String(err)}`, 'error');
        resolve([]);
      },
      ontimeout: () => {
        store.addLog('拉取模型列表超时（15秒）', 'error');
        resolve([]);
      }
    });
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
    id.includes('o3_')
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

  const targetModel = aiModel.trim() || 'deepseek-chat';
  const isReasoning =
    (reasoningEffort && reasoningEffort !== 'none') ||
    detectModelReasoningCapability(targetModel) !== 'unsupported';

  const messages = buildAiPrompt(question.type, question.title, question.options, paperContext);

  const buildPayload = (includeReasoningEffort: boolean, fallbackEffort?: string) => {
    const p: any = {
      model: targetModel,
      messages,
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
    let answers = parseAiResponse(rawContent);
    if (answers.length === 0 && msg?.reasoning_content) {
      answers = parseAiResponse(String(msg.reasoning_content));
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
        window.clearTimeout(timer);

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
        window.clearTimeout(timer);
        if (signal?.aborted) {
          return { ok: false, status: 0, answers: [], errText: '' };
        }
        const errMsg = err?.name === 'AbortError' ? 'AI 请求超时（60秒）' : String(err);
        return { ok: false, status: 0, answers: [], errText: errMsg };
      } finally {
        signal?.removeEventListener('abort', onExternalAbort);
      }
    }

    return new Promise((resolve) => {
      if (signal?.aborted) {
        return resolve({ ok: false, status: 0, answers: [], errText: '' });
      }

      let req: any = null;
      const cleanupSignal = () => {
        signal?.removeEventListener('abort', onExternalAbort);
      };
      const onExternalAbort = () => {
        cleanupSignal();
        try {
          if (req && typeof req.abort === 'function') {
            req.abort();
          }
        } catch {}
        resolve({ ok: false, status: 0, answers: [], errText: '' });
      };
      signal?.addEventListener('abort', onExternalAbort, { once: true });

      req = xhr({
        url: endpoint,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${aiApiKey.trim()}`
        },
        data: bodyStr,
        timeout: 60000,
        onload: (res: any) => {
          cleanupSignal();
          if (signal?.aborted) {
            return resolve({ ok: false, status: 0, answers: [], errText: '' });
          }
          try {
            if (res.status >= 200 && res.status < 300) {
              const data = JSON.parse(res.responseText);
              resolve({ ok: true, status: res.status, answers: extractAnswersFromData(data), errText: '' });
            } else {
              resolve({ ok: false, status: res.status, answers: [], errText: String(res.responseText || '') });
            }
          } catch (err) {
            resolve({ ok: false, status: res.status || 0, answers: [], errText: `解析响应失败: ${String(err)}` });
          }
        },
        onerror: (err: any) => {
          cleanupSignal();
          if (signal?.aborted) {
            return resolve({ ok: false, status: 0, answers: [], errText: '' });
          }
          resolve({ ok: false, status: 0, answers: [], errText: `网络错误: ${String(err)}` });
        },
        ontimeout: () => {
          cleanupSignal();
          if (signal?.aborted) {
            return resolve({ ok: false, status: 0, answers: [], errText: '' });
          }
          resolve({ ok: false, status: 0, answers: [], errText: 'AI 请求超时（60秒）' });
        }
      });
    });
  };

  // Attempt 1: Full configured request
  const firstRes = await sendSingleRequest(buildPayload(true));
  if (signal?.aborted) return [];
  if (firstRes.ok && firstRes.answers.length > 0) {
    return firstRes.answers;
  }

  // Attempt 2: Automatic fallback retry if Attempt 1 failed or returned empty
  // If HTTP 400/422 occurred with reasoning_effort, downgrade 'max' -> 'high' or strip reasoning_effort
  const isParamError = firstRes.status === 400 || firstRes.status === 422;
  const hasEffort = Boolean(reasoningEffort && reasoningEffort !== 'none');
  const retryBody =
    isParamError && hasEffort
      ? reasoningEffort === 'max'
        ? buildPayload(true, 'high')
        : buildPayload(false)
      : buildPayload(!isParamError);

  const secondRes = await sendSingleRequest(retryBody);
  if (signal?.aborted) return [];
  if (secondRes.ok && secondRes.answers.length > 0) {
    return secondRes.answers;
  }

  // If second attempt still failed with HTTP 400 when downgrading 'max' -> 'high', try once more without reasoning_effort
  if ((secondRes.status === 400 || secondRes.status === 422) && hasEffort && reasoningEffort === 'max') {
    const thirdRes = await sendSingleRequest(buildPayload(false));
    if (signal?.aborted) return [];
    if (thirdRes.ok && thirdRes.answers.length > 0) {
      return thirdRes.answers;
    }
  }

  if (signal?.aborted) return [];

  const finalErr = secondRes.errText || firstRes.errText;
  const finalStatus = secondRes.status || firstRes.status;
  if (finalStatus > 0) {
    store.addLog(`AI 接口返回错误 HTTP ${finalStatus}: ${finalErr.slice(0, 100)}`, 'error');
  } else if (finalErr) {
    store.addLog(`AI 请求失败: ${finalErr.slice(0, 100)}`, 'error');
  }

  return [];
};
