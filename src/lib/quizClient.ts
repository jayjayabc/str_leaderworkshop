'use client';

// 스피드 퀴즈 클라이언트 훅 (Quiz v1.0) — 세 화면(참가자·스크린·운영자)이 함께 쓴다.

import { useEffect, useState, useSyncExternalStore } from 'react';

import { getQuizDb } from './quizDb';
import { QUIZ_QUESTIONS, QUIZ_TEAMS, DEFAULT_DURATION_SEC } from './quizQuestions';
import type { QuizScoreRow, QuizState } from './quizTypes';

/** quiz_state 구독 (Realtime/BroadcastChannel + 3초 폴링). 첫 값이 오기 전에는 null */
export function useQuizState(): QuizState | null {
  const [state, setState] = useState<QuizState | null>(null);
  useEffect(() => getQuizDb().subscribeState(setState), []);
  return state;
}

/**
 * 서버 시계와의 차이(ms). serverNow ≈ Date.now() + offset.
 * 왕복 시간이 가장 짧은 표본 3개 중 하나를 쓴다(NTP 방식의 단순판).
 */
export function useServerOffset(): number {
  const [offset, setOffset] = useState(0);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const db = getQuizDb();
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
          /* 네트워크 실패 — 0으로 둔다 */
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

// ─── 1초(또는 250ms) 틱 ───────────────────────────────────────

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
    }, 250);
  }
  return () => {
    tickListeners.delete(cb);
    if (tickListeners.size === 0 && tickTimer) {
      clearInterval(tickTimer);
      tickTimer = null;
    }
  };
}

/** 250ms마다 갱신되는 현재 시각 — 렌더 중 Date.now()를 직접 부르지 않기 위해 */
export function useNow(): number {
  return useSyncExternalStore(
    subscribeTick,
    () => nowMs,
    () => 0,
  );
}

/** 열린 문제의 남은 시간(ms). 열려 있지 않으면 null */
export function remainingMs(state: QuizState | null, now: number, offset: number): number | null {
  if (!state || state.status !== 'open' || !state.opened_at) return null;
  const end = new Date(state.opened_at).getTime() + state.duration_sec * 1000;
  return Math.max(0, end - (now + offset));
}

export function fmtClock(ms: number): string {
  const total = Math.ceil(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m > 0 ? `${m}:${String(s).padStart(2, '0')}` : String(s);
}

/** 문항별 제한시간 — 운영자 설정 > 문항 기본값 > 전체 기본값 */
export function durationFor(state: QuizState | null, index: number): number {
  const override = state?.settings.durations?.[String(index)];
  if (override && override > 0) return override;
  return QUIZ_QUESTIONS[index]?.durationSec ?? DEFAULT_DURATION_SEC;
}

/** '키워드만' 표시용 키워드 — 운영자 설정 > 문항 기본값(카테고리) */
export function keywordFor(state: QuizState | null, index: number): string {
  const override = state?.settings.keywords?.[String(index)];
  if (override && override.trim()) return override.trim();
  return QUIZ_QUESTIONS[index]?.keyword ?? '';
}

/** 화면 폭·길이에 맞춘 문제 글자 크기 (스크린 1920×1080 기준 px) */
export function screenPromptSize(text: string): number {
  const n = text.length;
  if (n <= 40) return 76;
  if (n <= 90) return 60;
  if (n <= 160) return 50;
  if (n <= 240) return 42;
  return 36;
}

/**
 * v2.0 점수판 — stamp가 바뀔 때마다(상태 전환 등) 다시 읽고, intervalMs가 있으면 주기적으로도 읽는다.
 * 실패하면 마지막 값을 유지한다.
 */
export function useScoreboard(stamp: string, intervalMs = 0): QuizScoreRow[] | null {
  const [rows, setRows] = useState<QuizScoreRow[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    const pull = () =>
      getQuizDb()
        .scoreboard(QUIZ_TEAMS)
        .then((r) => {
          if (!cancelled) setRows(r);
        })
        .catch(() => undefined);
    // 240대가 같은 순간에 묻지 않게 0~1.5초 흩는다
    const first = setTimeout(() => void pull(), Math.random() * 1500);
    const t = intervalMs > 0 ? setInterval(() => void pull(), intervalMs) : null;
    return () => {
      cancelled = true;
      clearTimeout(first);
      if (t) clearInterval(t);
    };
  }, [stamp, intervalMs]);
  return rows;
}

/** 점수판 정렬 + 순위(동점 같은 순위) */
export function rankScores(rows: QuizScoreRow[]): (QuizScoreRow & { rank: number })[] {
  const sorted = [...rows].sort((a, b) => b.score - a.score || b.correct - a.correct || a.team_no - b.team_no);
  return sorted.reduce<(QuizScoreRow & { rank: number })[]>((out, r, i) => {
    const prev = out[i - 1];
    out.push({ ...r, rank: prev && prev.score === r.score ? prev.rank : i + 1 });
    return out;
  }, []);
}

/** 문항 배점 — 운영자 설정 > 문항 기본 배점 */
export function pointsFor(state: QuizState | null, index: number): number {
  const v = state?.settings.points?.[String(index)];
  if (typeof v === 'number' && v >= 0) return v;
  return QUIZ_QUESTIONS[index]?.points ?? 10;
}
