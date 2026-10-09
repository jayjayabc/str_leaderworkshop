'use client';

// 참가자 화면 — 휴대폰 우선 (Quiz v2.0 단체전)
//   1) 우리 조(1~30)를 누른다 → 2) 답변자(조당 1명) / 관전자를 고른다 → 3) 조 페이지
//   답변자만 답을 낸다(조당 1건). 관전자는 문제·이미지를 보며 함께 풀고, 우리 조 제출·결과·점수를 본다.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import clsx from 'clsx';

import { cachedSnapshot, useClientValue } from '@/lib/clientStore';
import { getQuizDb } from '@/lib/quizDb';
import {
  fmtClock,
  keywordFor,
  pointsFor,
  rankScores,
  remainingMs,
  speedLabel,
  speedRuleFor,
  useNow,
  usePreloadImages,
  useQuizState,
  useScoreboard,
  useServerOffset,
} from '@/lib/quizClient';
import { FIELD_SEP, QUIZ_QUESTIONS, QUIZ_TEAMS, questionLabel, shortLabel, type QuizQuestionPublic } from '@/lib/quizQuestions';
import {
  QUIZ_ERROR_TEXT,
  QuizError,
  type QuizRole,
  type QuizState,
  type QuizTeamStatus,
  type SpeedRule,
} from '@/lib/quizTypes';
import { useNewVersion } from './NewVersionBanner';
import { PhoneImages } from './QuizImages';
import { speedRows } from '@/lib/quizScore';
import { RichText } from './QuizText';

/**
 * 참가 정보 키. 주소에 ?as=라벨 이 있으면 그 라벨로 구분한다 — 한 브라우저에서 여러 참가자 탭을 띄우는
 * 리허설·시연용(실제 휴대폰에서는 쓸 일이 없다).
 */
function meKey(): string {
  if (typeof window === 'undefined') return 'eb:quiz2:me';
  const as = new URLSearchParams(window.location.search).get('as');
  return as ? `eb:quiz2:me:${as.replace(/[^\w-]/g, '').slice(0, 20)}` : 'eb:quiz2:me';
}

interface Me {
  id: string;
  team: number;
  role: QuizRole;
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

function writeMe(me: Me | null): void {
  try {
    if (me) window.localStorage.setItem(meKey(), JSON.stringify(me));
    else window.localStorage.removeItem(meKey());
  } catch {
    /* 저장이 막힌 브라우저 — 이번 탭에서만 유지 */
  }
}

const storedMe = cachedSnapshot(readMe);

function errText(err: unknown): string {
  const code = err instanceof QuizError ? err.code : 'QUIZ_NETWORK';
  return QUIZ_ERROR_TEXT[code];
}

export function QuizPlayer() {
  const stored = useClientValue<Me | null | undefined>(storedMe.get, undefined);
  const [override, setOverride] = useState<{ me: Me | null } | null>(null);
  const me = override ? override.me : stored ?? null;

  const setMe = useCallback((m: Me | null) => {
    writeMe(m);
    storedMe.reset();
    setOverride({ me: m });
  }, []);

  // 저장된 참가 정보가 서버에 없으면(전체 초기화 등) 처음부터 다시 입장
  useEffect(() => {
    if (!me) return;
    let cancelled = false;
    getQuizDb()
      .me(me.id)
      .then((p) => {
        if (cancelled || p) return;
        setMe(null);
        toast.message('퀴즈가 초기화되었습니다. 조를 다시 선택해 주세요');
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [me, setMe]);

  if (stored === undefined) return <main className="min-h-dvh bg-[#0E0F13]" />;

  return (
    <main className="min-h-dvh select-none bg-[#0E0F13] text-white" style={{ touchAction: 'manipulation' }}>
      {me ? <TeamStage me={me} setMe={setMe} /> : <Entry onJoined={setMe} />}
    </main>
  );
}

// ─── 입장: 조 → 역할 ─────────────────────────────────────────

function Entry({ onJoined }: { onJoined: (m: Me) => void }) {
  const [team, setTeam] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [taken, setTaken] = useState(false);

  async function join(role: QuizRole, takeover = false) {
    if (team === null || busy) return;
    setBusy(true);
    try {
      const p = await getQuizDb().joinTeam(team, role, takeover);
      onJoined({ id: p.id, team, role });
    } catch (err) {
      if (err instanceof QuizError && err.code === 'QUIZ_ANSWERER_TAKEN') setTaken(true);
      else toast.error(errText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[520px] flex-col px-4 pb-8 pt-6">
      <Brand />
      {team === null ? (
        <>
          <h1 className="mt-6 text-[26px] font-extrabold leading-tight">우리 조를 눌러 주세요</h1>
          <p className="mt-1 text-[14px] text-white/60">테이블에 놓인 조 번호를 확인하세요</p>
          <div className="mt-5 grid grid-cols-5 gap-2" role="radiogroup" aria-label="조 번호">
            {Array.from({ length: QUIZ_TEAMS }, (_, i) => i + 1).map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setTeam(n)}
                aria-label={`${n}조`}
                className="h-14 rounded-xl bg-white/10 text-[20px] font-extrabold active:scale-95 active:bg-[#FFE300] active:text-[#1E1E1E]"
              >
                {n}
              </button>
            ))}
          </div>
        </>
      ) : (
        <>
          <button type="button" onClick={() => (setTeam(null), setTaken(false))} className="mt-6 self-start text-[14px] text-white/60">
            ← 조 다시 고르기
          </button>
          <h1 className="mt-2 text-[30px] font-extrabold">
            <span className="text-[#FFE300]">{team}조</span>로 입장
          </h1>
          {taken ? (
            <div className="mt-5 rounded-2xl bg-white/10 p-5" role="alert">
              <p className="text-[18px] font-extrabold">이미 답변자가 있어요</p>
              <p className="mt-1 text-[14px] leading-6 text-white/70">
                내가 답변자를 맡으면 기존 답변자는 관전자로 바뀝니다. 조원과 먼저 이야기해 주세요.
              </p>
              <div className="mt-4 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void join('answerer', true)}
                  className="h-12 rounded-xl bg-[#FFE300] text-[15px] font-extrabold text-[#1E1E1E] disabled:opacity-40"
                >
                  내가 답변자 할게요
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void join('spectator')}
                  className="h-12 rounded-xl bg-white/15 text-[15px] font-bold disabled:opacity-40"
                >
                  관전자로 입장
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-5 flex flex-col gap-3">
              <RoleCard
                title="답변자"
                badge="조당 1명"
                desc="우리 조 대표로 답을 입력합니다. 조원과 상의해서 하나의 답을 제출해요."
                tone="primary"
                disabled={busy}
                onClick={() => void join('answerer')}
              />
              <RoleCard
                title="관전자"
                desc="문제와 이미지를 내 폰으로 보며 함께 풀고, 우리 조 제출·정답·점수를 실시간으로 봅니다."
                disabled={busy}
                onClick={() => void join('spectator')}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}

function RoleCard({
  title,
  badge,
  desc,
  tone,
  disabled,
  onClick,
}: {
  title: string;
  badge?: string;
  desc: string;
  tone?: 'primary';
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={clsx(
        'rounded-2xl p-5 text-left active:scale-[0.98] disabled:opacity-40',
        tone === 'primary' ? 'bg-[#FFE300] text-[#1E1E1E]' : 'bg-white/10 text-white',
      )}
    >
      <span className="flex items-center gap-2">
        <span className="text-[22px] font-extrabold">{title}</span>
        {badge ? (
          <span className={clsx('rounded-full px-2 py-0.5 text-[12px] font-bold', tone === 'primary' ? 'bg-[#1E1E1E] text-[#FFE300]' : 'bg-white/15')}>
            {badge}
          </span>
        ) : null}
      </span>
      <span className={clsx('mt-1 block text-[14px] leading-6', tone === 'primary' ? 'text-[#1E1E1E]/80' : 'text-white/70')}>{desc}</span>
    </button>
  );
}

function Brand() {
  return (
    <div className="flex items-center gap-2">
      <span className="rounded-full bg-[#FFE300] px-2.5 py-0.5 text-[12px] font-extrabold text-[#1E1E1E]">SPEED QUIZ</span>
      <span className="text-[12px] font-bold tracking-wide text-white/60">단체전</span>
    </div>
  );
}

// ─── 조 페이지 ────────────────────────────────────────────────

/**
 * 우리 조 상황 — 상태가 바뀔 때마다(+ bump), 그리고 문제가 열려 있는 동안 4초마다.
 * 240대가 한꺼번에 묻지 않게 0~1.2초 흩어서 읽는다. 서버가 null(참가 정보 없음)을 주면 onGone.
 */
function useTeamStatus(me: Me, state: QuizState | null, bump: number, onGone: () => void): QuizTeamStatus | null {
  const [status, setStatus] = useState<{ key: string; v: QuizTeamStatus | null } | null>(null);
  const index = state?.current_index ?? 0;
  const key = `${me.id}:${index}:${state?.status ?? ''}:${state?.updated_at ?? ''}:${bump}`;
  const open = state?.status === 'open';
  const goneRef = useRef(onGone);
  useEffect(() => {
    goneRef.current = onGone;
  });
  useEffect(() => {
    let cancelled = false;
    const pull = () =>
      getQuizDb()
        .teamStatus(me.id, index)
        .then((v) => {
          if (cancelled) return;
          if (v === null) goneRef.current();
          else setStatus({ key, v });
        })
        .catch(() => undefined);
    const first = setTimeout(() => void pull(), bump > 0 ? 0 : Math.random() * 1200);
    const t = open ? setInterval(() => void pull(), 4000) : null;
    return () => {
      cancelled = true;
      clearTimeout(first);
      if (t) clearInterval(t);
    };
  }, [me.id, index, key, open, bump]);
  // 다른 문제의 지난 상황은 보여 주지 않는다 (같은 문제의 직전 값은 새 값이 올 때까지 유지)
  if (!status || !status.key.startsWith(`${me.id}:${index}:`)) return null;
  return status.v;
}

function TeamStage({ me, setMe }: { me: Me; setMe: (m: Me | null) => void }) {
  const state = useQuizState();
  const offset = useServerOffset();
  const now = useNow();
  const [bump, setBump] = useState(0);
  const refresh = useCallback(() => setBump((b) => b + 1), []);
  const team = useTeamStatus(me, state, bump, () => {
    setMe(null);
    toast.message('퀴즈가 초기화되었습니다. 조를 다시 선택해 주세요');
  });
  const [localSub, setLocalSub] = useState<{ index: number; answer: string } | null>(null);
  const pendingRole = useRef<QuizRole | null>(null);

  // 서버 기준 역할로 맞춘다 — 내가 방금 바꾼 경우엔 조용히, 다른 기기가 넘겨받은 경우엔 알림
  useEffect(() => {
    if (!team || team.role === me.role) return;
    const mine = pendingRole.current === team.role;
    pendingRole.current = null;
    setMe({ ...me, role: team.role });
    if (!mine && team.role === 'spectator') toast.message('다른 조원이 답변자를 맡아 관전자로 바뀌었어요');
  }, [team, me, setMe]);

  // 새 버전이 배포됐으면 문제 진행 중이 아닐 때 0~20초 사이에 조용히 새로고침
  const stale = useNewVersion();
  const willReload = Boolean(stale && state && state.status !== 'open');
  useEffect(() => {
    if (!willReload) return;
    try {
      const from = process.env.NEXT_PUBLIC_BUILD_ID ?? '';
      if (window.sessionStorage.getItem('eb:quiz:reloaded-from') === from) return;
      window.sessionStorage.setItem('eb:quiz:reloaded-from', from);
    } catch {
      /* noop */
    }
    const t = setTimeout(() => window.location.reload(), Math.random() * 20_000);
    return () => clearTimeout(t);
  }, [willReload]);

  const scoreStamp = state ? `${state.status}:${state.current_index}:${state.status === 'revealed' ? state.updated_at : ''}` : '';
  const board = useScoreboard(scoreStamp);
  const ranked = useMemo(() => (board ? rankScores(board) : null), [board]);
  const mine = ranked?.find((r) => r.team_no === me.team) ?? null;

  async function switchRole(role: QuizRole, takeover = false) {
    try {
      await getQuizDb().setRole(me.id, role, takeover);
      pendingRole.current = role;
      refresh(); // 서버 역할을 다시 읽어 맞춘다(낙관적 변경 없음 — 되돌림 깜빡임 방지)
    } catch (err) {
      if (err instanceof QuizError && err.code === 'QUIZ_ANSWERER_TAKEN') {
        if (window.confirm('이미 답변자가 있어요. 내가 넘겨받을까요? (기존 답변자는 관전자로 바뀝니다)')) {
          void switchRole(role, true);
        }
      } else toast.error(errText(err));
    }
  }

  const index = state?.current_index ?? 0;
  const submission =
    team?.submission ?? (localSub && localSub.index === index ? { answer: localSub.answer, created_at: '', verdict: null } : null);

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[520px] flex-col px-4 pb-10">
      <header className="sticky top-0 z-10 -mx-4 flex h-14 items-center gap-2 bg-[#0E0F13]/95 px-4 backdrop-blur">
        <span className="rounded-lg bg-[#FFE300] px-2.5 py-1 text-[16px] font-extrabold text-[#1E1E1E]">{me.team}조</span>
        <span
          className={clsx(
            'rounded-full px-2.5 py-0.5 text-[12px] font-bold',
            me.role === 'answerer' ? 'bg-white text-[#1E1E1E]' : 'bg-white/15 text-white/80',
          )}
        >
          {me.role === 'answerer' ? '답변자' : '관전자'}
        </span>
        <span className="ml-auto text-right leading-tight" aria-label="우리 조 점수">
          <span className="block text-[18px] font-extrabold tabular-nums text-[#FFE300]">{mine ? `${mine.score}점` : '—'}</span>
          <span className="block text-[11px] text-white/50">{mine ? `${mine.rank}위 / ${QUIZ_TEAMS}조` : '점수'}</span>
        </span>
      </header>

      {!state ? (
        <Center>
          <p className="text-[16px] text-white/50">연결하는 중…</p>
        </Center>
      ) : state.status === 'final' ? (
        <FinalView ranked={ranked} me={me} />
      ) : state.status === 'lobby' ? (
        <Lobby state={state} me={me} team={team} onBecomeAnswerer={() => void switchRole('answerer')} />
      ) : (
        <QuestionStage
          key={index}
          state={state}
          now={now}
          offset={offset}
          me={me}
          team={team}
          submission={submission}
          onSubmitted={(answer) => setLocalSub({ index, answer })}
          onStale={refresh}
          onBecomeAnswerer={() => void switchRole('answerer')}
          mineRank={mine}
        />
      )}

      <div className="mt-auto pt-10 text-center">
        {me.role === 'answerer' ? (
          <button type="button" onClick={() => void switchRole('spectator')} className="text-[13px] text-white/40 underline underline-offset-4">
            답변자 그만하고 관전자로 바꾸기
          </button>
        ) : (
          <button type="button" onClick={() => void switchRole('answerer')} className="text-[13px] text-white/40 underline underline-offset-4">
            답변자로 바꾸기
          </button>
        )}
        <span className="mx-2 text-white/20">·</span>
        <button
          type="button"
          onClick={() => {
            if (window.confirm('조를 다시 고를까요?')) setMe(null);
          }}
          className="text-[13px] text-white/40 underline underline-offset-4"
        >
          조 다시 고르기
        </button>
      </div>
    </div>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-1 items-center justify-center py-12">{children}</div>;
}

function NoAnswererWarning({ onBecomeAnswerer }: { onBecomeAnswerer: () => void }) {
  return (
    <div className="mt-4 flex items-center gap-3 rounded-2xl bg-[#FF5A3C]/15 p-4 ring-1 ring-[#FF5A3C]/50" role="alert">
      <p className="flex-1 text-[14px] leading-5">
        <b>우리 조에 답변자가 없어요.</b>
        <br />한 명이 답변자를 맡아야 답을 낼 수 있어요.
      </p>
      <button type="button" onClick={onBecomeAnswerer} className="shrink-0 rounded-xl bg-[#FFE300] px-3 py-2 text-[14px] font-extrabold text-[#1E1E1E]">
        내가 할게요
      </button>
    </div>
  );
}

function Lobby({
  state,
  me,
  team,
  onBecomeAnswerer,
}: {
  state: QuizState;
  me: Me;
  team: QuizTeamStatus | null;
  onBecomeAnswerer: () => void;
}) {
  const q = QUIZ_QUESTIONS[state.current_index];
  const speed = q && !q.practice ? speedRuleFor(state, state.current_index) : null;
  usePreloadImages(q?.images ?? QUIZ_QUESTIONS[state.current_index + 1]?.images);
  if (q?.interlude) return <FeverCard state={state} />;
  return (
    <Center>
      <div className="w-full text-center">
        <p className="text-[44px]" aria-hidden>
          ⏳
        </p>
        <p className="mt-3 text-[22px] font-extrabold">곧 {q?.practice ? '연습 문제가' : `${shortLabel(state.current_index)}가`} 시작됩니다</p>
        <p className="mt-2 text-[14px] text-white/60">
          {me.role === 'answerer' ? '답변자는 조원과 상의해 답을 입력합니다' : '앞 화면과 내 폰에 문제가 함께 나와요'}
        </p>
        {q && !q.practice ? (
          <p className="mt-4 text-[15px] font-bold text-[#FFE300]">
            배점 {pointsFor(state, state.current_index)}점{speed ? ` · ⚡ 선착순 ${speedLabel(speed)}` : ''}
          </p>
        ) : null}
        {team ? <p className="mt-4 text-[13px] text-white/50">우리 조 입장 {team.members}명</p> : null}
        {team && !team.answerer ? <NoAnswererWarning onBecomeAnswerer={onBecomeAnswerer} /> : null}
      </div>
    </Center>
  );
}

function FeverCard({ state }: { state: QuizState }) {
  const next = state.current_index + 1;
  const rule = speedRuleFor(state, next);
  const base = pointsFor(state, next);
  const rows = speedRows(rule, base);
  return (
    <Center>
      <div className="w-full text-center" data-testid="fever-card">
        <p className="text-[44px]" aria-hidden>
          ⚡
        </p>
        <p className="mt-1 text-[34px] font-black tracking-tight text-[#FFE300]">FEVER TIME</p>
        <p className="mt-2 text-[16px] font-bold">이제부터 먼저 맞힐수록 점수가 커집니다</p>
        <ul className="mx-auto mt-5 max-w-[320px] space-y-2 text-left">
          {rows.map((r) => (
            <li key={r.range} className="flex items-center justify-between rounded-xl bg-white/10 px-4 py-2.5">
              <span className="whitespace-nowrap text-[17px] font-extrabold">{r.range}</span>
              <span className="whitespace-nowrap text-[17px] font-extrabold text-[#FFE300]">
                {r.pts}점 <span className="text-[13px] text-white/60">({r.mult})</span>
              </span>
            </li>
          ))}
          <li className="flex items-center justify-between rounded-xl bg-white/5 px-4 py-2.5 text-white/70">
            <span className="whitespace-nowrap text-[16px] font-bold">그 밖의 정답</span>
            <span className="whitespace-nowrap text-[16px] font-bold">{base}점</span>
          </li>
        </ul>
      </div>
    </Center>
  );
}

function QuestionStage({
  state,
  now,
  offset,
  me,
  team,
  submission,
  onSubmitted,
  onStale,
  onBecomeAnswerer,
  mineRank,
}: {
  state: QuizState;
  now: number;
  offset: number;
  me: Me;
  team: QuizTeamStatus | null;
  submission: { answer: string; created_at: string; verdict: 'correct' | 'wrong' | null } | null;
  onSubmitted: (answer: string) => void;
  onStale: () => void;
  onBecomeAnswerer: () => void;
  mineRank: { score: number; rank: number } | null;
}) {
  const index = state.current_index;
  const q = QUIZ_QUESTIONS[index];
  const left = remainingMs(state, now, offset);
  if (!q) return null;
  const open = state.status === 'open' && left !== null && left > 0;
  const points = pointsFor(state, index);
  const speed = q.practice ? null : speedRuleFor(state, index);

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-2 pt-2">
        <span className="shrink-0 whitespace-nowrap rounded-lg bg-white px-2.5 py-1 text-[15px] font-extrabold text-[#1E1E1E]">{questionLabel(index)}</span>
        <span className="min-w-0 truncate rounded-lg bg-white/10 px-2 py-1 text-[13px] font-semibold">{q.category}</span>
        {!q.practice ? <span className="shrink-0 whitespace-nowrap text-[13px] font-bold text-[#FFE300]">{points}점</span> : null}
        {speed ? <span className="shrink-0 whitespace-nowrap rounded-md bg-[#FFE300] px-1.5 py-0.5 text-[12px] font-black text-[#1E1E1E]">⚡ 선착순</span> : null}
        <span
          className={clsx(
            'ml-auto min-w-[64px] shrink-0 whitespace-nowrap rounded-lg px-2.5 py-1 text-center text-[20px] font-extrabold tabular-nums',
            !open ? 'bg-white/10 text-white/50' : left !== null && left <= 10_000 ? 'bg-[#FF5A3C] text-white' : 'bg-[#FFE300] text-[#1E1E1E]',
          )}
          role="timer"
          aria-label="남은 시간"
        >
          {open && left !== null ? fmtClock(left) : state.status === 'revealed' ? '공개' : '마감'}
        </span>
      </div>

      {state.status === 'revealed' && state.reveal ? (
        <RevealView state={state} submission={submission} points={points} mineRank={mineRank} team={me.team} />
      ) : (
        <>
          {speed && open ? (
            <p className="mt-2 rounded-xl bg-[#FFE300] px-3 py-2 text-center text-[14px] font-extrabold text-[#1E1E1E]" data-testid="speed-banner">
              ⚡ <span className="whitespace-nowrap">선착순 문제</span> — 정답 조 중{' '}
              {speedLabel(speed)
                .split(' · ')
                .map((t, i) => (
                  <span key={t} className="whitespace-nowrap">
                    {i ? ' · ' : ''}
                    {t}
                  </span>
                ))}
            </p>
          ) : null}
          <QuestionCard state={state} q={q} hideChoices={me.role === 'answerer' && open && (!submission || state.allow_edit)} />
          {team && !team.answerer && open ? <NoAnswererWarning onBecomeAnswerer={onBecomeAnswerer} /> : null}
          {me.role === 'answerer' && open && (!submission || state.allow_edit) ? (
            <AnswerForm
              me={me}
              index={index}
              q={q}
              editing={Boolean(submission)}
              initial={submission?.answer ?? ''}
              onSubmitted={onSubmitted}
              onStale={onStale}
              speed={speed}
            />
          ) : (
            <TeamAnswerBox q={q} role={me.role} submission={submission} open={open} />
          )}
        </>
      )}
    </div>
  );
}

function QuestionCard({ state, q, hideChoices }: { state: QuizState; q: QuizQuestionPublic; hideChoices?: boolean }) {
  const keyword = state.display_mode === 'keyword';
  return (
    <div className="mt-3 overflow-hidden rounded-2xl bg-white text-[#1E1E1E]">
      {keyword ? (
        <div className="p-5 text-center">
          <p className="text-[26px] font-extrabold leading-tight">{keywordFor(state, state.current_index)}</p>
          <p className="mt-2 text-[14px] text-[#8A8A8A]">문제는 앞 화면을 보세요</p>
        </div>
      ) : (
        <div className="p-4">
          <p className="whitespace-pre-line text-[16px] leading-7">
            <RichText text={q.prompt} mark="phone" />
          </p>
          {/* 보기는 답변자의 선택 버튼에만 — 본문에는 눌리는 것처럼 보이지 않게 글자로만 */}
          {q.choices && !hideChoices ? (
            <ol className="mt-2 space-y-0.5 text-[15px] text-[#3A3A3A]">
              {q.choices.map((c, i) => (
                <li key={c}>
                  {i + 1}. {c}
                </li>
              ))}
            </ol>
          ) : null}
        </div>
      )}
      {q.images?.length && !keyword ? <PhoneImages images={q.images} captions={q.imageCaptions} /> : null}
    </div>
  );
}

function AnswerForm({
  me,
  index,
  q,
  editing,
  initial,
  onSubmitted,
  onStale,
  speed,
}: {
  speed: SpeedRule | null;
  me: Me;
  index: number;
  q: QuizQuestionPublic;
  editing: boolean;
  initial: string;
  onSubmitted: (answer: string) => void;
  onStale: () => void;
}) {
  const [values, setValues] = useState<string[]>(() => {
    const parts = initial ? initial.split(FIELD_SEP) : [];
    return q.fields.map((_, i) => parts[i] ?? '');
  });
  const [busy, setBusy] = useState(false);
  const filled = values.every((v) => v.trim());
  const speedOn = Boolean(speed);

  async function submit() {
    if (!filled || busy) return;
    const answer = q.fields.length > 1 ? values.map((v) => v.trim()).join(FIELD_SEP) : values[0].trim();
    setBusy(true);
    try {
      await getQuizDb().submit(me.id, index, answer);
      onSubmitted(answer);
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      toast.success('우리 조 답을 제출했어요');
    } catch (err) {
      toast.error(errText(err));
      // 역할이 바뀌었거나(넘겨받기) 이미 다른 조원이 냈으면 우리 조 상황을 다시 읽는다
      if (err instanceof QuizError && ['QUIZ_NOT_ANSWERER', 'QUIZ_UNKNOWN', 'QUIZ_DUPLICATE'].includes(err.code)) onStale();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="mt-4 rounded-2xl bg-white/10 p-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <p className="text-[13px] font-bold text-[#FFE300]">우리 조 대표 답 · 한 번만 제출</p>
      {q.choices ? (
        <div className="mt-3 grid grid-cols-2 gap-2" role="radiogroup" aria-label="보기 선택">
          {q.choices.map((c, i) => (
            <button
              key={c}
              type="button"
              onClick={() => setValues([String(i + 1)])}
              aria-pressed={values[0] === String(i + 1)}
              className={clsx(
                'min-h-14 rounded-xl px-3 py-2 text-left text-[15px] font-bold',
                values[0] === String(i + 1) ? 'bg-[#FFE300] text-[#1E1E1E]' : 'bg-white/10',
              )}
            >
              <span className="mr-1 font-extrabold">{i + 1}.</span>
              {c}
            </button>
          ))}
        </div>
      ) : (
        <div className="mt-3 flex flex-col gap-3">
          {q.fields.map((f, i) => (
            <label key={i} className="block">
              {f.label ? <span className="mb-1 block text-[14px] font-semibold text-white/80">{f.label}</span> : null}
              <span className="flex h-14 items-center rounded-xl bg-white px-4 text-[#1E1E1E] focus-within:ring-4 focus-within:ring-[#FFE300]">
                <input
                  value={values[i]}
                  data-field={i}
                  onKeyDown={(e) => {
                    // 여러 칸 문제에서 키보드 '다음/Enter'로 바로 제출되지 않게 — 다음 칸으로만 이동
                    if (e.key === 'Enter' && i < q.fields.length - 1) {
                      e.preventDefault();
                      const nextInput = e.currentTarget.form?.querySelector<HTMLInputElement>(`input[data-field="${i + 1}"]`);
                      nextInput?.focus();
                    }
                  }}
                  onChange={(e) => setValues((v) => v.map((x, j) => (j === i ? e.target.value : x)))}
                  inputMode={f.input === 'decimal' ? 'decimal' : 'text'}
                  enterKeyHint={i === q.fields.length - 1 ? 'done' : 'next'}
                  autoComplete="off"
                  maxLength={100}
                  placeholder={f.placeholder ?? (f.input === 'decimal' ? '숫자' : '답')}
                  aria-label={f.label ?? '답'}
                  className="min-w-0 flex-1 bg-transparent text-[22px] font-bold outline-none placeholder:text-[#C8C8C8]"
                />
                {f.unit ? <span className="ml-2 shrink-0 text-[20px] font-extrabold text-[#5B5B5B]">{f.unit}</span> : null}
              </span>
            </label>
          ))}
        </div>
      )}
      <button
        type="submit"
        disabled={!filled || busy}
        className="mt-4 h-14 w-full rounded-xl bg-[#FFE300] text-[18px] font-extrabold text-[#1E1E1E] disabled:opacity-30"
      >
        {busy ? '보내는 중…' : editing ? '답 수정하기' : '우리 조 답 제출'}
      </button>
      {speedOn && editing ? (
        <p className="mt-2 text-center text-[12px] font-semibold text-[#FFE300]">⚡ 선착순 문제 — 답을 고치면 제출 순서가 고친 시각으로 바뀝니다</p>
      ) : null}
    </form>
  );
}

/** 제출한 답을 사람이 읽는 형태로 — 객관식은 '2. 13%', 여러 칸은 ' · '로 */
function answerText(q: QuizQuestionPublic | undefined, answer: string): string {
  const n = Number(answer.trim());
  if (q?.choices && Number.isInteger(n) && q.choices[n - 1]) return `${n}. ${q.choices[n - 1]}`;
  return answer.split(FIELD_SEP).join(' · ');
}

function TeamAnswerBox({
  q,
  role,
  submission,
  open,
}: {
  q: QuizQuestionPublic;
  role: QuizRole;
  submission: { answer: string } | null;
  open: boolean;
}) {
  return (
    <div className="mt-4 rounded-2xl bg-white/10 p-5 text-center" role="status">
      {submission ? (
        <>
          <p className="text-[13px] font-bold text-[#7CE38B]">✓ 우리 조 제출 완료</p>
          <p className="mt-1 break-words text-[22px] font-extrabold">{answerText(q, submission.answer)}</p>
          <p className="mt-1 text-[13px] text-white/50">정답은 공개 때 확인할 수 있어요</p>
        </>
      ) : open ? (
        <>
          <p className="text-[18px] font-extrabold">{role === 'answerer' ? '답을 입력해 주세요' : '답변자가 입력 중…'}</p>
          <p className="mt-1 text-[13px] text-white/50">조원과 함께 풀어 보세요 — 답은 답변자 한 명이 제출합니다</p>
        </>
      ) : (
        <>
          <p className="text-[18px] font-extrabold">마감되었습니다</p>
          <p className="mt-1 text-[13px] text-white/50">이번 문제는 우리 조가 제출하지 못했어요</p>
        </>
      )}
    </div>
  );
}

function RevealView({
  state,
  submission,
  points,
  mineRank,
  team,
}: {
  state: QuizState;
  submission: { answer: string; verdict: 'correct' | 'wrong' | null } | null;
  points: number;
  mineRank: { score: number; rank: number } | null;
  team: number;
}) {
  const reveal = state.reveal!;
  const award = reveal.awards?.[String(team)] ?? null;
  const got = award ? award.pts : (reveal.points ?? points);
  const bonus = award && reveal.speed && award.pts !== (reveal.points ?? points);
  const q = QUIZ_QUESTIONS[reveal.index];
  const verdict = submission?.verdict ?? null;
  const practice = Boolean(q?.practice);
  const nCorrect = reveal.correct_teams?.length ?? null;
  return (
    <div className="mt-3 flex flex-col gap-3">
      <div
        className={clsx(
          'rounded-2xl p-5 text-center',
          verdict === 'correct' ? 'bg-[#1F8A3B]' : verdict === 'wrong' ? 'bg-[#C23A1E]' : 'bg-white/10',
        )}
        role="status"
        data-testid={verdict === 'correct' ? 'result-correct' : verdict === 'wrong' ? 'result-wrong' : 'result-none'}
      >
        <p className="text-[34px]" aria-hidden>
          {verdict === 'correct' ? '🎉' : verdict === 'wrong' ? '😢' : '🤐'}
        </p>
        <p className="mt-1 text-[24px] font-extrabold">
          {verdict === 'correct'
            ? practice
              ? '정답! (연습 문제)'
              : `정답! +${got}점`
            : verdict === 'wrong'
              ? '아쉽게도 오답'
              : submission
                ? '채점 중'
                : '제출하지 않았어요'}
        </p>
        {submission ? (
          <p className="mt-1 break-words text-[15px] text-white/80">우리 조 답: {answerText(q, submission.answer)}</p>
        ) : null}
        {verdict === 'correct' && !practice && award && reveal.speed ? (
          <p className="mt-1 text-[15px] font-extrabold text-[#FFE300]" data-testid="speed-result">
            ⚡ 정답 {award.rank}번째{bonus ? ' — 선착순 보너스!' : ''}
          </p>
        ) : null}
        {nCorrect !== null ? <p className="mt-1 text-[13px] text-white/70">{nCorrect}개 조가 맞혔어요</p> : null}
      </div>

      <div className="rounded-2xl bg-[#FFE300] p-5 text-[#1E1E1E]">
        <p className="text-[13px] font-bold">정답</p>
        <p className="mt-1 whitespace-pre-line text-[24px] font-extrabold leading-tight">{reveal.answer}</p>
        <p className="mt-3 text-[15px] leading-6">{reveal.explanation}</p>
      </div>

      {mineRank && !practice ? (
        <div className="rounded-2xl bg-white/10 px-4 py-3 text-center">
          <span className="text-[14px] text-white/70">우리 조 지금</span>{' '}
          <span className="text-[20px] font-extrabold text-[#FFE300]">
            {mineRank.rank}위 · {mineRank.score}점
          </span>
        </div>
      ) : null}
    </div>
  );
}

function FinalView({ ranked, me }: { ranked: ReturnType<typeof rankScores> | null; me: Me }) {
  const mine = ranked?.find((r) => r.team_no === me.team);
  return (
    <div className="flex flex-col pt-4">
      <div className="rounded-2xl bg-[#FFE300] p-6 text-center text-[#1E1E1E]">
        <p className="text-[40px]" aria-hidden>
          🏆
        </p>
        <p className="mt-1 text-[22px] font-extrabold">수고하셨습니다!</p>
        {mine ? (
          <p className="mt-2 text-[18px] font-bold">
            우리 {me.team}조 최종 <b className="text-[26px]">{mine.rank}위</b> · {mine.score}점
          </p>
        ) : null}
      </div>
      {ranked ? (
        <ol className="mt-4 space-y-1.5" aria-label="최종 순위">
          {ranked.map((r) => (
            <li
              key={r.team_no}
              className={clsx(
                'flex items-center gap-3 rounded-xl px-4 py-2.5',
                r.team_no === me.team ? 'bg-[#FFE300] text-[#1E1E1E]' : 'bg-white/10',
              )}
            >
              <span className="w-10 text-[17px] font-extrabold">{r.rank}위</span>
              <span className="text-[16px] font-bold">{r.team_no}조</span>
              <span className="ml-auto text-[16px] font-extrabold tabular-nums">{r.score}점</span>
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}
