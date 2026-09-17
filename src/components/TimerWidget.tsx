'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Timer } from 'lucide-react';
import { toast } from 'sonner';
import clsx from 'clsx';

import { useBoard } from '@/store/board';

const PRESETS = [15, 30];

/**
 * 1초마다 갱신되는 "현재 시각" 외부 스토어.
 * 렌더 중에 Date.now()를 직접 부르지 않기 위해(순수성 규칙) 값으로 받아 쓴다.
 */
const tickListeners = new Set<() => void>();
let tickTimer: ReturnType<typeof setInterval> | null = null;
// 첫 렌더에서 0이 쓰이지 않도록 모듈 로드 시점에 채워 둔다
let nowMs = typeof window === 'undefined' ? 0 : Date.now();

function subscribeTick(cb: () => void): () => void {
  tickListeners.add(cb);
  if (!tickTimer) {
    nowMs = Date.now();
    tickTimer = setInterval(() => {
      nowMs = Date.now();
      tickListeners.forEach((l) => l());
    }, 1000);
  }
  return () => {
    tickListeners.delete(cb);
    if (tickListeners.size === 0 && tickTimer) {
      clearInterval(tickTimer);
      tickTimer = null;
    }
  };
}

const getTick = () => nowMs;
const getServerTick = () => 0;

function mmss(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** ⏱ 타이머 — 종료 시각이 보드 플래그라 모든 참가자가 같은 값을 본다 */
export function TimerWidget({ compact = false }: { compact?: boolean }) {
  const now = useSyncExternalStore(subscribeTick, getTick, getServerTick);

  const board = useBoard((s) => s.board);
  const isHost = useBoard((s) => s.isHost);
  const startTimer = useBoard((s) => s.startTimer);
  const pauseTimer = useBoard((s) => s.pauseTimer);
  const resumeTimer = useBoard((s) => s.resumeTimer);
  const resetTimer = useBoard((s) => s.resetTimer);

  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState('10');
  const boxRef = useRef<HTMLDivElement | null>(null);
  const firedRef = useRef(false);
  const [pulse, setPulse] = useState(false);

  const endsAt = board?.settings.timer_ends_at ?? null;
  const pausedMs = board?.settings.timer_paused_ms ?? null;
  const running = Boolean(endsAt);
  const remaining = endsAt ? Math.max(0, new Date(endsAt).getTime() - now) : (pausedMs ?? 0);
  const active = running || (pausedMs ?? 0) > 0;
  const done = running && remaining <= 0;

  // 0이 되는 순간 한 번만 부드럽게 알린다 (소리 없음)
  useEffect(() => {
    if (done && !firedRef.current) {
      firedRef.current = true;
      setPulse(true);
      toast('⏱ 시간이 끝났습니다', { duration: 5000 });
      const t = setTimeout(() => setPulse(false), 2400);
      return () => clearTimeout(t);
    }
    if (!running) firedRef.current = false;
    return undefined;
  }, [done, running]);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  if (!board) return null;

  const label = active ? mmss(remaining) : '타이머';

  return (
    <div className="relative shrink-0" ref={boxRef}>
      <button
        type="button"
        aria-label={active ? `타이머 ${mmss(remaining)}` : '타이머'}
        onClick={() => setOpen((v) => !v)}
        className={clsx(
          'flex items-center gap-1 rounded-lg border px-2 py-1.5 text-[12px] transition',
          compact ? '' : '',
          done
            ? 'border-[#9A5B1E] bg-[#F8F0E6] text-[#9A5B1E]'
            : active
              ? 'border-[#3D4A7A] bg-[#EEF0F7] text-[#3D4A7A]'
              : 'border-eb-line',
          pulse && 'eb-pulse',
        )}
      >
        <Timer className="h-3.5 w-3.5" aria-hidden />
        <span className="font-semibold tabular-nums">{label}</span>
        {!running && (pausedMs ?? 0) > 0 ? <span className="text-[11px]">일시정지</span> : null}
      </button>

      {open ? (
        <div className="eb-panel absolute right-0 top-[calc(100%+6px)] z-50 w-[230px] p-3 shadow-xl">
          <p className="mb-2 text-[12px] font-semibold">타이머</p>
          {isHost ? (
            <>
              <div className="flex gap-1.5">
                {PRESETS.map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => void startTimer(m)}
                    className="flex-1 rounded-lg border border-eb-line py-1.5 text-[12px] hover:bg-[#fafaf8]"
                  >
                    {m}분
                  </button>
                ))}
              </div>
              <div className="mt-2 flex gap-1.5">
                <input
                  type="number"
                  min={1}
                  max={180}
                  value={custom}
                  onChange={(e) => setCustom(e.target.value)}
                  aria-label="직접 입력(분)"
                  className="w-full rounded-lg border border-eb-line px-2 py-1.5 text-[12px] tabular-nums outline-none focus:border-[#9aa4b8]"
                />
                <button
                  type="button"
                  onClick={() => void startTimer(Number(custom) || 0)}
                  className="rounded-lg bg-[#3D4A7A] px-2.5 py-1.5 text-[12px] font-semibold text-white"
                >
                  시작
                </button>
              </div>
              <div className="mt-2 flex gap-1.5 border-t border-eb-line pt-2">
                {running ? (
                  <button
                    type="button"
                    onClick={() => void pauseTimer()}
                    className="flex-1 rounded-lg border border-eb-line py-1.5 text-[12px]"
                  >
                    일시정지
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={!pausedMs}
                    onClick={() => void resumeTimer()}
                    className="flex-1 rounded-lg border border-eb-line py-1.5 text-[12px] disabled:opacity-35"
                  >
                    이어서
                  </button>
                )}
                <button
                  type="button"
                  disabled={!active}
                  onClick={() => void resetTimer()}
                  className="flex-1 rounded-lg border border-eb-line py-1.5 text-[12px] disabled:opacity-35"
                >
                  재설정
                </button>
              </div>
            </>
          ) : (
            <p className="text-[12px] leading-5 text-eb-muted">
              {active
                ? `남은 시간 ${mmss(remaining)}${running ? '' : ' (일시정지)'}`
                : '호스트가 타이머를 시작하면 여기에 남은 시간이 보입니다.'}
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}
