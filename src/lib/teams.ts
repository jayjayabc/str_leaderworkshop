// 조(팀) 모델 — v1.1
//   워크샵 하나에 N개 조가 있고, n조의 보드 slug는 `t{nn}`(t01…t30), 제목은 `{n}조`.
//   N은 NEXT_PUBLIC_TEAM_COUNT(기본 30)이고 1~99로 클램프된다.

export const DEFAULT_TEAM_COUNT = 30;

function clamp(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_TEAM_COUNT;
  return Math.max(1, Math.min(99, Math.floor(n)));
}

export const TEAM_COUNT: number = clamp(
  Number(process.env.NEXT_PUBLIC_TEAM_COUNT ?? DEFAULT_TEAM_COUNT),
);

/** 1 → 't01' */
export function teamSlug(no: number): string {
  return `t${String(clamp(no)).padStart(2, '0')}`;
}

/** 1 → '1조' */
export function teamTitle(no: number): string {
  return `${clamp(no)}조`;
}

/** 't07' → 7, 그 외 → null (레거시 slug는 조 번호가 없다) */
export function teamNoOf(slug: string): number | null {
  const m = /^t(\d{2})$/.exec(slug.trim());
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 1 && n <= 99 ? n : null;
}

/** 1…TEAM_COUNT */
export function teamNumbers(count: number = TEAM_COUNT): number[] {
  return Array.from({ length: clamp(count) }, (_, i) => i + 1);
}

// ─── 마지막 입장 정보 (홈 화면 프리셀렉트) ──────────────────────

const LAST_KEY = 'eb:last-entry';

export interface LastEntry {
  team: number;
  name: string;
}

export function readLastEntry(): LastEntry | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(LAST_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LastEntry>;
    if (typeof parsed.team !== 'number' || typeof parsed.name !== 'string') return null;
    return { team: clamp(parsed.team), name: parsed.name };
  } catch {
    return null;
  }
}

export function writeLastEntry(entry: LastEntry): void {
  try {
    window.localStorage.setItem(LAST_KEY, JSON.stringify(entry));
  } catch {
    /* noop */
  }
}
