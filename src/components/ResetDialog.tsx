'use client';

import { useState } from 'react';

import { useBoard } from '@/store/board';

const CONFIRM_WORD = '초기화';

/**
 * 전체 초기화 — 확인 2번 (M11): 1단계 경고 → 2단계 '초기화' 입력.
 * 열 때마다 새로 마운트되므로(부모가 key를 바꾼다) 단계·입력이 초기 상태로 돌아간다.
 */
export function ResetDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const resetBoard = useBoard((s) => s.resetBoard);
  const [step, setStep] = useState<1 | 2>(1);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);

  if (!open) return null;

  async function run() {
    setBusy(true);
    try {
      await resetBoard();
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/25 px-6">
      <div
        className="eb-panel w-full max-w-[400px] p-6 shadow-xl"
        role="dialog"
        aria-modal="true"
        aria-label="전체 초기화"
      >
        <h2 className="text-[17px] font-bold">보드를 전체 초기화할까요?</h2>
        <p className="mt-2 text-[13px] leading-5 text-eb-muted">
          모든 카드가 풀로 돌아가고, 점 스티커·메모·참가자가 만든 카드가 지워집니다. 단계는 배치로
          돌아갑니다. 시드 46장과 활동 기록은 남습니다. 되돌릴 수 없습니다.
        </p>

        {step === 2 ? (
          <div className="mt-4">
            <label className="mb-1.5 block text-[12px] font-semibold" htmlFor="reset-confirm">
              계속하려면 <span className="font-bold">{CONFIRM_WORD}</span>라고 입력하세요
            </label>
            <input
              id="reset-confirm"
              autoFocus
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && typed.trim() === CONFIRM_WORD) void run();
              }}
              className="w-full rounded-lg border border-eb-line px-3 py-2 text-[14px] outline-none focus:border-[#9A5B1E]"
              placeholder={CONFIRM_WORD}
            />
          </div>
        ) : null}

        <div className="mt-5 flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-lg border border-eb-line py-2 text-[13px]"
          >
            취소
          </button>
          {step === 1 ? (
            <button
              type="button"
              onClick={() => setStep(2)}
              className="flex-1 rounded-lg bg-[#9A5B1E] py-2 text-[13px] font-semibold text-white"
            >
              계속
            </button>
          ) : (
            <button
              type="button"
              disabled={typed.trim() !== CONFIRM_WORD || busy}
              onClick={() => void run()}
              className="flex-1 rounded-lg bg-[#9A5B1E] py-2 text-[13px] font-semibold text-white disabled:opacity-40"
            >
              {busy ? '초기화 중…' : '초기화'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
