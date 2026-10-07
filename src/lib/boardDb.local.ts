// 토의보드 로컬 어댑터 (Board v1.0) — 환경변수 없이 한 브라우저 안에서 전체 흐름을 시연·테스트한다.
//   저장: localStorage['eb:board:v1'] · 동기화: BroadcastChannel('eb:board') + storage 이벤트 + 3초 폴링
//   규칙은 supabase/board_v1.0_migration.sql 의 함수와 똑같이 맞췄다. 실서비스는 Supabase.

import { OPERATOR_KEY } from './admin';
import type { BoardAdapter } from './boardDb';
import { BOARD_GROUPS, BOARD_ITEMS, BOARD_MAX_LEN, BOARD_TEAMS, type BoardGroupId, type BoardItemId } from './boardSeed';
import {
  BOARD_STATE_POLL_MS,
  BoardError,
  EMPTY_BOARD_STATE,
  type BoardAdminSnapshot,
  type BoardAdminSubmission,
  type BoardCard,
  type BoardCounts,
  type BoardMe,
  type BoardModerateAction,
  type BoardMyView,
  type BoardState,
  type BoardStatePatch,
} from './boardTypes';

const KEY = 'eb:board:v1';
const CHANNEL = 'eb:board';

interface LocalParticipant extends BoardMe {
  device_token: string | null;
  joined_at: string;
  last_seen: string;
}

interface LocalDb {
  state: BoardState;
  participants: LocalParticipant[];
  submissions: BoardAdminSubmission[];
}

function uid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `id-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
}

let lastStamp = 0;
/** updated_at 이 같은 밀리초에 두 번 찍혀도 서로 다르게 */
function nowIso(): string {
  const t = Math.max(Date.now(), lastStamp + 1);
  lastStamp = t;
  return new Date(t).toISOString();
}

function empty(): LocalDb {
  return { state: { ...EMPTY_BOARD_STATE, updated_at: nowIso() }, participants: [], submissions: [] };
}

function read(): LocalDb {
  if (typeof window === 'undefined') return empty();
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return empty();
    const db = JSON.parse(raw) as LocalDb;
    db.state = { ...EMPTY_BOARD_STATE, ...db.state };
    return db;
  } catch {
    return empty();
  }
}

let channel: BroadcastChannel | null = null;
function bc(): BroadcastChannel | null {
  if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') return null;
  if (!channel) channel = new BroadcastChannel(CHANNEL);
  return channel;
}

function write(db: LocalDb, stateChanged: boolean): void {
  if (stateChanged) db.state.updated_at = nowIso();
  window.localStorage.setItem(KEY, JSON.stringify(db));
  bc()?.postMessage({ t: 'changed' });
}

export function cleanBody(s: string | null | undefined): string {
  return (s ?? '')
    .normalize('NFKC')
    .replace(/\r\n?/g, '\n')
    .replace(/^[ \t\n]+|[ \t\n]+$/g, '');
}

function checkKey(key: string): void {
  if (OPERATOR_KEY && key !== OPERATOR_KEY) throw new BoardError('BOARD_FORBIDDEN');
}

function itemsOf(group: string | null): typeof BOARD_ITEMS {
  return BOARD_ITEMS.filter((i) => i.group === group);
}

function groupOfItem(id: string): BoardGroupId | null {
  return BOARD_ITEMS.find((i) => i.id === id)?.group ?? null;
}

class LocalBoardAdapter implements BoardAdapter {
  readonly mode = 'local' as const;

  async serverNow(): Promise<number> {
    return Date.now();
  }

  async getState(): Promise<BoardState> {
    return read().state;
  }

  subscribeState(cb: (state: BoardState) => void): () => void {
    let last = '';
    const pull = () => {
      const s = read().state;
      if (s.updated_at === last) return;
      last = s.updated_at;
      cb(s);
    };
    const ch = bc();
    const onMsg = () => pull();
    ch?.addEventListener('message', onMsg);
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY) pull();
    };
    window.addEventListener('storage', onStorage);
    const t = setInterval(pull, BOARD_STATE_POLL_MS);
    pull();
    return () => {
      ch?.removeEventListener('message', onMsg);
      window.removeEventListener('storage', onStorage);
      clearInterval(t);
    };
  }

  async join(teamId: string, name: string, device: string): Promise<BoardMe> {
    if (!BOARD_TEAMS.some((t) => t.id === teamId)) throw new BoardError('BOARD_UNKNOWN', 'team');
    const db = read();
    const nm = (cleanBody(name) || '기록자').slice(0, 20);
    const dev = device.trim().slice(0, 64) || null;
    const ts = nowIso();
    if (dev) db.participants = db.participants.filter((x) => !(x.device_token === dev && x.team_id !== teamId));
    let p = dev ? [...db.participants].reverse().find((x) => x.device_token === dev && x.team_id === teamId) : undefined;
    if (p) {
      p.name = nm;
      p.last_seen = ts;
    } else {
      p = { id: uid(), team_id: teamId, name: nm, device_token: dev, joined_at: ts, last_seen: ts };
      db.participants.push(p);
    }
    write(db, false);
    return { id: p.id, team_id: p.team_id, name: p.name };
  }

  async my(participantId: string): Promise<BoardMyView | null> {
    const db = read();
    const p = db.participants.find((x) => x.id === participantId);
    if (!p) return null;
    p.last_seen = nowIso();
    write(db, false);
    return {
      participant: { id: p.id, team_id: p.team_id, name: p.name },
      submissions: db.submissions
        .filter((s) => s.team_id === p.team_id)
        .sort((a, b) => a.item_id.localeCompare(b.item_id))
        .map(({ item_id, body, submitted_at, updated_at, edited_count }) => ({
          item_id,
          body,
          submitted_at,
          updated_at,
          edited_count,
        })),
    };
  }

  async submit(participantId: string, bodies: Record<string, string>): Promise<string> {
    const db = read();
    const p = db.participants.find((x) => x.id === participantId);
    if (!p) throw new BoardError('BOARD_UNKNOWN', 'participant');
    const s = db.state;
    if (s.phase !== 'item_open' || !s.item_open || !s.current_item) throw new BoardError('BOARD_CLOSED');
    const items = itemsOf(s.current_item);
    for (const k of Object.keys(bodies)) {
      if (!items.some((i) => i.id === k)) throw new BoardError('BOARD_CLOSED', k);
    }
    const cleaned = items.map((it) => ({ it, txt: cleanBody(bodies[it.id]) }));
    for (const { it, txt } of cleaned) {
      if (it.required && !txt) throw new BoardError('BOARD_EMPTY', it.id);
      if ([...txt].length > BOARD_MAX_LEN) throw new BoardError('BOARD_TOO_LONG', it.id);
    }
    const mine = (id: BoardItemId) => db.submissions.find((x) => x.team_id === p.team_id && x.item_id === id);
    if (!s.allow_edit && items.some((it) => mine(it.id))) throw new BoardError('BOARD_DUPLICATE');
    const ts = nowIso();
    for (const { it, txt } of cleaned) {
      const row = mine(it.id);
      if (row) {
        if (row.body !== txt) row.edited_count += 1;
        row.body = txt;
        row.updated_at = ts;
      } else {
        db.submissions.push({
          id: uid(),
          team_id: p.team_id,
          item_id: it.id,
          body: txt,
          submitted_at: ts,
          updated_at: ts,
          edited_count: 0,
          hidden: false,
          hidden_note: null,
          highlighted: false,
        });
      }
    }
    p.last_seen = ts;
    write(db, false);
    return ts;
  }

  async counts(): Promise<BoardCounts> {
    const db = read();
    const byGroup: BoardCounts['by_group'] = {};
    for (const g of BOARD_GROUPS) {
      const teams = new Set(db.submissions.filter((x) => groupOfItem(x.item_id) === g.id).map((x) => x.team_id));
      if (teams.size) byGroup[g.id] = teams.size;
    }
    return {
      joined: new Set(db.participants.map((p) => p.team_id)).size,
      submitted: db.state.current_item ? (byGroup[db.state.current_item] ?? 0) : 0,
      by_group: byGroup,
    };
  }

  async feed(groups: BoardGroupId[]): Promise<BoardCard[]> {
    const db = read();
    const s = db.state;
    if (!groups.length) return [];
    const onAir = (s.phase === 'item_open' || s.phase === 'wall') && s.current_item && groups.every((g) => g === s.current_item);
    if (!s.wall_public && !onAir) throw new BoardError('BOARD_FORBIDDEN');
    return db.submissions
      .filter((x) => !x.hidden && x.body !== '' && groups.includes(groupOfItem(x.item_id) as BoardGroupId))
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at) || a.team_id.localeCompare(b.team_id))
      .map(({ id, team_id, item_id, body, updated_at, highlighted }) => ({ id, team_id, item_id, body, updated_at, highlighted }));
  }

  async adminSnapshot(key: string): Promise<BoardAdminSnapshot> {
    checkKey(key);
    const db = read();
    return {
      state: db.state,
      server_now: new Date().toISOString(),
      teams: BOARD_TEAMS.map((t) => {
        const ps = db.participants.filter((p) => p.team_id === t.id);
        return {
          ...t,
          expected_size: 4,
          devices: ps.length,
          last_seen: ps.length ? ps.map((p) => p.last_seen).sort().at(-1)! : null,
        };
      }),
      submissions: [...db.submissions].sort((a, b) => b.updated_at.localeCompare(a.updated_at)),
    };
  }

  async setState(key: string, patch: BoardStatePatch): Promise<BoardState> {
    checkKey(key);
    const db = read();
    const s = { ...db.state };
    if (patch.phase !== undefined) s.phase = patch.phase;
    if (patch.current_item !== undefined) {
      if (patch.current_item && !BOARD_GROUPS.some((g) => g.id === patch.current_item)) throw new BoardError('BOARD_UNKNOWN', 'item');
      s.current_item = patch.current_item;
    }
    if (patch.item_open !== undefined) s.item_open = patch.item_open;
    if (patch.wall_public !== undefined) s.wall_public = patch.wall_public;
    if (patch.allow_edit !== undefined) s.allow_edit = patch.allow_edit;
    if (patch.screen_theme !== undefined) s.screen_theme = patch.screen_theme;
    if (patch.sound_on !== undefined) s.sound_on = patch.sound_on;
    if (patch.scroll_speed !== undefined) s.scroll_speed = patch.scroll_speed;
    if (patch.focus !== undefined) s.focus = patch.focus;
    if (patch.timer_minutes !== undefined) {
      s.timer_ends_at = patch.timer_minutes > 0 ? new Date(Date.now() + patch.timer_minutes * 60_000).toISOString() : null;
    }
    if (patch.timer_extend_sec !== undefined) {
      const base = Math.max(s.timer_ends_at ? new Date(s.timer_ends_at).getTime() : Date.now(), Date.now());
      s.timer_ends_at = new Date(base + patch.timer_extend_sec * 1000).toISOString();
    }
    if (s.phase !== 'item_open') s.item_open = false;
    if (s.item_open && s.current_item && !s.opened_groups.includes(s.current_item)) {
      s.opened_groups = [...s.opened_groups, s.current_item];
    }
    if (s.current_item) s.question = BOARD_GROUPS.find((g) => g.id === s.current_item)!.question;
    db.state = s;
    write(db, true);
    return db.state;
  }

  async moderate(key: string, submissionId: string, action: BoardModerateAction, note?: string): Promise<void> {
    checkKey(key);
    const db = read();
    const row = db.submissions.find((x) => x.id === submissionId);
    if (!row) throw new BoardError('BOARD_UNKNOWN', 'submission');
    let stateChanged = false;
    if (action === 'hide') {
      row.hidden = true;
      row.hidden_note = note?.trim().slice(0, 200) || null;
      const f = db.state.focus;
      if (f && f.team_id === row.team_id && f.group === groupOfItem(row.item_id)) {
        db.state.focus = null;
        stateChanged = true;
      }
    } else if (action === 'unhide') {
      row.hidden = false;
      row.hidden_note = null;
    } else if (action === 'highlight') row.highlighted = true;
    else if (action === 'unhighlight') row.highlighted = false;
    write(db, stateChanged);
  }

  async reset(key: string, scope: 'group' | 'all', group?: BoardGroupId): Promise<void> {
    checkKey(key);
    const db = read();
    if (scope === 'group') {
      db.submissions = db.submissions.filter((x) => groupOfItem(x.item_id) !== group);
      db.state.opened_groups = db.state.opened_groups.filter((g) => g !== group);
      db.state.focus = null;
    } else {
      const keep = db.state;
      db.submissions = [];
      db.participants = [];
      db.state = {
        ...keep,
        phase: 'waiting',
        question: null,
        current_item: null,
        item_open: false,
        opened_groups: [],
        wall_public: false,
        timer_ends_at: null,
        focus: null,
      };
    }
    write(db, true);
  }
}

export function createLocalBoardAdapter(): BoardAdapter {
  return new LocalBoardAdapter();
}
