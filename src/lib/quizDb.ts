// 스피드 퀴즈 어댑터 단일 진입점 (Quiz v1.0)
//   Supabase 환경변수가 있으면 RPC + Realtime(quiz_state) + 3초 폴링,
//   없으면 localStorage + BroadcastChannel(같은 브라우저 탭끼리) — 보드와 같은 패턴.

import { hasSupabaseEnv } from './supabaseClient';
import { createLocalQuizAdapter } from './quizDb.local';
import { createSupabaseQuizAdapter } from './quizDb.supabase';
import type {
  QuizAdminSnapshot,
  QuizControlAction,
  QuizMySubmission,
  QuizParticipant,
  QuizRole,
  QuizScoreRow,
  QuizState,
  QuizTeamStatus,
} from './quizTypes';

/** 진행 중 문제의 판정 집계 — 운영자 화면이 계산해 올리고 송출 화면이 읽는다 */
export interface QuizLiveCounts {
  correct: number;
  wrong: number;
  review: number;
}

export interface QuizCounts {
  participants: number;
  /** v2.0 — 사람이 들어온 조 수 · 답변자가 있는 조 수 */
  teams?: number;
  answerers?: number;
  submissions: number;
  /** 운영자 화면이 올린 현재 문제의 정답/오답 집계 (없으면 null) */
  live?: QuizLiveCounts | null;
}

export interface QuizAdapter {
  readonly mode: 'supabase' | 'local';

  /** 서버 시각(ms) — 시계 맞추기용 */
  serverNow(): Promise<number>;
  getState(): Promise<QuizState>;
  /**
   * quiz_state 구독. Realtime(또는 BroadcastChannel)로 바로 받고, 막힌 환경에 대비해
   * 3초마다 폴링도 한다. updated_at이 바뀐 경우에만 콜백. 반환값을 호출하면 해제.
   */
  subscribeState(cb: (state: QuizState) => void): () => void;

  join(name: string, tableNo: number): Promise<QuizParticipant>;
  /** v2.0 — 조 입장(역할 포함). 답변자가 이미 있으면 takeover=true일 때만 넘겨받는다 */
  joinTeam(tableNo: number, role: QuizRole, takeover: boolean): Promise<QuizParticipant>;
  setRole(participantId: string, role: QuizRole, takeover: boolean): Promise<QuizParticipant>;
  teamStatus(participantId: string, index: number): Promise<QuizTeamStatus | null>;
  scoreboard(teams: number): Promise<QuizScoreRow[]>;
  me(id: string): Promise<QuizParticipant | null>;
  /** 제출 — 서버 제출 시각(ISO)을 돌려준다. 실패하면 QuizError */
  submit(participantId: string, index: number, answer: string): Promise<string>;
  mySubmission(participantId: string, index: number): Promise<QuizMySubmission | null>;
  counts(index: number): Promise<QuizCounts>;

  // 운영자
  control(key: string, action: QuizControlAction): Promise<QuizState>;
  adminSnapshot(key: string, index: number | null): Promise<QuizAdminSnapshot>;
  /** 현재 문제 정답/오답 집계를 송출 화면용으로 올린다(실시간 방송 없음 — 송출 화면이 2초마다 읽음) */
  pushLive(key: string, index: number, live: QuizLiveCounts): Promise<void>;
}

let cached: QuizAdapter | null = null;

export function getQuizDb(): QuizAdapter {
  if (cached) return cached;
  cached = hasSupabaseEnv() ? createSupabaseQuizAdapter() : createLocalQuizAdapter();
  return cached;
}

export { STATE_POLL_MS } from './quizTypes';
