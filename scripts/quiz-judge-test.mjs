#!/usr/bin/env node
// 스피드 퀴즈 자동 판정 단위 테스트 (Quiz v1.0)
//   node scripts/quiz-judge-test.mjs      (또는 npm run test:quiz)
//
// quizQuestions.ts · quizJudge.ts · quizSeed.ts를 프로젝트의 TypeScript로 트랜스파일해 임시 폴더에서 import한다.
// 자동 판정 문항은 정답 변형 3개 이상 · 오답 2개 이상, 수동 문항은 'review'인지 확인한다.

import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(tmpdir(), `quiz-judge-${process.pid}`);
mkdirSync(out, { recursive: true });

for (const name of ['quizQuestions', 'quizJudge', 'quizSeed']) {
  const src = readFileSync(join(root, 'src/lib', `${name}.ts`), 'utf8');
  let js = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  js = js.replace(/from '\.\/(quiz\w+)'/g, "from './$1.mjs'");
  writeFileSync(join(out, `${name}.mjs`), js);
}

const { judge, parseKoreanNumber, normalizeText, correctRank } = await import(pathToFileURL(join(out, 'quizJudge.mjs')).href);
const { QUIZ_SEED } = await import(pathToFileURL(join(out, 'quizSeed.mjs')).href);
rmSync(out, { recursive: true, force: true });

/** no → { correct: [...], wrong: [...] } */
const CASES = {
  0: { correct: ['뱅크런', '뱅크 런', 'Bank run'], wrong: ['펀드런', '은행런'] },
  1: { correct: ['3.00', '3', '3.0%', '3.00%'], wrong: ['2.75', '3.25', '0.3'] },
  2: { correct: ['머니무브', '머니 무브', 'Money move'], wrong: ['뱅크런', '디레버리징'] },
  3: { correct: ['24', '24년', '24 년'], wrong: ['25', '23년', '2001'] },
  4: { correct: ['0', '0개', '2,763만', '2763만 개', '27,630,000', '없음', '하나도 없어요'], wrong: ['1', '100', '1개'] },
  5: { correct: ['1', '1번', '카카오뱅크 K패스 체크카드', 'K패스'], wrong: ['2', '3', '기후동행카드'] },
  6: { correct: ['600', '600만', '600만 명', '6,000,000', '6백만', '육백만'], wrong: ['580', '620', '60'] },
  7: { correct: ['2', '2번', '13', '13%'], wrong: ['1', '3', '16%', '4'] },
  8: { correct: ['마스턴캐피탈', '마스턴 캐피탈', '마스턴캐피털', 'Mastern Capital'], wrong: ['롯데캐피탈', '현대캐피탈', '캐피탈'] },
  9: { correct: ['A>B>C', 'A > B > C', 'ABC', 'A, B, C', 'a-b-c', 'A>B>C입니다', 'A〉B〉C', 'A>B>C순서'], wrong: ['B>A>C', 'C>B>A', 'A>C>B', 'AB', 'A>B>C>A'] },
  10: {
    correct: ['AIR | 로빈후드 | 시그널', 'air | Robinhood | signal', 'AIR | 로빈후드 | 시그날', 'AIR | 로빈 후드 | 시그널', 'Air | robinhood | 시그널'],
    wrong: ['AIR | 로빈후드 | ', ' | 로빈후드 | 시그널', 'Revolut | 로빈후드 | 시그널'],
  },
  11: { correct: ['123', '123점', ' 123 '], wrong: ['120', '124', '3'] },
  12: { correct: ['14.2', '14.2%', '14.1', '14.3', '683억, 14.2%'], wrong: ['14.4', '1.42', '14', '683억, 14.4%'] },
  13: { correct: ['18.5', '18.5%', '18.0', '19'], wrong: ['17.9', '19.1', '14.4'] },
  14: { correct: ['3', '3번', '일본'], wrong: ['1', '2', '4', '몽골'] },
};

let pass = 0;
let fail = 0;
const rows = [];

function check(no, answer, expected) {
  const q = QUIZ_SEED.find((x) => x.no === no);
  const got = judge(q.judge, answer);
  const ok = got === expected;
  if (ok) pass += 1;
  else {
    fail += 1;
    console.log(`  ✗ Q${no} "${answer}" → ${got} (기대 ${expected})`);
  }
}

for (const q of QUIZ_SEED) {
  const c = CASES[q.no];
  if (q.judge.type === 'manual') {
    check(q.no, '아무 답', 'review');
    check(q.no, '인도네시아 슈퍼뱅크', 'review');
    rows.push([q.no, 'manual', '—', 1, 1]);
    continue;
  }
  if (!c) {
    console.log(`  ✗ Q${q.no}: 테스트 케이스 없음`);
    fail += 1;
    continue;
  }
  if (c.correct.length < 3 || c.wrong.length < 2) {
    console.log(`  ✗ Q${q.no}: 정답 변형 ≥3, 오답 ≥2 필요`);
    fail += 1;
  }
  c.correct.forEach((a) => check(q.no, a, 'correct'));
  c.wrong.forEach((a) => check(q.no, a, 'wrong'));
  // 아이폰·맥 입력처럼 한글이 자모 분해형(NFD)으로 와도 같은 판정이어야 한다
  c.correct.forEach((a) => check(q.no, a.normalize('NFD'), 'correct'));
  c.wrong.forEach((a) => check(q.no, a.normalize('NFD'), 'wrong'));
  // 빈 답은 항상 오답
  check(q.no, '   ', 'wrong');
  const j = q.judge;
  const range = j.type === 'numeric' ? `${j.min}~${j.max}${j.unit ?? ''}` : j.type === 'text' ? `${j.accept.length} variants` : `${j.all.length} parts`;
  rows.push([q.no, j.type, range, c.correct.length, c.wrong.length]);
}

// N번째 정답 계산
{
  const t = ['2026-10-14T01:00:00.100+00:00', '2026-10-14T01:00:01.200+00:00', '2026-10-14T01:00:02.300+00:00'];
  const cases = [
    [correctRank(t, t[0]), 1],
    [correctRank(t, t[2]), 3],
    [correctRank(t, '2026-10-14T01:00:01.2Z'), 2],
    [correctRank(t, null), null],
    [correctRank([], t[0]), null],
    [correctRank(undefined, t[0]), null],
  ];
  cases.forEach(([got, want], i) => {
    if (got === want) pass += 1;
    else {
      fail += 1;
      console.log(`  ✗ correctRank #${i}: ${got} ≠ ${want}`);
    }
  });
}

// 파서 자체
const pk = (s) => parseKoreanNumber(s)?.value;
const eq = (a, b, label) => {
  if (Math.abs(a - b) < 1e-6) pass += 1;
  else {
    fail += 1;
    console.log(`  ✗ parse ${label}: ${a} ≠ ${b}`);
  }
};
eq(pk('2,793만'), 27_930_000, '2,793만');
eq(pk('1조 2,000억'), 1.2e12, '1조 2,000억');
eq(pk('158억 원'), 1.58e10, '158억 원');
eq(pk('약 8,670명/일 (3079일)'), 8670, '첫 숫자만');
eq(pk('14.2%'), 14.2, '14.2%');
if (normalizeText(' 2,028 년 ') === '2028') pass += 1;
else {
  fail += 1;
  console.log('  ✗ normalizeText');
}

console.log('\n no | type     | range/accept      | ✓ | ✗');
rows.forEach(([no, t, r, c, w]) =>
  console.log(` ${String(no).padStart(2)} | ${t.padEnd(8)} | ${String(r).padEnd(17)} | ${c} | ${w}`),
);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
