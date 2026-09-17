// 어댑터 A — Supabase(Postgres + Realtime + Presence).
// NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY 가 있을 때만 사용된다.
// 스키마는 supabase/schema.sql 참조.

import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js';

import { makeSlug, seedRows, uid } from './snapshot';
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
  Board,
  BoardEvent,
  BoardSnapshot,
  Keyword,
  Note,
  Participant,
  Placement,
  PresenceState,
  Vote,
} from './types';

let client: SupabaseClient | null = null;

function sb(): SupabaseClient {
  if (!client) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) throw new Error('Supabase 환경변수가 없습니다');
    client = createClient(url, key, { realtime: { params: { eventsPerSecond: 20 } } });
  }
  return client;
}

class SupabasePresence implements PresenceAdapter {
  private channel: RealtimeChannel | null = null;
  private self: PresenceState | null = null;
  private listeners = new Set<(list: PresenceState[]) => void>();

  async join(slug: string, participant: Participant): Promise<void> {
    await this.leave();
    const self: PresenceState = { participant, dragging: null, at: Date.now() };
    this.self = self;
    const ch = sb().channel(`presence:${slug}`, {
      config: { presence: { key: participant.id } },
    });
    ch.on('presence', { event: 'sync' }, () => this.emit());
    this.channel = ch;
    await new Promise<void>((resolve) => {
      ch.subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          void ch.track({ ...self });
          resolve();
        }
      });
    });
  }

  async leave(): Promise<void> {
    if (this.channel) {
      await this.channel.untrack().catch(() => undefined);
      await sb().removeChannel(this.channel);
    }
    this.channel = null;
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
    if (!this.self || !this.channel) return;
    const next: PresenceState = { ...this.self, dragging: keywordId, at: Date.now() };
    this.self = next;
    void this.channel.track({ ...next });
  }

  private list(): PresenceState[] {
    if (!this.channel) return this.self ? [this.self] : [];
    const raw = this.channel.presenceState<PresenceState>();
    const out: PresenceState[] = [];
    Object.values(raw).forEach((entries) => {
      const first = entries[0];
      if (first?.participant) out.push({ participant: first.participant, dragging: first.dragging, at: first.at });
    });
    return out.sort((a, b) => a.participant.nickname.localeCompare(b.participant.nickname, 'ko'));
  }

  private emit(): void {
    const list = this.list();
    this.listeners.forEach((cb) => cb(list));
  }
}

class SupabaseAdapter implements BoardAdapter {
  readonly mode = 'supabase' as const;
  presence: PresenceAdapter = new SupabasePresence();
  private boardIdBySlug = new Map<string, string>();

  private async boardId(slug: string): Promise<string> {
    const cachedId = this.boardIdBySlug.get(slug);
    if (cachedId) return cachedId;
    const { data, error } = await sb().from('boards').select('id').eq('slug', slug).single();
    if (error || !data) throw new Error('보드를 찾을 수 없습니다');
    const id = (data as { id: string }).id;
    this.boardIdBySlug.set(slug, id);
    return id;
  }

  async createBoard(input: CreateBoardInput): Promise<CreateBoardResult> {
    const slug = makeSlug();
    const hostToken = uid();
    const { data, error } = await sb()
      .from('boards')
      .insert({ slug, title: input.title.trim() || '코끼리 보드', host_token: hostToken })
      .select()
      .single();
    if (error || !data) throw new Error(error?.message ?? '보드 생성 실패');
    const board = data as Board;
    const { keywords, placements } = seedRows(board.id);
    await sb().from('keywords').insert(
      keywords.map((k) => ({
        id: k.id,
        board_id: k.board_id,
        text: k.text,
        axis: k.axis,
        axis2: k.axis2,
        expected: k.expected,
        expected2: k.expected2,
        source: k.source,
        is_seed: true,
      })),
    );
    await sb().from('placements').insert(
      placements.map((p) => ({
        id: p.id,
        board_id: p.board_id,
        keyword_id: p.keyword_id,
        zone: p.zone,
        sort_order: p.sort_order,
      })),
    );
    this.boardIdBySlug.set(slug, board.id);
    return { board, hostToken };
  }

  async loadBoard(slug: string): Promise<BoardSnapshot | null> {
    const { data: boardRow } = await sb().from('boards').select('*').eq('slug', slug).maybeSingle();
    if (!boardRow) return null;
    const board = boardRow as Board;
    this.boardIdBySlug.set(slug, board.id);
    const [kw, pl, nt, vt, ev] = await Promise.all([
      sb().from('keywords').select('*').eq('board_id', board.id),
      sb().from('placements').select('*').eq('board_id', board.id),
      sb().from('notes').select('*').eq('board_id', board.id),
      sb().from('votes').select('*').eq('board_id', board.id),
      sb().from('events').select('*').eq('board_id', board.id).order('id', { ascending: true }).limit(300),
    ]);
    return {
      board,
      keywords: (kw.data ?? []) as Keyword[],
      placements: (pl.data ?? []) as Placement[],
      notes: (nt.data ?? []) as Note[],
      votes: (vt.data ?? []) as Vote[],
      events: (ev.data ?? []) as BoardEvent[],
    };
  }

  subscribe(slug: string, onChange: (snapshot: BoardSnapshot) => void): () => void {
    let disposed = false;
    let pending: ReturnType<typeof setTimeout> | null = null;
    const refresh = () => {
      if (pending) clearTimeout(pending);
      pending = setTimeout(() => {
        void this.loadBoard(slug).then((snap) => {
          if (snap && !disposed) onChange(snap);
        });
      }, 40);
    };

    const channel = sb().channel(`changes:${slug}`);
    (['placements', 'keywords', 'notes', 'votes', 'events', 'boards'] as const).forEach((table) => {
      channel.on('postgres_changes', { event: '*', schema: 'public', table }, refresh);
    });

    // 재접속 처리 (§6.5) — 끊겼다 돌아오면 전체 스냅샷을 다시 받아 덮어쓴다.
    let retry: ReturnType<typeof setTimeout> | null = null;
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        refresh();
        return;
      }
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        if (retry) clearTimeout(retry);
        retry = setTimeout(() => {
          if (disposed) return;
          refresh();
          void channel.subscribe();
        }, 2000);
      }
    });

    const onOnline = () => refresh();
    if (typeof window !== 'undefined') window.addEventListener('online', onOnline);

    return () => {
      disposed = true;
      if (pending) clearTimeout(pending);
      if (retry) clearTimeout(retry);
      if (typeof window !== 'undefined') window.removeEventListener('online', onOnline);
      void sb().removeChannel(channel);
    };
  }

  async upsertPlacement(slug: string, input: PlacementInput): Promise<void> {
    await this.upsertPlacements(slug, [input]);
  }

  async upsertPlacements(slug: string, inputs: PlacementInput[]): Promise<void> {
    const board_id = await this.boardId(slug);
    const rows = inputs.map((i) => ({
      board_id,
      keyword_id: i.keyword_id,
      zone: i.zone,
      sort_order: i.sort_order,
      placed_by: i.placed_by,
      placed_by_name: i.placed_by_name,
      updated_at: new Date().toISOString(),
    }));
    await sb().from('placements').upsert(rows, { onConflict: 'keyword_id' });
  }

  async createKeyword(slug: string, input: CreateKeywordInput): Promise<Keyword> {
    const board_id = await this.boardId(slug);
    const { data, error } = await sb()
      .from('keywords')
      .insert({
        board_id,
        text: input.text,
        axis: input.axis ?? null,
        axis2: input.axis2 ?? null,
        expected: input.expected ?? null,
        expected2: input.expected2 ?? null,
        source: input.source ?? null,
        created_by: input.created_by ?? null,
        created_by_name: input.created_by_name ?? null,
        is_seed: input.is_seed ?? false,
      })
      .select()
      .single();
    if (error || !data) throw new Error(error?.message ?? '카드 생성 실패');
    const keyword = data as Keyword;
    const { data: maxRow } = await sb()
      .from('placements')
      .select('sort_order')
      .eq('board_id', board_id)
      .eq('zone', 'pool')
      .order('sort_order', { ascending: false })
      .limit(1)
      .maybeSingle();
    const next = ((maxRow as { sort_order: number } | null)?.sort_order ?? -1) + 1;
    await sb().from('placements').insert({
      board_id,
      keyword_id: keyword.id,
      zone: 'pool',
      sort_order: next,
      placed_by: input.created_by ?? null,
      placed_by_name: input.created_by_name ?? null,
    });
    return keyword;
  }

  async deleteKeyword(slug: string, keywordId: string): Promise<void> {
    await sb().from('keywords').delete().eq('id', keywordId);
  }

  async addNote(slug: string, input: AddNoteInput): Promise<void> {
    const board_id = await this.boardId(slug);
    await sb().from('notes').insert({
      board_id,
      keyword_id: input.keyword_id,
      author_id: input.author_id,
      author_name: input.author_name,
      text: input.text,
    });
  }

  async setBoardFlags(slug: string, flags: BoardFlags): Promise<void> {
    await sb().from('boards').update(flags).eq('slug', slug);
  }

  async appendEvent(slug: string, input: AppendEventInput): Promise<BoardEvent | null> {
    const board_id = await this.boardId(slug);
    const { data } = await sb()
      .from('events')
      .insert({
        board_id,
        actor_id: input.actor_id,
        actor_name: input.actor_name,
        type: input.type,
        payload: input.payload,
      })
      .select()
      .maybeSingle();
    return (data as BoardEvent | null) ?? null;
  }

  async addVote(slug: string, input: VoteInput): Promise<void> {
    const board_id = await this.boardId(slug);
    await sb()
      .from('votes')
      .upsert(
        { board_id, keyword_id: input.keyword_id, participant_id: input.participant_id },
        { onConflict: 'board_id,keyword_id,participant_id' },
      );
  }

  async removeVote(slug: string, input: VoteInput): Promise<void> {
    const board_id = await this.boardId(slug);
    await sb()
      .from('votes')
      .delete()
      .eq('board_id', board_id)
      .eq('keyword_id', input.keyword_id)
      .eq('participant_id', input.participant_id);
  }

  async resetBoard(slug: string): Promise<void> {
    const board_id = await this.boardId(slug);
    await sb().from('votes').delete().eq('board_id', board_id);
    await sb().from('notes').delete().eq('board_id', board_id);
    // 참가자가 만든 카드는 삭제(placements는 on delete cascade로 함께 지워진다)
    await sb().from('keywords').delete().eq('board_id', board_id).eq('is_seed', false);
    await sb()
      .from('placements')
      .update({ zone: 'pool', placed_by: null, placed_by_name: null, updated_at: new Date().toISOString() })
      .eq('board_id', board_id);
    await sb().from('boards').update({ phase: 'placing', locked: false }).eq('id', board_id);
  }
}

export function createSupabaseAdapter(): BoardAdapter {
  return new SupabaseAdapter();
}
