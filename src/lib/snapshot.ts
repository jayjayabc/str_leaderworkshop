// 스냅샷 생성 유틸 — 두 어댑터가 공유한다.

import { SEED_CARDS } from './seed';
import type { Board, BoardSnapshot, Keyword, Placement } from './types';

export function uid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `id-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
}

const SLUG_ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';

export function makeSlug(): string {
  let s = '';
  for (let i = 0; i < 8; i += 1) {
    s += SLUG_ALPHABET[Math.floor(Math.random() * SLUG_ALPHABET.length)];
  }
  return s;
}

export function emptyBoard(title: string, slug: string): Board {
  return {
    id: uid(),
    slug,
    title: title.trim() || '코끼리 보드',
    phase: 'placing',
    locked: false,
    hide_vomit: false,
    show_axis: false,
    settings: {},
    created_at: new Date().toISOString(),
  };
}

/** 시드 46장을 keywords + pool placements로 펼친다. */
export function seedRows(boardId: string): { keywords: Keyword[]; placements: Placement[] } {
  const now = new Date().toISOString();
  const keywords: Keyword[] = [];
  const placements: Placement[] = [];
  SEED_CARDS.forEach((card, i) => {
    const id = uid();
    keywords.push({
      id,
      board_id: boardId,
      text: card.text,
      axis: card.axis,
      axis2: card.axis2 ?? null,
      expected: card.expected,
      expected2: card.expected2 ?? null,
      source: card.source,
      created_by: null,
      created_by_name: null,
      created_at: now,
      is_seed: true,
    });
    placements.push({
      id: uid(),
      board_id: boardId,
      keyword_id: id,
      zone: 'pool',
      sort_order: i,
      placed_by: null,
      placed_by_name: null,
      updated_at: now,
    });
  });
  return { keywords, placements };
}

export function newSnapshot(title: string, slug: string): BoardSnapshot {
  const board = emptyBoard(title, slug);
  const { keywords, placements } = seedRows(board.id);
  return { board, keywords, placements, notes: [], votes: [], events: [] };
}

/** 문구 중복 판정 — 공백·대소문자 무시 */
export function normalizeText(text: string): string {
  return text.replace(/\s+/g, '').toLowerCase();
}
