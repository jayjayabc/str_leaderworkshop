'use client';

import { LEFT_COLUMN, RIGHT_COLUMN, ZONE_MAP } from '@/lib/design';

/**
 * 로딩 상태 — 실제 레이아웃과 같은 자리에 칸 껍데기를 보여준다.
 * "보드를 찾을 수 없습니다"가 잠깐 스쳐 보이는 것을 막기 위해 loading을 먼저 검사한다.
 */
export function BoardSkeleton() {
  return (
    <div className="flex h-screen flex-col overflow-hidden" aria-busy="true" aria-live="polite">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-eb-line bg-white px-6">
        <div className="h-4 w-[220px] animate-pulse rounded bg-[#ecece8]" />
        <div className="h-4 w-[120px] animate-pulse rounded bg-[#f2f2ee]" />
        <div className="ml-auto h-4 w-[160px] animate-pulse rounded bg-[#f2f2ee]" />
      </header>

      <main className="grid min-h-0 flex-1 grid-cols-[240px_1fr_300px] gap-4 p-4">
        <aside className="eb-panel flex flex-col gap-2 p-3">
          <div className="h-4 w-20 animate-pulse rounded bg-[#ecece8]" />
          <div className="h-8 w-full animate-pulse rounded-lg bg-[#f4f4f1]" />
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-8 w-full animate-pulse rounded-lg bg-[#f7f7f4]" />
          ))}
        </aside>

        <section className="grid min-h-0 grid-cols-2 gap-4" aria-label="보드 불러오는 중">
          <div className="grid min-h-0 grid-rows-3 gap-4">
            {LEFT_COLUMN.map((z) => (
              <ZoneShell key={z} zone={z} />
            ))}
          </div>
          <div className="grid min-h-0 grid-rows-2 gap-4">
            {RIGHT_COLUMN.map((z) => (
              <ZoneShell key={z} zone={z} />
            ))}
          </div>
        </section>

        <aside className="eb-panel flex flex-col gap-3 p-6">
          <div className="h-4 w-24 animate-pulse rounded bg-[#ecece8]" />
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-3 w-full animate-pulse rounded bg-[#f4f4f1]" />
          ))}
        </aside>
      </main>

      <p className="pb-3 text-center text-[12px] text-eb-muted">보드를 불러오는 중…</p>
    </div>
  );
}

function ZoneShell({ zone }: { zone: keyof typeof ZONE_MAP }) {
  const meta = ZONE_MAP[zone];
  return (
    <section className="flex min-h-0 flex-col rounded-xl p-3" style={{ background: meta.tint }}>
      <div className="mb-2 flex items-center gap-2">
        <span className="text-[18px] opacity-40" aria-hidden>
          {meta.emoji}
        </span>
        <span className="text-[14px] font-bold opacity-40" style={{ color: meta.label }}>
          {meta.name}
        </span>
      </div>
      <div className="flex gap-2">
        <div className="h-7 w-24 animate-pulse rounded-xl bg-white/60" />
        <div className="h-7 w-20 animate-pulse rounded-xl bg-white/45" />
      </div>
    </section>
  );
}
