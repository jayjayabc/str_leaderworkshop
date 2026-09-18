'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import clsx from 'clsx';

import { ZONES } from '@/lib/design';
import { getDb } from '@/lib/db';
import {
  TEAM_COUNT,
  readLastEntry,
  teamNumbers,
  teamSlug,
  teamTitle,
  writeLastEntry,
} from '@/lib/teams';
import { cachedSnapshot, useClientValue } from '@/lib/clientStore';
import { saveIdentity } from '@/store/board';

/** 마지막 입장 정보는 한 번만 읽고 캐시한다(스냅샷 참조 안정성) */
const lastEntry = cachedSnapshot(readLastEntry);

/**
 * 홈 — 조 번호 + 이름만 받아 해당 조 보드로 들어간다 (v1.1 A).
 * 보드 만들기는 더 이상 제공하지 않는다(운영자는 /admin에서 만든다).
 */
export default function HomePage() {
  const router = useRouter();
  // 마지막 입장(조·이름)을 미리 고른 상태로 보여 주고, 사용자가 고르면 그 값이 이긴다
  const last = useClientValue(lastEntry.get, null);
  const [teamPick, setTeamPick] = useState<number | null>(null);
  const [namePick, setNamePick] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const team = teamPick ?? (last && last.team <= TEAM_COUNT ? last.team : null);
  const name = namePick ?? last?.name ?? '';
  const setTeam = setTeamPick;
  const setName = setNamePick;

  const ready = team !== null && name.trim().length > 0;

  async function enter() {
    if (!ready || busy || team === null) return;
    setBusy(true);
    try {
      const slug = teamSlug(team);
      const db = getDb();
      let snapshot = await db.loadBoard(slug);
      if (!snapshot) {
        // 보드가 아직 없으면 만든다. 호스트 토큰은 아무도 갖지 않는다(운영자가 /admin에서 가져간다).
        await db.createBoard({ title: teamTitle(team), slug });
        snapshot = await db.loadBoard(slug);
      }
      if (!snapshot) throw new Error('보드를 준비하지 못했습니다');

      saveIdentity(slug, name, snapshot.board.id);
      writeLastEntry({ team, name: name.trim() });
      router.push(`/b/${slug}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '입장하지 못했습니다');
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen px-4 py-10 sm:px-6 sm:py-16">
      <div className="mx-auto w-full max-w-[560px]">
        <h1 className="text-[28px] font-bold tracking-tight sm:text-[34px]">🐘 코끼리 보드</h1>
        <p className="mt-2 text-[14px] leading-6 text-eb-muted sm:text-[15px]">
          조 번호와 이름을 넣고 들어오면, 같은 조 사람들과 같은 보드를 함께 씁니다.
        </p>

        <section className="eb-panel mt-7 p-4 sm:p-6">
          <p className="mb-2.5 text-[13px] font-semibold">조 번호</p>
          <div
            className="grid gap-1.5 sm:gap-2"
            style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(52px, 1fr))' }}
            role="radiogroup"
            aria-label="조 번호"
          >
            {teamNumbers().map((n) => {
              const active = team === n;
              return (
                <button
                  key={n}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  aria-label={`${n}조`}
                  onClick={() => setTeam(n)}
                  className={clsx(
                    'flex h-11 items-center justify-center rounded-lg border text-[15px] font-semibold tabular-nums transition',
                    active
                      ? 'border-[#3D4A7A] bg-[#3D4A7A] text-white'
                      : 'border-eb-line bg-white text-eb-ink hover:bg-[#fafaf8]',
                  )}
                >
                  {n}
                </button>
              );
            })}
          </div>

          <label className="mb-1.5 mt-6 block text-[13px] font-semibold" htmlFor="entry-name">
            이름
          </label>
          <input
            id="entry-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void enter();
            }}
            maxLength={12}
            placeholder="예) 제일런"
            className="w-full rounded-lg border border-eb-line px-3 py-3 text-[15px] outline-none focus:border-[#9aa4b8]"
          />

          <button
            type="button"
            onClick={() => void enter()}
            disabled={!ready || busy}
            className="mt-5 flex h-12 w-full items-center justify-center rounded-lg bg-[#3D4A7A] text-[16px] font-semibold text-white transition hover:bg-[#33406b] disabled:opacity-40"
          >
            {busy ? '들어가는 중…' : team ? `${teamTitle(team)}로 입장하기` : '입장하기'}
          </button>
          <p className="mt-3 text-[12px] leading-5 text-eb-muted">
            조마다 같은 키워드 카드 46장으로 시작합니다. 로그인은 없고, 이름은 카드 배지에만 쓰입니다.
          </p>
        </section>

        <div className="mt-7 grid grid-cols-5 gap-1.5 sm:gap-2">
          {ZONES.map((z) => (
            <div
              key={z.key}
              className="rounded-xl px-1 py-3 text-center"
              style={{ background: z.tint }}
              title={z.definition}
            >
              <div className="text-[18px] sm:text-[20px]">{z.emoji}</div>
              <div
                className="mt-1 text-[10px] font-semibold sm:text-[11px]"
                style={{ color: z.label }}
              >
                {z.name}
              </div>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
