// 스피드 퀴즈 — 공통 타입 (Quiz v1.0). 테이블 구조는 supabase/quiz_schema.sql과 같다.

export type QuizStatus = 'lobby' | 'open' | 'closed' | 'revealed' | 'final';
export type QuizDisplayMode = 'full' | 'keyword';
export type QuizVerdict = 'correct' | 'wrong';

/** 공개 시 운영자가 내려보내는 값 — 참가자·스크린은 정답을 여기서만 받는다 */
export interface QuizReveal {
  index: number;
  answer: string;
  explanation: string;
  winner: { participant_id: string; name: string; table_no: number } | null;
  /**
   * 최종 정답 제출들의 서버 시각(오름차순). 참가자 화면이 내 제출 시각과 비교해 'N번째 정답'을 계산한다.
   * 참가자 id는 담지 않는다(id가 곧 제출 권한이므로).
   */
  correct_times?: string[];
}

export interface QuizLeaderRow {
  rank: number;
  participant_id: string;
  name: string;
  table_no: number;
  correct: number;
  /** 맞힌 문제들의 응답 시간 합(ms) — 동점 시 작은 쪽이 앞 */
  latency_ms: number;
}

export interface QuizSettings {
  /** 문항별 키워드(‘키워드만’ 표시 모드) — index 문자열 키 */
  keywords?: Record<string, string>;
  /** 문항별 제한시간(초) */
  durations?: Record<string, number>;
  /** 문항별로 마지막으로 연 시각(ISO) — 경과 ms 계산용 */
  opened?: Record<string, string>;
}

export interface QuizState {
  status: QuizStatus;
  current_index: number;
  opened_at: string | null;
  duration_sec: number;
  display_mode: QuizDisplayMode;
  /** 마감 전 답 수정 허용 (기본 꺼짐 = 1인 1문항 1회 제출) */
  allow_edit: boolean;
  winner_submission_id: string | null;
  settings: QuizSettings;
  reveal: QuizReveal | null;
  leaderboard: QuizLeaderRow[] | null;
  updated_at: string;
}

export interface QuizParticipant {
  id: string;
  name: string;
  table_no: number;
  created_at: string;
}

export interface QuizSubmission {
  id: string;
  question_index: number;
  participant_id: string;
  answer: string;
  /** 서버 시각 (제출 시각, 수정 허용 시 마지막 수정 시각) */
  created_at: string;
  auto_verdict: string | null;
  verdict: QuizVerdict | null;
}

export interface QuizWinner {
  question_index: number;
  participant_id: string;
  submission_id: string;
}

/** 참가자가 자기 답만 읽는 형태 */
export interface QuizMySubmission {
  answer: string;
  created_at: string;
  verdict: QuizVerdict | null;
}

export interface QuizAdminSnapshot {
  participants: QuizParticipant[];
  submissions: QuizSubmission[];
  winners: QuizWinner[];
}

export type QuizControlAction =
  | { action: 'open'; index: number; duration_sec: number }
  | { action: 'extend'; seconds: number }
  | { action: 'close' }
  | { action: 'set_verdict'; submission_id: string; verdict: QuizVerdict | null }
  | { action: 'set_winner'; index: number; submission_id: string | null }
  | {
      action: 'reveal';
      reveal: QuizReveal;
      verdicts: Record<string, { auto: string | null; verdict: QuizVerdict }>;
    }
  | { action: 'next'; index: number }
  | {
      action: 'settings';
      display_mode?: QuizDisplayMode;
      allow_edit?: boolean;
      keywords?: Record<string, string>;
      durations?: Record<string, number>;
    }
  | { action: 'final'; leaderboard: QuizLeaderRow[] | null }
  | { action: 'reset_question'; index: number }
  | { action: 'reset_all'; participants: boolean };

export type QuizErrorCode =
  | 'QUIZ_CLOSED'
  | 'QUIZ_DUPLICATE'
  | 'QUIZ_UNKNOWN'
  | 'QUIZ_EMPTY'
  | 'QUIZ_FORBIDDEN'
  | 'QUIZ_ALREADY_WON'
  | 'QUIZ_NETWORK';

export class QuizError extends Error {
  constructor(
    public code: QuizErrorCode,
    message?: string,
  ) {
    super(message ?? code);
  }
}

/** 오류 코드 → 사용자 문구 */
export const QUIZ_ERROR_TEXT: Record<QuizErrorCode, string> = {
  QUIZ_CLOSED: '제출이 마감되었습니다',
  QUIZ_DUPLICATE: '이미 제출했습니다',
  QUIZ_UNKNOWN: '참가 정보가 없습니다. 다시 입장해 주세요',
  QUIZ_EMPTY: '답을 입력해 주세요',
  QUIZ_FORBIDDEN: '운영자 키가 맞지 않습니다',
  QUIZ_ALREADY_WON: '이미 다른 문제에서 상품을 받은 사람입니다',
  QUIZ_NETWORK: '연결이 불안정합니다. 잠시 후 다시 시도해 주세요',
};

export const EMPTY_QUIZ_STATE: QuizState = {
  status: 'lobby',
  current_index: 0,
  opened_at: null,
  duration_sec: 90,
  display_mode: 'full',
  allow_edit: false,
  winner_submission_id: null,
  settings: {},
  reveal: null,
  leaderboard: null,
  updated_at: new Date(0).toISOString(),
};

/** 제출 마감 여유 — 서버가 opened_at + duration 뒤 이만큼은 더 받아 준다 */
export const SUBMIT_GRACE_MS = 2000;

/** 상태 폴링 주기 — 웹소켓이 막힌 환경(원격 격리 브라우저)에서도 ≤3초 안에 상태가 도착하게 */
export const STATE_POLL_MS = 3000;
