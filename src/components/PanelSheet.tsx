'use client';

import { BarChart3, X } from 'lucide-react';

import { Panel } from './Panel';

/** 태블릿(≤1180px) — 집계 패널을 아이콘 버튼 + 우측 시트로 (§5) */
export function PanelSheet({ open, onOpen, onClose }: { open: boolean; onOpen: () => void; onClose: () => void }) {
  return (
    <>
      {!open ? (
        <button
          type="button"
          onClick={onOpen}
          aria-label="집계 패널 열기"
          className="fixed right-4 top-[68px] z-30 flex h-10 w-10 items-center justify-center rounded-full border border-eb-line bg-white shadow-[0_2px_8px_rgba(16,24,40,0.08)]"
        >
          <BarChart3 className="h-4 w-4" aria-hidden />
        </button>
      ) : null}

      {open ? (
        <div className="fixed inset-0 z-40 flex justify-end bg-black/15" onClick={onClose}>
          <div
            className="flex h-full w-[320px] max-w-[85vw] flex-col bg-white shadow-xl"
            role="dialog"
            aria-label="집계 패널 시트"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex h-12 shrink-0 items-center justify-between border-b border-eb-line px-4">
              <span className="text-[13px] font-bold">집계</span>
              <button type="button" onClick={onClose} aria-label="닫기" className="p-1 text-eb-muted">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="min-h-0 flex-1">
              <Panel flush />
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
