'use client';

import { useState } from 'react';

import { AdminSection } from './AdminScreen';

const CONFIRM_WORD = '초기화';

/** 5. 위험 구역 — 모든 조 초기화 (2단계 확인) */
export function AdminDanger({
  count,
  busy,
  onReset,
}: {
  count: number;
  busy: boolean;
  onReset: () => void;
}) {
  const [step, setStep] = useState<0 | 1 | 2>(0);
  const [typed, setTyped] = useState('');

  return (
    <AdminSection title="위험 구역">
      <p className="text-[13px] leading-5 text-eb-muted">
        모든 조({count}개)의 카드가 풀로 돌아가고 점 스티커·메모·참가자가 만든 카드가 지워집니다.
        단계는 배치로 돌아갑니다. 되돌릴 수 없습니다.
      </p>

      {step === 0 ? (
        <button
          type="button"
          disabled={busy || !count}
          onClick={() => setStep(1)}
          className="mt-3 rounded-lg border border-[#9A5B1E] px-3 py-2 text-[13px] font-semibold text-[#9A5B1E] disabled:opacity-40"
        >
          모든 조 초기화
        </button>
      ) : null}

      {step === 1 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setStep(2)}
            className="rounded-lg bg-[#9A5B1E] px-3 py-2 text-[13px] font-semibold text-white"
          >
            계속 — 정말 모든 조를 초기화합니다
          </button>
          <button
            type="button"
            onClick={() => setStep(0)}
            className="rounded-lg border border-eb-line px-3 py-2 text-[13px]"
          >
            취소
          </button>
        </div>
      ) : null}

      {step === 2 ? (
        <div className="mt-3">
          <label className="mb-1.5 block text-[12px] font-semibold" htmlFor="admin-reset-confirm">
            계속하려면 <span className="font-bold">{CONFIRM_WORD}</span>라고 입력하세요
          </label>
          <div className="flex flex-wrap gap-2">
            <input
              id="admin-reset-confirm"
              autoFocus
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={CONFIRM_WORD}
              className="w-[180px] rounded-lg border border-eb-line px-3 py-2 text-[14px] outline-none focus:border-[#9A5B1E]"
            />
            <button
              type="button"
              disabled={typed.trim() !== CONFIRM_WORD || busy}
              onClick={() => {
                onReset();
                setStep(0);
                setTyped('');
              }}
              className="rounded-lg bg-[#9A5B1E] px-3 py-2 text-[13px] font-semibold text-white disabled:opacity-40"
            >
              모든 조 초기화
            </button>
            <button
              type="button"
              onClick={() => {
                setStep(0);
                setTyped('');
              }}
              className="rounded-lg border border-eb-line px-3 py-2 text-[13px]"
            >
              취소
            </button>
          </div>
        </div>
      ) : null}
    </AdminSection>
  );
}
