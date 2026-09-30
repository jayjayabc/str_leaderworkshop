// 스피드 퀴즈 — 공개 문항 (Quiz v1.0)
//
// ⚠ 이 파일에는 정답을 넣지 않는다.
//   참가자 화면(/quiz)과 스크린(/quiz/screen)은 이 파일만 import한다. 정답·판정·해설·작성자는
//   quizSeed.ts에 있고 운영자 화면(/quiz/admin)만 import한다(Next가 라우트별로 번들을 나누므로
//   참가자 휴대폰에는 정답이 내려가지 않는다). 공개 시점의 정답·해설은 운영자가 quiz_state.reveal로 보낸다.
//
// 원본: 팀 Google Sheet '출제본 정리' 탭 → data/quiz_source_rows.json (22문항, 난이도순 정렬).
// index 0은 연습 문제(상품 없음), 1..22가 본 문제(no = 시트 순서).

export const QUIZ_SOURCE_NOTE = '26년 6월 기준으로 맞추기';

export type QuizCategory = '연습' | '기타' | '규제' | '시장동향' | '전략·성과' | 'AI활용';

export interface QuizQuestionPublic {
  /** 0 = 연습, 1..22 = 시트 순서 */
  no: number;
  practice: boolean;
  category: QuizCategory;
  /** 난이도 1..5 (★) */
  difficulty: number;
  /** 문제 전문 — 줄바꿈 유지 */
  prompt: string;
  /** '키워드만' 표시 모드의 기본 키워드 (운영자가 문항별로 바꿀 수 있다). 기본값 = 카테고리 */
  keyword: string;
  /** 휴대폰 입력 키패드 — 숫자형 답이면 decimal */
  input: 'decimal' | 'text';
  /** 기본 제한시간(초). 없으면 전체 기본값(90초) */
  durationSec?: number;
}

const Q = (q: Omit<QuizQuestionPublic, 'keyword' | 'practice'> & { keyword?: string }): QuizQuestionPublic => ({
  ...q,
  practice: q.no === 0,
  keyword: q.keyword ?? q.category,
});

export const QUIZ_QUESTIONS: QuizQuestionPublic[] = [
  Q({
    no: 0,
    category: '연습',
    difficulty: 1,
    prompt:
      '오늘 참석자 238명이 테이블 30개에 나눠 앉습니다. 모든 테이블이 8명 아니면 7명이라면, 7명 테이블은 몇 개일까요?',
    keyword: '연습 문제',
    input: 'decimal',
    durationSec: 60,
  }),
  Q({ no: 1, category: '기타', difficulty: 1, prompt: '(넌센스) 은행이 달리기를 하면?', input: 'text', durationSec: 45 }),
  Q({
    no: 2,
    category: '기타',
    difficulty: 1,
    prompt: '(넌센스) 카카오뱅크 지점은 전국에 몇 개일까요?',
    input: 'text',
    durationSec: 45,
  }),
  Q({
    no: 3,
    category: '규제',
    difficulty: 1,
    prompt:
      '예금자보호 한도가 5천만원에서 1억원으로 올랐습니다. ① 실제 시행일(연·월·일)과 ② 몇 년 만의 인상인지 쓰세요.',
    input: 'text',
  }),
  Q({
    no: 4,
    category: '규제',
    difficulty: 1,
    prompt:
      '2025년 3월 제4 인터넷전문은행 예비인가 신청이 접수됐습니다. 신청 컨소시엄은 모두 몇곳이었나요?',
    input: 'decimal',
  }),
  Q({
    no: 5,
    category: '시장동향',
    difficulty: 1,
    prompt:
      '대도시광역교통위원회에서는 기존의 K패스 적립방식에 기후동행카드의 무제한 정기권개념을 결합하여 모두의 카드라는 새로운 대중교통비 무제한 환급 제도를 운영하고 있습니다.\n모두의 카드는 일반형과 플러스형으로 나뉘어 운영되며, 서울시민 인증 시 서울시민 패스로도 운영되고 있습니다.\n다음중 모두의 카드를 이용하고 싶을 때 어떤 카드를 발급 받는 것이 가장 좋을까요?\n1. 카카오뱅크 K패스 체크카드  2. 기후동행카드  3. 애플페이 티머니선불카드',
    keyword: '모두의 카드',
    input: 'text',
  }),
  Q({
    no: 6,
    category: '전략·성과',
    difficulty: 1,
    prompt:
      '올해 카카오뱅크는 창립이후 첫 M&A를 진행했습니다. M&A를 통해 자동차 할부, 리스 등 비은행 여신과 기업대출 영역으로 사업을 확장하고, 조달 경쟁력을 활용한 재무 시너지를 창출할 계획입니다. 카카오뱅크가 인수한 이 회사는 어디일까요?',
    keyword: '첫 M&A',
    input: 'text',
  }),
  Q({
    no: 7,
    category: '기타',
    difficulty: 2,
    prompt:
      '오늘날 카카오뱅크처럼 지점 없이 운영되는 은행의 원조가 있습니다. 1995년 미국에서 문을 연, 세계 최초의 인터넷전문은행 이름은 무엇일까요?',
    keyword: '세계 최초 인터넷은행',
    input: 'text',
  }),
  Q({
    no: 8,
    category: '시장동향',
    difficulty: 2,
    prompt: '2026년 한국은행은 기준금리를 두차례 인상했습니다. 현재 기준금리는 얼마일까요?',
    keyword: '기준금리',
    input: 'decimal',
  }),
  Q({
    no: 9,
    category: '전략·성과',
    difficulty: 2,
    prompt:
      '카카오뱅크는 2017년 7월 27일 영업을 시작해, 2025년 12월 31일 기준 고객 2,670만 명을 확보했습니다. 이 기간 동안 하루 평균 몇 명씩 고객이 늘었을까요? (십 단위까지)',
    keyword: '하루 평균 고객 증가',
    input: 'decimal',
  }),
  Q({
    no: 10,
    category: '시장동향',
    difficulty: 3,
    prompt:
      '올해 상반기처럼 증시나 부동산이 호황이거나 낮은 금리가 지속될 때 자금이 안전자산인 은행예금에서 부동산, 주식채권 시장 등 고위험 고수익 자산으로 이동하는 현상은 무엇일까요?',
    input: 'text',
  }),
  Q({
    no: 11,
    category: '시장동향',
    difficulty: 3,
    prompt:
      '올해 9월 금융감독원에서는 금융업계의 OOOO 예방을 위한 상시협의체 킥오프 회의를 개최했습니다. OOOO의 주요사례로는 금융상품 계약절차 중 부수적인 상품/서비스 안내, 소비자가 의사표시를 하였음에도 지속적으로 팝업창을 띄우는 등의 행위가 있는데요, OOOO은 무엇일까요?',
    input: 'text',
  }),
  Q({
    no: 12,
    category: '시장동향',
    difficulty: 3,
    prompt:
      '국내 개인 주식투자자는 2019년 614만 명에서 2025년 1,442만 명으로 늘었습니다. 이 기간의 연평균 성장률이 앞으로도 그대로 이어진다면, 개인 주식투자자가 처음으로 2,000만 명을 넘는 해는 언제일까요? 연도로 답해 주세요.',
    keyword: '개인 투자자 2,000만',
    input: 'decimal',
  }),
  Q({
    no: 13,
    category: '전략·성과',
    difficulty: 3,
    prompt:
      '카카오뱅크의 밸류업 목표는 2027년까지 총자산 100조원입니다. 2026년 6월말 총자산은 75.9조원이었습니다. 목표를 달성하려면 남은 기간 동안 자산이 연평균 몇 % 성장해야 할까요? (소수점 첫째자리)',
    keyword: '총자산 100조',
    input: 'decimal',
  }),
  Q({
    no: 14,
    category: '전략·성과',
    difficulty: 3,
    prompt:
      "카카오뱅크는 고객 확장을 위해 미성년자, 외국인, 시니어 등 다양한 고객을 확보하기 위한 노력을 하고있습니다. 그 중 미성년자 고객을 위해 '25년 9월 우리아이서비스를 출시했는데요, 우리아이 서비스는 출시 1년만에 0세 고객 침투율 xx%를 기록하는 성과를 내었습니다.\n우리아이 서비스의 '26년 9월 기준 0세 고객 침투율은 얼마일까요?",
    keyword: '우리아이 0세 침투율',
    input: 'decimal',
  }),
  Q({
    no: 15,
    category: '전략·성과',
    difficulty: 3,
    prompt:
      '2025년 말 우리 수신 잔액은 68.3조 원, 2025년 연간 당기순이익은 4,803억 원입니다. 수신 전체의 평균 조달금리가 0.1%p 낮아진다면, 1년 동안 줄어드는 이자비용은 당기순이익의 몇 퍼센트에 해당할까요? 소수 첫째 자리까지 답해 주세요.',
    keyword: '조달금리 0.1%p',
    input: 'decimal',
  }),
  Q({
    no: 16,
    category: '전략·성과',
    difficulty: 3,
    prompt:
      '우리 외국인 서비스의 2027년 목표는 40만 명입니다. 이 목표는 2025년 말 국내 장기체류 외국인의 몇 퍼센트에 해당할까요? 장기체류 외국인 수는 법무부 통계에서 직접 찾으셔야 합니다. 소수 첫째 자리까지 답해 주세요.',
    keyword: '외국인 40만',
    input: 'decimal',
  }),
  Q({
    no: 17,
    category: '규제',
    difficulty: 4,
    prompt:
      '인터넷전문은행 특례법 조문 번호 문제입니다. 세 가지를 차례로 말씀드립니다.\n첫째, 비금융주력자, 즉 ICT 기업 등의 지분 보유 한도 34%.\n둘째, 법인에 대한 신용공여 금지와 중소기업 예외.\n셋째, 비대면 원칙의 예외, 곧 이용자 보호 등을 위해 대면 영업을 허용하는 규정.\n이 세 가지는 각각 제 몇 조일까요? 숫자 세 개를 순서대로 답해 주세요.',
    keyword: '인터넷은행 특례법',
    input: 'text',
  }),
  Q({
    no: 18,
    category: '시장동향',
    difficulty: 4,
    prompt:
      '인터넷전문은행 3사, 카카오뱅크·케이뱅크·토스뱅크의 2025년 연간 당기순이익을 찾아 보세요. 순이익 순위로 2위와 3위 사이의 격차는 몇 억 원일까요? 억 원 단위로 답해 주세요.',
    keyword: '인뱅 3사 순이익',
    input: 'decimal',
  }),
  Q({
    no: 19,
    category: '전략·성과',
    difficulty: 4,
    prompt:
      '윤호영 대표는 2026년 4월 전략 발표에서 "AI라는 엔진과 글로벌이라는 날개"라고 표현했습니다. 현재 카카오뱅크가 진출·제휴한 해외 3개국을 모두 쓰고, 각각의 현지 파트너(또는 법인명)를 함께 적으세요.',
    keyword: '글로벌 3개국',
    input: 'text',
    durationSec: 120,
  }),
  Q({
    no: 20,
    category: 'AI활용',
    difficulty: 4,
    prompt:
      '스트레스 DSR 3단계 기준으로 수도권·규제지역 주택담보대출에 적용되는 스트레스 금리 하한을 쓰고, 아래 차주의 대출한도가 스트레스 금리 적용 전후로 얼마나 줄어드는지 계산하세요. (풀이 과정 포함)\n연소득 1억원 / 실제 금리 4% / 만기 30년 / 원리금균등분할 / DSR 한도 40% / 다른 대출 없음',
    keyword: '스트레스 DSR',
    input: 'text',
    durationSec: 150,
  }),
  Q({
    no: 21,
    category: '전략·성과',
    difficulty: 5,
    prompt:
      "인터넷전문은행 3사의 당기순이익을 모두 합친 것 가운데 카카오뱅크가 차지하는 비중을 생각해 보겠습니다. 이 비중은 2024년에서 2025년으로 가면서 올랐을까요, 내렸을까요? 그리고 몇 %p 움직였을까요? '올랐다' 또는 '내렸다'에 숫자를 붙여, 소수 첫째 자리까지 답해 주세요.",
    keyword: '3사 순이익 비중',
    input: 'text',
    durationSec: 120,
  }),
  Q({
    no: 22,
    category: '전략·성과',
    difficulty: 5,
    prompt:
      '우리 F&P, 곧 수수료·플랫폼 수익은 2025년 3,105억 원이었고, 2027년 목표는 4,465억 원입니다. 이 목표를 맞추려면 앞으로 2년 동안 연평균 몇 퍼센트씩 성장해야 할까요? 정수로 답해 주세요.',
    keyword: 'F&P 목표',
    input: 'decimal',
    durationSec: 120,
  }),
];

/** 상품이 걸린 본 문제 수 (연습 제외) */
export const QUIZ_MAIN_COUNT = QUIZ_QUESTIONS.filter((q) => !q.practice).length;

export const DEFAULT_DURATION_SEC = 90;

export function questionLabel(index: number): string {
  const q = QUIZ_QUESTIONS[index];
  if (!q) return '';
  return q.practice ? '연습' : `Q${q.no} / ${QUIZ_MAIN_COUNT}`;
}

export function stars(n: number): string {
  const k = Math.max(0, Math.min(5, Math.round(n)));
  return '★'.repeat(k) + '☆'.repeat(5 - k);
}
