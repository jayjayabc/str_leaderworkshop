'use client';

import { ChevronUp } from 'lucide-react';
import clsx from 'clsx';

import { Pool } from './Pool';
import { useBoard, useZoneKeywords } from '@/store/board';

/**
 * 태블릿(≤1180px) — 풀을 하단 서랍으로 (§5).
 * DndContext 안에 있으므로 서랍에서 카드를 끌어 칸에 놓을 수 있다.
 */
export function PoolDrawer({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const poolCards = useZoneKeywords('pool');
  const dragging = useBoard((s) => s.draggingKeyword);

  return (
    <div
      className={clsx(
        'pointer-events-none fixed inset-x-0 bottom-0 z-30 flex flex-col',
        // 드래그 중에는 서랍이 칸을 가리지 않도록 살짝 투명하게
        dragging && open && 'opacity-90',
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-label={`키워드 풀 ${open ? '닫기' : '열기'}`}
        className="pointer-events-auto mx-auto flex items-center gap-2 rounded-t-xl border border-b-0 border-eb-line bg-white px-4 py-2 text-[13px] font-semibold shadow-[0_-2px_8px_rgba(16,24,40,0.06)]"
      >
        <ChevronUp className={clsx('h-4 w-4 transition-transform', open && 'rotate-180')} aria-hidden />
        키워드 풀 · {poolCards.length}장
      </button>

      <div
        className={clsx(
          'pointer-events-auto overflow-hidden border-t border-eb-line bg-white transition-[height] duration-200',
          open ? 'h-[42vh]' : 'h-0',
        )}
      >
        {open ? (
          <div className="h-full p-3">
            <Pool variant="drawer" />
          </div>
        ) : null}
      </div>
    </div>
  );
}
