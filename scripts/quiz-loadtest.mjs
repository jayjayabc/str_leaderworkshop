#!/usr/bin/env node
// 스피드 퀴즈 부하 테스트 (Quiz v1.0) — Node 22 + @supabase/supabase-js
//
// 가상 참가자 N명(기본 250)이 각각 자기 Supabase 클라이언트(웹소켓 1개)로
//   1) quiz_join → 2) quiz_state Realtime 구독(+앱과 같은 3초 폴링) → 3) status=open을 기다렸다가
//   4) 0~3초 사이 무작위 시점에 submit_answer 를 부른다.
// 보고: 연결 성공률, 상태 전파 지연 p50/p95(Realtime/폴링 중 먼저 도착한 것), 제출 지연 p50/p95, 실패.
//
// 사용법 (.env.local에 NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY 필요)
//   node scripts/quiz-loadtest.mjs --n 250 --key <운영자키> --index 0
//       → 스크립트가 직접 문제를 열고(open) 끝나면 닫는다(close). 리허설용 DB에서만!
//   node scripts/quiz-loadtest.mjs --n 250
//       → 운영자가 /quiz/admin에서 직접 열 때까지 기다린다(최대 --wait 초, 기본 300)
//   node scripts/quiz-loadtest.mjs --local-dry-run --n 250
//       → 네트워크 없이 가짜 백엔드로 흐름·통계 로직만 확인한다(이 샌드박스에서 돌린 것)
//
// ⚠ 가상 참가자는 quiz_participants에 'LT-001'… 이름으로 남는다. 끝나면 /quiz/admin →
//   전체 초기화(참가자도 지우기)로 정리하거나 --cleanup(= reset_all participants, --key 필요)을 쓴다.
// ⚠ Supabase Free 플랜은 Realtime 동시 접속이 200개로 제한된다. N=250이면 일부 연결이 거부되고
//   그 참가자들은 3초 폴링으로만 상태를 받는다(앱은 그래도 동작). 이 스크립트가 그 비율을 보여 준다.

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

const N = Math.max(1, Number(opt('n', 250)));
const KEY = opt('key', '');
const INDEX = Number(opt('index', 0));
const DURATION = Number(opt('duration', 60));
const WAIT_SEC = Number(opt('wait', 300));
const WINDOW_MS = Number(opt('window', 3000));
const POLL_MS = 3000;
const DRY = flag('local-dry-run');
const CLEANUP = flag('cleanup');
const RAMP_MS = Number(opt('ramp', 10)); // 접속 간격(ms) — 250명이 한꺼번에 붙는 것을 약간 분산

// ─── 통계 ───────────────────────────────────────────────────

function pct(arr, p) {
  if (!arr.length) return NaN;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))];
}
const fmt = (v) => (Number.isFinite(v) ? `${Math.round(v)}ms` : '—');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
  const url = env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL;
  const anon =
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY || env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY;
  if (!url || !anon) {
    console.error('NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY 가 필요합니다 (.env.local).');
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

  return {
    label: `Supabase ${new URL(url).host}`,
    /** 운영자용 클라이언트 하나 */
    operator() {
      const c = make();
      return {
        control: async (action, payload = {}) =>
          unwrap(await c.rpc('quiz_control', { p_key: KEY, p_action: action, p_payload: payload })),
        getState: async () => unwrap(await c.from('quiz_state').select('*').eq('id', 1).maybeSingle()),
      };
    },
    /** 가상 참가자 하나 = 클라이언트(웹소켓) 하나 */
    participant() {
      const c = make();
      let channel = null;
      return {
        serverNow: async () => new Date(unwrap(await c.rpc('server_now'))).getTime(),
        // v2.0 단체전: 조마다 첫 가상 참가자가 답변자, 나머지는 관전자(관전자는 제출하지 않는다)
        join: async (name, table) => {
          const r = await c.rpc('quiz_join_team', { p_table: table, p_role: 'answerer', p_takeover: false, p_name: name });
          if (!r.error) return unwrap(r);
          return unwrap(await c.rpc('quiz_join_team', { p_table: table, p_role: 'spectator', p_takeover: false, p_name: name }));
        },
        getState: async () => unwrap(await c.from('quiz_state').select('*').eq('id', 1).maybeSingle()),
        subscribe(onRow, onStatus) {
          channel = c
            .channel('quiz_state')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'quiz_state' }, (p) => onRow(p.new))
            .subscribe((status) => onStatus(status));
        },
        submit: async (pid, index, answer) =>
          unwrap(await c.rpc('submit_answer', { p_participant: pid, p_index: index, p_answer: answer })),
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
// Realtime 전파 40~400ms, RPC 30~180ms, 0.5%는 RPC 실패.

function fakeBackend() {
  const rand = (a, b) => a + Math.random() * (b - a);
  const server = {
    state: { id: 1, status: 'lobby', current_index: 0, opened_at: null, duration_sec: 60, updated_at: new Date().toISOString() },
    participants: new Map(),
    submissions: new Map(),
    subscribers: new Set(),
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
  return {
    label: 'local dry-run (가짜 백엔드)',
    operator() {
      return {
        control: (action, payload = {}) =>
          rpc(() => {
            if (action === 'open') {
              Object.assign(server.state, {
                status: 'open',
                current_index: payload.index,
                opened_at: new Date().toISOString(),
                duration_sec: payload.duration_sec,
              });
            } else if (action === 'close') server.state.status = 'closed';
            else if (action === 'reset_all') {
              server.participants.clear();
              server.submissions.clear();
              server.state.status = 'lobby';
            }
            server.bump();
            return { ...server.state };
          }),
        getState: () => rpc(() => ({ ...server.state })),
      };
    },
    participant() {
      let sub = null;
      return {
        serverNow: () => rpc(() => Date.now()),
        join: (name, table) =>
          rpc(() => {
            const p = { id: `p${server.participants.size + 1}`, name, table_no: table };
            server.participants.set(p.id, p);
            return p;
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
        submit: (pid, index, answer) =>
          rpc(() => {
            const s = server.state;
            const late = Date.now() > new Date(s.opened_at).getTime() + (s.duration_sec + 2) * 1000;
            if (s.status !== 'open' || s.current_index !== index || late) throw new Error('QUIZ_CLOSED');
            const k = `${index}:${pid}`;
            if (server.submissions.has(k)) throw new Error('QUIZ_DUPLICATE');
            server.submissions.set(k, answer);
            return new Date().toISOString();
          }),
        close: async () => {
          if (sub) server.subscribers.delete(sub);
        },
      };
    },
  };
}

// ─── 실행 ───────────────────────────────────────────────────

const backend = DRY ? fakeBackend() : await realBackend();
if (!DRY && (CLEANUP || flag('operate')) && !KEY) {
  console.error('--cleanup 은 --key <운영자키> 가 필요합니다.');
  process.exit(2);
}
const operate = Boolean(KEY) || DRY;
console.log(`▶ ${backend.label} · 가상 참가자 ${N}명 · 문제 index ${INDEX} · ${operate ? '스크립트가 직접 열기' : '운영자가 열 때까지 대기'}`);

const results = {
  joinFail: 0,
  subscribed: 0,
  channelFail: 0,
  propagation: [], // ms
  via: { realtime: 0, poll: 0 },
  submitLatency: [],
  submitOk: 0,
  submitFail: {},
  missedOpen: 0,
};

let openSentAt = null; // 스크립트가 연 경우 로컬 시각

const vps = [];
const t0 = Date.now();

async function runVp(i) {
  const vp = backend.participant();
  const label = `LT-${String(i + 1).padStart(3, '0')}`;
  let me;
  try {
    me = await vp.join(label, (i % 32) + 1);
  } catch {
    results.joinFail += 1;
    return;
  }

  let offset = 0;
  try {
    const a = Date.now();
    const s = await vp.serverNow();
    const b = Date.now();
    offset = s - (a + (b - a) / 2);
  } catch {
    /* 0 */
  }

  let resolveOpen;
  const opened = new Promise((r) => (resolveOpen = r));
  let seenOpen = false;
  const onState = (row, via) => {
    if (seenOpen || !row || row.status !== 'open' || row.current_index !== INDEX) return;
    seenOpen = true;
    const now = Date.now();
    // 스크립트가 열었으면 보낸 시각 기준, 아니면 서버 opened_at 기준(시차 보정)
    const origin = openSentAt ?? new Date(row.opened_at).getTime() - offset;
    results.propagation.push(now - origin);
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

  vps.push({ vp, me, subscribed, opened, poll });
}

// 접속 (약간씩 분산)
for (let i = 0; i < N; i += 1) {
  void runVp(i);
  if (RAMP_MS) await sleep(RAMP_MS);
}
// 모두 join·구독 결과가 나올 때까지
while (vps.length + results.joinFail < N) await sleep(50);
await Promise.all(vps.map((v) => v.subscribed));
console.log(
  `  접속 ${vps.length}/${N} · Realtime 구독 ${results.subscribed} · 구독 실패 ${results.channelFail} (${((Date.now() - t0) / 1000).toFixed(1)}s)`,
);

// 열기
const op = backend.operator();
if (operate) {
  await sleep(1000);
  openSentAt = Date.now();
  await op.control('open', { index: INDEX, duration_sec: DURATION });
  console.log(`  문제 열기 (index ${INDEX}, ${DURATION}초)`);
} else {
  console.log(`  /quiz/admin에서 index ${INDEX} 문제를 열어 주세요… (최대 ${WAIT_SEC}초)`);
}

// 각 참가자: 열리면 0~WINDOW ms 뒤 제출
await Promise.all(
  vps.map(async ({ vp, me, opened }) => {
    const row = await Promise.race([opened, sleep(WAIT_SEC * 1000).then(() => null)]);
    if (!row) {
      results.missedOpen += 1;
      return;
    }
    await sleep(Math.random() * WINDOW_MS);
    const a = Date.now();
    try {
      await vp.submit(me.id, INDEX, String(Math.floor(Math.random() * 10)));
      results.submitLatency.push(Date.now() - a);
      results.submitOk += 1;
    } catch (err) {
      const code = /QUIZ_\w+/.exec(String(err?.message ?? err))?.[0] ?? 'NETWORK';
      results.submitFail[code] = (results.submitFail[code] ?? 0) + 1;
    }
  }),
);

if (operate) {
  try {
    await op.control('close');
  } catch {
    /* noop */
  }
}
if (CLEANUP || DRY) {
  try {
    await op.control('reset_all', { participants: true });
    console.log('  정리: 전체 초기화(참가자 포함)');
  } catch (err) {
    console.log(`  정리 실패: ${err.message}`);
  }
}

for (const v of vps) {
  clearInterval(v.poll);
  await v.vp.close().catch(() => undefined);
}

// ─── 보고 ───────────────────────────────────────────────────

const failTotal = Object.values(results.submitFail).reduce((a, b) => a + b, 0);
console.log('\n━━ 결과 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`접속(join)        ${vps.length}/${N} 성공, 실패 ${results.joinFail}`);
console.log(`Realtime 연결     ${results.subscribed}/${vps.length} (${((results.subscribed / Math.max(1, vps.length)) * 100).toFixed(1)}%), 실패 ${results.channelFail}`);
console.log(
  `상태 전파         p50 ${fmt(pct(results.propagation, 50))} · p95 ${fmt(pct(results.propagation, 95))} · max ${fmt(Math.max(...results.propagation))}  (Realtime 먼저 ${results.via.realtime} · 폴링 먼저 ${results.via.poll} · 못 받음 ${results.missedOpen})`,
);
console.log(`제출 지연(RPC)    p50 ${fmt(pct(results.submitLatency, 50))} · p95 ${fmt(pct(results.submitLatency, 95))}`);
console.log(`제출              성공 ${results.submitOk} · 실패 ${failTotal} ${failTotal ? JSON.stringify(results.submitFail) : ''}`);
const okPropagation = pct(results.propagation, 95) <= POLL_MS + 500;
console.log(`판정              ${okPropagation && results.missedOpen === 0 ? '✅ 목표 충족 (p95 ≤ 3.5s, 모두 수신)' : '⚠ 확인 필요'}`);
process.exit(0);
