'use client';

import { BarChart3, X } from 'lucide-react';
import clsx from 'clsx';

import { Panel } from './Panel';
import { useViewport } from '@/lib/viewport';

/** 집계 패널을 아이콘 버튼 + 우측 시트로 (§5 태블릿, v1.1 B 폰) */
export function PanelSheet({
  open,
  onOpen,
  onClose,
}: {
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
}) {
  const viewport = useViewport();
  const isPhone = viewport === 'phone';

  return (
    <>
      {!open ? (
        <button
          type="button"
          onClick={onOpen}
          aria-label="집계 패널 열기"
          className={clsx(
            'fixed z-30 flex items-center justify-center rounded-full border border-eb-line bg-white shadow-[0_2px_8px_rgba(16,24,40,0.12)]',
            isPhone ? 'right-3 h-12 w-12 text-[20px]' : 'right-4 top-[68px] h-10 w-10',
          )}
          style={isPhone ? { bottom: 'calc(64px + env(safe-area-inset-bottom))' } : undefined}
        >
          {isPhone ? <span aria-hidden>📊</span> : <BarChart3 className="h-4 w-4" aria-hidden />}
        </button>
      ) : null}

      {open ? (
        <div className="fixed inset-0 z-40 flex justify-end bg-black/15" onClick={onClose}>
          <div
            className={clsx(
              'flex h-full flex-col bg-white shadow-xl',
              isPhone ? 'w-[92vw] max-w-[420px]' : 'w-[320px] max-w-[85vw]',
            )}
            style={isPhone ? { paddingBottom: 'env(safe-area-inset-bottom)' } : undefined}
            role="dialog"
            aria-label="집계 패널 시트"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex h-12 shrink-0 items-center justify-between border-b border-eb-line px-4">
              <span className={clsx('font-bold', isPhone ? 'text-[15px]' : 'text-[13px]')}>집계</span>
              <button
                type="button"
                onClick={onClose}
                aria-label="닫기"
                className="flex h-9 w-9 items-center justify-center rounded-lg text-eb-muted"
              >
                <X className="h-5 w-5" />
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
