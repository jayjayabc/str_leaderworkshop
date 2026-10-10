// 모의 데이터 빌드: answers_src.mjs(손글 원문) + SPEC.md → personas/answers/labels/CSV 2종
// 실행: node data/board_mock/_gen/build.mjs   (그 뒤 node data/board_mock/validate.mjs)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SRC } from './answers_src.mjs';
import { parseSpec } from './spec.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(HERE, '..');
const SPEC = parseSpec(path.join(OUT, 'SPEC.md'));
const ITEMS = ['Q1-1', 'Q1-2', 'Q1-3', 'Q1-4', 'Q2-1', 'Q2-2', 'Q2-3a', 'Q2-3b'];
const SEED = 20261014;

// ---------- RNG ----------
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const rnd = mulberry32(SEED);
const shuffle = (arr) => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const pick = (arr, n) => shuffle(arr).slice(0, n);

// ---------- 페르소나 ----------
const EXEC_TABLES = [8, 13, 14, 18];
const DIV_POOL = ['여신', '수신/예적금', '플랫폼/제휴', '데이터/AI', '리스크', 'IT개발', '인프라/보안', '고객센터(CS)', '마케팅/브랜드', '전략/재무', '준법/감사', '인사/조직', '투자/신사업', '해외(동남아)', 'UX/디자인', '결제/카드'];
const DIV_KEY = { 여신: '여신', 수신: '수신/예적금', 플랫폼: '플랫폼/제휴', 데이터: '데이터/AI', 리스크: '리스크', IT: 'IT개발', 인프라: '인프라/보안', CS: '고객센터(CS)', 마케팅: '마케팅/브랜드', 전략: '전략/재무', 준법: '준법/감사', 인사: '인사/조직', 투자: '투자/신사업', 해외: '해외(동남아)', UX: 'UX/디자인', 결제: '결제/카드' };

const teams = [];
for (let t = 1; t <= 29; t++) for (const h of ['A', 'B']) teams.push({ team_id: `${t}${h}`, table_no: t, half: h, is_exec: EXEC_TABLES.includes(t) });
const N = teams.length; // 58
const execIdx = teams.map((t, i) => (t.is_exec ? i : -1)).filter((i) => i >= 0);
const nonExecIdx = teams.map((t, i) => (t.is_exec ? -1 : i)).filter((i) => i >= 0);

// ai_maturity: low 15 / mid 26 / high 17, stance: optimistic 23 / cautious 23 / skeptical 12
const mat = shuffle([...Array(15).fill('low'), ...Array(26).fill('mid'), ...Array(17).fill('high')]);
const stn = shuffle([...Array(23).fill('optimistic'), ...Array(23).fill('cautious'), ...Array(12).fill('skeptical')]);
// tone: 임원(8)=neutral 4/formal 4, 비임원(50)=casual 26/neutral 19/formal 5  → 전체 casual 26·neutral 23·formal 9
const toneExec = shuffle([...Array(4).fill('neutral'), ...Array(4).fill('formal')]);
const toneNon = shuffle([...Array(26).fill('casual'), ...Array(19).fill('neutral'), ...Array(5).fill('formal')]);
const threeMember = new Set(pick([...Array(N).keys()], 9));
teams.forEach((t, i) => {
  t.divisions = pick(DIV_POOL, rnd() < 0.55 ? 2 : 3);
  t.ai_maturity = mat[i];
  t.stance = stn[i];
  t.tone = t.is_exec ? toneExec[execIdx.indexOf(i)] : toneNon[nonExecIdx.indexOf(i)];
  t.members = threeMember.has(i) ? 3 : 4;
});

// ---------- 원문 파싱 ----------
function parseItem(id) {
  return SRC[id].trim().split('\n').map((line) => {
    const p = line.split('|');
    if (p.length !== 3) throw new Error(`형식 오류 ${id}: ${line}`);
    const tags = p[1].split(',').map((s) => s.trim()).filter(Boolean);
    return { label: p[0].trim(), tags, body: p[2].trim() };
  });
}

// ---------- 짝짓기 (헝가리안) ----------
function score(team, a) {
  const T = new Set(a.tags);
  let s = 0;
  const tone = ['c', 'n', 'f'].find((c) => T.has(c));
  const teamTone = { casual: 'c', neutral: 'n', formal: 'f' }[team.tone];
  if (team.is_exec) {
    if (T.has('x')) s += 3;
    if (tone === 'n' || tone === 'f') s += 1;
    if (tone === 'c' && !T.has('x')) s -= 2;
  } else {
    if (T.has('x')) s -= team.tone === 'formal' ? 1 : 2;
    if (tone) s += tone === teamTone ? 2 : (tone === 'f' || teamTone === 'f' ? -2 : -1);
  }
  const st = ['o', 'k', 's'].find((c) => T.has(c));
  const teamSt = { optimistic: 'o', cautious: 'k', skeptical: 's' }[team.stance];
  if (st) s += st === teamSt ? 2 : ((st === 's' && teamSt === 'o') || (st === 'o' && teamSt === 's') ? -3 : -2);
  const mt = ['l', 'h'].find((c) => T.has(c));
  const teamMt = { low: 'l', high: 'h', mid: null }[team.ai_maturity];
  if (mt) s += mt === teamMt ? 2 : (teamMt === null ? -0.5 : -2);
  for (const tg of a.tags) if (tg.startsWith('D:')) {
    const full = DIV_KEY[tg.slice(2)];
    s += team.divisions.includes(full) ? 4 : -6;
  }
  return s;
}
function hungarian(cost) { // 최소 비용 배정, n x n
  const n = cost.length, INF = 1e15;
  const u = Array(n + 1).fill(0), v = Array(n + 1).fill(0), p = Array(n + 1).fill(0), way = Array(n + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    p[0] = i; let j0 = 0; const minv = Array(n + 1).fill(INF), used = Array(n + 1).fill(false);
    do {
      used[j0] = true; const i0 = p[j0]; let delta = INF, j1 = 0;
      for (let j = 1; j <= n; j++) if (!used[j]) {
        const cur = cost[i0 - 1][j - 1] - u[i0] - v[j];
        if (cur < minv[j]) { minv[j] = cur; way[j] = j0; }
        if (minv[j] < delta) { delta = minv[j]; j1 = j; }
      }
      for (let j = 0; j <= n; j++) if (used[j]) { u[p[j]] += delta; v[j] -= delta; } else minv[j] -= delta;
      j0 = j1;
    } while (p[j0] !== 0);
    do { const j1 = way[j0]; p[j0] = p[j1]; j0 = j1; } while (j0);
  }
  const ans = Array(n).fill(-1);
  for (let j = 1; j <= n; j++) ans[p[j] - 1] = j - 1;
  return ans; // ans[team] = answer idx
}

// ---------- 제출 시각 ----------
const WIN = { 'Q1-1': ['16:01', '16:04'], 'Q1-2': ['16:04', '16:07'], 'Q1-3': ['16:07', '16:10'], 'Q1-4': ['16:10', '16:12'], 'Q2-1': ['16:32', '16:38'], 'Q2-2': ['16:38', '16:44'], 'Q2-3': ['16:44', '16:50'] };
const toSec = (hm) => { const [h, m] = hm.split(':').map(Number); return h * 3600 + m * 60; };
const iso = (sec) => { const h = String(Math.floor(sec / 3600)).padStart(2, '0'), m = String(Math.floor((sec % 3600) / 60)).padStart(2, '0'), s = String(sec % 60).padStart(2, '0'); return `2026-10-14T${h}:${m}:${s}+09:00`; };
const times = {}; // group -> team idx -> sec
for (const [g, [a, b]] of Object.entries(WIN)) {
  const s0 = toSec(a), s1 = toSec(b);
  const rush = new Set(pick([...Array(N).keys()], 1 + Math.floor(rnd() * 3)));
  times[g] = teams.map((_, i) => rush.has(i) ? s1 - 1 - Math.floor(rnd() * 18) : s0 + Math.floor(rnd() * (s1 - s0 - 30)));
}
const groupOf = (id) => (id === 'Q2-3a' || id === 'Q2-3b' ? 'Q2-3' : id);

// ---------- 조립 ----------
const answers = []; // [team][item]
const offtopic = [], mixed = [];
const perItem = {};
for (const id of ITEMS) {
  const pool = parseItem(id);
  if (pool.length !== N) throw new Error(`${id}: ${pool.length}건 (58건이어야 함)`);
  const cost = teams.map((t) => pool.map((a) => -(score(t, a) + (rnd() - 0.5) * 0.8)));
  const asg = hungarian(cost);
  perItem[id] = teams.map((t, i) => ({ team: t, ans: pool[asg[i]] }));
}
for (let i = 0; i < N; i++) for (const id of ITEMS) {
  const { ans } = perItem[id][i];
  const rec = { team_id: teams[i].team_id, item_id: id, body: ans.body, label: ans.label, submitted_at: iso(times[groupOf(id)][i]) };
  answers.push(rec);
  if (ans.tags.includes('O')) offtopic.push({ team_id: rec.team_id, item_id: id, label: ans.label });
  if (ans.tags.includes('M')) mixed.push({ team_id: rec.team_id, item_id: id, label: ans.label });
}

// ---------- 출력 ----------
const w = (name, text) => fs.writeFileSync(path.join(OUT, name), text);
w('personas.json', JSON.stringify(teams.map((t) => ({ team_id: t.team_id, table_no: t.table_no, half: t.half, is_exec: t.is_exec, members: t.members, divisions: t.divisions, ai_maturity: t.ai_maturity, stance: t.stance, tone: t.tone })), null, 2) + '\n');
w('answers.json', JSON.stringify(answers, null, 2) + '\n');

const labels = { _note: '항목별 주제 라벨 정의(SPEC §2)와 실제 건수. offtopic/mixed 는 answers.json 의 어느 답이 off-topic·두 의견 병기인지 표시한다(정답 라벨과 별개).', items: {}, offtopic, mixed };
for (const id of ITEMS) {
  const cnt = {}; answers.filter((a) => a.item_id === id).forEach((a) => (cnt[a.label] = (cnt[a.label] || 0) + 1));
  const spec = SPEC[id];
  for (const l of spec.labels) if (!(l.id in cnt)) cnt[l.id] = 0;
  for (const k of Object.keys(cnt)) if (!spec.labels.find((l) => l.id === k)) throw new Error(`${id}: 정의에 없는 라벨 ${k}`);
  labels.items[id] = { title: spec.title, labels: spec.labels.map((l) => ({ id: l.id, desc: l.desc, target_pct: l.pct, target_count: Math.round((l.pct / 100) * N * 10) / 10, actual_count: cnt[l.id] })) };
}
w('labels.json', JSON.stringify(labels, null, 2) + '\n');

// CSV (BOM + CRLF + RFC 4180, 앱 boardExport.ts 와 같은 규칙)
const cell = (v) => { let s = v == null ? '' : String(v); if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`; return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const row = (c) => c.map(cell).join(',');
const kst = (isoStr) => isoStr.slice(0, 19).replace('T', ' '); // 이미 +09:00 이므로 그대로 자른다
const wide = [row(['반조', '테이블', '임원테이블', ...ITEMS, '마지막제출시각'])];
for (const t of teams) {
  const mine = answers.filter((a) => a.team_id === t.team_id);
  const last = mine.map((a) => a.submitted_at).sort().at(-1);
  wide.push(row([t.team_id, t.table_no, t.is_exec ? 'Y' : '', ...ITEMS.map((id) => mine.find((a) => a.item_id === id).body), kst(last)]));
}
w('board_wide_mock.csv', '﻿' + wide.join('\r\n') + '\r\n');
const long = [row(['반조', '항목', '본문', '제출시각', 'hidden', '숨김사유', '수정횟수', 'label'])];
for (const a of answers) long.push(row([a.team_id, a.item_id, a.body, kst(a.submitted_at), 'false', '', 0, a.label]));
w('board_long_mock.csv', '﻿' + long.join('\r\n') + '\r\n');
console.log(`written: ${answers.length} answers, offtopic ${offtopic.length}, mixed ${mixed.length}`);
