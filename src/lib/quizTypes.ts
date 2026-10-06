// 스피드 퀴즈 — 공통 타입 (Quiz v2.0 단체전). 테이블 구조는 supabase/quiz_schema.sql과 같다.

export type QuizStatus = 'lobby' | 'open' | 'closed' | 'revealed' | 'final';
export type QuizDisplayMode = 'full' | 'keyword';
export type QuizVerdict = 'correct' | 'wrong';

/** 공개 시 운영자가 내려보내는 값 — 참가자·스크린은 정답을 여기서만 받는다 */
export interface QuizReveal {
  index: number;
  answer: string;
  explanation: string;
  /** 첫 정답자 — 참가자 id 대신 pid_hash(quizHash.ts)만 싣는다 */
  winner: { pid_hash: string; name: string; table_no: number } | null;
  /**
   * 최종 정답 제출들의 서버 시각(오름차순). 참가자 화면이 내 제출 시각과 비교해 'N번째 정답'을 계산한다.
   * 참가자 id는 담지 않는다(id가 곧 제출 권한이므로).
   */
  correct_times?: string[];
  /** 공개 시점의 조별 누적 정답(순위순) + 이번 문제에서 얻은 정답 수 */
  teams?: QuizRevealTeam[];
  /** v2.0 단체전 — 이 문제를 맞힌 조 번호들 */
  correct_teams?: number[];
  /** v2.0 단체전 — 이 문제의 배점 */
  points?: number;
  /** v2.1 선착순 — 이 문제에 적용된 규칙(꺼져 있으면 없음) */
  speed?: SpeedRule | null;
  /** v2.1 — 맞힌 조별 정답 순서·받은 점수 (조 번호 문자열 키) */
  awards?: Record<string, { rank: number; pts: number }>;
}

/** v2.1 선착순 가산 — 정답 순서 upto등까지 mode(x = 배수, + = 추가점수) v 적용. 위 구간부터 본다 */
export interface SpeedTier {
  upto: number;
  mode: 'x' | '+';
  v: number;
}
export interface SpeedRule {
  on: boolean;
  tiers: SpeedTier[];
}

/** v2.0 점수판 한 줄 (quiz_scoreboard) */
export interface QuizScoreRow {
  team_no: number;
  score: number;
  correct: number;
  members: number;
}

export type QuizRole = 'answerer' | 'spectator';

/** v2.0 — 우리 조 상황 (quiz_team_status) */
export interface QuizTeamStatus {
  team_no: number;
  role: QuizRole;
  /** 우리 조에 답변자가 있는지 */
  answerer: boolean;
  members: number;
  submission: QuizMySubmission | null;
}

export interface QuizRevealTeam {
  rank: number;
  table_no: number;
  correct: number;
  /** 이번 문제 정답 수 */
  gained: number;
}

/** 종료 화면 개인 순위 한 줄 — 방송되므로 참가자 id 대신 pid_hash */
export interface QuizLeaderRow {
  rank: number;
  pid_hash: string;
  name: string;
  table_no: number;
  correct: number;
  /** 맞힌 문제들의 응답 시간 합(ms) — 동점 시 작은 쪽이 앞 */
  latency_ms: number;
}

/** 조별 집계 한 줄 — 테이블(조) 단위 정답 합계 */
export interface QuizTeamRow {
  rank: number;
  table_no: number;
  /** 입장한 조원 수 */
  members: number;
  /** 조원 정답 합계(본 문제만) */
  correct: number;
  /** 1인당 평균 정답 수 */
  avg: number;
}

/** 종료 화면 순위 — 개인 상위 N, 조별 순위 (둘 다 선택) */
export interface QuizBoard {
  people: QuizLeaderRow[] | null;
  teams: QuizTeamRow[] | null;
}

/** 예전 형식(개인 순위 배열)과 새 형식(QuizBoard)을 모두 읽는다 */
export function readBoard(raw: QuizState['leaderboard']): QuizBoard {
  if (!raw) return { people: null, teams: null };
  if (Array.isArray(raw)) return { people: raw, teams: null };
  return { people: raw.people ?? null, teams: raw.teams ?? null };
}

export interface QuizSettings {
  /** 문항별 키워드(‘키워드만’ 표시 모드) — index 문자열 키 */
  keywords?: Record<string, string>;
  /** 문항별 제한시간(초) */
  durations?: Record<string, number>;
  /** 문항별 배점 — 없으면 기본 배점(문항 정의의 points) */
  points?: Record<string, number>;
  /** v2.1 문항별 선착순 가산 규칙 */
  speed?: Record<string, SpeedRule | null>;
  /** 1인 1회 수상 규칙 (기본 꺼짐 — 켜면 이미 상을 받은 사람은 첫 정답 후보에서 빠진다) */
  one_win?: boolean;
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
  leaderboard: QuizLeaderRow[] | QuizBoard | null;
  updated_at: string;
}

export interface QuizParticipant {
  id: string;
  name: string;
  /** 조 번호 */
  table_no: number;
  /** v2.0 — 답변자(조당 1명) / 관전자 */
  role?: QuizRole;
  created_at: string;
}

export interface QuizSubmission {
  id: string;
  question_index: number;
  participant_id: string;
  /** v2.0 — 조 번호 (조 단위 제출) */
  team_no?: number | null;
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
      one_win?: boolean;
      keywords?: Record<string, string>;
      durations?: Record<string, number>;
      points?: Record<string, number>;
      speed?: Record<string, SpeedRule | null>;
    }
  | { action: 'final'; leaderboard: QuizBoard | null }
  | { action: 'reset_question'; index: number }
  | { action: 'reset_all'; participants: boolean };

export type QuizErrorCode =
  | 'QUIZ_CLOSED'
  | 'QUIZ_DUPLICATE'
  | 'QUIZ_UNKNOWN'
  | 'QUIZ_EMPTY'
  | 'QUIZ_FORBIDDEN'
  | 'QUIZ_ALREADY_WON'
  | 'QUIZ_ANSWERER_TAKEN'
  | 'QUIZ_NOT_ANSWERER'
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
  QUIZ_ANSWERER_TAKEN: '이 조에는 이미 답변자가 있습니다',
  QUIZ_NOT_ANSWERER: '답변자만 제출할 수 있습니다',
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
