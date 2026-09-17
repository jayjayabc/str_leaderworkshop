'use client';

import { useState } from 'react';
import clsx from 'clsx';

import { ROLE_LABEL, ROLES } from '@/lib/design';
import { useBoard } from '@/store/board';
import type { Role } from '@/lib/types';

export function JoinModal() {
  const me = useBoard((s) => s.me);
  const loading = useBoard((s) => s.loading);
  const join = useBoard((s) => s.join);
  const [nickname, setNickname] = useState('');
  const [role, setRole] = useState<Role>('strategy');
  const [busy, setBusy] = useState(false);

  if (loading || me) return null;

  async function submit() {
    if (!nickname.trim() || busy) return;
    setBusy(true);
    try {
      await join(nickname, role);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 px-6">
      <div className="eb-panel w-full max-w-[400px] p-6 shadow-xl" role="dialog" aria-modal="true" aria-label="참가하기">
        <h2 className="text-[18px] font-bold">보드에 참여하기</h2>
        <p className="mt-1 text-[13px] text-eb-muted">닉네임만 입력하면 됩니다. 익명으로 진행됩니다.</p>

        <label className="mt-5 mb-1.5 block text-[12px] font-semibold" htmlFor="nickname">
          닉네임
        </label>
        <input
          id="nickname"
          autoFocus
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submit();
          }}
          maxLength={12}
          placeholder="예) 제인"
          className="w-full rounded-lg border border-eb-line px-3 py-2.5 text-[14px] outline-none focus:border-[#9aa4b8]"
        />

        <p className="mt-4 mb-1.5 text-[12px] font-semibold">역할</p>
        <div className="flex gap-2">
          {ROLES.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRole(r)}
              className={clsx(
                'flex-1 rounded-lg border px-3 py-2 text-[13px]',
                role === r ? 'border-[#3D4A7A] bg-[#EEF0F7] font-semibold text-[#3D4A7A]' : 'border-eb-line',
              )}
            >
              {ROLE_LABEL[r]}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={() => void submit()}
          disabled={!nickname.trim() || busy}
          className="mt-6 w-full rounded-lg bg-[#3D4A7A] px-4 py-2.5 text-[15px] font-semibold text-white disabled:opacity-40"
        >
          입장하기
        </button>
      </div>
    </div>
  );
}
