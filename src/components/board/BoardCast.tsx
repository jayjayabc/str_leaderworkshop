'use client';

// 토의보드 송출 화면 /board/screen (Board v1.1) — 프로젝터 16:9 (1920×1080 기준, 창 크기에 맞춰 축소·확대)
//   대기: QR + 입장 반조 수 + 그라운드 룰 · 질문 소개 · 항목 열림/모아보기: 흐르는 카드 그리드 + 제출 현황
//   모아보기: 질문별 탭 바(카드 수) · 투표 중이면 배너+QR · 순위 공개면 순위 화면 · 크게 보기: 카드 1장을 중앙에
//   카드는 board_feed 를 1초마다 읽는다(제출 테이블은 방송하지 않으므로).
//   반조(작성 조) 정보는 어디에도 없다 — 배지도 이름도 타이머도 없다(card 키만 받는다).

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import QRCode from 'qrcode';
import clsx from 'clsx';

import { cachedSnapshot, useClientValue } from '@/lib/clientStore';
import { toTeamCards, useBoardCounts, useBoardFeed, useBoardRanking, useBoardState, type TeamCard } from '@/lib/boardClient';
import {
  BOARD_GROUND_RULES,
  BOARD_QUESTIONS,
  BOARD_TEAM_COUNT,
  BOARD_GROUPS,
  BOARD_TOPIC,
  groupById,
  groupLabel,
  itemById,
  questionLabel,
  type BoardGroup,
} from '@/lib/boardSeed';
import type { BoardCounts, BoardFocus, BoardRankRow, BoardState } from '@/lib/boardTypes';
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
  const url = useClientValue(joinUrl.get, '');
  const stamp = state ? `${state.phase}:${state.current_item}:${state.vote_open}` : '';
  const counts = useBoardCounts(2000, stamp);
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
  // 투표 대상 그룹이고 순위 공개면 순위 화면
  const voteTarget = Boolean(state && group && state.vote_items.includes(group.id));
  const showRanking = Boolean(state && voteTarget && state.vote_reveal && onWall);
  const ranking = useBoardRanking(group?.id ?? null, showRanking, 1500, state?.updated_at ?? '');

  const theme = THEMES[state?.screen_theme ?? 'dark'];

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
          <Center title="휴식" sub="잠시 쉬어 갑니다" />
        ) : state.phase === 'ended' ? (
          <Center title="수고하셨습니다" sub={`${counts?.joined ?? 0}개 반조가 함께했습니다 · ${BOARD_TOPIC}`} />
        ) : group ? (
          <Wall
            state={state}
            group={group}
            cards={cards}
            loaded={feed !== null}
            counts={counts}
            qr={qr}
            ranking={showRanking ? ranking : undefined}
          />
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
            반조 기록자 1명이 폰으로 입장 (나머지는 관전자로)
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
          <ul className="mt-14 flex flex-col gap-5">
            {BOARD_GROUND_RULES.map((r) => (
              <li key={r} className="flex gap-4 text-[32px] font-bold leading-[1.4]">
                <span style={{ color: 'var(--accent)' }}>●</span>
                <span>{r}</span>
              </li>
            ))}
          </ul>
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
          {questionLabel(no)}
        </p>
        <h1 className="qz-fade mt-6 text-[60px] font-black leading-[1.3]" style={{ wordBreak: 'keep-all' }}>
          {q.text}
        </h1>
        <p className="mt-14 text-[26px] font-bold" style={{ color: 'var(--sub)' }}>
          {no === 1 ? `생각의 틀 — ${q.frameLabel}` : q.frameLabel}
        </p>
        {no === 1 ? (
          // 번호 없는 칩
          <div className="qz-pop mt-4 grid grid-cols-4 gap-5">
            {q.frame.map((f) => (
              <div key={f} className="rounded-[24px] px-8 py-10" style={{ background: 'var(--panel)' }}>
                <p className="text-[42px] font-extrabold">{f}</p>
              </div>
            ))}
          </div>
        ) : (
          // 막힌 것 → 일하는 방식 → 당장 할 것 (화살표 흐름)
          <div className="qz-pop mt-4 flex items-center gap-5">
            {q.frame.map((f, i) => (
              <div key={f} className="contents">
                {i > 0 ? (
                  <span className="text-[56px] font-black" style={{ color: 'var(--faint)' }} aria-hidden="true">
                    →
                  </span>
                ) : null}
                <div className="flex-1 rounded-[24px] px-8 py-10 text-center" style={{ background: 'var(--panel)' }}>
                  <p className="text-[42px] font-extrabold">{f}</p>
                </div>
              </div>
            ))}
          </div>
        )}
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
          <p className="mt-6 text-[40px] font-bold" style={{ color: 'var(--sub)' }}>
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
  counts,
  qr,
  ranking,
}: {
  state: BoardState;
  group: BoardGroup;
  cards: TeamCard[];
  loaded: boolean;
  counts: BoardCounts | null;
  qr: string;
  /** undefined = 순위 화면이 아님 · null = 읽는 중 */
  ranking: BoardRankRow[] | null | undefined;
}) {
  const open = state.phase === 'item_open' && state.item_open;
  const onWallPhase = state.phase === 'wall';
  const { cols, font } = layoutFor(cards.length);
  const q = BOARD_QUESTIONS[group.question];
  const voting = state.vote_items.includes(group.id) && state.vote_open && ranking === undefined;
  const scroller = useAutoScroll(state.scroll_speed, ranking ? ranking.length : cards.length);
  const tabs = BOARD_GROUPS.filter((g) => g.question === group.question);

  return (
    <div className="flex h-full flex-col">
      <Header
        right={
          <span className="rounded-2xl px-5 py-2 text-[30px] font-extrabold tabular-nums" style={{ background: 'var(--panel)' }}>
            제출 {counts?.submitted ?? 0} <span style={{ color: 'var(--faint)' }}>/ {BOARD_TEAM_COUNT}</span>
          </span>
        }
      />
      {/* 질문 상시 노출 — 작은 글씨, 말줄임 없이 최대 2줄 */}
      <p className="px-[72px] text-[22px] font-semibold leading-[1.4]" style={{ color: 'var(--sub)', wordBreak: 'keep-all' }}>
        {q.text}
      </p>
      <div className="flex items-end gap-6 px-[72px] pb-4 pt-3">
        <div>
          <p className="text-[24px] font-bold" style={{ color: 'var(--sub)' }}>
            {questionLabel(group.question)} · {groupLabel(group.id)}
            {open ? (
              <span className="ml-3 rounded-md px-2 py-0.5 text-[20px] font-extrabold" style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}>
                입력 중
              </span>
            ) : (
              <span className="ml-3 rounded-md px-2 py-0.5 text-[20px] font-bold" style={{ background: 'var(--panel)' }}>
                {onWallPhase ? '모아보기' : '입력 마감'}
              </span>
            )}
          </p>
          <h1 className="mt-1 text-[48px] font-black leading-tight">
            {group.title}
            <span className="ml-5 text-[30px] font-bold" style={{ color: 'var(--sub)' }}>
              {group.items.map((i) => i.prompt).join(' / ')}
            </span>
          </h1>
        </div>
      </div>

      {onWallPhase ? (
        <div role="tablist" aria-label="모아보기 탭" className="flex gap-3 px-[72px] pb-4">
          {tabs.map((g) => {
            const here = g.id === group.id;
            const n = here && loaded ? cards.length : (counts?.by_group[g.id] ?? 0);
            return (
              <div
                key={g.id}
                role="tab"
                aria-selected={here}
                className="flex items-center gap-3 rounded-2xl px-6 py-2.5 text-[26px] font-extrabold"
                style={here ? { background: 'var(--accent)', color: 'var(--accent-ink)' } : { background: 'var(--panel)', color: 'var(--sub)' }}
              >
                <span>
                  {groupLabel(g.id)} {g.title}
                </span>
                <span
                  className="rounded-full px-3 py-0.5 text-[22px] tabular-nums"
                  style={here ? { background: 'rgba(0,0,0,0.12)' } : { background: 'var(--line)' }}
                >
                  {n}
                </span>
              </div>
            );
          })}
        </div>
      ) : null}

      {voting ? (
        <div className="mx-[72px] mb-4 flex items-center gap-6 rounded-[24px] px-8 py-3" style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}>
          <span className="text-[44px] leading-none" aria-hidden="true">
            ♥
          </span>
          <p className="flex-1 text-[34px] font-black leading-tight">공감 가는 아이디어에 ♥ (한 사람 3표) — 폰에서 투표</p>
          <div className="text-center leading-tight">
            <p className="text-[20px] font-bold">투표한 기기</p>
            <p className="text-[48px] font-black tabular-nums">{counts?.voters ?? 0}</p>
          </div>
          <div className="h-[104px] w-[104px] shrink-0 rounded-xl bg-white p-1.5" dangerouslySetInnerHTML={{ __html: qr }} />
        </div>
      ) : null}

      <div ref={scroller} className="relative flex-1 overflow-hidden px-[72px] pb-10">
        {ranking !== undefined ? (
          ranking === null ? null : ranking.length === 0 ? (
            <p className="pt-24 text-center text-[36px] font-bold" style={{ color: 'var(--faint)' }}>
              아직 카드가 없어요
            </p>
          ) : (
            <RankingView rows={ranking} group={group} />
          )
        ) : !loaded ? null : cards.length === 0 ? (
          state.phase === 'item_open' ? (
            <ExampleCards group={group} />
          ) : (
            <p className="pt-24 text-center text-[36px] font-bold" style={{ color: 'var(--faint)' }}>
              아직 카드가 없어요
            </p>
          )
        ) : (
          <div style={{ columnCount: cols, columnGap: 20 }}>
            {cards.map((c) => (
              <CardView key={c.card} card={c} group={group} font={font} clamp={cards.length > 24} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** 카드가 하나도 없을 때 — 작성 예시 2장(옅은 점선 카드). 첫 카드가 오면 사라진다 */
function ExampleCards({ group }: { group: BoardGroup }) {
  const { font } = layoutFor(2);
  const sets = [0, 1]
    .map((i) => group.items.map((it) => ({ item_id: it.id, body: it.examples[i] ?? '' })).filter((p) => p.body))
    .filter((parts) => parts.length > 0);
  return (
    <div data-testid="example-cards" style={{ columnCount: 2, columnGap: 20 }}>
      {sets.map((parts, i) => (
        <article
          key={i}
          className="mb-5 break-inside-avoid rounded-[20px] p-6"
          style={{ border: '3px dashed var(--faint)', opacity: 0.55 }}
        >
          <span className="inline-block rounded-lg px-3 py-0.5 text-[22px] font-black" style={{ background: 'var(--panel)', color: 'var(--sub)' }}>
            예시
          </span>
          {parts.map((p) => (
            <p key={p.item_id} className="mt-3 whitespace-pre-wrap break-words font-semibold" style={{ fontSize: font, lineHeight: 1.45, wordBreak: 'keep-all' }}>
              {group.items.length > 1 ? (
                <span className="mr-2 font-bold" style={{ color: 'var(--sub)', fontSize: Math.max(20, font - 4) }}>
                  {itemById(p.item_id)?.title}
                </span>
              ) : null}
              {p.body}
            </p>
          ))}
        </article>
      ))}
    </div>
  );
}

/** 카드가 많으면(24장 초과) 한 장을 7줄로 자른다 — 전문은 '크게 보기'. 반조 표시는 없다 */
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
      {card.parts.map((p, idx) => (
        <p
          key={p.item_id}
          className={clsx('whitespace-pre-wrap break-words font-semibold', idx > 0 ? 'mt-3' : '')}
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

/** 순위 화면 — 상위 5장은 크게(득표수 막대), 나머지는 작게. 반조 표시 없음 */
function RankingView({ rows, group }: { rows: BoardRankRow[]; group: BoardGroup }) {
  const top = rows.slice(0, 5);
  const rest = rows.slice(5);
  const max = Math.max(1, ...rows.map((r) => r.votes));
  return (
    <div data-testid="ranking" className="flex flex-col gap-4">
      {top.map((r, i) => {
        const total = r.parts.reduce((n, p) => n + p.body.length, 0);
        const size = total > 200 ? 24 : total > 120 ? 28 : 34;
        return (
          <div key={r.card} className="qz-fade flex items-center gap-6 rounded-[22px] px-7 py-4" style={{ background: 'var(--card)', border: '1px solid var(--line)' }}>
            <span className="w-[88px] shrink-0 text-center text-[44px] font-black" style={{ color: i === 0 ? 'var(--accent)' : 'var(--sub)' }}>
              {i + 1}위
            </span>
            <div className="min-w-0 flex-1">
              {r.parts.map((p) => (
                <p key={p.item_id} className="whitespace-pre-wrap break-words font-bold" style={{ fontSize: size, lineHeight: 1.35, wordBreak: 'keep-all' }}>
                  {group.items.length > 1 ? (
                    <span className="mr-2 font-bold" style={{ color: 'var(--sub)', fontSize: Math.max(18, size - 6) }}>
                      {itemById(p.item_id)?.title}
                    </span>
                  ) : null}
                  {p.body}
                </p>
              ))}
              <div className="mt-2 h-[14px] w-full rounded-full" style={{ background: 'var(--panel)' }}>
                <div className="h-full rounded-full" style={{ width: `${(r.votes / max) * 100}%`, background: 'var(--accent)' }} />
              </div>
            </div>
            <span className="w-[130px] shrink-0 text-right text-[40px] font-black tabular-nums">
              ♥ {r.votes}
              <span className="ml-1 text-[22px] font-bold" style={{ color: 'var(--sub)' }}>
                표
              </span>
            </span>
          </div>
        );
      })}
      {rest.length ? (
        <div className="mt-2 grid grid-cols-3 gap-3">
          {rest.map((r, i) => (
            <div key={r.card} className="flex gap-3 rounded-2xl px-4 py-3 text-[20px]" style={{ background: 'var(--panel)' }}>
              <span className="shrink-0 font-black" style={{ color: 'var(--sub)' }}>
                {i + 6}위
              </span>
              <span className="min-w-0 flex-1 font-semibold" style={{ wordBreak: 'keep-all', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                {r.parts.map((p) => p.body).join(' / ')}
              </span>
              <span className="shrink-0 font-black tabular-nums">♥ {r.votes}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
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
        <p className="text-[34px] font-bold" style={{ color: 'var(--sub)' }}>
          {group ? `${groupLabel(group.id)} · ${group.title}` : focus.group}
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
