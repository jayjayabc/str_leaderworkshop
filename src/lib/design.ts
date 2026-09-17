// 디자인 토큰 — BRIEF §8

import type { AxisKey, PlaceKey, Role, ZoneKey } from './types';

export interface ZoneMeta {
  key: ZoneKey;
  emoji: string;
  name: string;
  tint: string;
  label: string;
  definition: string;
  tone: '부정' | '긍정' | '부정·비공개 가능';
}

export const ZONES: ZoneMeta[] = [
  {
    key: 'elephant',
    emoji: '🐘',
    name: '코끼리',
    tint: '#EEF0F7',
    label: '#3D4A7A',
    definition:
      '모두가 알지만 눈치가 보이거나 긁어 부스럼이 될까 봐 회의실에서 아무도 말하지 않는 본질적 문제',
    tone: '부정',
  },
  {
    key: 'deadfish',
    emoji: '🐟',
    name: '죽은 물고기',
    tint: '#E9F1F3',
    label: '#2F6F7E',
    definition:
      '이미 지나간 일(실패·결정·앙금)인데 썩은 냄새를 풍기며 지금의 협업과 사업 추진을 방해하는 것',
    tone: '부정',
  },
  {
    key: 'vomit',
    emoji: '🤮',
    name: '토하기',
    tint: '#F8F0E6',
    label: '#9A5B1E',
    definition:
      '해결책을 바라는 게 아니라, 리더로서 지금 얼마나 지치고 압박받는지 쏟아내는 감정 환기',
    tone: '부정·비공개 가능',
  },
  {
    key: 'bluebird',
    emoji: '🐦',
    name: '파랑새',
    tint: '#E8F2FC',
    label: '#2B6CB0',
    definition: '우리를 여기까지 오게 한 것 — 잃으면 안 되는 것',
    tone: '긍정',
  },
  {
    key: 'sprout',
    emoji: '🌱',
    name: '새싹',
    tint: '#EAF5EA',
    label: '#2F7A3E',
    definition: '아직 작지만 내년에 더 키우면 성과가 될 시도',
    tone: '긍정',
  },
];

export const ZONE_MAP: Record<ZoneKey, ZoneMeta> = ZONES.reduce(
  (acc, z) => ({ ...acc, [z.key]: z }),
  {} as Record<ZoneKey, ZoneMeta>,
);

/** 좌측 열 = 부정 3칸, 우측 열 = 긍정 2칸 (§5 와이어) */
export const LEFT_COLUMN: ZoneKey[] = ['elephant', 'deadfish', 'vomit'];
export const RIGHT_COLUMN: ZoneKey[] = ['bluebird', 'sprout'];

export function placeLabel(key: PlaceKey): string {
  if (key === 'pool') return '풀';
  return ZONE_MAP[key].name;
}

export function placeEmoji(key: PlaceKey): string {
  if (key === 'pool') return '📥';
  return ZONE_MAP[key].emoji;
}

export interface AxisMeta {
  key: AxisKey;
  name: string;
  meaning: string;
  color: string;
}

export const AXES: AxisMeta[] = [
  { key: 'T', name: '트래픽', meaning: '산 트래픽이 잔존하지 않고 메우는 엔진이 계속 바뀜', color: '#C2703D' },
  { key: 'D', name: '수신', meaning: '파킹 쏠림, 돈이 머무는 시간 감소', color: '#3E7C8C' },
  { key: 'C', name: '전환', meaning: '트래픽→상품 전환의 설계 부재', color: '#7A5BA6' },
  { key: 'W', name: '일하는 방식', meaning: '지표와 내 과제의 연결 부재, 의사결정·보고 절차', color: '#4A6FA5' },
  { key: 'R', name: '규제·외부 제약', meaning: '우리가 바꿀 수 없는 것 (여신 규제·금소법·심의)', color: '#8A8A5C' },
  { key: 'AI-S', name: 'AI 서비스', meaning: '고객 접점의 AI (AI홈·플로팅)', color: '#2F8F6E' },
  { key: 'AI-W', name: 'AI 일하는 방식', meaning: '툴·프로세스', color: '#B07A2E' },
  { key: 'AI-I', name: 'AI 투자·인프라', meaning: '자체 모델·데이터 결합', color: '#A05070' },
  { key: 'ORG', name: '조직·의사결정', meaning: '목표 합의·리소스·사일로·평가', color: '#5E6B7A' },
];

export const AXIS_MAP: Record<AxisKey, AxisMeta> = AXES.reduce(
  (acc, a) => ({ ...acc, [a.key]: a }),
  {} as Record<AxisKey, AxisMeta>,
);

/** 참가자 색 8종 — 채도 낮은 파스텔 */
export const PARTICIPANT_COLORS = [
  '#8FA6C4',
  '#9BBFA4',
  '#D2A9A0',
  '#B5A8CC',
  '#C9BE8E',
  '#8CB8BE',
  '#D0A5BF',
  '#A8B394',
] as const;

export function pickColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return PARTICIPANT_COLORS[h % PARTICIPANT_COLORS.length];
}

export const ROLE_LABEL: Record<Role, string> = {
  strategy: '전략팀',
  exec: '임원',
  leader: '리더',
};

export const ROLES: Role[] = ['strategy', 'exec', 'leader'];

export function initials(nickname: string): string {
  const t = nickname.trim();
  if (!t) return '?';
  return t.slice(0, 2);
}

/** 카드 칩 문구 최대 12자 */
export function clipText(text: string, max = 12): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

// ─── 한국어 조사 ─────────────────────────────────────────────
// 마지막 글자의 받침 유무로 조사를 고른다. 한글이 아니면 받침 없음으로 본다.

function finalConsonant(word: string): number | null {
  const ch = word.trim().slice(-1);
  if (!ch) return null;
  const code = ch.charCodeAt(0);
  if (code < 0xac00 || code > 0xd7a3) return null; // 한글 음절이 아님
  return (code - 0xac00) % 28; // 0 = 받침 없음
}

/** 목적격 조사 — 받침 있으면 '을', 없으면 '를' */
export function objectParticle(word: string): string {
  const jong = finalConsonant(word);
  return jong === null ? '를' : jong === 0 ? '를' : '을';
}

/** 방향 조사 — 받침 있으면 '으로', 없거나 받침이 ㄹ이면 '로' */
export function directionParticle(word: string): string {
  const jong = finalConsonant(word);
  if (jong === null || jong === 0 || jong === 8) return '로'; // 8 = ㄹ
  return '으로';
}
