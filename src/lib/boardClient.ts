'use client';

// 토의보드 클라이언트 훅 (Board v1.0) — 참가자·송출·운영자 세 화면이 함께 쓴다.

import { useEffect, useState, useSyncExternalStore } from 'react';

import { getBoardDb } from './boardDb';
import type { BoardGroupId } from './boardSeed';
import type { BoardCard, BoardCounts, BoardState } from './boardTypes';

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

export function fmtClock(ms: number): string {
  const total = Math.ceil(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * 월 카드 — groups가 바뀌거나 stamp(상태 updated_at)가 바뀌면 바로, 그 밖에는 intervalMs마다 읽는다.
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
  q1_intro: '질문 ① 소개',
  item_open: '항목',
  wall: '월 보기',
  break: '휴식',
  q2_intro: '질문 ② 소개',
  ended: '종료',
};
