// 시드 데이터 — BRIEF §9 (카드 46장). 칸/축 정의는 lib/design.ts 참조.

import type { AxisKey, PlaceKey } from './types';

export interface SeedCard {
  id: number;
  text: string;
  axis: AxisKey | null;
  axis2?: AxisKey;
  expected: PlaceKey;
  expected2?: PlaceKey;
  source: string;
}

export const SEED_CARDS: SeedCard[] = [
  { id: 1, text: '산 트래픽', axis: 'T', expected: 'elephant', source: 'v2.1' },
  { id: 2, text: '잔존 없는 유입', axis: 'T', expected: 'elephant', source: 'v2.1' },
  { id: 3, text: '바뀌는 유입 엔진', axis: 'T', expected: 'deadfish', source: 'v2.1' },
  { id: 4, text: '예적금은 뒷전', axis: 'D', expected: 'elephant', source: 'v2.1' },
  { id: 5, text: '파킹 쏠림', axis: 'D', expected: 'elephant', source: 'v2.1' },
  { id: 6, text: '머무는 시간 부재', axis: 'D', expected: 'elephant', source: 'v2.1' },
  { id: 7, text: '밖으로 나가는 돈', axis: 'D', expected: 'vomit', source: 'v2.1' },
  { id: 8, text: '전환은 남의 일', axis: 'C', expected: 'elephant', source: 'v2.1' },
  { id: 9, text: '다음 행동 미설계', axis: 'C', expected: 'elephant', source: 'v2.1' },
  { id: 10, text: '마케팅과 끊긴 설계', axis: 'C', expected: 'deadfish', source: 'v2.1' },
  { id: 11, text: '짐작으로 만든 기능', axis: 'C', expected: 'deadfish', source: 'v2.1' },
  { id: 12, text: '지표 따로 내 일 따로', axis: 'W', expected: 'elephant', source: 'v2.1' },
  { id: 13, text: '결재 대기 3주', axis: 'W', expected: 'deadfish', source: 'v2.1' },
  { id: 14, text: '회의로 끝나는 결론', axis: 'W', expected: 'deadfish', source: 'v2.1' },
  { id: 15, text: '문서 먼저, 실험 나중', axis: 'W', expected: 'deadfish', source: 'v2.1' },
  { id: 16, text: '실패 복기 없음', axis: 'W', expected: 'elephant', source: 'v2.1' },
  { id: 17, text: 'AI홈 첫 화면', axis: 'AI-S', expected: 'elephant', source: 'v2.1' },
  { id: 18, text: '플로팅 버튼', axis: 'AI-S', expected: 'deadfish', source: 'v2.1' },
  { id: 19, text: '체감 없는 AI 기능', axis: 'AI-S', expected: 'elephant', source: 'v2.1' },
  { id: 20, text: '툴만 있고 룰 없음', axis: 'AI-W', expected: 'deadfish', source: 'v2.1' },
  { id: 21, text: 'AI 쓸 시간 부족', axis: 'AI-W', expected: 'vomit', source: 'v2.1' },
  { id: 22, text: '사내 데이터 접근 벽', axis: 'AI-W', expected: 'elephant', source: 'v2.1' },
  { id: 23, text: '자체 모델 투자 논쟁', axis: 'AI-I', expected: 'elephant', source: 'v2.1' },
  { id: 24, text: '데이터 결합 지연', axis: 'AI-I', expected: 'elephant', source: 'v2.1' },
  { id: 25, text: '마이데이터 대기', axis: 'AI-I', axis2: 'R', expected: 'vomit', source: 'v2.1' },
  { id: 26, text: '합의 안 된 목표', axis: 'ORG', expected: 'elephant', source: 'v2.1' },
  { id: 27, text: '그룹 간 벽', axis: 'ORG', expected: 'elephant', expected2: 'deadfish', source: 'v2.1+윌' },
  { id: 28, text: '평가와 도전의 충돌', axis: 'ORG', expected: 'elephant', source: 'v2.1' },
  { id: 29, text: '24시간 고객센터', axis: null, expected: 'bluebird', source: 'v2.1' },
  { id: 30, text: '빠른 출시 감각', axis: null, expected: 'bluebird', source: 'v2.1' },
  { id: 31, text: '쉬운 화면 원칙', axis: null, expected: 'bluebird', source: 'v2.1' },
  { id: 32, text: '장애 없는 운영', axis: null, expected: 'bluebird', source: 'v2.1' },
  { id: 33, text: '세이프박스 확장', axis: 'D', expected: 'sprout', source: 'v2.1' },
  { id: 34, text: '미니 세대 전환', axis: 'T', expected: 'sprout', source: 'v2.1' },
  { id: 35, text: '데이터 기반 심사', axis: 'AI-I', expected: 'sprout', source: 'v2.1' },
  { id: 36, text: 'AI 상담 자동화', axis: 'AI-W', expected: 'sprout', source: 'v2.1' },
  { id: 37, text: '무늬만 애자일', axis: 'W', expected: 'elephant', source: '윌' },
  { id: 38, text: '답정너 기획', axis: 'W', expected: 'elephant', source: '윌' },
  { id: 39, text: '규제 핑계 안전제일', axis: 'R', axis2: 'W', expected: 'elephant', source: '윌' },
  { id: 40, text: '실패가 두려운 기획', axis: 'W', expected: 'elephant', source: '윌' },
  { id: 41, text: '책임 떠넘기기', axis: 'ORG', expected: 'deadfish', source: '윌' },
  { id: 42, text: '과거 장애의 그림자', axis: 'W', expected: 'deadfish', source: '윌' },
  { id: 43, text: '보고서가 일의 절반', axis: 'W', expected: 'vomit', source: '윌' },
  { id: 44, text: '보고 위의 보고', axis: 'W', expected: 'vomit', source: '윌' },
  { id: 45, text: '위아래 사이 번아웃', axis: 'ORG', expected: 'vomit', source: '윌' },
  { id: 46, text: '실무진 이탈', axis: 'ORG', expected: 'vomit', source: '윌' },
];
