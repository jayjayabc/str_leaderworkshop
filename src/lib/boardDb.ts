// 토의보드 어댑터 단일 진입점 (Board v1.0)
//   Supabase 환경변수가 있으면 RPC + Realtime(board_state) + 3초 폴링,
//   없으면 localStorage + BroadcastChannel(같은 브라우저 탭끼리) — 퀴즈와 같은 패턴.

import { hasSupabaseEnv } from './supabaseClient';
import { createLocalBoardAdapter } from './boardDb.local';
import { createSupabaseBoardAdapter } from './boardDb.supabase';
import type { BoardGroupId } from './boardSeed';
import type {
  BoardAdminSnapshot,
  BoardCard,
  BoardCounts,
  BoardMe,
  BoardModerateAction,
  BoardMyView,
  BoardState,
  BoardStatePatch,
} from './boardTypes';

export interface BoardAdapter {
  readonly mode: 'supabase' | 'local';

  serverNow(): Promise<number>;
  getState(): Promise<BoardState>;
  /** board_state 구독 — Realtime(또는 BroadcastChannel) + 3초 폴링. 반환값을 호출하면 해제 */
  subscribeState(cb: (state: BoardState) => void): () => void;

  join(teamId: string, name: string, device: string): Promise<BoardMe>;
  /** 내 정보 + 우리 반조 제출. 참가자가 지워졌으면 null */
  my(participantId: string): Promise<BoardMyView | null>;
  /** 지금 열린 그룹의 항목들 제출 — 서버 제출 시각(ISO) */
  submit(participantId: string, bodies: Record<string, string>): Promise<string>;
  counts(): Promise<BoardCounts>;
  /** 월 카드 (숨김·빈 본문 제외). 송출 중 그룹이거나 월 공개일 때만 */
  feed(groups: BoardGroupId[]): Promise<BoardCard[]>;

  // 운영자
  adminSnapshot(key: string): Promise<BoardAdminSnapshot>;
  setState(key: string, patch: BoardStatePatch): Promise<BoardState>;
  moderate(key: string, submissionId: string, action: BoardModerateAction, note?: string): Promise<void>;
  reset(key: string, scope: 'group' | 'all', group?: BoardGroupId): Promise<void>;
}

let cached: BoardAdapter | null = null;

export function getBoardDb(): BoardAdapter {
  if (cached) return cached;
  cached = hasSupabaseEnv() ? createSupabaseBoardAdapter() : createLocalBoardAdapter();
  return cached;
}
