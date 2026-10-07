'use client';

// 토의보드 운영자 화면 /board/admin (Board v1.0) — 퀴즈와 같은 운영자 키.
//   단계 제어(Space 다음 · R 다시 열기 · Esc 크게 보기 해제) · 타이머 · 토글 4종 · 현황표(58 × 7)
//   카드 목록(크게 보기 / 숨김 / 하이라이트) · CSV 2종 + JSON · 초기화(2단계 확인)
//   스냅샷은 2초마다 읽는다(제출 테이블은 방송하지 않으므로).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import { toast } from 'sonner';

import { OPERATOR_KEY, readStoredKey, writeStoredKey } from '@/lib/admin';
import { getBoardDb } from '@/lib/boardDb';
import { PHASE_LABEL, fmtClock, timerLeft, useNow } from '@/lib/boardClient';
import { download, fullJson, kst, longCsv, stamp, wideCsv } from '@/lib/boardExport';
import { BOARD_GROUPS, BOARD_TEAM_COUNT, groupById, itemById, type BoardGroupId } from '@/lib/boardSeed';
import {
  BoardError,
  boardErrorText,
  type BoardAdminSnapshot,
  type BoardAdminSubmission,
  type BoardFocus,
  type BoardState,
  type BoardStatePatch,
} from '@/lib/boardTypes';
import { NewVersionBanner } from '@/components/quiz/NewVersionBanner';

// ─── 진행 순서 ────────────────────────────────────────────────

interface Step {
  id: string;
  label: string;
  /** 이 단계로 들어갈 때 보낼 상태 */
  patch: BoardStatePatch;
  group?: BoardGroupId;
}

const STEPS: Step[] = [
  { id: 'waiting', label: '대기 (QR)', patch: { phase: 'waiting', current_item: null, focus: null, timer_minutes: 0 } },
  { id: 'q1_intro', label: '질문 ① 소개', patch: { phase: 'q1_intro', current_item: null, focus: null, wall_public: false, timer_minutes: 0 } },
  ...BOARD_GROUPS.filter((g) => g.question === 1).map((g) => ({
    id: g.id,
    label: `${g.id} ${g.title}`,
    group: g.id,
    patch: { phase: 'item_open' as const, current_item: g.id, item_open: true, focus: null },
  })),
  { id: 'wall1', label: '월 보기 ①', patch: { phase: 'wall', current_item: 'Q1-1', wall_public: true, focus: null, timer_minutes: 0 } },
  { id: 'break', label: '휴식', patch: { phase: 'break', focus: null, wall_public: false } },
  { id: 'q2_intro', label: '질문 ② 소개', patch: { phase: 'q2_intro', current_item: null, focus: null, wall_public: false, timer_minutes: 0 } },
  ...BOARD_GROUPS.filter((g) => g.question === 2).map((g) => ({
    id: g.id,
    label: `${g.id} ${g.title}`,
    group: g.id,
    patch: { phase: 'item_open' as const, current_item: g.id, item_open: true, focus: null },
  })),
  { id: 'wall2', label: '월 보기 ②', patch: { phase: 'wall', current_item: 'Q2-1', wall_public: true, focus: null, timer_minutes: 0 } },
  { id: 'ended', label: '종료', patch: { phase: 'ended', focus: null, timer_minutes: 0 } },
];

function stepIndex(s: BoardState): number {
  if (s.phase === 'item_open') return STEPS.findIndex((x) => x.group === s.current_item);
  if (s.phase === 'wall') return STEPS.findIndex((x) => x.id === (s.question === 2 ? 'wall2' : 'wall1'));
  return STEPS.findIndex((x) => x.id === s.phase);
}

/** 항목을 열 때 기본 타이머(분) — 질문 ① 항목 약 2.5분, 질문 ② 아젠다 6분 */
const DEFAULT_MIN: Record<1 | 2, number> = { 1: 3, 2: 6 };

// ─── 키 게이트 ────────────────────────────────────────────────

export function BoardAdmin() {
  const [key, setKey] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const tryKey = useCallback(async (k: string, silent: boolean) => {
    setBusy(true);
    try {
      if (getBoardDb().mode === 'local' && OPERATOR_KEY && k !== OPERATOR_KEY) throw new BoardError('BOARD_FORBIDDEN');
      await getBoardDb().adminSnapshot(k);
      writeStoredKey(k);
      setKey(k);
    } catch (e) {
      if (!silent) setErr(e instanceof BoardError && e.code === 'BOARD_FORBIDDEN' ? '키가 맞지 않아요.' : boardErrorText(e));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get('key');
    const k = fromUrl ?? readStoredKey();
    const t = setTimeout(() => void tryKey(k, true), 0);
    if (fromUrl) window.history.replaceState(null, '', window.location.pathname);
    return () => clearTimeout(t);
  }, [tryKey]);

  if (key !== null) return <Console opKey={key} />;
  return (
    <main className="flex min-h-dvh items-center justify-center bg-[#F4F2EC] p-6">
      <form
        className="w-full max-w-[380px] rounded-2xl bg-white p-6 shadow"
        onSubmit={(e) => {
          e.preventDefault();
          setErr('');
          void tryKey(input.trim(), false);
        }}
      >
        <h1 className="text-[20px] font-extrabold">토의보드 운영</h1>
        <p className="mt-1 text-[13px] text-black/55">퀴즈 운영 화면과 같은 운영자 키</p>
        <input
          type="password"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          autoFocus
          className="mt-4 h-11 w-full rounded-lg border border-black/15 px-3 text-[15px]"
          placeholder="운영자 키"
        />
        {err ? <p className="mt-2 text-[13px] text-[#C23A1E]">{err}</p> : null}
        <button type="submit" disabled={busy} className="mt-4 h-11 w-full rounded-lg bg-[#1E1E1E] text-[15px] font-bold text-white disabled:opacity-40">
          {busy ? '확인 중…' : '열기'}
        </button>
      </form>
    </main>
  );
}

// ─── 콘솔 ─────────────────────────────────────────────────────

function Console({ opKey }: { opKey: string }) {
  const [snap, setSnap] = useState<BoardAdminSnapshot | null>(null);
  const [offset, setOffset] = useState(0);
  const [netErr, setNetErr] = useState(false);
  const [busy, setBusy] = useState(false);
  // 상태(busy)는 다음 렌더까지 안 바뀌므로, 키를 빠르게 두 번 눌러도 한 번만 가게 동기 잠금을 둔다
  const busyRef = useRef(false);
  const [autoTimer, setAutoTimer] = useState(true);
  const [timerMin, setTimerMin] = useState('3');
  const now = useNow();

  const pull = useCallback(async () => {
    try {
      const t0 = Date.now();
      const s = await getBoardDb().adminSnapshot(opKey);
      const t1 = Date.now();
      setSnap(s);
      setOffset(new Date(s.server_now).getTime() - (t0 + (t1 - t0) / 2));
      setNetErr(false);
    } catch {
      setNetErr(true);
    }
  }, [opKey]);

  useEffect(() => {
    const first = setTimeout(() => void pull(), 0);
    const t = setInterval(() => void pull(), 2000);
    // 상태가 바뀌면(다른 운영 탭 포함) 즉시 다시 읽는다
    const unsub = getBoardDb().subscribeState(() => void pull());
    return () => {
      clearTimeout(first);
      clearInterval(t);
      unsub();
    };
  }, [pull]);

  const apply = useCallback(
    async (patch: BoardStatePatch, okMsg?: string) => {
      if (busyRef.current) return;
      busyRef.current = true;
      setBusy(true);
      try {
        await getBoardDb().setState(opKey, patch);
        if (okMsg) toast.success(okMsg);
        await pull();
      } catch (e) {
        toast.error(boardErrorText(e));
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [opKey, pull],
  );

  const state = snap?.state ?? null;
  const idx = state ? stepIndex(state) : -1;

  const goStep = useCallback(
    (i: number) => {
      const step = STEPS[i];
      if (!step) return;
      const g = groupById(step.group);
      const patch: BoardStatePatch = { ...step.patch };
      if (g && autoTimer) patch.timer_minutes = DEFAULT_MIN[g.question];
      void apply(patch);
    },
    [apply, autoTimer],
  );

  /** Space — 열린 항목이면 닫기, 아니면 다음 단계 */
  const next = useCallback(() => {
    if (!state || busyRef.current) return;
    if (state.phase === 'item_open' && state.item_open) {
      void apply({ item_open: false, timer_minutes: 0 });
      return;
    }
    goStep(Math.min(idx + 1, STEPS.length - 1));
  }, [state, idx, apply, goStep]);

  const reopen = useCallback(() => {
    if (!state?.current_item || busyRef.current) return;
    const g = groupById(state.current_item);
    void apply({ phase: 'item_open', item_open: true, ...(autoTimer && g ? { timer_minutes: DEFAULT_MIN[g.question] } : {}) });
  }, [state, apply, autoTimer]);

  const clearFocus = useCallback(() => void apply({ focus: null }), [apply]);

  // 단축키
  const keysRef = useRef({ next, reopen, clearFocus });
  useEffect(() => {
    keysRef.current = { next, reopen, clearFocus };
  }, [next, reopen, clearFocus]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.repeat) {
        if (e.code === 'Space') e.preventDefault();
        return;
      }
      if (e.code === 'Space') {
        e.preventDefault();
        keysRef.current.next();
      } else if (e.key === 'r' || e.key === 'R') {
        keysRef.current.reopen();
      } else if (e.key === 'Escape') {
        keysRef.current.clearFocus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!snap || !state) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-[#F4F2EC] text-black/50">
        {netErr ? '연결이 불안정해요 — 다시 시도하는 중…' : '불러오는 중…'}
      </main>
    );
  }

  const left = timerLeft(state, now, offset);
  const group = groupById(state.current_item);
  const joined = snap.teams.filter((t) => t.devices > 0).length;
  const submittedNow = group
    ? new Set(snap.submissions.filter((s) => group.items.some((i) => i.id === s.item_id)).map((s) => s.team_id)).size
    : 0;

  return (
    <main className="min-h-dvh bg-[#F4F2EC] text-[#1E1E1E]">
      <NewVersionBanner />
      {netErr ? <div className="bg-[#C23A1E] px-4 py-1.5 text-[13px] font-bold text-white">연결이 끊겼어요 — 화면 정보가 최신이 아닐 수 있어요</div> : null}

      {/* 상단 상태 줄 */}
      <header className="sticky top-0 z-30 border-b border-black/10 bg-white/95 px-5 py-3 backdrop-blur">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-[18px] font-extrabold">토의보드 운영</h1>
          <span className="rounded-md bg-[#1E1E1E] px-2.5 py-1 text-[14px] font-bold text-[#FFE300]">
            {PHASE_LABEL[state.phase]}
            {group ? ` · ${group.id} ${group.title}` : ''}
            {state.phase === 'item_open' ? (state.item_open ? ' · 열림' : ' · 닫힘') : ''}
          </span>
          <span className="text-[14px] tabular-nums">
            입장 <b>{joined}</b>/{BOARD_TEAM_COUNT}
            {group ? (
              <>
                {' · '}제출 <b>{submittedNow}</b>/{BOARD_TEAM_COUNT}
              </>
            ) : null}
          </span>
          {left !== null ? (
            <span className={clsx('rounded-md px-2 py-0.5 text-[16px] font-extrabold tabular-nums', left <= 60_000 ? 'bg-[#FF5A3C] text-white' : 'bg-black/5')}>
              ⏱ {fmtClock(left)}
            </span>
          ) : null}
          <span className="ml-auto flex gap-2 text-[13px]">
            <a href="/board/screen" target="_blank" rel="noreferrer" className="rounded-md border border-black/15 px-2.5 py-1 font-bold">
              송출 화면 ↗
            </a>
            <a href="/board" target="_blank" rel="noreferrer" className="rounded-md border border-black/15 px-2.5 py-1 font-bold">
              참가자 화면 ↗
            </a>
          </span>
        </div>
      </header>

      <div className="grid gap-5 p-5 xl:grid-cols-[360px_1fr]">
        {/* 왼쪽: 진행 */}
        <section className="flex flex-col gap-4">
          <Panel title="진행 순서" hint="Space 다음(열린 항목은 닫기) · R 다시 열기 · Esc 크게 보기 해제">
            <ol className="flex flex-col gap-1">
              {STEPS.map((s, i) => {
                const active = i === idx;
                const done = s.group ? state.opened_groups.includes(s.group) : i < idx;
                return (
                  <li key={s.id}>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => goStep(i)}
                      className={clsx(
                        'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[14px]',
                        active ? 'bg-[#1E1E1E] font-bold text-[#FFE300]' : 'hover:bg-black/5',
                      )}
                    >
                      <span className={clsx('w-4 text-center text-[12px]', active ? '' : 'text-black/35')}>{done && !active ? '✓' : i + 1}</span>
                      <span className="flex-1">{s.label}</span>
                      {s.group ? (
                        <span className={clsx('text-[12px] tabular-nums', active ? 'text-white/70' : 'text-black/40')}>
                          {new Set(snap.submissions.filter((x) => groupById(s.group)!.items.some((it) => it.id === x.item_id)).map((x) => x.team_id)).size}
                        </span>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ol>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button type="button" disabled={busy} onClick={next} className="h-11 rounded-lg bg-[#1E1E1E] text-[15px] font-bold text-white disabled:opacity-40">
                {state.phase === 'item_open' && state.item_open ? '닫기 (Space)' : '다음 ▶ (Space)'}
              </button>
              <button
                type="button"
                disabled={busy || !state.current_item}
                onClick={reopen}
                className="h-11 rounded-lg border border-black/20 text-[15px] font-bold disabled:opacity-40"
              >
                다시 열기 (R)
              </button>
            </div>
          </Panel>

          <Panel title="타이머">
            <div className="flex items-center gap-2">
              <input
                value={timerMin}
                onChange={(e) => setTimerMin(e.target.value.replace(/[^0-9.]/g, ''))}
                inputMode="decimal"
                className="h-10 w-16 rounded-lg border border-black/15 px-2 text-center text-[15px]"
                aria-label="분"
              />
              <span className="text-[13px]">분</span>
              <button type="button" disabled={busy} onClick={() => void apply({ timer_minutes: Number(timerMin) || 0 })} className="h-10 rounded-lg bg-[#1E1E1E] px-3 text-[14px] font-bold text-white">
                시작
              </button>
              <button type="button" disabled={busy} onClick={() => void apply({ timer_extend_sec: 60 })} className="h-10 rounded-lg border border-black/20 px-3 text-[14px] font-bold">
                +1분
              </button>
              <button type="button" disabled={busy} onClick={() => void apply({ timer_minutes: 0 })} className="h-10 rounded-lg border border-black/20 px-3 text-[14px]">
                끄기
              </button>
            </div>
            <label className="mt-2 flex items-center gap-2 text-[13px] text-black/70">
              <input type="checkbox" checked={autoTimer} onChange={(e) => setAutoTimer(e.target.checked)} />
              항목을 열 때 자동 시작 (질문 ① {DEFAULT_MIN[1]}분 · 질문 ② {DEFAULT_MIN[2]}분)
            </label>
          </Panel>

          <Panel title="설정">
            <div className="flex flex-col gap-2">
              <Toggle label="수정 허용" desc="같은 반조의 재제출을 덮어쓰기" on={state.allow_edit} onChange={(v) => void apply({ allow_edit: v })} />
              <Toggle label="월 공개" desc="참가자 폰에서 다른 반조 카드 읽기" on={state.wall_public} onChange={(v) => void apply({ wall_public: v })} />
              <Toggle label="효과음" desc="새 카드가 붙을 때 송출 PC에서 알림음" on={state.sound_on} onChange={(v) => void apply({ sound_on: v })} />
              <Toggle label="밝은 송출" desc="끄면 어두운 배경" on={state.screen_theme === 'light'} onChange={(v) => void apply({ screen_theme: v ? 'light' : 'dark' })} />
              <label className="flex items-center gap-2 text-[14px]">
                <span className="font-bold">월 자동 스크롤</span>
                <select
                  value={state.scroll_speed}
                  onChange={(e) => void apply({ scroll_speed: Number(e.target.value) })}
                  className="ml-auto h-9 rounded-lg border border-black/15 px-2 text-[14px]"
                >
                  <option value={0}>끔</option>
                  <option value={20}>느리게</option>
                  <option value={40}>보통</option>
                  <option value={80}>빠르게</option>
                </select>
              </label>
            </div>
          </Panel>

          <Panel title="내보내기">
            <div className="grid grid-cols-3 gap-2">
              <button type="button" onClick={() => download(`board_wide_${stamp()}.csv`, wideCsv(snap.submissions), 'text/csv;charset=utf-8')} className="h-10 rounded-lg bg-[#1E1E1E] text-[13px] font-bold text-white">
                와이드 CSV
              </button>
              <button type="button" onClick={() => download(`board_long_${stamp()}.csv`, longCsv(snap.submissions), 'text/csv;charset=utf-8')} className="h-10 rounded-lg bg-[#1E1E1E] text-[13px] font-bold text-white">
                롱 CSV
              </button>
              <button type="button" onClick={() => download(`board_all_${stamp()}.json`, fullJson(snap), 'application/json')} className="h-10 rounded-lg border border-black/20 text-[13px] font-bold">
                JSON
              </button>
            </div>
            <p className="mt-2 text-[12px] text-black/50">와이드 = 반조 58행 × 항목 8칸(숨김 카드는 빈칸) · 롱 = 제출 1건 1행(숨김 포함)</p>
          </Panel>

          <ResetPanel opKey={opKey} group={state.current_item} onDone={pull} />
        </section>

        {/* 오른쪽: 카드 · 현황 */}
        <section className="flex min-w-0 flex-col gap-5">
          {/* 단계·항목이 바뀌면 고른 탭을 비운다(예전 탭의 카드를 크게 보기로 보내지 않게) */}
          <CardsPanel key={`${state.phase}:${state.current_item}`} opKey={opKey} snap={snap} state={state} apply={apply} onChanged={pull} />
          <MatrixPanel snap={snap} state={state} />
        </section>
      </div>
    </main>
  );
}

function Panel({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl bg-white p-4 shadow-sm">
      <h2 className="text-[15px] font-extrabold">{title}</h2>
      {hint ? <p className="mt-0.5 text-[12px] text-black/50">{hint}</p> : null}
      <div className="mt-3">{children}</div>
    </div>
  );
}

function Toggle({ label, desc, on, onChange }: { label: string; desc: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} onClick={() => onChange(!on)} className="flex items-center gap-3 rounded-lg px-1 py-1 text-left">
      <span className={clsx('relative h-6 w-11 shrink-0 rounded-full transition', on ? 'bg-[#1E1E1E]' : 'bg-black/20')}>
        <span className={clsx('absolute top-0.5 h-5 w-5 rounded-full bg-white transition', on ? 'left-[22px] bg-[#FFE300]' : 'left-0.5')} />
      </span>
      <span>
        <span className="block text-[14px] font-bold">{label}</span>
        <span className="block text-[12px] text-black/50">{desc}</span>
      </span>
    </button>
  );
}

// ─── 카드 목록 ────────────────────────────────────────────────

function CardsPanel({
  opKey,
  snap,
  state,
  apply,
  onChanged,
}: {
  opKey: string;
  snap: BoardAdminSnapshot;
  state: BoardState;
  apply: (p: BoardStatePatch, ok?: string) => Promise<void>;
  onChanged: () => Promise<void>;
}) {
  const [picked, setPicked] = useState<BoardGroupId | null>(null);
  const [q, setQ] = useState('');
  const [team, setTeam] = useState('');
  const groupId = picked ?? state.current_item ?? 'Q1-1';
  const group = groupById(groupId)!;

  const cards = useMemo(() => {
    const by = new Map<string, BoardAdminSubmission[]>();
    for (const s of snap.submissions) {
      if (!group.items.some((i) => i.id === s.item_id)) continue;
      by.set(s.team_id, [...(by.get(s.team_id) ?? []), s]);
    }
    const order = (id: string) => group.items.findIndex((i) => i.id === id);
    return [...by.entries()]
      .map(([team_id, rows]) => ({
        team_id,
        rows: rows.sort((a, b) => order(a.item_id) - order(b.item_id)),
        updated_at: rows.map((r) => r.updated_at).sort().at(-1)!,
      }))
      .filter((c) => (!team || c.team_id.toUpperCase().startsWith(team.toUpperCase())) && (!q || c.rows.some((r) => r.body.includes(q))))
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  }, [snap.submissions, group, q, team]);

  const isExec = (id: string) => snap.teams.find((t) => t.id === id)?.is_exec;

  const focus = (team_id: string, rows: BoardAdminSubmission[]) => {
    const f: BoardFocus = { team_id, group: group.id, items: rows.filter((r) => !r.hidden).map((r) => ({ item_id: r.item_id, body: r.body })) };
    void apply({ focus: f }, `${team_id} 크게 보기`);
  };

  const moderate = async (row: BoardAdminSubmission, action: 'hide' | 'unhide' | 'highlight' | 'unhighlight') => {
    let note: string | undefined;
    if (action === 'hide') {
      const v = window.prompt(`${row.team_id} ${row.item_id} 카드를 송출·CSV에서 숨깁니다. 사유 메모(선택):`, '');
      if (v === null) return;
      note = v;
    }
    try {
      await getBoardDb().moderate(opKey, row.id, action, note);
      await onChanged();
    } catch (e) {
      toast.error(boardErrorText(e));
    }
  };

  const selectGroup = (g: BoardGroupId) => {
    setPicked(g);
    // 월 보기 단계에서는 탭을 고르면 송출 화면도 그 항목으로 바뀐다
    if (state.phase === 'wall') void apply({ current_item: g, focus: null });
  };

  return (
    <div className="rounded-2xl bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-[15px] font-extrabold">카드</h2>
        <div className="flex flex-wrap gap-1">
          {BOARD_GROUPS.map((g) => (
            <button
              key={g.id}
              type="button"
              onClick={() => selectGroup(g.id)}
              className={clsx(
                'rounded-md px-2 py-1 text-[12px] font-bold',
                g.id === groupId ? 'bg-[#1E1E1E] text-[#FFE300]' : 'bg-black/5',
                g.id === state.current_item && g.id !== groupId && 'ring-1 ring-[#1E1E1E]',
              )}
            >
              {g.id}
            </button>
          ))}
        </div>
        {state.phase === 'wall' ? <span className="text-[12px] text-black/50">← 고르면 송출 화면도 바뀜</span> : null}
        <div className="ml-auto flex gap-2">
          <input value={team} onChange={(e) => setTeam(e.target.value)} placeholder="반조 (예: 12A)" className="h-9 w-28 rounded-lg border border-black/15 px-2 text-[13px]" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="본문 검색" className="h-9 w-40 rounded-lg border border-black/15 px-2 text-[13px]" />
          {state.focus ? (
            <button type="button" onClick={() => void apply({ focus: null })} className="h-9 rounded-lg bg-[#FF5A3C] px-3 text-[13px] font-bold text-white">
              크게 보기 해제 ({state.focus.team_id})
            </button>
          ) : null}
        </div>
      </div>
      <p className="mt-1 text-[12px] text-black/50">
        {group.id} {group.title} · {cards.length}개 반조
      </p>
      <div className="mt-3 grid max-h-[560px] gap-2 overflow-y-auto pr-1 md:grid-cols-2 2xl:grid-cols-3">
        {cards.length === 0 ? <p className="py-6 text-[13px] text-black/40">아직 카드가 없어요</p> : null}
        {cards.map((c) => {
          const allHidden = c.rows.every((r) => r.hidden);
          const focused = state.focus?.team_id === c.team_id && state.focus.group === group.id;
          return (
            <article
              key={c.team_id}
              className={clsx('rounded-xl border p-3', allHidden ? 'border-dashed border-black/20 bg-black/[0.03] opacity-60' : 'border-black/10', focused && 'ring-2 ring-[#FF5A3C]')}
            >
              <div className="flex items-center gap-2">
                <span className="rounded-md bg-[#FFE300] px-2 py-0.5 text-[14px] font-extrabold">{c.team_id}</span>
                {isExec(c.team_id) ? <span className="rounded bg-[#1E1E1E] px-1.5 text-[11px] font-bold text-white">임원</span> : null}
                <span className="ml-auto text-[11px] tabular-nums text-black/45">{kst(c.updated_at).slice(11)}</span>
              </div>
              {c.rows.map((r) => (
                <div key={r.id} className="mt-2">
                  {group.items.length > 1 ? <p className="text-[11px] font-bold text-black/45">{itemById(r.item_id)?.title}</p> : null}
                  <p className={clsx('whitespace-pre-wrap break-words text-[14px] leading-6', r.hidden && 'line-through')}>{r.body || <span className="text-black/35">(비움)</span>}</p>
                  {r.hidden ? <p className="text-[11px] text-[#C23A1E]">숨김{r.hidden_note ? ` — ${r.hidden_note}` : ''}</p> : null}
                  {r.edited_count > 0 ? <p className="text-[11px] text-black/40">수정 {r.edited_count}회</p> : null}
                  <div className="mt-1 flex gap-1.5 text-[12px]">
                    {r.hidden ? (
                      <button type="button" onClick={() => void moderate(r, 'unhide')} className="rounded border border-black/15 px-2 py-0.5">
                        숨김 해제
                      </button>
                    ) : (
                      <button type="button" onClick={() => void moderate(r, 'hide')} className="rounded border border-black/15 px-2 py-0.5">
                        숨김
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => void moderate(r, r.highlighted ? 'unhighlight' : 'highlight')}
                      className={clsx('rounded px-2 py-0.5', r.highlighted ? 'bg-[#FFE300] font-bold' : 'border border-black/15')}
                    >
                      {r.highlighted ? '★ 하이라이트' : '하이라이트'}
                    </button>
                  </div>
                </div>
              ))}
              {!allHidden ? (
                <button type="button" onClick={() => focus(c.team_id, c.rows)} className="mt-2 h-8 w-full rounded-lg bg-[#1E1E1E] text-[13px] font-bold text-white">
                  {focused ? '크게 보는 중' : '크게 보기'}
                </button>
              ) : null}
            </article>
          );
        })}
      </div>
    </div>
  );
}

// ─── 현황표 ───────────────────────────────────────────────────

function MatrixPanel({ snap, state }: { snap: BoardAdminSnapshot; state: BoardState }) {
  const cur = groupById(state.current_item);
  const cell = (teamId: string, gid: BoardGroupId) => {
    const g = groupById(gid)!;
    const rows = snap.submissions.filter((s) => s.team_id === teamId && g.items.some((i) => i.id === s.item_id));
    if (!rows.length) return { mark: '', cls: '' };
    const filled = rows.some((r) => r.body);
    const edited = rows.some((r) => r.edited_count > 0);
    const hidden = rows.some((r) => r.hidden);
    if (hidden) return { mark: '숨', cls: 'bg-black/10 text-black/50' };
    if (!filled) return { mark: '비움', cls: 'bg-black/5 text-black/45' };
    return edited ? { mark: '✎', cls: 'bg-[#BFE8D2] text-[#1B6B45]' } : { mark: '✓', cls: 'bg-[#D7F2E3] text-[#1B6B45]' };
  };
  const missingNow = (teamId: string) =>
    cur && state.opened_groups.includes(cur.id) && !snap.submissions.some((s) => s.team_id === teamId && cur.items.some((i) => i.id === s.item_id));

  return (
    <div className="rounded-2xl bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-baseline gap-3">
        <h2 className="text-[15px] font-extrabold">현황표</h2>
        <p className="text-[12px] text-black/50">✓ 제출 · ✎ 수정됨 · 비움 = 선택 항목 빈 제출 · 숨 = 숨김 · 주황 줄 = 입장했지만 지금 항목 미제출 · 회색 = 미입장</p>
      </div>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[640px] border-separate border-spacing-y-0.5 text-[12px]">
          <thead>
            <tr className="text-left text-black/50">
              <th className="px-2 font-bold">반조</th>
              <th className="px-1 font-bold">기기</th>
              {BOARD_GROUPS.map((g) => (
                <th key={g.id} className={clsx('px-1 text-center font-bold', g.id === state.current_item && 'text-[#1E1E1E]')}>
                  {g.id}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {snap.teams.map((t) => {
              const absent = t.devices === 0;
              const warn = !absent && missingNow(t.id);
              return (
                <tr key={t.id} className={clsx(absent && 'text-black/30', warn && 'bg-[#FFE7D6]')}>
                  <td className="whitespace-nowrap px-2 py-0.5 font-bold">
                    {t.id}
                    {t.is_exec ? <span className="ml-1 rounded bg-[#1E1E1E] px-1 text-[10px] text-white">임원</span> : null}
                  </td>
                  <td className="px-1 tabular-nums">{t.devices || '–'}</td>
                  {BOARD_GROUPS.map((g) => {
                    const c = cell(t.id, g.id);
                    return (
                      <td key={g.id} className="px-0.5 py-0.5 text-center">
                        <span className={clsx('inline-block h-5 min-w-9 rounded px-1 leading-5', c.cls || 'bg-black/[0.03]')}>{c.mark}</span>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── 초기화 ───────────────────────────────────────────────────

function ResetPanel({ opKey, group, onDone }: { opKey: string; group: BoardGroupId | null; onDone: () => Promise<void> }) {
  const [armed, setArmed] = useState<'group' | 'all' | null>(null);
  const run = async (scope: 'group' | 'all') => {
    try {
      await getBoardDb().reset(opKey, scope, scope === 'group' ? (group ?? undefined) : undefined);
      toast.success(scope === 'all' ? '전체 초기화 완료 (참가자 포함)' : `${group} 제출을 지웠어요`);
      setArmed(null);
      await onDone();
    } catch (e) {
      toast.error(boardErrorText(e));
    }
  };
  return (
    <Panel title="초기화" hint="CSV를 먼저 내보내세요. 되돌릴 수 없어요.">
      {armed ? (
        <div className="rounded-lg bg-[#FFE7E1] p-3">
          <p className="text-[13px] font-bold text-[#C23A1E]">
            {armed === 'all' ? '모든 제출과 참가자를 지우고 대기 상태로 돌아갑니다.' : `${group} 항목의 제출을 모두 지웁니다.`} 정말 초기화할까요?
          </p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setArmed(null)} className="h-9 rounded-lg border border-black/20 text-[13px] font-bold">
              취소
            </button>
            <button type="button" onClick={() => void run(armed)} className="h-9 rounded-lg bg-[#C23A1E] text-[13px] font-bold text-white">
              정말 초기화
            </button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <button type="button" disabled={!group} onClick={() => setArmed('group')} className="h-9 rounded-lg border border-[#C23A1E]/40 text-[13px] font-bold text-[#C23A1E] disabled:opacity-30">
            이 항목만 ({group ?? '—'})
          </button>
          <button type="button" onClick={() => setArmed('all')} className="h-9 rounded-lg border border-[#C23A1E]/40 text-[13px] font-bold text-[#C23A1E]">
            전체 (참가자 포함)
          </button>
        </div>
      )}
    </Panel>
  );
}
