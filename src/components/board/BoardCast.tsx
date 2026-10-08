'use client';

// 토의보드 송출 화면 /board/screen (Board v1.0) — 프로젝터 16:9 (1920×1080 기준, 창 크기에 맞춰 축소·확대)
//   대기: QR + 입장 반조 수 + 그라운드 룰 · 질문 소개 · 항목 열림/월: 흐르는 카드 그리드 + 제출 현황·타이머
//   크게 보기: 카드 1장을 중앙에 · 휴식 / 종료
//   월은 board_feed 를 1초마다 읽는다(제출 테이블은 방송하지 않으므로). 이름은 어디에도 없다 — 반조 ID만.

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import QRCode from 'qrcode';
import clsx from 'clsx';

import { cachedSnapshot, useClientValue } from '@/lib/clientStore';
import { fmtClock, timerLeft, useBoardCounts, useBoardFeed, useBoardState, useNow, useServerOffset } from '@/lib/boardClient';
import {
  BOARD_GROUND_RULES,
  BOARD_QUESTIONS,
  BOARD_TEAM_COUNT,
  BOARD_TOPIC,
  groupById,
  itemById,
  type BoardGroup,
} from '@/lib/boardSeed';
import type { BoardCard, BoardFocus, BoardState } from '@/lib/boardTypes';
import { NewVersionBanner } from '@/components/quiz/NewVersionBanner';

const W = 1920;
const H = 1080;

function subscribeResize(cb: () => void): () => void {
  window.addEventListener('resize', cb);
  return () => window.removeEventListener('resize', cb);
}
function getScale(): number {
  return Math.min(window.innerWidth / W, window.innerHeight / H);
}

/** 참가 주소 — NEXT_PUBLIC_BOARD_URL(짧은 주소)이 있으면 그것, 없으면 이 사이트의 /board */
// 짧은 주소(lw2026-board…/screen)로 열었으면 QR도 짧은 주소 그대로 (Sites v1.0)
const joinUrl = cachedSnapshot(
  () =>
    process.env.NEXT_PUBLIC_BOARD_URL ||
    (window.location.pathname.startsWith('/board') ? `${window.location.origin}/board` : window.location.origin),
);

const THEMES = {
  dark: {
    '--bg': '#0E0F13',
    '--panel': 'rgba(255,255,255,0.07)',
    '--card': '#1B1D24',
    '--ink': '#FFFFFF',
    '--sub': 'rgba(255,255,255,0.62)',
    '--faint': 'rgba(255,255,255,0.35)',
    '--accent': '#FFE300',
    '--accent-ink': '#1E1E1E',
    '--line': 'rgba(255,255,255,0.12)',
  },
  light: {
    '--bg': '#F4F2EC',
    '--panel': 'rgba(30,30,30,0.06)',
    '--card': '#FFFFFF',
    '--ink': '#1E1E1E',
    '--sub': 'rgba(30,30,30,0.66)',
    '--faint': 'rgba(30,30,30,0.38)',
    '--accent': '#FFE300',
    '--accent-ink': '#1E1E1E',
    '--line': 'rgba(30,30,30,0.12)',
  },
} as const;

/** 반조별로 한 장 — Q2-3처럼 두 칸인 그룹은 한 카드에 두 줄 */
export interface TeamCard {
  team_id: string;
  updated_at: string;
  highlighted: boolean;
  parts: { item_id: string; body: string }[];
}

export function toTeamCards(cards: BoardCard[], group: BoardGroup): TeamCard[] {
  const by = new Map<string, TeamCard>();
  for (const c of cards) {
    if (!group.items.some((i) => i.id === c.item_id)) continue;
    const t = by.get(c.team_id) ?? { team_id: c.team_id, updated_at: c.updated_at, highlighted: false, parts: [] };
    t.parts.push({ item_id: c.item_id, body: c.body });
    if (c.updated_at > t.updated_at) t.updated_at = c.updated_at;
    t.highlighted ||= c.highlighted;
    by.set(c.team_id, t);
  }
  const order = (id: string) => group.items.findIndex((i) => i.id === id);
  return [...by.values()]
    .map((t) => ({ ...t, parts: t.parts.sort((a, b) => order(a.item_id) - order(b.item_id)) }))
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at) || a.team_id.localeCompare(b.team_id));
}

function layoutFor(n: number): { cols: number; font: number } {
  if (n <= 4) return { cols: 2, font: 36 };
  if (n <= 9) return { cols: 3, font: 30 };
  if (n <= 16) return { cols: 4, font: 26 };
  if (n <= 30) return { cols: 4, font: 23 };
  return { cols: 5, font: 20 };
}

export function BoardCast() {
  const scale = useSyncExternalStore(subscribeResize, getScale, () => 1);
  const state = useBoardState();
  const offset = useServerOffset();
  const now = useNow();
  const url = useClientValue(joinUrl.get, '');
  const counts = useBoardCounts(2000, state ? `${state.phase}:${state.current_item}` : '');
  const [qr, setQr] = useState('');

  useEffect(() => {
    if (!url) return;
    void QRCode.toString(url, { type: 'svg', margin: 1, color: { dark: '#0E0F13', light: '#FFFFFF' } })
      .then(setQr)
      .catch(() => setQr(''));
  }, [url]);

  const group = groupById(state?.current_item);
  const onWall = Boolean(state && group && (state.phase === 'item_open' || state.phase === 'wall'));
  const feed = useBoardFeed(group ? [group.id] : [], onWall, 1000, state?.updated_at ?? '');
  const cards = useMemo(() => (feed && group ? toTeamCards(feed, group) : []), [feed, group]);
  const sound = useChime(state, cards.length);

  const theme = THEMES[state?.screen_theme ?? 'dark'];
  const left = timerLeft(state, now, offset);

  return (
    <main className="fixed inset-0 overflow-hidden bg-black">
      <div
        className="absolute left-1/2 top-1/2 overflow-hidden"
        style={{
          width: W,
          height: H,
          transform: `translate(-50%, -50%) scale(${scale})`,
          background: 'var(--bg)',
          color: 'var(--ink)',
          ...(theme as React.CSSProperties),
        }}
      >
        {!state ? (
          <div className="flex h-full items-center justify-center text-[40px]" style={{ color: 'var(--faint)' }}>
            연결하는 중…
          </div>
        ) : state.phase === 'waiting' ? (
          <Waiting qr={qr} url={url} joined={counts?.joined ?? 0} />
        ) : state.phase === 'q1_intro' || state.phase === 'q2_intro' ? (
          <Intro no={state.phase === 'q1_intro' ? 1 : 2} />
        ) : state.phase === 'break' ? (
          <Center title="휴식" sub={left !== null ? `${fmtClock(left)} 뒤 질문 ②` : '16:30 질문 ②로 다시 모입니다'} />
        ) : state.phase === 'ended' ? (
          <Center title="수고하셨습니다" sub={`${counts?.joined ?? 0}개 반조가 함께했습니다 · ${BOARD_TOPIC}`} />
        ) : group ? (
          <Wall state={state} group={group} cards={cards} loaded={feed !== null} submitted={counts?.submitted ?? 0} left={left} />
        ) : (
          <Center title={BOARD_TOPIC} sub="" />
        )}
        {state?.focus ? <FocusCard focus={state.focus} /> : null}
      </div>
      <div className="fixed right-3 top-3 z-50 flex gap-2 opacity-30 transition hover:opacity-100">
        {sound.needsUnlock ? (
          <button type="button" onClick={sound.unlock} className="rounded-md bg-white px-3 py-1.5 text-[13px] font-bold text-black">
            효과음 켜기
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => (document.fullscreenElement ? void document.exitFullscreen() : void document.documentElement.requestFullscreen())}
          className="rounded-md bg-white px-3 py-1.5 text-[13px] font-bold text-black"
        >
          전체화면
        </button>
      </div>
      <div className="fixed inset-x-0 top-0 z-50">
        <NewVersionBanner />
      </div>
    </main>
  );
}

function Header({ right }: { right?: React.ReactNode }) {
  return (
    <div className="flex h-[96px] items-center gap-4 px-[72px]">
      <span className="rounded-full px-4 py-1 text-[22px] font-extrabold" style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}>
        리더 토론세션
      </span>
      <span className="text-[24px] font-bold" style={{ color: 'var(--sub)' }}>
        {BOARD_TOPIC}
      </span>
      <div className="ml-auto flex items-center gap-4">{right}</div>
    </div>
  );
}

function Waiting({ qr, url, joined }: { qr: string; url: string; joined: number }) {
  return (
    <div className="flex h-full flex-col">
      <Header />
      <div className="flex flex-1 items-center gap-[96px] px-[120px] pb-[60px]">
        <div className="flex flex-col items-center">
          <div className="h-[440px] w-[440px] rounded-[28px] bg-white p-5" dangerouslySetInnerHTML={{ __html: qr }} />
          <p className="mt-5 text-[30px] font-extrabold tracking-wide">{url.replace(/^https?:\/\//, '')}</p>
          <p className="mt-1 text-[22px]" style={{ color: 'var(--sub)' }}>
            반조 기록자 1명이 폰으로 입장
          </p>
        </div>
        <div className="flex flex-1 flex-col">
          <p className="text-[28px] font-bold" style={{ color: 'var(--sub)' }}>
            입장한 반조
          </p>
          <p className="mt-2 text-[150px] font-black leading-none tabular-nums">
            {joined}
            <span className="text-[70px]" style={{ color: 'var(--faint)' }}>
              {' '}
              / {BOARD_TEAM_COUNT}
            </span>
          </p>
          <ol className="mt-14 flex flex-col gap-5">
            {BOARD_GROUND_RULES.map((r, i) => (
              <li key={r} className="flex gap-4 text-[32px] font-bold leading-[1.4]">
                <span style={{ color: 'var(--accent)' }}>{'①②③'[i]}</span>
                <span>{r}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </div>
  );
}

function Intro({ no }: { no: 1 | 2 }) {
  const q = BOARD_QUESTIONS[no];
  return (
    <div className="flex h-full flex-col">
      <Header />
      <div className="flex flex-1 flex-col justify-center px-[120px] pb-[80px]">
        <p className="qz-fade text-[34px] font-extrabold" style={{ color: 'var(--accent)' }}>
          질문 {no === 1 ? '①' : '②'} · {q.label}
        </p>
        <h1 className="qz-fade mt-6 text-[60px] font-black leading-[1.3]" style={{ wordBreak: 'keep-all' }}>
          {q.text}
        </h1>
        <p className="mt-14 text-[26px] font-bold" style={{ color: 'var(--sub)' }}>
          {no === 1 ? `생각의 틀 — ${q.frameLabel}` : '아젠다 — 하나씩, 6분씩'}
        </p>
        <div className={clsx('qz-pop mt-4 grid gap-5', no === 1 ? 'grid-cols-4' : 'grid-cols-3')}>
          {q.frame.map((f, i) => (
            <div key={f} className="rounded-[24px] px-8 py-8" style={{ background: 'var(--panel)' }}>
              <p className="text-[24px] font-bold" style={{ color: 'var(--faint)' }}>
                {no === 1 ? `영역 ${i + 1}` : `②-${i + 1}`}
              </p>
              <p className="mt-2 text-[42px] font-extrabold">{f}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Center({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="flex h-full flex-col">
      <Header />
      <div className="flex flex-1 flex-col items-center justify-center pb-[96px]">
        <p className="qz-fade text-[120px] font-black">{title}</p>
        {sub ? (
          <p className="mt-6 text-[40px] font-bold tabular-nums" style={{ color: 'var(--sub)' }}>
            {sub}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function Wall({
  state,
  group,
  cards,
  loaded,
  submitted,
  left,
}: {
  state: BoardState;
  group: BoardGroup;
  cards: TeamCard[];
  loaded: boolean;
  submitted: number;
  left: number | null;
}) {
  const open = state.phase === 'item_open' && state.item_open;
  const { cols, font } = layoutFor(cards.length);
  const q = BOARD_QUESTIONS[group.question];
  const scroller = useAutoScroll(state.scroll_speed, cards.length);

  return (
    <div className="flex h-full flex-col">
      <Header
        right={
          <>
            {left !== null && open ? (
              <span
                className={clsx('rounded-2xl px-5 py-1.5 text-[40px] font-black tabular-nums', left <= 60_000 && 'qz-pulse')}
                style={{ background: left <= 60_000 ? '#FF5A3C' : 'var(--panel)', color: left <= 60_000 ? '#fff' : 'var(--ink)' }}
              >
                {fmtClock(left)}
              </span>
            ) : null}
            <span className="rounded-2xl px-5 py-2 text-[30px] font-extrabold tabular-nums" style={{ background: 'var(--panel)' }}>
              제출 {submitted} <span style={{ color: 'var(--faint)' }}>/ {BOARD_TEAM_COUNT}</span>
            </span>
          </>
        }
      />
      <div className="flex items-end gap-6 px-[72px] pb-6">
        <div>
          <p className="text-[24px] font-bold" style={{ color: 'var(--sub)' }}>
            질문 {group.question === 1 ? '①' : '②'} · {q.label} · {group.id}
            {open ? (
              <span className="ml-3 rounded-md px-2 py-0.5 text-[20px] font-extrabold" style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}>
                입력 중
              </span>
            ) : (
              <span className="ml-3 rounded-md px-2 py-0.5 text-[20px] font-bold" style={{ background: 'var(--panel)' }}>
                {state.phase === 'wall' ? '월 보기' : '입력 마감'}
              </span>
            )}
          </p>
          <h1 className="mt-1 text-[54px] font-black leading-tight">
            {group.title}
            <span className="ml-5 text-[34px] font-bold" style={{ color: 'var(--sub)' }}>
              {group.items.map((i) => i.prompt).join(' / ')}
            </span>
          </h1>
        </div>
      </div>
      <div ref={scroller} className="relative flex-1 overflow-hidden px-[72px] pb-10">
        {!loaded ? null : cards.length === 0 ? (
          <p className="pt-24 text-center text-[36px] font-bold" style={{ color: 'var(--faint)' }}>
            {open ? '반조에서 이야기 나누는 중… 첫 카드를 기다리고 있어요' : '아직 카드가 없어요'}
          </p>
        ) : (
          <div style={{ columnCount: cols, columnGap: 20 }}>
            {cards.map((c) => (
              <CardView key={c.team_id} card={c} group={group} font={font} clamp={cards.length > 24} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** 카드가 많으면(24장 초과) 한 장을 7줄로 자른다 — 전문은 '크게 보기' */
function CardView({ card, group, font, clamp }: { card: TeamCard; group: BoardGroup; font: number; clamp: boolean }) {
  return (
    <article
      className="qz-fade mb-5 break-inside-avoid rounded-[20px] p-6"
      style={{
        background: 'var(--card)',
        boxShadow: card.highlighted ? '0 0 0 5px var(--accent)' : '0 1px 0 var(--line)',
        border: '1px solid var(--line)',
      }}
    >
      <span className="inline-block rounded-lg px-3 py-0.5 text-[22px] font-black" style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}>
        {card.team_id}
      </span>
      {card.parts.map((p) => (
        <p
          key={p.item_id}
          className="mt-3 whitespace-pre-wrap break-words font-semibold"
          style={{
            fontSize: font,
            lineHeight: 1.45,
            wordBreak: 'keep-all',
            ...(clamp ? { display: '-webkit-box', WebkitLineClamp: card.parts.length > 1 ? 4 : 7, WebkitBoxOrient: 'vertical', overflow: 'hidden' } : {}),
          }}
        >
          {group.items.length > 1 ? (
            <span className="mr-2 font-bold" style={{ color: 'var(--sub)', fontSize: Math.max(20, font - 4) }}>
              {itemById(p.item_id)?.title}
            </span>
          ) : null}
          {p.body}
        </p>
      ))}
    </article>
  );
}

function FocusCard({ focus }: { focus: BoardFocus }) {
  const group = groupById(focus.group);
  const total = focus.items.reduce((n, i) => n + i.body.length, 0);
  const size = total > 700 ? 32 : total > 400 ? 40 : total > 220 ? 48 : total > 120 ? 58 : 68;
  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/70 p-[100px]">
      <div
        className="qz-pop w-full max-w-[1500px] overflow-y-auto rounded-[36px] p-[64px]"
        style={{ background: 'var(--card)', boxShadow: '0 0 0 6px var(--accent)', maxHeight: 900 }}
      >
        <p className="flex items-center gap-4">
          <span className="rounded-xl px-5 py-1 text-[44px] font-black" style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}>
            {focus.team_id}
          </span>
          <span className="text-[34px] font-bold" style={{ color: 'var(--sub)' }}>
            {group ? `${group.id} · ${group.title}` : focus.group}
          </span>
        </p>
        {focus.items.map((i) =>
          i.body ? (
            <p key={i.item_id} className="mt-8 whitespace-pre-wrap break-words font-bold" style={{ fontSize: size, lineHeight: 1.4, wordBreak: 'keep-all' }}>
              {focus.items.length > 1 ? (
                <span className="mb-2 block text-[30px]" style={{ color: 'var(--sub)' }}>
                  {itemById(i.item_id)?.title}
                </span>
              ) : null}
              {i.body}
            </p>
          ) : null,
        )}
      </div>
    </div>
  );
}

/** 넘치면 천천히 아래로 → 바닥에서 3초 멈춤 → 맨 위로. speed=0이면 멈춤 */
function useAutoScroll(speed: number, n: number) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || speed <= 0) return;
    let raf = 0;
    let last = performance.now();
    let pauseUntil = last + 4000;
    let pos = el.scrollTop;
    let jump: ReturnType<typeof setTimeout> | null = null;
    const step = (t: number) => {
      const dt = (t - last) / 1000;
      last = t;
      const max = el.scrollHeight - el.clientHeight;
      if (max > 4 && t >= pauseUntil) {
        pos += speed * dt;
        if (pos >= max) {
          pos = max;
          pauseUntil = t + 3000;
          jump = setTimeout(() => {
            pos = 0;
            el.scrollTop = 0;
          }, 3000);
        }
        el.scrollTop = pos;
      } else if (max <= 4) {
        pos = 0;
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(raf);
      if (jump) clearTimeout(jump);
    };
  }, [speed, n]);
  return ref;
}

/** 새 카드가 붙을 때 짧은 알림음 — 운영자가 켜고(sound_on), 송출 PC에서 '효과음 켜기'를 한 번 눌러야 난다 */
function useChime(state: BoardState | null, count: number) {
  const ctxRef = useRef<AudioContext | null>(null);
  const [unlocked, setUnlocked] = useState(false);
  const prev = useRef(count);
  const enabled = Boolean(state?.sound_on);

  useEffect(() => {
    const before = prev.current;
    prev.current = count;
    if (!enabled || !unlocked || count <= before) return;
    const ctx = ctxRef.current;
    if (!ctx) return;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(880, ctx.currentTime);
    o.frequency.exponentialRampToValueAtTime(1320, ctx.currentTime + 0.12);
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.35);
    o.connect(g).connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + 0.4);
  }, [count, enabled, unlocked]);

  return {
    needsUnlock: enabled && !unlocked,
    unlock: () => {
      try {
        ctxRef.current ??= new AudioContext();
        void ctxRef.current.resume();
        setUnlocked(true);
      } catch {
        /* 오디오 불가 */
      }
    },
  };
}
