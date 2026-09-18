'use client';

import { useState } from 'react';

import { useBoard } from '@/store/board';
import { teamNoOf, teamTitle } from '@/lib/teams';

/**
 * 참가 — 이름만 받는다 (v1.1 D: 역할 입력 제거).
 * 조는 slug(t07)에서 정해지므로 "7조"로 보여 주기만 한다.
 */
export function JoinModal() {
  const me = useBoard((s) => s.me);
  const loading = useBoard((s) => s.loading);
  const slug = useBoard((s) => s.slug);
  const title = useBoard((s) => s.board?.title ?? '');
  const join = useBoard((s) => s.join);
  const [nickname, setNickname] = useState('');
  const [busy, setBusy] = useState(false);

  if (loading || me) return null;

  const teamNo = slug ? teamNoOf(slug) : null;
  const heading = teamNo ? teamTitle(teamNo) : title || '코끼리 보드';

  async function submit() {
    if (!nickname.trim() || busy) return;
    setBusy(true);
    try {
      await join(nickname);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 px-4">
      <div
        className="eb-panel w-full max-w-[400px] p-6 shadow-xl"
        role="dialog"
        aria-modal="true"
        aria-label="참가하기"
      >
        <p className="text-[13px] font-semibold text-[#3D4A7A]">{heading}</p>
        <h2 className="mt-1 text-[19px] font-bold">이름을 입력해 주세요</h2>
        <p className="mt-1 text-[13px] leading-5 text-eb-muted">
          로그인은 없습니다. 이름은 카드에 붙는 작은 배지에만 쓰입니다.
        </p>

        <label className="mb-1.5 mt-5 block text-[12px] font-semibold" htmlFor="nickname">
          이름
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
          placeholder="예) 제일런"
          className="w-full rounded-lg border border-eb-line px-3 py-3 text-[15px] outline-none focus:border-[#9aa4b8]"
        />

        <button
          type="button"
          onClick={() => void submit()}
          disabled={!nickname.trim() || busy}
          className="mt-5 flex h-12 w-full items-center justify-center rounded-lg bg-[#3D4A7A] text-[16px] font-semibold text-white disabled:opacity-40"
        >
          입장하기
        </button>
      </div>
    </div>
  );
}
