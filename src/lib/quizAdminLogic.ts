// 스피드 퀴즈 운영 로직 (Quiz v1.0) — 순수 함수. 운영자 화면만 쓴다(정답 시드 포함).

import { judge, type AutoVerdict } from './quizJudge';
import { QUIZ_SEED } from './quizSeed';
import type {
  QuizLeaderRow,
  QuizParticipant,
  QuizState,
  QuizSubmission,
  QuizVerdict,
  QuizWinner,
} from './quizTypes';

export interface SubmissionRow {
  sub: QuizSubmission;
  participant: QuizParticipant | undefined;
  auto: AutoVerdict;
  /** 최종 판정: 운영자 ✓/✗ > 자동(정답/오답). 자동이 '검토'이고 운영자가 안 정했으면 null */
  final: QuizVerdict | null;
  /** 문제를 연 뒤 경과 ms (문제를 연 시각을 모르면 null) */
  elapsedMs: number | null;
  /** 다른 문제에서 이미 상품을 받은 사람 */
  wonElsewhere: boolean;
}

export function autoVerdictFor(index: number, answer: string): AutoVerdict {
  const q = QUIZ_SEED[index];
  return q ? judge(q.judge, answer) : 'review';
}

export function finalVerdict(sub: QuizSubmission, auto: AutoVerdict): QuizVerdict | null {
  if (sub.verdict) return sub.verdict;
  return auto === 'review' ? null : auto;
}

export function openedAt(state: QuizState | null, index: number): number | null {
  const iso = state?.settings.opened?.[String(index)];
  return iso ? new Date(iso).getTime() : null;
}

/** 현재 문제의 제출을 서버 시각 순으로 판정과 함께 */
export function buildRows(
  index: number,
  state: QuizState | null,
  submissions: QuizSubmission[],
  participants: QuizParticipant[],
  winners: QuizWinner[],
): SubmissionRow[] {
  const byId = new Map(participants.map((p) => [p.id, p]));
  const opened = openedAt(state, index);
  // 1인 1회는 상품이 걸린 본 문제끼리만 (연습 문제 0번의 첫 정답은 수상으로 치지 않는다)
  const elsewhere = new Set(
    index === 0
      ? []
      : winners.filter((w) => w.question_index !== index && w.question_index > 0).map((w) => w.participant_id),
  );
  return submissions
    .filter((s) => s.question_index === index)
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map((sub) => {
      const auto = autoVerdictFor(index, sub.answer);
      return {
        sub,
        participant: byId.get(sub.participant_id),
        auto,
        final: finalVerdict(sub, auto),
        elapsedMs: opened === null ? null : new Date(sub.created_at).getTime() - opened,
        wonElsewhere: elsewhere.has(sub.participant_id),
      };
    });
}

/** 첫 정답 후보 — 서버 시각 순으로 최종 정답이면서 다른 문제 수상자가 아닌 첫 사람 */
export function firstEligible(rows: SubmissionRow[]): SubmissionRow | null {
  return rows.find((r) => r.final === 'correct' && !r.wonElsewhere) ?? null;
}

/**
 * 최종 순위 — 본 문제(연습 제외) 정답 수 내림차순, 동점이면 맞힌 문제의 응답 시간 합이 작은 순.
 * 판정은 저장된 최종 판정 > 자동 판정(검토는 오답으로 센다).
 */
export function leaderboard(
  state: QuizState | null,
  submissions: QuizSubmission[],
  participants: QuizParticipant[],
  top = 3,
): QuizLeaderRow[] {
  const agg = new Map<string, { correct: number; latency: number }>();
  submissions.forEach((s) => {
    const q = QUIZ_SEED[s.question_index];
    if (!q || q.practice) return;
    const v = finalVerdict(s, autoVerdictFor(s.question_index, s.answer));
    if (v !== 'correct') return;
    const opened = openedAt(state, s.question_index);
    const lat = opened === null ? 0 : Math.max(0, new Date(s.created_at).getTime() - opened);
    const cur = agg.get(s.participant_id) ?? { correct: 0, latency: 0 };
    cur.correct += 1;
    cur.latency += lat;
    agg.set(s.participant_id, cur);
  });
  const byId = new Map(participants.map((p) => [p.id, p]));
  return [...agg.entries()]
    .filter(([id]) => byId.has(id))
    .sort((a, b) => b[1].correct - a[1].correct || a[1].latency - b[1].latency)
    .slice(0, top)
    .map(([id, v], i) => ({
      rank: i + 1,
      participant_id: id,
      name: byId.get(id)!.name,
      table_no: byId.get(id)!.table_no,
      correct: v.correct,
      latency_ms: v.latency,
    }));
}

const VERDICT_KO: Record<string, string> = { correct: '정답', wrong: '오답', review: '검토' };

export function verdictLabel(v: AutoVerdict | QuizVerdict | null): string {
  return v ? VERDICT_KO[v] : '검토';
}

/** 전체 제출 CSV 행 — no, 이름, 테이블, 답, 서버시각, 경과ms, 판정, 수상 */
export function submissionsCsvRows(
  state: QuizState | null,
  submissions: QuizSubmission[],
  participants: QuizParticipant[],
  winners: QuizWinner[],
): Record<string, string | number>[] {
  const byId = new Map(participants.map((p) => [p.id, p]));
  const winSub = new Set(winners.map((w) => w.submission_id));
  return [...submissions]
    .sort((a, b) => a.question_index - b.question_index || a.created_at.localeCompare(b.created_at))
    .map((s) => {
      const auto = autoVerdictFor(s.question_index, s.answer);
      const opened = openedAt(state, s.question_index);
      const p = byId.get(s.participant_id);
      return {
        no: QUIZ_SEED[s.question_index]?.no ?? s.question_index,
        이름: p?.name ?? '',
        테이블: p?.table_no ?? '',
        답: s.answer,
        서버시각: s.created_at,
        경과ms: opened === null ? '' : new Date(s.created_at).getTime() - opened,
        판정: verdictLabel(finalVerdict(s, auto) ?? 'review'),
        수상: winSub.has(s.id) ? 'Y' : '',
      };
    });
}

export const SUBMISSION_CSV_COLUMNS = ['no', '이름', '테이블', '답', '서버시각', '경과ms', '판정', '수상'];

/** 수상자 CSV 행 — no, 이름, 테이블, 답, 서버시각, 경과ms */
export function winnersCsvRows(
  state: QuizState | null,
  submissions: QuizSubmission[],
  participants: QuizParticipant[],
  winners: QuizWinner[],
): Record<string, string | number>[] {
  const byId = new Map(participants.map((p) => [p.id, p]));
  const subById = new Map(submissions.map((s) => [s.id, s]));
  return [...winners]
    .filter((w) => w.question_index > 0) // 연습 문제는 상품 없음
    .sort((a, b) => a.question_index - b.question_index)
    .map((w) => {
      const s = subById.get(w.submission_id);
      const p = byId.get(w.participant_id);
      const opened = openedAt(state, w.question_index);
      return {
        no: QUIZ_SEED[w.question_index]?.no ?? w.question_index,
        이름: p?.name ?? '',
        테이블: p?.table_no ?? '',
        답: s?.answer ?? '',
        서버시각: s?.created_at ?? '',
        경과ms: s && opened !== null ? new Date(s.created_at).getTime() - opened : '',
      };
    });
}

export const WINNER_CSV_COLUMNS = ['no', '이름', '테이블', '답', '서버시각', '경과ms'];
