export interface RemoteModelItem {
  id: string;
  name?: string;
  supported_parameters?: string[];
  supported_reasoning_effort?: string[];
  capabilities?: Record<string, any>;
  reasoning?: boolean | Record<string, any>;
  [key: string]: any;
}

export interface EnabledQuestionTypes {
  single: boolean;
  multiple: boolean;
  judge: boolean;
  fill: boolean;
  essay: boolean;
}

export interface AppConfig {
  autoNextChapter: boolean;
  autoSubmitWork: boolean;
  minWorkAccuracy: number;
  randomDelayBase: number;
  randomDelayJitter: number;
  aiProvider: 'deepseek' | 'custom';
  aiApiKey: string;
  aiBaseUrl: string;
  aiModel: string;
  reasoningEffort?: 'none' | 'low' | 'medium' | 'high' | 'max' | string;
  cachedModelList?: string[];
  cachedModelItems?: RemoteModelItem[];
  enabledQuestionTypes?: EnabledQuestionTypes;
  panelMinimized: boolean;
  panelPosition: { x: number; y: number };
}

export type LogLevel = 'info' | 'success' | 'warning' | 'error';

export interface LogItem {
  id: string;
  time: string;
  message: string;
  level: LogLevel;
  count?: number;
}

export type QuestionType = 'single' | 'multiple' | 'judge' | 'fill' | 'essay' | 'unknown';

export type QuestionSubType = 'definition' | 'short_answer' | 'discussion';

export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

export interface Question {
  id: string;
  index: number;
  type: QuestionType;
  subType?: QuestionSubType;
  title: string;
  options: string[];
  images?: string[];
  answer?: string[];
  status: 'pending' | 'searching' | 'success' | 'failed';
}

export interface TaskProgress {
  title: string;
  percent: number;
  currentTime: string;
  duration: string;
  status: 'idle' | 'playing' | 'paused' | 'finished';
}

export interface IframeContext {
  signal: AbortSignal;
  isCurrent: () => boolean;
}
