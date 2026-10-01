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
  0: { correct: ['2', '2개', '두 개', ' 2 '], wrong: ['8', '28', '3개'] },
  1: { correct: ['뱅크런', '뱅크 런', 'Bank Run', 'bankrun!', '뱅크런이요'], wrong: ['런닝맨', '은행런', '뱅크'] },
  2: {
    correct: ['2,793만 개', '2793만', '27,930,000', '2793', '고객 수만큼', '2,670만', '약 2800만개'],
    wrong: ['0개', '0', '1개', '100'],
  },
  3: {
    correct: [
      '2025년 9월 1일, 24년 만',
      '2025.9.1 / 24년',
      '2025-09-01 24',
      '20250901, 24년만',
      '① 25.9.1 ② 24년',
    ],
    wrong: ['2025년 9월 1일, 25년 만', '2024년 9월 1일 24년', '2025년 9월 10일 24년', '24년 만'],
  },
  4: { correct: ['4', '4곳', '네 곳', '4개'], wrong: ['3', '5곳', '14'] },
  5: {
    correct: ['1', '1번', '1.', '카카오뱅크 K패스 체크카드', 'k패스', '①'],
    wrong: ['2', '3번', '기후동행카드', '애플페이 티머니'],
  },
  6: { correct: ['마스턴캐피탈', '마스턴 캐피탈', '마스턴캐피털', 'Mastern Capital', '마스턴캐피탈'.normalize('NFD'), ' 마스턴캐피탈 '.normalize('NFD'), '마스턴캐피탈㈜'], wrong: ['롯데캐피탈', '현대캐피탈', '캐피탈'] },
  7: {
    correct: ['SFNB', 'sfnb', 'Security First Network Bank', 'security first network bank (SFNB)', '시큐리티 퍼스트 네트워크 뱅크'],
    wrong: ['ING Direct', 'Net.B@nk', '퍼스트뱅크'],
  },
  8: { correct: ['3%', '3.00%', '3', '3.0'], wrong: ['2.75%', '3.25', '2.5%'] },
  9: { correct: ['8670', '8,670명', '약 8,670명/일', '8672', '8660'], wrong: ['8600', '8700', '867'] },
  10: { correct: ['머니무브', '머니 무브', 'Money Move', '머니무브 현상'], wrong: ['머니런', '머니게임', '자산이동'] },
  11: { correct: ['다크패턴', '다크 패턴', 'Dark Pattern', 'darkpatterns'], wrong: ['불완전판매', '다크웹', '패턴'] },
  12: { correct: ['2028', '2028년', '28년', ' 2028 '], wrong: ['2027', '2029년', '2030'] },
  13: { correct: ['20.2', '20.2%', '약 20%', '20', '20.5'], wrong: ['21.2', '14.8%', '19.5', '24.1'] },
  14: { correct: ['13', '13%', '13.0%', '13.2'], wrong: ['12', '14%', '31'] },
  15: { correct: ['14.2', '14.2%', '14.1%', '14.3'], wrong: ['14.4', '1.42', '14'] },
  16: { correct: ['18.5', '18.5%', '18.0', '19'], wrong: ['14.4', '17.9%', '20'] },
  17: { correct: ['5 6 16', '5, 6, 16', '제5조 제6조 제16조', '5·6·16', '5.6.16'], wrong: ['6 5 16', '5 6 15', '4 6 16', '15 6 16'] },
  18: { correct: ['158', '158억', '158억 원', '15,800,000,000', '160', '150'], wrong: ['3677', '140', '1,126', '170억'] },
  21: {
    correct: ['내렸다 2.1', '내렸다, 2.1%p', '2.1%p 하락', '-2.1%p', '내려감 2.10'],
    wrong: ['올랐다 2.1', '내렸다 2.3', '2.1', '상승 2.1%p', '내렸다 21'],
  },
  22: { correct: ['20', '20%', '19.9', '19'], wrong: ['21', '18', '14.4'] },
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
