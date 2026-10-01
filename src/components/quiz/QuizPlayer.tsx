'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import clsx from 'clsx';

import { anonNickname } from '@/lib/anon';
import { cachedSnapshot, useClientValue } from '@/lib/clientStore';
import { getQuizDb } from '@/lib/quizDb';
import { correctRank } from '@/lib/quizJudge';
import {
  fmtClock,
  keywordFor,
  remainingMs,
  useNow,
  useQuizState,
  useServerOffset,
} from '@/lib/quizClient';
import { QUIZ_QUESTIONS, questionLabel, stars } from '@/lib/quizQuestions';
import {
  QUIZ_ERROR_TEXT,
  QuizError,
  type QuizMySubmission,
  type QuizState,
} from '@/lib/quizTypes';

/** 테이블 수 — NEXT_PUBLIC_QUIZ_TABLES (기본 32) */
export const QUIZ_TABLES = Math.max(
  1,
  Math.min(99, Number(process.env.NEXT_PUBLIC_QUIZ_TABLES ?? 32) || 32),
);

/**
 * 참가 정보 키. 주소에 ?as=라벨 이 있으면 그 라벨로 구분한다 — 한 브라우저에서 여러 참가자 탭을 띄우는
 * 리허설·시연용(실제 휴대폰에서는 쓸 일이 없다).
 */
function meKey(): string {
  if (typeof window === 'undefined') return 'eb:quiz:me';
  const as = new URLSearchParams(window.location.search).get('as');
  return as ? `eb:quiz:me:${as.replace(/[^\w-]/g, '').slice(0, 20)}` : 'eb:quiz:me';
}
const SUB_KEY = (pid: string, index: number) => `eb:quiz:sub:${pid}:${index}`;

interface Me {
  id: string;
  name: string;
  table_no: number;
}

function readMe(): Me | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(meKey());
    return raw ? (JSON.parse(raw) as Me) : null;
  } catch {
    return null;
  }
}

const storedMe = cachedSnapshot(readMe);

function readCachedSub(pid: string, index: number): QuizMySubmission | null {
  try {
    const raw = window.localStorage.getItem(SUB_KEY(pid, index));
    return raw ? (JSON.parse(raw) as QuizMySubmission) : null;
  } catch {
    return null;
  }
}

function writeCachedSub(pid: string, index: number, sub: QuizMySubmission): void {
  try {
    window.localStorage.setItem(SUB_KEY(pid, index), JSON.stringify(sub));
  } catch {
    /* noop */
  }
}

/** 참가자 화면 — 휴대폰 우선 (Quiz v1.0) */
export function QuizPlayer() {
  const stored = useClientValue<Me | null | undefined>(storedMe.get, undefined);
  const [joined, setJoined] = useState<Me | null>(null);
  const [forgotten, setForgotten] = useState(false);
  const me = joined ?? (forgotten ? null : stored ?? null);

  // 저장된 참가 정보가 서버에 없으면(전체 초기화 등) 다시 입장하게 한다
  useEffect(() => {
    if (!me) return;
    let cancelled = false;
    getQuizDb()
      .me(me.id)
      .then((p) => {
        if (cancelled || p) return;
        try {
          window.localStorage.removeItem(meKey());
        } catch {
          /* noop */
        }
        storedMe.reset();
        setJoined(null);
        setForgotten(true);
        toast.message('퀴즈가 초기화되었습니다. 다시 입장해 주세요');
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [me]);

  if (stored === undefined) return <main className="min-h-dvh bg-[#FFFBEA]" />;

  return (
    <main className="min-h-dvh select-none bg-[#FFFBEA] text-[#1E1E1E]" style={{ touchAction: 'manipulation' }}>
      {me ? (
        <PlayerStage me={me} />
      ) : (
        <JoinForm
          onJoined={(m) => {
            storedMe.reset();
            setForgotten(false);
            setJoined(m);
          }}
        />
      )}
    </main>
  );
}

// ─── 입장 ───────────────────────────────────────────────────

function JoinForm({ onJoined }: { onJoined: (me: Me) => void }) {
  const [name, setName] = useState('');
  const [table, setTable] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  async function join() {
    if (table === null || busy) return;
    setBusy(true);
    try {
      const finalName = name.trim() || anonNickname();
      const p = await getQuizDb().join(finalName, table);
      const me: Me = { id: p.id, name: p.name, table_no: p.table_no };
      try {
        window.localStorage.setItem(meKey(), JSON.stringify(me));
      } catch {
        /* noop */
      }
      onJoined(me);
    } catch (err) {
      const code = err instanceof QuizError ? err.code : 'QUIZ_NETWORK';
      toast.error(QUIZ_ERROR_TEXT[code]);
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-[480px] px-4 pb-10 pt-8">
      <p className="inline-flex rounded-full bg-[#FFE300] px-3 py-1 text-[13px] font-bold">SPEED QUIZ</p>
      <h1 className="mt-3 text-[28px] font-extrabold leading-tight">스피드 퀴즈</h1>
      <p className="mt-2 text-[15px] leading-6 text-[#5B5B5B]">
        테이블 번호를 누르고 참가하세요. 문제마다 <strong>가장 먼저 정답을 낸 한 분</strong>께 상품을 드립니다.
      </p>

      <section className="mt-6 rounded-2xl bg-white p-4 shadow-[0_1px_3px_rgba(0,0,0,0.06)]">
        <label className="block text-[14px] font-bold" htmlFor="quiz-name">
          이름 <span className="font-normal text-[#8A8A8A]">(선택)</span>
        </label>
        <input
          id="quiz-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={12}
          autoComplete="off"
          placeholder="예) 제일런"
          className="mt-2 h-12 w-full select-text rounded-xl border border-[#E5E1D3] px-3 text-[16px] outline-none focus:border-[#1E1E1E]"
        />
        <p className="mt-1.5 text-[12px] text-[#8A8A8A]">비워 두면 자동 별칭이 붙습니다.</p>

        <p className="mt-5 text-[14px] font-bold">테이블 번호</p>
        <div className="mt-2 grid grid-cols-6 gap-1.5" role="radiogroup" aria-label="테이블 번호">
          {Array.from({ length: QUIZ_TABLES }, (_, i) => i + 1).map((n) => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={table === n}
              aria-label={`${n}번 테이블`}
              onClick={() => setTable(n)}
              className={clsx(
                'h-11 rounded-lg border text-[16px] font-bold tabular-nums transition',
                table === n ? 'border-[#1E1E1E] bg-[#FFE300]' : 'border-[#E5E1D3] bg-white',
              )}
            >
              {n}
            </button>
          ))}
        </div>

        <button
          type="button"
          disabled={table === null || busy}
          onClick={() => void join()}
          className="mt-6 h-14 w-full rounded-xl bg-[#1E1E1E] text-[17px] font-bold text-white disabled:opacity-30"
        >
          {busy ? '입장하는 중…' : table ? `${table}번 테이블로 참가하기` : '참가하기'}
        </button>
      </section>
    </div>
  );
}

// ─── 참가 후 ────────────────────────────────────────────────

function PlayerStage({ me }: { me: Me }) {
  const state = useQuizState();
  const offset = useServerOffset();
  const now = useNow();

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[520px] flex-col px-4 pb-8">
      <header className="flex h-14 shrink-0 items-center gap-2">
        <span className="rounded-full bg-[#FFE300] px-2.5 py-0.5 text-[12px] font-extrabold">SPEED QUIZ</span>
        <span className="ml-auto truncate text-[14px] font-semibold" aria-label="내 이름">
          {me.name}
        </span>
        <span className="shrink-0 rounded-full bg-white px-2 py-0.5 text-[13px] font-semibold text-[#5B5B5B]">
          {me.table_no}번 테이블
        </span>
      </header>

      {!state ? (
        <Center>
          <p className="text-[16px] text-[#8A8A8A]">연결하는 중…</p>
        </Center>
      ) : (
        <StageBody key={state.current_index} me={me} state={state} now={now} offset={offset} />
      )}
    </div>
  );
}

function StageBody({ me, state, now, offset }: { me: Me; state: QuizState; now: number; offset: number }) {
  const index = state.current_index;
  const q = QUIZ_QUESTIONS[index];
  const [mine, setMine] = useState<QuizMySubmission | null>(() => readCachedSub(me.id, index));

  // 내 답 — 새로고침·공개 때 서버에서 다시 읽는다(판정은 공개 때 채워진다)
  const refreshMine = useCallback(() => {
    void getQuizDb()
      .mySubmission(me.id, index)
      .then((s) => {
        if (s) {
          setMine(s);
          writeCachedSub(me.id, index, s);
        } else {
          // 서버에 없으면(운영자가 문제를 초기화한 경우) 캐시도 지운다
          setMine(null);
          try {
            window.localStorage.removeItem(SUB_KEY(me.id, index));
          } catch {
            /* noop */
          }
        }
      })
      .catch(() => undefined);
  }, [me.id, index]);

  useEffect(() => {
    refreshMine();
  }, [refreshMine, state.status]);

  if (state.status === 'final') return <FinalView state={state} me={me} />;
  if (!q) return null;

  if (state.status === 'lobby') {
    return (
      <Center>
        <div className="text-center">
          <p className="text-[44px]" aria-hidden>
            ⏳
          </p>
          <p className="mt-3 text-[22px] font-extrabold">다음 문제를 기다리는 중</p>
          <p className="mt-2 text-[15px] text-[#5B5B5B]">
            {q.practice ? '곧 연습 문제로 시작합니다' : `다음은 ${questionLabel(index)}`}
          </p>
          <p className="mt-6 text-[13px] text-[#8A8A8A]">화면을 켜 둔 채로 기다려 주세요</p>
        </div>
      </Center>
    );
  }

  const left = remainingMs(state, now, offset);
  const timeUp = state.status !== 'open' || left === 0;

  return (
    <div className="flex flex-1 flex-col">
      <QuestionHead state={state} left={left} />

      {state.status === 'revealed' && state.reveal && state.reveal.index === index ? (
        <RevealView state={state} me={me} mine={mine} />
      ) : (
        <>
          <QuestionText state={state} />
          {mine && !(state.allow_edit && !timeUp) ? (
            <SubmittedBox mine={mine} closed={state.status !== 'open'} />
          ) : timeUp ? (
            <ClosedBox />
          ) : (
            <AnswerForm
              me={me}
              index={index}
              input={q.input}
              initial={mine?.answer ?? ''}
              editing={Boolean(mine)}
              onSubmitted={(s) => {
                setMine(s);
                writeCachedSub(me.id, index, s);
              }}
              onDuplicate={refreshMine}
            />
          )}
        </>
      )}
    </div>
  );
}

function QuestionHead({ state, left }: { state: QuizState; left: number | null }) {
  const q = QUIZ_QUESTIONS[state.current_index];
  const urgent = left !== null && left <= 10_000;
  return (
    <div className="flex items-center gap-2 pt-1">
      <span className="rounded-lg bg-[#1E1E1E] px-2.5 py-1 text-[15px] font-extrabold text-white">
        {questionLabel(state.current_index)}
      </span>
      <span className="rounded-lg bg-white px-2 py-1 text-[13px] font-semibold">{q.category}</span>
      <span className="text-[14px] tracking-tight text-[#E0A800]" aria-label={`난이도 ${q.difficulty}`}>
        {stars(q.difficulty)}
      </span>
      <span
        className={clsx(
          'ml-auto min-w-[64px] rounded-lg px-2.5 py-1 text-center text-[20px] font-extrabold tabular-nums',
          state.status !== 'open' ? 'bg-[#EDEDED] text-[#8A8A8A]' : urgent ? 'bg-[#FF5A3C] text-white' : 'bg-[#FFE300]',
        )}
        aria-label="남은 시간"
        role="timer"
      >
        {state.status === 'open' && left !== null ? (left === 0 ? '마감' : fmtClock(left)) : state.status === 'revealed' ? '공개' : '마감'}
      </span>
    </div>
  );
}

function QuestionText({ state }: { state: QuizState }) {
  const q = QUIZ_QUESTIONS[state.current_index];
  if (state.display_mode === 'keyword') {
    return (
      <div className="mt-5 rounded-2xl bg-white p-5 text-center shadow-[0_1px_3px_rgba(0,0,0,0.06)]">
        <p className="text-[26px] font-extrabold leading-tight">{keywordFor(state, state.current_index)}</p>
        <p className="mt-2 text-[14px] text-[#8A8A8A]">문제는 앞 화면을 보세요</p>
      </div>
    );
  }
  return (
    <div className="mt-4 rounded-2xl bg-white p-4 shadow-[0_1px_3px_rgba(0,0,0,0.06)]">
      <p className="whitespace-pre-line text-[16px] leading-7">{q.prompt}</p>
    </div>
  );
}

function AnswerForm({
  me,
  index,
  input,
  initial,
  editing,
  onSubmitted,
  onDuplicate,
}: {
  me: Me;
  index: number;
  input: 'decimal' | 'text';
  initial: string;
  editing: boolean;
  onSubmitted: (s: QuizMySubmission) => void;
  onDuplicate: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  async function submit() {
    const answer = draft.trim();
    if (!answer || busy) return;
    setBusy(true);
    try {
      const ts = await getQuizDb().submit(me.id, index, answer);
      onSubmitted({ answer, created_at: ts, verdict: null });
      inputRef.current?.blur();
    } catch (err) {
      const code = err instanceof QuizError ? err.code : 'QUIZ_NETWORK';
      toast.error(QUIZ_ERROR_TEXT[code]);
      if (code === 'QUIZ_DUPLICATE') onDuplicate();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="mt-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <label htmlFor="quiz-answer" className="sr-only">
        답
      </label>
      <input
        id="quiz-answer"
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        inputMode={input === 'decimal' ? 'decimal' : 'text'}
        enterKeyHint="send"
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        maxLength={200}
        placeholder={input === 'decimal' ? '숫자로 입력' : '답을 입력'}
        className="h-16 w-full select-text rounded-2xl border-2 border-[#1E1E1E] bg-white px-4 text-[22px] font-bold outline-none focus:border-[#E0A800]"
      />
      <button
        type="submit"
        disabled={!draft.trim() || busy}
        className="mt-3 h-14 w-full rounded-2xl bg-[#FFE300] text-[18px] font-extrabold text-[#1E1E1E] shadow-[0_2px_0_#1E1E1E] disabled:opacity-40"
      >
        {busy ? '보내는 중…' : editing ? '답 수정하기' : '제출하기'}
      </button>
      <p className="mt-2 text-center text-[13px] text-[#8A8A8A]">
        {editing ? '마감 전까지 고칠 수 있습니다' : '한 번만 낼 수 있어요'}
      </p>
    </form>
  );
}

function SubmittedBox({ mine, closed }: { mine: QuizMySubmission; closed: boolean }) {
  return (
    <div className="mt-4 rounded-2xl border-2 border-[#1E1E1E] bg-white p-5 text-center" role="status">
      <p className="text-[22px] font-extrabold">제출됨 ✓</p>
      <p className="mt-1 text-[14px] text-[#5B5B5B]">정답은 공개 때 알려 드려요</p>
      <p className="mt-3 break-words rounded-xl bg-[#FFFBEA] px-3 py-2 text-[18px] font-bold">{mine.answer}</p>
      {closed ? <p className="mt-3 text-[13px] text-[#8A8A8A]">마감되었습니다</p> : null}
    </div>
  );
}

function ClosedBox() {
  return (
    <div className="mt-4 rounded-2xl bg-[#EDEDED] p-5 text-center" role="status">
      <p className="text-[20px] font-extrabold">마감되었습니다</p>
      <p className="mt-1 text-[14px] text-[#5B5B5B]">이번 문제는 제출하지 못했어요</p>
    </div>
  );
}

function RevealView({ state, me, mine }: { state: QuizState; me: Me; mine: QuizMySubmission | null }) {
  const reveal = state.reveal!;
  const iWon = reveal.winner?.participant_id === me.id;
  const verdict = mine?.verdict ?? null;
  const totalCorrect = reveal.correct_times?.length ?? 0;
  const rank = verdict === 'correct' ? correctRank(reveal.correct_times, mine?.created_at) : null;
  return (
    <div className="mt-4 flex flex-col gap-3">
      {iWon ? (
        <div className="rounded-2xl bg-[#1E1E1E] p-5 text-center text-white" role="status" data-testid="result-winner">
          <p className="text-[34px]" aria-hidden>
            🎉
          </p>
          <p className="mt-1 text-[22px] font-extrabold text-[#FFE300]">첫 정답자입니다!</p>
          <p className="mt-1 text-[14px]">진행자에게 이 화면을 보여 주세요</p>
        </div>
      ) : mine && verdict === 'correct' ? (
        <div className="rounded-2xl bg-[#1F8A3B] p-5 text-center text-white" role="status" data-testid="result-correct">
          <p className="text-[30px]" aria-hidden>
            👏
          </p>
          <p className="mt-1 text-[22px] font-extrabold">
            {rank ? `정답! ${rank}번째로 맞혔어요` : '정답입니다!'}
          </p>
          {totalCorrect > 0 ? (
            <p className="mt-1 text-[14px]">정답자 {totalCorrect}명 중{rank ? ` ${rank}등` : ''}</p>
          ) : null}
          {rank === 1 && reveal.winner ? (
            <p className="mt-1 text-[13px] opacity-90">이미 다른 문제에서 상품을 받으셔서 다음 정답자에게 넘어갔어요</p>
          ) : null}
        </div>
      ) : mine && verdict === 'wrong' ? (
        <div className="rounded-2xl bg-[#C23A1E] p-5 text-center text-white" role="status" data-testid="result-wrong">
          <p className="text-[30px]" aria-hidden>
            😢
          </p>
          <p className="mt-1 text-[22px] font-extrabold">아쉽게도 틀렸어요</p>
          <p className="mt-1 text-[14px]">다음 문제에서 다시 도전해 보세요</p>
        </div>
      ) : null}

      <div className="rounded-2xl bg-[#FFE300] p-5">
        <p className="text-[13px] font-bold">정답</p>
        <p className="mt-1 whitespace-pre-line text-[24px] font-extrabold leading-tight">{reveal.answer}</p>
        <p className="mt-3 text-[15px] leading-6">{reveal.explanation}</p>
      </div>

      <div
        className={clsx(
          'rounded-2xl p-4 text-center',
          verdict === 'correct' ? 'bg-[#E3F6E8]' : verdict === 'wrong' ? 'bg-[#FCE8E4]' : 'bg-white',
        )}
        aria-label="내 결과"
      >
        {mine ? (
          <>
            <p className="text-[13px] text-[#5B5B5B]">내 답</p>
            <p className="mt-0.5 break-words text-[18px] font-bold">{mine.answer}</p>
            <p
              className={clsx(
                'mt-2 text-[22px] font-extrabold',
                verdict === 'correct' ? 'text-[#1F8A3B]' : verdict === 'wrong' ? 'text-[#C23A1E]' : 'text-[#5B5B5B]',
              )}
            >
              {verdict === 'correct' ? '정답 ✓' : verdict === 'wrong' ? '오답' : '채점 중'}
            </p>
          </>
        ) : (
          <p className="text-[16px] text-[#5B5B5B]">이번 문제는 제출하지 않았어요</p>
        )}
      </div>
    </div>
  );
}

function FinalView({ state, me }: { state: QuizState; me: Me }) {
  const board = state.leaderboard ?? [];
  return (
    <Center>
      <div className="w-full text-center">
        <p className="text-[44px]" aria-hidden>
          🏆
        </p>
        <p className="mt-2 text-[24px] font-extrabold">수고하셨습니다!</p>
        {board.length ? (
          <ol className="mt-5 space-y-2 text-left">
            {board.map((r) => (
              <li
                key={r.participant_id}
                className={clsx(
                  'flex items-center gap-3 rounded-xl px-4 py-3',
                  r.participant_id === me.id ? 'bg-[#1E1E1E] text-white' : 'bg-white',
                )}
              >
                <span className="text-[22px] font-extrabold">{r.rank}위</span>
                <span className="truncate text-[17px] font-bold">{r.name}</span>
                <span className="ml-auto shrink-0 text-[14px]">{r.correct}문제</span>
              </li>
            ))}
          </ol>
        ) : null}
      </div>
    </Center>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-1 items-center justify-center py-10">{children}</div>;
}
