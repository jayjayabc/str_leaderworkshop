'use client';

// 토의보드 클라이언트 훅 (Board v1.1) — 참가자·송출·운영자 세 화면이 함께 쓴다.

import { useEffect, useState, useSyncExternalStore } from 'react';

import { getBoardDb } from './boardDb';
import type { BoardGroup, BoardGroupId } from './boardSeed';
import type { BoardCard, BoardCounts, BoardRankRow, BoardState } from './boardTypes';

/** board_state 구독 (Realtime/BroadcastChannel + 3초 폴링). 첫 값 전에는 null */
export function useBoardState(): BoardState | null {
  const [state, setState] = useState<BoardState | null>(null);
  useEffect(() => getBoardDb().subscribeState(setState), []);
  return state;
}

/** 서버 시계와의 차이(ms) — 왕복이 가장 짧은 표본 */
export function useServerOffset(): number {
  const [offset, setOffset] = useState(0);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const db = getBoardDb();
      let best: { rtt: number; off: number } | null = null;
      for (let i = 0; i < 3; i += 1) {
        try {
          const t0 = Date.now();
          const server = await db.serverNow();
          const t1 = Date.now();
          const rtt = t1 - t0;
          const off = server - (t0 + rtt / 2);
          if (!best || rtt < best.rtt) best = { rtt, off };
        } catch {
          /* 0으로 둔다 */
        }
      }
      if (!cancelled && best) setOffset(Math.round(best.off));
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  return offset;
}

const tickListeners = new Set<() => void>();
let tickTimer: ReturnType<typeof setInterval> | null = null;
let nowMs = typeof window === 'undefined' ? 0 : Date.now();

function subscribeTick(cb: () => void): () => void {
  tickListeners.add(cb);
  if (!tickTimer) {
    nowMs = Date.now();
    tickTimer = setInterval(() => {
      nowMs = Date.now();
      tickListeners.forEach((l) => l());
    }, 500);
  }
  return () => {
    tickListeners.delete(cb);
    if (tickListeners.size === 0 && tickTimer) {
      clearInterval(tickTimer);
      tickTimer = null;
    }
  };
}

/** 0.5초마다 갱신되는 현재 시각 */
export function useNow(): number {
  return useSyncExternalStore(subscribeTick, () => nowMs, () => 0);
}

/** 남은 시간(ms). 타이머가 없으면 null */
export function timerLeft(state: BoardState | null, now: number, offset: number): number | null {
  if (!state?.timer_ends_at) return null;
  return Math.max(0, new Date(state.timer_ends_at).getTime() - (now + offset));
}

/** 열린 지 얼마나 됐는지 — '3분 05초' (운영자 참고용) */
export function fmtElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}분 ${String(s).padStart(2, '0')}초`;
}

export function fmtClock(ms: number): string {
  const total = Math.ceil(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * 모아보기 카드 — groups가 바뀌거나 stamp(상태 updated_at)가 바뀌면 바로, 그 밖에는 intervalMs마다 읽는다.
 * enabled=false면 읽지 않고 null. 실패하면 마지막 값을 유지한다.
 */
export function useBoardFeed(groups: BoardGroupId[], enabled: boolean, intervalMs: number, stamp = ''): BoardCard[] | null {
  const key = groups.join(',');
  const [res, setRes] = useState<{ key: string; cards: BoardCard[] } | null>(null);
  useEffect(() => {
    if (!enabled || !key) return;
    let cancelled = false;
    const gs = key.split(',') as BoardGroupId[];
    const pull = () =>
      getBoardDb()
        .feed(gs)
        .then((cards) => {
          if (!cancelled) setRes({ key, cards });
        })
        .catch(() => undefined);
    void pull();
    const t = setInterval(() => void pull(), intervalMs);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [key, enabled, intervalMs, stamp]);
  if (!enabled || !res || res.key !== key) return null;
  return res.cards;
}

/**
 * 투표 순위 — 순위 공개(vote_reveal) 중일 때만 읽는다. 실패하면(공개 전·대상 아님) 마지막 값을 유지하지 않고 null.
 */
export function useBoardRanking(group: BoardGroupId | null, enabled: boolean, intervalMs: number, stamp = ''): BoardRankRow[] | null {
  const [res, setRes] = useState<{ group: string; rows: BoardRankRow[] } | null>(null);
  useEffect(() => {
    if (!enabled || !group) return;
    let cancelled = false;
    const pull = () =>
      getBoardDb()
        .ranking(group)
        .then((rows) => {
          if (!cancelled) setRes({ group, rows });
        })
        .catch(() => undefined);
    void pull();
    const t = setInterval(() => void pull(), intervalMs);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [group, enabled, intervalMs, stamp]);
  if (!enabled || !res || res.group !== group) return null;
  return res.rows;
}

export function useBoardCounts(intervalMs: number, stamp = ''): BoardCounts | null {
  const [counts, setCounts] = useState<BoardCounts | null>(null);
  useEffect(() => {
    let cancelled = false;
    const pull = () =>
      getBoardDb()
        .counts()
        .then((c) => {
          if (!cancelled) setCounts(c);
        })
        .catch(() => undefined);
    void pull();
    const t = setInterval(() => void pull(), intervalMs);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [intervalMs, stamp]);
  return counts;
}

export const PHASE_LABEL: Record<BoardState['phase'], string> = {
  waiting: '대기',
  q1_intro: '질문 1 소개',
  item_open: '항목',
  wall: '모아보기',
  break: '휴식',
  q2_intro: '질문 2 소개',
  ended: '종료',
};

/** 카드 키별로 한 장 — Q2-3처럼 두 칸인 그룹은 한 카드에 두 줄 (같은 반조의 2-3a·2-3b 는 같은 card) */
export interface TeamCard {
  card: string;
  updated_at: string;
  highlighted: boolean;
  parts: { item_id: string; body: string }[];
}

export function toTeamCards(cards: BoardCard[], group: BoardGroup): TeamCard[] {
  const by = new Map<string, TeamCard>();
  for (const c of cards) {
    if (!group.items.some((i) => i.id === c.item_id)) continue;
    const t = by.get(c.card) ?? { card: c.card, updated_at: c.updated_at, highlighted: false, parts: [] };
    t.parts.push({ item_id: c.item_id, body: c.body });
    if (c.updated_at > t.updated_at) t.updated_at = c.updated_at;
    t.highlighted ||= c.highlighted;
    by.set(c.card, t);
  }
  const order = (id: string) => group.items.findIndex((i) => i.id === id);
  return [...by.values()]
    .map((t) => ({ ...t, parts: t.parts.sort((a, b) => order(a.item_id) - order(b.item_id)) }))
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at) || a.card.localeCompare(b.card));
}
