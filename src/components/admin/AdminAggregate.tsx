'use client';

import { useMemo, useState } from 'react';
import clsx from 'clsx';

import { ZONES, placeLabel } from '@/lib/design';
import {
  ZONE_KEYS,
  cardAggs,
  maxZonesOf,
  mismatchRate,
  teamAgg,
  zoneTotals,
  type CardAgg,
  type TeamEntry,
} from '@/lib/aggregate';
import type { ZoneKey } from '@/lib/types';
import { AdminSection } from './AdminScreen';

type SortKey = 'text' | ZoneKey | 'votes' | 'mismatch' | 'placed';

/** 3. 전체 집계 — 카드×칸 빈도표 · 칸 합계 · 상위 득표 · 예상≠실제 · 조별 진행률 */
export function AdminAggregate({ entries }: { entries: TeamEntry[] }) {
  const [sortKey, setSortKey] = useState<SortKey>('placed');
  const [asc, setAsc] = useState(false);

  const cards = useMemo(() => cardAggs(entries), [entries]);
  const totals = useMemo(() => zoneTotals(cards), [cards]);
  const teams = useMemo(() => entries.map(teamAgg), [entries]);

  const sorted = useMemo(() => {
    const list = [...cards];
    const value = (c: CardAgg): number | string => {
      if (sortKey === 'text') return c.text;
      if (sortKey === 'votes') return c.votes;
      if (sortKey === 'mismatch') return mismatchRate(c);
      if (sortKey === 'placed') return c.placedTeams;
      return c.counts[sortKey];
    };
    list.sort((a, b) => {
      const va = value(a);
      const vb = value(b);
      if (typeof va === 'string' || typeof vb === 'string') {
        return String(va).localeCompare(String(vb), 'ko') * (asc ? 1 : -1);
      }
      if (va === vb) return a.text.localeCompare(b.text, 'ko');
      return (va - vb) * (asc ? 1 : -1);
    });
    return list;
  }, [cards, sortKey, asc]);

  const topVoted = useMemo(
    () => [...cards].filter((c) => c.votes > 0).sort((a, b) => b.votes - a.votes).slice(0, 10),
    [cards],
  );

  function toggleSort(key: SortKey) {
    if (key === sortKey) setAsc((v) => !v);
    else {
      setSortKey(key);
      setAsc(key === 'text');
    }
  }

  const arrow = (key: SortKey) => (sortKey === key ? (asc ? ' ▲' : ' ▼') : '');

  if (!entries.length) {
    return (
      <AdminSection title="전체 집계">
        <p className="text-[13px] text-eb-muted">조 보드를 만들면 여기에 합산 결과가 보입니다.</p>
      </AdminSection>
    );
  }

  return (
    <AdminSection
      title="전체 집계"
      right={<span className="text-[12px] text-eb-muted">{entries.length}개 조 합산</span>}
    >
      {/* 칸 합계 */}
      <ul className="mb-4 flex flex-wrap gap-2">
        {ZONES.map((z) => (
          <li
            key={z.key}
            className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px]"
            style={{ background: z.tint }}
          >
            <span aria-hidden>{z.emoji}</span>
            <span className="font-medium" style={{ color: z.label }}>
              {z.name}
            </span>
            <span className="font-bold tabular-nums" style={{ color: z.label }}>
              {totals[z.key]}
            </span>
          </li>
        ))}
      </ul>

      {/* 카드 × 칸 빈도표 */}
      <div className="eb-scroll -mx-1 max-h-[520px] overflow-auto px-1">
        <table className="w-full min-w-[720px] border-collapse text-[13px]">
          <thead className="sticky top-0 z-10 bg-white">
            <tr className="border-b border-eb-line text-[12px] text-eb-muted">
              <th className="py-2 pr-2 text-left">
                <SortBtn onClick={() => toggleSort('text')}>카드{arrow('text')}</SortBtn>
              </th>
              {ZONES.map((z) => (
                <th key={z.key} className="px-1 py-2 text-center">
                  <SortBtn onClick={() => toggleSort(z.key)}>
                    <span aria-hidden>{z.emoji}</span> {z.name}
                    {arrow(z.key)}
                  </SortBtn>
                </th>
              ))}
              <th className="px-1 py-2 text-center">
                <SortBtn onClick={() => toggleSort('placed')}>배치 조{arrow('placed')}</SortBtn>
              </th>
              <th className="px-1 py-2 text-center">
                <SortBtn onClick={() => toggleSort('votes')}>득표{arrow('votes')}</SortBtn>
              </th>
              <th className="px-1 py-2 text-center">
                <SortBtn onClick={() => toggleSort('mismatch')}>예상≠실제{arrow('mismatch')}</SortBtn>
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((c) => {
              const maxZones = maxZonesOf(c);
              const rate = mismatchRate(c);
              return (
                <tr key={c.text} className="border-b border-eb-line/60">
                  <td className="py-1.5 pr-2">
                    <span className="font-medium">{c.text}</span>
                    {c.isSeed ? null : (
                      <span className="ml-1 rounded bg-[#f1f1ee] px-1 py-px text-[10px] text-eb-muted">
                        신규
                      </span>
                    )}
                    {c.expected ? (
                      <span className="ml-1 text-[11px] text-eb-muted">
                        예상 {placeLabel(c.expected)}
                      </span>
                    ) : null}
                  </td>
                  {ZONE_KEYS.map((z) => {
                    const n = c.counts[z];
                    const isMax = maxZones.includes(z) && n > 0;
                    return (
                      <td
                        key={z}
                        className={clsx(
                          'px-1 py-1.5 text-center tabular-nums',
                          isMax ? 'font-bold' : n === 0 ? 'text-eb-muted/50' : '',
                        )}
                        style={isMax ? { background: '#EEF0F7', color: '#3D4A7A' } : undefined}
                      >
                        {n || '·'}
                      </td>
                    );
                  })}
                  <td className="px-1 py-1.5 text-center tabular-nums text-eb-muted">
                    {c.placedTeams}
                  </td>
                  <td className="px-1 py-1.5 text-center font-semibold tabular-nums text-[#3D4A7A]">
                    {c.votes || '·'}
                  </td>
                  <td className="px-1 py-1.5 text-center tabular-nums">
                    {c.expected && c.placedTeams ? (
                      <span className={rate >= 0.5 ? 'font-semibold text-[#9A5B1E]' : 'text-eb-muted'}>
                        {Math.round(rate * 100)}%
                      </span>
                    ) : (
                      <span className="text-eb-muted/50">·</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-5 grid gap-5 md:grid-cols-2">
        <div>
          <h3 className="mb-2 text-[13px] font-bold">상위 득표 (전 조 합산)</h3>
          {topVoted.length === 0 ? (
            <p className="text-[12px] text-eb-muted">아직 표가 없습니다.</p>
          ) : (
            <ul className="space-y-1">
              {topVoted.map((c, i) => (
                <li key={c.text} className="flex items-center gap-2 text-[13px]">
                  <span className="w-4 shrink-0 text-right font-bold tabular-nums text-eb-muted">
                    {i + 1}
                  </span>
                  <span className="truncate">{c.text}</span>
                  <span className="ml-auto font-semibold tabular-nums text-[#3D4A7A]">●{c.votes}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <h3 className="mb-2 text-[13px] font-bold">조별 진행률</h3>
          <ul className="space-y-1.5">
            {teams.map((t) => {
              const pct = t.total ? Math.round((t.placed / t.total) * 100) : 0;
              return (
                <li key={t.slug} className="flex items-center gap-2 text-[12px]">
                  <span className="w-10 shrink-0 tabular-nums">{t.teamNo}조</span>
                  <span className="h-2.5 min-w-0 flex-1 overflow-hidden rounded-full bg-[#f1f1ee]">
                    <span
                      className="block h-full rounded-full bg-[#3D4A7A]"
                      style={{ width: `${pct}%` }}
                    />
                  </span>
                  <span className="w-16 shrink-0 text-right tabular-nums text-eb-muted">
                    {t.placed}/{t.total}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </AdminSection>
  );
}

function SortBtn({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="whitespace-nowrap font-semibold hover:underline">
      {children}
    </button>
  );
}
