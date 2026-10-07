#!/usr/bin/env node
// 토의보드 부하 테스트 (Board v1.0) — Node 22 + @supabase/supabase-js
// (scripts/quiz-loadtest.mjs 와 같은 구조)
//
// 가상 참가자 N명(기본 60)이 각각 자기 Supabase 클라이언트(웹소켓 1개)로
//   1) board_join(반조 ID 순환: i % 58) → 2) board_state Realtime 구독(+앱과 같은 3초 폴링)
//   3) 그룹이 열리기(phase=item_open · item_open=true · current_item=--group)를 기다렸다가
//   4) --window 초 안의 무작위 시점에 board_submit 을 한 번 부른다(Q2-3 은 a·b 둘 다).
// 별도의 "월(screen)" 관찰자는 board_feed([group]) 를 1.5초마다 읽어, 각 반조의 제출 성공 시각부터
// 그 카드가 처음 보일 때까지의 시간("월 갱신 지연")을 잰다.
// 보고: 접속 성공률, Realtime 구독 수, 상태 전파 p50/p95, 제출 지연 p50/p95, 코드별 실패,
//       월 갱신 지연 p50/p95/max, missing(제출 성공했는데 닫힌 뒤 10초 안에 월에 안 뜬 반조 — 반드시 0).
// 종료 코드: missing > 0 이거나 월 갱신 지연 p95 > 2000ms 이면 1.
//
// 사용법 (.env.local에 NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY 필요)
//   node scripts/board-loadtest.mjs --n 60 --group Q1-1 --key <운영자키> --window 20
//       → 스크립트가 직접 그룹을 열고(board_set_state) 끝나면 닫는다. 리허설용 DB에서만!
//   node scripts/board-loadtest.mjs --n 60 --group Q1-1
//       → 운영자가 /board/admin 에서 직접 열 때까지 기다린다(최대 --wait 초, 기본 300)
//   node scripts/board-loadtest.mjs --local-dry-run
//       → 네트워크 없이 가짜 백엔드로 흐름·통계 로직만 확인한다
//
// ⚠ 가상 참가자는 board_participants 에 'LT-001'… 이름으로, 제출은 반조 카드로 남는다.
//   끝나면 --cleanup(= board_reset 'all', --key 필요) 또는 운영 화면의 전체 초기화로 정리한다.
// ⚠ 58개 반조에 N명이 돌려 들어가므로 N>58 이면 같은 반조 중복 제출이 생긴다(수정 허용이면 덮어쓰기, 정상).

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ─── 인자 ───────────────────────────────────────────────────

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const opt = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : def;
};

const N = Math.max(1, Number(opt('n', 60)));
const GROUP = opt('group', 'Q1-1');
const KEY = opt('key', '');
const WINDOW_MS = Number(opt('window', 20)) * 1000;
const WAIT_SEC = Number(opt('wait', 300));
const RAMP_MS = Number(opt('ramp', 10)); // 접속 간격(ms)
const DRY = flag('local-dry-run');
const CLEANUP = flag('cleanup');
const POLL_MS = 3000; // 참가자 state 폴링 (앱과 동일)
const FEED_MS = 1000; // 월 관찰자 폴링 (송출 화면과 같은 주기)
const FEED_GRACE_MS = 10_000; // 닫힌 뒤 월에 나타나기를 기다리는 한도
const WALL_P95_LIMIT = 2000;

const TEAMS = [];
for (let t = 1; t <= 29; t += 1) for (const h of ['A', 'B']) TEAMS.push(`${t}${h}`);
const ITEMS = GROUP === 'Q2-3' ? ['Q2-3a', 'Q2-3b'] : [GROUP];

// ─── 통계 ───────────────────────────────────────────────────

function pct(arr, p) {
  if (!arr.length) return NaN;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))];
}
const fmt = (v) => (Number.isFinite(v) ? `${Math.round(v)}ms` : '—');
const maxOf = (arr) => (arr.length ? Math.max(...arr) : NaN);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isOpen = (row) => Boolean(row) && row.phase === 'item_open' && row.item_open === true && row.current_item === GROUP;
const errCode = (err) => /BOARD_[A-Z_]+/.exec(String(err?.message ?? err))?.[0] ?? 'NETWORK';
/** 네트워크 오류(서버가 BOARD_* 로 답한 게 아님)만 한 번 재시도 */
async function withRetry(fn) {
  try {
    return await fn();
  } catch (err) {
    if (errCode(err) !== 'NETWORK') throw err;
    await sleep(300);
    return fn();
  }
}

// ─── 백엔드: 실제 Supabase ─────────────────────────────────

function loadEnv() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const env = { ...process.env };
  for (const f of ['.env.local', '.env']) {
    const p = resolve(root, f);
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (m && !env[m[1]]) env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
    }
  }
  return env;
}

async function realBackend() {
  const env = loadEnv();
  const url = opt('url', '') || env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL;
  const anon =
    opt('anon', '') ||
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    env.SUPABASE_ANON_KEY;
  if (!url || !anon) {
    console.error('--url/--anon 또는 NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY 가 필요합니다 (.env.local).');
    process.exit(2);
  }
  const { createClient } = await import('@supabase/supabase-js');
  const make = () =>
    createClient(url, anon, {
      auth: { persistSession: false, autoRefreshToken: false },
      realtime: { params: { eventsPerSecond: 20 } },
    });
  const unwrap = ({ data, error }) => {
    if (error) throw new Error(error.message);
    return data;
  };
  const stateOf = async (c) => unwrap(await c.from('board_state').select('*').eq('id', 1).maybeSingle());

  return {
    label: `Supabase ${new URL(url).host}`,
    operator() {
      const c = make();
      return {
        setState: async (patch) => unwrap(await c.rpc('board_set_state', { p_key: KEY, p_patch: patch })),
        reset: async (scope) => unwrap(await c.rpc('board_reset', { p_key: KEY, p_scope: scope, p_group: null })),
      };
    },
    /** 월 관찰자 */
    screen() {
      const c = make();
      return {
        feed: async (groups) => unwrap(await c.rpc('board_feed', { p_groups: groups })) ?? [],
        close: async () => c.realtime.disconnect(),
      };
    },
    participant() {
      const c = make();
      let channel = null;
      return {
        join: async (team, name, device) => {
          const r = unwrap(await c.rpc('board_join', { p_team: team, p_name: name, p_device: device }));
          return Array.isArray(r) ? r[0] : r;
        },
        getState: () => stateOf(c),
        subscribe(onRow, onStatus) {
          channel = c
            .channel('board_state')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'board_state' }, (p) => onRow(p.new))
            .subscribe((status) => onStatus(status));
        },
        submit: async (id, bodies) => unwrap(await c.rpc('board_submit', { p_id: id, p_bodies: bodies })),
        close: async () => {
          if (channel) await c.removeChannel(channel);
          c.realtime.disconnect();
        },
      };
    },
  };
}

// ─── 백엔드: 가짜 (--local-dry-run) ─────────────────────────
// 서버 한 개를 메모리에 두고 지연을 흉내 낸다. Realtime 연결 3%는 실패(→ 폴링만),
// Realtime 전파 40~400ms, RPC 30~180ms, 0.5%는 RPC 실패(네트워크 오류, 클라이언트가 한 번 재시도).

function fakeBackend() {
  const rand = (a, b) => a + Math.random() * (b - a);
  const server = {
    state: {
      id: 1, phase: 'waiting', current_item: null, item_open: false, allow_edit: true,
      wall_public: false, updated_at: new Date().toISOString(),
    },
    participants: new Map(),
    cards: new Map(), // `${team}|${item}` → card
    subscribers: new Set(),
    seq: 0,
    bump() {
      this.state = { ...this.state, updated_at: new Date().toISOString() };
      for (const cb of this.subscribers) setTimeout(() => cb({ ...this.state }), rand(40, 400));
    },
  };
  const rpc = async (fn) => {
    await sleep(rand(30, 180));
    if (Math.random() < 0.005) throw new Error('fake network error');
    return fn();
  };
  const submit = (id, bodies) => {
    const p = server.participants.get(id);
    if (!p) throw new Error('BOARD_UNKNOWN: participant');
    const s = server.state;
    if (s.phase !== 'item_open' || !s.item_open || !s.current_item) throw new Error('BOARD_CLOSED');
    const items = s.current_item === 'Q2-3' ? ['Q2-3a', 'Q2-3b'] : [s.current_item];
    for (const k of Object.keys(bodies)) if (!items.includes(k)) throw new Error(`BOARD_CLOSED: ${k}`);
    const first = String(bodies[items[0]] ?? '').trim();
    if (!first) throw new Error(`BOARD_EMPTY: ${items[0]}`);
    for (const k of items) if (String(bodies[k] ?? '').length > 1000) throw new Error(`BOARD_TOO_LONG: ${k}`);
    if (!s.allow_edit && items.some((k) => server.cards.has(`${p.team_id}|${k}`))) throw new Error('BOARD_DUPLICATE');
    const ts = new Date().toISOString();
    for (const k of items) {
      const body = String(bodies[k] ?? '').trim();
      const key = `${p.team_id}|${k}`;
      server.cards.set(key, { id: key, team_id: p.team_id, item_id: k, body, updated_at: ts + (server.seq += 1), highlighted: false });
    }
    return ts;
  };
  return {
    label: 'local dry-run (가짜 백엔드)',
    operator() {
      return {
        setState: (patch) =>
          rpc(() => {
            Object.assign(server.state, patch);
            server.bump();
            return { ...server.state };
          }),
        reset: (scope) =>
          rpc(() => {
            if (scope === 'all') {
              server.participants.clear();
              server.cards.clear();
              Object.assign(server.state, { phase: 'waiting', current_item: null, item_open: false });
              server.bump();
            }
          }),
      };
    },
    screen() {
      return {
        feed: (groups) =>
          rpc(() =>
            [...server.cards.values()]
              .filter((c) => c.body !== '' && groups.some((g) => c.item_id.startsWith(g)))
              .map((c) => ({ ...c })),
          ),
        close: async () => undefined,
      };
    },
    participant() {
      let sub = null;
      return {
        join: (team, name) =>
          rpc(() => {
            const p = { id: `p${server.participants.size + 1}`, team_id: team, name };
            server.participants.set(p.id, p);
            return { ...p };
          }),
        getState: () => rpc(() => ({ ...server.state })),
        subscribe(onRow, onStatus) {
          setTimeout(() => {
            if (Math.random() < 0.03) {
              onStatus('CHANNEL_ERROR');
              return;
            }
            sub = (row) => onRow(row);
            server.subscribers.add(sub);
            onStatus('SUBSCRIBED');
          }, rand(50, 600));
        },
        submit: (id, bodies) => rpc(() => submit(id, bodies)),
        close: async () => {
          if (sub) server.subscribers.delete(sub);
        },
      };
    },
  };
}

// ─── 실행 ───────────────────────────────────────────────────

const backend = DRY ? fakeBackend() : await realBackend();
if (!DRY && CLEANUP && !KEY) {
  console.error('--cleanup 은 --key <운영자키> 가 필요합니다.');
  process.exit(2);
}
const operate = Boolean(KEY) || DRY;
console.log(
  `▶ ${backend.label} · 가상 참가자 ${N}명 · 그룹 ${GROUP} · 창 ${WINDOW_MS / 1000}s · ${operate ? '스크립트가 직접 열기' : '운영자가 열 때까지 대기'}`,
);

const results = {
  joinFail: 0,
  subscribed: 0,
  channelFail: 0,
  propagation: [],
  via: { realtime: 0, poll: 0 },
  submitLatency: [],
  submitOk: 0,
  submitFail: {},
  missedOpen: 0,
};
const teamFirstOk = new Map(); // team → 첫 제출 성공 시각(Date.now)
let openSentAt = null;

const op = backend.operator();
if (operate) {
  // 이전 실행이 열어 둔 채라면 먼저 닫아 둔다(참가자가 접속 직후 이미 열린 상태를 보지 않도록)
  try {
    await op.setState({ item_open: false });
  } catch (err) {
    console.log(`  사전 닫기 실패(무시): ${err.message}`);
  }
}

const vps = [];
const t0 = Date.now();

async function runVp(i) {
  const vp = backend.participant();
  const team = TEAMS[i % TEAMS.length];
  const label = `LT-${String(i + 1).padStart(3, '0')}`;
  let me;
  try {
    me = await withRetry(() => vp.join(team, label, `lt-device-${i + 1}`));
    if (!me?.id) throw new Error('no id');
  } catch {
    results.joinFail += 1;
    return;
  }

  let resolveOpen;
  const opened = new Promise((r) => (resolveOpen = r));
  let seenOpen = false;
  const onState = (row, via) => {
    if (seenOpen || !isOpen(row)) return;
    seenOpen = true;
    const now = Date.now();
    // 스크립트가 열었으면 보낸 시각 기준, 아니면 서버 updated_at 기준(시계 차이 포함)
    const origin = openSentAt ?? new Date(row.updated_at).getTime();
    results.propagation.push(Math.max(0, now - origin));
    results.via[via] += 1;
    resolveOpen(row);
  };

  const subscribed = new Promise((r) => {
    vp.subscribe(
      (row) => onState(row, 'realtime'),
      (status) => {
        if (status === 'SUBSCRIBED') {
          results.subscribed += 1;
          r(true);
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          results.channelFail += 1;
          r(false);
        }
      },
    );
    setTimeout(() => r(false), 10_000);
  });

  const poll = setInterval(() => {
    vp.getState()
      .then((row) => onState(row, 'poll'))
      .catch(() => undefined);
  }, POLL_MS);

  vps.push({ vp, me, team, i, subscribed, opened, poll });
}

for (let i = 0; i < N; i += 1) {
  void runVp(i);
  if (RAMP_MS) await sleep(RAMP_MS);
}
while (vps.length + results.joinFail < N) await sleep(50);
await Promise.all(vps.map((v) => v.subscribed));
console.log(
  `  접속 ${vps.length}/${N} · Realtime 구독 ${results.subscribed} · 구독 실패 ${results.channelFail} (${((Date.now() - t0) / 1000).toFixed(1)}s)`,
);

// ─── 월 관찰자: board_feed([GROUP]) 를 1.5초마다 ───────────

const screen = backend.screen();
const baseline = new Map(); // `${team}|${item}` → 시작 전 updated_at (이전 실행의 잔여 카드 구분)
try {
  for (const c of await withRetry(() => screen.feed([GROUP]))) baseline.set(`${c.team_id}|${c.item_id}`, c.updated_at);
} catch {
  /* 닫힌 상태에서 FORBIDDEN 일 수 있음 — 기준선 없이 진행 */
}
const firstSeen = new Map(); // team → 첫 출현 시각(Date.now)
let feedStop = false;
let feedErrors = 0;
const feedLoop = (async () => {
  while (!feedStop) {
    try {
      const cards = await screen.feed([GROUP]);
      const now = Date.now();
      for (const c of cards) {
        const key = `${c.team_id}|${c.item_id}`;
        if (baseline.get(key) === c.updated_at) continue; // 이번 실행 이전 카드
        if (!firstSeen.has(c.team_id)) firstSeen.set(c.team_id, now);
      }
    } catch {
      feedErrors += 1;
    }
    await sleep(FEED_MS);
  }
})();

// ─── 열기 → 제출 → 닫기 ────────────────────────────────────

if (operate) {
  await sleep(1000);
  openSentAt = Date.now();
  await op.setState({ phase: 'item_open', current_item: GROUP, item_open: true });
  console.log(`  그룹 열기 (${GROUP})`);
} else {
  console.log(`  운영 화면에서 ${GROUP} 을 열어 주세요… (최대 ${WAIT_SEC}초)`);
}

await Promise.all(
  vps.map(async ({ vp, me, team, i, opened }) => {
    const row = await Promise.race([opened, sleep(WAIT_SEC * 1000).then(() => null)]);
    if (!row) {
      results.missedOpen += 1;
      return;
    }
    await sleep(Math.random() * WINDOW_MS);
    const bodies = {};
    for (const k of ITEMS) bodies[k] = k.endsWith('b') ? `부하 테스트 ${team} ${i} (b)` : `부하 테스트 ${team} ${i}`;
    const a = Date.now();
    try {
      await withRetry(() => vp.submit(me.id, bodies));
      const done = Date.now();
      results.submitLatency.push(done - a);
      results.submitOk += 1;
      if (!teamFirstOk.has(team)) teamFirstOk.set(team, done);
    } catch (err) {
      const code = errCode(err);
      results.submitFail[code] = (results.submitFail[code] ?? 0) + 1;
    }
  }),
);

let closedAt = Date.now();
if (operate) {
  try {
    await op.setState({ item_open: false });
    closedAt = Date.now();
    console.log('  그룹 닫기');
  } catch (err) {
    console.log(`  닫기 실패: ${err.message}`);
  }
}

// 닫힌 뒤 최대 10초, 제출에 성공한 반조가 모두 월에 보일 때까지
while (Date.now() - closedAt < FEED_GRACE_MS && [...teamFirstOk.keys()].some((t) => !firstSeen.has(t))) await sleep(200);
feedStop = true;
await feedLoop;

if (CLEANUP || DRY) {
  try {
    await op.reset('all');
    console.log('  정리: 전체 초기화(참가자·제출 포함)');
  } catch (err) {
    console.log(`  정리 실패: ${err.message}`);
  }
}
for (const v of vps) {
  clearInterval(v.poll);
  await v.vp.close().catch(() => undefined);
}
await screen.close().catch(() => undefined);

// ─── 보고 ───────────────────────────────────────────────────

const wall = [];
const missing = [];
for (const [team, okAt] of teamFirstOk) {
  const seen = firstSeen.get(team);
  if (seen === undefined) missing.push(team);
  else wall.push(Math.max(0, seen - okAt));
}
const failTotal = Object.values(results.submitFail).reduce((a, b) => a + b, 0);
const dup = results.submitFail.BOARD_DUPLICATE ?? 0;
const wallP95 = pct(wall, 95);
const pass = missing.length === 0 && !(wallP95 > WALL_P95_LIMIT);

console.log('\n━━ 결과 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`접속(join)        ${vps.length}/${N} 성공, 실패 ${results.joinFail}`);
console.log(`Realtime 연결     ${results.subscribed}/${vps.length} (${((results.subscribed / Math.max(1, vps.length)) * 100).toFixed(1)}%), 실패 ${results.channelFail}`);
console.log(
  `상태 전파         p50 ${fmt(pct(results.propagation, 50))} · p95 ${fmt(pct(results.propagation, 95))} · max ${fmt(maxOf(results.propagation))}  (Realtime 먼저 ${results.via.realtime} · 폴링 먼저 ${results.via.poll} · 못 받음 ${results.missedOpen})`,
);
console.log(`제출 지연(RPC)    p50 ${fmt(pct(results.submitLatency, 50))} · p95 ${fmt(pct(results.submitLatency, 95))}`);
console.log(`제출              성공 ${results.submitOk} · 실패 ${failTotal} ${failTotal ? JSON.stringify(results.submitFail) : ''}`);
console.log(`  └ 같은 반조 중복(BOARD_DUPLICATE) ${dup}건 (N>${TEAMS.length}이면 정상, allow_edit 켜짐이면 0)`);
console.log(`반조              제출 성공 ${teamFirstOk.size}개 반조 · 월에 보인 ${teamFirstOk.size - missing.length}개`);
console.log(
  `월 갱신 지연      p50 ${fmt(pct(wall, 50))} · p95 ${fmt(wallP95)} · max ${fmt(maxOf(wall))}  (월 폴링 ${FEED_MS}ms${feedErrors ? `, 폴링 오류 ${feedErrors}` : ''})`,
);
console.log(`missing           ${missing.length}${missing.length ? ` → ${missing.join(', ')}` : ''}  (0이어야 함)`);
console.log(`판정              ${pass ? '✅ 목표 충족 (missing 0, 월 갱신 p95 ≤ 2s)' : '❌ 실패 (missing > 0 또는 월 갱신 p95 > 2s)'}`);
process.exit(pass ? 0 : 1);
