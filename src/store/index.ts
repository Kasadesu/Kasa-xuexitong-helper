import { AppConfig, LogItem, Question, LogLevel, TaskProgress } from '../types';

const STORAGE_KEY = 'kasa_xuexitong_config_v2';
const LEGACY_STORAGE_KEYS = [
  'kasa_xuexitong_config',
  'kasa_config',
  'xuexitong_helper_config'
];

export const AI_PROVIDER_PRESETS: Record<AppConfig['aiProvider'], { baseUrl: string; model: string }> = {
  deepseek: {
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat'
  },
  custom: {
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini'
  }
};

const DEFAULT_CONFIG: AppConfig = {
  autoNextChapter: true,
  autoSubmitWork: false,
  minWorkAccuracy: 80,
  randomDelayBase: 3.0,
  randomDelayJitter: 1.2,
  aiProvider: 'deepseek',
  aiApiKey: '',
  aiBaseUrl: AI_PROVIDER_PRESETS.deepseek.baseUrl,
  aiModel: AI_PROVIDER_PRESETS.deepseek.model,
  reasoningEffort: 'none',
  cachedModelList: [],
  cachedModelItems: [],
  enabledQuestionTypes: {
    single: true,
    multiple: true,
    judge: true,
    fill: true,
    essay: true
  },
  panelMinimized: false,
  panelPosition: {
    x: typeof window !== 'undefined' && typeof window.innerWidth === 'number' ? window.innerWidth - 340 : 1000,
    y: 120
  }
};

type Listener = () => void;

class Store {
  public config: AppConfig;
  public logs: LogItem[] = [];
  public questions: Question[] = [];
  public progress: TaskProgress = {
    title: '等待任务开始...',
    percent: 0,
    currentTime: '00:00',
    duration: '00:00',
    status: 'idle'
  };
  private listeners: Set<Listener> = new Set();

  constructor() {
    this.config = this.loadConfig();
  }

  private loadConfig(): AppConfig {
    const sanitizeConfig = (parsed: any): AppConfig => {
      const provider: AppConfig['aiProvider'] = (parsed.aiProvider === 'deepseek' || parsed.aiProvider === 'custom')
        ? parsed.aiProvider
        : 'custom';
      return {
        ...DEFAULT_CONFIG,
        ...parsed,
        aiProvider: provider
      };
    };

    const keysToTry = [STORAGE_KEY, ...LEGACY_STORAGE_KEYS];
    try {
      // @ts-ignore
      if (typeof GM_getValue === 'function') {
        for (const key of keysToTry) {
          // @ts-ignore
          const gmRaw = GM_getValue(key, null);
          if (gmRaw) {
            const parsed = typeof gmRaw === 'string' ? JSON.parse(gmRaw) : gmRaw;
            if (parsed && typeof parsed === 'object') {
              return sanitizeConfig(parsed);
            }
          }
        }
      }
      if (typeof localStorage !== 'undefined') {
        for (const key of keysToTry) {
          const raw = localStorage.getItem(key);
          if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === 'object') {
              return sanitizeConfig(parsed);
            }
          }
        }
      }
    } catch (e) {
      console.warn('[KasaStore] Failed to load config from storage', e);
    }
    return { ...DEFAULT_CONFIG };
  }

  public exportConfigString(): string {
    try {
      const exportData = {
        aiProvider: this.config.aiProvider,
        aiApiKey: this.config.aiApiKey,
        aiBaseUrl: this.config.aiBaseUrl,
        aiModel: this.config.aiModel,
        reasoningEffort: this.config.reasoningEffort,
        autoNextChapter: this.config.autoNextChapter,
        cachedModelList: this.config.cachedModelList,
        enabledQuestionTypes: this.config.enabledQuestionTypes
      };
      return btoa(unescape(encodeURIComponent(JSON.stringify(exportData))));
    } catch {
      return '';
    }
  }

  public importConfigString(encoded: string): boolean {
    try {
      const jsonStr = decodeURIComponent(escape(atob(encoded.trim())));
      const data = JSON.parse(jsonStr);
      if (typeof data !== 'object' || !data) return false;
      const provider: AppConfig['aiProvider'] = (data.aiProvider === 'deepseek' || data.aiProvider === 'custom')
        ? data.aiProvider
        : 'custom';
      this.updateConfig({
        aiProvider: provider,
        aiApiKey: data.aiApiKey !== undefined ? data.aiApiKey : this.config.aiApiKey,
        aiBaseUrl: data.aiBaseUrl || this.config.aiBaseUrl,
        aiModel: data.aiModel || this.config.aiModel,
        reasoningEffort: data.reasoningEffort || this.config.reasoningEffort,
        autoNextChapter: data.autoNextChapter !== undefined ? data.autoNextChapter : this.config.autoNextChapter,
        cachedModelList: Array.isArray(data.cachedModelList) ? data.cachedModelList : this.config.cachedModelList,
        enabledQuestionTypes: data.enabledQuestionTypes || this.config.enabledQuestionTypes
      });
      return true;
    } catch {
      return false;
    }
  }

  public reloadConfig() {
    this.config = this.loadConfig();
  }

  public saveConfig() {
    try {
      const serialized = JSON.stringify(this.config);
      // @ts-ignore
      if (typeof GM_setValue === 'function') {
        // @ts-ignore
        GM_setValue(STORAGE_KEY, serialized);
      }
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(STORAGE_KEY, serialized);
      }
    } catch (e) {
      console.warn('[KasaStore] Failed to save config', e);
    }
    this.notify();
  }

  public updateConfig(partial: Partial<AppConfig>) {
    Object.assign(this.config, partial);
    this.saveConfig();
  }

  public addLog(message: string, level: LogLevel = 'info') {
    const now = new Date();
    const time = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`;
    const item: LogItem = {
      id: Math.random().toString(36).slice(2, 9),
      time,
      message,
      level
    };
    this.logs.unshift(item);
    if (this.logs.length > 100) {
      this.logs.pop();
    }
    this.notify();
  }

  public updateProgress(partial: Partial<TaskProgress>) {
    Object.assign(this.progress, partial);
    this.notify();
  }

  public setQuestions(questions: Question[]) {
    this.questions = questions;
    this.notify();
  }

  public clearQuestions() {
    this.questions = [];
    this.notify();
  }

  public subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify() {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch (err) {
        console.error('[KasaStore] Listener error', err);
      }
    }
  }
}

export const store = new Store();
