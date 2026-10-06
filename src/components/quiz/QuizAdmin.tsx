'use client';

// 운영자 화면 (Quiz v2.0 단체전)
//   문항 목록(배점) · 현재 문제(정답·판정·해설) · 열기/마감/공개/다음 · 배점 조절(키보드 없이 버튼)
//   조별 제출 표(자동 판정 + ✓/✗) · 점수판 · CSV · 초기화. 첫 정답자 시상은 v2.0에서 쓰지 않는다.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import clsx from 'clsx';

import { keyFromUrl, readStoredKey, writeStoredKey } from '@/lib/admin';
import { downloadCsv, fileStamp } from '@/lib/export';
import { getQuizDb } from '@/lib/quizDb';
import {
  durationFor,
  fmtClock,
  keywordFor,
  pointsFor,
  rankScores,
  remainingMs,
  useNow,
  useQuizState,
  useScoreboard,
  useServerOffset,
} from '@/lib/quizClient';
import { describeJudge } from '@/lib/quizJudge';
import { DEFAULT_SPEED_TIERS, awardFor, speedLabel, speedRuleFor } from '@/lib/quizScore';
import { getSeed, loadQuizKeys } from '@/lib/quizSeedStore';
import { FIELD_SEP, QUIZ_QUESTIONS, QUIZ_TEAMS, questionLabel } from '@/lib/quizQuestions';
import {
  SCORE_CSV_COLUMNS,
  SUBMISSION_CSV_COLUMNS,
  buildRows,
  rejudgeTargets,
  scoreCsvRows,
  submissionsCsvRows,
  verdictLabel,
  type SubmissionRow,
} from '@/lib/quizAdminLogic';
import {
  QUIZ_ERROR_TEXT,
  QuizError,
  type QuizAdminSnapshot,
  type QuizControlAction,
  type QuizState,
  type QuizVerdict,
  type SpeedRule,
  type SpeedTier,
} from '@/lib/quizTypes';
import { NewVersionBanner } from './NewVersionBanner';

const SNAPSHOT_MS = 1500;

const STATUS_KO: Record<QuizState['status'], string> = {
  lobby: '대기',
  open: '진행 중',
  closed: '마감',
  revealed: '공개',
  final: '종료',
};

/** 운영자 화면 — 키 확인(주소 ?key= 또는 저장된 키) 후 콘솔 */
export function QuizAdmin() {
  const [key, setKey] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);
  const [input, setInput] = useState('');

  useEffect(() => {
    const candidate = keyFromUrl() ?? readStoredKey();
    getQuizDb()
      .adminSnapshot(candidate, 0)
      .then(() => loadQuizKeys(candidate))
      .then(() => {
        writeStoredKey(candidate);
        setKey(candidate);
      })
      .catch(() => undefined)
      .finally(() => setChecked(true));
  }, []);

  async function tryKey() {
    const k = input.trim();
    try {
      await getQuizDb().adminSnapshot(k, 0);
      await loadQuizKeys(k);
      writeStoredKey(k);
      setKey(k);
    } catch (err) {
      const code =
        err instanceof QuizError ? err.code : err instanceof Error && err.message === 'QUIZ_FORBIDDEN' ? 'QUIZ_FORBIDDEN' : 'QUIZ_NETWORK';
      toast.error(QUIZ_ERROR_TEXT[code]);
    }
  }

  if (key !== null) return <Console opKey={key} />;
  if (!checked) return <main className="min-h-screen bg-[#F4F3EE]" />;

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#F4F3EE] px-4">
      <div className="w-full max-w-[400px] rounded-2xl bg-white p-6 shadow-sm">
        <h1 className="text-[20px] font-extrabold">스피드 퀴즈 운영</h1>
        <p className="mt-2 text-[13px] leading-5 text-[#6B6B6B]">
          운영자 키를 입력하세요. 주소에 <code>?key=…</code>를 붙여 열면 입력 없이 들어갑니다.
        </p>
        <input
          autoFocus
          type="password"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void tryKey();
          }}
          aria-label="운영자 키"
          className="mt-4 h-11 w-full rounded-lg border border-[#DDD] px-3 text-[14px] outline-none focus:border-[#1E1E1E]"
        />
        <button type="button" onClick={() => void tryKey()} className="mt-3 h-11 w-full rounded-lg bg-[#1E1E1E] text-[15px] font-bold text-white">
          들어가기
        </button>
      </div>
    </main>
  );
}

// ─── 콘솔 ──────────────────────────────────────────────────

function Console({ opKey }: { opKey: string }) {
  const db = useMemo(() => getQuizDb(), []);
  const state = useQuizState();
  const offset = useServerOffset();
  const now = useNow();
  const [snap, setSnap] = useState<QuizAdminSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const index = state?.current_index ?? 0;
  const q = getSeed()[index];

  const pull = useCallback(async () => {
    try {
      setSnap(await db.adminSnapshot(opKey, index));
    } catch {
      /* 다음 주기에 다시 */
    }
  }, [db, opKey, index]);

  useEffect(() => {
    let cancelled = false;
    const tick = () =>
      db
        .adminSnapshot(opKey, index)
        .then((s) => {
          if (!cancelled) setSnap(s);
        })
        .catch(() => undefined);
    void tick();
    const t = setInterval(() => void tick(), SNAPSHOT_MS);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [db, opKey, index]);

  const run = useCallback(
    async (act: QuizControlAction, ok?: string): Promise<boolean> => {
      setBusy(true);
      try {
        await db.control(opKey, act);
        if (ok) toast.success(ok);
        await pull();
        return true;
      } catch (err) {
        const code = err instanceof QuizError ? err.code : 'QUIZ_NETWORK';
        toast.error(QUIZ_ERROR_TEXT[code]);
        return false;
      } finally {
        setBusy(false);
      }
    },
    [db, opKey, pull],
  );

  const rows = useMemo(
    () => (snap && state ? buildRows(index, state, snap.submissions, snap.participants, snap.winners) : []),
    [snap, state, index],
  );
  const reviewLeft = rows.filter((r) => r.final === null).length;
  const correctCount = rows.filter((r) => r.final === 'correct').length;
  const wrongCount = rows.filter((r) => r.final === 'wrong').length;

  // 송출 화면용 정답/오답 집계 — 바뀔 때만 올린다
  const lastLive = useRef('');
  useEffect(() => {
    if (!snap || !state) return;
    const live = { correct: correctCount, wrong: wrongCount, review: reviewLeft };
    const sig = `${index}:${live.correct}:${live.wrong}:${live.review}`;
    if (sig === lastLive.current) return;
    lastLive.current = sig;
    db.pushLive(opKey, index, live).catch(() => {
      lastLive.current = '';
    });
  }, [db, opKey, index, snap, state, correctCount, wrongCount, reviewLeft]);

  // 회사 PC의 원격 격리 브라우저(Menlo 등)에서 마우스 휠이 안 먹는 경우가 있어,
  // 운영자 화면에서는 문서 스크롤을 가장 기본 형태(html이 스크롤, body는 그대로)로 되돌린다.
  useEffect(() => {
    const h = document.documentElement.style;
    const b = document.body.style;
    const prev = [h.overflow, h.overscrollBehavior, b.overflow, b.overscrollBehavior];
    h.overflow = 'auto';
    h.overscrollBehavior = 'auto';
    b.overflow = 'visible';
    b.overscrollBehavior = 'auto';
    return () => {
      [h.overflow, h.overscrollBehavior, b.overflow, b.overscrollBehavior] = prev;
    };
  }, []);

  const left = remainingMs(state, now, offset);
  const scoreStamp = state ? `${state.status}:${state.current_index}:${state.updated_at}` : '';
  const board = useScoreboard(scoreStamp, 5000);
  const ranked = useMemo(() => (board ? rankScores(board) : null), [board]);

  // 답변자·인원 (현재 스냅샷의 참가자)
  const teamInfo = useMemo(() => {
    const m = new Map<number, { members: number; answerer: boolean }>();
    (snap?.participants ?? []).forEach((p) => {
      const cur = m.get(p.table_no) ?? { members: 0, answerer: false };
      cur.members += 1;
      if (p.role === 'answerer') cur.answerer = true;
      m.set(p.table_no, cur);
    });
    return m;
  }, [snap]);
  const answererCount = [...teamInfo.values()].filter((t) => t.answerer).length;

  // ─── 조작 ───

  const open = useCallback(() => {
    if (!state) return;
    if (
      state.settings.opened?.[String(index)] &&
      !window.confirm("이미 진행한 문제입니다. 다시 열면 이미 공개된 문제를 새로 낼 수 있게 됩니다. 그래도 열까요? (보통은 '이 문제 초기화' 후 다시 엽니다)")
    ) {
      return;
    }
    void run({ action: 'open', index, duration_sec: durationFor(state, index) });
  }, [run, state, index]);

  const close = useCallback(() => void run({ action: 'close' }), [run]);

  const reveal = useCallback(async () => {
    if (!state || !q) return;
    if (state.status === 'open') {
      toast.message('먼저 마감해 주세요');
      return;
    }
    // 공개 직전에 최신 제출을 다시 읽어 모든 계산을 그것으로 한다
    let all: QuizAdminSnapshot;
    try {
      all = await db.adminSnapshot(opKey, index);
    } catch {
      toast.error(QUIZ_ERROR_TEXT.QUIZ_NETWORK);
      return;
    }
    const fresh = buildRows(index, state, all.submissions, all.participants, all.winners);
    const pending = fresh.filter((r) => r.final === null).length;
    if (pending > 0 && !window.confirm(`채점하지 않은 답 ${pending}건은 오답으로 처리하고 공개할까요?`)) return;
    const verdicts: Record<string, { auto: string | null; verdict: QuizVerdict }> = {};
    fresh.forEach((r) => {
      verdicts[r.sub.id] = { auto: r.auto, verdict: r.final ?? 'wrong' };
    });
    // 정답 조 — 서버 제출 시각 순(동시면 id 순). 점수판(SQL quiz_scoreboard)과 같은 순서
    const correctRows = fresh
      .filter((r) => (r.final ?? 'wrong') === 'correct' && r.team !== null)
      .sort((a, b) =>
        a.sub.created_at < b.sub.created_at ? -1 : a.sub.created_at > b.sub.created_at ? 1 : a.sub.id < b.sub.id ? -1 : a.sub.id > b.sub.id ? 1 : 0,
      );
    const correctTeams = [...new Set(correctRows.map((r) => r.team as number))];
    const base = pointsFor(state, index);
    const speed = q.practice ? null : speedRuleFor(state, index);
    const awards: Record<string, { rank: number; pts: number }> = {};
    correctTeams.forEach((t, k) => {
      awards[String(t)] = { rank: k + 1, pts: Math.round(awardFor(base, speed, k + 1).pts) };
    });
    await run(
      {
        action: 'reveal',
        verdicts,
        reveal: {
          index,
          answer: q.answerDisplay,
          explanation: q.explanation,
          winner: null,
          correct_teams: correctTeams,
          points: base,
          speed,
          awards,
        },
      },
      '정답을 공개했습니다',
    );
  }, [state, q, index, run, db, opKey]);

  const next = useCallback(() => {
    if (!state) return;
    if (state.status === 'open' && !window.confirm('진행 중인 문제가 있습니다. 넘어갈까요?')) return;
    if (state.status === 'closed' && !window.confirm('아직 정답을 공개하지 않았습니다. 공개하지 않고 넘어갈까요?')) return;
    const to = Math.min(QUIZ_QUESTIONS.length - 1, index + 1);
    if (to === index && state.status !== 'revealed') return;
    void run({ action: 'next', index: to });
  }, [state, index, run]);

  const goto = useCallback(
    (to: number) => {
      if (!state || to === index) return;
      if (state.status === 'open' && !window.confirm('진행 중인 문제가 있습니다. 이동할까요?')) return;
      void run({ action: 'next', index: to });
    },
    [state, index, run],
  );

  async function setVerdict(row: SubmissionRow, verdict: QuizVerdict | null) {
    const ok = await run({ action: 'set_verdict', submission_id: row.sub.id, verdict });
    if (ok && state?.status === 'revealed') {
      toast.message("점수판은 바로 바뀝니다. '맞힌 조' 표시까지 바꾸려면 '공개'를 한 번 더 눌러 주세요");
    }
  }

  function setPoints(i: number, value: number) {
    const v = Math.max(0, Math.min(1000, Math.round(value)));
    void run({ action: 'settings', points: { [String(i)]: v } }, `${questionLabel(i).split(' ')[0]} 배점 ${v}점`);
  }

  function setSpeed(i: number, rule: SpeedRule) {
    const label = questionLabel(i).split(' ')[0];
    void run(
      { action: 'settings', speed: { [String(i)]: rule } },
      rule.on ? `${label} 선착순 켬 — ${speedLabel(rule)}` : `${label} 선착순 끔`,
    );
  }

  // ─── 단축키: Space = 열기/마감 · R = 공개 · N = 다음 ───
  const keysRef = useRef({ open, close, reveal, next, state, busy });
  useEffect(() => {
    keysRef.current = { open, close, reveal, next, state, busy };
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      // 버튼에 포커스가 있으면 Space가 그 버튼도 누르므로 단축키에서 뺀다
      if (t && (['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(t.tagName) || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = keysRef.current;
      if (k.busy) return;
      if (e.code === 'Space') {
        e.preventDefault();
        if (k.state?.status === 'open') k.close();
        else if (k.state?.status === 'lobby') k.open();
      } else if (e.key === 'r' || e.key === 'R') {
        void k.reveal();
      } else if ((e.key === 'n' || e.key === 'N') && (k.state?.current_index ?? 0) < QUIZ_QUESTIONS.length - 1) {
        k.next();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ─── 내보내기 / 종료 ───

  async function fullSnapshot(): Promise<QuizAdminSnapshot | null> {
    try {
      return await db.adminSnapshot(opKey, null);
    } catch (err) {
      const code = err instanceof QuizError ? err.code : 'QUIZ_NETWORK';
      toast.error(QUIZ_ERROR_TEXT[code]);
      return null;
    }
  }

  async function exportSubmissions() {
    const all = await fullSnapshot();
    if (!all) return;
    downloadCsv(
      submissionsCsvRows(state, all.submissions, all.participants, all.winners),
      SUBMISSION_CSV_COLUMNS,
      `quiz_submissions_${fileStamp()}.csv`,
    );
  }

  async function exportScores() {
    try {
      const rowsNow = rankScores(await db.scoreboard(QUIZ_TEAMS));
      downloadCsv(scoreCsvRows(rowsNow), SCORE_CSV_COLUMNS, `quiz_scores_${fileStamp()}.csv`);
    } catch {
      toast.error(QUIZ_ERROR_TEXT.QUIZ_NETWORK);
    }
  }

  async function showFinal() {
    if (!window.confirm('최종 순위 화면으로 바꿀까요? (송출 화면·휴대폰에 점수판이 나옵니다)')) return;
    await run({ action: 'final', leaderboard: null }, '최종 순위를 공개했습니다');
  }

  const toRejudge = rejudgeTargets(rows);
  async function rejudge() {
    if (!toRejudge.length) return;
    if (!window.confirm(`자동 판정이 바뀐 답 ${toRejudge.length}건을 지금 기준으로 다시 채점할까요? (공개된 문항이면 다시 '공개'를 눌러 주세요)`)) return;
    for (const t of toRejudge) {
      const ok = await run({ action: 'set_verdict', submission_id: t.row.sub.id, verdict: t.to });
      if (!ok) return;
    }
    toast.success(`${toRejudge.length}건 다시 채점했습니다`);
  }

  if (!state || !q) {
    return <main className="flex min-h-screen items-center justify-center bg-[#F4F3EE] text-[#8A8A8A]">연결하는 중…</main>;
  }


  return (
    <main className="min-h-screen bg-[#F4F3EE] text-[#1E1E1E]">
      <NewVersionBanner />
      <ScrollPad />
      <header className="flex h-14 items-center gap-3 border-b border-[#E3E1D8] bg-white px-5">
        <span className="rounded-full bg-[#FFE300] px-3 py-0.5 text-[13px] font-black">SPEED QUIZ</span>
        <h1 className="text-[16px] font-extrabold">운영 · 단체전</h1>
        <span className="rounded-full bg-[#F1F0EA] px-2 py-0.5 text-[11px] text-[#6B6B6B]">{db.mode === 'supabase' ? '실시간' : '로컬 모드'}</span>
        <span className="ml-3 text-[14px]">
          입장 <strong className="tabular-nums">{snap?.participants.length ?? 0}</strong>명
        </span>
        <span className="text-[14px]">
          조 <strong className="tabular-nums">{teamInfo.size}</strong> · 답변자{' '}
          <strong className="tabular-nums">
            {answererCount}/{QUIZ_TEAMS}
          </strong>
        </span>
        <span className="ml-auto text-[12px] text-[#8A8A8A]">
          단축키 <kbd className="rounded border px-1">Space</kbd> 열기/마감 · <kbd className="rounded border px-1">R</kbd> 공개 ·{' '}
          <kbd className="rounded border px-1">N</kbd> 다음
        </span>
        <a href="/quiz/screen" target="_blank" rel="noreferrer" className="rounded-lg border px-2.5 py-1 text-[12px]">
          스크린 열기 ↗
        </a>
      </header>

      <div className="grid gap-4 p-4 xl:grid-cols-[300px_minmax(0,1fr)_minmax(0,640px)]">
        {/* 문항 목록 + 배점 */}
        <aside className="rounded-2xl bg-white p-3 xl:max-h-[calc(100vh-88px)] xl:overflow-y-auto" aria-label="문항 목록">
          <ol className="space-y-1">
            {QUIZ_QUESTIONS.map((item, i) => {
              const done = Boolean(state.settings.opened?.[String(i)]);
              return (
                <li key={item.no}>
                  <button
                    type="button"
                    onClick={() => goto(i)}
                    className={clsx(
                      'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px]',
                      i === index ? 'bg-[#FFE300] font-bold' : 'hover:bg-[#F7F6F1]',
                    )}
                  >
                    <span className="w-9 shrink-0 font-bold tabular-nums">{item.practice ? '연습' : `Q${item.no}`}</span>
                    <span className="truncate">{item.keyword}</span>
                    {item.images?.length ? <span title="이미지 문항">🖼</span> : null}
                    {speedRuleFor(state, i) ? <span title="선착순 가산">⚡</span> : null}
                    <span className="ml-auto shrink-0 text-[12px] font-bold tabular-nums text-[#8A6A00]">
                      {item.practice ? '' : `${pointsFor(state, i)}점`}
                    </span>
                    <span className="w-4 shrink-0 text-center text-[12px]">{done ? '✓' : ''}</span>
                  </button>
                </li>
              );
            })}
          </ol>
        </aside>

        {/* 현재 문제 + 조작 */}
        <section className="flex min-w-0 flex-col gap-4">
          <div className="rounded-2xl bg-white p-5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-lg bg-[#1E1E1E] px-2.5 py-1 text-[15px] font-black text-white">{questionLabel(index)}</span>
              <span className="rounded-lg bg-[#F1F0EA] px-2 py-1 text-[13px] font-semibold">{q.category}</span>
              {q.author ? <span className="text-[12px] text-[#8A8A8A]">출제 {q.author}</span> : null}
              <span
                className={clsx(
                  'ml-auto rounded-full px-3 py-1 text-[13px] font-bold',
                  state.status === 'open' ? 'bg-[#FF5A3C] text-white' : 'bg-[#F1F0EA]',
                )}
                data-testid="quiz-status"
              >
                {STATUS_KO[state.status]}
                {state.status === 'open' && left !== null ? ` · ${left === 0 ? '0' : fmtClock(left)}` : ''}
              </span>
            </div>
            <p className="mt-3 whitespace-pre-line text-[15px] leading-6">{q.prompt}</p>
            {q.choices ? (
              <ol className="mt-2 list-inside list-decimal text-[14px] text-[#3A3A3A]">
                {q.choices.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ol>
            ) : null}
            {q.images?.length ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {q.images.map((src) => (
                  <a key={src} href={src} target="_blank" rel="noreferrer" title="새 탭에서 크게 보기">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={src} alt="문제 이미지" onError={(e) => (e.currentTarget.style.display = 'none')} className="max-h-[200px] rounded-lg border object-contain" />
                  </a>
                ))}
              </div>
            ) : null}
            {!q.practice && speedRuleFor(state, index) ? (
              <p className="mt-2 inline-block rounded-lg bg-[#1E1E1E] px-2.5 py-1 text-[12px] font-bold text-[#FFE300]">
                ⚡ 선착순 — {speedLabel(speedRuleFor(state, index))} (배점 {pointsFor(state, index)}점 기준)
              </p>
            ) : null}
            <p className="mt-2 text-[12px] text-[#8A8A8A]">
              입력칸: {q.fields.map((f) => `${f.label ? `${f.label} ` : ''}[ ]${f.unit ? ` ${f.unit}` : ''}`).join(' · ')}
            </p>
            <div className="mt-3 grid gap-2 rounded-xl bg-[#FFFBEA] p-3 text-[13px] leading-5 md:grid-cols-[auto_1fr]">
              <span className="font-bold">정답</span>
              <span className="whitespace-pre-line font-semibold">{q.answerDisplay}</span>
              <span className="font-bold">판정</span>
              <span>
                {describeJudge(q.judge)}
                {q.judge.type === 'manual' && q.judge.rubric ? ` — ${q.judge.rubric}` : ''}
              </span>
              <span className="font-bold">해설</span>
              <span>{q.explanation}</span>
            </div>
            <details className="mt-2 text-[12px] text-[#5B5B5B]">
              <summary className="cursor-pointer">진행자 메모</summary>
              <p className="mt-1 whitespace-pre-line leading-5">{q.notes}</p>
            </details>
          </div>

          <div className="rounded-2xl bg-white p-4">
            <div className="flex flex-wrap gap-2">
              <Btn tone="primary" onClick={open} disabled={busy || state.status !== 'lobby'} testId="btn-open">
                열기 ({durationFor(state, index)}초)
              </Btn>
              <Btn onClick={() => void run({ action: 'extend', seconds: 15 }, '+15초')} disabled={busy || state.status !== 'open'} testId="btn-extend">
                +15초
              </Btn>
              <Btn tone="danger" onClick={close} disabled={busy || state.status !== 'open'} testId="btn-close">
                마감
              </Btn>
              <Btn tone="dark" onClick={() => void reveal()} disabled={busy || (state.status !== 'closed' && state.status !== 'revealed')} testId="btn-reveal">
                공개
              </Btn>
              <Btn onClick={next} disabled={busy || index >= QUIZ_QUESTIONS.length - 1} testId="btn-next">
                다음 →
              </Btn>
            </div>
            <p className="mt-2 text-[12px] text-[#8A8A8A]">순서: 열기 → 마감(시간이 다 되면 제출이 자동으로 막힘) → 채점 확인 → 공개 → 다음.</p>
          </div>

          {/* 배점표 — 키보드 없이 버튼으로, 문항 이동 없이 미리 정해 둘 수 있다 */}
          <div className="rounded-2xl bg-white p-4" data-testid="points-panel">
            <div className="flex items-center gap-2">
              <p className="text-[13px] font-extrabold">배점표</p>
              <span className="text-[12px] text-[#8A8A8A]">참가자가 많이 접속한 동안에는 되도록 바꾸지 마세요(바꿀 때마다 모든 화면이 새로 읽습니다)</span>
            </div>
            <ol className="mt-2 grid gap-1.5 2xl:grid-cols-2">
              {QUIZ_QUESTIONS.map((item, i) =>
                item.practice ? null : (
                  <li
                    key={item.no}
                    className={clsx('flex flex-wrap items-center gap-2 rounded-lg px-2 py-1', i === index ? 'bg-[#FFF6B3]' : 'bg-[#F7F6F1]')}
                    data-testid={`pts-row-${i}`}
                  >
                    <span className="w-9 text-[13px] font-bold">Q{item.no}</span>
                    <span className="min-w-0 flex-1 truncate text-[12px] text-[#5B5B5B]">{item.keyword}</span>
                    <button
                      type="button"
                      disabled={busy || pointsFor(state, i) <= 0}
                      onClick={() => setPoints(i, pointsFor(state, i) - 5)}
                      className="h-8 w-9 rounded-md border border-[#DDD] bg-white text-[13px] font-bold disabled:opacity-30"
                      aria-label={`Q${item.no} 배점 5점 내리기`}
                    >
                      −5
                    </button>
                    <span className="w-12 text-center text-[16px] font-black tabular-nums" data-testid={`pts-value-${i}`}>
                      {pointsFor(state, i)}
                    </span>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setPoints(i, pointsFor(state, i) + 5)}
                      className="h-8 w-9 rounded-md border border-[#DDD] bg-white text-[13px] font-bold disabled:opacity-30"
                      aria-label={`Q${item.no} 배점 5점 올리기`}
                    >
                      +5
                    </button>
                    <SpeedToggle
                      rule={state.settings.speed?.[String(i)] ?? null}
                      disabled={busy}
                      label={`Q${item.no}`}
                      onChange={(r) => setSpeed(i, r)}
                    />
                    {speedRuleFor(state, i) ? (
                      <SpeedEditor
                        rule={speedRuleFor(state, i)!}
                        base={pointsFor(state, i)}
                        disabled={busy}
                        label={`Q${item.no}`}
                        onChange={(r) => setSpeed(i, r)}
                      />
                    ) : null}
                  </li>
                ),
              )}
            </ol>
            <p className="mt-2 text-[12px] text-[#8A8A8A]">
              ⚡ 선착순: 정답을 맞힌 조 가운데 먼저 낸 순서(서버 시각)로 배점에 배수(×) 또는 추가점수(+)를 줍니다. 처음 켜면 1등 ×3 · 2~5등 ×2.
            </p>
          </div>

          <Settings state={state} index={index} run={run} />

          <div className="rounded-2xl bg-white p-4">
            <h2 className="text-[14px] font-extrabold">내보내기 · 종료</h2>
            <div className="mt-2 flex flex-wrap gap-2">
              <button type="button" onClick={() => void exportSubmissions()} className="rounded-lg border px-3 py-2 text-[13px]">
                전체 제출 CSV
              </button>
              <button type="button" onClick={() => void exportScores()} className="rounded-lg border px-3 py-2 text-[13px]">
                점수판 CSV
              </button>
              <button type="button" onClick={() => void showFinal()} className="rounded-lg bg-[#1E1E1E] px-3 py-2 text-[13px] font-bold text-white" data-testid="btn-final">
                최종 순위 공개
              </button>
            </div>
            <Resets index={index} run={run} />
          </div>
        </section>

        {/* 제출 표 + 점수판 */}
        <section className="flex min-w-0 flex-col gap-4">
          <div className="rounded-2xl bg-white p-4">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-[14px] font-extrabold">
                조별 제출 ({rows.length}/{answererCount || '—'})
              </h2>
              <span className="rounded-full bg-[#E3F6E8] px-2 py-0.5 text-[12px] font-bold text-[#1F8A3B]" data-testid="count-correct">
                정답 {correctCount}
              </span>
              <span className="rounded-full bg-[#FCE8E4] px-2 py-0.5 text-[12px] font-bold text-[#C23A1E]" data-testid="count-wrong">
                오답 {wrongCount}
              </span>
              {reviewLeft ? <span className="rounded-full bg-[#FFF3C4] px-2 py-0.5 text-[12px] font-bold text-[#8A6A00]">검토 {reviewLeft}</span> : null}
            </div>
            {toRejudge.length ? (
              <div className="mt-2 flex items-center gap-2 rounded-lg bg-[#FFF3C4] px-3 py-2 text-[12px]">
                <span>저장된 판정 중 {toRejudge.length}건이 지금 자동 판정과 다릅니다.</span>
                <button type="button" onClick={() => void rejudge()} className="ml-auto rounded-md bg-[#1E1E1E] px-2 py-1 font-bold text-white">
                  다시 채점
                </button>
              </div>
            ) : null}
            <SubmissionTable
              rows={rows}
              speed={q.practice ? null : speedRuleFor(state, index)}
              base={pointsFor(state, index)}
              onVerdict={(r, v) => void setVerdict(r, v)}
            />
          </div>

          <div className="rounded-2xl bg-white p-4" data-testid="team-board">
            <div className="flex items-center gap-2">
              <h2 className="text-[14px] font-extrabold">점수판</h2>
              <span className="text-[12px] text-[#8A8A8A]">공개한 문항 기준 · 5초마다 갱신</span>
            </div>
            {!ranked ? (
              <p className="mt-2 text-[13px] text-[#8A8A8A]">불러오는 중…</p>
            ) : (
              <table className="mt-2 w-full text-[13px]">
                <thead className="text-left text-[12px] text-[#8A8A8A]">
                  <tr className="border-b">
                    <th className="py-1">순위</th>
                    <th className="py-1">조</th>
                    <th className="py-1 text-right">점수</th>
                    <th className="py-1 text-right">맞힘</th>
                    <th className="py-1 text-right">인원</th>
                    <th className="py-1 text-right">답변자</th>
                  </tr>
                </thead>
                <tbody>
                  {ranked.map((t) => (
                    <tr key={t.team_no} className="border-b border-[#F1F0EA] tabular-nums">
                      <td className="py-1 font-bold">{t.rank}</td>
                      <td className="py-1">{t.team_no}조</td>
                      <td className="py-1 text-right font-bold">{t.score}</td>
                      <td className="py-1 text-right">{t.correct}</td>
                      <td className="py-1 text-right">{t.members}</td>
                      <td className="py-1 text-right">{teamInfo.get(t.team_no)?.answerer ? '✓' : <span className="text-[#C23A1E]">없음</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}

// ─── 하위 컴포넌트 ─────────────────────────────────────────

function Btn({
  children,
  onClick,
  disabled,
  tone = 'plain',
  testId,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  tone?: 'plain' | 'primary' | 'dark' | 'danger';
  testId?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-testid={testId}
      className={clsx(
        'h-12 rounded-xl px-4 text-[15px] font-bold transition disabled:opacity-30',
        tone === 'primary' && 'bg-[#FFE300] text-[#1E1E1E] shadow-[0_2px_0_#1E1E1E]',
        tone === 'dark' && 'bg-[#1E1E1E] text-white',
        tone === 'danger' && 'bg-[#FF5A3C] text-white',
        tone === 'plain' && 'border border-[#DDD] bg-white',
      )}
    >
      {children}
    </button>
  );
}

function Settings({
  state,
  index,
  run,
}: {
  state: QuizState;
  index: number;
  run: (act: QuizControlAction, ok?: string) => Promise<boolean>;
}) {
  const dur = durationFor(state, index);
  return (
    <div className="grid gap-3 rounded-2xl bg-white p-4 md:grid-cols-2">
      <div>
        <p className="text-[13px] font-extrabold">문제 문장 표시 (스크린·휴대폰)</p>
        <div className="mt-1.5 flex gap-1.5" role="group" aria-label="문제 문장 표시">
          {(['full', 'keyword'] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={state.display_mode === m}
              onClick={() => void run({ action: 'settings', display_mode: m })}
              className={clsx('h-9 rounded-lg px-3 text-[13px] font-semibold', state.display_mode === m ? 'bg-[#1E1E1E] text-white' : 'border border-[#DDD]')}
            >
              {m === 'full' ? '전체' : `키워드만 (${keywordFor(state, index)})`}
            </button>
          ))}
        </div>
        <label className="mt-3 flex items-center gap-2 text-[13px]">
          <input type="checkbox" checked={state.allow_edit} onChange={(e) => void run({ action: 'settings', allow_edit: e.target.checked })} className="h-4 w-4" />
          수정 허용 (마감 전까지 답변자가 답을 고칠 수 있음 · 기본 꺼짐)
        </label>
      </div>
      <div>
        <p className="text-[13px] font-extrabold">이 문제 제한시간</p>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {[30, 45, 60, 90, 120, 180].map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => void run({ action: 'settings', durations: { [String(index)]: s } }, `제한시간 ${s}초`)}
              className={clsx('h-9 rounded-lg px-3 text-[13px] font-semibold tabular-nums', dur === s ? 'bg-[#1E1E1E] text-white' : 'border border-[#DDD]')}
            >
              {s}초
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function SubmissionTable({
  rows,
  speed,
  base,
  onVerdict,
}: {
  rows: SubmissionRow[];
  speed: SpeedRule | null;
  base: number;
  onVerdict: (r: SubmissionRow, v: QuizVerdict | null) => void;
}) {
  if (rows.length === 0) return <p className="mt-3 text-[13px] text-[#8A8A8A]">아직 제출한 조가 없습니다.</p>;
  // 정답 순서(서버 시각 → id) — 점수판과 같은 기준
  const order = new Map<string, number>();
  rows
    .filter((r) => r.final === 'correct' && r.team !== null)
    .sort((a, b) =>
      a.sub.created_at < b.sub.created_at ? -1 : a.sub.created_at > b.sub.created_at ? 1 : a.sub.id < b.sub.id ? -1 : a.sub.id > b.sub.id ? 1 : 0,
    )
    .forEach((r, k) => order.set(r.sub.id, k + 1));
  return (
    <div className="mt-2 max-h-[560px] overflow-auto">
      <table className="w-full border-collapse text-[13px]" data-testid="submissions">
        <thead className="sticky top-0 bg-white text-left text-[12px] text-[#8A8A8A]">
          <tr className="border-b">
            <th className="py-1.5 pr-1">#</th>
            <th className="py-1.5 pr-1">조</th>
            <th className="py-1.5 pr-1">답</th>
            <th className="py-1.5 pr-1">자동</th>
            <th className="py-1.5 pr-1">최종</th>
            <th className="py-1.5 pr-1 text-right">경과</th>
            <th className="py-1.5 pr-1 text-right">{speed ? '⚡ 순서·점수' : '점수'}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.sub.id} data-testid="sub-row" data-team={r.team ?? ''} className="border-b border-[#F1F0EA]">
              <td className="py-1.5 pr-1 tabular-nums">{i + 1}</td>
              <td className="py-1.5 pr-1 font-bold tabular-nums">{r.team ?? '?'}조</td>
              <td className="max-w-[260px] break-words py-1.5 pr-1">{r.sub.answer.split(FIELD_SEP).join(' · ')}</td>
              <td className="py-1.5 pr-1">
                <VerdictChip v={r.auto} />
              </td>
              <td className="py-1.5 pr-1">
                <div className="flex gap-1">
                  <button
                    type="button"
                    aria-label="정답으로"
                    aria-pressed={r.final === 'correct'}
                    onClick={() => onVerdict(r, r.sub.verdict === 'correct' ? null : 'correct')}
                    className={clsx(
                      'h-7 w-7 rounded-md border text-[13px] font-bold',
                      r.final === 'correct' ? 'border-[#1F8A3B] bg-[#1F8A3B] text-white' : 'border-[#DDD] bg-white',
                    )}
                  >
                    ✓
                  </button>
                  <button
                    type="button"
                    aria-label="오답으로"
                    aria-pressed={r.final === 'wrong'}
                    onClick={() => onVerdict(r, r.sub.verdict === 'wrong' ? null : 'wrong')}
                    className={clsx(
                      'h-7 w-7 rounded-md border text-[13px] font-bold',
                      r.final === 'wrong' ? 'border-[#C23A1E] bg-[#C23A1E] text-white' : 'border-[#DDD] bg-white',
                    )}
                  >
                    ✗
                  </button>
                </div>
              </td>
              <td className="py-1.5 pr-1 text-right tabular-nums">{r.elapsedMs === null ? '—' : `${(r.elapsedMs / 1000).toFixed(1)}s`}</td>
              <td className="py-1.5 pr-1 text-right tabular-nums">
                {order.has(r.sub.id) ? (
                  <span className={clsx('font-bold', speed && awardFor(base, speed, order.get(r.sub.id)!).tier ? 'text-[#B8860B]' : '')}>
                    {speed ? `${order.get(r.sub.id)}등 · ` : ''}+{Math.round(awardFor(base, speed, order.get(r.sub.id)!).pts)}
                  </span>
                ) : (
                  <span className="text-[#BBB]">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── 선착순 설정 (키보드 없이 버튼만) ───

function SpeedToggle({
  rule,
  disabled,
  label,
  onChange,
}: {
  rule: SpeedRule | null;
  disabled?: boolean;
  label: string;
  onChange: (r: SpeedRule) => void;
}) {
  const on = Boolean(rule?.on && rule.tiers?.length);
  return (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={on}
      aria-label={`${label} 선착순 ${on ? '끄기' : '켜기'}`}
      data-testid={`speed-toggle-${label}`}
      onClick={() => onChange({ on: !on, tiers: rule?.tiers?.length ? rule.tiers : DEFAULT_SPEED_TIERS })}
      className={clsx(
        'h-8 rounded-md px-2 text-[12px] font-bold disabled:opacity-30',
        on ? 'bg-[#1E1E1E] text-[#FFE300]' : 'border border-[#DDD] bg-white text-[#8A8A8A]',
      )}
    >
      ⚡ 선착순 {on ? '켜짐' : '꺼짐'}
    </button>
  );
}

function SpeedEditor({
  rule,
  base,
  disabled,
  label,
  onChange,
}: {
  rule: SpeedRule;
  base: number;
  disabled?: boolean;
  label: string;
  onChange: (r: SpeedRule) => void;
}) {
  const tiers = rule.tiers;
  const set = (k: number, patch: Partial<SpeedTier>) => {
    const next = tiers.map((t, i) => (i === k ? { ...t, ...patch } : t));
    // 구간은 앞 구간보다 뒤로만 — 겹치면 뒤 구간을 민다
    for (let i = 1; i < next.length; i += 1) if (next[i].upto <= next[i - 1].upto) next[i] = { ...next[i], upto: next[i - 1].upto + 1 };
    onChange({ on: true, tiers: next });
  };
  const small = 'h-7 min-w-7 rounded border border-[#DDD] bg-white px-1 text-[12px] font-bold disabled:opacity-30';
  return (
    <div className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-md bg-white/70 px-2 py-1 text-[12px]" data-testid={`speed-editor-${label}`}>
      {tiers.map((t, k) => {
        const from = k === 0 ? 1 : tiers[k - 1].upto + 1;
        return (
          <span key={k} className="flex items-center gap-1">
            <span className="font-bold tabular-nums">{t.upto <= from ? `${t.upto}등` : `${from}~${t.upto}등`}</span>
            <button type="button" className={small} disabled={disabled || t.upto <= from} onClick={() => set(k, { upto: t.upto - 1 })} aria-label={`${label} ${k + 1}구간 끝 순위 내리기`}>
              ◀
            </button>
            <button type="button" className={small} disabled={disabled || t.upto >= 30} onClick={() => set(k, { upto: t.upto + 1 })} aria-label={`${label} ${k + 1}구간 끝 순위 올리기`}>
              ▶
            </button>
            <button
              type="button"
              className={clsx(small, 'w-8')}
              disabled={disabled}
              onClick={() => set(k, t.mode === 'x' ? { mode: '+', v: 5 } : { mode: 'x', v: 2 })}
              aria-label={`${label} ${k + 1}구간 방식 바꾸기`}
              title="배수(×) ↔ 추가점수(+)"
            >
              {t.mode === 'x' ? '×' : '+'}
            </button>
            <button
              type="button"
              className={small}
              disabled={disabled || t.v <= (t.mode === 'x' ? 1 : 0)}
              onClick={() => set(k, { v: t.mode === 'x' ? t.v - 1 : t.v - 5 })}
              aria-label={`${label} ${k + 1}구간 값 내리기`}
            >
              −
            </button>
            <span className="w-9 text-center font-black tabular-nums">{t.mode === 'x' ? `×${t.v}` : `+${t.v}`}</span>
            <button
              type="button"
              className={small}
              disabled={disabled || t.v >= (t.mode === 'x' ? 10 : 100)}
              onClick={() => set(k, { v: t.mode === 'x' ? t.v + 1 : t.v + 5 })}
              aria-label={`${label} ${k + 1}구간 값 올리기`}
            >
              +
            </button>
            <span className="text-[#8A8A8A] tabular-nums">= {Math.round(awardFor(base, { on: true, tiers: [t] }, 1).pts)}점</span>
          </span>
        );
      })}
      <span className="ml-auto flex gap-1">
        {tiers.length < 3 ? (
          <button
            type="button"
            className={clsx(small, 'px-2')}
            disabled={disabled}
            onClick={() => onChange({ on: true, tiers: [...tiers, { upto: tiers[tiers.length - 1].upto + 5, mode: 'x', v: 2 }] })}
          >
            구간 추가
          </button>
        ) : null}
        {tiers.length > 1 ? (
          <button type="button" className={clsx(small, 'px-2')} disabled={disabled} onClick={() => onChange({ on: true, tiers: tiers.slice(0, -1) })}>
            구간 빼기
          </button>
        ) : null}
      </span>
    </div>
  );
}

/** 휠이 안 될 때를 위한 스크롤 버튼 (오른쪽 아래 고정) */
function ScrollPad() {
  const by = (dy: number) => window.scrollBy({ top: dy * window.innerHeight, behavior: 'smooth' });
  const cls = 'flex h-10 w-10 items-center justify-center rounded-full bg-[#1E1E1E]/80 text-[16px] font-bold text-white shadow-lg hover:bg-[#1E1E1E]';
  return (
    <nav className="fixed bottom-4 right-4 z-40 flex flex-col gap-1.5" aria-label="화면 스크롤">
      <button type="button" className={cls} onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} aria-label="맨 위로" title="맨 위로">
        ⇈
      </button>
      <button type="button" className={cls} onClick={() => by(-0.7)} aria-label="위로" title="위로">
        ▲
      </button>
      <button type="button" className={cls} onClick={() => by(0.7)} aria-label="아래로" title="아래로">
        ▼
      </button>
      <button
        type="button"
        className={cls}
        onClick={() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' })}
        aria-label="맨 아래로"
        title="맨 아래로"
      >
        ⇊
      </button>
    </nav>
  );
}

function VerdictChip({ v }: { v: string }) {
  return (
    <span
      className={clsx(
        'rounded px-1.5 py-0.5 text-[11px] font-bold',
        v === 'correct' && 'bg-[#E3F6E8] text-[#1F8A3B]',
        v === 'wrong' && 'bg-[#FCE8E4] text-[#C23A1E]',
        v === 'review' && 'bg-[#FFF3C4] text-[#8A6A00]',
      )}
    >
      {verdictLabel(v as 'correct')}
    </span>
  );
}

function Resets({ index, run }: { index: number; run: (act: QuizControlAction, ok?: string) => Promise<boolean> }) {
  const [arm, setArm] = useState<'q' | 'all' | null>(null);
  const [withPeople, setWithPeople] = useState(false);
  return (
    <div className="mt-4 border-t border-[#F1F0EA] pt-3">
      <p className="text-[12px] font-bold text-[#C23A1E]">위험 구역</p>
      {arm === null ? (
        <div className="mt-1.5 flex flex-wrap gap-2">
          <button type="button" onClick={() => setArm('q')} className="rounded-lg border border-[#C23A1E] px-3 py-1.5 text-[12px] text-[#C23A1E]">
            이 문제 초기화
          </button>
          <button type="button" onClick={() => setArm('all')} className="rounded-lg border border-[#C23A1E] px-3 py-1.5 text-[12px] text-[#C23A1E]">
            전체 초기화
          </button>
        </div>
      ) : (
        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[12px]">
          <span>{arm === 'q' ? `${questionLabel(index)}의 제출을 지웁니다.` : '모든 제출을 지우고 연습 문제 대기로 돌아갑니다(배점 설정은 남습니다).'}</span>
          {arm === 'all' ? (
            <label className="flex items-center gap-1">
              <input type="checkbox" checked={withPeople} onChange={(e) => setWithPeople(e.target.checked)} /> 참가자(조 입장)도 지우기
            </label>
          ) : null}
          <button
            type="button"
            data-testid="reset-confirm"
            onClick={() => {
              void run(arm === 'q' ? { action: 'reset_question', index } : { action: 'reset_all', participants: withPeople }, '초기화했습니다');
              setArm(null);
            }}
            className="rounded-lg bg-[#C23A1E] px-3 py-1.5 font-bold text-white"
          >
            정말 초기화
          </button>
          <button type="button" onClick={() => setArm(null)} className="rounded-lg border px-3 py-1.5">
            취소
          </button>
        </div>
      )}
    </div>
  );
}
