'use client';

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
  remainingMs,
  useNow,
  useQuizState,
  useServerOffset,
} from '@/lib/quizClient';
import { describeJudge } from '@/lib/quizJudge';
import { QUIZ_SEED } from '@/lib/quizSeed';
import { questionLabel, stars } from '@/lib/quizQuestions';
import {
  SUBMISSION_CSV_COLUMNS,
  WINNER_CSV_COLUMNS,
  buildRows,
  firstEligible,
  leaderboard,
  submissionsCsvRows,
  verdictLabel,
  winnersCsvRows,
  type SubmissionRow,
} from '@/lib/quizAdminLogic';
import {
  QUIZ_ERROR_TEXT,
  QuizError,
  type QuizAdminSnapshot,
  type QuizControlAction,
  type QuizState,
  type QuizVerdict,
} from '@/lib/quizTypes';

const SNAPSHOT_MS = 1500;

const STATUS_KO: Record<QuizState['status'], string> = {
  lobby: '대기',
  open: '진행 중',
  closed: '마감',
  revealed: '공개',
  final: '종료',
};

/** 운영자 화면 — 키 확인 후 콘솔 (Quiz v1.0) */
export function QuizAdmin() {
  const [key, setKey] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);
  const [input, setInput] = useState('');

  // 저장된 키(또는 ?key=)로 먼저 조용히 시도한다
  useEffect(() => {
    const candidate = keyFromUrl() ?? readStoredKey();
    getQuizDb()
      .adminSnapshot(candidate, 0)
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
      writeStoredKey(k);
      setKey(k);
    } catch (err) {
      const code = err instanceof QuizError ? err.code : 'QUIZ_NETWORK';
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
          운영자 키를 입력하세요. 주소에 <code>?key=…</code>를 붙여도 됩니다. (Supabase 모드에서는
          quiz_config에 넣은 키와 같아야 합니다.)
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
        <button
          type="button"
          onClick={() => void tryKey()}
          className="mt-3 h-11 w-full rounded-lg bg-[#1E1E1E] text-[15px] font-bold text-white"
        >
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
  const q = QUIZ_SEED[index];

  // 현재 문제 스냅샷 — 1.5초마다 (제출 테이블은 방송하지 않으므로 운영자는 폴링)
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
  const candidate = firstEligible(rows);
  const confirmed = snap?.winners.find((w) => w.question_index === index) ?? null;
  const reviewLeft = rows.filter((r) => r.final === null).length;
  const left = remainingMs(state, now, offset);

  // ─── 조작 ───

  const open = useCallback(() => {
    if (!state) return;
    void run({ action: 'open', index, duration_sec: durationFor(state, index) });
  }, [run, state, index]);

  const close = useCallback(() => void run({ action: 'close' }), [run]);

  const confirmWinner = useCallback(
    (row: SubmissionRow | null) =>
      void run(
        { action: 'set_winner', index, submission_id: row?.sub.id ?? null },
        row ? `첫 정답자: ${row.participant?.name ?? ''}` : '정답자 없음으로 정했습니다',
      ),
    [run, index],
  );

  const reveal = useCallback(async () => {
    if (!state || !q || !snap) return;
    if (state.status === 'open') {
      toast.message('먼저 마감해 주세요');
      return;
    }
    if (!confirmed) {
      if (candidate) {
        toast.message('첫 정답자를 먼저 확정해 주세요');
        return;
      }
      if (!window.confirm('정답자가 없습니다. 정답자 없이 공개할까요?')) return;
    }
    if (reviewLeft > 0 && !window.confirm(`검토하지 않은 답 ${reviewLeft}건은 오답으로 처리하고 공개할까요?`)) return;

    const winnerRow = confirmed ? rows.find((r) => r.sub.id === confirmed.submission_id) : null;
    const verdicts: Record<string, { auto: string | null; verdict: QuizVerdict }> = {};
    rows.forEach((r) => {
      verdicts[r.sub.id] = { auto: r.auto, verdict: r.final ?? 'wrong' };
    });
    await run(
      {
        action: 'reveal',
        verdicts,
        reveal: {
          index,
          answer: q.answerDisplay,
          explanation: q.explanation,
          correct_times: rows
            .filter((r) => r.final === 'correct')
            .map((r) => r.sub.created_at)
            .sort((a, b) => new Date(a).getTime() - new Date(b).getTime() || a.localeCompare(b)),
          winner:
            winnerRow && winnerRow.participant
              ? {
                  participant_id: winnerRow.participant.id,
                  name: winnerRow.participant.name,
                  table_no: winnerRow.participant.table_no,
                }
              : null,
        },
      },
      '정답을 공개했습니다',
    );
  }, [state, q, snap, confirmed, candidate, reviewLeft, rows, index, run]);

  const next = useCallback(() => {
    if (!state) return;
    if (state.status === 'open' && !window.confirm('진행 중인 문제가 있습니다. 넘어갈까요?')) return;
    const to = Math.min(QUIZ_SEED.length - 1, index + 1);
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
    // 확정된 수상자를 ✗로 바꾸면 수상도 푼다
    if (verdict !== 'correct' && confirmed?.submission_id === row.sub.id) {
      await run({ action: 'set_winner', index, submission_id: null });
    }
    await run({ action: 'set_verdict', submission_id: row.sub.id, verdict });
  }

  // ─── 단축키: Space = 열기/마감 · R = 공개 · N = 다음 ───

  const keysRef = useRef({ open, close, reveal, next, state });
  useEffect(() => {
    keysRef.current = { open, close, reveal, next, state };
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName) || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = keysRef.current;
      if (e.code === 'Space') {
        e.preventDefault();
        if (k.state?.status === 'open') k.close();
        else if (k.state?.status === 'lobby') k.open();
      } else if (e.key === 'r' || e.key === 'R') {
        void k.reveal();
      } else if (e.key === 'n' || e.key === 'N') {
        k.next();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ─── 내보내기 / 최종 ───

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

  async function exportWinners() {
    const all = await fullSnapshot();
    if (!all) return;
    downloadCsv(
      winnersCsvRows(state, all.submissions, all.participants, all.winners),
      WINNER_CSV_COLUMNS,
      `quiz_winners_${fileStamp()}.csv`,
    );
  }

  async function showFinal(withBoard: boolean) {
    const all = await fullSnapshot();
    if (!all) return;
    const board = withBoard ? leaderboard(state, all.submissions, all.participants, 3) : null;
    if (!window.confirm(withBoard ? '최종 순위(상위 3명)를 공개할까요?' : '순위 없이 종료 화면으로 바꿀까요?')) return;
    await run({ action: 'final', leaderboard: board }, '종료 화면으로 바꿨습니다');
  }

  if (!state || !q) {
    return <main className="flex min-h-screen items-center justify-center bg-[#F4F3EE] text-[#8A8A8A]">연결하는 중…</main>;
  }

  // 연습 문제(0번)는 상품이 없으므로 수상자 목록에서 뺀다
  const winnersList = (snap?.winners ?? []).filter((w) => w.question_index > 0).map((w) => ({
    w,
    p: snap?.participants.find((p) => p.id === w.participant_id),
  }));

  return (
    <main className="min-h-screen bg-[#F4F3EE] text-[#1E1E1E]">
      <header className="flex h-14 items-center gap-3 border-b border-[#E3E1D8] bg-white px-5">
        <span className="rounded-full bg-[#FFE300] px-3 py-0.5 text-[13px] font-black">SPEED QUIZ</span>
        <h1 className="text-[16px] font-extrabold">운영</h1>
        <span className="rounded-full bg-[#F1F0EA] px-2 py-0.5 text-[11px] text-[#6B6B6B]">
          {db.mode === 'supabase' ? '실시간' : '로컬 모드'}
        </span>
        <span className="ml-3 text-[14px]">
          참가 <strong className="tabular-nums">{snap?.participants.length ?? 0}</strong>명
        </span>
        <span className="text-[14px]">
          수상 <strong className="tabular-nums">{snap?.winners.filter((w) => w.question_index > 0).length ?? 0}</strong>명
        </span>
        <span className="ml-auto text-[12px] text-[#8A8A8A]">
          단축키 <kbd className="rounded border px-1">Space</kbd> 열기/마감 · <kbd className="rounded border px-1">R</kbd> 공개 ·{' '}
          <kbd className="rounded border px-1">N</kbd> 다음
        </span>
        <a href="/quiz/screen" target="_blank" rel="noreferrer" className="rounded-lg border px-2.5 py-1 text-[12px]">
          스크린 열기 ↗
        </a>
      </header>

      <div className="grid gap-4 p-4 xl:grid-cols-[280px_minmax(0,1fr)_minmax(0,760px)]">
        {/* 문항 목록 */}
        <aside className="rounded-2xl bg-white p-3 xl:max-h-[calc(100vh-88px)] xl:overflow-y-auto" aria-label="문항 목록">
          <ol className="space-y-1">
            {QUIZ_SEED.map((item, i) => {
              const won = snap?.winners.some((w) => w.question_index === i);
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
                    <span className="truncate">{item.category}</span>
                    <span className="ml-auto shrink-0 text-[11px] text-[#E0A800]">{'★'.repeat(item.difficulty)}</span>
                    <span className="w-4 shrink-0 text-center text-[12px]" aria-label={won ? '수상자 있음' : done ? '진행함' : ''}>
                      {won ? '🏅' : done ? '✓' : ''}
                    </span>
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
              <span className="rounded-lg bg-[#1E1E1E] px-2.5 py-1 text-[15px] font-black text-white">
                {questionLabel(index)}
              </span>
              <span className="rounded-lg bg-[#F1F0EA] px-2 py-1 text-[13px] font-semibold">{q.category}</span>
              <span className="text-[14px] text-[#E0A800]">{stars(q.difficulty)}</span>
              <span className="text-[12px] text-[#8A8A8A]">출제 {q.author}</span>
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
              <summary className="cursor-pointer">진행자 메모 (원문)</summary>
              <p className="mt-1 whitespace-pre-line leading-5">{q.notes}</p>
            </details>
          </div>

          <Controls
            state={state}
            index={index}
            busy={busy}
            candidate={candidate}
            confirmed={Boolean(confirmed)}
            onOpen={open}
            onClose={close}
            onExtend={() => void run({ action: 'extend', seconds: 15 }, '+15초')}
            onReveal={() => void reveal()}
            onNext={next}
            onConfirm={() => confirmWinner(candidate)}
            onNoWinner={() => confirmWinner(null)}
          />

          <Settings state={state} index={index} run={run} />

          <div className="rounded-2xl bg-white p-4">
            <h2 className="text-[14px] font-extrabold">내보내기 · 종료</h2>
            <div className="mt-2 flex flex-wrap gap-2">
              <button type="button" onClick={() => void exportSubmissions()} className="rounded-lg border px-3 py-2 text-[13px]">
                전체 제출 CSV
              </button>
              <button type="button" onClick={() => void exportWinners()} className="rounded-lg border px-3 py-2 text-[13px]">
                수상자 CSV
              </button>
              <button type="button" onClick={() => void showFinal(true)} className="rounded-lg border px-3 py-2 text-[13px]">
                최종 순위 공개 (상위 3)
              </button>
              <button type="button" onClick={() => void showFinal(false)} className="rounded-lg border px-3 py-2 text-[13px]">
                순위 없이 종료
              </button>
            </div>
            <Resets index={index} run={run} />
          </div>
        </section>

        {/* 제출 표 + 수상자 */}
        <section className="flex min-w-0 flex-col gap-4">
          <div className="rounded-2xl bg-white p-4">
            <div className="flex items-center gap-2">
              <h2 className="text-[14px] font-extrabold">제출 ({rows.length})</h2>
              <span className="text-[12px] text-[#8A8A8A]">서버 시각 순 · 검토 {reviewLeft}건</span>
              {confirmed ? (
                <span className="ml-auto rounded-full bg-[#1E1E1E] px-2.5 py-0.5 text-[12px] font-bold text-[#FFE300]">
                  🏅 확정: {snap?.participants.find((p) => p.id === confirmed.participant_id)?.name}
                </span>
              ) : candidate ? (
                <span className="ml-auto rounded-full bg-[#FFE300] px-2.5 py-0.5 text-[12px] font-bold">
                  후보: {candidate.participant?.name}
                </span>
              ) : null}
            </div>
            <SubmissionTable
              rows={rows}
              candidateId={candidate?.sub.id ?? null}
              winnerId={confirmed?.submission_id ?? null}
              onVerdict={(r, v) => void setVerdict(r, v)}
              onPick={(r) => confirmWinner(r)}
            />
          </div>

          <div className="rounded-2xl bg-white p-4">
            <h2 className="text-[14px] font-extrabold">수상자 (1인 1회)</h2>
            {winnersList.length === 0 ? (
              <p className="mt-2 text-[13px] text-[#8A8A8A]">아직 없습니다.</p>
            ) : (
              <ul className="mt-2 grid grid-cols-2 gap-1.5 text-[13px]">
                {winnersList.map(({ w, p }) => (
                  <li key={w.question_index} className="flex items-center gap-2 rounded-lg bg-[#F7F6F1] px-2 py-1">
                    <span className="w-9 font-bold">{questionLabel(w.question_index).split(' ')[0]}</span>
                    <span className="truncate">{p?.name ?? '?'}</span>
                    <span className="ml-auto shrink-0 text-[#6B6B6B]">{p?.table_no}번</span>
                  </li>
                ))}
              </ul>
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

function Controls({
  state,
  index,
  busy,
  candidate,
  confirmed,
  onOpen,
  onClose,
  onExtend,
  onReveal,
  onNext,
  onConfirm,
  onNoWinner,
}: {
  state: QuizState;
  index: number;
  busy: boolean;
  candidate: SubmissionRow | null;
  confirmed: boolean;
  onOpen: () => void;
  onClose: () => void;
  onExtend: () => void;
  onReveal: () => void;
  onNext: () => void;
  onConfirm: () => void;
  onNoWinner: () => void;
}) {
  const s = state.status;
  return (
    <div className="rounded-2xl bg-white p-4">
      <div className="flex flex-wrap gap-2">
        {/* 열기는 대기 상태에서만 — 마감·공개 뒤 다시 열면 opened_at이 바뀌어 경과 시간이 틀어진다.
            실수로 일찍 마감했다면 '이 문제 초기화' 후 다시 연다. */}
        <Btn tone="primary" onClick={onOpen} disabled={busy || s !== 'lobby'} testId="btn-open">
          열기 ({durationFor(state, index)}초)
        </Btn>
        <Btn onClick={onExtend} disabled={busy || s !== 'open'} testId="btn-extend">
          +15초
        </Btn>
        <Btn tone="danger" onClick={onClose} disabled={busy || s !== 'open'} testId="btn-close">
          마감
        </Btn>
        <Btn tone="dark" onClick={onConfirm} disabled={busy || s === 'open' || !candidate || confirmed} testId="btn-confirm">
          첫 정답자 확정{candidate && !confirmed ? ` · ${candidate.participant?.name ?? ''}` : ''}
        </Btn>
        <Btn onClick={onNoWinner} disabled={busy || s === 'open' || Boolean(candidate) || confirmed} testId="btn-nowinner">
          정답자 없음
        </Btn>
        <Btn tone="dark" onClick={onReveal} disabled={busy || (s !== 'closed' && s !== 'revealed')} testId="btn-reveal">
          공개
        </Btn>
        <Btn onClick={onNext} disabled={busy || index >= QUIZ_SEED.length - 1} testId="btn-next">
          다음 →
        </Btn>
      </div>
      <p className="mt-2 text-[12px] text-[#8A8A8A]">
        순서: 열기 → (마감 시각이 지나면 자동으로 제출이 막힘) 마감 → 첫 정답자 확정 → 공개 → 다음. 공개 전에는 틀린 답·사람이
        어디에도 보이지 않습니다.
      </p>
    </div>
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
  const [kw, setKw] = useState(keywordFor(state, index));
  const [dur, setDur] = useState(String(durationFor(state, index)));

  // 문제가 바뀌면 입력칸을 그 문제 값으로 되돌린다 (렌더 중 이전 값 비교 — effect 없이)
  const [lastIndex, setLastIndex] = useState(index);
  if (lastIndex !== index) {
    setLastIndex(index);
    setKw(keywordFor(state, index));
    setDur(String(durationFor(state, index)));
  }

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
              className={clsx(
                'h-9 rounded-lg px-3 text-[13px] font-semibold',
                state.display_mode === m ? 'bg-[#1E1E1E] text-white' : 'border border-[#DDD]',
              )}
            >
              {m === 'full' ? '전체' : '키워드만'}
            </button>
          ))}
        </div>
        <label className="mt-3 flex items-center gap-2 text-[13px]">
          <input
            type="checkbox"
            checked={state.allow_edit}
            onChange={(e) => void run({ action: 'settings', allow_edit: e.target.checked })}
            className="h-4 w-4"
          />
          수정 허용 (마감 전까지 답을 고칠 수 있음 · 기본 꺼짐)
        </label>
      </div>
      <div className="grid grid-cols-[1fr_110px] gap-2">
        <label className="text-[13px] font-extrabold">
          이 문제 키워드
          <input
            value={kw}
            onChange={(e) => setKw(e.target.value)}
            onBlur={() => {
              if (kw.trim() && kw.trim() !== keywordFor(state, index)) {
                void run({ action: 'settings', keywords: { [String(index)]: kw.trim() } }, '키워드 저장');
              }
            }}
            className="mt-1.5 h-9 w-full rounded-lg border border-[#DDD] px-2 text-[13px] font-normal"
          />
        </label>
        <label className="text-[13px] font-extrabold">
          제한시간(초)
          <input
            type="number"
            min={5}
            max={600}
            value={dur}
            onChange={(e) => setDur(e.target.value)}
            onBlur={() => {
              const n = Math.round(Number(dur));
              if (n >= 5 && n !== durationFor(state, index)) {
                void run({ action: 'settings', durations: { [String(index)]: n } }, `제한시간 ${n}초`);
              }
            }}
            className="mt-1.5 h-9 w-full rounded-lg border border-[#DDD] px-2 text-[13px] font-normal tabular-nums"
          />
        </label>
      </div>
    </div>
  );
}

function SubmissionTable({
  rows,
  candidateId,
  winnerId,
  onVerdict,
  onPick,
}: {
  rows: SubmissionRow[];
  candidateId: string | null;
  winnerId: string | null;
  onVerdict: (r: SubmissionRow, v: QuizVerdict | null) => void;
  onPick: (r: SubmissionRow) => void;
}) {
  if (rows.length === 0) return <p className="mt-3 text-[13px] text-[#8A8A8A]">아직 제출이 없습니다.</p>;
  return (
    <div className="mt-2 max-h-[560px] overflow-auto">
      <table className="w-full border-collapse text-[13px]" data-testid="submissions">
        <thead className="sticky top-0 bg-white text-left text-[12px] text-[#8A8A8A]">
          <tr className="border-b">
            <th className="py-1.5 pr-1">#</th>
            <th className="py-1.5 pr-1">이름</th>
            <th className="py-1.5 pr-1">테이블</th>
            <th className="py-1.5 pr-1">답</th>
            <th className="py-1.5 pr-1">자동</th>
            <th className="py-1.5 pr-1">최종</th>
            <th className="py-1.5 pr-1 text-right">경과</th>
            <th className="py-1.5" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const isWinner = r.sub.id === winnerId;
            const isCandidate = !winnerId && r.sub.id === candidateId;
            return (
              <tr
                key={r.sub.id}
                data-testid="sub-row"
                data-name={r.participant?.name ?? ''}
                className={clsx(
                  'border-b border-[#F1F0EA]',
                  isWinner && 'bg-[#1E1E1E] text-white',
                  isCandidate && 'bg-[#FFF6B3]',
                )}
              >
                <td className="py-1.5 pr-1 tabular-nums">{i + 1}</td>
                <td className="max-w-[120px] truncate py-1.5 pr-1 font-semibold">
                  {r.participant?.name ?? '?'}
                  {r.wonElsewhere ? <span className="ml-1 text-[11px]" title="다른 문제 수상자">🏅</span> : null}
                </td>
                <td className="py-1.5 pr-1 tabular-nums">{r.participant?.table_no}</td>
                <td className="max-w-[200px] break-words py-1.5 pr-1">{r.sub.answer}</td>
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
                        r.final === 'correct' ? 'border-[#1F8A3B] bg-[#1F8A3B] text-white' : 'border-[#DDD] bg-white text-[#1E1E1E]',
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
                        r.final === 'wrong' ? 'border-[#C23A1E] bg-[#C23A1E] text-white' : 'border-[#DDD] bg-white text-[#1E1E1E]',
                      )}
                    >
                      ✗
                    </button>
                  </div>
                </td>
                <td className="py-1.5 pr-1 text-right tabular-nums">
                  {r.elapsedMs === null ? '—' : `${(r.elapsedMs / 1000).toFixed(1)}s`}
                </td>
                <td className="py-1.5 text-right">
                  {isWinner ? (
                    <span className="text-[12px] font-bold text-[#FFE300]">🏅 확정</span>
                  ) : r.final === 'correct' && !r.wonElsewhere ? (
                    <button
                      type="button"
                      onClick={() => onPick(r)}
                      className="rounded-md border border-[#DDD] bg-white px-1.5 py-0.5 text-[11px] text-[#1E1E1E]"
                    >
                      이 사람으로
                    </button>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
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

function Resets({
  index,
  run,
}: {
  index: number;
  run: (act: QuizControlAction, ok?: string) => Promise<boolean>;
}) {
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
          <span>
            {arm === 'q'
              ? `${questionLabel(index)}의 제출·수상자를 지웁니다.`
              : '모든 제출·수상자를 지우고 연습 문제 대기로 돌아갑니다.'}
          </span>
          {arm === 'all' ? (
            <label className="flex items-center gap-1">
              <input type="checkbox" checked={withPeople} onChange={(e) => setWithPeople(e.target.checked)} /> 참가자도 지우기
            </label>
          ) : null}
          <button
            type="button"
            data-testid="reset-confirm"
            onClick={() => {
              void run(
                arm === 'q' ? { action: 'reset_question', index } : { action: 'reset_all', participants: withPeople },
                '초기화했습니다',
              );
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
