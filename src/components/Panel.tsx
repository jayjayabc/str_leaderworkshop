'use client';

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import clsx from 'clsx';

import {
  AXES,
  ZONES,
  ZONE_MAP,
  directionParticle,
  initials,
  objectParticle,
  placeEmoji,
  placeLabel,
} from '@/lib/design';
import {
  useAxisByZone,
  useBoard,
  useMismatches,
  useVoteCounts,
} from '@/store/board';
import type { BoardEvent, PlaceKey } from '@/lib/types';

function Section({
  title,
  badge,
  children,
  defaultOpen = true,
}: {
  title: string;
  badge?: number;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="shrink-0 border-b border-eb-line pb-4 last:border-b-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="mb-2 flex w-full items-center gap-1.5 text-left text-[13px] font-bold"
      >
        <ChevronDown
          className={clsx('h-3.5 w-3.5 shrink-0 transition-transform', !open && '-rotate-90')}
          aria-hidden
        />
        {title}
        {typeof badge === 'number' ? (
          <span className="ml-auto rounded-full bg-[#f1f1ee] px-1.5 py-px text-[11px] tabular-nums font-semibold text-eb-muted">
            {badge}
          </span>
        ) : null}
      </button>
      {open ? children : null}
    </section>
  );
}

function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 30) return '방금';
  if (s < 60) return `${s}초 전`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 전`;
  return `${Math.floor(h / 24)}일 전`;
}

const PLACE_KEYS: PlaceKey[] = ['pool', 'elephant', 'deadfish', 'vomit', 'bluebird', 'sprout'];

function asPlaceKey(v: unknown): PlaceKey | null {
  return typeof v === 'string' && (PLACE_KEYS as string[]).includes(v) ? (v as PlaceKey) : null;
}

function feedLine(e: BoardEvent): string {
  const who = e.actor_name ?? '누군가';
  const text = typeof e.payload.text === 'string' ? e.payload.text : '';
  switch (e.type) {
    case 'placement.move': {
      const to = asPlaceKey(e.payload.to);
      if (!to) return `${who}님이 '${text}'${objectParticle(text)} 옮김`;
      const label = placeLabel(to);
      return `${who}님이 '${text}'${objectParticle(text)} ${placeEmoji(to)} ${label}${directionParticle(
        label,
      )} 옮김`;
    }
    case 'keyword.create':
      return `${who}님이 '${text}' 카드를 만듦`;
    case 'keyword.delete':
      return `${who}님이 '${text}' 카드를 지움`;
    case 'note.add':
      return `${who}님이 메모를 남김 — ${text}`;
    case 'vote.add':
      return `${who}님이 '${text}'에 스티커를 붙임`;
    case 'vote.remove':
      return `${who}님이 '${text}' 스티커를 뗌`;
    case 'board.flags':
      return `${who}님이 보드 설정을 바꿈`;
    case 'undo':
      return `${who}님이 되돌림${text ? ` — '${text}'` : ''}`;
    case 'reset':
      return `${who}님이 보드를 초기화함`;
    case 'board.create':
      return '보드를 만듦';
    default:
      return `${who}님의 활동`;
  }
}

/** 집계 패널 — 칸별 개수 · 축 분포 · 예상≠실제 · 온라인 · 활동 피드 (M7) */
export function Panel({ flush = false }: { flush?: boolean }) {
  const placements = useBoard((s) => s.placements);
  const presence = useBoard((s) => s.presence);
  const events = useBoard((s) => s.events);
  const keywords = useBoard((s) => s.keywords);
  const showAxis = useBoard((s) => s.board?.show_axis ?? false);
  const setHighlight = useBoard((s) => s.setHighlight);

  const axisByZone = useAxisByZone();
  const mismatches = useMismatches();
  const voteCounts = useVoteCounts();

  const count = (zone: string) => placements.filter((p) => p.zone === zone).length;
  const placed = placements.filter((p) => p.zone !== 'pool').length;

  const top = [...voteCounts.entries()]
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([id, n]) => ({ keyword: keywords.find((k) => k.id === id), n }))
    .filter((x): x is { keyword: NonNullable<typeof x.keyword>; n: number } => Boolean(x.keyword));

  const feed = events.slice(-20).reverse();

  return (
    <aside
      className={clsx(
        'eb-scroll flex h-full min-h-0 flex-col gap-4 overflow-y-auto p-6',
        flush ? 'bg-white' : 'eb-panel',
      )}
      aria-label="집계 패널"
    >
      <Section title="칸별 개수">
        <ul className="space-y-1.5">
          {ZONES.map((z) => (
            <li key={z.key} className="flex items-center gap-2 text-[13px]">
              <span aria-hidden>{z.emoji}</span>
              <span style={{ color: z.label }} className="font-medium">
                {z.name}
              </span>
              <span className="ml-auto font-semibold tabular-nums">{count(z.key)}</span>
            </li>
          ))}
          <li className="flex items-center gap-2 border-t border-eb-line pt-1.5 text-[12px] text-eb-muted">
            <span>풀에 남은 카드</span>
            <span className="ml-auto tabular-nums">{count('pool')}</span>
          </li>
          <li className="flex items-center gap-2 text-[12px] text-eb-muted">
            <span>배치 완료</span>
            <span className="ml-auto tabular-nums">{placed}</span>
          </li>
        </ul>
      </Section>

      <Section title="축 분포">
        {placed === 0 ? (
          <p className="text-[12px] text-eb-muted">카드를 놓으면 칸별 축 구성이 보입니다.</p>
        ) : (
          <ul className="space-y-2.5">
            {ZONES.map((z) => {
              const slices = axisByZone.get(z.key) ?? [];
              const total = slices.reduce((m, s) => m + s.count, 0);
              return (
                <li key={z.key}>
                  <div className="mb-1 flex items-center gap-1.5 text-[12px]">
                    <span aria-hidden>{z.emoji}</span>
                    <span style={{ color: z.label }} className="font-medium">
                      {z.name}
                    </span>
                    <span className="ml-auto tabular-nums text-eb-muted">{total}</span>
                  </div>
                  <div
                    className="flex h-2.5 w-full overflow-hidden rounded-full bg-[#f1f1ee]"
                    role="img"
                    aria-label={`${z.name} 축 분포: ${
                      slices.map((s) => `${s.label} ${s.count}`).join(', ') || '없음'
                    }`}
                  >
                    {slices.map((s) => (
                      <span
                        key={s.key}
                        style={{ background: s.color, width: `${(s.count / total) * 100}%` }}
                        title={`${s.label} · ${s.count}장`}
                      />
                    ))}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {showAxis ? (
          <ul className="mt-3 space-y-1 border-t border-eb-line pt-2">
            {AXES.map((a) => (
              <li key={a.key} className="flex items-center gap-2 text-[11px]" title={a.meaning}>
                <span className="h-2 w-2 rounded-full" style={{ background: a.color }} aria-hidden />
                <span className="font-medium">{a.key}</span>
                <span className="text-eb-muted">{a.name}</span>
              </li>
            ))}
            <li className="flex items-center gap-2 text-[11px]">
              <span className="h-2 w-2 rounded-full bg-[#C9C9C2]" aria-hidden />
              <span className="text-eb-muted">축 없음</span>
            </li>
          </ul>
        ) : null}
      </Section>

      <Section title="예상≠실제" badge={mismatches.length}>
        {mismatches.length === 0 ? (
          <p className="text-[12px] text-eb-muted">예상과 다르게 놓인 카드가 아직 없습니다.</p>
        ) : (
          <ul className="space-y-1">
            {mismatches.map((m) => (
              <li key={m.keyword.id}>
                <button
                  type="button"
                  onClick={() => setHighlight(m.keyword.id)}
                  className="w-full rounded-lg px-1.5 py-1 text-left text-[12px] hover:bg-[#fafaf8]"
                >
                  <span className="font-medium">{m.keyword.text}</span>
                  <span className="text-eb-muted">
                    {' '}
                    · 예상 {placeEmoji(m.expected)} → 실제 {placeEmoji(m.actual)}{' '}
                    <span style={{ color: ZONE_MAP[m.actual].label }}>{placeLabel(m.actual)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {top.length > 0 ? (
        <Section title="상위 득표" badge={top.length}>
          <ul className="space-y-1">
            {top.map((t, i) => (
              <li key={t.keyword.id}>
                <button
                  type="button"
                  onClick={() => setHighlight(t.keyword.id)}
                  className="flex w-full items-center gap-2 rounded-lg px-1.5 py-1 text-left text-[12px] hover:bg-[#fafaf8]"
                >
                  <span className="w-3 shrink-0 font-bold tabular-nums text-eb-muted">{i + 1}</span>
                  <span className="truncate font-medium">{t.keyword.text}</span>
                  <span className="ml-auto shrink-0 font-semibold tabular-nums text-[#3D4A7A]">
                    ●{t.n}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <Section title={`온라인 ${presence.length}명`}>
        <ul className="space-y-1.5">
          {presence.length === 0 ? (
            <li className="text-[12px] text-eb-muted">아직 아무도 없습니다.</li>
          ) : (
            presence.map((p) => (
              <li key={p.participant.id} className="flex items-center gap-2 text-[13px]">
                <span
                  className="flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold text-white"
                  style={{ background: p.participant.color }}
                >
                  {initials(p.participant.nickname)}
                </span>
                <span className="truncate">{p.participant.nickname}</span>
              </li>
            ))
          )}
        </ul>
      </Section>

      <Section title="활동 피드" badge={feed.length}>
        {feed.length === 0 ? (
          <p className="text-[12px] text-eb-muted">아직 활동이 없습니다.</p>
        ) : (
          <ul className="space-y-1">
            {feed.map((e) => {
              const kid = typeof e.payload.keyword_id === 'string' ? e.payload.keyword_id : null;
              return (
                <li key={e.id}>
                  <button
                    type="button"
                    disabled={!kid}
                    onClick={() => kid && setHighlight(kid)}
                    className={clsx(
                      'w-full rounded-lg px-1.5 py-1 text-left text-[12px] leading-4',
                      kid ? 'hover:bg-[#fafaf8]' : 'cursor-default',
                    )}
                  >
                    <span className="text-eb-ink">{feedLine(e)}</span>
                    <span className="ml-1 text-[11px] text-eb-muted">{relTime(e.created_at)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Section>
    </aside>
  );
}
