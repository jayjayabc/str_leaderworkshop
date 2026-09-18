// 보드 전역 상태 — zustand 단일 스토어 (BRIEF §10)

import { create } from 'zustand';
import { toast } from 'sonner';

import { getDb, dbMode, type BoardAdapter, type DbMode } from '@/lib/db';
import { resolveNickname } from '@/lib/anon';
import { normalizeText, uid } from '@/lib/snapshot';
import {
  AXIS_MAP,
  directionParticle,
  objectParticle,
  pickColor,
  placeEmoji,
  placeLabel,
} from '@/lib/design';
import {
  UNDOABLE_EVENTS,
  type AxisKey,
  type Board,
  type BoardEvent,
  type BoardSnapshot,
  type Keyword,
  type Note,
  type Participant,
  type Phase,
  type PlaceKey,
  type Placement,
  type PresenceState,
  type Vote,
  type ZoneKey,
  type BoardSettings,
} from '@/lib/types';

/** 1인 점 스티커 수 (BRIEF §6.3) */
export const VOTES_PER_PERSON = 3;
/** 되돌리기 탐색 범위 (BRIEF §6.6) */
export const UNDO_DEPTH = 20;

const ME_KEY = (slug: string) => `eb:me:${slug}`;
const HOST_KEY = (slug: string) => `eb:host:${slug}`;
/** 이 기기에서 카드를 한 번이라도 놓았는지 (폰 첫 사용 안내를 끄는 기준) */
const PLACED_KEY = 'eb:placed';
/** 이 보드를 이 기기에서 연 적이 있는지 (폰 첫 방문에 풀 서랍을 열어 주는 기준) */
const VISITED_KEY = (slug: string) => `eb:visited:${slug}`;

export function readPlacedFlag(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    return window.localStorage.getItem(PLACED_KEY) === '1';
  } catch {
    return true;
  }
}

/**
 * 이 보드의 첫 방문이면 true를 돌려주고 방문 기록을 남긴다.
 * (폰에서 풀 서랍을 자동으로 한 번 열어 주기 위해 쓴다)
 */
export function takeFirstVisit(slug: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    if (window.localStorage.getItem(VISITED_KEY(slug)) === '1') return false;
    window.localStorage.setItem(VISITED_KEY(slug), '1');
    return true;
  } catch {
    return false;
  }
}

export function readMe(slug: string): Participant | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(ME_KEY(slug));
    return raw ? (JSON.parse(raw) as Participant) : null;
  } catch {
    return null;
  }
}

/**
 * 조 보드 입장 시 홈에서 미리 신원을 저장한다 (참가 모달을 건너뛰기 위해).
 * 이름이 비어 있으면 자동 별칭(`익명-XXX`)이 붙는다 — 키보드 없이도 입장할 수 있도록 (v1.1.1).
 */
export function saveIdentity(slug: string, nickname: string, boardId: string): Participant {
  const id = uid();
  const name = resolveNickname(nickname);
  const me: Participant = {
    id,
    board_id: boardId,
    nickname: name,
    color: pickColor(id + name),
    last_seen: new Date().toISOString(),
  };
  try {
    window.localStorage.setItem(ME_KEY(slug), JSON.stringify(me));
  } catch {
    /* noop */
  }
  return me;
}

export function readHostToken(slug: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(HOST_KEY(slug));
  } catch {
    return null;
  }
}

export function writeHostToken(slug: string, token: string): void {
  try {
    window.localStorage.setItem(HOST_KEY(slug), token);
  } catch {
    /* noop */
  }
}

interface BoardStore {
  db: BoardAdapter;
  mode: DbMode;
  slug: string | null;
  loading: boolean;
  missing: boolean;

  board: Board | null;
  keywords: Keyword[];
  placements: Placement[];
  notes: Note[];
  votes: Vote[];
  events: BoardEvent[];

  me: Participant | null;
  isHost: boolean;
  presence: PresenceState[];
  draggingKeyword: string | null;
  openCard: string | null;
  /** 탭-투-플레이스 액션 시트에 열려 있는 카드 (v1.1 — 폰 1순위 경로) */
  actionCard: string | null;
  /** 이 기기에서 카드를 놓아 본 적이 있는지 (폰 첫 사용 안내 표시 기준) */
  hasPlaced: boolean;

  /** 보드에 저장되지 않는 로컬 뷰 상태 */
  highlight: string | null;
  present: boolean;
  highlightTop: boolean;

  init: (slug: string) => Promise<void>;
  dispose: () => void;
  join: (nickname: string) => Promise<void>;
  /** 참가 후 이름 바꾸기 (v1.1.1) — 이 slug의 신원과 프레즌스를 갱신한다 */
  renameMe: (nickname: string) => Promise<void>;
  refresh: () => Promise<void>;

  movePlacement: (keywordId: string, zone: PlaceKey, index: number) => Promise<void>;
  addKeyword: (text: string) => Promise<void>;
  removeKeyword: (keywordId: string) => Promise<void>;
  addNote: (keywordId: string, text: string) => Promise<void>;
  setFlags: (
    flags: Partial<Pick<Board, 'show_axis' | 'hide_vomit' | 'locked' | 'phase' | 'settings'>>,
  ) => Promise<void>;
  /** settings(jsonb)의 일부 키만 바꾼다 — host_token 등 기존 값은 보존 */
  patchSettings: (patch: Partial<BoardSettings>) => Promise<void>;
  setDragging: (keywordId: string | null) => void;
  setOpenCard: (keywordId: string | null) => void;
  setActionCard: (keywordId: string | null) => void;
  duplicateOf: (text: string) => Keyword | null;

  // 7단계 — 단계·투표·잠금·되돌리기·초기화
  setPhase: (phase: Phase) => Promise<void>;
  toggleLock: () => Promise<void>;
  toggleVote: (keywordId: string) => Promise<void>;
  undo: () => Promise<void>;
  resetBoard: () => Promise<void>;

  // 6·8단계 — 하이라이트·발표 모드
  setHighlight: (keywordId: string | null) => void;
  setPresent: (on: boolean) => void;
  setHighlightTop: (on: boolean) => void;

  // 10단계 — 타이머·호스트 토큰
  startTimer: (minutes: number) => Promise<void>;
  pauseTimer: () => Promise<void>;
  resumeTimer: () => Promise<void>;
  resetTimer: () => Promise<void>;
  claimHost: (token: string) => boolean;
}

let unsubSnapshot: (() => void) | null = null;
let unsubPresence: (() => void) | null = null;

/** 내가 방금 옮긴 카드 — last-write-wins 패배 토스트 판정용 */
const myPendingMoves = new Map<string, { zone: PlaceKey; at: number }>();

function orderedIn(placements: Placement[], zone: PlaceKey): Placement[] {
  return placements.filter((p) => p.zone === zone).sort((a, b) => a.sort_order - b.sort_order);
}

export const useBoard = create<BoardStore>((set, get) => ({
  db: getDb(),
  mode: dbMode,
  slug: null,
  loading: true,
  missing: false,

  board: null,
  keywords: [],
  placements: [],
  notes: [],
  votes: [],
  events: [],

  me: null,
  isHost: false,
  presence: [],
  draggingKeyword: null,
  openCard: null,
  actionCard: null,
  hasPlaced: true,

  highlight: null,
  present: false,
  highlightTop: true,

  async refresh() {
    const { slug, db } = get();
    if (!slug) return;
    const snap = await db.loadBoard(slug);
    if (snap) applySnapshot(set, get, snap, true);
  },

  async init(slug) {
    const { db } = get();
    set({ slug, loading: true, missing: false });
    const snap = await db.loadBoard(slug);
    if (!snap) {
      set({ loading: false, missing: true });
      return;
    }
    applySnapshot(set, get, snap, true);
    const me = readMe(slug);
    set({
      loading: false,
      me,
      isHost: Boolean(readHostToken(slug)),
      hasPlaced: readPlacedFlag(),
    });

    unsubSnapshot?.();
    unsubSnapshot = db.subscribe(slug, (next) => applySnapshot(set, get, next, false));

    if (me) {
      await db.presence.join(slug, me);
      unsubPresence?.();
      unsubPresence = db.presence.onPresence((list) => set({ presence: list }));
    }
  },

  dispose() {
    unsubSnapshot?.();
    unsubPresence?.();
    unsubSnapshot = null;
    unsubPresence = null;
    void get().db.presence.leave();
  },

  async join(nickname) {
    const { slug, db, board } = get();
    if (!slug || !board) return;
    const me = saveIdentity(slug, nickname, board.id);
    set({ me });
    await db.presence.join(slug, me);
    unsubPresence?.();
    unsubPresence = db.presence.onPresence((list) => set({ presence: list }));
  },

  async renameMe(nickname) {
    const { slug, db, me } = get();
    if (!slug || !me) return;
    const next: Participant = {
      ...me,
      // 색은 그대로 둔다 — 이름이 바뀌어도 같은 사람으로 보이게
      nickname: resolveNickname(nickname),
      last_seen: new Date().toISOString(),
    };
    if (next.nickname === me.nickname) return;
    try {
      window.localStorage.setItem(ME_KEY(slug), JSON.stringify(next));
    } catch {
      /* noop */
    }
    set({ me: next });
    // 프레즌스는 다시 join해서 목록의 이름을 갱신한다
    await db.presence.join(slug, next);
    unsubPresence?.();
    unsubPresence = db.presence.onPresence((list) => set({ presence: list }));
    toast.success(`이름을 '${next.nickname}'(으)로 바꿨습니다`);
  },

  async movePlacement(keywordId, zone, index) {
    const { slug, db, placements, me, keywords } = get();
    if (!slug) return;
    const current = placements.find((p) => p.keyword_id === keywordId);
    if (!current) return;
    const from = current.zone;

    // 대상 칸의 순서를 다시 매긴다
    const target = orderedIn(placements, zone).filter((p) => p.keyword_id !== keywordId);
    const clamped = Math.max(0, Math.min(index, target.length));
    target.splice(clamped, 0, { ...current, zone });

    const now = new Date().toISOString();
    const updated = placements.map((p) => {
      const idx = target.findIndex((t) => t.keyword_id === p.keyword_id);
      if (idx === -1) return p;
      return {
        ...p,
        zone,
        sort_order: idx,
        placed_by: p.keyword_id === keywordId ? me?.id ?? null : p.placed_by,
        placed_by_name: p.keyword_id === keywordId ? me?.nickname ?? null : p.placed_by_name,
        updated_at: p.keyword_id === keywordId ? now : p.updated_at,
      };
    });

    const before = placements;
    set({ placements: updated }); // 낙관적 업데이트
    myPendingMoves.set(keywordId, { zone, at: Date.now() });

    const ok = await guard(async () => {
      await db.upsertPlacements(
        slug,
        target.map((t, i) => ({
          keyword_id: t.keyword_id,
          zone,
          sort_order: i,
          placed_by: t.keyword_id === keywordId ? me?.id ?? null : t.placed_by,
          placed_by_name: t.keyword_id === keywordId ? me?.nickname ?? null : t.placed_by_name,
        })),
      );

      if (from !== zone) {
        const kw = keywords.find((k) => k.id === keywordId);
        await db.appendEvent(slug, {
          actor_id: me?.id ?? null,
          actor_name: me?.nickname ?? null,
          type: 'placement.move',
          payload: { keyword_id: keywordId, text: kw?.text ?? '', from, to: zone },
        });
      }
    }, '카드 이동을 저장하지 못했습니다');

    // 실패하면 낙관적 업데이트를 되돌린다
    if (!ok) {
      myPendingMoves.delete(keywordId);
      set({ placements: before });
      return;
    }

    // 첫 배치를 마치면 폰 첫 사용 안내를 끈다
    if (zone !== 'pool' && !get().hasPlaced) {
      try {
        window.localStorage.setItem(PLACED_KEY, '1');
      } catch {
        /* noop */
      }
      set({ hasPlaced: true });
    }
  },

  async addKeyword(text) {
    const { slug, db, me } = get();
    if (!slug || !text.trim()) return;
    await guard(async () => {
      const created = await db.createKeyword(slug, {
        text: text.trim(),
        created_by: me?.id ?? null,
        created_by_name: me?.nickname ?? null,
        is_seed: false,
      });
      await db.appendEvent(slug, {
        actor_id: me?.id ?? null,
        actor_name: me?.nickname ?? null,
        type: 'keyword.create',
        payload: { keyword_id: created.id, text: created.text },
      });
      await get().refresh();
      toast.success(`'${created.text}' 카드를 만들었습니다`);
    }, '카드를 만들지 못했습니다');
  },

  async removeKeyword(keywordId) {
    const { slug, db, me, keywords } = get();
    if (!slug) return;
    const kw = keywords.find((k) => k.id === keywordId);
    await guard(async () => {
      await db.deleteKeyword(slug, keywordId);
      await db.appendEvent(slug, {
        actor_id: me?.id ?? null,
        actor_name: me?.nickname ?? null,
        type: 'keyword.delete',
        // 되돌리기로 복원할 수 있도록 카드 전체를 남긴다
        payload: { keyword_id: keywordId, text: kw?.text ?? '', keyword: kw ?? null },
      });
      await get().refresh();
    }, '카드를 지우지 못했습니다');
    set({ openCard: null });
  },

  async addNote(keywordId, text) {
    const { slug, db, me } = get();
    if (!slug || !text.trim()) return;
    await guard(async () => {
      await db.addNote(slug, {
        keyword_id: keywordId,
        author_id: me?.id ?? null,
        author_name: me?.nickname ?? null,
        text: text.trim(),
      });
      await db.appendEvent(slug, {
        actor_id: me?.id ?? null,
        actor_name: me?.nickname ?? null,
        type: 'note.add',
        payload: { keyword_id: keywordId, text: text.trim() },
      });
      await get().refresh();
    }, '메모를 저장하지 못했습니다');
  },

  async setFlags(flags) {
    const { slug, db, board, me } = get();
    if (!slug || !board) return;
    set({ board: { ...board, ...flags } });
    await guard(async () => {
      await db.setBoardFlags(slug, flags);
      await db.appendEvent(slug, {
        actor_id: me?.id ?? null,
        actor_name: me?.nickname ?? null,
        type: 'board.flags',
        payload: { ...flags },
      });
    }, '보드 설정을 저장하지 못했습니다');
  },

  async patchSettings(patch) {
    const { board } = get();
    if (!board) return;
    // 기존 settings(호스트 토큰 등)를 보존한 채 일부 키만 덮어쓴다
    await get().setFlags({ settings: { ...board.settings, ...patch } });
  },

  setDragging(keywordId) {
    set({ draggingKeyword: keywordId });
    get().db.presence.broadcastDragging(keywordId);
  },

  setOpenCard(keywordId) {
    set({ openCard: keywordId });
  },

  setActionCard(keywordId) {
    set({ actionCard: keywordId });
  },

  duplicateOf(text) {
    const n = normalizeText(text);
    if (!n) return null;
    return get().keywords.find((k) => normalizeText(k.text) === n) ?? null;
  },

  // ─── 7단계 ────────────────────────────────────────────────

  async setPhase(phase) {
    const { isHost, board } = get();
    if (!isHost || !board || board.phase === phase) return;
    await get().setFlags({ phase });
    toast.success(`${PHASE_LABEL[phase]} 단계로 바꿨습니다`);
  },

  async toggleLock() {
    const { isHost, board } = get();
    if (!isHost || !board) return;
    await get().setFlags({ locked: !board.locked });
    toast.success(board.locked ? '보드 잠금을 풀었습니다' : '보드를 잠갔습니다');
  },

  async toggleVote(keywordId) {
    const { slug, db, me, votes, board, keywords, isHost } = get();
    if (!slug || !board) return;
    if (!me) {
      toast.message('먼저 닉네임을 입력해 주세요');
      return;
    }
    if (board.phase !== 'voting') {
      toast.message('투표 단계에서만 점 스티커를 붙일 수 있습니다');
      return;
    }
    if (board.locked && !isHost) {
      toast.message('보드가 잠겨 있습니다');
      return;
    }

    const mine = votes.filter((v) => v.participant_id === me.id);
    const existing = mine.find((v) => v.keyword_id === keywordId);
    const text = keywords.find((k) => k.id === keywordId)?.text ?? '카드';

    if (existing) {
      await db.removeVote(slug, { keyword_id: keywordId, participant_id: me.id });
      await db.appendEvent(slug, {
        actor_id: me.id,
        actor_name: me.nickname,
        type: 'vote.remove',
        payload: { keyword_id: keywordId, text, participant_id: me.id },
      });
    } else {
      if (mine.length >= VOTES_PER_PERSON) {
        toast.warning(`점 스티커 ${VOTES_PER_PERSON}개를 모두 썼습니다`);
        return;
      }
      await db.addVote(slug, { keyword_id: keywordId, participant_id: me.id });
      await db.appendEvent(slug, {
        actor_id: me.id,
        actor_name: me.nickname,
        type: 'vote.add',
        payload: { keyword_id: keywordId, text, participant_id: me.id },
      });
    }
    await get().refresh();
  },

  async undo() {
    const { slug, db, isHost, me, events, placements } = get();
    if (!slug || !isHost) return;
    const target = undoTargetOf(events);
    if (!target) {
      toast.message('되돌릴 작업이 없습니다');
      return;
    }

    const p = target.payload;
    const keywordId = typeof p.keyword_id === 'string' ? p.keyword_id : null;

    if (target.type === 'placement.move' && keywordId) {
      const from = p.from as PlaceKey;
      const current = placements.find((x) => x.keyword_id === keywordId);
      const max = placements
        .filter((x) => x.zone === from && x.keyword_id !== keywordId)
        .reduce((m, x) => Math.max(m, x.sort_order), -1);
      await db.upsertPlacement(slug, {
        keyword_id: keywordId,
        zone: from,
        sort_order: max + 1,
        placed_by: current?.placed_by ?? null,
        placed_by_name: current?.placed_by_name ?? null,
      });
    } else if (target.type === 'keyword.create' && keywordId) {
      await db.deleteKeyword(slug, keywordId);
    } else if (target.type === 'keyword.delete') {
      const kw = p.keyword as Keyword | null;
      if (kw) {
        await db.createKeyword(slug, {
          text: kw.text,
          axis: kw.axis,
          axis2: kw.axis2,
          expected: kw.expected,
          expected2: kw.expected2,
          source: kw.source,
          created_by: kw.created_by,
          created_by_name: kw.created_by_name,
          is_seed: kw.is_seed,
        });
      }
    } else if ((target.type === 'vote.add' || target.type === 'vote.remove') && keywordId) {
      const pid = typeof p.participant_id === 'string' ? p.participant_id : null;
      if (pid) {
        const input = { keyword_id: keywordId, participant_id: pid };
        if (target.type === 'vote.add') await db.removeVote(slug, input);
        else await db.addVote(slug, input);
      }
    }

    await db.appendEvent(slug, {
      actor_id: me?.id ?? null,
      actor_name: me?.nickname ?? null,
      type: 'undo',
      payload: { target_event_id: target.id, target_type: target.type, text: p.text ?? '' },
    });
    await get().refresh();
    toast.success(`되돌렸습니다 — ${UNDO_LABEL[target.type] ?? target.type}`);
  },

  async resetBoard() {
    const { slug, db, isHost, me } = get();
    if (!slug || !isHost) return;
    await db.resetBoard(slug);
    await db.appendEvent(slug, {
      actor_id: me?.id ?? null,
      actor_name: me?.nickname ?? null,
      type: 'reset',
      payload: {},
    });
    await get().refresh();
    set({ openCard: null, actionCard: null, highlight: null });
    toast.success('보드를 처음 상태로 되돌렸습니다');
  },

  // ─── 6·8단계 ──────────────────────────────────────────────

  setHighlight(keywordId) {
    if (highlightTimer) clearTimeout(highlightTimer);
    set({ highlight: keywordId });
    if (keywordId) {
      highlightTimer = setTimeout(() => set({ highlight: null }), 1500);
    }
  },

  setPresent(on) {
    set({ present: on });
  },

  setHighlightTop(on) {
    set({ highlightTop: on });
  },

  // ─── 10단계 — 타이머 ───────────────────────────────────────
  // 종료 시각을 보드 플래그에 저장하므로 모든 참가자가 같은 카운트다운을 본다.

  async startTimer(minutes) {
    if (!get().isHost) return;
    const total = Math.round(minutes * 60_000);
    if (total <= 0) return;
    await get().patchSettings({
      timer_ends_at: new Date(Date.now() + total).toISOString(),
      timer_paused_ms: null,
      timer_total_ms: total,
    });
  },

  async pauseTimer() {
    const { isHost, board } = get();
    if (!isHost || !board) return;
    const endsAt = board.settings.timer_ends_at;
    if (!endsAt) return;
    const left = Math.max(0, new Date(endsAt).getTime() - Date.now());
    await get().patchSettings({ timer_ends_at: null, timer_paused_ms: left });
  },

  async resumeTimer() {
    const { isHost, board } = get();
    if (!isHost || !board) return;
    const left = board.settings.timer_paused_ms;
    if (!left || left <= 0) return;
    await get().patchSettings({
      timer_ends_at: new Date(Date.now() + left).toISOString(),
      timer_paused_ms: null,
    });
  },

  async resetTimer() {
    if (!get().isHost) return;
    await get().patchSettings({ timer_ends_at: null, timer_paused_ms: null, timer_total_ms: null });
  },

  /** 다른 기기에서 호스트 토큰을 붙여넣어 호스트가 된다 */
  claimHost(token) {
    const { slug, board } = get();
    const value = token.trim();
    if (!slug || !value) return false;
    const known = boardHostToken(board);
    // 토큰을 읽을 수 있으면 대조하고, 읽을 수 없으면(RLS로 가려진 경우) 그대로 받아들인다
    if (known && known !== value) return false;
    writeHostToken(slug, value);
    set({ isHost: true });
    return true;
  },
}));

/** 보드에 저장된 호스트 토큰 (Supabase는 컬럼, 로컬은 settings) */
export function boardHostToken(board: Board | null): string | null {
  if (!board) return null;
  return board.host_token ?? board.settings.host_token ?? null;
}

/** 어댑터 쓰기 실패를 토스트로 알린다 (§10 에러 상태) */
async function guard(fn: () => Promise<void>, message: string): Promise<boolean> {
  try {
    await fn();
    return true;
  } catch (err) {
    const detail = err instanceof Error ? err.message : '';
    toast.error(detail ? `${message} — ${detail}` : message);
    return false;
  }
}

let highlightTimer: ReturnType<typeof setTimeout> | null = null;

export const PHASE_LABEL: Record<Phase, string> = {
  placing: '배치',
  voting: '투표',
  review: '발표',
};

export const PHASES: Phase[] = ['placing', 'voting', 'review'];

const UNDO_LABEL: Partial<Record<BoardEvent['type'], string>> = {
  'placement.move': '카드 이동',
  'keyword.create': '카드 생성',
  'keyword.delete': '카드 삭제',
  'vote.add': '투표',
  'vote.remove': '투표 취소',
};

/** 최근 20건의 되돌릴 수 있는 이벤트 중, 아직 되돌리지 않은 가장 마지막 것 */
export function undoTargetOf(events: BoardEvent[]): BoardEvent | null {
  const undone = new Set<number>();
  events.forEach((e) => {
    if (e.type === 'undo' && typeof e.payload.target_event_id === 'number') {
      undone.add(e.payload.target_event_id);
    }
  });
  const recent = events.filter((e) => UNDOABLE_EVENTS.includes(e.type)).slice(-UNDO_DEPTH);
  for (let i = recent.length - 1; i >= 0; i -= 1) {
    if (!undone.has(recent[i].id)) return recent[i];
  }
  return null;
}

type SetFn = (partial: Partial<BoardStore>) => void;
type GetFn = () => BoardStore;

/** 원격 스냅샷 반영 + 이동 토스트 + last-write-wins 패배 알림 (§6.1) */
function applySnapshot(set: SetFn, get: GetFn, snap: BoardSnapshot, silent: boolean): void {
  const prev = get().placements;
  const me = get().me;

  if (!silent && prev.length) {
    const prevMap = new Map(prev.map((p) => [p.keyword_id, p]));
    const kwMap = new Map(get().keywords.map((k) => [k.id, k.text]));
    snap.keywords.forEach((k) => kwMap.set(k.id, k.text));

    snap.placements.forEach((next) => {
      const before = prevMap.get(next.keyword_id);
      if (!before || before.zone === next.zone) return;
      const text = kwMap.get(next.keyword_id) ?? '카드';
      const who = next.placed_by_name ?? '누군가';
      if (next.placed_by && me && next.placed_by === me.id) return;

      const pending = myPendingMoves.get(next.keyword_id);
      if (pending && Date.now() - pending.at < 6000 && pending.zone !== next.zone) {
        toast.warning(`${who}님이 먼저 옮겼습니다 — '${text}'`);
      } else {
        toast(
          `${who}님이 '${text}'${objectParticle(text)} ${placeEmoji(next.zone)}${zoneSuffix(
            next.zone,
          )} 옮겼습니다`,
        );
      }
      myPendingMoves.delete(next.keyword_id);
    });
  }

  set({
    board: snap.board,
    keywords: snap.keywords,
    placements: snap.placements,
    notes: snap.notes,
    votes: snap.votes,
    events: snap.events,
  });
}

function zoneSuffix(zone: PlaceKey): string {
  const label = placeLabel(zone);
  return zone === 'pool' ? ` ${label}${directionParticle(label)}` : directionParticle(label);
}

// ─── 파생 셀렉터 ────────────────────────────────────────────

export function useZoneKeywords(zone: PlaceKey): Keyword[] {
  const placements = useBoard((s) => s.placements);
  const keywords = useBoard((s) => s.keywords);
  const byId = new Map(keywords.map((k) => [k.id, k]));
  return orderedIn(placements, zone)
    .map((p) => byId.get(p.keyword_id))
    .filter((k): k is Keyword => Boolean(k));
}

export function usePlacementOf(keywordId: string): Placement | undefined {
  return useBoard((s) => s.placements.find((p) => p.keyword_id === keywordId));
}

export function axisOf(kw: Keyword): AxisKey | null {
  return kw.axis;
}

/** review 단계이거나 보드가 잠겨 있으면 호스트 외 모든 쓰기 차단 (§6.4) */
export function isWriteBlocked(board: Board | null, isHost: boolean): boolean {
  if (!board || isHost) return false;
  return board.phase === 'review' || board.locked;
}

/**
 * 쓰기 가능 여부 — 단계·잠금만 본다.
 * v1.1에서 폰 보기 전용을 없앴다(폰도 완전히 쓸 수 있다).
 */
export function useCanWrite(): boolean {
  const board = useBoard((s) => s.board);
  const isHost = useBoard((s) => s.isHost);
  return !isWriteBlocked(board, isHost);
}

/** 카드별 득표 수 */
export function useVoteCounts(): Map<string, number> {
  const votes = useBoard((s) => s.votes);
  const map = new Map<string, number>();
  votes.forEach((v) => map.set(v.keyword_id, (map.get(v.keyword_id) ?? 0) + 1));
  return map;
}

/** 내가 스티커를 붙인 카드 id 집합 */
export function useMyVotedIds(): Set<string> {
  const votes = useBoard((s) => s.votes);
  const me = useBoard((s) => s.me);
  return new Set(votes.filter((v) => me && v.participant_id === me.id).map((v) => v.keyword_id));
}

/** 득표 상위 5개 → 카드 id별 순위(1~5). 표가 하나도 없으면 빈 Map */
export function useTopRanks(): Map<string, number> {
  const counts = useVoteCounts();
  const ranked = [...counts.entries()].filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
  const out = new Map<string, number>();
  ranked.slice(0, 5).forEach(([id], i) => out.set(id, i + 1));
  return out;
}

export interface Mismatch {
  keyword: Keyword;
  expected: PlaceKey;
  actual: ZoneKey;
}

/** 시드 카드 중 실제 배치가 예상 칸과 다른 것 (풀에 남은 카드는 제외) */
export function useMismatches(): Mismatch[] {
  const keywords = useBoard((s) => s.keywords);
  const placements = useBoard((s) => s.placements);
  const zoneOf = new Map(placements.map((p) => [p.keyword_id, p.zone]));
  const out: Mismatch[] = [];
  keywords.forEach((k) => {
    if (!k.is_seed || !k.expected) return;
    const actual = zoneOf.get(k.id);
    if (!actual || actual === 'pool') return;
    if (actual === k.expected || actual === k.expected2) return;
    out.push({ keyword: k, expected: k.expected, actual });
  });
  return out;
}

export interface AxisSlice {
  key: AxisKey | 'none';
  label: string;
  color: string;
  count: number;
}

/** 칸별 축 분포 (주축만, 축 없는 카드는 '축 없음'으로 묶는다) */
export function useAxisByZone(): Map<PlaceKey, AxisSlice[]> {
  const keywords = useBoard((s) => s.keywords);
  const placements = useBoard((s) => s.placements);
  const byId = new Map(keywords.map((k) => [k.id, k]));
  const out = new Map<PlaceKey, AxisSlice[]>();

  placements.forEach((p) => {
    if (p.zone === 'pool') return;
    const kw = byId.get(p.keyword_id);
    if (!kw) return;
    const list = out.get(p.zone) ?? [];
    const key: AxisKey | 'none' = kw.axis ?? 'none';
    const found = list.find((s) => s.key === key);
    if (found) found.count += 1;
    else {
      const meta = kw.axis ? AXIS_MAP[kw.axis] : null;
      list.push({
        key,
        label: meta ? `${meta.key} · ${meta.name}` : '축 없음',
        color: meta ? meta.color : '#C9C9C2',
        count: 1,
      });
    }
    out.set(p.zone, list);
  });

  out.forEach((list) => list.sort((a, b) => b.count - a.count));
  return out;
}
