// 토의보드 로컬 어댑터 (Board v1.2) — 환경변수 없이 한 브라우저 안에서 전체 흐름을 시연·테스트한다.
//   저장: localStorage['eb:board:v1'] · 동기화: BroadcastChannel('eb:board') + storage 이벤트 + 3초 폴링
//   규칙은 supabase/board_v1.0_migration.sql · board_v1.1_migration.sql · board_v1.2_migration.sql 의 함수와 똑같이 맞췄다. 실서비스는 Supabase.
//   카드 키(card)는 서버의 HMAC 대신 간단한 해시다(로컬 시연용 — 보안 경계가 아니다).

import { OPERATOR_KEY } from './admin';
import type { BoardAdapter } from './boardDb';
import { BOARD_GROUPS, BOARD_ITEMS, BOARD_MAX_LEN, BOARD_TEAMS, type BoardGroupId, type BoardItemId } from './boardSeed';
import type { BoardSummary, BoardSummarySource } from './boardSummary';
import { requestSummary } from './boardSummaryClient';
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
  type BoardMyVotes,
  type BoardRankRow,
  type BoardRole,
  type BoardState,
  type BoardStatePatch,
  type BoardVoteRow,
  BOARD_MAX_VOTES,
} from './boardTypes';

const KEY = 'eb:board:v1';
const CHANNEL = 'eb:board';

interface LocalParticipant extends BoardMe {
  device_token: string | null;
  joined_at: string;
  last_seen: string;
}

interface LocalVote {
  participant_id: string;
  group_key: BoardGroupId;
  team_id: string;
}

interface LocalDb {
  state: BoardState;
  participants: LocalParticipant[];
  /** card 는 읽을 때 채운다(저장된 값은 쓰지 않는다) */
  submissions: Omit<BoardAdminSubmission, 'card'>[];
  votes: LocalVote[];
  /** AI 갈무리 저장본 (그룹당 하나) */
  summaries: Record<string, BoardSummary>;
}

const LOCAL_SALT = 'eb-board-local-salt';
/** 반조 + 그룹 → 불투명 16자 키 (FNV-1a 두 가닥). 같은 반조의 같은 그룹은 항상 같은 값 */
export function cardKey(team: string, group: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193 ^ 0xdeadbeef;
  const text = `${LOCAL_SALT}|${team}:${group}`;
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ (c + i), 0x85ebca6b) >>> 0;
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
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
  return { state: { ...EMPTY_BOARD_STATE, updated_at: nowIso() }, participants: [], submissions: [], votes: [], summaries: {} };
}

function read(): LocalDb {
  if (typeof window === 'undefined') return empty();
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return empty();
    const db = JSON.parse(raw) as LocalDb;
    db.state = { ...EMPTY_BOARD_STATE, ...db.state };
    db.votes ??= [];
    db.summaries ??= {};
    // v1.0 때 저장된 참가자 · 크게 보기 호환
    for (const p of db.participants) p.role ??= 'recorder';
    if (db.state.focus && !(db.state.focus as { card?: string }).card) db.state.focus = null;
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

function withCard(x: Omit<BoardAdminSubmission, 'card'>): BoardAdminSubmission {
  return { ...x, card: cardKey(x.team_id, groupOfItem(x.item_id) ?? '') };
}

/** 그 반조의 그룹 카드가 모아보기에 보이는가(숨김 아님 · 빈 본문 아님) */
function isVisible(db: LocalDb, team: string, group: string): boolean {
  return db.submissions.some((x) => x.team_id === team && groupOfItem(x.item_id) === group && !x.hidden && x.body !== '');
}

function votesOf(db: LocalDb, pid: string, group: string): BoardMyVotes {
  const mine = db.votes.filter((v) => v.participant_id === pid && v.group_key === group && isVisible(db, v.team_id, group));
  return { my: mine.map((v) => cardKey(v.team_id, group)), left: Math.max(0, BOARD_MAX_VOTES - mine.length) };
}

function voteRows(db: LocalDb): BoardVoteRow[] {
  const by = new Map<string, BoardVoteRow>();
  for (const v of db.votes) {
    const k = `${v.group_key}|${v.team_id}`;
    const r = by.get(k) ?? { group_key: v.group_key, team_id: v.team_id, votes: 0 };
    r.votes += 1;
    by.set(k, r);
  }
  return [...by.values()].sort((a, b) => a.group_key.localeCompare(b.group_key) || b.votes - a.votes || a.team_id.localeCompare(b.team_id));
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

  async join(teamId: string, name: string, device: string, role: BoardRole = 'recorder'): Promise<BoardMe> {
    if (role !== 'recorder' && role !== 'viewer') throw new BoardError('BOARD_EMPTY', 'role');
    if (!BOARD_TEAMS.some((t) => t.id === teamId)) throw new BoardError('BOARD_UNKNOWN', 'team');
    const db = read();
    const nm = (cleanBody(name) || (role === 'viewer' ? '관전자' : '기록자')).slice(0, 20);
    const dev = device.trim().slice(0, 64) || null;
    const ts = nowIso();
    if (dev) db.participants = db.participants.filter((x) => !(x.device_token === dev && x.team_id !== teamId));
    let p = dev ? [...db.participants].reverse().find((x) => x.device_token === dev && x.team_id === teamId) : undefined;
    if (p) {
      p.name = nm;
      p.role = role;
      p.last_seen = ts;
    } else {
      p = { id: uid(), team_id: teamId, name: nm, role, device_token: dev, joined_at: ts, last_seen: ts };
      db.participants.push(p);
    }
    // 참가자가 지워진 반조의 투표도 정리
    db.votes = db.votes.filter((v) => db.participants.some((x) => x.id === v.participant_id));
    write(db, false);
    return { id: p.id, team_id: p.team_id, name: p.name, role: p.role };
  }

  async my(participantId: string): Promise<BoardMyView | null> {
    const db = read();
    const p = db.participants.find((x) => x.id === participantId);
    if (!p) return null;
    p.last_seen = nowIso();
    write(db, false);
    return {
      participant: { id: p.id, team_id: p.team_id, name: p.name, role: p.role },
      submissions: db.submissions
        .filter((s) => s.team_id === p.team_id)
        .sort((a, b) => a.item_id.localeCompare(b.item_id))
        .map(({ item_id, body, submitted_at, updated_at, edited_count }) => ({
          item_id,
          body,
          submitted_at,
          updated_at,
          edited_count,
          card: cardKey(p.team_id, groupOfItem(item_id) ?? ''),
        })),
    };
  }

  async submit(participantId: string, bodies: Record<string, string>): Promise<string> {
    const db = read();
    const p = db.participants.find((x) => x.id === participantId);
    if (!p) throw new BoardError('BOARD_UNKNOWN', 'participant');
    if (p.role !== 'recorder') throw new BoardError('BOARD_NOT_RECORDER');
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
      const teams = new Set(db.submissions.filter((x) => groupOfItem(x.item_id) === g.id && !x.hidden && x.body !== '').map((x) => x.team_id));
      if (teams.size) byGroup[g.id] = teams.size;
    }
    const cur = db.state.current_item;
    // 제출 수는 빈 제출도 센다(서버와 같다)
    const submitted = cur ? new Set(db.submissions.filter((x) => groupOfItem(x.item_id) === cur).map((x) => x.team_id)).size : 0;
    return {
      joined: new Set(db.participants.filter((p) => p.role === 'recorder').map((p) => p.team_id)).size,
      viewers: db.participants.filter((p) => p.role === 'viewer').length,
      voters: cur ? new Set(db.votes.filter((v) => v.group_key === cur).map((v) => v.participant_id)).size : 0,
      submitted,
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
      .map((x) => ({ id: x.id, card: cardKey(x.team_id, groupOfItem(x.item_id) ?? ''), item_id: x.item_id, body: x.body, updated_at: x.updated_at, highlighted: x.highlighted }));
  }

  async vote(participantId: string, group: BoardGroupId, card: string, on: boolean): Promise<BoardMyVotes> {
    const db = read();
    const s = db.state;
    const p = db.participants.find((x) => x.id === participantId);
    if (!p) throw new BoardError('BOARD_UNKNOWN', 'participant');
    if (!s.vote_items.includes(group) || !s.vote_open) throw new BoardError('BOARD_CLOSED');
    const t = BOARD_TEAMS.find((x) => cardKey(x.id, group) === card);
    if (!t) throw new BoardError('BOARD_UNKNOWN', 'card');
    const has = db.votes.some((v) => v.participant_id === p.id && v.group_key === group && v.team_id === t.id);
    if (on) {
      if (t.id === p.team_id) throw new BoardError('BOARD_OWN_CARD');
      if (!isVisible(db, t.id, group)) throw new BoardError('BOARD_UNKNOWN', 'card');
      if (!has) {
        if (votesOf(db, p.id, group).left <= 0) throw new BoardError('BOARD_VOTE_LIMIT');
        db.votes.push({ participant_id: p.id, group_key: group, team_id: t.id });
      }
    } else {
      db.votes = db.votes.filter((v) => !(v.participant_id === p.id && v.group_key === group && v.team_id === t.id));
    }
    p.last_seen = nowIso();
    write(db, false);
    return votesOf(db, p.id, group);
  }

  async myVotes(participantId: string, group: BoardGroupId): Promise<BoardMyVotes> {
    const db = read();
    if (!db.participants.some((x) => x.id === participantId)) throw new BoardError('BOARD_UNKNOWN', 'participant');
    return votesOf(db, participantId, group);
  }

  async ranking(group: BoardGroupId): Promise<BoardRankRow[]> {
    const db = read();
    const s = db.state;
    if (!s.vote_reveal || !s.vote_items.includes(group)) throw new BoardError('BOARD_FORBIDDEN');
    const items = itemsOf(group);
    const rows: BoardRankRow[] = [];
    for (const t of BOARD_TEAMS) {
      const parts = items
        .map((it) => db.submissions.find((x) => x.team_id === t.id && x.item_id === it.id))
        .filter((x): x is NonNullable<typeof x> => Boolean(x) && !x!.hidden && x!.body !== '')
        .map((x) => ({ item_id: x.item_id, body: x.body }));
      if (!parts.length) continue;
      rows.push({ card: cardKey(t.id, group), votes: db.votes.filter((v) => v.group_key === group && v.team_id === t.id).length, parts });
    }
    return rows.sort((a, b) => b.votes - a.votes || a.card.localeCompare(b.card));
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
          recorders: ps.filter((p) => p.role === 'recorder').length,
          viewers: ps.filter((p) => p.role === 'viewer').length,
          last_seen: ps.length ? ps.map((p) => p.last_seen).sort().at(-1)! : null,
        };
      }),
      submissions: [...db.submissions].sort((a, b) => b.updated_at.localeCompare(a.updated_at)).map(withCard),
      votes: voteRows(db),
      voters: db.state.current_item ? new Set(db.votes.filter((v) => v.group_key === db.state.current_item).map((v) => v.participant_id)).size : 0,
    };
  }

  async setState(key: string, patch: BoardStatePatch): Promise<BoardState> {
    checkKey(key);
    const db = read();
    const s = { ...db.state };
    const oldOpen = s.item_open;
    const oldItem = s.current_item;
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
    if (patch.focus !== undefined) {
      if (patch.focus === null) s.focus = null;
      else {
        // 서버와 같다 — 반조 ID가 섞여 와도 저장하지 않는다
        const f = { ...patch.focus } as Record<string, unknown>;
        delete f.team_id;
        s.focus = f as unknown as BoardState['focus'];
      }
    }
    if (patch.timer_minutes !== undefined) {
      s.timer_ends_at = patch.timer_minutes > 0 ? new Date(Date.now() + patch.timer_minutes * 60_000).toISOString() : null;
    }
    if (patch.timer_extend_sec !== undefined) {
      const base = Math.max(s.timer_ends_at ? new Date(s.timer_ends_at).getTime() : Date.now(), Date.now());
      s.timer_ends_at = new Date(base + patch.timer_extend_sec * 1000).toISOString();
    }
    if (patch.vote_items !== undefined) {
      const vi = [...new Set(patch.vote_items)].sort();
      if (vi.some((g) => !BOARD_GROUPS.some((x) => x.id === g))) throw new BoardError('BOARD_UNKNOWN', 'vote_items');
      s.vote_items = vi;
    }
    if (patch.vote_open !== undefined) s.vote_open = patch.vote_open;
    if (patch.vote_reveal !== undefined) s.vote_reveal = patch.vote_reveal;
    if (s.phase !== 'item_open') s.item_open = false;
    if (s.item_open && s.current_item && !s.opened_groups.includes(s.current_item)) {
      s.opened_groups = [...s.opened_groups, s.current_item];
    }
    if (s.current_item) s.question = BOARD_GROUPS.find((g) => g.id === s.current_item)!.question;
    if (s.item_open) {
      if (!oldOpen || s.current_item !== oldItem) s.item_opened_at = new Date().toISOString();
    } else {
      s.item_opened_at = null;
    }
    // v1.2: 모아보기가 아니거나 탭이 바뀌면 띄워 둔 AI 갈무리 리포트는 내린다 (서버 board_set_state 와 같다)
    if (s.phase !== 'wall') s.summary = null;
    if (s.current_item !== oldItem) s.summary = null;
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
      const g = groupOfItem(row.item_id);
      if (f && g && f.group === g && f.card === cardKey(row.team_id, g)) {
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
      db.votes = db.votes.filter((v) => v.group_key !== group);
      if (group) delete db.summaries[group];
      if (db.state.summary?.group === group) db.state.summary = null;
      db.submissions = db.submissions.filter((x) => groupOfItem(x.item_id) !== group);
      db.state.opened_groups = db.state.opened_groups.filter((g) => g !== group);
      db.state.focus = null;
    } else {
      const keep = db.state;
      db.submissions = [];
      db.participants = [];
      db.votes = [];
      db.summaries = {};
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
        item_opened_at: null,
        vote_open: false,
        vote_reveal: false,
        summary: null,
      };
    }
    write(db, true);
  }

  async summaries(key: string): Promise<BoardSummary[]> {
    checkKey(key);
    return Object.values(read().summaries).sort((a, b) => a.group.localeCompare(b.group));
  }

  async summarize(key: string, group: BoardGroupId): Promise<BoardSummary> {
    checkKey(key);
    if (!BOARD_GROUPS.some((g) => g.id === group)) throw new BoardError('BOARD_UNKNOWN', 'group');
    const db = read();
    // 서버의 board_summary_source 와 같다 — 숨김·빈 답 제외, 항목 순·수정 시각 순. 반조 정보는 싣지 않는다
    const items = itemsOf(group);
    const source: BoardSummarySource = {
      items: items.map((i) => ({ item_id: i.id, title: i.title, prompt: i.prompt })),
      answers: items.flatMap((it) =>
        db.submissions
          .filter((x) => x.item_id === it.id && !x.hidden && x.body.trim() !== '')
          .sort((a, b) => a.updated_at.localeCompare(b.updated_at))
          .map((x) => ({ item_id: x.item_id, body: x.body })),
      ),
    };
    const out = await requestSummary(key, group, source);
    // 요청하는 동안 바뀐 저장소를 다시 읽어서 저장한다
    const fresh = read();
    fresh.summaries[group] = out;
    // 그 그룹이 지금 송출 중이면 송출본도 새 값으로 (서버 board_summary_save 와 같다)
    const onAir = fresh.state.summary?.group === group;
    if (onAir) fresh.state.summary = out;
    write(fresh, onAir);
    return out;
  }

  async showSummary(key: string, group: BoardGroupId | null): Promise<BoardState> {
    checkKey(key);
    const db = read();
    if (!group) {
      db.state.summary = null;
    } else {
      const saved = db.summaries[group];
      if (!saved) throw new BoardError('BOARD_UNKNOWN', 'summary');
      db.state.summary = saved;
    }
    write(db, true);
    return db.state;
  }
}

export function createLocalBoardAdapter(): BoardAdapter {
  return new LocalBoardAdapter();
}
