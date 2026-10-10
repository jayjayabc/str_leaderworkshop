// 토의보드 모의 데이터 검증 (Node, 의존성 없음).  실행: node data/board_mock/validate.mjs
// - 목표치는 SPEC.md 에서 직접 읽는다(라벨 표). 예시 문장은 src/lib/boardSeed.ts 에서 읽는다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const SEED_TS = path.resolve(DIR, '../../src/lib/boardSeed.ts');
const ITEMS = ['Q1-1', 'Q1-2', 'Q1-3', 'Q1-4', 'Q2-1', 'Q2-2', 'Q2-3a', 'Q2-3b'];
const N_TEAMS = 58, N_ITEMS = 8, N_TOTAL = N_TEAMS * N_ITEMS;
const TOL_LABEL = 2;            // 라벨 건수 허용 오차(±건)
const LEN_BUCKETS = [{ name: '<15', lo: 0, hi: 14, pct: 15 }, { name: '15-44', lo: 15, hi: 44, pct: 45 }, { name: '45-89', lo: 45, hi: 89, pct: 30 }, { name: '90-170', lo: 90, hi: 170, pct: 10 }];
const TOL_LEN_PCT = 3;          // 길이 버킷 허용 오차(±%p, 전체 기준)
const DUP_TARGET = 8, DUP_TOL = 3; // 항목별 중복률 목표 8% ±3%p
const J_TH = 0.8;

const read = (f) => fs.readFileSync(path.join(DIR, f), 'utf8');
const answers = JSON.parse(read('answers.json'));
const labelsJson = JSON.parse(read('labels.json'));
const personas = JSON.parse(read('personas.json'));
const len = (s) => [...s].length;
const norm = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const bigrams = (s) => { const t = norm(s), set = new Set(); for (let i = 0; i < t.length - 1; i++) set.add(t.slice(i, i + 2)); if (t.length === 1) set.add(t); return set; };
const jaccard = (a, b) => { let inter = 0; for (const x of a) if (b.has(x)) inter++; const uni = a.size + b.size - inter; return uni ? inter / uni : 1; };
const pad = (s, n) => { s = String(s); const w = [...s].reduce((a, c) => a + (/[ᄀ-ᇿ㄰-㆏가-힯]/.test(c) ? 2 : 1), 0); return s + ' '.repeat(Math.max(0, n - w)); };
const pct = (a, b) => (b ? (100 * a / b).toFixed(1) : '0.0');

let fails = 0;
const results = [];
const check = (ok, name, detail = '') => { results.push({ ok, name, detail }); if (!ok) fails++; };

// ---- SPEC 라벨 표 파싱 ----
function parseSpec() {
  const lines = fs.readFileSync(path.join(DIR, 'SPEC.md'), 'utf8').split(/\r?\n/);
  const items = {}; let cur = null;
  for (const l of lines) {
    const h = l.match(/^###\s+(Q\d-\d[ab]?)\s/); if (h) { cur = h[1]; items[cur] = []; continue; }
    if (/^##\s/.test(l)) { cur = null; continue; }
    const m = cur && l.match(/^\|\s*([a-z_]+)\s*\|\s*(\d+)%/);
    if (m) items[cur].push({ id: m[1], pct: Number(m[2]) });
  }
  return items;
}
const SPEC = parseSpec();

// ---- 예시 문장 (boardSeed.ts) ----
function parseExamples() {
  const ts = fs.readFileSync(SEED_TS, 'utf8'); const out = [];
  for (const line of ts.split('\n')) {
    const m = line.match(/examples:\s*\[(.*)\]\s*,\s*required/); if (!m) continue;
    const re = /'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"/g; let x;
    while ((x = re.exec(m[1]))) out.push(x[1] ?? x[2]);
  }
  return out;
}
const EXAMPLES = parseExamples();

console.log('===== 토의보드 모의 데이터 검증 =====\n');

// 1. 건수 ---------------------------------------------------------------
console.log('[1] 건수');
const keySet = new Set(answers.map((a) => `${a.team_id}|${a.item_id}`));
const teamIds = new Set(answers.map((a) => a.team_id));
const expectedTeams = []; for (let t = 1; t <= 29; t++) for (const h of 'AB') expectedTeams.push(`${t}${h}`);
const missing = []; for (const t of expectedTeams) for (const i of ITEMS) if (!keySet.has(`${t}|${i}`)) missing.push(`${t}/${i}`);
console.log(`  total=${answers.length} (target ${N_TOTAL}) · teams=${teamIds.size} (target ${N_TEAMS}) · unique team×item=${keySet.size} · missing=${missing.length}`);
check(answers.length === N_TOTAL, 'total 464');
check(teamIds.size === N_TEAMS && keySet.size === N_TOTAL && missing.length === 0, '58 teams × 8 items, no missing/dup', missing.slice(0, 5).join(','));
check(answers.every((a) => a.body && a.body.trim() === a.body && a.body.length > 0), '본문 공백/빈값 없음');
check(personas.length === N_TEAMS, 'personas 58건');

// 2. 라벨 --------------------------------------------------------------
console.log('\n[2] 항목별 라벨 건수 vs 목표 (허용 ±' + TOL_LABEL + '건)');
for (const id of ITEMS) {
  const rows = answers.filter((a) => a.item_id === id);
  const cnt = {}; rows.forEach((a) => (cnt[a.label] = (cnt[a.label] || 0) + 1));
  const spec = SPEC[id];
  const unknown = Object.keys(cnt).filter((k) => !spec.some((s) => s.id === k));
  check(unknown.length === 0, `${id} 라벨이 정의 안에 있음`, unknown.join(','));
  check(rows.length === N_TEAMS, `${id} 58건`, String(rows.length));
  console.log(`  ${id} (n=${rows.length})`);
  for (const s of spec) {
    const target = s.pct * rows.length / 100, got = cnt[s.id] || 0, d = got - target;
    const ok = Math.abs(d) <= TOL_LABEL + 1e-9;
    check(ok, `${id} ${s.id} 건수`, `target ${target.toFixed(1)} got ${got}`);
    console.log(`    ${pad(s.id, 22)} target ${pad(s.pct + '%', 4)} (${pad(target.toFixed(1), 4)}) | actual ${pad(got, 2)} (${pad(pct(got, rows.length) + '%', 6)}) | diff ${d >= 0 ? '+' : ''}${d.toFixed(1)} ${ok ? 'OK' : 'FAIL'}`);
  }
  // labels.json 과 일치하는지
  const lj = labelsJson.items[id]?.labels ?? [];
  check(spec.every((s) => (lj.find((l) => l.id === s.id)?.actual_count ?? -1) === (cnt[s.id] || 0)), `${id} labels.json 건수 일치`);
}

// 3. 길이 --------------------------------------------------------------
console.log('\n[3] 길이 분포 (글자 수, 공백 포함)');
const bucketOf = (l) => LEN_BUCKETS.findIndex((b) => l >= b.lo && l <= b.hi);
const lens = answers.map((a) => len(a.body));
const overall = [0, 0, 0, 0]; lens.forEach((l) => { const b = bucketOf(l); if (b >= 0) overall[b]++; });
console.log('  ' + pad('', 8) + LEN_BUCKETS.map((b) => pad(b.name, 14)).join(''));
console.log('  ' + pad('target', 8) + LEN_BUCKETS.map((b) => pad(b.pct + '%', 14)).join(''));
console.log('  ' + pad('overall', 8) + overall.map((n, i) => pad(`${n} (${pct(n, answers.length)}%)`, 14)).join(''));
LEN_BUCKETS.forEach((b, i) => { const p = 100 * overall[i] / answers.length; check(Math.abs(p - b.pct) <= TOL_LEN_PCT, `길이 ${b.name}`, `${p.toFixed(1)}% vs ${b.pct}%`); });
for (const id of ITEMS) {
  const bk = [0, 0, 0, 0]; answers.filter((a) => a.item_id === id).forEach((a) => { const b = bucketOf(len(a.body)); if (b >= 0) bk[b]++; });
  console.log('  ' + pad(id, 8) + bk.map((n) => pad(`${n} (${pct(n, N_TEAMS)}%)`, 14)).join(''));
}
const maxLen = Math.max(...lens), minLen = Math.min(...lens);
console.log(`  min=${minLen} max=${maxLen} mean=${(lens.reduce((a, b) => a + b, 0) / lens.length).toFixed(1)}`);
const over170 = answers.filter((a) => len(a.body) > 170);
check(over170.length === 0, '170자 초과 없음', String(over170.length));
check(lens.every((l) => bucketOf(l) >= 0), '모든 답이 버킷에 속함');

// 4. 중복 --------------------------------------------------------------
console.log(`\n[4] 같은 항목 안 중복률 (동일 문장 또는 문자 바이그램 자카드 ≥ ${J_TH}; 목표 ${DUP_TARGET}% ±${DUP_TOL}%p)`);
let dupTotal = 0; const dupSamples = [];
for (const id of ITEMS) {
  const rows = answers.filter((a) => a.item_id === id);
  const grams = rows.map((r) => bigrams(r.body));
  let dup = 0, exact = 0;
  rows.forEach((r, i) => {
    let found = false, isExact = false;
    for (let j = 0; j < i; j++) {
      if (norm(rows[j].body) === norm(r.body)) { found = true; isExact = true; break; }
      if (jaccard(grams[i], grams[j]) >= J_TH) found = true;
    }
    if (found) { dup++; if (isExact) exact++; dupSamples.push(`${id} ${r.team_id}: ${r.body}`); }
  });
  dupTotal += dup;
  const p = 100 * dup / rows.length;
  check(Math.abs(p - DUP_TARGET) <= DUP_TOL, `${id} 중복률`, `${p.toFixed(1)}%`);
  console.log(`  ${pad(id, 6)} dup=${pad(dup, 2)} (${pad(p.toFixed(1) + '%', 6)}) exact=${exact}  ${Math.abs(p - DUP_TARGET) <= DUP_TOL ? 'OK' : 'FAIL'}`);
}
console.log(`  overall dup=${dupTotal} (${pct(dupTotal, answers.length)}%)`);
check(Math.abs(100 * dupTotal / answers.length - DUP_TARGET) <= DUP_TOL, '전체 중복률', pct(dupTotal, answers.length) + '%');

// 5. off-topic / 두 의견 ------------------------------------------------
console.log('\n[5] off-topic · 두 의견 병기');
const off = labelsJson.offtopic || [], mixed = labelsJson.mixed || [];
const byItem = (arr) => ITEMS.map((i) => `${i}:${arr.filter((x) => x.item_id === i).length}`).join(' ');
console.log(`  off-topic total=${off.length} (${pct(off.length, answers.length)}%; target ~5%) | ${byItem(off)}`);
const q14off = answers.filter((a) => a.item_id === 'Q1-4' && a.label === 'offtopic_service').length;
console.log(`  Q1-4 label offtopic_service=${q14off} (spec 3~4건)`);
console.log(`  mixed(두 의견) total=${mixed.length} (${pct(mixed.length, answers.length)}%; target 2~3%) | ${byItem(mixed)}`);
check(off.length / answers.length >= 0.04 && off.length / answers.length <= 0.06, 'off-topic 4~6%', pct(off.length, answers.length) + '%');
check(q14off >= 3 && q14off <= 4, 'Q1-4 offtopic_service 3~4건', String(q14off));
check(off.filter((x) => x.item_id.startsWith('Q1')).length >= off.length * 0.4, 'off-topic 은 Q1에 집중(≥40%)');
check(mixed.length / answers.length >= 0.02 && mixed.length / answers.length <= 0.03, '두 의견 2~3%', pct(mixed.length, answers.length) + '%');
check(off.every((x) => answers.some((a) => a.team_id === x.team_id && a.item_id === x.item_id)) && mixed.every((x) => answers.some((a) => a.team_id === x.team_id && a.item_id === x.item_id)), 'off/mixed 참조 유효');

// 6. 금지 사항 ----------------------------------------------------------
console.log('\n[6] 금지·예시 검사');
const kk = answers.filter((a) => a.body.includes('ㅋ'));
console.log(`  answers containing "ㅋ": ${kk.length}`);
check(kk.length === 0, '"ㅋ" 없음');
console.log(`  example sentences parsed from boardSeed.ts: ${EXAMPLES.length} (expected 16)`);
check(EXAMPLES.length === 16, '예시 16문장 파싱', String(EXAMPLES.length));
const exNorm = new Set(EXAMPLES.map(norm));
const same = answers.filter((a) => exNorm.has(norm(a.body)));
console.log(`  answers identical to an example: ${same.length}`);
check(same.length === 0, '예시 문장과 동일한 답 없음');
const exGrams = EXAMPLES.map(bigrams);
const near = answers.map((a) => ({ a, j: Math.max(...exGrams.map((g) => jaccard(bigrams(a.body), g))) })).filter((x) => x.j >= 0.5);
console.log(`  answers with bigram-Jaccard ≥ 0.5 to an example (paraphrase-level, info only): ${near.length}`);
near.forEach((x) => console.log(`    ${x.a.item_id} ${x.a.team_id} J=${x.j.toFixed(2)} ${x.a.body}`));
const mojibake = answers.filter((a) => /[�]/.test(a.body) || /\s{2,}/.test(a.body));
check(mojibake.length === 0, '깨진 문자/연속 공백 없음');

// 7. 시각 --------------------------------------------------------------
console.log('\n[7] 제출 시각 (KST +09:00)');
const WIN = { 'Q1-1': ['16:01', '16:04'], 'Q1-2': ['16:04', '16:07'], 'Q1-3': ['16:07', '16:10'], 'Q1-4': ['16:10', '16:12'], 'Q2-1': ['16:32', '16:38'], 'Q2-2': ['16:38', '16:44'], 'Q2-3a': ['16:44', '16:50'], 'Q2-3b': ['16:44', '16:50'] };
const ISO_RE = /^2026-10-14T(\d\d):(\d\d):(\d\d)\+09:00$/;
const sec = (iso) => { const m = iso.match(ISO_RE); return m ? (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) : NaN; };
const hm = (s) => { const [h, m] = s.split(':').map(Number); return h * 3600 + m * 60; };
const badFmt = answers.filter((a) => !ISO_RE.test(a.submitted_at));
const outWin = answers.filter((a) => { const s = sec(a.submitted_at); const [lo, hi] = WIN[a.item_id]; return !(s >= hm(lo) && s < hm(hi)); });
check(badFmt.length === 0, 'ISO 8601 +09:00 형식', String(badFmt.length));
check(outWin.length === 0, '항목별 제출 창 안', String(outWin.length));
let sameOk = true; for (const t of expectedTeams) { const a = answers.find((x) => x.team_id === t && x.item_id === 'Q2-3a'), b = answers.find((x) => x.team_id === t && x.item_id === 'Q2-3b'); if (a?.submitted_at !== b?.submitted_at) sameOk = false; }
check(sameOk, 'Q2-3a/3b 같은 시각');
const rushInfo = [];
for (const id of ['Q1-1', 'Q1-2', 'Q1-3', 'Q1-4', 'Q2-1', 'Q2-2', 'Q2-3a']) {
  const hi = hm(WIN[id][1]); const rush = answers.filter((a) => a.item_id === id && sec(a.submitted_at) >= hi - 20).length;
  rushInfo.push(`${id}:${rush}`); check(rush >= 1 && rush <= 3, `${id} 마감 직전 제출 1~3개 반조`, String(rush));
}
console.log(`  마감 직전(마지막 20초) 제출 반조 수: ${rushInfo.join(' ')}`);
console.log(`  형식 오류 ${badFmt.length} · 제출 창 이탈 ${outWin.length}`);

// 8. 페르소나 ----------------------------------------------------------
console.log('\n[8] 페르소나 분포');
const dist = (key) => { const c = {}; personas.forEach((p) => (c[p[key]] = (c[p[key]] || 0) + 1)); return Object.entries(c).map(([k, v]) => `${k}=${v}(${pct(v, personas.length)}%)`).join(' '); };
console.log('  ai_maturity: ' + dist('ai_maturity') + '   (target low25/mid45/high30)');
console.log('  stance:      ' + dist('stance') + '   (target opt40/cau40/skp20)');
console.log('  tone:        ' + dist('tone') + '   (target casual45/neutral40/formal15)');
const execs = personas.filter((p) => p.is_exec).map((p) => p.team_id).sort().join(',');
console.log(`  is_exec: ${execs}`);
check(execs === '13A,13B,14A,14B,18A,18B,8A,8B', '임원 테이블 8·13·14·18');
check(personas.filter((p) => p.is_exec).every((p) => p.tone !== 'casual'), '임원 반조 tone neutral/formal');
check(personas.every((p) => p.divisions.length >= 2 && p.divisions.length <= 3), 'divisions 2~3개');
const near3 = (k, v, t) => Math.abs(100 * personas.filter((p) => p[k] === v).length / personas.length - t) <= 3;
check(near3('ai_maturity', 'low', 25) && near3('ai_maturity', 'mid', 45) && near3('ai_maturity', 'high', 30), 'ai_maturity 비율 ±3%p');
check(near3('stance', 'optimistic', 40) && near3('stance', 'cautious', 40) && near3('stance', 'skeptical', 20), 'stance 비율 ±3%p');
check(near3('tone', 'casual', 45) && near3('tone', 'neutral', 40) && near3('tone', 'formal', 15), 'tone 비율 ±3%p');

// 9. CSV ---------------------------------------------------------------
console.log('\n[9] CSV');
function parseCsv(text) { // RFC 4180
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\r' && text[i + 1] === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; i++; }
    else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
for (const f of ['board_wide_mock.csv', 'board_long_mock.csv']) {
  const raw = fs.readFileSync(path.join(DIR, f));
  const bom = raw[0] === 0xEF && raw[1] === 0xBB && raw[2] === 0xBF;
  const txt = raw.toString('utf8').slice(1);
  const bareLF = /(^|[^\r])\n/.test(txt.replace(/"[^"]*"/g, ''));
  const rows = parseCsv(txt);
  console.log(`  ${f}: BOM=${bom} CRLF-only=${!bareLF} rows(excl. header)=${rows.length - 1} cols=${rows[0].length}`);
  check(bom, `${f} BOM`); check(!bareLF, `${f} CRLF`); check(txt.endsWith('\r\n'), `${f} 끝 CRLF`);
  if (f.includes('wide')) {
    check(rows.length - 1 === 58 && rows.every((r) => r.length === 12), 'wide 58행×12열');
    check(rows[0].join(',') === ['반조', '테이블', '임원테이블', ...ITEMS, '마지막제출시각'].join(','), 'wide 헤더');
    let ok = true; for (const r of rows.slice(1)) ITEMS.forEach((id, k) => { if (r[3 + k] !== answers.find((a) => a.team_id === r[0] && a.item_id === id).body) ok = false; });
    check(ok, 'wide 본문이 answers.json 과 일치(왕복)');
  } else {
    check(rows.length - 1 === N_TOTAL && rows.every((r) => r.length === 8), 'long 464행×8열');
    check(rows[0].join(',') === '반조,항목,본문,제출시각,hidden,숨김사유,수정횟수,label', 'long 헤더');
    let ok = true; for (const r of rows.slice(1)) { const a = answers.find((x) => x.team_id === r[0] && x.item_id === r[1]); if (!a || a.body !== r[2] || a.label !== r[7] || r[4] !== 'false' || r[5] !== '' || r[6] !== '0') ok = false; }
    check(ok, 'long 본문·label·hidden·수정횟수 일치(왕복)');
  }
}

// 요약 -----------------------------------------------------------------
console.log('\n===== 요약 =====');
const failed = results.filter((r) => !r.ok);
console.log(`checks: ${results.length - failed.length}/${results.length} passed`);
if (failed.length) { console.log('FAILED:'); failed.forEach((r) => console.log(`  - ${r.name} ${r.detail}`)); }
if (process.argv.includes('--dups')) { console.log('\n[중복 판정된 답]'); dupSamples.forEach((s) => console.log('  ' + s)); }
process.exitCode = failed.length ? 1 : 0;
