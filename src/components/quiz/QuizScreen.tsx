'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import QRCode from 'qrcode';
import clsx from 'clsx';

import { cachedSnapshot, useClientValue } from '@/lib/clientStore';
import { getQuizDb, type QuizCounts } from '@/lib/quizDb';
import {
  fmtClock,
  keywordFor,
  remainingMs,
  screenPromptSize,
  useNow,
  useQuizState,
  useServerOffset,
} from '@/lib/quizClient';
import { QUIZ_QUESTIONS, questionLabel, stars } from '@/lib/quizQuestions';
import { readBoard, type QuizRevealTeam, type QuizState } from '@/lib/quizTypes';
import { NewVersionBanner } from './NewVersionBanner';
import { playSfx, unlockSound } from '@/lib/quizSound';

const W = 1920;
const H = 1080;

// ─── 16:9 캔버스를 창에 맞춰 축소·확대 ─────────────────────────

function subscribeResize(cb: () => void): () => void {
  window.addEventListener('resize', cb);
  return () => window.removeEventListener('resize', cb);
}
function getScale(): number {
  return Math.min(window.innerWidth / W, window.innerHeight / H);
}

/** 참가 주소 — NEXT_PUBLIC_QUIZ_URL(짧은 주소)이 있으면 그것, 없으면 이 사이트의 /quiz */
const joinUrl = cachedSnapshot(() => process.env.NEXT_PUBLIC_QUIZ_URL || `${window.location.origin}/quiz`);

/** 스크린 — 프로젝터 16:9 (Quiz v1.0). 정답은 운영자가 공개할 때 quiz_state.reveal로만 받는다 */
export function QuizScreen() {
  const scale = useSyncExternalStore(subscribeResize, getScale, () => 1);
  const state = useQuizState();
  const offset = useServerOffset();
  const now = useNow();
  const url = useClientValue(joinUrl.get, '');
  const counts = useCounts(state?.current_index ?? 0);
  const [qr, setQr] = useState('');

  useEffect(() => {
    if (!url) return;
    void QRCode.toString(url, { type: 'svg', margin: 1, color: { dark: '#1E1E1E', light: '#FFFFFF' } })
      .then(setQr)
      .catch(() => setQr(''));
  }, [url]);

  const soundOn = useScreenSounds(state, state ? remainingMs(state, now, offset) : null);

  return (
    <main className="fixed inset-0 overflow-hidden bg-[#1E1E1E]">
      <div className="absolute inset-x-0 top-0 z-50">
        <NewVersionBanner />
      </div>
      <SoundToggle on={soundOn.on} onToggle={soundOn.toggle} />
      <div
        className="absolute left-1/2 top-1/2 overflow-hidden bg-[#FFFBEA] text-[#1E1E1E]"
        style={{ width: W, height: H, transform: `translate(-50%, -50%) scale(${scale})` }}
      >
        {!state ? (
          <div className="flex h-full items-center justify-center text-[40px] text-[#8A8A8A]">연결하는 중…</div>
        ) : state.status === 'final' ? (
          <FinalScreen state={state} />
        ) : state.status === 'lobby' ? (
          <LobbyScreen state={state} qr={qr} url={url} counts={counts} />
        ) : state.status === 'revealed' && state.reveal ? (
          <RevealScreen state={state} />
        ) : (
          <QuestionScreen state={state} left={remainingMs(state, now, offset)} counts={counts} qr={qr} url={url} />
        )}
      </div>
    </main>
  );
}

// ─── 효과음 ─────────────────────────────────────────────────

const SOUND_KEY = 'eb:quiz:screen-sound';

/** 상태 전환·남은 시간에 맞춰 효과음을 낸다. 켜기 버튼을 한 번 눌러야 동작(브라우저 자동재생 정책) */
function useScreenSounds(state: QuizState | null, leftMs: number | null) {
  const [on, setOn] = useState(false);
  const prev = useRef<{ status: string; index: number; sec: number | null } | null>(null);

  useEffect(() => {
    if (!state) return;
    const sec = state.status === 'open' && leftMs !== null ? Math.ceil(leftMs / 1000) : null;
    const p = prev.current;
    prev.current = { status: state.status, index: state.current_index, sec };
    if (!on || !p) return;
    if (state.status !== p.status || state.current_index !== p.index) {
      if (state.status === 'open') playSfx('open');
      else if (state.status === 'closed' && p.status === 'open') playSfx('timeup');
      else if (state.status === 'revealed') playSfx(state.reveal?.winner ? 'reveal' : 'noWinner');
      else if (state.status === 'final') playSfx('final');
      else if (state.status === 'lobby') playSfx('transition');
      return;
    }
    if (state.status === 'open' && sec !== null && p.sec !== null && sec !== p.sec) {
      if (sec <= 0 && p.sec > 0) playSfx('timeup');
      else if (sec >= 1 && sec <= 3) playSfx('tickHigh');
      else if (sec >= 4 && sec <= 10) playSfx('tick');
    }
  }, [state, leftMs, on]);

  const toggle = () => {
    if (on) {
      setOn(false);
      try {
        window.localStorage.setItem(SOUND_KEY, '0');
      } catch {
        /* noop */
      }
      return;
    }
    if (unlockSound()) {
      setOn(true);
      playSfx('transition');
      try {
        window.localStorage.setItem(SOUND_KEY, '1');
      } catch {
        /* noop */
      }
    }
  };
  return { on, toggle };
}

function SoundToggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={clsx(
        'absolute left-2 top-2 z-50 rounded-full px-2.5 py-1 text-[12px] font-bold transition-opacity',
        on ? 'bg-white/10 text-white/40 opacity-40 hover:opacity-100' : 'bg-[#FFE300] text-[#1E1E1E]',
      )}
      data-testid="sound-toggle"
    >
      {on ? '🔊 효과음 켜짐' : '🔇 효과음 켜기'}
    </button>
  );
}

/** 입장 인원·제출 수 — 2초마다 (스크린은 개별 답을 받지 않는다) */
function useCounts(index: number): QuizCounts | null {
  const [counts, setCounts] = useState<QuizCounts | null>(null);
  useEffect(() => {
    let cancelled = false;
    const pull = () =>
      getQuizDb()
        .counts(index)
        .then((c) => {
          if (!cancelled) setCounts(c);
        })
        .catch(() => undefined);
    void pull();
    const t = setInterval(pull, 2000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [index]);
  return counts;
}

function Brand() {
  return (
    <div className="flex items-center gap-4">
      <span className="rounded-full bg-[#FFE300] px-5 py-2 text-[26px] font-black tracking-tight">SPEED QUIZ</span>
    </div>
  );
}

function LobbyScreen({
  state,
  qr,
  url,
  counts,
}: {
  state: QuizState;
  qr: string;
  url: string;
  counts: QuizCounts | null;
}) {
  const q = QUIZ_QUESTIONS[state.current_index];
  const started = state.current_index > 0 || Boolean(state.settings.opened && Object.keys(state.settings.opened).length);
  return (
    <div className="qz-fade flex h-full">
      <div className="flex flex-1 flex-col justify-center pl-[140px] pr-[60px]">
        <Brand />
        <h1 className="mt-10 text-[112px] font-black leading-[1.05] tracking-tight">
          {started ? '다음 문제' : '스피드 퀴즈'}
          <br />
          <span className="bg-[#FFE300] px-3">{started ? (q ? questionLabel(state.current_index) : '') : '곧 시작합니다'}</span>
        </h1>
        <p className="mt-10 text-[40px] font-semibold leading-snug text-[#3A3A3A]">
          휴대폰으로 QR을 찍고
          <br />
          <strong>테이블 번호</strong>를 눌러 참가하세요
        </p>
        <p className="mt-10 text-[34px] font-bold tabular-nums">
          입장 <span className="text-[64px] font-black">{counts?.participants ?? 0}</span>명
        </p>
      </div>
      <div className="flex w-[760px] flex-col items-center justify-center bg-white">
        <div
          className="h-[520px] w-[520px] [&>svg]:h-full [&>svg]:w-full"
          aria-label="참가 QR 코드"
          role="img"
          // qrcode 라이브러리가 만든 SVG 문자열
          dangerouslySetInnerHTML={{ __html: qr }}
        />
        <p className="mt-8 max-w-[640px] break-all text-center text-[32px] font-bold">{url.replace(/^https?:\/\//, '')}</p>
      </div>
    </div>
  );
}

function QuestionScreen({
  state,
  left,
  counts,
  qr,
  url,
}: {
  state: QuizState;
  left: number | null;
  counts: QuizCounts | null;
  qr: string;
  url: string;
}) {
  const q = QUIZ_QUESTIONS[state.current_index];
  if (!q) return null;
  const closed = state.status !== 'open' || left === 0;
  const urgent = !closed && left !== null && left <= 10_000;
  const keyword = state.display_mode === 'keyword';

  return (
    <div className="qz-fade flex h-full flex-col px-[100px] pb-[60px] pt-[56px]">
      <header className="flex items-center gap-6">
        <span className="rounded-2xl bg-[#1E1E1E] px-7 py-3 text-[44px] font-black text-white">
          {questionLabel(state.current_index)}
        </span>
        <span className="rounded-2xl bg-white px-6 py-3 text-[36px] font-bold">{q.category}</span>
        <span className="text-[44px] tracking-tight text-[#E0A800]">{stars(q.difficulty)}</span>
        <div
          className={clsx(
            'ml-auto flex h-[150px] min-w-[240px] items-center justify-center rounded-[36px] px-8 font-black tabular-nums transition-colors',
            closed ? 'bg-[#DADADA] text-[#6B6B6B]' : urgent ? 'qz-pulse bg-[#FF5A3C] text-white' : 'bg-[#FFE300]',
          )}
          role="timer"
          aria-label="남은 시간"
        >
          <span className={closed ? 'text-[72px]' : 'text-[112px]'}>
            {closed ? '마감' : left !== null ? fmtClock(left) : ''}
          </span>
        </div>
      </header>

      <section className="flex flex-1 items-center">
        {keyword ? (
          <p className="w-full text-center text-[150px] font-black leading-tight tracking-tight">
            {keywordFor(state, state.current_index)}
          </p>
        ) : (
          <p
            className="w-full whitespace-pre-line font-bold leading-[1.45]"
            style={{ fontSize: screenPromptSize(q.prompt) }}
          >
            {q.prompt}
          </p>
        )}
      </section>

      <footer className="flex items-end gap-8">
        <p className="text-[40px] font-bold tabular-nums">
          제출 <span className="text-[72px] font-black">{counts?.submissions ?? 0}</span>명
          <span className="ml-4 text-[30px] font-semibold text-[#8A8A8A]">/ {counts?.participants ?? 0}명</span>
        </p>
        {counts?.live && (counts.live.correct || counts.live.wrong || counts.live.review) ? (
          <p className="flex items-end gap-6 text-[36px] font-bold tabular-nums" data-testid="live-counts">
            <span className="text-[#1F8A3B]">
              정답 <span className="text-[60px] font-black">{counts.live.correct}</span>
            </span>
            <span className="text-[#C23A1E]">
              오답 <span className="text-[60px] font-black">{counts.live.wrong}</span>
            </span>
            {counts.live.review ? (
              <span className="text-[#8A6A00]">
                채점 중 <span className="text-[60px] font-black">{counts.live.review}</span>
              </span>
            ) : null}
          </p>
        ) : null}
        <div className="ml-auto flex items-center gap-4 text-[24px] text-[#6B6B6B]">
          <span>{url.replace(/^https?:\/\//, '')}</span>
          <div
            className="h-[120px] w-[120px] bg-white p-1 [&>svg]:h-full [&>svg]:w-full"
            aria-hidden
            dangerouslySetInnerHTML={{ __html: qr }}
          />
        </div>
      </footer>
    </div>
  );
}

function RevealScreen({ state }: { state: QuizState }) {
  const reveal = state.reveal!;
  const q = QUIZ_QUESTIONS[reveal.index];
  const teams = reveal.teams?.length ? reveal.teams : null;
  const nCorrect = reveal.correct_times?.length ?? 0;
  return (
    <div className={clsx('qz-fade flex h-full flex-col px-[90px]', teams ? 'pb-[36px] pt-[40px]' : 'pb-[70px] pt-[56px]')}>
      <header className="flex items-center gap-6">
        <span className="rounded-2xl bg-[#1E1E1E] px-7 py-3 text-[44px] font-black text-white">
          {questionLabel(reveal.index)}
        </span>
        {q ? <span className="rounded-2xl bg-white px-6 py-3 text-[36px] font-bold">{q.category}</span> : null}
        {reveal.correct_times ? (
          <span className="rounded-2xl bg-[#E3F6E8] px-6 py-3 text-[36px] font-black text-[#1F8A3B]">정답자 {nCorrect}명</span>
        ) : null}
        <span className="ml-auto rounded-2xl bg-[#FFE300] px-7 py-3 text-[44px] font-black">정답 공개</span>
      </header>

      <div className={clsx('grid min-h-0 flex-1 gap-10', teams ? 'mt-7 grid-cols-[1fr_520px]' : 'mt-12 grid-cols-[1fr_620px]')}>
        <div className="flex min-h-0 flex-col overflow-hidden">
          <p className="text-[30px] font-bold text-[#6B6B6B]">정답</p>
          <p
            className={clsx(
              'mt-2 whitespace-pre-line font-black leading-[1.1] tracking-tight',
              teams ? 'text-[68px]' : 'text-[88px]',
            )}
          >
            {reveal.answer}
          </p>
          <p className={clsx('leading-[1.45] text-[#2A2A2A]', teams ? 'mt-6 text-[32px]' : 'mt-10 text-[40px]')}>
            {reveal.explanation}
          </p>
        </div>

        <div className="qz-pop flex flex-col items-center justify-center rounded-[48px] bg-[#1E1E1E] px-10 text-center text-white">
          {reveal.winner ? (
            <>
              <p className={clsx('leading-none', teams ? 'text-[80px]' : 'text-[110px]')} aria-hidden>
                🎉
              </p>
              <p className="mt-5 text-[34px] font-bold text-[#FFE300]">{q?.practice ? '연습 문제 첫 정답' : '첫 정답자'}</p>
              <p className={clsx('mt-3 break-all font-black leading-tight', teams ? 'text-[68px]' : 'text-[80px]')}>
                {reveal.winner.name}
              </p>
              <p className="mt-3 text-[40px] font-bold">{reveal.winner.table_no}번 테이블</p>
            </>
          ) : (
            <>
              <p className="text-[80px] leading-none" aria-hidden>
                🤔
              </p>
              <p className="mt-6 text-[46px] font-black">{nCorrect ? `정답자 ${nCorrect}명` : '정답자가 없습니다'}</p>
              {nCorrect ? (
                <p className="mt-4 text-[30px] font-bold text-[#BDBDBD]">모두 이미 상품을 받아 이번 상품은 없습니다</p>
              ) : null}
            </>
          )}
        </div>
      </div>

      {teams ? <TeamStrip teams={teams} /> : null}
    </div>
  );
}

/** 정답 공개 화면 하단 — 조별 누적 정답 현황(순위순) + 이번 문제에서 얻은 정답 */
function TeamStrip({ teams }: { teams: QuizRevealTeam[] }) {
  const cols = teams.length <= 10 ? teams.length : teams.length <= 30 ? 10 : Math.ceil(teams.length / 3);
  return (
    <section className="mt-7" data-testid="team-strip">
      <p className="mb-2 text-[28px] font-black">
        조별 정답 현황 <span className="text-[22px] font-bold text-[#8A8A8A]">누적 · 초록 숫자는 이번 문제</span>
      </p>
      <ol className="grid gap-2" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
        {teams.map((t) => (
          <li
            key={t.table_no}
            className={clsx(
              'flex items-center gap-2 rounded-2xl px-3 py-2',
              t.rank === 1 ? 'bg-[#FFE300]' : t.rank <= 3 ? 'bg-[#FFF3B0]' : 'bg-white',
            )}
          >
            <span className="w-[44px] shrink-0 text-[22px] font-bold text-[#6B6B6B]">{t.rank}위</span>
            <span className="text-[30px] font-black">{t.table_no}번</span>
            <span className="ml-auto text-right leading-none">
              <span className="block text-[30px] font-black tabular-nums">{t.correct}</span>
              {t.gained ? <span className="block text-[18px] font-bold text-[#1F8A3B]">+{t.gained}</span> : null}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function FinalScreen({ state }: { state: QuizState }) {
  const { people, teams } = readBoard(state.leaderboard);
  const medals = ['🥇', '🥈', '🥉'];
  const both = Boolean(people?.length && teams?.length);
  const has = Boolean(people?.length || teams?.length);
  return (
    <div className="qz-fade flex h-full flex-col items-center justify-center px-[100px]">
      <Brand />
      <h1 className={clsx('font-black tracking-tight', has ? 'mt-6 text-[88px]' : 'mt-8 text-[110px]')}>
        {has ? '최종 순위' : '수고하셨습니다!'}
      </h1>
      {has ? (
        <div className={clsx('mt-10 grid w-full max-w-[1700px] gap-12', both ? 'grid-cols-2' : 'grid-cols-1')}>
          {people?.length ? (
            <section>
              {both ? <h2 className="mb-5 text-[44px] font-black">개인</h2> : null}
              <ol className="space-y-5">
                {people.map((r) => (
                  <li
                    key={r.participant_id}
                    className={clsx('flex items-center gap-8 rounded-[36px] px-10 py-6', r.rank === 1 ? 'bg-[#FFE300]' : 'bg-white')}
                  >
                    <span className="text-[72px] leading-none">{medals[r.rank - 1] ?? `${r.rank}`}</span>
                    <span className="truncate text-[60px] font-black">{r.name}</span>
                    <span className="shrink-0 text-[36px] font-bold text-[#5B5B5B]">{r.table_no}번</span>
                    <span className="ml-auto shrink-0 text-[48px] font-black">{r.correct}문제</span>
                  </li>
                ))}
              </ol>
            </section>
          ) : null}
          {teams?.length ? (
            <section>
              {both ? <h2 className="mb-5 text-[44px] font-black">조별</h2> : null}
              <ol className={clsx(both ? 'space-y-3' : 'grid grid-cols-2 gap-x-10 gap-y-4')}>
                {teams.slice(0, both ? 5 : 10).map((t) => (
                  <li
                    key={t.table_no}
                    className={clsx(
                      'flex items-center gap-6 rounded-[28px] px-8',
                      both ? 'py-4' : 'py-5',
                      t.rank === 1 ? 'bg-[#FFE300]' : 'bg-white',
                    )}
                  >
                    <span className="w-[90px] text-[52px] font-black leading-none">{medals[t.rank - 1] ?? `${t.rank}`}</span>
                    <span className="text-[52px] font-black">{t.table_no}번 테이블</span>
                    <span className="ml-auto text-right">
                      <span className="block text-[44px] font-black leading-none">{t.correct}개</span>
                      <span className="block text-[24px] font-bold text-[#6B6B6B]">1인당 {t.avg.toFixed(1)}</span>
                    </span>
                  </li>
                ))}
              </ol>
            </section>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
