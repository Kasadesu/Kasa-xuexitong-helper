import { AppConfig, LogItem, Question, LogLevel, TaskProgress } from '../types';

const STORAGE_KEY = 'kasa_xuexitong_config_v2';

export const AI_PROVIDER_PRESETS: Record<AppConfig['aiProvider'], { baseUrl: string; model: string }> = {
  deepseek: {
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat'
  },
  siliconflow: {
    baseUrl: 'https://api.siliconflow.cn/v1',
    model: 'deepseek-ai/DeepSeek-V3'
  },
  openai: {
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini'
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
    try {
      // @ts-ignore
      if (typeof GM_getValue === 'function') {
        // @ts-ignore
        const gmRaw = GM_getValue(STORAGE_KEY, null);
        if (gmRaw) {
          const parsed = typeof gmRaw === 'string' ? JSON.parse(gmRaw) : gmRaw;
          return { ...DEFAULT_CONFIG, ...parsed };
        }
      }
      if (typeof localStorage !== 'undefined') {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
          return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
        }
      }
    } catch (e) {
      console.warn('[KasaStore] Failed to load config from storage', e);
    }
    return { ...DEFAULT_CONFIG };
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
