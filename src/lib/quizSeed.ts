// 스피드 퀴즈 — 전체 시드 (정답·판정·해설·작성자 포함) · Quiz v1.0
//
// ⚠ 운영자 화면(/quiz/admin)과 테스트 스크립트만 import한다. 참가자·스크린 번들에 들어가면 안 된다
//   (공개 문항은 quizQuestions.ts). 공개 시점의 정답·해설은 운영자가 quiz_state.reveal로 내려보낸다.
//
// 원본: data/quiz_source_rows.json (Google Sheet '출제본 정리'). 행 0 = 열 문자, 행 1 = 메모
// "26년 6월 기준으로 맞추기", 행 2 = 헤더 [#, 카테고리, 질문, 난이도(5점만점), 답, 설명/전략적 의미, 해설, 작성자],
// 행 3..24 = 22문항. 정리한 내용:
//   - 질문의 마크다운 강조(*…*) 제거, 오타 '고개객'→'고객', 선택지 사이 간격 정리 (문장은 그대로)
//   - 마지막 행(no 22)은 작성자 칸이 비어 있다 → '미기재'
//   - '답' 칸에 섞인 "(허용: a~b)"는 판정 범위로 옮기고 표시용 답에서는 뺐다
//   - 설명·해설은 공개 화면용 2문장 이내 explanation으로 합치고, 원문 전체는 notes(진행자용)에 남겼다

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

const KEYS: QuizAnswerKey[] = [
  {
    no: 0,
    answerDisplay: '2개',
    explanation: '30개 테이블이 모두 8명이면 240명 — 238명이면 2명이 모자라니 7명 테이블은 2개입니다.',
    notes: '연습 문제(상품 없음). 8x + 7y = 238, x + y = 30 → y = 2.',
    author: '운영',
    judge: { type: 'numeric', target: 2, min: 2, max: 2, unit: '개', accept: ['두개', '두 개', '둘'], why: '정답이 정수 하나' },
  },
  {
    no: 1,
    answerDisplay: '뱅크런',
    explanation: '은행(Bank)이 달린다(Run) — 뱅크런, 예금자들이 한꺼번에 돈을 찾으러 몰리는 현상입니다.',
    notes: '(넌센스) 은행이 달리기를 하면? → 뱅크런',
    author: '지니',
    judge: {
      type: 'text',
      accept: ['뱅크런', 'bankrun', 'bank run', '뱅크 런'],
      contains: ['뱅크런', 'bankrun'],
      why: '고유 단어 — 한글·영문 표기 모두',
    },
  },
  {
    no: 2,
    answerDisplay: '2,793만 개 (고객 손안에 하나씩)',
    explanation: '카카오뱅크는 지점이 없는 대신 고객 한 명 한 명의 휴대폰이 곧 지점입니다. 고객 수 2,793만(26년 6월) = 지점 2,793만 개!',
    notes: '(넌센스) 답: 고객 수 2,793만 개 (고객 손안에 하나씩). 기준 시점에 따라 2,670만(25년 말)~2,800만을 말해도 인정.',
    author: '지니',
    judge: {
      type: 'numeric',
      target: 2793,
      min: 2600,
      max: 2900,
      unit: '만',
      accept: ['고객수', '고객수만큼', '고객 수만큼', '모든 고객', '고객님 손안에'],
      why: '넌센스라 "고객 수"를 말하면 정답. 25년 말 2,670만 ~ 26년 2,793만을 모두 인정(2,600만~2,900만)',
    },
  },
  {
    no: 3,
    answerDisplay: '① 2025년 9월 1일  ② 24년 만 (2001년 이후)',
    explanation: '예금자보호 한도는 2025년 9월 1일부터 1억 원으로 올랐습니다. 2001년 5천만 원으로 정해진 뒤 24년 만의 인상입니다.',
    notes: '① 2025년 9월 1일 ② 24년 만 (2001년 이후)',
    author: '지니',
    judge: {
      type: 'keywords',
      all: [
        // 날짜: 2025.9.1 / 2025-09-01 / 20250901 / 25.9.1 / 2025년 9월 1일
        're:(?<!\\d)(?:20)?25\\s*[.\\-/년]?\\s*0?9\\s*[.\\-/월]?\\s*0?1(?!\\d)',
        // 24년 만 (2024의 24는 제외)
        're:(?<![\\d.])24(?!\\d)',
      ],
      why: '두 부분(시행일 + 24년)이 모두 있어야 정답. 날짜 표기 여러 형식 허용',
    },
  },
  {
    no: 4,
    answerDisplay: '4곳',
    explanation: '소소뱅크·한국소호은행·포도뱅크·AMZ뱅크, 모두 4곳이 예비인가를 신청했습니다.',
    notes: '답 4곳 — 소소뱅크 · 한국소호은행 · 포도뱅크 · AMZ뱅크',
    author: '지니',
    judge: { type: 'numeric', target: 4, min: 4, max: 4, unit: '곳', accept: ['네곳', '네 곳', '넷'], why: '정수 하나 — 정확히' },
  },
  {
    no: 5,
    answerDisplay: '1. 카카오뱅크 K패스 체크카드',
    explanation: '모두의 카드는 K패스 적립 방식 위에 무제한 정기권 개념을 얹은 제도라, K패스 카드로 이용합니다. 정답은 1번 카카오뱅크 K패스 체크카드입니다.',
    notes: '답 1. 카카오뱅크 K패스 체크카드 (선택지 2 기후동행카드, 3 애플페이 티머니선불카드는 오답)',
    author: '제인',
    judge: {
      type: 'text',
      accept: ['1', '1번', '①', '카카오뱅크 K패스 체크카드', '카카오뱅크 K패스', 'K패스 체크카드', 'K패스'],
      contains: ['k패스', '케이패스', 'kpass'],
      why: '객관식 — 번호(1/1번/①) 또는 카드 이름(K패스 포함)',
    },
  },
  {
    no: 6,
    answerDisplay: '마스턴캐피탈',
    explanation: '카카오뱅크의 창립 후 첫 M&A 대상은 마스턴캐피탈입니다. 자동차 할부·리스 등 비은행 여신과 기업대출로 사업을 넓힙니다.',
    notes: '답 마스턴캐피탈',
    author: '제인',
    judge: {
      type: 'text',
      accept: ['마스턴캐피탈', '마스턴캐피털', '마스턴', 'masterncapital', 'mastern', '마스턴캐피탈주식회사'],
      contains: ['마스턴', 'mastern'],
      why: '회사명 — "마스턴"이 들어가면 정답(캐피탈/캐피털 표기 차이 흡수)',
    },
  },
  {
    no: 7,
    answerDisplay: 'Security First Network Bank (SFNB)',
    explanation: '1995년 미국에서 문을 연 Security First Network Bank(SFNB)가 세계 최초의 인터넷전문은행입니다.',
    notes: '답 Security First Network Bank (SFNB), 미국',
    author: '지니',
    judge: {
      type: 'text',
      accept: ['SFNB', 'Security First Network Bank', '시큐리티퍼스트네트워크뱅크'],
      contains: ['sfnb', 'securityfirstnetwork', '시큐리티퍼스트'],
      why: '약칭 SFNB 또는 정식 명칭(영문·한글 음차)',
    },
  },
  {
    no: 8,
    answerDisplay: '3.00%',
    explanation: '한국은행은 올해 7월과 8월 두 차례 0.25%p씩 올려, 현재 기준금리는 3.00%입니다.',
    notes: '답 3.00%. 해설: 한국은행은 올해 7,8월 두차례 0.25%씩 인상 발표하여 현재 기준금리는 3%',
    author: '제인',
    judge: { type: 'numeric', target: 3, min: 3, max: 3, unit: '%', why: '기준금리는 0.25%p 단위라 정확히 3' },
  },
  {
    no: 9,
    answerDisplay: '약 8,670명/일',
    explanation: '영업 3,079일 동안 고객 2,670만 명 — 하루 평균 약 8,670명씩 늘었습니다.',
    notes: '답 약 8,670명/일. 해설: 26,700,000 ÷ 3,079일 → 8,672명 (첫날 포함 3,080일로 세면 8,669명)',
    author: '지니',
    judge: {
      type: 'numeric',
      target: 8670,
      min: 8660,
      max: 8680,
      unit: '명',
      why: '"십 단위까지" — 일수를 3,079/3,080일로 세는 차이(8,669~8,672)와 반올림을 흡수해 ±10',
    },
  },
  {
    no: 10,
    answerDisplay: '머니무브',
    explanation: '안전자산인 은행 예금에서 주식·부동산 같은 고위험 자산으로 돈이 옮겨 가는 현상을 머니무브라고 합니다.',
    notes: '답 머니무브 (Money Move)',
    author: '제인',
    judge: {
      type: 'text',
      accept: ['머니무브', 'moneymove', 'money move', '머니 무브', '머니무브먼트'],
      contains: ['머니무브', 'moneymove'],
      why: '고유 용어 — 한글·영문 표기',
    },
  },
  {
    no: 11,
    answerDisplay: '다크패턴',
    explanation: '소비자의 착각·실수를 유도해 원치 않는 결정을 하게 만드는 설계를 다크패턴이라고 합니다. 금감원이 올해 9월 예방 협의체를 출범했습니다.',
    notes: '답 다크패턴 (Dark Pattern)',
    author: '제인',
    judge: {
      type: 'text',
      accept: ['다크패턴', 'darkpattern', 'dark pattern', 'darkpatterns', '다크 패턴'],
      contains: ['다크패턴', 'darkpattern'],
      why: '고유 용어 — 한글·영문 표기',
    },
  },
  {
    no: 12,
    answerDisplay: '2028년',
    explanation: '연평균 15.3% 성장이 이어지면 2026년 1,663만 → 2027년 1,917만 → 2028년 2,210만 명으로, 2028년에 처음 2,000만을 넘습니다.',
    notes: '답 2028년. 해설: 연평균 성장률 15.3%, 이 속도면 2026년 1,663만 → 2027년 1,917만 → 2028년 2,210만 명으로 2028년에 처음 2,000만을 넘는다.',
    author: '제일런',
    judge: { type: 'text', accept: ['2028', '2028년', '28년', '28'], why: '연도 — 정확히 2028(28년 약식 허용)' },
  },
  {
    no: 13,
    answerDisplay: '약 20% (20.2%)',
    explanation: '75.9조 원에서 100조 원까지 1.5년 안에 가려면 연평균 약 20.2%씩 자라야 합니다. 최근 반년은 머니무브로 총자산이 오히려 줄었습니다.',
    notes:
      '답 약 20%. 해설: (75.9조 → 100조, 1.5년 → 연평균 20.2%)\n의도: 검색으로는 안 풀리고 CAGR 계산이 필요합니다. 그리고 "연 20%"라는 답이 나오는 순간 목표의 실제 무게가 체감됩니다. 참고로 2025년말 76.4조 → 2026년 6월말 75.9조로 최근 반년은 오히려 줄었습니다(증시 활황에 따른 머니무브). 진행자가 여기서 한마디 얹기 좋습니다.',
    author: '지니',
    judge: {
      type: 'numeric',
      target: 20.2,
      min: 19.8,
      max: 20.6,
      unit: '%',
      why: '복리 1.5년 = 20.2%. "약 20"도 인정(±0.4). 단리로 나눈 21.2%, 2년으로 계산한 14.8%는 오답',
    },
  },
  {
    no: 14,
    answerDisplay: '13%',
    explanation: "우리아이서비스는 '25년 9월 출시 후 1년 만에 0세 고객 침투율 13%를 기록했습니다.",
    notes: '답 13%',
    author: '제인',
    judge: {
      type: 'numeric',
      target: 13,
      min: 12.5,
      max: 13.4,
      unit: '%',
      why: '정수 xx% 문제 — 13(13.0~13.4 표기 포함). 반올림해 13이 되는 12.5도 인정',
    },
  },
  {
    no: 15,
    answerDisplay: '14.2%',
    explanation: '68.3조 원 × 0.1% = 연 683억 원, 683억 ÷ 4,803억 = 14.2%입니다. 조달금리 0.1%p가 순이익의 14%를 좌우합니다.',
    notes:
      '답 14.2% (허용: 14.1~14.3). 해설: 「68.3조의 0.1%는 얼마, 그 금액은 4,803억의 몇 %? 소수 첫째 자리」, 두 단계로 나눠 묻는다.\n내용 — 68.3조 × 0.1% = 연 683억 원, 683억 ÷ 4,803억 = 14.2%.',
    author: '제일런',
    judge: { type: 'numeric', target: 14.2, min: 14.1, max: 14.3, unit: '%', why: '시트의 허용 범위 14.1~14.3' },
  },
  {
    no: 16,
    answerDisplay: '18.5%',
    explanation: '장기체류 외국인 약 216만 명 기준 40만 ÷ 216만 = 18.5%입니다. 전체 체류외국인(278만) 기준으로 나누면 14.4%로 달라집니다.',
    notes:
      "답 18.5% (허용: 18.0~19.0 — 장기체류 외국인 약 216만 명 기준). 해설: 장기체류 외국인 약 216만 명(전체 체류외국인 약 278만 명 중 단기체류 약 62만 명 제외), 40만 ÷ 216만 = 18.5%. 전체 체류외국인(278만) 기준으로 나누면 14.4%로 달라지므로 '장기체류'를 확인해야 한다.",
    author: '제일런',
    judge: { type: 'numeric', target: 18.5, min: 18.0, max: 19.0, unit: '%', why: '시트의 허용 범위 18.0~19.0 (14.4%는 오답)' },
  },
  {
    no: 17,
    answerDisplay: '5 · 6 · 16 (제5조 · 제6조 · 제16조)',
    explanation: '지분 보유 한도는 제5조, 신용공여 금지는 제6조, 비대면 원칙의 예외는 제16조입니다.',
    notes:
      '답 5 · 6 · 16 (제5조 · 제6조 · 제16조). 해설: 지분 보유 한도는 제5조, 신용공여 금지는 제6조, 비대면 원칙의 예외는 제16조. 출처 인터넷전문은행 설립 및 운영에 관한 특례법',
    author: '제일런',
    judge: {
      type: 'keywords',
      all: ['re:(?<!\\d)5(?!\\d)\\D+6(?!\\d)\\D+16(?!\\d)'],
      why: '숫자 세 개가 5 → 6 → 16 순서로(구분자 자유: 공백·쉼표·점·"제n조"). 붙여 쓴 "5616"은 검토 대상(운영자 ✓)',
    },
  },
  {
    no: 18,
    answerDisplay: '158억 원',
    explanation: '2025년 순이익 2위 케이뱅크 1,126억 원 − 3위 토스뱅크 968억 원 = 158억 원입니다.',
    notes: '답 158억 원 (케이뱅크 1,126억 − 토스뱅크 968억) (허용: 150~165). 해설: 1위 카카오뱅크 4,803억 원, 2위 케이뱅크 1,126억 원, 3위 토스뱅크 968억 원',
    author: '제일런',
    judge: { type: 'numeric', target: 158, min: 150, max: 165, unit: '억', why: '시트의 허용 범위 150~165억' },
  },
  {
    no: 19,
    answerDisplay: '인도네시아 Superbank · 태국 SCBX + WeBank 컨소시엄(Bank X) · 몽골 MCS그룹',
    explanation: '인도네시아는 Superbank, 태국은 SCBX·WeBank 컨소시엄(Bank X), 몽골은 MCS그룹과 함께합니다.',
    notes: '답\n인도네시아 Superbank\n태국 SCBX + WeBank 컨소시엄(뱅크X(Bank X))\n몽골 MCS그룹',
    author: '지니',
    judge: {
      type: 'manual',
      rubric: '3개국(인도네시아·태국·몽골)과 각 파트너(Superbank / SCBX·WeBank·Bank X / MCS)가 모두 맞아야 정답',
      why: '6개 항목·표기 변형이 많아 자동 판정이 부정확 → 운영자 ✓/✗',
    },
  },
  {
    no: 20,
    answerDisplay: '하한 3.0%p · 한도 약 6.98억 → 5.01억 원 (약 2억 원, 28% 감소)',
    explanation: '수도권·규제지역 주담대의 스트레스 금리 하한은 3.0%p입니다. 연소득 1억 원 차주의 한도는 약 6.98억 → 5.01억 원으로 약 2억 원(28%) 줄어듭니다.',
    notes:
      '답\n스트레스 금리 하한: 3.0%p (2025년 10월 16일부터 수도권·규제지역 주담대에 적용)\n적용 전(4%): 연간 상환여력 4,000만원 → 한도 약 6.98억원\n적용 후(7%): → 한도 약 5.01억원\n약 2억원(약 28%) 감소',
    author: '지니',
    judge: {
      type: 'manual',
      rubric: '하한 3.0%p + 감소액 약 2억 원(또는 6.98억 → 5.01억, 약 28%)이 모두 있으면 정답',
      why: '계산 과정·표기가 다양해 자동 판정 불가 → 운영자 ✓/✗',
    },
  },
  {
    no: 21,
    answerDisplay: '내렸다, 2.1%p (71.7% → 69.6%)',
    explanation: '카카오뱅크 비중은 2024년 71.7% → 2025년 69.6%로 2.1%p 내렸습니다. 순이익은 9.1% 늘었지만 토스뱅크가 두 배 넘게 뛰었습니다.',
    notes:
      '답 내렸다, 2.1%p (2024년 71.7% → 2025년 69.6%). 해설: 2024년 4,401 ÷ (4,401 + 1,281 + 457) = 71.7%, 2025년 4,803 ÷ 6,897 = 69.6%로 2.1%p 내렸다. 우리 순이익은 9.1% 늘어 여전히 3사 중 가장 컸지만, 토스뱅크가 457억 원에서 968억 원으로 두 배 넘게 뛰면서 합산 비중은 소폭 내려갔다.',
    author: '제일런',
    judge: {
      type: 'keywords',
      all: [
        ['내렸', '내려', '내림', '하락', '감소', '떨어', '낮아', '줄었', 'down', 're:-\\s*2\\.10?(?!\\d)'],
        're:(?<![\\d.])2\\.10?(?!\\d)',
      ],
      none: [['올랐', '올라', '오름', '상승', '증가', '늘었', 're:\\+\\s*2\\.1']],
      why: '방향(내렸다 계열 또는 -2.1)과 숫자 2.1이 모두 있어야 정답. "올랐다"가 들어가면 오답',
    },
  },
  {
    no: 22,
    answerDisplay: '20% (19.9%)',
    explanation: 'F&P는 3,105억 → 4,465억 원을 2년 안에 가려면 연평균 약 20%씩 자라야 합니다. 지금 하는 일의 연장이 아니라 새 수수료·플랫폼 수익원이 필요합니다.',
    notes:
      "답 20% (허용: 19~20). 설명/전략적 의미: F&P는 연 20%씩 자라야 한다 — 총자산 성장 요건(14.4%)보다 높고 지난해 증가율(2.9%)과는 격차가 크다. 지금 하는 일의 연장이 아니라 새 수수료·플랫폼 수익원을 만들어야 닿는다.\n해설: 19.9%, 약 20%. 밸류업 계획의 'F&P 수익 CAGR 20%' 목표와 같은 숫자다.",
    author: '미기재',
    judge: { type: 'numeric', target: 20, min: 19, max: 20, unit: '%', why: '시트의 허용 범위 19~20 (19.9 포함)' },
  },
];

/** 공개 문항 + 정답 키를 합친 전체 목록 (index = quiz_state.current_index) */
export const QUIZ_SEED: QuizQuestion[] = QUIZ_QUESTIONS.map((q) => {
  const key = KEYS.find((k) => k.no === q.no);
  if (!key) throw new Error(`quizSeed: no ${q.no} 정답 키 없음`);
  return { ...q, ...key };
});
