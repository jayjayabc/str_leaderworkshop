'use client';

import { X } from 'lucide-react';
import clsx from 'clsx';

import { PHASE_LABEL, useBoard, useVoteCounts } from '@/store/board';
import { TimerWidget } from './TimerWidget';

/** 발표 모드 전용 슬림 상단바 (48px) — 라이트 고정 (§8) */
export function PresentBar() {
  const board = useBoard((s) => s.board);
  const isHost = useBoard((s) => s.isHost);
  const setFlags = useBoard((s) => s.setFlags);
  const setPresent = useBoard((s) => s.setPresent);
  const highlightTop = useBoard((s) => s.highlightTop);
  const setHighlightTop = useBoard((s) => s.setHighlightTop);
  const voteCounts = useVoteCounts();

  if (!board) return null;
  const hasVotes = [...voteCounts.values()].some((n) => n > 0);

  return (
    <header className="flex h-12 shrink-0 items-center gap-4 border-b border-eb-line bg-white px-6">
      <h1 className="truncate text-[16px] font-bold" title={board.title}>
        {board.title}
      </h1>
      <span className="shrink-0 rounded-full bg-[#EEF0F7] px-2 py-0.5 text-[12px] font-semibold text-[#3D4A7A]">
        {PHASE_LABEL[board.phase]}
      </span>

      <div className="ml-auto flex shrink-0 items-center gap-2">
        <TimerWidget compact />
        {isHost ? (
          <>
            <button
              type="button"
              onClick={() => void setFlags({ hide_vomit: !board.hide_vomit })}
              className={clsx(
                'rounded-lg border px-2.5 py-1.5 text-[12px]',
                board.hide_vomit ? 'border-[#9A5B1E] bg-[#F8F0E6] text-[#9A5B1E]' : 'border-eb-line',
              )}
            >
              🤮 숨김
            </button>
            {/* v1.1 D — 켜짐/꺼짐이 한눈에 보이도록 상태 점과 라벨을 함께 보여 준다 (기본 켜짐) */}
            <button
              type="button"
              disabled={!hasVotes}
              aria-pressed={highlightTop && hasVotes}
              onClick={() => setHighlightTop(!highlightTop)}
              title={hasVotes ? undefined : '아직 득표가 없습니다'}
              className={clsx(
                'flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] disabled:opacity-35',
                highlightTop && hasVotes
                  ? 'border-[#3D4A7A] bg-[#3D4A7A] font-semibold text-white'
                  : 'border-eb-line bg-white text-eb-muted',
              )}
            >
              <span aria-hidden>{highlightTop && hasVotes ? '◉' : '○'}</span>
              상위 득표 하이라이트
              <span className="font-semibold">{highlightTop && hasVotes ? '켬' : '끔'}</span>
            </button>
          </>
        ) : null}
        <button
          type="button"
          onClick={() => setPresent(false)}
          className="flex items-center gap-1 rounded-lg border border-eb-line px-2.5 py-1.5 text-[12px]"
          title="Esc"
        >
          <X className="h-3.5 w-3.5" aria-hidden /> 나가기
        </button>
      </div>
    </header>
  );
}
