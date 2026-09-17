'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { ZONES } from '@/lib/design';
import { dbMode, getDb, MODE_BADGE } from '@/lib/db';
import { writeHostToken } from '@/store/board';

export default function HomePage() {
  const router = useRouter();
  const [title, setTitle] = useState('2026 리더워크샵 Day2 — 커스텀 코끼리 진단');
  const [busy, setBusy] = useState(false);

  async function create() {
    if (busy) return;
    setBusy(true);
    try {
      const { board, hostToken } = await getDb().createBoard({ title });
      writeHostToken(board.slug, hostToken);
      router.push(`/b/${board.slug}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen px-6 py-16">
      <div className="mx-auto w-full max-w-[560px]">
        <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-eb-line bg-white px-3 py-1 text-[12px] text-eb-muted">
          {MODE_BADGE[dbMode].label}
        </div>
        <h1 className="text-[32px] font-bold tracking-tight">코끼리 보드</h1>
        <p className="mt-2 text-[15px] leading-6 text-eb-muted">
          다섯 개의 칸에 키워드를 함께 놓으며 이야기하는 실시간 보드입니다. 링크 하나로 공유하고,
          로그인 없이 닉네임만으로 참여합니다.
        </p>

        <div className="eb-panel mt-8 p-6">
          <label className="mb-2 block text-[13px] font-semibold" htmlFor="board-title">
            보드 제목
          </label>
          <input
            id="board-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void create();
            }}
            className="w-full rounded-lg border border-eb-line px-3 py-2.5 text-[15px] outline-none focus:border-[#9aa4b8]"
            placeholder="예) 리더워크샵 Day2 코끼리 진단"
          />
          <button
            type="button"
            onClick={() => void create()}
            disabled={busy || !title.trim()}
            className="mt-4 w-full rounded-lg bg-[#3D4A7A] px-4 py-2.5 text-[15px] font-semibold text-white transition hover:bg-[#33406b] disabled:opacity-40"
          >
            {busy ? '만드는 중…' : '보드 만들기'}
          </button>
          <p className="mt-3 text-[12px] text-eb-muted">
            만들면 시드 카드 46장이 왼쪽 풀에 들어간 상태로 시작합니다. 이 브라우저가 호스트가 됩니다.
          </p>
        </div>

        <div className="mt-8 grid grid-cols-5 gap-2">
          {ZONES.map((z) => (
            <div
              key={z.key}
              className="rounded-xl px-2 py-3 text-center"
              style={{ background: z.tint }}
              title={z.definition}
            >
              <div className="text-[20px]">{z.emoji}</div>
              <div className="mt-1 text-[11px] font-semibold" style={{ color: z.label }}>
                {z.name}
              </div>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
