// 내보내기 — JSON · CSV · PNG (BRIEF §11-9, M10)

import Papa from 'papaparse';
import { toPng } from 'html-to-image';

import type { BoardSnapshot, Keyword, Note, PlaceKey, Placement, Vote } from './types';

/** 보드 영역 캡처 대상에 붙이는 id (발표 모드/일반 모드 모두 이 id를 쓴다) */
export const CAPTURE_ID = 'eb-capture';

export const CAPTURE_BG = '#F7F7F5';

function stamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

export function exportName(slug: string, ext: string): string {
  return `elephant-board_${slug}_${stamp()}.${ext}`;
}

function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  triggerDownload(url, filename);
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function triggerDownload(url: string, filename: string): void {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** JSON — 보드 전체 스냅샷 */
export function exportJson(snapshot: BoardSnapshot): void {
  const blob = new Blob([JSON.stringify(snapshot, null, 2)], {
    type: 'application/json;charset=utf-8',
  });
  saveBlob(blob, exportName(snapshot.board.slug, 'json'));
}

export interface CsvRow {
  id: string;
  text: string;
  zone: PlaceKey | '';
  axis: string;
  axis2: string;
  expected: string;
  expected2: string;
  votes: number;
  created_by_name: string;
  is_seed: string;
  source: string;
  notes: string;
}

export function toCsvRows(
  keywords: Keyword[],
  placements: Placement[],
  votes: Vote[],
  notes: Note[],
): CsvRow[] {
  const zoneOf = new Map(placements.map((p) => [p.keyword_id, p.zone]));
  const voteCount = new Map<string, number>();
  votes.forEach((v) => voteCount.set(v.keyword_id, (voteCount.get(v.keyword_id) ?? 0) + 1));
  const noteText = new Map<string, string[]>();
  notes
    .slice()
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .forEach((n) => {
      const list = noteText.get(n.keyword_id) ?? [];
      list.push(n.text);
      noteText.set(n.keyword_id, list);
    });

  return keywords.map((k) => ({
    id: k.id,
    text: k.text,
    zone: zoneOf.get(k.id) ?? '',
    axis: k.axis ?? '',
    axis2: k.axis2 ?? '',
    expected: k.expected ?? '',
    expected2: k.expected2 ?? '',
    votes: voteCount.get(k.id) ?? 0,
    created_by_name: k.created_by_name ?? '',
    is_seed: k.is_seed ? 'true' : 'false',
    source: k.source ?? '',
    notes: (noteText.get(k.id) ?? []).join(' | '),
  }));
}

/** CSV — 엑셀에서 한글이 깨지지 않도록 UTF-8 BOM을 붙인다 */
export function exportCsv(snapshot: BoardSnapshot): void {
  const rows = toCsvRows(snapshot.keywords, snapshot.placements, snapshot.votes, snapshot.notes);
  const csv = Papa.unparse(rows, {
    columns: [
      'id',
      'text',
      'zone',
      'axis',
      'axis2',
      'expected',
      'expected2',
      'votes',
      'created_by_name',
      'is_seed',
      'source',
      'notes',
    ],
  });
  const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' });
  saveBlob(blob, exportName(snapshot.board.slug, 'csv'));
}

/** PNG — 보드 영역 스냅샷 (발표 모드가 켜져 있으면 그 DOM이 캡처된다) */
export async function exportPng(slug: string): Promise<void> {
  const node = document.getElementById(CAPTURE_ID);
  if (!node) throw new Error('보드 영역을 찾을 수 없습니다');
  const dataUrl = await toPng(node, {
    pixelRatio: 2,
    backgroundColor: CAPTURE_BG,
    cacheBust: true,
  });
  triggerDownload(dataUrl, exportName(slug, 'png'));
}

// ─── v1.1 — 운영자 일괄 내보내기 (/admin) ────────────────────────

/** elephant-board_all_{yyyyMMdd-HHmm}.{ext} */
export function allExportName(ext: string): string {
  return `elephant-board_all_${stamp()}.${ext}`;
}

export interface AllCsvRow {
  team_no: number | '';
  slug: string;
  text: string;
  zone: PlaceKey | '';
  axis: string;
  expected: string;
  votes: number;
  created_by_name: string;
  is_seed: string;
  notes: string;
}

export const ALL_CSV_COLUMNS = [
  'team_no',
  'slug',
  'text',
  'zone',
  'axis',
  'expected',
  'votes',
  'created_by_name',
  'is_seed',
  'notes',
] as const;

export function toAllCsvRows(
  entries: { teamNo: number | null; snapshot: BoardSnapshot }[],
): AllCsvRow[] {
  const out: AllCsvRow[] = [];
  entries.forEach(({ teamNo, snapshot }) => {
    const zoneOf = new Map(snapshot.placements.map((p) => [p.keyword_id, p.zone]));
    const voteCount = new Map<string, number>();
    snapshot.votes.forEach((v) =>
      voteCount.set(v.keyword_id, (voteCount.get(v.keyword_id) ?? 0) + 1),
    );
    const noteText = new Map<string, string[]>();
    snapshot.notes
      .slice()
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .forEach((n) => {
        const list = noteText.get(n.keyword_id) ?? [];
        list.push(n.text);
        noteText.set(n.keyword_id, list);
      });

    snapshot.keywords.forEach((k) => {
      out.push({
        team_no: teamNo ?? '',
        slug: snapshot.board.slug,
        text: k.text,
        zone: zoneOf.get(k.id) ?? '',
        axis: k.axis ?? '',
        expected: k.expected ?? '',
        votes: voteCount.get(k.id) ?? 0,
        created_by_name: k.created_by_name ?? '',
        is_seed: k.is_seed ? 'true' : 'false',
        notes: (noteText.get(k.id) ?? []).join(' | '),
      });
    });
  });
  return out;
}

/** 모든 조를 한 CSV로 (UTF-8 BOM) */
export function exportAllCsv(entries: { teamNo: number | null; snapshot: BoardSnapshot }[]): void {
  const csv = Papa.unparse(toAllCsvRows(entries), { columns: [...ALL_CSV_COLUMNS] });
  saveBlob(new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' }), allExportName('csv'));
}

/** 모든 조의 스냅샷을 한 JSON으로 */
export function exportAllJson(entries: { teamNo: number | null; snapshot: BoardSnapshot }[]): void {
  const payload = {
    exported_at: new Date().toISOString(),
    teams: entries.map(({ teamNo, snapshot }) => ({
      team_no: teamNo,
      slug: snapshot.board.slug,
      snapshot,
    })),
  };
  saveBlob(
    new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' }),
    allExportName('json'),
  );
}

/** 인쇄·QR용 링크 목록 CSV (조, URL) */
export function exportLinksCsv(rows: { team: number; url: string }[]): void {
  const csv = Papa.unparse(
    rows.map((r) => ({ 조: `${r.team}조`, URL: r.url })),
    { columns: ['조', 'URL'] },
  );
  saveBlob(
    new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' }),
    `elephant-board_links_${stamp()}.csv`,
  );
}
