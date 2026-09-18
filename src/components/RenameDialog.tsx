'use client';

import { useState } from 'react';

import { useBoard } from '@/store/board';

/** ⋯ 메뉴 → 이름 바꾸기 (v1.1.1). 비우고 저장하면 자동 별칭으로 돌아간다. */
export function RenameDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const me = useBoard((s) => s.me);
  const renameMe = useBoard((s) => s.renameMe);
  const [value, setValue] = useState(me?.nickname ?? '');
  const [busy, setBusy] = useState(false);

  if (!open || !me) return null;

  async function submit() {
    if (busy) return;
    setBusy(true);
    try {
      await renameMe(value);
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/25 px-4">
      <div
        className="eb-panel w-full max-w-[380px] p-6 shadow-xl"
        role="dialog"
        aria-modal="true"
        aria-label="이름 바꾸기"
      >
        <h2 className="text-[17px] font-bold">이름 바꾸기</h2>
        <p className="mt-1.5 text-[13px] leading-5 text-eb-muted">
          지금 이름은 <strong>{me.nickname}</strong>입니다. 비워 두고 저장하면 자동 별칭으로 돌아갑니다.
          이미 놓은 카드에 붙은 이름은 그대로 남습니다.
        </p>
        <input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submit();
          }}
          maxLength={12}
          placeholder="예) 제일런"
          aria-label="새 이름"
          className="mt-4 w-full rounded-lg border border-eb-line px-3 py-3 text-[15px] outline-none focus:border-[#9aa4b8]"
        />
        <div className="mt-5 flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="h-11 flex-1 rounded-lg border border-eb-line text-[14px]"
          >
            취소
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void submit()}
            className="h-11 flex-1 rounded-lg bg-[#3D4A7A] text-[14px] font-semibold text-white disabled:opacity-40"
          >
            {busy ? '바꾸는 중…' : '저장'}
          </button>
        </div>
      </div>
    </div>
  );
}
