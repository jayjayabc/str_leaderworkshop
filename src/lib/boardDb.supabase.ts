// 토의보드 Supabase 어댑터 (Board v1.1) — 스키마는 supabase/board_v1.0_migration.sql · board_v1.1_migration.sql.
//   - 쓰기·조회는 모두 RPC. 테이블 직접 접근은 board_state 읽기뿐이다.
//   - 참가자·송출·운영자 모두 board_state만 구독한다(제출 테이블은 방송하지 않는다).
//     송출 월은 board_feed 를 1초마다, 운영자는 스냅샷을 2초마다 읽는다.
//   - Realtime + 3초 폴링 — 웹소켓이 막힌 환경에서도 ≤3초.

import type { RealtimeChannel } from '@supabase/supabase-js';

import { sb } from './supabaseClient';
import type { BoardAdapter } from './boardDb';
import type { BoardGroupId } from './boardSeed';
import {
  BOARD_STATE_POLL_MS,
  BoardError,
  EMPTY_BOARD_STATE,
  type BoardAdminSnapshot,
  type BoardCard,
  type BoardCounts,
  type BoardErrorCode,
  type BoardMe,
  type BoardModerateAction,
  type BoardMyView,
  type BoardMyVotes,
  type BoardRankRow,
  type BoardRole,
  type BoardState,
  type BoardStatePatch,
} from './boardTypes';

const CODES: BoardErrorCode[] = [
  'BOARD_CLOSED',
  'BOARD_DUPLICATE',
  'BOARD_UNKNOWN',
  'BOARD_EMPTY',
  'BOARD_TOO_LONG',
  'BOARD_FORBIDDEN',
  'BOARD_NOT_RECORDER',
  'BOARD_OWN_CARD',
  'BOARD_VOTE_LIMIT',
  'BOARD_FULL',
];

function toBoardError(err: { message?: string } | null | undefined): BoardError {
  const msg = err?.message ?? '';
  const code = CODES.find((c) => msg.includes(c));
  return new BoardError(code ?? 'BOARD_NETWORK', msg || undefined);
}

export function normalizeBoardState(row: Partial<BoardState> | null | undefined): BoardState {
  return {
    ...EMPTY_BOARD_STATE,
    ...(row ?? {}),
    opened_groups: (row?.opened_groups as BoardState['opened_groups']) ?? [],
    vote_items: (row?.vote_items as BoardState['vote_items'] | undefined) ?? EMPTY_BOARD_STATE.vote_items,
  };
}

/** 참가자 RPC 시간 제한 — 반쯤 끊긴 LTE에서 요청이 몇 분씩 매달려 버튼이 '보내는 중…'에 갇히지 않게 */
const RPC_TIMEOUT_MS = 8000;
function timeout(): AbortSignal | undefined {
  return typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal ? AbortSignal.timeout(RPC_TIMEOUT_MS) : undefined;
}
function withTimeout<T extends { abortSignal: (s: AbortSignal) => T }>(q: T): T {
  const s = timeout();
  return s ? q.abortSignal(s) : q;
}

/** Realtime이 살아 있을 때의 안전망 폴링 주기 */
const STATE_POLL_LIVE_MS = 15_000;

class SupabaseBoardAdapter implements BoardAdapter {
  readonly mode = 'supabase' as const;

  async serverNow(): Promise<number> {
    const { data, error } = await sb().rpc('server_now');
    if (error || !data) throw toBoardError(error);
    return new Date(data as string).getTime();
  }

  async getState(): Promise<BoardState> {
    const { data, error } = await withTimeout(sb().from('board_state').select('*').eq('id', 1)).maybeSingle();
    if (error) throw toBoardError(error);
    return normalizeBoardState(data as Partial<BoardState> | null);
  }

  subscribeState(cb: (state: BoardState) => void): () => void {
    let last = '';
    let disposed = false;
    const emit = (s: BoardState) => {
      if (disposed) return;
      if (s.updated_at === last) return;
      last = s.updated_at;
      cb(s);
    };
    let live = false;
    let lastPull = 0;
    const pull = () => {
      lastPull = Date.now();
      void this.getState()
        .then(emit)
        .catch(() => undefined);
    };

    const channel: RealtimeChannel = sb()
      .channel('board_state')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'board_state' }, (payload) => {
        emit(normalizeBoardState(payload.new as Partial<BoardState>));
      })
      .subscribe((status) => {
        live = status === 'SUBSCRIBED';
        if (live) pull();
      });

    const poll = setInterval(() => {
      if (!live || Date.now() - lastPull >= STATE_POLL_LIVE_MS) pull();
    }, BOARD_STATE_POLL_MS);
    const onWake = () => {
      if (document.visibilityState !== 'hidden') pull();
    };
    document.addEventListener('visibilitychange', onWake);
    window.addEventListener('online', onWake);
    window.addEventListener('focus', onWake);
    pull();

    return () => {
      disposed = true;
      clearInterval(poll);
      document.removeEventListener('visibilitychange', onWake);
      window.removeEventListener('online', onWake);
      window.removeEventListener('focus', onWake);
      void sb().removeChannel(channel);
    };
  }

  async join(teamId: string, name: string, device: string, role: BoardRole = 'recorder'): Promise<BoardMe> {
    const { data, error } = await withTimeout(
      sb().rpc('board_join', { p_team: teamId, p_name: name, p_device: device, p_role: role }),
    );
    if (error || !data) throw toBoardError(error);
    const me = data as BoardMe;
    return { ...me, role: me.role ?? 'recorder' };
  }

  async my(participantId: string): Promise<BoardMyView | null> {
    const { data, error } = await withTimeout(sb().rpc('board_my', { p_id: participantId }));
    if (error) throw toBoardError(error);
    return (data as BoardMyView | null) ?? null;
  }

  async submit(participantId: string, bodies: Record<string, string>): Promise<string> {
    const { data, error } = await withTimeout(sb().rpc('board_submit', { p_id: participantId, p_bodies: bodies }));
    if (error || !data) throw toBoardError(error);
    return data as string;
  }

  async counts(): Promise<BoardCounts> {
    const { data, error } = await withTimeout(sb().rpc('board_counts'));
    if (error || !data) throw toBoardError(error);
    return data as BoardCounts;
  }

  async feed(groups: BoardGroupId[]): Promise<BoardCard[]> {
    const { data, error } = await withTimeout(sb().rpc('board_feed', { p_groups: groups }));
    if (error) throw toBoardError(error);
    return (data as BoardCard[] | null) ?? [];
  }

  async vote(participantId: string, group: BoardGroupId, card: string, on: boolean): Promise<BoardMyVotes> {
    const { data, error } = await withTimeout(sb().rpc('board_vote', { p_id: participantId, p_group: group, p_card: card, p_on: on }));
    if (error || !data) throw toBoardError(error);
    return data as BoardMyVotes;
  }

  async myVotes(participantId: string, group: BoardGroupId): Promise<BoardMyVotes> {
    const { data, error } = await withTimeout(sb().rpc('board_my_votes', { p_id: participantId, p_group: group }));
    if (error || !data) throw toBoardError(error);
    return data as BoardMyVotes;
  }

  async ranking(group: BoardGroupId): Promise<BoardRankRow[]> {
    const { data, error } = await withTimeout(sb().rpc('board_ranking', { p_group: group }));
    if (error) throw toBoardError(error);
    return (data as BoardRankRow[] | null) ?? [];
  }

  async adminSnapshot(key: string): Promise<BoardAdminSnapshot> {
    const { data, error } = await sb().rpc('board_admin_snapshot', { p_key: key });
    if (error || !data) throw toBoardError(error);
    const snap = data as BoardAdminSnapshot;
    return { ...snap, state: normalizeBoardState(snap.state), votes: snap.votes ?? [], voters: snap.voters ?? 0 };
  }

  async setState(key: string, patch: BoardStatePatch): Promise<BoardState> {
    const { data, error } = await sb().rpc('board_set_state', { p_key: key, p_patch: patch });
    if (error || !data) throw toBoardError(error);
    return normalizeBoardState(data as Partial<BoardState>);
  }

  async moderate(key: string, submissionId: string, action: BoardModerateAction, note?: string): Promise<void> {
    const { error } = await sb().rpc('board_moderate', {
      p_key: key,
      p_id: submissionId,
      p_action: action,
      p_note: note ?? null,
    });
    if (error) throw toBoardError(error);
  }

  async reset(key: string, scope: 'group' | 'all', group?: BoardGroupId): Promise<void> {
    const { error } = await sb().rpc('board_reset', { p_key: key, p_scope: scope, p_group: group ?? null });
    if (error) throw toBoardError(error);
  }
}

export function createSupabaseBoardAdapter(): BoardAdapter {
  return new SupabaseBoardAdapter();
}
