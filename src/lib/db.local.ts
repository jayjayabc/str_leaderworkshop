// 어댑터 B — 환경변수 없이 동작하는 로컬 어댑터.
//   영속: localStorage (보드 slug 별 스냅샷 1개)
//   동기화: BroadcastChannel (같은 브라우저의 다른 탭)
//   프레즌스: BroadcastChannel 하트비트

import { makeSlug, newSnapshot, uid } from './snapshot';
import type {
  AddNoteInput,
  AppendEventInput,
  BoardAdapter,
  BoardFlags,
  CreateBoardInput,
  CreateBoardResult,
  CreateKeywordInput,
  PlacementInput,
  PresenceAdapter,
  VoteInput,
} from './db';
import type {
  BoardEvent,
  BoardSnapshot,
  Keyword,
  Participant,
  PresenceState,
} from './types';

const KEY = (slug: string) => `eb:board:${slug}`;
const CH = (slug: string) => `eb:ch:${slug}`;
const PRESENCE_TTL = 7000;
const HEARTBEAT = 2000;

type Msg =
  | { kind: 'snapshot'; from: string }
  | { kind: 'presence'; from: string; state: PresenceState }
  | { kind: 'presence-bye'; from: string }
  | { kind: 'presence-ping'; from: string };

function canUseStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function read(slug: string): BoardSnapshot | null {
  if (!canUseStorage()) return null;
  try {
    const raw = window.localStorage.getItem(KEY(slug));
    if (!raw) return null;
    return JSON.parse(raw) as BoardSnapshot;
  } catch {
    return null;
  }
}

function write(slug: string, snap: BoardSnapshot): void {
  if (!canUseStorage()) return;
  try {
    window.localStorage.setItem(KEY(slug), JSON.stringify(snap));
  } catch {
    /* quota 초과 등은 무시 */
  }
}

class Channels {
  private map = new Map<string, BroadcastChannel>();

  get(slug: string): BroadcastChannel | null {
    if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') return null;
    let ch = this.map.get(slug);
    if (!ch) {
      ch = new BroadcastChannel(CH(slug));
      this.map.set(slug, ch);
    }
    return ch;
  }
}

class LocalPresence implements PresenceAdapter {
  private slug: string | null = null;
  private self: PresenceState | null = null;
  private peers = new Map<string, PresenceState>();
  private listeners = new Set<(list: PresenceState[]) => void>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private bound: ((e: MessageEvent<Msg>) => void) | null = null;

  constructor(private channels: Channels) {}

  async join(slug: string, participant: Participant): Promise<void> {
    this.slug = slug;
    this.self = { participant, dragging: null, at: Date.now() };
    const ch = this.channels.get(slug);
    if (ch && !this.bound) {
      this.bound = (e: MessageEvent<Msg>) => this.onMessage(e.data);
      ch.addEventListener('message', this.bound as EventListener);
    }
    this.post({ kind: 'presence-ping', from: this.self.participant.id });
    this.beat();
    if (!this.timer) this.timer = setInterval(() => this.beat(), HEARTBEAT);
    this.emit();
  }

  async leave(): Promise<void> {
    if (this.self) this.post({ kind: 'presence-bye', from: this.self.participant.id });
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    const ch = this.slug ? this.channels.get(this.slug) : null;
    if (ch && this.bound) ch.removeEventListener('message', this.bound as EventListener);
    this.bound = null;
    this.peers.clear();
    this.self = null;
  }

  onPresence(cb: (list: PresenceState[]) => void): () => void {
    this.listeners.add(cb);
    cb(this.list());
    return () => {
      this.listeners.delete(cb);
    };
  }

  broadcastDragging(keywordId: string | null): void {
    if (!this.self) return;
    this.self = { ...this.self, dragging: keywordId, at: Date.now() };
    this.beat();
    this.emit();
  }

  private beat(): void {
    if (!this.self) return;
    this.self = { ...this.self, at: Date.now() };
    this.post({ kind: 'presence', from: this.self.participant.id, state: this.self });
    this.prune();
  }

  private prune(): void {
    const now = Date.now();
    let changed = false;
    this.peers.forEach((p, id) => {
      if (now - p.at > PRESENCE_TTL) {
        this.peers.delete(id);
        changed = true;
      }
    });
    if (changed) this.emit();
  }

  private onMessage(msg: Msg): void {
    if (msg.kind === 'presence') {
      if (!this.self || msg.from !== this.self.participant.id) {
        this.peers.set(msg.from, msg.state);
        this.emit();
      }
    } else if (msg.kind === 'presence-bye') {
      if (this.peers.delete(msg.from)) this.emit();
    } else if (msg.kind === 'presence-ping') {
      if (this.self && msg.from !== this.self.participant.id) this.beat();
    }
  }

  private post(msg: Msg): void {
    if (!this.slug) return;
    this.channels.get(this.slug)?.postMessage(msg);
  }

  private list(): PresenceState[] {
    const out: PresenceState[] = [];
    if (this.self) out.push(this.self);
    this.peers.forEach((p) => out.push(p));
    return out.sort((a, b) => a.participant.nickname.localeCompare(b.participant.nickname, 'ko'));
  }

  private emit(): void {
    const list = this.list();
    this.listeners.forEach((cb) => cb(list));
  }
}

class LocalAdapter implements BoardAdapter {
  readonly mode = 'local' as const;
  private channels = new Channels();
  private clientId = uid();
  presence: PresenceAdapter;

  constructor() {
    this.presence = new LocalPresence(this.channels);
  }

  private mutate(slug: string, fn: (snap: BoardSnapshot) => void): BoardSnapshot | null {
    const snap = read(slug);
    if (!snap) return null;
    fn(snap);
    write(slug, snap);
    this.channels.get(slug)?.postMessage({ kind: 'snapshot', from: this.clientId } satisfies Msg);
    // 같은 탭의 구독자에게도 알린다
    this.local.get(slug)?.forEach((cb) => cb(structuredClone(snap)));
    return snap;
  }

  private local = new Map<string, Set<(s: BoardSnapshot) => void>>();

  async createBoard(input: CreateBoardInput): Promise<CreateBoardResult> {
    const slug = input.slug?.trim() || makeSlug();
    // 같은 slug가 이미 있으면(조 보드 동시 입장 등) 새로 만들지 않고 기존 보드를 돌려준다
    const existing = read(slug);
    if (existing) {
      return {
        board: existing.board,
        hostToken: existing.board.settings.host_token ?? existing.board.host_token ?? '',
      };
    }
    const snap = newSnapshot(input.title, slug);
    const hostToken = uid();
    snap.board.settings = { host_token: hostToken };
    snap.events.push({
      id: 1,
      board_id: snap.board.id,
      actor_id: null,
      actor_name: null,
      type: 'board.create',
      payload: { title: snap.board.title },
      created_at: new Date().toISOString(),
    });
    write(slug, snap);
    return { board: snap.board, hostToken };
  }

  async loadBoard(slug: string): Promise<BoardSnapshot | null> {
    const snap = read(slug);
    return snap ? structuredClone(snap) : null;
  }

  subscribe(slug: string, onChange: (snapshot: BoardSnapshot) => void): () => void {
    let set = this.local.get(slug);
    if (!set) {
      set = new Set();
      this.local.set(slug, set);
    }
    set.add(onChange);

    const ch = this.channels.get(slug);
    const handler = (e: MessageEvent<Msg>) => {
      if (e.data?.kind !== 'snapshot') return;
      if (e.data.from === this.clientId) return;
      const snap = read(slug);
      if (snap) onChange(snap);
    };
    ch?.addEventListener('message', handler as EventListener);

    // 다른 창(BroadcastChannel 미지원 환경 대비)
    const onStorage = (e: StorageEvent) => {
      if (e.key !== KEY(slug)) return;
      const snap = read(slug);
      if (snap) onChange(snap);
    };
    if (typeof window !== 'undefined') window.addEventListener('storage', onStorage);

    return () => {
      set?.delete(onChange);
      ch?.removeEventListener('message', handler as EventListener);
      if (typeof window !== 'undefined') window.removeEventListener('storage', onStorage);
    };
  }

  async upsertPlacement(slug: string, input: PlacementInput): Promise<void> {
    await this.upsertPlacements(slug, [input]);
  }

  async upsertPlacements(slug: string, inputs: PlacementInput[]): Promise<void> {
    this.mutate(slug, (snap) => {
      const now = new Date().toISOString();
      inputs.forEach((input) => {
        const found = snap.placements.find((p) => p.keyword_id === input.keyword_id);
        if (found) {
          found.zone = input.zone;
          found.sort_order = input.sort_order;
          found.placed_by = input.placed_by;
          found.placed_by_name = input.placed_by_name;
          found.updated_at = now;
        } else {
          snap.placements.push({
            id: uid(),
            board_id: snap.board.id,
            keyword_id: input.keyword_id,
            zone: input.zone,
            sort_order: input.sort_order,
            placed_by: input.placed_by,
            placed_by_name: input.placed_by_name,
            updated_at: now,
          });
        }
      });
    });
  }

  async createKeyword(slug: string, input: CreateKeywordInput): Promise<Keyword> {
    const snap = read(slug);
    if (!snap) throw new Error('보드를 찾을 수 없습니다');
    const now = new Date().toISOString();
    const keyword: Keyword = {
      id: uid(),
      board_id: snap.board.id,
      text: input.text,
      axis: input.axis ?? null,
      axis2: input.axis2 ?? null,
      expected: input.expected ?? null,
      expected2: input.expected2 ?? null,
      source: input.source ?? null,
      created_by: input.created_by ?? null,
      created_by_name: input.created_by_name ?? null,
      created_at: now,
      is_seed: input.is_seed ?? false,
    };
    this.mutate(slug, (s) => {
      s.keywords.push(keyword);
      const poolMax = s.placements
        .filter((p) => p.zone === 'pool')
        .reduce((m, p) => Math.max(m, p.sort_order), -1);
      s.placements.push({
        id: uid(),
        board_id: s.board.id,
        keyword_id: keyword.id,
        zone: 'pool',
        sort_order: poolMax + 1,
        placed_by: input.created_by ?? null,
        placed_by_name: input.created_by_name ?? null,
        updated_at: now,
      });
    });
    return keyword;
  }

  async deleteKeyword(slug: string, keywordId: string): Promise<void> {
    this.mutate(slug, (snap) => {
      snap.keywords = snap.keywords.filter((k) => k.id !== keywordId);
      snap.placements = snap.placements.filter((p) => p.keyword_id !== keywordId);
      snap.notes = snap.notes.filter((n) => n.keyword_id !== keywordId);
      snap.votes = snap.votes.filter((v) => v.keyword_id !== keywordId);
    });
  }

  async addNote(slug: string, input: AddNoteInput): Promise<void> {
    this.mutate(slug, (snap) => {
      snap.notes.push({
        id: uid(),
        keyword_id: input.keyword_id,
        author_id: input.author_id,
        author_name: input.author_name,
        text: input.text,
        created_at: new Date().toISOString(),
      });
    });
  }

  async setBoardFlags(slug: string, flags: BoardFlags): Promise<void> {
    this.mutate(slug, (snap) => {
      snap.board = { ...snap.board, ...flags };
    });
  }

  async appendEvent(slug: string, input: AppendEventInput): Promise<BoardEvent | null> {
    const current = read(slug);
    if (!current) return null;
    const created: BoardEvent = {
      id: current.events.reduce((m, e) => Math.max(m, e.id), 0) + 1,
      board_id: current.board.id,
      actor_id: input.actor_id,
      actor_name: input.actor_name,
      type: input.type,
      payload: input.payload,
      created_at: new Date().toISOString(),
    };
    this.mutate(slug, (snap) => {
      snap.events.push(created);
      if (snap.events.length > 300) snap.events = snap.events.slice(-300);
    });
    return created;
  }

  async addVote(slug: string, input: VoteInput): Promise<void> {
    this.mutate(slug, (snap) => {
      const dup = snap.votes.some(
        (v) => v.keyword_id === input.keyword_id && v.participant_id === input.participant_id,
      );
      if (dup) return;
      snap.votes.push({
        id: uid(),
        board_id: snap.board.id,
        keyword_id: input.keyword_id,
        participant_id: input.participant_id,
        created_at: new Date().toISOString(),
      });
    });
  }

  async removeVote(slug: string, input: VoteInput): Promise<void> {
    this.mutate(slug, (snap) => {
      snap.votes = snap.votes.filter(
        (v) => !(v.keyword_id === input.keyword_id && v.participant_id === input.participant_id),
      );
    });
  }

  async resetBoard(slug: string): Promise<void> {
    this.mutate(slug, (snap) => {
      const now = new Date().toISOString();
      snap.keywords = snap.keywords.filter((k) => k.is_seed);
      const keep = new Set(snap.keywords.map((k) => k.id));
      snap.placements = snap.placements
        .filter((p) => keep.has(p.keyword_id))
        .map((p, i) => ({
          ...p,
          zone: 'pool' as const,
          sort_order: i,
          placed_by: null,
          placed_by_name: null,
          updated_at: now,
        }));
      snap.notes = [];
      snap.votes = [];
      snap.board = { ...snap.board, phase: 'placing', locked: false };
    });
  }
}

export function createLocalAdapter(): BoardAdapter {
  return new LocalAdapter();
}
