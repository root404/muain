
export type Difficulty = 'strict'; // Changed to single strict mode

export interface AyahPageContext {
  ayahNumber: number;
  text: string;
}

export interface AyahData {
  number: number;
  page: number;
  text: string;
  startWords: string;
  previousAyahText?: string;
  previousAyahNumber?: number;
  previousAyahPage?: number;
}

export interface WordMatch {
  text: string;
  isCorrect: boolean;
  correction?: string;
}

export interface EvaluationResult {
  status: 'correct' | 'minor_mistakes' | 'incorrect';
  isPass: boolean; // New strict pass/fail flag
  accuracy: number;
  tajweedScore: number;
  feedback: string;
  tajweedNotes: string;
  memorizationTip: string;
  originalText: string;
  userText: string;
  ayahNumber?: number;
  pageNumber?: number;
  comparison?: WordMatch[];
  userComparison?: WordMatch[];
  pageAyahs?: AyahPageContext[];
}

export interface HistoryItem {
  id: string;
  testId: number; // To track which test block (1-10)
  ayahNumber: number;
  pageNumber: number;
  status: 'correct' | 'minor_mistakes' | 'incorrect';
  accuracy: number;
  timestamp: number;
  textSnippet: string;
}

export enum AppState {
  IDLE = 'IDLE',
  LOADING_AYAH = 'LOADING_AYAH',
  READY = 'READY',
  RECORDING = 'RECORDING',
  CONFIRMING = 'CONFIRMING',
  EVALUATING = 'EVALUATING',
  FINISHED = 'FINISHED',
  SESSION_SUMMARY = 'SESSION_SUMMARY'
}
