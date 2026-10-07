// 토의보드 내보내기 (Board v1.0) — CSV 2종(와이드·롱) + JSON. 순수 함수(테스트 가능).
//   와이드: 58행 × 12열 (반조, 테이블, 임원, Q1-1 … Q2-3b, 제출시각). 숨김 카드는 비운다.
//   롱: 제출 1건 = 1행 (반조, 항목, 본문, 제출시각, 숨김여부, 숨김사유, 수정횟수). 숨김 포함.
//   Excel에서 한글이 깨지지 않게 BOM을 붙인다. 시각은 한국 시간(KST).

import { BOARD_ITEMS, BOARD_TEAMS } from './boardSeed';
import type { BoardAdminSnapshot, BoardAdminSubmission } from './boardTypes';

const BOM = '﻿';

function cell(v: string | number | boolean | null | undefined): string {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function row(cells: (string | number | boolean | null | undefined)[]): string {
  return cells.map(cell).join(',');
}

/** ISO → 'YYYY-MM-DD HH:mm:ss' (KST) */
export function kst(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(new Date(iso).getTime() + 9 * 3600_000);
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

export function wideCsv(subs: BoardAdminSubmission[]): string {
  const header = ['반조', '테이블', '임원테이블', ...BOARD_ITEMS.map((i) => i.id), '마지막제출시각'];
  const lines = [row(header)];
  for (const t of BOARD_TEAMS) {
    const mine = subs.filter((s) => s.team_id === t.id);
    const last = mine.map((s) => s.updated_at).sort().at(-1) ?? null;
    lines.push(
      row([
        t.id,
        t.table_no,
        t.is_exec ? 'Y' : '',
        ...BOARD_ITEMS.map((i) => {
          const s = mine.find((x) => x.item_id === i.id);
          return s && !s.hidden ? s.body : '';
        }),
        kst(last),
      ]),
    );
  }
  return BOM + lines.join('\r\n') + '\r\n';
}

export function longCsv(subs: BoardAdminSubmission[]): string {
  const order = (id: string) => BOARD_ITEMS.findIndex((i) => i.id === id);
  const teamOrder = (id: string) => BOARD_TEAMS.findIndex((t) => t.id === id);
  const sorted = [...subs].sort((a, b) => teamOrder(a.team_id) - teamOrder(b.team_id) || order(a.item_id) - order(b.item_id));
  const lines = [row(['반조', '항목', '본문', '제출시각', 'hidden', '숨김사유', '수정횟수'])];
  for (const s of sorted) {
    lines.push(row([s.team_id, s.item_id, s.body, kst(s.updated_at), s.hidden ? 'true' : 'false', s.hidden_note ?? '', s.edited_count]));
  }
  return BOM + lines.join('\r\n') + '\r\n';
}

export function fullJson(snap: BoardAdminSnapshot): string {
  return JSON.stringify({ exported_at: new Date().toISOString(), ...snap }, null, 2);
}

export function stamp(d = new Date()): string {
  return kst(d.toISOString()).replace(/[-:]/g, '').replace(' ', '-').slice(0, 13);
}

export function download(name: string, text: string, type: string): void {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
