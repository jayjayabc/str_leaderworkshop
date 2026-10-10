// 토의보드 어댑터 단일 진입점 (Board v1.2)
//   Supabase 환경변수가 있으면 RPC + Realtime(board_state) + 3초 폴링,
//   없으면 localStorage + BroadcastChannel(같은 브라우저 탭끼리) — 퀴즈와 같은 패턴.

import { hasSupabaseEnv } from './supabaseClient';
import { createLocalBoardAdapter } from './boardDb.local';
import { createSupabaseBoardAdapter } from './boardDb.supabase';
import type { BoardGroupId } from './boardSeed';
import type { BoardSummary } from './boardSummary';
import type {
  BoardAdminSnapshot,
  BoardCard,
  BoardCounts,
  BoardMe,
  BoardModerateAction,
  BoardMyView,
  BoardMyVotes,
  BoardRankRow,
  BoardRole,
  BoardState,
  BoardStatePatch,
} from './boardTypes';

export interface BoardAdapter {
  readonly mode: 'supabase' | 'local';

  serverNow(): Promise<number>;
  getState(): Promise<BoardState>;
  /** board_state 구독 — Realtime(또는 BroadcastChannel) + 3초 폴링. 반환값을 호출하면 해제 */
  subscribeState(cb: (state: BoardState) => void): () => void;

  /** role 기본 'recorder'. 같은 기기가 같은 반조로 다시 입장하면 역할을 갱신 */
  join(teamId: string, name: string, device: string, role?: BoardRole): Promise<BoardMe>;
  /** 내 정보 + 우리 반조 제출. 참가자가 지워졌으면 null */
  my(participantId: string): Promise<BoardMyView | null>;
  /** 지금 열린 그룹의 항목들 제출 — 서버 제출 시각(ISO) */
  submit(participantId: string, bodies: Record<string, string>): Promise<string>;
  counts(): Promise<BoardCounts>;
  /** 모아보기 카드 (숨김·빈 본문 제외, 반조 정보 없음 — card 키만). 송출 중 그룹이거나 모아보기 공개일 때만 */
  feed(groups: BoardGroupId[]): Promise<BoardCard[]>;
  /** 투표(on=true) / 취소(on=false). 관전자·기록자 모두. 반환 = 내 표 */
  vote(participantId: string, group: BoardGroupId, card: string, on: boolean): Promise<BoardMyVotes>;
  myVotes(participantId: string, group: BoardGroupId): Promise<BoardMyVotes>;
  /** 순위 — 순위 공개 + 투표 대상 그룹일 때만 (득표순, 반조 정보 없음) */
  ranking(group: BoardGroupId): Promise<BoardRankRow[]>;

  // 운영자
  adminSnapshot(key: string): Promise<BoardAdminSnapshot>;
  setState(key: string, patch: BoardStatePatch): Promise<BoardState>;
  moderate(key: string, submissionId: string, action: BoardModerateAction, note?: string): Promise<void>;
  reset(key: string, scope: 'group' | 'all', group?: BoardGroupId): Promise<void>;

  // AI 갈무리 (v1.2)
  /** 저장된 갈무리 리포트 전부 (그룹당 하나) */
  summaries(key: string): Promise<BoardSummary[]>;
  /** 그 그룹의 보이는 답을 AI 로 묶어 저장 — 10~30초. 실패하면 BOARD_NO_AI_KEY / BOARD_AI_FAILED / BOARD_EMPTY / BOARD_FORBIDDEN */
  summarize(key: string, group: BoardGroupId): Promise<BoardSummary>;
  /** 송출(group) / 내리기(null). 반환 = 바뀐 상태 */
  showSummary(key: string, group: BoardGroupId | null): Promise<BoardState>;
}

let cached: BoardAdapter | null = null;

export function getBoardDb(): BoardAdapter {
  if (cached) return cached;
  cached = hasSupabaseEnv() ? createSupabaseBoardAdapter() : createLocalBoardAdapter();
  return cached;
}
