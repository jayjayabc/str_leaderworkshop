// 토의보드 시드 (Board v1.0) — 문구는 「리더 토론세션 진행안 v2」 기준. 임의로 바꾸지 말 것.
//   SQL 시드(supabase/board_v1.0_migration.sql)와 같은 값이다. 바꾸면 두 곳을 함께 고친다.

export const BOARD_TOPIC = 'AI와 공존하는 시대';

export const BOARD_TABLES = 29;
export const BOARD_EXEC_TABLES = [8, 13, 14, 18] as const;
export const BOARD_TEAM_COUNT = BOARD_TABLES * 2;

export type BoardItemId = 'Q1-1' | 'Q1-2' | 'Q1-3' | 'Q1-4' | 'Q2-1' | 'Q2-2' | 'Q2-3a' | 'Q2-3b';
/** 한 번에 열리는 단위(항목 그룹). Q2-3a·Q2-3b는 같은 화면이라 'Q2-3' 하나로 열린다 */
export type BoardGroupId = 'Q1-1' | 'Q1-2' | 'Q1-3' | 'Q1-4' | 'Q2-1' | 'Q2-2' | 'Q2-3';

export interface BoardItem {
  id: BoardItemId;
  question: 1 | 2;
  order: number;
  group: BoardGroupId;
  /** 짧은 제목 */
  title: string;
  /** 안내 문장(입력칸 위) */
  prompt: string;
  example: string | null;
  required: boolean;
}

export interface BoardQuestion {
  no: 1 | 2;
  label: string;
  text: string;
  hints: string[];
  /** 질문 ① 생각의 틀 · 질문 ② 아젠다 */
  frame: string[];
  frameLabel: string;
}

export const BOARD_QUESTIONS: Record<1 | 2, BoardQuestion> = {
  1: {
    no: 1,
    label: 'AI for User',
    text:
      'AI 에이전트가 내 금융을 대신 해 주는 시대, 나는 금융을 어떻게 쓰게 될까? 그때도 은행에 남았으면 하는 것과 바뀌었으면 하는 것은? 그래서 카뱅은 무엇을 준비해야 할까?',
    hints: [
      '키노트 사례처럼 에이전트가 내 돈을 움직여 준다면 무엇부터 맡길까',
      '에이전트가 금리를 다 비교해 준다면 그래도 내가 고르는 은행은 어디이고 왜일까',
      '앱을 열지 않아도 된다면 내가 굳이 앱을 여는 순간은 언제일까',
    ],
    frame: ['돈 보내기·받기', '돈 모으기', '돈 쓰기', '돈 관리하기'],
    frameLabel: '돈의 네 영역',
  },
  2: {
    no: 2,
    label: 'AI for Company',
    text: '올해 AI를 써 보며 우리 조직이 부딪힌 문제는 무엇이고, 앞으로 어떻게 일하며, 당장 무엇부터 해 볼까?',
    hints: [
      'AI에 맡겨 봤는데 생각보다 안 된 일은? 데이터·절차·숙련도·도구 중 무엇이 막았나',
      'AI로 빨라진 일 뒤에서 오히려 느려진 일(의사결정·검토)은 없나',
      'AI를 들였는데 여전히 예전 순서대로 하는 일은?',
      '내일 당장 팀에서 바꿀 수 있는 일하는 순서 하나는?',
    ],
    frame: ['막힌 것', '일하는 방식', '당장 할 것'],
    frameLabel: '아젠다',
  },
};

export const BOARD_ITEMS: BoardItem[] = [
  { id: 'Q1-1', question: 1, order: 1, group: 'Q1-1', title: '나의 변화', prompt: 'AI 에이전트 시대에 나는 금융을 이렇게 쓰게 될 것 같다', example: null, required: true },
  { id: 'Q1-2', question: 1, order: 2, group: 'Q1-2', title: '남았으면 하는 것', prompt: '그래도 은행에 남았으면 하는 것', example: null, required: true },
  { id: 'Q1-3', question: 1, order: 3, group: 'Q1-3', title: '바뀌었으면 하는 것', prompt: '바뀌었으면 하는 것', example: null, required: true },
  { id: 'Q1-4', question: 1, order: 4, group: 'Q1-4', title: '카뱅이 준비할 것', prompt: '그래서 카뱅이 내년에 먼저 준비했으면 하는 것', example: null, required: false },
  { id: 'Q2-1', question: 2, order: 5, group: 'Q2-1', title: '막힌 것', prompt: '올해 AI를 써 보니 우리는 ___ 때문에 막혔다(어려웠다)', example: '토큰은 많이 쓰는데 정확하게 쓸 줄 몰라 결과가 안 나왔다', required: true },
  { id: 'Q2-2', question: 2, order: 6, group: 'Q2-2', title: '일하는 방식', prompt: '그래서 앞으로는 ___ 하게 일해야 한다', example: '잘 된 프롬프트·사례를 팀에서 공유하며 일한다', required: true },
  { id: 'Q2-3a', question: 2, order: 7, group: 'Q2-3', title: '당장 할 것', prompt: '당장 ___ 부터 해 보겠다', example: '다음 주 주간보고를 AI 초안으로 만들어 보겠다', required: true },
  { id: 'Q2-3b', question: 2, order: 8, group: 'Q2-3', title: '회사가 지원해 줬으면 하는 것', prompt: '회사가 지원해 줬으면 하는 것: ___', example: '회사는 팀별 도구 가이드를 준비해 달라', required: false },
];

export interface BoardGroup {
  id: BoardGroupId;
  question: 1 | 2;
  title: string;
  items: BoardItem[];
}

export const BOARD_GROUPS: BoardGroup[] = (['Q1-1', 'Q1-2', 'Q1-3', 'Q1-4', 'Q2-1', 'Q2-2', 'Q2-3'] as BoardGroupId[]).map((g) => {
  const items = BOARD_ITEMS.filter((i) => i.group === g);
  return { id: g, question: items[0].question, title: items[0].title, items };
});

export function groupById(id: string | null | undefined): BoardGroup | null {
  return BOARD_GROUPS.find((g) => g.id === id) ?? null;
}

export function itemById(id: string): BoardItem | undefined {
  return BOARD_ITEMS.find((i) => i.id === id);
}

export const BOARD_GROUND_RULES = [
  '현재의 규제·당국 입장·실행 가능성은 잠시 내려놓는다',
  "질문 ①은 '고객인 나'로 상상하고, 결론은 '우리 조직'과 '회사'가 할 일로 답한다",
  '정답은 없다. 의견이 갈리면 둘 다 적어도 된다',
];

export interface BoardTeam {
  id: string; // '12A'
  table_no: number;
  half: 'A' | 'B';
  is_exec: boolean;
}

export const BOARD_TEAMS: BoardTeam[] = Array.from({ length: BOARD_TABLES }, (_, i) => i + 1).flatMap((t) =>
  (['A', 'B'] as const).map((h) => ({
    id: `${t}${h}`,
    table_no: t,
    half: h,
    is_exec: (BOARD_EXEC_TABLES as readonly number[]).includes(t),
  })),
);

/** 본문 최대 글자 수 (서버도 같은 값으로 거부) */
export const BOARD_MAX_LEN = 1000;
