// 점수 계산 (Quiz v2.1) — 배점 + 선착순 가산. 의존성 없는 순수 함수(로컬 어댑터·운영자 화면·테스트 공용).
// ⚠ SQL quiz_scoreboard(supabase/quiz_v2.1_migration.sql)와 규칙이 같아야 한다.

import type { QuizScoreRow, QuizState, QuizSubmission, SpeedRule, SpeedTier } from './quizTypes';


/** 처음 켤 때의 기본 규칙 — 1등 ×3, 2~5등 ×2 */
export const DEFAULT_SPEED_TIERS: SpeedTier[] = [
  { upto: 1, mode: 'x', v: 3 },
  { upto: 5, mode: 'x', v: 2 },
];

/** 이 문항의 선착순 규칙 — 꺼져 있으면 null */
export function speedRuleFor(state: Pick<QuizState, 'settings'> | null, index: number): SpeedRule | null {
  const r = state?.settings.speed?.[String(index)];
  if (!r || !r.on || !Array.isArray(r.tiers) || !r.tiers.length) return null;
  return { on: true, tiers: [...r.tiers].sort((a, b) => a.upto - b.upto) };
}

/** 정답 순서(rank, 1부터)에 따른 점수 — SQL quiz_scoreboard와 같은 규칙 */
export function awardFor(base: number, rule: SpeedRule | null, rank: number): { pts: number; tier: SpeedTier | null } {
  if (!rule) return { pts: base, tier: null };
  const tier = [...rule.tiers].sort((a, b) => a.upto - b.upto).find((t) => rank <= t.upto) ?? null;
  if (!tier) return { pts: base, tier: null };
  const pts = tier.mode === '+' ? base + tier.v : base * tier.v;
  return { pts, tier };
}

/** "1등 ×3 · 2~5등 ×2" */
export function speedLabel(rule: SpeedRule | null): string {
  if (!rule) return '';
  const tiers = [...rule.tiers].sort((a, b) => a.upto - b.upto);
  let from = 1;
  return tiers
    .map((t) => {
      const range = t.upto <= from ? `${t.upto}등` : `${from}~${t.upto}등`;
      from = t.upto + 1;
      return `${range} ${t.mode === '+' ? '+' : '×'}${t.v}${t.mode === '+' ? '점' : ''}`;
    })
    .join(' · ');
}


/** 기본 배점 — 설정값이 없으면 10 (연습 문제는 점수판에서 빠진다) */
export function basePoints(state: Pick<QuizState, 'settings'> | null, index: number, fallback = 10): number {
  const v = state?.settings.points?.[String(index)];
  return typeof v === 'number' && v >= 0 ? v : fallback;
}

/** 한 문항의 정답 조 순서 — 서버 제출 시각(수정 시 마지막 수정 시각) → id 순 */
export function correctOrder(subs: QuizSubmission[], index: number): QuizSubmission[] {
  return subs
    .filter((x) => x.question_index === index && x.verdict === 'correct' && x.team_no != null)
    .sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** 조별 점수판 — SQL quiz_scoreboard와 같은 계산 */
export function scoreTeams(
  subs: QuizSubmission[],
  state: Pick<QuizState, 'settings' | 'status' | 'current_index'>,
  teams: number,
  members: Map<number, number> = new Map(),
): QuizScoreRow[] {
  const score = new Map<number, number>();
  const correct = new Map<number, number>();
  const indexes = [...new Set(subs.map((x) => x.question_index))].filter(
    (i) => i > 0 && (i !== state.current_index || state.status === 'revealed' || state.status === 'final'),
  );
  for (const i of indexes) {
    const base = basePoints(state, i);
    const rule = speedRuleFor(state as QuizState, i);
    correctOrder(subs, i).forEach((x, k) => {
      const t = x.team_no as number;
      score.set(t, (score.get(t) ?? 0) + awardFor(base, rule, k + 1).pts);
      correct.set(t, (correct.get(t) ?? 0) + 1);
    });
  }
  const rows: QuizScoreRow[] = [];
  for (let t = 1; t <= teams; t += 1) {
    rows.push({ team_no: t, score: Math.round(score.get(t) ?? 0), correct: correct.get(t) ?? 0, members: members.get(t) ?? 0 });
  }
  return rows;
}
