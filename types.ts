
export type Difficulty = 'easy' | 'medium' | 'hard';

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
  pageAyahs?: AyahPageContext[]; // الآيات المحيطة لتشكيل صفحة القرآن
}

export interface WordMatch {
  text: string;
  isCorrect: boolean;
  correction?: string;
}

export interface EvaluationResult {
  status: 'correct' | 'minor_mistakes' | 'incorrect';
  statusIcon: string;
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
}

export interface HistoryItem {
  id: string;
  ayahNumber: number;
  pageNumber: number;
  difficulty: Difficulty;
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
