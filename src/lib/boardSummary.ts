// 토의보드 AI 갈무리 리포트 (Board v1.2) — 타입 · 검증/정리 · 가짜 요약. 서버·클라이언트 공용(비밀 없음).
//   Claude 호출과 프롬프트는 boardSummary.server.ts, 라우트는 src/app/api/board/summary/route.ts.
//   원칙: 반조 정보(team_id·card)는 AI에도 화면에도 가지 않는다 → 입력(BoardSummarySource)에 아예 없다.
//   AI 출력은 그대로 믿지 않는다 — sanitizeSummary 가 새 객체로 다시 만들고, 인용(quote)이 원문의 부분 문자열이 아니면 비운다.

import { groupById, groupLabel, type BoardGroupId, type BoardItemId } from './boardSeed';

export interface BoardSummaryTheme {
  title: string;
  count: number;
  /** 원문 그대로 일부, 없으면 '' */
  quote: string;
}
export interface BoardSummaryStandout {
  quote: string;
  why: string;
}
export interface BoardSummarySection {
  item_id: BoardItemId;
  themes: BoardSummaryTheme[];
  standouts: BoardSummaryStandout[];
  offtopic: number;
}
export interface BoardSummaryData {
  headline: string;
  takeaway: string;
  sections: BoardSummarySection[];
  /** 가짜(예시) 요약이면 true — 화면에 '예시 · AI 아님' 배지 */
  fake?: boolean;
}
export interface BoardSummary {
  group: BoardGroupId;
  data: BoardSummaryData;
  model: string;
  /** 요약에 쓴 답 수 */
  source_count: number;
  created_at: string;
}

/** AI(또는 가짜 요약)에 들어가는 원문 — 반조·카드 정보 없음 */
export interface BoardSummarySource {
  items: { item_id: BoardItemId; title: string; prompt: string }[];
  answers: { item_id: BoardItemId; body: string }[];
}

/** 길이 한도 (글자 수) */
export const SUMMARY_LIMITS = {
  headline: 60,
  takeaway: 90,
  title: 24,
  quote: 100,
  why: 40,
  themes: 6,
  standouts: 2,
} as const;

export const DEFAULT_HEADLINE = '오늘 나온 답 모아보기';

// ─── 문자열 정리 ──────────────────────────────────────────────

/** 제어문자(줄바꿈·탭은 공백으로) 제거 + 공백 정규화 + 앞뒤 공백 제거 */
function clean(v: unknown): string {
  if (typeof v !== 'string') return '';
  return v
    .replace(/[\r\n\t\u2028\u2029]+/g, ' ')
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 글자(코드포인트) 단위로 자르기 */
function cut(s: string, max: number): string {
  const chars = Array.from(s);
  return chars.length <= max ? s : chars.slice(0, max).join('').trimEnd();
}

function text(v: unknown, max: number): string {
  return cut(clean(v), max);
}

const QUOTE_CHARS = '"\'“”„‟‘’‚‛「」『』«»';

/** 인용 후보에서 앞뒤 따옴표·말줄임을 떼고 공백을 정규화한다. 말줄임이 있었는지도 돌려준다 */
function stripQuote(v: unknown): { body: string; ellipsis: boolean } {
  let s = clean(v);
  let ellipsis = false;
  // 따옴표와 말줄임이 겹겹이 올 수 있어 몇 번 돌린다
  for (let i = 0; i < 4; i += 1) {
    const before = s;
    while (s && QUOTE_CHARS.includes(s[0])) s = s.slice(1).trimStart();
    while (s && QUOTE_CHARS.includes(s[s.length - 1])) s = s.slice(0, -1).trimEnd();
    if (s.endsWith('…')) {
      s = s.slice(0, -1).trimEnd();
      ellipsis = true;
    } else if (s.endsWith('...')) {
      s = s.slice(0, -3).trimEnd();
      ellipsis = true;
    }
    if (s === before) break;
  }
  return { body: s, ellipsis };
}

/** 원문 비교용 — 줄바꿈·연속 공백을 한 칸으로 */
function flat(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * 인용 검증 — 후보가 pool(원문 답들) 중 하나의 부분 문자열이면 정리한 인용을, 아니면 ''.
 * 말줄임(…)은 '일부만 옮겼다'는 표시라서, 원래 있었거나 길이 때문에 잘랐으면 끝에 …를 붙인다.
 */
function verifyQuote(v: unknown, pool: string[]): string {
  const { body, ellipsis } = stripQuote(v);
  if (!body) return '';
  if (!pool.some((p) => p.includes(body))) return '';
  const chars = Array.from(body);
  const limit = SUMMARY_LIMITS.quote;
  if (chars.length > limit) return `${chars.slice(0, limit - 1).join('').trimEnd()}…`;
  return ellipsis ? `${body}…` : body;
}

function toCount(v: unknown, max: number): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  if (!Number.isFinite(n)) return 0;
  return Math.min(Math.max(Math.round(n), 0), max);
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function asObj(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

// ─── 검증·정리 ────────────────────────────────────────────────

/**
 * AI 출력(raw)을 저장 가능한 모양으로 다시 만든다 — 서버에서, 저장 전에.
 *  - 문자열: 제어문자 제거·trim·길이 자르기
 *  - quote: 그 항목 답(standout 은 그 그룹 답) 중 하나의 부분 문자열이어야 한다(아니면 '' · standout 은 통째로 버림)
 *  - count: 정수, 0~답 수 / themes 는 count 내림차순 최대 6
 *  - sections: 그룹 항목 순서대로 하나씩(없으면 빈 섹션), 모르는 item_id 는 버림
 *  - 알 수 없는 키(team_id 등)는 복사하지 않는다 / fake 는 여기서 정하지 않는다
 */
export function sanitizeSummary(raw: unknown, source: BoardSummarySource): BoardSummaryData {
  const root = asObj(raw);
  const itemIds = source.items.map((i) => i.item_id);
  const rawSections = asArray(root.sections).map(asObj);

  // 눈여겨볼 의견(standouts)은 섹션 구분이 없는 스키마라, 그 그룹 모든 답에서 찾는다
  const groupPool = source.answers.map((a) => flat(a.body));

  const sections: BoardSummarySection[] = itemIds.map((itemId) => {
    const found = rawSections.find((s) => s.item_id === itemId) ?? {};
    const pool = source.answers.filter((a) => a.item_id === itemId).map((a) => flat(a.body));
    const max = pool.length;

    const themes: BoardSummaryTheme[] = asArray(found.themes)
      .map(asObj)
      .map((t) => ({
        title: text(t.title, SUMMARY_LIMITS.title),
        count: toCount(t.count, max),
        quote: verifyQuote(t.quote, pool),
      }))
      .filter((t) => t.title !== '')
      .map((t, i) => ({ t, i }))
      // 큰 주제부터 — 같으면 AI가 준 순서 유지
      .sort((a, b) => b.t.count - a.t.count || a.i - b.i)
      .map(({ t }) => t)
      .slice(0, SUMMARY_LIMITS.themes);

    const seen = new Set<string>();
    const standouts: BoardSummaryStandout[] = [];
    for (const s of asArray(found.standouts).map(asObj)) {
      // 눈여겨볼 의견은 인용이 확인돼야만 싣는다 — 원문에서 못 찾으면 통째로 버린다
      const quote = verifyQuote(s.quote, groupPool);
      if (!quote || seen.has(quote)) continue;
      seen.add(quote);
      standouts.push({ quote, why: text(s.why, SUMMARY_LIMITS.why) });
      if (standouts.length >= SUMMARY_LIMITS.standouts) break;
    }

    return { item_id: itemId, themes, standouts, offtopic: toCount(found.offtopic, max) };
  });

  return {
    headline: text(root.headline, SUMMARY_LIMITS.headline) || DEFAULT_HEADLINE,
    takeaway: text(root.takeaway, SUMMARY_LIMITS.takeaway),
    sections,
  };
}

// ─── 가짜 요약 (키 없을 때 · 로컬 · E2E) ───────────────────────

/** 결정적 — 같은 입력이면 같은 출력. AI가 아님이 화면에 보이도록 fake: true */
export function fakeSummary(source: BoardSummarySource): BoardSummaryData {
  const sections = source.items.map((it) => {
    const answers = source.answers.filter((a) => a.item_id === it.item_id).map((a) => flat(a.body)).filter(Boolean);
    // 길이 내림차순(같으면 들어온 순서), 상위 4개
    const top = answers
      .map((body, i) => ({ body, i }))
      .sort((a, b) => Array.from(b.body).length - Array.from(a.body).length || a.i - b.i)
      .slice(0, 4);
    const k = top.length;
    const base = k ? Math.floor(answers.length / k) : 0;
    const rest = k ? answers.length % k : 0;
    const themes = top.map(({ body }, idx) => ({
      title: Array.from(body).length > 12 ? `${Array.from(body).slice(0, 12).join('')}…` : body,
      count: base + (idx < rest ? 1 : 0),
      quote: Array.from(body).length > 60 ? `${Array.from(body).slice(0, 60).join('')}…` : body,
    }));
    const shortest = answers.map((body, i) => ({ body, i })).sort((a, b) => Array.from(a.body).length - Array.from(b.body).length || a.i - b.i)[0];
    return {
      item_id: it.item_id,
      themes,
      standouts: shortest ? [{ quote: shortest.body, why: '예시' }] : [],
      offtopic: 0,
    };
  });
  // 같은 정리 규칙(인용 검증·길이·정렬)을 거친다
  const data = sanitizeSummary({ headline: '[예시] AI 키를 넣으면 진짜 갈무리가 나옵니다', takeaway: '지금은 화면 모양 확인용 예시입니다', sections }, source);
  return { ...data, fake: true };
}

// ─── 표시용 보정 ──────────────────────────────────────────────

/**
 * 화면에 그리기 전 방어 — DB 에 직접 넣은 사전 생성본 등이 조금 어긋나도 화면이 깨지지 않게 한다.
 * (정식 경로는 sanitizeSummary 를 거친 값이라 그대로 통과한다)
 */
export function safeSummaryData(raw: unknown): BoardSummaryData {
  const root = asObj(raw);
  const sections: BoardSummarySection[] = asArray(root.sections)
    .map(asObj)
    .map((s) => ({
      item_id: (typeof s.item_id === 'string' ? s.item_id : '') as BoardItemId,
      themes: asArray(s.themes)
        .map(asObj)
        .map((t) => ({ title: text(t.title, SUMMARY_LIMITS.title), count: Math.max(0, Math.round(Number(t.count) || 0)), quote: text(t.quote, SUMMARY_LIMITS.quote) }))
        .filter((t) => t.title)
        .slice(0, SUMMARY_LIMITS.themes),
      standouts: asArray(s.standouts)
        .map(asObj)
        .map((o) => ({ quote: text(o.quote, SUMMARY_LIMITS.quote), why: text(o.why, SUMMARY_LIMITS.why) }))
        .filter((o) => o.quote)
        .slice(0, SUMMARY_LIMITS.standouts),
      offtopic: Math.max(0, Math.round(Number(s.offtopic) || 0)),
    }))
    .filter((s) => s.item_id);
  return {
    headline: text(root.headline, SUMMARY_LIMITS.headline) || DEFAULT_HEADLINE,
    takeaway: text(root.takeaway, SUMMARY_LIMITS.takeaway),
    sections,
    ...(root.fake === true ? { fake: true } : {}),
  };
}

/** 요약 한 줄 이름 — '1-2 남았으면 하는 것' */
export function summaryGroupName(group: BoardGroupId): string {
  const g = groupById(group);
  return g ? `${groupLabel(g.id)} ${g.title}` : group;
}
