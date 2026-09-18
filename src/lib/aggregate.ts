// 전체 집계 — /admin에서 조 보드 스냅샷 N개를 합산한다 (v1.1 C-3).

import { ZONES } from './design';
import type { BoardSnapshot, PlaceKey, Phase, ZoneKey } from './types';

export const ZONE_KEYS: ZoneKey[] = ZONES.map((z) => z.key);

export interface TeamEntry {
  teamNo: number;
  slug: string;
  snapshot: BoardSnapshot;
}

export interface TeamAgg {
  teamNo: number;
  slug: string;
  title: string;
  phase: Phase;
  locked: boolean;
  hideVomit: boolean;
  /** 칸에 놓인 카드 수 */
  placed: number;
  /** 보드의 전체 카드 수 (시드 46 + 참가자 카드) */
  total: number;
  votes: number;
  /** 마지막 활동 시각 (ISO) — 이벤트·배치 중 가장 최근 */
  lastActivity: string | null;
}

export interface CardAgg {
  text: string;
  isSeed: boolean;
  expected: PlaceKey | null;
  expected2: PlaceKey | null;
  /** 칸별로 그 칸에 놓은 조 수 */
  counts: Record<ZoneKey, number>;
  /** 어느 칸에든 놓은 조 수 */
  placedTeams: number;
  /** 모든 조 득표 합 */
  votes: number;
  /** 예상과 다르게 놓은 조 수 */
  mismatchTeams: number;
}

export function teamAgg(entry: TeamEntry): TeamAgg {
  const { snapshot } = entry;
  const placed = snapshot.placements.filter((p) => p.zone !== 'pool').length;
  const times: string[] = [];
  snapshot.events.forEach((e) => times.push(e.created_at));
  snapshot.placements.forEach((p) => {
    if (p.zone !== 'pool') times.push(p.updated_at);
  });
  times.sort();
  return {
    teamNo: entry.teamNo,
    slug: entry.slug,
    title: snapshot.board.title,
    phase: snapshot.board.phase,
    locked: snapshot.board.locked,
    hideVomit: snapshot.board.hide_vomit,
    placed,
    total: snapshot.keywords.length,
    votes: snapshot.votes.length,
    lastActivity: times.length ? times[times.length - 1] : null,
  };
}

function emptyCounts(): Record<ZoneKey, number> {
  return ZONE_KEYS.reduce(
    (acc, z) => ({ ...acc, [z]: 0 }),
    {} as Record<ZoneKey, number>,
  );
}

/**
 * 카드 문구별 × 칸별 빈도.
 * 같은 문구는 조가 달라도 한 행으로 묶는다(참가자가 만든 카드 포함).
 */
export function cardAggs(entries: TeamEntry[]): CardAgg[] {
  const map = new Map<string, CardAgg>();

  entries.forEach(({ snapshot }) => {
    const zoneOf = new Map(snapshot.placements.map((p) => [p.keyword_id, p.zone]));
    const voteOf = new Map<string, number>();
    snapshot.votes.forEach((v) => voteOf.set(v.keyword_id, (voteOf.get(v.keyword_id) ?? 0) + 1));

    snapshot.keywords.forEach((k) => {
      const key = k.text.trim();
      let row = map.get(key);
      if (!row) {
        row = {
          text: key,
          isSeed: k.is_seed,
          expected: k.expected,
          expected2: k.expected2,
          counts: emptyCounts(),
          placedTeams: 0,
          votes: 0,
          mismatchTeams: 0,
        };
        map.set(key, row);
      }
      if (k.is_seed) {
        row.isSeed = true;
        row.expected = row.expected ?? k.expected;
        row.expected2 = row.expected2 ?? k.expected2;
      }
      row.votes += voteOf.get(k.id) ?? 0;

      const zone = zoneOf.get(k.id);
      if (zone && zone !== 'pool') {
        row.counts[zone] += 1;
        row.placedTeams += 1;
        if (row.expected && zone !== row.expected && zone !== row.expected2) {
          row.mismatchTeams += 1;
        }
      }
    });
  });

  return [...map.values()];
}

/** 칸별 총 배치 수 (모든 조 합) */
export function zoneTotals(cards: CardAgg[]): Record<ZoneKey, number> {
  const out = emptyCounts();
  cards.forEach((c) => ZONE_KEYS.forEach((z) => (out[z] += c.counts[z])));
  return out;
}

/** 행의 최댓값 칸(들) — 표에서 강조용. 0이면 빈 배열 */
export function maxZonesOf(card: CardAgg): ZoneKey[] {
  const max = ZONE_KEYS.reduce((m, z) => Math.max(m, card.counts[z]), 0);
  if (max === 0) return [];
  return ZONE_KEYS.filter((z) => card.counts[z] === max);
}

export function mismatchRate(card: CardAgg): number {
  if (!card.expected || card.placedTeams === 0) return 0;
  return card.mismatchTeams / card.placedTeams;
}

export function fmtTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return '방금';
  if (m < 60) return `${m}분 전`;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}
