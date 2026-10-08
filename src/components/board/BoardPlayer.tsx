'use client';

// 토의보드 참가자 화면 /board (Board v1.1) — 반조 기록자 · 관전자 폰.
//   입장(조 번호 → A/B → 역할[기록자/관전자] → 이름[기록자만]) → 대기/소개 → 운영자가 연 항목 입력(기록자) / 읽기(관전자)
//   → (모아보기 공개 시) 다른 반조 카드 읽기 · (투표 중) 투표 · (순위 공개 시) 순위 보기
//   새로고침·잠금해제 후에도 localStorage로 이어진다. 서버 불통이면 입력은 임시 저장 후 다시 보내기.
//   내 화면 상단의 반조 ID 는 본인 확인용이다. 다른 반조 카드에는 반조 표시가 없다.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';

import { getBoardDb } from '@/lib/boardDb';
import { PHASE_LABEL, toTeamCards, useBoardFeed, useBoardRanking, useBoardState } from '@/lib/boardClient';
import {
  BOARD_GROUND_RULES,
  BOARD_GROUPS,
  BOARD_MAX_LEN,
  BOARD_QUESTIONS,
  BOARD_TABLES,
  BOARD_TOPIC,
  groupById,
  groupLabel,
  itemById,
  questionLabel,
  type BoardGroup,
  type BoardGroupId,
} from '@/lib/boardSeed';
import {
  BOARD_MAX_VOTES,
  BoardError,
  boardErrorText,
  type BoardMe,
  type BoardMySubmission,
  type BoardMyVotes,
  type BoardRole,
  type BoardState,
} from '@/lib/boardTypes';

// ?as=라벨 — 한 브라우저에 참가자 탭을 여러 개 띄우는 시연·테스트용(퀴즈와 같은 방식). 저장 키를 라벨별로 나눈다.
const NS = typeof window === 'undefined' ? '' : (new URLSearchParams(window.location.search).get('as') ?? '').slice(0, 20);
const ns = (k: string) => (NS ? `${k}:${NS}` : k);
const ME_KEY = ns('eb:board:me');
const DEVICE_KEY = ns('eb:board:device');
const DRAFT_KEY = ns('eb:board:drafts');
const OUTBOX_KEY = ns('eb:board:outbox');

const YELLOW = '#FFE300';

// ─── localStorage 헬퍼 ───────────────────────────────────────

function lsGet<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function lsSet(key: string, value: unknown): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* 사파리 사생활 보호 모드 등 */
  }
}
function deviceToken(): string {
  let d = lsGet<string>(DEVICE_KEY, '');
  if (!d) {
    d = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `d-${Math.random().toString(36).slice(2)}${Date.now()}`;
    lsSet(DEVICE_KEY, d);
  }
  return d;
}

type Drafts = Record<string, string>; // `${team}:${itemId}` → 본문
interface Outbox {
  pid: string;
  group: BoardGroupId;
  bodies: Record<string, string>;
}

// ─── 화면 ─────────────────────────────────────────────────────

export function BoardPlayer() {
  // undefined = 아직 localStorage를 안 읽음(서버 렌더) · null = 입장 전
  const [me, setMe] = useState<BoardMe | null | undefined>(undefined);

  useEffect(() => {
    // 첫 렌더 뒤 한 번만 저장된 입장 정보를 읽는다
    const stored = lsGet<BoardMe | null>(ME_KEY, null);
    // v1.0 때 저장된 입장 정보에는 role 이 없다 → 기록자
    queueMicrotask(() => setMe(stored ? { ...stored, role: stored.role ?? 'recorder' } : null));
  }, []);

  const onJoined = useCallback((m: BoardMe) => {
    lsSet(ME_KEY, m);
    setMe(m);
  }, []);
  const onLeave = useCallback(() => {
    // 리허설 때 적다 만 글이 본행사 입력칸에 다시 나타나지 않게 임시 저장분도 지운다
    lsSet(ME_KEY, null);
    lsSet(DRAFT_KEY, null);
    lsSet(OUTBOX_KEY, null);
    setMe(null);
  }, []);

  if (me === undefined) return <main className="min-h-dvh bg-[#0E0F13]" />;
  return (
    <main className="min-h-dvh bg-[#0E0F13] text-white" style={{ touchAction: 'manipulation' }}>
      {me ? <Session me={me} onLeave={onLeave} onChanged={onJoined} /> : <Join onJoined={onJoined} />}
    </main>
  );
}

function Brand() {
  return (
    <div className="flex items-center gap-2">
      <span className="rounded-full px-2.5 py-0.5 text-[12px] font-extrabold text-[#1E1E1E]" style={{ background: YELLOW }}>
        토의보드
      </span>
      <span className="text-[12px] font-bold tracking-wide text-white/60">{BOARD_TOPIC}</span>
    </div>
  );
}

function GroundRules({ compact = false }: { compact?: boolean }) {
  return (
    <ol className={clsx('flex flex-col gap-2 rounded-2xl bg-white/[0.06] p-4', compact ? 'text-[13px]' : 'text-[14px]')}>
      {BOARD_GROUND_RULES.map((r) => (
        <li key={r} className="flex gap-2 leading-6 text-white/80">
          <span className="font-extrabold" style={{ color: YELLOW }}>
            ●
          </span>
          <span>{r}</span>
        </li>
      ))}
    </ol>
  );
}

// ─── 입장 ─────────────────────────────────────────────────────

function Join({ onJoined }: { onJoined: (m: BoardMe) => void }) {
  const [table, setTable] = useState<number | null>(null);
  const [half, setHalf] = useState<'A' | 'B' | null>(null);
  const [role, setRole] = useState<BoardRole | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const join = async () => {
    if (!table || !half || !role) return;
    setBusy(true);
    setErr('');
    try {
      const m = await getBoardDb().join(`${table}${half}`, role === 'recorder' ? name : '', deviceToken(), role);
      onJoined(m);
    } catch (e) {
      setErr(boardErrorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[520px] flex-col px-4 pb-8 pt-6">
      <Brand />
      {!table ? (
        <>
          <h1 className="mt-6 text-[26px] font-extrabold leading-tight">우리 조 번호를 눌러 주세요</h1>
          <p className="mt-1 text-[14px] text-white/60">테이블에 놓인 조 번호를 확인하세요</p>
          <div className="mt-5 grid grid-cols-5 gap-2" role="radiogroup" aria-label="조 번호">
            {Array.from({ length: BOARD_TABLES }, (_, i) => i + 1).map((n) => (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={false}
                onClick={() => setTable(n)}
                className="h-14 rounded-xl bg-white/10 text-[20px] font-extrabold active:scale-95 active:bg-[#FFE300] active:text-[#1E1E1E]"
              >
                {n}
              </button>
            ))}
          </div>
          <div className="mt-8">
            <GroundRules compact />
          </div>
        </>
      ) : (
        <>
          <button type="button" onClick={() => (setTable(null), setHalf(null), setRole(null))} className="mt-6 self-start text-[14px] text-white/60">
            ← 조 번호 다시 고르기
          </button>
          <h1 className="mt-2 text-[28px] font-extrabold">
            <span style={{ color: YELLOW }}>{table}조</span>의 어느 반조인가요?
          </h1>
          <p className="mt-1 text-[14px] text-white/60">좌석 1~4번 = A · 5~8번 = B</p>
          <div className="mt-4 grid grid-cols-2 gap-3" role="radiogroup" aria-label="반조">
            {(['A', 'B'] as const).map((h) => (
              <button
                key={h}
                type="button"
                role="radio"
                aria-checked={half === h}
                onClick={() => setHalf(h)}
                className={clsx(
                  'h-20 rounded-2xl text-[30px] font-extrabold transition',
                  half === h ? 'bg-[#FFE300] text-[#1E1E1E]' : 'bg-white/10 text-white',
                )}
              >
                {table}
                {h}
              </button>
            ))}
          </div>

          {half ? (
            <>
              <p className="mt-7 text-[14px] font-bold text-white/70">어떻게 참여하나요?</p>
              <div className="mt-2 flex flex-col gap-2" role="radiogroup" aria-label="역할">
                {(
                  [
                    { r: 'recorder', t: '기록자로 입장', d: '우리 반조 답을 입력해요 (반조당 1명)' },
                    { r: 'viewer', t: '관전자로 입장', d: '보면서 이야기하고, 투표 때 참여해요' },
                  ] as const
                ).map((o) => (
                  <button
                    key={o.r}
                    type="button"
                    role="radio"
                    aria-checked={role === o.r}
                    onClick={() => setRole(o.r)}
                    className={clsx(
                      'rounded-2xl px-4 py-3 text-left transition',
                      role === o.r ? 'bg-[#FFE300] text-[#1E1E1E]' : 'bg-white/10 text-white',
                    )}
                  >
                    <span className="block text-[18px] font-extrabold">{o.t}</span>
                    <span className={clsx('block text-[13px]', role === o.r ? 'text-[#1E1E1E]/70' : 'text-white/60')}>{o.d}</span>
                  </button>
                ))}
              </div>
            </>
          ) : null}

          {role === 'recorder' ? (
            <>
              <label className="mt-6 block text-[14px] font-bold text-white/70" htmlFor="board-name">
                이름 (선택 · 비우면 &lsquo;기록자&rsquo;)
              </label>
              <input
                id="board-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={20}
                autoComplete="off"
                placeholder="기록자"
                className="mt-2 h-12 rounded-xl bg-white/10 px-4 text-[16px] outline-none ring-[#FFE300] placeholder:text-white/30 focus:ring-2"
              />
              <p className="mt-1 text-[12px] text-white/40">이름은 송출 화면·다른 반조에 보이지 않아요.</p>
            </>
          ) : null}
          {err ? <p className="mt-4 rounded-xl bg-[#FF5A3C]/15 p-3 text-[14px] text-[#FFB4A6]" role="alert">{err}</p> : null}
          <button
            type="button"
            disabled={!half || !role || busy}
            onClick={() => void join()}
            className="mt-6 h-14 rounded-2xl text-[18px] font-extrabold text-[#1E1E1E] disabled:opacity-40"
            style={{ background: YELLOW }}
          >
            {busy ? '입장하는 중…' : half && role ? `${table}${half} ${role === 'recorder' ? '기록자' : '관전자'}로 입장` : half ? '역할을 골라 주세요' : '반조를 골라 주세요'}
          </button>
        </>
      )}
    </div>
  );
}

// ─── 입장 후 ──────────────────────────────────────────────────

function Session({ me, onLeave, onChanged }: { me: BoardMe; onLeave: () => void; onChanged: (m: BoardMe) => void }) {
  const state = useBoardState();
  const [mine, setMine] = useState<BoardMySubmission[]>([]);
  const [showWall, setShowWall] = useState(false);
  const [roleErr, setRoleErr] = useState('');

  // 우리 반조 제출 — 상태가 바뀔 때·5초마다. 참가자가 지워졌으면(전체 초기화) 입장 화면으로
  const stamp = state?.updated_at ?? '';
  const refresh = useCallback(async () => {
    try {
      const v = await getBoardDb().my(me.id);
      if (v === null) {
        onLeave();
        return;
      }
      setMine(v.submissions);
    } catch {
      /* 네트워크 — 다음 주기에 */
    }
  }, [me.id, onLeave]);
  useEffect(() => {
    const first = setTimeout(() => void refresh(), Math.random() * 600);
    const t = setInterval(() => void refresh(), 5000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [refresh, stamp]);

  const question = state?.question ?? (state?.phase === 'q2_intro' ? 2 : 1);
  const wallOn = Boolean(state?.wall_public);
  const current = groupById(state?.current_item);
  // 투표 대상 그룹이고 투표 중(또는 순위 공개)이면 역할과 무관하게 투표 화면
  const voteScreen = Boolean(
    state && current && (state.phase === 'item_open' || state.phase === 'wall') && state.vote_items.includes(current.id) && (state.vote_open || state.vote_reveal),
  );
  const viewer = me.role === 'viewer';

  const switchRole = async () => {
    const next: BoardRole = viewer ? 'recorder' : 'viewer';
    if (!window.confirm(`${next === 'recorder' ? '기록자' : '관전자'}로 바꿔 다시 입장할까요?`)) return;
    setRoleErr('');
    try {
      onChanged(await getBoardDb().join(me.team_id, '', deviceToken(), next));
    } catch (e) {
      setRoleErr(boardErrorText(e));
    }
  };

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[520px] flex-col px-4 pb-16">
      <header className="sticky top-0 z-10 -mx-4 flex h-14 items-center gap-2 bg-[#0E0F13]/95 px-4 backdrop-blur">
        <span className="rounded-lg px-2.5 py-1 text-[17px] font-extrabold text-[#1E1E1E]" style={{ background: YELLOW }}>
          {me.team_id}
        </span>
        {viewer ? <span className="rounded-md bg-white/15 px-1.5 py-0.5 text-[12px] font-bold">관전</span> : null}
        <span className="truncate text-[14px] text-white/60">{me.name}</span>
        <span className="ml-auto flex items-center gap-2 text-[13px] text-white/60">
          {state ? (state.phase === 'item_open' && state.current_item ? `${groupLabel(state.current_item)} ${state.item_open ? '입력' : '마감'}` : PHASE_LABEL[state.phase]) : '연결 중'}
        </span>
      </header>

      {!state ? (
        <p className="py-16 text-center text-[16px] text-white/50">연결하는 중…</p>
      ) : showWall && wallOn ? (
        <PhoneWall question={question} currentItem={state.current_item} onBack={() => setShowWall(false)} />
      ) : voteScreen && current ? (
        <VoteScreen state={state} me={me} group={current} mine={mine} />
      ) : (
        <>
          <PhaseBody state={state} me={me} mine={mine} onSubmitted={refresh} />
          {wallOn ? (
            <button
              type="button"
              onClick={() => setShowWall(true)}
              className="mt-6 h-12 rounded-2xl bg-white/10 text-[15px] font-bold"
            >
              다른 반조 카드 모아보기 →
            </button>
          ) : null}
        </>
      )}

      <div className="mt-auto pt-12 text-center">
        {roleErr ? <p className="mb-2 text-[13px] text-[#FFB4A6]">{roleErr}</p> : null}
        <button
          type="button"
          onClick={() => {
            if (window.confirm('반조를 바꿔 다시 입장할까요?')) onLeave();
          }}
          className="text-[13px] text-white/35 underline underline-offset-4"
        >
          반조 바꾸기
        </button>
        <span className="mx-3 text-white/20" aria-hidden="true">
          ·
        </span>
        <button type="button" onClick={() => void switchRole()} className="text-[13px] text-white/35 underline underline-offset-4">
          역할 바꾸기
        </button>
      </div>
    </div>
  );
}

function PhaseBody({
  state,
  me,
  mine,
  onSubmitted,
}: {
  state: BoardState;
  me: BoardMe;
  mine: BoardMySubmission[];
  onSubmitted: () => Promise<void>;
}) {
  switch (state.phase) {
    case 'waiting':
      return (
        <section className="mt-6 flex flex-col gap-4">
          <h1 className="text-[24px] font-extrabold leading-tight">입장 완료! 곧 시작해요</h1>
          <p className="text-[15px] leading-7 text-white/70">
            {me.role === 'viewer' ? (
              <>
                <b className="text-white">관전자</b>로 입장했어요. 반조 이야기를 나누고, 투표 때 참여해 주세요. 화면을 켜 둔 채 기다려 주세요.
              </>
            ) : (
              <>
                반조에서 <b className="text-white">기록</b>을 맡은 분이 이 화면에 답을 적습니다. 화면을 켜 둔 채 기다려 주세요.
              </>
            )}
          </p>
          <GroundRules />
        </section>
      );
    case 'q1_intro':
    case 'q2_intro':
      return <QuestionIntro no={state.phase === 'q1_intro' ? 1 : 2} />;
    case 'break':
      return (
        <section className="mt-16 text-center">
          <p className="text-[28px] font-extrabold">휴식 시간</p>
          <p className="mt-2 text-[15px] text-white/60">잠시 쉬어 갑니다</p>
          <TeamSummary question={1} state={state} mine={mine} />
        </section>
      );
    case 'ended':
      return (
        <section className="mt-12 text-center">
          <p className="text-[28px] font-extrabold">수고하셨습니다 🙌</p>
          <p className="mt-2 text-[15px] text-white/60">모든 답이 저장됐어요.</p>
          <TeamSummary question={1} state={state} mine={mine} />
          <TeamSummary question={2} state={state} mine={mine} />
        </section>
      );
    case 'item_open':
    case 'wall':
    default:
      return <ItemsView state={state} me={me} mine={mine} onSubmitted={onSubmitted} />;
  }
}

function MoneyFrame() {
  const q = BOARD_QUESTIONS[1];
  return (
    <div className="grid grid-cols-4 gap-1.5" aria-label={q.frameLabel}>
      {q.frame.map((f) => (
        <span key={f} className="rounded-lg bg-white/[0.07] px-1 py-2 text-center text-[12px] font-bold leading-4 text-white/80">
          {f}
        </span>
      ))}
    </div>
  );
}

function QuestionIntro({ no }: { no: 1 | 2 }) {
  const q = BOARD_QUESTIONS[no];
  return (
    <section className="mt-6 flex flex-col gap-4">
      <p className="text-[13px] font-bold" style={{ color: YELLOW }}>
        {questionLabel(no)}
      </p>
      <h1 className="text-[21px] font-extrabold leading-8">{q.text}</h1>
      {no === 1 ? (
        <>
          <p className="text-[13px] font-bold text-white/60">생각의 틀 — {q.frameLabel}</p>
          <MoneyFrame />
          <p className="text-[14px] leading-6 text-white/60">지금은 반조에서 이야기 나누는 시간이에요. 진행자가 항목을 열면 입력칸이 나타나요.</p>
        </>
      ) : (
        // 번호 없이 화살표 흐름
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[15px] font-bold" aria-label="아젠다">
          {q.frame.map((f, i) => (
            <span key={f} className="contents">
              {i > 0 ? (
                <span className="text-white/40" aria-hidden="true">
                  →
                </span>
              ) : null}
              <span className="rounded-xl bg-white/[0.06] px-3 py-2">{f}</span>
            </span>
          ))}
        </p>
      )}
      <GroundRules compact />
    </section>
  );
}

/** 지금 질문의 그룹들 — 열린 그룹은 입력(기록자) / 읽기(관전자), 지난 그룹은 우리 반조 답(읽기), 아직 안 연 그룹은 회색 */
function ItemsView({
  state,
  me,
  mine,
  onSubmitted,
}: {
  state: BoardState;
  me: BoardMe;
  mine: BoardMySubmission[];
  onSubmitted: () => Promise<void>;
}) {
  const question = state.question ?? 1;
  const groups = BOARD_GROUPS.filter((g) => g.question === question);
  const current = groupById(state.current_item);
  const openNow = state.phase === 'item_open' && state.item_open && current;

  return (
    <section className="mt-4 flex flex-col gap-4">
      <div>
        <p className="text-[12px] font-bold" style={{ color: YELLOW }}>
          {questionLabel(question)}
        </p>
        <p className="mt-1 text-[14px] leading-6 text-white/70">{BOARD_QUESTIONS[question].text}</p>
      </div>
      {question === 1 ? <MoneyFrame /> : null}

      <StaleOutbox key={state.updated_at} me={me} openGroup={openNow ? current.id : null} />

      {current && openNow ? (
        me.role === 'viewer' ? (
          <ViewerCard key={current.id} group={current} mine={mine} />
        ) : (
          <EntryCard key={current.id} group={current} state={state} me={me} mine={mine} onSubmitted={onSubmitted} />
        )
      ) : current ? (
        <div className="rounded-2xl bg-white/[0.06] p-4 text-[14px] text-white/70">
          <b className="text-white">{current.title}</b> 입력이 닫혔어요. 송출 화면을 함께 봐 주세요.
        </div>
      ) : null}

      <div className="mt-2 flex flex-col gap-2">
        <p className="text-[12px] font-bold text-white/50">우리 반조 카드</p>
        {groups.map((g) => {
          if (openNow && g.id === current?.id) return null;
          const opened = state.opened_groups.includes(g.id);
          return <SummaryRow key={g.id} group={g} opened={opened} mine={mine} />;
        })}
      </div>
    </section>
  );
}

/** 관전자 — 입력 카드 대신 안내 + 우리 반조 제출 읽기 */
function ViewerCard({ group, mine }: { group: BoardGroup; mine: BoardMySubmission[] }) {
  const rows = group.items.map((it) => ({ it, s: mine.find((m) => m.item_id === it.id) })).filter((r) => r.s && r.s.body);
  return (
    <div className="rounded-2xl bg-white/[0.08] p-4 ring-1 ring-white/20">
      <p className="flex items-center gap-2 text-[12px] font-bold">
        <span className="rounded-md bg-white/15 px-1.5 py-0.5">관전</span>
        <span className="text-white/50">{groupLabel(group.id)}</span>
      </p>
      <h2 className="mt-2 text-[22px] font-extrabold">{group.title}</h2>
      <p className="mt-2 text-[15px] font-bold text-white/80">기록자가 입력 중이에요</p>
      <p className="mt-1 text-[13px] leading-6 text-white/55">반조 이야기를 나누고, 투표가 열리면 참여해 주세요.</p>
      {rows.length ? (
        <div className="mt-3 rounded-xl bg-black/30 p-3">
          <p className="text-[12px] font-bold text-white/50">우리 반조 제출</p>
          {rows.map(({ it, s }) => (
            <p key={it.id} className="mt-1.5 whitespace-pre-wrap break-words text-[15px] leading-6 text-white/85">
              {group.items.length > 1 ? <span className="mr-1 text-white/45">{it.title}:</span> : null}
              {s!.body}
            </p>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** 보내지 못한 채 항목이 닫힌 답 — 사회자·종이 카드로 넘기도록 안내 */
function StaleOutbox({ me, openGroup }: { me: BoardMe; openGroup: BoardGroupId | null }) {
  const [box, setBox] = useState(() => lsGet<Outbox | null>(OUTBOX_KEY, null));
  if (!box || box.pid !== me.id || box.group === openGroup) return null;
  const g = groupById(box.group);
  return (
    <div className="rounded-2xl bg-[#FF5A3C]/15 p-4 text-[14px] leading-6 text-[#FFB4A6]" role="alert">
      <b className="text-white">{g?.title ?? box.group}</b> 답을 보내지 못한 채 입력이 닫혔어요. 아래 내용을 종이 카드에 옮기거나 진행자에게 알려 주세요.
      {Object.values(box.bodies)
        .filter(Boolean)
        .map((b) => (
          <p key={b} className="mt-2 whitespace-pre-wrap rounded-lg bg-black/30 p-2 text-white/85">
            {b}
          </p>
        ))}
      <button
        type="button"
        onClick={() => {
          lsSet(OUTBOX_KEY, null);
          setBox(null);
        }}
        className="mt-2 text-[13px] underline underline-offset-4"
      >
        확인했어요 (지우기)
      </button>
    </div>
  );
}

function SummaryRow({ group, opened, mine }: { group: BoardGroup; opened: boolean; mine: BoardMySubmission[] }) {
  const rows = group.items.map((it) => ({ it, s: mine.find((m) => m.item_id === it.id) }));
  const any = rows.some((r) => r.s);
  return (
    <div className={clsx('rounded-xl px-4 py-3', opened ? 'bg-white/[0.06]' : 'bg-white/[0.03] text-white/30')}>
      <p className="flex items-center gap-2 text-[13px] font-bold">
        <span className={opened ? 'text-white/50' : ''}>{groupLabel(group.id)}</span>
        <span className={opened ? 'text-white' : ''}>{group.title}</span>
        {!opened ? <span className="ml-auto text-[11px]">아직</span> : !any ? <span className="ml-auto text-[11px] text-[#FFB4A6]">미제출</span> : null}
      </p>
      {opened && any
        ? rows.map(({ it, s }) =>
            s && s.body ? (
              <p key={it.id} className="mt-1 whitespace-pre-wrap break-words text-[14px] leading-6 text-white/80">
                {group.items.length > 1 ? <span className="mr-1 text-white/45">{it.title}:</span> : null}
                {s.body}
              </p>
            ) : s ? (
              <p key={it.id} className="mt-1 text-[13px] text-white/40">
                {group.items.length > 1 ? `${it.title}: ` : ''}(비움)
              </p>
            ) : null,
          )
        : null}
    </div>
  );
}

function TeamSummary({ question, state, mine }: { question: 1 | 2; state: BoardState; mine: BoardMySubmission[] }) {
  const groups = BOARD_GROUPS.filter((g) => g.question === question && state.opened_groups.includes(g.id));
  if (!groups.length) return null;
  return (
    <div className="mt-8 flex flex-col gap-2 text-left">
      <p className="text-[12px] font-bold text-white/50">우리 반조 카드</p>
      {groups.map((g) => (
        <SummaryRow key={g.id} group={g} opened mine={mine} />
      ))}
    </div>
  );
}

// ─── 입력 카드 ────────────────────────────────────────────────

function EntryCard({
  group,
  state,
  me,
  mine,
  onSubmitted,
}: {
  group: BoardGroup;
  state: BoardState;
  me: BoardMe;
  mine: BoardMySubmission[];
  onSubmitted: () => Promise<void>;
}) {
  const submitted = group.items.some((it) => mine.some((m) => m.item_id === it.id));
  const serverBodies = useMemo(
    () => Object.fromEntries(group.items.map((it) => [it.id, mine.find((m) => m.item_id === it.id)?.body ?? ''])),
    [group, mine],
  );

  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState<Record<string, string>>(() => {
    const drafts = lsGet<Drafts>(DRAFT_KEY, {});
    return Object.fromEntries(group.items.map((it) => [it.id, drafts[`${me.team_id}:${it.id}`] ?? '']));
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [queued, setQueued] = useState(() => lsGet<Outbox | null>(OUTBOX_KEY, null)?.group === group.id);
  const [hintOpen, setHintOpen] = useState(false);

  const setValue = (id: string, v: string) => {
    setValues((prev) => ({ ...prev, [id]: v }));
    const drafts = lsGet<Drafts>(DRAFT_KEY, {});
    drafts[`${me.team_id}:${id}`] = v;
    lsSet(DRAFT_KEY, drafts);
  };

  const send = useCallback(
    async (bodies: Record<string, string>) => {
      setBusy(true);
      setErr('');
      try {
        await getBoardDb().submit(me.id, bodies);
        lsSet(OUTBOX_KEY, null);
        setQueued(false);
        setEditing(false);
        const drafts = lsGet<Drafts>(DRAFT_KEY, {});
        for (const it of group.items) delete drafts[`${me.team_id}:${it.id}`];
        lsSet(DRAFT_KEY, drafts);
        await onSubmitted();
      } catch (e) {
        const network = !(e instanceof BoardError) || e.code === 'BOARD_NETWORK';
        if (network) {
          lsSet(OUTBOX_KEY, { pid: me.id, group: group.id, bodies } satisfies Outbox);
          setQueued(true);
        }
        setErr(boardErrorText(e));
      } finally {
        setBusy(false);
      }
    },
    [group, me.id, me.team_id, onSubmitted],
  );

  // 다시 온라인이 되면 임시 저장분을 한 번 보낸다
  const sendRef = useRef(send);
  useEffect(() => {
    sendRef.current = send;
  }, [send]);
  const busyRef = useRef(false);
  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);
  useEffect(() => {
    // 다시 보내기: 온라인 복귀 · 상태 변경 · 5초마다 (서버만 죽었다 살아난 경우엔 online 이벤트가 없다)
    const retry = () => {
      const box = lsGet<Outbox | null>(OUTBOX_KEY, null);
      if (!busyRef.current && box && box.pid === me.id && box.group === group.id) void sendRef.current(box.bodies);
    };
    window.addEventListener('online', retry);
    const t = queued ? setInterval(retry, 5000) : null;
    if (queued) retry();
    return () => {
      window.removeEventListener('online', retry);
      if (t) clearInterval(t);
    };
  }, [group.id, me.id, queued, state.updated_at]);

  const missing = group.items.some((it) => it.required && !values[it.id]?.trim());
  const tooLong = group.items.some((it) => [...(values[it.id] ?? '')].length > BOARD_MAX_LEN);
  const showForm = !submitted || editing;
  const hints = BOARD_QUESTIONS[group.question].hints;

  return (
    <div className="rounded-2xl bg-white/[0.08] p-4 ring-2 ring-[#FFE300]/70">
      <p className="flex items-center gap-2 text-[12px] font-bold">
        <span className="rounded-md px-1.5 py-0.5 text-[#1E1E1E]" style={{ background: YELLOW }}>
          지금 입력
        </span>
        <span className="text-white/50">{groupLabel(group.id)}</span>
      </p>
      <h2 className="mt-2 text-[22px] font-extrabold">{group.title}</h2>

      {showForm ? (
        <>
          {group.items.map((it, idx) => (
            <div key={it.id} className={clsx(idx > 0 && 'mt-4')}>
              <label htmlFor={`f-${it.id}`} className="block text-[15px] font-bold leading-6 text-white/85">
                {it.prompt}
                {it.required ? null : <span className="ml-1 text-[12px] font-normal text-white/45">(선택 · 비워도 돼요)</span>}
              </label>
              {it.examples.length ? (
                <div className="mt-2" data-testid="entry-examples">
                  <p className="text-[12px] font-bold text-white/45">예시 — 이 정도로 가볍게 써도 돼요</p>
                  {it.examples.map((ex) => (
                    <p key={ex} className="mt-1.5 rounded-2xl rounded-tl-md bg-white/[0.05] px-3 py-2 text-[13px] leading-5 text-white/50">
                      {ex}
                    </p>
                  ))}
                </div>
              ) : null}
              <textarea
                id={`f-${it.id}`}
                value={values[it.id] ?? ''}
                onChange={(e) => setValue(it.id, e.target.value)}
                onFocus={(e) => {
                  const el = e.currentTarget;
                  setTimeout(() => el.scrollIntoView({ block: 'center', behavior: 'smooth' }), 300);
                }}
                rows={4}
                placeholder="2~3문장이면 충분해요"
                className="mt-2 w-full resize-y rounded-xl bg-[#0E0F13] p-3 text-[16px] leading-7 outline-none ring-1 ring-white/15 placeholder:text-white/25 focus:ring-2 focus:ring-[#FFE300]"
              />
              {[...(values[it.id] ?? '')].length > BOARD_MAX_LEN * 0.9 ? (
                <p className={clsx('mt-1 text-right text-[12px]', tooLong ? 'text-[#FFB4A6]' : 'text-white/40')}>
                  {[...(values[it.id] ?? '')].length} / {BOARD_MAX_LEN}
                </p>
              ) : null}
            </div>
          ))}

          <button type="button" onClick={() => setHintOpen((v) => !v)} className="mt-3 text-[13px] font-bold text-white/55" aria-expanded={hintOpen}>
            {hintOpen ? '▾' : '▸'} 막히면 힌트 보기
          </button>
          {hintOpen ? (
            <ol className="mt-2 flex flex-col gap-1.5 rounded-xl bg-black/30 p-3 text-[13px] leading-6 text-white/70">
              {hints.map((h) => (
                <li key={h} className="flex gap-1.5">
                  <span aria-hidden="true">·</span>
                  <span>{h}</span>
                </li>
              ))}
            </ol>
          ) : null}

          {err ? (
            <div className="mt-3 rounded-xl bg-[#FF5A3C]/15 p-3 text-[14px] text-[#FFB4A6]" role="alert">
              {queued ? '입력 내용 임시 저장됨 · ' : ''}
              {err}
            </div>
          ) : null}

          <div className="mt-4 flex gap-2">
            {editing ? (
              <button type="button" onClick={() => setEditing(false)} className="h-14 flex-1 rounded-2xl bg-white/10 text-[16px] font-bold">
                취소
              </button>
            ) : null}
            <button
              type="button"
              disabled={busy || missing || tooLong}
              onClick={() => void send(Object.fromEntries(group.items.map((it) => [it.id, values[it.id] ?? ''])))}
              className="h-14 flex-[2] rounded-2xl text-[18px] font-extrabold text-[#1E1E1E] disabled:opacity-40"
              style={{ background: YELLOW }}
            >
              {busy ? '보내는 중…' : queued ? '다시 보내기' : editing ? '수정 제출' : '제출'}
            </button>
          </div>
        </>
      ) : (
        <>
          {group.items.map((it) => (
            <div key={it.id} className="mt-3">
              {group.items.length > 1 ? <p className="text-[12px] font-bold text-white/50">{itemById(it.id)?.title}</p> : null}
              <p className="whitespace-pre-wrap break-words text-[16px] leading-7">{serverBodies[it.id] || <span className="text-white/40">(비움)</span>}</p>
            </div>
          ))}
          <div className="mt-4 flex items-center gap-3">
            <span className="rounded-full bg-[#3DDC97]/20 px-3 py-1 text-[13px] font-bold text-[#7CF0BE]">✓ 제출됨</span>
            {state.allow_edit ? (
              <button
                type="button"
                onClick={() => {
                  setValues(serverBodies);
                  setEditing(true);
                }}
                className="text-[14px] font-bold text-white/70 underline underline-offset-4"
              >
                수정
              </button>
            ) : (
              <span className="text-[12px] text-white/40">수정이 잠겨 있어요</span>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ─── 투표 (투표 대상 그룹 · 투표 중/순위 공개일 때) ─────────────────

function voteErrorText(e: unknown): string {
  if (e instanceof BoardError && e.code === 'BOARD_CLOSED') return '투표가 닫혔어요.';
  return boardErrorText(e);
}

/** 우리 반조 카드 키 — 투표 불가 표시용(내 반조라 보여 줘도 무기명이 깨지지 않는다) */
function ownCardsOf(mine: BoardMySubmission[], group: BoardGroup): Set<string> {
  return new Set(mine.filter((s) => group.items.some((it) => it.id === s.item_id)).map((s) => s.card));
}

function VoteScreen({ state, me, group, mine }: { state: BoardState; me: BoardMe; group: BoardGroup; mine: BoardMySubmission[] }) {
  const own = useMemo(() => ownCardsOf(mine, group), [mine, group]);
  return state.vote_reveal ? <RankScreen state={state} group={group} own={own} /> : <VoteList state={state} me={me} group={group} own={own} />;
}

function VoteList({ state, me, group, own }: { state: BoardState; me: BoardMe; group: BoardGroup; own: Set<string> }) {
  const feed = useBoardFeed([group.id], true, 3000, state.updated_at);
  const cards = useMemo(() => (feed ? toTeamCards(feed, group) : []), [feed, group]);
  const [votes, setVotes] = useState<BoardMyVotes | null>(null);
  const [busyCard, setBusyCard] = useState<string | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    let cancelled = false;
    const pull = () =>
      getBoardDb()
        .myVotes(me.id, group.id)
        .then((v) => {
          if (!cancelled) setVotes(v);
        })
        .catch(() => undefined);
    void pull();
    const t = setInterval(() => void pull(), 5000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [me.id, group.id]);

  const toggle = async (card: string, on: boolean) => {
    setBusyCard(card);
    setErr('');
    try {
      setVotes(await getBoardDb().vote(me.id, group.id, card, on));
    } catch (e) {
      setErr(voteErrorText(e));
    } finally {
      setBusyCard(null);
    }
  };

  const left = votes?.left ?? BOARD_MAX_VOTES;
  return (
    <section className="mt-4 flex flex-col gap-3">
      <div className="rounded-2xl p-4 text-[#1E1E1E]" style={{ background: YELLOW }}>
        <p className="text-[12px] font-extrabold">
          투표 · {groupLabel(group.id)} {group.title}
        </p>
        <p className="mt-1 text-[17px] font-extrabold leading-6">공감 가는 아이디어에 ♥ 를 눌러 주세요</p>
        <p className="mt-1 text-[14px] font-bold tabular-nums" data-testid="votes-left">
          남은 표 {left} / {BOARD_MAX_VOTES}
        </p>
      </div>
      {err ? (
        <p className="rounded-xl bg-[#FF5A3C]/15 p-3 text-[14px] text-[#FFB4A6]" role="alert">
          {err}
        </p>
      ) : null}
      {!feed ? <p className="py-8 text-center text-white/50">불러오는 중…</p> : null}
      {feed && cards.length === 0 ? <p className="py-8 text-center text-[14px] text-white/50">아직 카드가 없어요</p> : null}
      {cards.map((c) => {
        const mineCard = own.has(c.card);
        const on = votes?.my.includes(c.card) ?? false;
        return (
          <article key={c.card} data-own={mineCard ? 'true' : 'false'} className={clsx('rounded-2xl p-4', mineCard ? 'bg-white/[0.04] text-white/45' : 'bg-white/[0.08]')}>
            {c.parts.map((p) => (
              <p key={p.item_id} className="mt-1 whitespace-pre-wrap break-words text-[15px] leading-6 first:mt-0">
                {group.items.length > 1 ? <span className="mr-1 text-[12px] font-bold text-white/45">{itemById(p.item_id)?.title}</span> : null}
                {p.body}
              </p>
            ))}
            <div className="mt-3 flex items-center">
              {mineCard ? (
                <span className="rounded-full bg-white/10 px-3 py-1 text-[13px] font-bold text-white/55">우리 반조</span>
              ) : (
                <button
                  type="button"
                  aria-pressed={on}
                  aria-label={on ? '공감 취소' : '공감하기'}
                  disabled={busyCard === c.card || (!on && left <= 0)}
                  onClick={() => void toggle(c.card, !on)}
                  className={clsx(
                    'h-11 rounded-full px-5 text-[15px] font-extrabold transition disabled:opacity-35',
                    on ? 'text-[#1E1E1E]' : 'bg-white/10 text-white/80',
                  )}
                  style={on ? { background: YELLOW } : undefined}
                >
                  {on ? '♥ 공감함' : '♡ 공감'}
                </button>
              )}
            </div>
          </article>
        );
      })}
    </section>
  );
}

function RankScreen({ state, group, own }: { state: BoardState; group: BoardGroup; own: Set<string> }) {
  const rows = useBoardRanking(group.id, true, 3000, state.updated_at);
  const max = Math.max(1, ...(rows ?? []).map((r) => r.votes));
  return (
    <section className="mt-4 flex flex-col gap-3">
      <div className="rounded-2xl bg-white/[0.08] p-4">
        <p className="text-[12px] font-extrabold" style={{ color: YELLOW }}>
          투표 결과 · {groupLabel(group.id)} {group.title}
        </p>
        <p className="mt-1 text-[15px] text-white/70">공감을 많이 받은 순서예요.</p>
      </div>
      {!rows ? <p className="py-8 text-center text-white/50">불러오는 중…</p> : null}
      {rows?.map((r, i) => (
        <article key={r.card} className="rounded-2xl bg-white/[0.07] p-4">
          <p className="flex items-center gap-2 text-[13px] font-extrabold">
            <span style={{ color: i === 0 ? YELLOW : undefined }}>{i + 1}위</span>
            <span className="tabular-nums text-white/70">♥ {r.votes}</span>
            {own.has(r.card) ? <span className="ml-auto rounded-full bg-white/10 px-2 py-0.5 text-[11px] text-white/55">우리 반조</span> : null}
          </p>
          {r.parts.map((p) => (
            <p key={p.item_id} className="mt-1.5 whitespace-pre-wrap break-words text-[15px] leading-6 text-white/90">
              {group.items.length > 1 ? <span className="mr-1 text-[12px] font-bold text-white/45">{itemById(p.item_id)?.title}</span> : null}
              {p.body}
            </p>
          ))}
          <div className="mt-2 h-2 rounded-full bg-white/10">
            <div className="h-full rounded-full" style={{ width: `${(r.votes / max) * 100}%`, background: YELLOW }} />
          </div>
        </article>
      ))}
    </section>
  );
}

// ─── 폰 모아보기 (모아보기 공개일 때만) — 질문별 탭 ───────────────────

function PhoneWall({ question, currentItem, onBack }: { question: 1 | 2; currentItem: BoardGroupId | null; onBack: () => void }) {
  const [q, setQ] = useState<1 | 2>(question);
  const groups = BOARD_GROUPS.filter((g) => g.question === q);
  const [tab, setTab] = useState<BoardGroupId | null>(currentItem && groups.some((g) => g.id === currentItem) ? currentItem : null);
  const active = groups.find((g) => g.id === tab) ?? groups[0];
  const cards = useBoardFeed(
    groups.map((g) => g.id),
    true,
    5000,
  );
  const activeCards = cards ? toTeamCards(cards, active) : [];
  return (
    <section className="mt-4">
      <div className="flex items-center gap-2">
        <button type="button" onClick={onBack} className="text-[14px] text-white/60">
          ← 내 입력으로
        </button>
        <div className="ml-auto flex gap-1">
          {([1, 2] as const).map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => {
                setQ(n);
                setTab(null);
              }}
              className={clsx('rounded-lg px-3 py-1 text-[13px] font-bold', q === n ? 'bg-[#FFE300] text-[#1E1E1E]' : 'bg-white/10')}
            >
              질문 {n}
            </button>
          ))}
        </div>
      </div>
      <p className="mt-3 text-[12px] font-bold" style={{ color: YELLOW }}>
        {questionLabel(q)} · 모아보기
      </p>
      <div role="tablist" aria-label="모아보기 탭" className="mt-2 flex flex-wrap gap-1.5">
        {groups.map((g) => {
          const n = cards ? new Set(cards.filter((c) => g.items.some((it) => it.id === c.item_id)).map((c) => c.card)).size : 0;
          const here = g.id === active.id;
          return (
            <button
              key={g.id}
              type="button"
              role="tab"
              aria-selected={here}
              onClick={() => setTab(g.id)}
              className={clsx('rounded-lg px-2.5 py-1.5 text-[13px] font-bold', here ? 'bg-[#FFE300] text-[#1E1E1E]' : 'bg-white/10 text-white/80')}
            >
              {groupLabel(g.id)} <span className="tabular-nums opacity-70">{n}</span>
            </button>
          );
        })}
      </div>
      {!cards ? (
        <p className="py-10 text-center text-white/50">불러오는 중…</p>
      ) : (
        <div className="mt-4">
          <p className="text-[14px] font-extrabold">
            {active.title} <span className="text-white/40">{activeCards.length}</span>
          </p>
          <div className="mt-2 flex flex-col gap-2">
            {activeCards.length === 0 ? <p className="text-[13px] text-white/35">아직 카드가 없어요</p> : null}
            {activeCards.map((c) => (
              <div key={c.card} className="rounded-xl bg-white/[0.07] p-3">
                {c.parts.map((p, idx) => (
                  <p key={p.item_id} className={clsx('whitespace-pre-wrap break-words text-[14px] leading-6 text-white/85', idx > 0 && 'mt-1.5')}>
                    {active.items.length > 1 ? <span className="mr-1 text-[12px] font-bold text-white/45">{itemById(p.item_id)?.title}</span> : null}
                    {p.body}
                  </p>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
