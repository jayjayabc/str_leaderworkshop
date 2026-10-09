// 스피드 퀴즈 — 공개 문항 (Quiz v2.0 · 단체전)
//
// ⚠ 이 파일에는 정답을 넣지 않는다. 참가자·송출·운영자 화면이 모두 import한다.
//   정답·판정·해설은 quizSeed.ts(서버 전용, /api/quiz/keys)에 있다.
//
// 원본: 팀 Google Sheet 'Final' 시트 (2026-10-08 판) — 본 문제 1~15 + 피버타임 간지(10번 뒤) + 예비 2문항.
//   연습 문제는 시트에 없어 따로 둔다(입장·제출 흐름 확인용, 점수 없음).
//   문장 안의 **…** 는 화면에서 강조 표시된다.

export const QUIZ_SOURCE_NOTE = "Final 시트 (2026-10-08)";

export type QuizCategory = '연습' | '금융 상식' | '카뱅 성과' | '돈의 흐름' | '새로운 목표와 성장' | '피버타임';

/** 답 입력칸 하나 — label은 칸 앞, unit은 칸 뒤에 붙는다 (예: [    ] %) */
export interface QuizField {
  label?: string;
  unit?: string;
  input: 'decimal' | 'text';
  placeholder?: string;
}

export type QuizKind = 'practice' | 'main' | 'interlude' | 'reserve';

export interface QuizQuestionPublic {
  /** 고유 키 — 정답 키(quizSeed)와 짝을 맞춘다 */
  id: string;
  /** 0 = 연습, 1..15 = 시트 순서 (간지·예비는 표시용 번호) */
  no: number;
  /** practice = 연습(점수 없음) · main = 본 문제 · interlude = 피버타임 같은 간지(제출 없음) · reserve = 예비 문제 */
  kind: QuizKind;
  practice: boolean;
  /** 간지 — 문제 대신 안내 화면을 띄운다(열기 없음) */
  interlude?: boolean;
  /** 선착순 기본 규칙 — 운영자가 따로 바꾸지 않으면 이 규칙으로 점수를 준다 */
  defaultSpeed?: { upto: number; mode: 'x' | '+'; v: number }[];
  category: QuizCategory;
  /** 문제 전문 — 줄바꿈 유지 */
  prompt: string;
  /** 객관식 보기 — 있으면 화면에 번호 목록으로 보여 주고 답은 번호로 받는다 */
  choices?: string[];
  /** 답 입력칸 — 보통 1개, 빈칸이 여러 개인 문제는 여러 개 */
  fields: QuizField[];
  /** 문제 이미지 (public/ 아래 경로, 예: /quiz/images/q9.jpg) — 여러 장이면 순서대로 나란히 */
  images?: string[];
  /** 이미지별 설명(송출 화면은 이미지 아래, 휴대폰은 이미지 위 띠) */
  imageCaptions?: string[];
  /** 송출 화면 이미지 배치 — side(문제 옆, 기본) · below(문제 아래 넓게, 가로로 긴 장표용) */
  imageLayout?: 'side' | 'below';
  /** 송출 화면에만 쓰는 짧은 문장 — 이미지가 많아 자리가 모자랄 때 (없으면 prompt) */
  screenPrompt?: string;
  /** '키워드만' 표시 모드의 기본 키워드 */
  keyword: string;
  /** 기본 제한시간(초). 없으면 전체 기본값 */
  durationSec?: number;
  /** 기본 배점 — 운영자 화면에서 문항별로 바꿀 수 있다 */
  points: number;
}

const DEC = (unit?: string, placeholder?: string): QuizField[] => [{ input: 'decimal', unit, placeholder }];
const TXT = (unit?: string, placeholder?: string): QuizField[] => [{ input: 'text', unit, placeholder }];
const CHOICE: QuizField[] = [{ input: 'decimal', unit: '번', placeholder: '번호' }];

type Def = Omit<QuizQuestionPublic, 'keyword' | 'practice' | 'points' | 'kind'> & { keyword?: string; points?: number; kind?: QuizKind };
const Q = (q: Def): QuizQuestionPublic => {
  const kind: QuizKind = q.kind ?? (q.no === 0 ? 'practice' : 'main');
  return {
    ...q,
    kind,
    practice: kind === 'practice',
    interlude: kind === 'interlude',
    keyword: q.keyword ?? q.category,
    points: q.points ?? (kind === 'practice' || kind === 'interlude' ? 0 : 10),
  };
};

/** 피버타임(11~15번) 선착순 — 1등 ×5 · 2~3등 ×3 · 4~5등 ×2 */
export const FEVER_TIERS: { upto: number; mode: 'x' | '+'; v: number }[] = [
  { upto: 1, mode: 'x', v: 5 },
  { upto: 3, mode: 'x', v: 3 },
  { upto: 5, mode: 'x', v: 2 },
];

export const QUIZ_QUESTIONS: QuizQuestionPublic[] = [
  Q({
    id: 'p',
    no: 0,
    category: '연습',
    prompt: '(연습) 카카오뱅크 앱 아이콘의 바탕색은 무슨 색일까요?',
    fields: TXT(undefined, '색'),
    keyword: '연습 문제',
    durationSec: 30,
  }),
  Q({
    id: 'q1',
    no: 1,
    category: '카뱅 성과',
    prompt:
      '대도시광역교통위원회는 기존 K패스 적립 방식에 기후동행카드의 무제한 정기권 개념을 결합한 「모두의 카드」라는 대중교통비 무제한 환급 제도를 운영하고 있습니다.\n다음 중 가장 교통 혜택이 좋은 카드는?',
    choices: ['카카오뱅크 K패스 체크카드', '기후동행카드', '애플페이 티머니 선불카드'],
    fields: CHOICE,
    keyword: '모두의 카드',
    durationSec: 45,
  }),
  Q({
    id: 'q2',
    no: 2,
    category: '금융 상식',
    prompt: '(넌센스) 카카오뱅크 지점은 전국에 몇 개일까요?\n(2026년 9월 30일 기준, 오차범위 ±10%)',
    fields: DEC('만 개', '숫자'),
    keyword: '카뱅 지점',
    durationSec: 60,
  }),
  Q({
    id: 'q3',
    no: 3,
    category: '카뱅 성과',
    prompt:
      '2026년 9월 기준 카카오뱅크의 MAU는 1,880만 명입니다.\n9월 기준 평균 DAU는 정확하게 얼마일까요?\n(BI 포털 기준, 만 명 단위, 오차범위 ±0%)',
    fields: DEC('만 명'),
    keyword: 'DAU',
    durationSec: 60,
  }),
  Q({
    id: 'q4',
    no: 4,
    category: '금융 상식',
    prompt: '2026년 한국은행은 기준금리를 두 차례 인상했습니다.\n현재 기준금리는 얼마일까요? (X.XX%)',
    fields: DEC('%', '0.00'),
    keyword: '기준금리',
    durationSec: 60,
  }),
  Q({
    id: 'q5',
    no: 5,
    category: '카뱅 성과',
    prompt:
      "카카오뱅크는 미성년자 고객 확대를 위해 '25년 9월 우리아이서비스를 출시했습니다.\n출시 1년 만에 달성한 0세 고객 침투율은 얼마일까요?",
    choices: ['10%', '11%', '12%', '13%'],
    fields: CHOICE,
    keyword: '0세 침투율',
    durationSec: 45,
  }),
  Q({
    id: 'q6',
    no: 6,
    category: '카뱅 성과',
    prompt:
      '올해 카카오뱅크는 창립 이후 첫 M&A를 통해 자동차 할부·리스 등 비은행 여신과 기업대출 영역으로 사업을 확장하고, 조달 경쟁력을 활용한 재무 시너지를 만들 계획입니다.\n카카오뱅크가 인수한 이 회사는 어디일까요?',
    fields: TXT(undefined, '회사 이름'),
    keyword: '첫 M&A',
    durationSec: 60,
  }),
  Q({
    id: 'q7',
    no: 7,
    category: '금융 상식',
    prompt:
      '낮은 금리 등의 이유로 자금이 손실 위험이 없는 안전 자산에서 투자를 목적으로 하는 주식, 채권 등으로 이동하는 현상은 무엇일까요?',
    fields: TXT(),
    keyword: '자금 이동',
    durationSec: 60,
  }),
  Q({
    id: 'q8',
    no: 8,
    category: '돈의 흐름',
    prompt:
      '2025년 말 기준 세 가지 돈의 흐름에서 카카오뱅크 M/S가 높은 순서는?\nA. 돈 보내기·받기 (이체/대출)\nB. 돈 쓰기 (결제)\nC. 돈 모으기 (투자)',
    choices: ['A > C > B', 'A > B > C', 'B > A > C', 'C > B > A'],
    fields: CHOICE,
    images: ['/quiz/images/q9.jpg'],
    keyword: '돈의 흐름 M/S',
    durationSec: 45,
  }),
  Q({
    id: 'q9',
    no: 9,
    category: '돈의 흐름',
    prompt: "다음은 국내외 금융 앱과 그 앱의 AI 서비스 화면입니다. 각 빈칸을 채우세요. (부분 점수 없음)\n① Revolut의 '____'\n② ____의 'Finances'\n③ 토스증권의 'AI ____'",
    fields: [
      { label: "① Revolut의 '____'", input: 'text' },
      { label: "② ____의 'Finances'", input: 'text' },
      { label: "③ 토스증권의 'AI ____'", input: 'text' },
    ],
    images: ['/quiz/images/q10-1.jpg', '/quiz/images/q10-2.jpg', '/quiz/images/q10-3.jpg'],
    imageCaptions: ["① Revolut의 '____'", "② ____의 'Finances'", "③ 토스증권의 'AI ____'"],
    screenPrompt: '다음은 국내외 금융 앱과 그 앱의 AI 서비스 화면입니다. 각 빈칸을 채우세요. (부분 점수 없음)',
    keyword: '금융 앱 AI',
    durationSec: 90,
  }),
  Q({
    id: 'q10',
    no: 10,
    category: '새로운 목표와 성장',
    prompt:
      '우리 외국인 서비스의 2027년 목표는 40만 명입니다.\n이 목표는 2025년 말 국내 **장기체류 외국인**의 몇 %에 해당할까요? (출처: 법무부 통계)',
    choices: ['8.5%', '15.5%', '18.5%', '20.5%'],
    fields: CHOICE,
    keyword: '외국인 40만',
    durationSec: 90,
  }),
  Q({
    id: 'fever',
    no: 0,
    kind: 'interlude',
    category: '피버타임',
    prompt: 'FEVER TIME — 11번부터 15번까지는 먼저 맞힐수록 점수가 커집니다.',
    fields: [],
    keyword: 'FEVER TIME',
  }),
  Q({
    id: 'q11',
    no: 11,
    category: '새로운 목표와 성장',
    prompt:
      '윤호영 대표는 2026년 4월 전략 발표에서 "AI라는 엔진과 글로벌이라는 날개"라고 표현했습니다.\n현재 카카오뱅크가 **진출·제휴하거나 진출을 검토 중인** 해외 3개국은? (순서 무관)',
    fields: [
      { label: '①', input: 'text', placeholder: '나라' },
      { label: '②', input: 'text', placeholder: '나라' },
      { label: '③', input: 'text', placeholder: '나라' },
    ],
    keyword: 'AI와 글로벌',
    durationSec: 60,
    defaultSpeed: FEVER_TIERS,
  }),
  Q({
    id: 'q12',
    no: 12,
    category: '금융 상식',
    prompt: '(넌센스) 은행이 달리기를 하면?',
    fields: TXT(undefined, '답'),
    keyword: '은행 달리기',
    durationSec: 45,
    defaultSpeed: FEVER_TIERS,
  }),
  Q({
    id: 'q13',
    no: 13,
    category: '새로운 목표와 성장',
    prompt:
      '2025년 말 카카오뱅크 수신 잔액은 68.3조 원, 2025년 연간 당기순이익은 4,803억 원입니다.\n**고객 전체에게 주는 평균 금리**가 0.1%p 낮아진다면, 1년 동안 줄어드는 이자비용은 당기순이익의 몇 %에 해당할까요?',
    choices: ['11.2%', '12.2%', '13.2%', '14.2%'],
    fields: CHOICE,
    keyword: '금리 0.1%p',
    durationSec: 90,
    defaultSpeed: FEVER_TIERS,
  }),
  Q({
    id: 'q14',
    no: 14,
    category: '금융 상식',
    prompt: '다음 중 AI 모델이 출시된 순서를 가장 오래된 것부터 최신순으로 바르게 나열한 것은?',
    choices: [
      'DeepSeek-R1 > GPT-4 > Llama 5 > Claude 4.6 Opus',
      'GPT-4 > Claude 4.6 Opus > DeepSeek-R1 > Llama 5',
      'GPT-4 > DeepSeek-R1 > Claude 4.6 Opus > Llama 5',
      'GPT-4 > DeepSeek-R1 > Llama 5 > Claude 4.6 Opus',
    ],
    fields: CHOICE,
    keyword: 'AI 모델 출시 순서',
    durationSec: 60,
    defaultSpeed: FEVER_TIERS,
  }),
  Q({
    id: 'q15',
    no: 15,
    category: '새로운 목표와 성장',
    prompt:
      '**카카오뱅크 대화형 AI에게 물어서** 아래 답을 구해 주세요.\nA. 카카오뱅크 입출금통장 기본금리(세전) ____%\nB. 카카오뱅크 줍줍 신용카드 연회비 ____원\nC. 카카오뱅크 mini 26일 저금 최대 동시 개설 개수 ____개',
    fields: [
      { label: 'A. 입출금통장 기본금리(세전)', input: 'decimal', unit: '%' },
      { label: 'B. 줍줍 신용카드 연회비', input: 'decimal', unit: '원' },
      { label: 'C. mini 26일 저금 최대 동시 개설', input: 'decimal', unit: '개' },
    ],
    keyword: '카뱅 AI에게 물어봐',
    durationSec: 150,
    defaultSpeed: FEVER_TIERS,
  }),
  Q({
    id: 'r1',
    no: 1,
    kind: 'reserve',
    category: '새로운 목표와 성장',
    prompt:
      '다음은 2024년에 발표한 카카오뱅크 밸류업 목표입니다. 빈칸에 들어갈 숫자를 모두 더하면 얼마일까요?\n① 고객 수 X천만 명  ② 자산 XXX조 원  ③ F&P 수익 CAGR XX%',
    fields: DEC(undefined, '합계'),
    images: ['/quiz/images/q11.jpg'],
    imageLayout: 'below',
    keyword: '밸류업 목표',
    durationSec: 90,
  }),
  Q({
    id: 'r2',
    no: 2,
    kind: 'reserve',
    category: '금융 상식',
    prompt: '예금자보호 한도가 5천만 원에서 1억 원으로 올랐습니다.\n몇 년 만의 인상일까요? (숫자만 입력)',
    fields: DEC('년'),
    keyword: '예금자보호',
    durationSec: 60,
  }),
];

export const QUIZ_MAIN_COUNT = QUIZ_QUESTIONS.filter((q) => q.kind === 'main').length;

export const DEFAULT_DURATION_SEC = 90;

/** 팀(조) 수 — NEXT_PUBLIC_QUIZ_TEAMS (기본 29) */
export const QUIZ_TEAMS = Math.max(1, Math.min(60, Number(process.env.NEXT_PUBLIC_QUIZ_TEAMS ?? 29) || 29));

/** 짧은 이름 — 'Q11', '예비1', '연습', 'FEVER' */
export function shortLabel(index: number): string {
  const q = QUIZ_QUESTIONS[index];
  if (!q) return '';
  if (q.kind === 'practice') return '연습';
  if (q.kind === 'interlude') return 'FEVER';
  if (q.kind === 'reserve') return `예비${q.no}`;
  return `Q${q.no}`;
}

export function questionLabel(index: number): string {
  const q = QUIZ_QUESTIONS[index];
  if (!q) return '';
  if (q.kind === 'practice') return '연습';
  if (q.kind === 'interlude') return 'FEVER TIME';
  if (q.kind === 'reserve') return `예비 ${q.no}`;
  return `Q${q.no} / ${QUIZ_MAIN_COUNT}`;
}

/** 여러 칸 답을 한 문자열로 — 판정·저장용 구분자 */
export const FIELD_SEP = ' | ';
