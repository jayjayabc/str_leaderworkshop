'use client';

// 송출 화면 — 프로젝터 16:9 (Quiz v2.0 단체전, 퀴즈쇼 톤)
//   대기: QR + 입장 현황(+ 진행 중이면 점수판) · 문제: 문제·이미지·타이머·제출 조 수
//   공개: 정답·해설·맞힌 조 + 점수판 · 종료: 최종 순위
//   정답은 운영자가 공개할 때 quiz_state.reveal로만 받는다.

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import QRCode from 'qrcode';
import clsx from 'clsx';

import { cachedSnapshot, useClientValue } from '@/lib/clientStore';
import { getQuizDb, type QuizCounts } from '@/lib/quizDb';
import {
  fmtClock,
  keywordFor,
  pointsFor,
  rankScores,
  remainingMs,
  screenPromptSize,
  speedLabel,
  speedRuleFor,
  useNow,
  usePreloadImages,
  useQuizState,
  useScoreboard,
  useServerOffset,
} from '@/lib/quizClient';
import { QUIZ_QUESTIONS, QUIZ_TEAMS, questionLabel } from '@/lib/quizQuestions';
import type { QuizState } from '@/lib/quizTypes';
import { NewVersionBanner } from './NewVersionBanner';
import { playSfx, setAmbient, unlockSound } from '@/lib/quizSound';

const W = 1920;
const H = 1080;

type Ranked = ReturnType<typeof rankScores>;

function subscribeResize(cb: () => void): () => void {
  window.addEventListener('resize', cb);
  return () => window.removeEventListener('resize', cb);
}
function getScale(): number {
  return Math.min(window.innerWidth / W, window.innerHeight / H);
}

/** 참가 주소 — NEXT_PUBLIC_QUIZ_URL(짧은 주소)이 있으면 그것, 없으면 이 사이트의 /quiz */
const joinUrl = cachedSnapshot(() => process.env.NEXT_PUBLIC_QUIZ_URL || `${window.location.origin}/quiz`);

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
    void QRCode.toString(url, { type: 'svg', margin: 1, color: { dark: '#0E0F13', light: '#FFFFFF' } })
      .then(setQr)
      .catch(() => setQr(''));
  }, [url]);

  const scoreStamp = state ? `${state.status}:${state.current_index}:${state.status === 'revealed' ? state.updated_at : ''}` : '';
  const board = useScoreboard(scoreStamp, state?.status === 'lobby' ? 5000 : 0);
  const ranked = useMemo(() => (board ? rankScores(board) : null), [board]);

  const left = state ? remainingMs(state, now, offset) : null;
  const sound = useScreenSounds(state, left, counts?.submissions ?? null);

  return (
    <main className="fixed inset-0 overflow-hidden bg-black">
      <div
        className="qz-stage absolute left-1/2 top-1/2 z-0 overflow-hidden text-white"
        style={{ width: W, height: H, transform: `translate(-50%, -50%) scale(${scale})` }}
      >
        {!state ? (
          <div className="flex h-full items-center justify-center text-[40px] text-white/40">연결하는 중…</div>
        ) : state.status === 'final' ? (
          <FinalScreen ranked={ranked} />
        ) : state.status === 'lobby' ? (
          <LobbyScreen state={state} qr={qr} url={url} counts={counts} ranked={ranked} />
        ) : state.status === 'revealed' && state.reveal ? (
          <RevealScreen state={state} ranked={ranked} />
        ) : (
          <QuestionScreen state={state} left={left} counts={counts} qr={qr} />
        )}
      </div>
      <div className="absolute inset-x-0 top-0 z-50">
        <NewVersionBanner />
      </div>
      <SoundToggle on={sound.on} onToggle={sound.toggle} />
    </main>
  );
}

// ─── 효과음 ─────────────────────────────────────────────────

/** 상태 전환·남은 시간·제출에 맞춰 효과음. 켜기 버튼을 한 번 눌러야 동작(브라우저 자동재생 정책) */
function useScreenSounds(state: QuizState | null, leftMs: number | null, submissions: number | null) {
  const [on, setOn] = useState(false);
  const prev = useRef<{ status: string; index: number; sec: number | null; subs: number | null } | null>(null);

  useEffect(() => {
    if (!state) return;
    const sec = state.status === 'open' && leftMs !== null ? Math.ceil(leftMs / 1000) : null;
    const p = prev.current;
    prev.current = { status: state.status, index: state.current_index, sec, subs: submissions };
    if (!on || !p) return;
    if (state.status !== p.status || state.current_index !== p.index) {
      setAmbient(state.status === 'open');
      if (state.status === 'open') playSfx('open');
      else if (state.status === 'closed' && p.status === 'open') playSfx('timeup');
      else if (state.status === 'revealed') playSfx(state.reveal?.correct_teams?.length ? 'reveal' : 'revealNone');
      else if (state.status === 'final') playSfx('final');
      else if (state.status === 'lobby') playSfx('transition');
      return;
    }
    if (state.status === 'open') {
      if (submissions !== null && p.subs !== null && submissions > p.subs) playSfx('submit');
      if (sec !== null && p.sec !== null && sec !== p.sec) {
        if (sec <= 0 && p.sec > 0) {
          setAmbient(false);
          playSfx('timeup');
        } else if (sec >= 1 && sec <= 5) playSfx('tickHigh');
        else if (sec >= 6 && sec <= 10) playSfx('tick');
      }
    }
  }, [state, leftMs, submissions, on]);

  const toggle = () => {
    if (on) {
      setAmbient(false);
      setOn(false);
      return;
    }
    if (unlockSound()) {
      setOn(true);
      playSfx('transition');
      if (state?.status === 'open') setAmbient(true);
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

/** 입장 인원·제출 조 수 — 2초마다 (스크린은 개별 답을 받지 않는다) */
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

// ─── 공통 조각 ───────────────────────────────────────────────

function Brand({ small }: { small?: boolean }) {
  return (
    <div className="flex items-center gap-4">
      <span
        className={clsx(
          'rounded-full bg-[#FFE300] font-black tracking-tight text-[#0E0F13]',
          small ? 'px-4 py-1.5 text-[22px]' : 'px-5 py-2 text-[26px]',
        )}
      >
        SPEED QUIZ
      </span>
      <span className={clsx('font-bold tracking-[0.2em] text-white/50', small ? 'text-[18px]' : 'text-[22px]')}>TEAM BATTLE</span>
    </div>
  );
}

function Header({ state, right }: { state: QuizState; right?: React.ReactNode }) {
  const index = state.current_index;
  const q = QUIZ_QUESTIONS[index];
  return (
    <header className="flex items-center gap-5">
      <span className="rounded-2xl bg-white px-7 py-3 text-[44px] font-black text-[#0E0F13]">{questionLabel(index)}</span>
      {q ? <span className="rounded-2xl bg-white/10 px-6 py-3 text-[34px] font-bold">{q.category}</span> : null}
      {q && !q.practice ? (
        <span className="rounded-2xl border-2 border-[#FFE300] px-6 py-2.5 text-[34px] font-black text-[#FFE300]">
          {pointsFor(state, index)}점
        </span>
      ) : null}
      {q && !q.practice && speedRuleFor(state, index) ? (
        <span className="qz-pulse rounded-2xl bg-[#FFE300] px-5 py-2.5 text-[30px] font-black text-[#0E0F13]" data-testid="screen-speed">
          ⚡ 선착순 {speedLabel(speedRuleFor(state, index))}
        </span>
      ) : null}
      <div className="ml-auto">{right}</div>
    </header>
  );
}

/**
 * 점수판 — 순위순 줄 목록을 열 단위(위→아래, 왼→오른쪽)로 채운다.
 * 칸 폭이 고정(순위·조·점수)이라 세 자리 점수·30조도 깨지지 않는다. 막대는 남는 폭만 쓴다.
 */
const GRID_SIZE = {
  lg: { font: 30, row: 60, gap: 8 },
  md: { font: 24, row: 46, gap: 6 },
  sm: { font: 21, row: 38, gap: 5 },
} as const;

function ScoreGrid({
  ranked,
  highlight,
  gained,
  cols,
  size,
}: {
  ranked: Ranked;
  highlight?: Set<number>;
  gained?: Map<number, number>;
  cols: number;
  size: keyof typeof GRID_SIZE;
}) {
  const z = GRID_SIZE[size];
  const rows = Math.max(1, Math.ceil(ranked.length / cols));
  const max = Math.max(1, ...ranked.map((r) => r.score));
  return (
    <ol
      className="grid"
      style={{
        gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
        gridTemplateRows: `repeat(${rows}, ${z.row}px)`,
        gridAutoFlow: 'column',
        columnGap: z.gap * 2,
        rowGap: z.gap,
        fontSize: z.font,
      }}
      data-testid="score-grid"
    >
      {ranked.map((r) => {
        const hit = highlight?.has(r.team_no);
        const top = r.rank === 1 && r.score > 0;
        const plus = hit ? gained?.get(r.team_no) : undefined;
        return (
          <li
            key={r.team_no}
            className={clsx(
              'flex min-w-0 items-center gap-[0.4em] overflow-hidden rounded-[0.45em] px-[0.5em] leading-none',
              top ? 'bg-[#FFE300] text-[#0E0F13]' : hit ? 'bg-[#1F8A3B] text-white' : 'bg-white/[0.07] text-white',
              hit && 'qz-pop',
            )}
            data-testid="score-row"
          >
            <span className="w-[1.6em] shrink-0 text-right text-[0.8em] font-bold tabular-nums opacity-60">{r.rank}</span>
            <span className="w-[2.6em] shrink-0 whitespace-nowrap font-black tabular-nums">{r.team_no}조</span>
            <span className={clsx('h-[0.32em] min-w-0 flex-1 overflow-hidden rounded-full', top ? 'bg-black/15' : 'bg-white/10')} aria-hidden>
              <span className={clsx('block h-full rounded-full', top ? 'bg-black/60' : 'bg-[#FFE300]/80')} style={{ width: `${(r.score / max) * 100}%` }} />
            </span>
            {plus ? <span className="shrink-0 whitespace-nowrap text-[0.72em] font-black tabular-nums text-[#BDF5C6]">+{plus}</span> : null}
            <span className="w-[2.8em] shrink-0 text-right font-black tabular-nums">{r.score}</span>
          </li>
        );
      })}
    </ol>
  );
}

// ─── 대기 ───────────────────────────────────────────────────

function LobbyScreen({
  state,
  qr,
  url,
  counts,
  ranked,
}: {
  state: QuizState;
  qr: string;
  url: string;
  counts: QuizCounts | null;
  ranked: Ranked | null;
}) {
  const started = Boolean(state.settings.opened && Object.keys(state.settings.opened).some((k) => Number(k) > 0));
  const nextQ = QUIZ_QUESTIONS[state.current_index];
  const nextSpeed = nextQ && !nextQ.practice ? speedRuleFor(state, state.current_index) : null;
  usePreloadImages(nextQ?.images);
  const stats = (
    <div className="flex gap-12 text-[30px] font-bold tabular-nums text-white/80">
      <span>
        입장 <b className="text-[56px] font-black text-white">{counts?.participants ?? 0}</b>명
      </span>
      <span>
        참여 <b className="text-[56px] font-black text-white">{counts?.teams ?? 0}</b>조
      </span>
      <span>
        답변자 준비 <b className="text-[56px] font-black text-[#FFE300]">{counts?.answerers ?? 0}</b>/{QUIZ_TEAMS}
      </span>
    </div>
  );

  if (started && ranked) {
    return (
      <div className="qz-fade flex h-full flex-col px-[90px] pb-[50px] pt-[50px]">
        <div className="flex items-end gap-8">
          <div>
            <Brand small />
            <h1 className="mt-5 text-[84px] font-black leading-none tracking-tight">
              다음 <span className="text-[#FFE300]">{questionLabel(state.current_index)}</span>
              {nextQ && !nextQ.practice ? (
                <span className="ml-6 align-middle text-[44px] font-black text-white/80">{pointsFor(state, state.current_index)}점</span>
              ) : null}
            </h1>
            {nextSpeed ? (
              <p className="qz-pulse mt-4 inline-block rounded-2xl bg-[#FFE300] px-5 py-2 text-[34px] font-black text-[#0E0F13]">
                ⚡ 선착순 문제 — {speedLabel(nextSpeed)}
              </p>
            ) : null}
          </div>
          <div className="ml-auto flex items-center gap-6">
            <p className="text-right text-[24px] font-semibold leading-snug text-white/60">
              늦게 오신 분은
              <br />
              QR로 입장하세요
            </p>
            <div className="h-[170px] w-[170px] rounded-xl bg-white p-2 [&>svg]:h-full [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: qr }} />
          </div>
        </div>
        <p className="mt-8 text-[30px] font-bold text-white/60">현재 점수</p>
        <div className="mt-4">
          <ScoreGrid ranked={ranked} cols={3} size="lg" />
        </div>
      </div>
    );
  }

  return (
    <div className="qz-fade flex h-full">
      <div className="flex flex-1 flex-col justify-center pl-[130px] pr-[60px]">
        <Brand />
        <h1 className="mt-10 text-[120px] font-black leading-[1.02] tracking-tight">
          스피드 퀴즈
          <br />
          <span className="text-[#FFE300]">단체전</span>
        </h1>
        <ol className="mt-10 space-y-3 text-[38px] font-semibold leading-snug text-white/85">
          <li>
            <b className="text-[#FFE300]">1</b> 휴대폰으로 QR을 찍고 <b>우리 조</b>를 누르세요
          </li>
          <li>
            <b className="text-[#FFE300]">2</b> 조마다 <b>답변자 1명</b>, 나머지는 <b>관전자</b>
          </li>
          <li>
            <b className="text-[#FFE300]">3</b> 함께 풀고, 답변자가 우리 조 답을 냅니다
          </li>
        </ol>
        <div className="mt-12">{stats}</div>
      </div>
      <div className="flex w-[720px] flex-col items-center justify-center bg-white text-[#0E0F13]">
        <div className="h-[500px] w-[500px] [&>svg]:h-full [&>svg]:w-full" aria-label="참가 QR 코드" role="img" dangerouslySetInnerHTML={{ __html: qr }} />
        <p className="mt-8 max-w-[600px] break-all text-center text-[30px] font-bold">{url.replace(/^https?:\/\//, '')}</p>
      </div>
    </div>
  );
}

// ─── 문제 ───────────────────────────────────────────────────

function Timer({ state, left }: { state: QuizState; left: number | null }) {
  const closed = state.status !== 'open' || left === 0;
  const urgent = !closed && left !== null && left <= 10_000;
  const total = state.duration_sec * 1000;
  const frac = !closed && left !== null && total > 0 ? Math.max(0, Math.min(1, left / total)) : 0;
  return (
    <div
      className={clsx(
        'relative flex h-[140px] min-w-[250px] items-center justify-center overflow-hidden rounded-[36px] px-8 font-black tabular-nums',
        closed ? 'bg-white/10 text-white/50' : urgent ? 'qz-pulse bg-[#FF5A3C] text-white' : 'bg-[#FFE300] text-[#0E0F13]',
      )}
      role="timer"
      aria-label="남은 시간"
    >
      {!closed ? <span className="absolute inset-y-0 left-0 bg-black/10" style={{ width: `${(1 - frac) * 100}%` }} aria-hidden /> : null}
      <span className={clsx('relative', closed ? 'text-[64px]' : 'text-[104px]')}>
        {closed ? '마감' : left !== null ? fmtClock(left) : ''}
      </span>
    </div>
  );
}

function QuestionScreen({
  state,
  left,
  counts,
  qr,
}: {
  state: QuizState;
  left: number | null;
  counts: QuizCounts | null;
  qr: string;
}) {
  const q = QUIZ_QUESTIONS[state.current_index];
  if (!q) return null;
  const keyword = state.display_mode === 'keyword';
  const teamsIn = Math.max(counts?.answerers ?? 0, counts?.submissions ?? 0);
  const submitted = counts?.submissions ?? 0;
  const pct = teamsIn > 0 ? Math.min(100, (submitted / teamsIn) * 100) : 0;
  const images = keyword ? [] : (q.images ?? []);
  const below = images.length === 1 && q.imageLayout === 'below';
  const hasImage = images.length === 1 && !below;
  const gallery = images.length > 1 || below;
  const prompt = gallery && q.screenPrompt ? q.screenPrompt : q.prompt;
  return (
    <div className="qz-fade flex h-full flex-col px-[90px] pb-[50px] pt-[50px]">
      <Header state={state} right={<Timer state={state} left={left} />} />

      <section
        className={clsx(
          'mt-8 flex min-h-0 flex-1',
          gallery ? 'flex-col gap-5' : 'gap-12',
          hasImage ? 'items-stretch' : gallery ? '' : 'items-center',
        )}
      >
        <div className={clsx('flex min-w-0 flex-col justify-center', hasImage ? 'min-h-0 w-[52%] overflow-hidden' : 'w-full')}>
          {keyword ? (
            <p className="w-full text-center text-[150px] font-black leading-tight tracking-tight">{keywordFor(state, state.current_index)}</p>
          ) : (
            <>
              <p
                className="whitespace-pre-line font-bold leading-[1.45]"
                style={{
                  fontSize: gallery
                    ? 44
                    : hasImage && q.choices
                      ? Math.min(46, Math.round(screenPromptSize(prompt) * 0.82))
                      : Math.round(screenPromptSize(prompt) * (hasImage ? 0.82 : 1)),
                }}
              >
                {prompt}
              </p>
              {q.choices ? (
                <ol
                  className={clsx(
                    'grid',
                    hasImage && q.choices.length > 3 ? 'mt-6 grid-cols-2 gap-3' : 'mt-8 gap-4',
                    !hasImage && q.choices.length > 3 ? 'grid-cols-2' : !(hasImage && q.choices.length > 3) && 'grid-cols-1',
                  )}
                >
                  {q.choices.map((c, i) => (
                    <li
                      key={c}
                      className={clsx(
                        'flex items-center rounded-3xl bg-white/[0.08] font-bold',
                        hasImage && q.choices!.length > 3 ? 'gap-4 px-5 py-3 text-[34px]' : 'gap-5 px-7 py-4 text-[40px]',
                      )}
                    >
                      <span className="flex h-[56px] w-[56px] shrink-0 items-center justify-center rounded-full bg-[#FFE300] text-[32px] font-black text-[#0E0F13]">
                        {i + 1}
                      </span>
                      {c}
                    </li>
                  ))}
                </ol>
              ) : null}
            </>
          )}
        </div>
        {hasImage ? (
          <div className="flex min-w-0 flex-1 items-center justify-center rounded-[32px] bg-white p-4">
            <QuestionImage key={images[0]} src={images[0]} />
          </div>
        ) : null}
        {gallery ? <ImageGallery images={images} captions={q.imageCaptions} /> : null}
      </section>

      <footer className="mt-6 flex items-end gap-10">
        <div className="w-[760px]">
          <p className="text-[34px] font-bold tabular-nums">
            제출 <span className="text-[64px] font-black text-[#FFE300]">{submitted}</span>
            <span className="text-[34px] text-white/60"> / {teamsIn || '—'}조</span>
          </p>
          <div className="mt-2 h-4 overflow-hidden rounded-full bg-white/10">
            <div className="h-full rounded-full bg-[#FFE300] transition-[width] duration-500" style={{ width: `${pct}%` }} />
          </div>
        </div>
        {counts?.live && (counts.live.correct || counts.live.wrong || counts.live.review) ? (
          <p className="flex items-end gap-6 text-[32px] font-bold tabular-nums" data-testid="live-counts">
            <span className="text-[#7CE38B]">
              정답 <span className="text-[56px] font-black">{counts.live.correct}</span>
            </span>
            <span className="text-[#FF8A73]">
              오답 <span className="text-[56px] font-black">{counts.live.wrong}</span>
            </span>
            {counts.live.review ? (
              <span className="text-[#FFD66B]">
                채점 중 <span className="text-[56px] font-black">{counts.live.review}</span>
              </span>
            ) : null}
          </p>
        ) : null}
        <div className="ml-auto h-[110px] w-[110px] rounded-lg bg-white p-1 [&>svg]:h-full [&>svg]:w-full" aria-hidden dangerouslySetInnerHTML={{ __html: qr }} />
      </footer>
    </div>
  );
}

/** 여러 장 — 가로로 나란히, 높이를 맞추고(가로세로 비율만큼 폭을 나눔) 아래에 설명 */
function ImageGallery({ images, captions }: { images: string[]; captions?: string[] }) {
  const [ratios, setRatios] = useState<Record<string, number>>({});
  return (
    <div className="flex min-h-0 flex-1 items-stretch justify-center gap-4" data-testid="screen-gallery">
      {images.map((src, i) => (
        <figure
          key={src}
          className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[24px] bg-white"
          style={{ flex: `${ratios[src] ?? 0.7} 1 0` }}
        >
          <div className="relative min-h-0 flex-1 bg-[#111]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={src}
              alt={`문제 이미지 ${i + 1}`}
              onLoad={(e) => {
                const im = e.currentTarget;
                if (im.naturalWidth && im.naturalHeight) setRatios((r) => ({ ...r, [src]: im.naturalWidth / im.naturalHeight }));
              }}
              className="absolute inset-0 h-full w-full object-contain"
            />
          </div>
          {captions?.[i] ? (
            <figcaption className="shrink-0 truncate bg-white px-4 py-2 text-center text-[28px] font-black text-[#0E0F13]">{captions[i]}</figcaption>
          ) : null}
        </figure>
      ))}
    </div>
  );
}

function QuestionImage({ src }: { src: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <p className="text-[32px] font-bold text-[#8A8A8A]">이미지 준비 중</p>;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="문제 이미지" onError={() => setFailed(true)} className="max-h-full max-w-full object-contain" />
  );
}

// ─── 공개 ───────────────────────────────────────────────────

function RevealScreen({ state, ranked }: { state: QuizState; ranked: Ranked | null }) {
  const reveal = state.reveal!;
  const q = QUIZ_QUESTIONS[reveal.index];
  const correct = reveal.correct_teams ?? [];
  const hits = new Set(correct);
  const points = reveal.points ?? pointsFor(state, reveal.index);
  const practice = Boolean(q?.practice);
  const awards = reveal.awards ?? {};
  const speed = reveal.speed ?? null;
  const gained = new Map<number, number>(correct.map((t) => [t, awards[String(t)]?.pts ?? points]));
  // 선착순이면 정답 순서대로, 아니면 조 번호순
  const chips = speed
    ? [...correct].sort((a, b) => (awards[String(a)]?.rank ?? 99) - (awards[String(b)]?.rank ?? 99))
    : [...correct].sort((a, b) => a - b);
  const chipFont = chips.length <= 8 ? 30 : chips.length <= 16 ? 24 : chips.length <= 22 ? 20 : 16;
  return (
    <div className="qz-fade flex h-full flex-col px-[90px] pb-[40px] pt-[44px]">
      <Header state={state} right={<span className="rounded-2xl bg-[#FFE300] px-7 py-3 text-[42px] font-black text-[#0E0F13]">정답 공개</span>} />

      <div className="mt-7 grid min-h-0 flex-1 grid-cols-[1fr_560px] gap-10">
        <div className="flex min-h-0 flex-col overflow-hidden">
          <p className="text-[28px] font-bold text-white/50">정답</p>
          <p className="qz-pop mt-1 whitespace-pre-line text-[76px] font-black leading-[1.08] tracking-tight text-[#FFE300]">{reveal.answer}</p>
          <p className="mt-6 text-[32px] leading-[1.5] text-white/85">{reveal.explanation}</p>
        </div>
        <div className="qz-pop flex min-h-0 flex-col overflow-hidden rounded-[40px] bg-white/[0.07] p-8">
          <p className="text-[30px] font-bold text-white/60">맞힌 조</p>
          <p className="mt-1 text-[72px] font-black leading-none">
            {correct.length}
            <span className="text-[40px] text-white/60">개 조</span>
          </p>
          {!practice && correct.length ? (
            <p className="mt-2 text-[28px] font-bold text-[#7CE38B]">{speed ? `⚡ 선착순 ${speedLabel(speed)} · 기본 +${points}점` : `각 +${points}점`}</p>
          ) : null}
          <div className="mt-5 flex min-h-0 flex-wrap content-start gap-2 overflow-hidden" style={{ fontSize: chipFont }} data-testid="correct-chips">
            {chips.length ? (
              chips.map((t) => {
                const a = awards[String(t)];
                const bonus = speed && a && a.pts !== points;
                return (
                  <span
                    key={t}
                    className={clsx(
                      'whitespace-nowrap rounded-[0.4em] px-[0.45em] py-[0.15em] font-black',
                      bonus ? 'bg-[#FFE300] text-[#0E0F13]' : 'bg-[#1F8A3B]',
                    )}
                  >
                    {speed && a ? <span className="mr-[0.25em] text-[0.7em] opacity-70">{a.rank}.</span> : null}
                    {t}조{bonus ? <span className="ml-[0.25em] text-[0.7em]">+{a.pts}</span> : null}
                  </span>
                );
              })
            ) : (
              <span className="text-[34px] font-bold text-white/50">이번엔 아무도 못 맞혔어요</span>
            )}
          </div>
        </div>
      </div>

      {ranked && !practice ? (
        <section className="mt-6">
          <p className="mb-2 text-[24px] font-bold text-white/50">점수판</p>
          <ScoreGrid ranked={ranked} highlight={hits} gained={gained} cols={5} size="md" />
        </section>
      ) : null}
    </div>
  );
}

// ─── 종료 ───────────────────────────────────────────────────

function FinalScreen({ ranked }: { ranked: Ranked | null }) {
  const medals = ['🥇', '🥈', '🥉'];
  const top = (ranked ?? []).slice(0, 3);
  const rest = (ranked ?? []).slice(3);
  return (
    <div className="qz-fade flex h-full flex-col items-center px-[90px] pt-[50px]">
      <Brand />
      <h1 className="mt-3 text-[80px] font-black leading-tight tracking-tight">최종 순위</h1>
      <div className="mt-6 grid w-full max-w-[1500px] grid-cols-3 items-end gap-8">
        {[1, 0, 2].map((i) => {
          const r = top[i];
          if (!r) return <div key={i} />;
          return (
            <div
              key={r.team_no}
              className={clsx(
                'qz-pop flex flex-col items-center rounded-[40px] px-6 pb-8 pt-6',
                i === 0 ? 'bg-[#FFE300] text-[#0E0F13]' : 'bg-white/[0.08]',
              )}
              style={{ minHeight: i === 0 ? 330 : 270 }}
            >
              <span className="text-[88px] leading-none">{medals[r.rank - 1] ?? r.rank}</span>
              <span className="mt-2 text-[84px] font-black leading-none">{r.team_no}조</span>
              <span className="mt-3 text-[54px] font-black tabular-nums">{r.score}점</span>
            </div>
          );
        })}
      </div>
      {rest.length ? (
        <div className="mt-6 w-full max-w-[1740px]">
          <ScoreGrid ranked={rest} cols={3} size="sm" />
        </div>
      ) : null}
    </div>
  );
}
