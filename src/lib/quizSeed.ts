// 스피드 퀴즈 — 전체 시드 (정답·판정·해설·작성자 포함) · Quiz v2.0
//
// ⚠ 서버(/api/quiz/keys)와 테스트 스크립트만 import한다. 어떤 클라이언트 번들에도 들어가면 안 된다
//   (운영자 화면도 포함 — 운영자 키를 확인한 뒤 /api/quiz/keys로 받아 quizSeedStore에 넣는다).
//   공개 문항은 quizQuestions.ts, 공개 시점의 정답·해설은 운영자가 quiz_state.reveal로 내려보낸다.
//
// 원본: Google Sheet '출제본 정리' 3~18행 (2026-10-06 판, v2.1).
//   열: NUM · 카테고리 · 질문 · 답 · 설명/전략적 의미(→ explanation, 정답 공개 화면) · 슬라이드(→ notes) · 작성자
//   오타 '고개들'→'고객들', '빈도 굉장히'→'빈도가 굉장히' 등만 고쳤다.

import { QUIZ_QUESTIONS, QUIZ_SOURCE_NOTE, type QuizQuestionPublic } from './quizQuestions';
import type { JudgeSpec } from './quizJudge';

export { QUIZ_SOURCE_NOTE };

export interface QuizAnswerKey {
  no: number;
  /** 화면·휴대폰에 공개할 정답 */
  answerDisplay: string;
  /** 공개 화면용 해설 (2문장 이내) */
  explanation: string;
  /** 진행자(MC)용 원문 — 설명/전략적 의미 + 해설 전체 */
  notes: string;
  /** 출제자 — 내부용, 참가자·스크린에 절대 표시하지 않는다 */
  author: string;
  judge: JudgeSpec;
}

export type QuizQuestion = QuizQuestionPublic & QuizAnswerKey;

export const QUIZ_KEYS: QuizAnswerKey[] = [
  {
    no: 0,
    answerDisplay: '뱅크런',
    explanation: "은행의 대규모 예금 인출 사태를 뜻하는 '뱅크런'입니다. 연습은 여기까지 — 이제부터 점수가 걸립니다.",
    notes: '연습 문제(점수 없음). 슬라이드: 정답 뱅크런',
    author: '지니',
    judge: { type: 'text', accept: ['뱅크런', 'bankrun', 'bank run', '뱅크 런'], contains: ['뱅크런'] },
  },
  {
    no: 1,
    answerDisplay: '3.00%',
    explanation:
      '금리는 우리 비즈니스에 가장 큰 영향을 미치는 지표입니다. 고금리 시대가 예상되는 앞으로 우리는 어떻게 대응해야 할지, 리더분들의 생각이 궁금해지네요.',
    notes: '정답 3.00% — 한국은행은 올해 7·8월 0.25%p씩 인상 → 고객들이 예금으로 빠르게 복귀 중',
    author: '제인',
    judge: { type: 'numeric', target: 3, min: 3, max: 3, unit: '%', accept: ['3퍼센트', '삼퍼센트'] },
  },
  {
    no: 2,
    answerDisplay: '머니무브',
    explanation:
      '올해 상반기에 실제로 벌어진 일입니다. 머니무브로 수신이 2조 2천억 줄고, 총자산도 반년 만에 감소했습니다. 예금은 지킨다고 지켜지는 게 아니라 다른 자산과 경쟁해서 남는 것 — 돈의 흐름의 종착지가 카뱅 앱이 되게 하려면 무엇을 해야 할까요?',
    notes: '정답 머니무브',
    author: '지니',
    judge: { type: 'text', accept: ['머니무브', '머니 무브', 'money move', 'moneymove'], contains: ['머니무브', 'moneymove'] },
  },
  {
    no: 3,
    answerDisplay: '24년 (2001년 이후)',
    explanation:
      '24년 동안 묶여 있던 한도가 풀리면서 고객들은 예금을 쪼개 여러 은행에 나눠 넣을 이유가 줄었습니다. 고객들이 카카오뱅크에 1억씩 예치할 수 있도록 — 화이팅을 외치며 다음 문제로 가보겠습니다.',
    notes: '정답 24년 (2001년 이후) · 고객당 평균 잔고 1억원을 향해',
    author: '지니',
    judge: { type: 'numeric', target: 24, min: 24, max: 24, unit: '년', accept: ['이십사년', '스물네해'] },
  },
  {
    no: 4,
    answerDisplay: '2,763만 개 (0개도 정답)',
    explanation:
      '정답은 카뱅이 보유한 고객 수, "2,763만 개"입니다. 우리는 지점을 안 만든 게 아니라, 고객 손안에 하나씩 놓아 2,763만 명의 주머니 속에 각자의 지점이 있는 거죠.',
    notes: '복수 정답: 0개 또는 2,763만 개(고객 수, 2026년 6월 말)',
    author: '지니',
    judge: {
      type: 'text',
      accept: ['0', '없음', '없다', '영', '2763만', '2763', '27630000', '2763만명', '고객수', '고객수만큼'],
      contains: ['2763만', '고객수', '손안에', '없'],
      why: '복수 정답 — 0개 또는 2,763만 개',
    },
  },
  {
    no: 5,
    answerDisplay: '1. 카카오뱅크 K패스 체크카드',
    explanation:
      '교통비는 금액으로 보면 작지만 매일 쓰기 때문에 빈도가 굉장히 높습니다. 이런 환급 제도에 우리 카드를 얹음으로써 고객의 일상 결제 접점을 먼저 가져가는 의미가 있습니다.',
    notes: '정답 1. 카카오뱅크 K패스 체크카드',
    author: '제인',
    judge: {
      type: 'text',
      accept: ['1', '1번', '①', '카카오뱅크 K패스 체크카드', '카카오뱅크 K패스', 'K패스 체크카드', 'K패스'],
      contains: ['k패스', '케이패스', 'kpass'],
    },
  },
  {
    no: 6,
    answerDisplay: '600만 명',
    explanation:
      '보통 금융 앱은 한 달에 한두 번 씁니다. 그런데 우리 앱은 600만 명이 용건이 없어도 엽니다 — 출근길에 모임통장 보고, 저녁에 기록 보고, 친구에게 송금하고. 600만에서 나아가 2,700만 고객이 매일 우리 앱을 열게 하려면 무엇이 필요할지 함께 고민해 보면 좋겠습니다.',
    notes: '정답 600만 (BI 포털, 2026년 9월) — 허용 범위는 팀 확인 필요(현재 정확히 600)',
    author: '',
    judge: { type: 'numeric', target: 600, min: 600, max: 600, unit: '만', accept: ['6백만', '육백만', '6백만명', '육백만명'], why: '만 명 단위 — 정확히 600 [팀 확인]' },
  },
  {
    no: 7,
    answerDisplay: '2. 13%',
    explanation:
      '0세 침투율 13% — 태어난 아이 여덟 명 중 한 명이 1년 안에 우리 고객이 됐다는 뜻입니다. 0세 고객은 지금 수익을 주는 고객은 아니지만, 수십 년짜리 생애 접점을 만든 만큼 우리 고객으로 잘 온보딩하면 좋겠습니다.',
    notes: '시트 답란은 "3. 13%"였으나 보기 순서상 13%는 2번 — 2번/13으로 판정 [팀 확인]',
    author: '제인',
    judge: { type: 'text', accept: ['2', '2번', '②', '13', '13%', '13퍼센트'], why: '보기 2번 = 13%' },
  },
  {
    no: 8,
    answerDisplay: '마스턴캐피탈',
    explanation:
      '창립 9년 만의 첫 M&A입니다. 자동차 할부·리스처럼 은행 라이선스로는 닿지 않던 영역으로의 첫걸음인데요, 이번 인수가 카뱅의 새로운 성장 동력이자 여신과의 시너지를 극대화하는 계기가 되면 좋겠습니다.',
    notes: '정답 마스턴캐피탈',
    author: '제인',
    judge: {
      type: 'text',
      accept: ['마스턴캐피탈', '마스턴캐피털', '마스턴', 'masterncapital', 'mastern', '마스턴캐피탈주식회사'],
      contains: ['마스턴', 'mastern'],
    },
  },
  {
    no: 9,
    answerDisplay: '1. A > B > C',
    explanation:
      '돈이 오고 가는 길목은 우리가 1등으로 잡았습니다. 이제 이 영향력을 돈이 붙는 쓰기와 모으기까지 넓혀야 하는데 — 그 고민을 오후에 함께 해 보면 좋겠습니다.',
    notes: '정답 1번 A > B > C — 돈 보내기·받기(이체 건수 M/S 16%) > 돈 쓰기(결제금액 1.7%) > 돈 모으기(투자자산 1.4%), 2025년 말',
    author: '',
    judge: {
      type: 'keywords',
      any: ['re:^[^0-9abc]*1[^0-9abc]*$', 're:^[^abc0-9]*1?[^abc0-9]*a[^abc0-9]*b[^abc0-9]*c[^abc0-9]*$'],
      all: [],
      why: '보기 1번(A > B > C) — 번호 또는 A·B·C 순서로 써도 정답',
    },
  },
  {
    no: 10,
    answerDisplay: '① AIR  ② ChatGPT  ③ 시그널',
    explanation:
      "Revolut의 'AIR', ChatGPT의 'Finances', 토스증권의 'AI 시그널' — 국내외 다양한 금융 서비스가 AI 서비스를 내놓고 있습니다. 어떤 서비스가 있는지 계속 센싱하는 것도 중요합니다.",
    notes: '정답 AIR, ChatGPT, 시그널 — 세 칸 모두 맞아야 정답',
    author: '',
    judge: {
      type: 'keywords',
      all: [['air', '에어'], ['chatgpt', 'gpt', '챗gpt', '챗지피티', '쳇gpt', '쳇지피티', '지피티'], ['시그널', '시그날', '씨그널', 'signal']],
      why: '세 칸 모두 필요 (순서·대소문자 무관)',
    },
  },
  {
    no: 11,
    answerDisplay: '123 (3 + 100 + 20)',
    explanation:
      '고객 3천만 명, 자산 100조 원, F&P 수익 CAGR 20% — 내년 우리가 달성해야 할 목표를 다시 한번 돌아보는 시간이었습니다. 도전적이지만 달성 의지가 불타는 목표, 다 같이 향해 가 보면 어떨까요.',
    notes: '정답 123 = 3 + 100 + 20',
    author: '',
    judge: { type: 'numeric', target: 123, min: 123, max: 123 },
  },
  {
    no: 12,
    answerDisplay: '14.2%',
    explanation:
      '0.1%p가 순이익의 14%입니다. 수신 68.3조를 가진 우리에게는 조달금리 소수점 한 자리가 이만큼 큽니다. 뒤집어 말하면, 이자를 덜 주고도 돈이 머무는 힘이 곧 이익입니다. 수신은 규모보다 질의 문제입니다.',
    notes: '68.3조 × 0.1% = 연 683억, 683억 ÷ 4,803억 = 14.2% (허용 14.1~14.3)',
    author: '제일런',
    judge: { type: 'numeric', target: 14.2, min: 14.1, max: 14.3, unit: '%' },
  },
  {
    no: 13,
    answerDisplay: '18.5%',
    explanation:
      '고객 수가 3천만 명에 육박하는 만큼 성장의 무대는 새 고객군으로 넓어져야 합니다. 장기체류 외국인 216만 명이 그중 하나 — 2027년 40만 명 목표는 그 풀의 5분의 1에 가까운 도전적인 숫자입니다.',
    notes: '장기체류 외국인 약 216만 명(전체 체류외국인 약 278만 − 단기체류 약 62만), 40만 ÷ 216만 = 18.5% (허용 ±0.5)',
    author: '제일런',
    judge: { type: 'numeric', target: 18.5, min: 18.0, max: 19.0, unit: '%' },
  },
  {
    no: 14,
    answerDisplay: '인도네시아 · 태국 · 몽골',
    explanation:
      '인도네시아는 지분 투자, 태국은 앱 개발을 우리가 주도하고, 몽골은 신용평가모델 수출입니다. 카카오뱅크의 어떤 경쟁력을 수출하는지 — 세 나라의 접근법이 다 다릅니다.',
    notes: '정답 인도네시아(Superbank 지분 투자), 태국(SCBX 가상은행 앱 개발), 몽골(신용평가모델 수출) — 세 나라 모두, 순서 무관',
    author: '지니',
    judge: {
      type: 'keywords',
      all: [
        ['인도네시아', '인니', 'indonesia'],
        ['태국', '타일랜드', 'thailand', 're:(^|[\\s|,·/])(타이|thai)([\\s|,·/]|$)'],
        ['몽골', '몽고', 'mongolia', 'mongol'],
      ],
      why: '세 나라 모두 (순서 무관)',
    },
  },
  {
    no: 15,
    answerDisplay: '5,400 (0.1 × 18,000 × 3)',
    explanation:
      'A. 입출금통장 기본금리(세전) 0.1% × B. 줍줍 신용카드 연회비 18,000원 × C. mini 26일 저금 최대 동시 개설 3개 = 5,400 — 우리 상품을 우리 AI에게 물어 푼 문제였습니다.',
    notes: 'A 0.1 × B 18,000 × C 3 = 5,400',
    author: '',
    judge: { type: 'numeric', target: 5400, min: 5400, max: 5400 },
  },
];

/** 공개 문항 + 정답 키를 합친 전체 목록 (index = quiz_state.current_index) */
export const QUIZ_SEED: QuizQuestion[] = QUIZ_QUESTIONS.map((q) => {
  const key = QUIZ_KEYS.find((k) => k.no === q.no);
  if (!key) throw new Error(`quizSeed: no ${q.no} 정답 키 없음`);
  return { ...q, ...key };
});
