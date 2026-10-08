// 토의보드 타입 (Board v1.1) — supabase/board_v1.0_migration.sql · board_v1.1_migration.sql 의 행·함수 반환값과 같은 모양.

import type { BoardGroupId, BoardItemId } from './boardSeed';

export type BoardPhase = 'waiting' | 'q1_intro' | 'item_open' | 'wall' | 'break' | 'q2_intro' | 'ended';

export interface BoardFocus {
  /** 불투명 카드 키 (반조 ID가 아니다 — board_state 는 anon 이 읽으므로 반조 정보를 싣지 않는다) */
  card: string;
  group: BoardGroupId;
  items: { item_id: BoardItemId; body: string }[];
}

export interface BoardState {
  phase: BoardPhase;
  question: 1 | 2 | null;
  current_item: BoardGroupId | null;
  item_open: boolean;
  opened_groups: BoardGroupId[];
  wall_public: boolean;
  allow_edit: boolean;
  timer_ends_at: string | null;
  screen_theme: 'dark' | 'light';
  sound_on: boolean;
  scroll_speed: number;
  focus: BoardFocus | null;
  /** 항목이 열린 시각 — 운영자 "열린 지 n분" 참고용 */
  item_opened_at: string | null;
  /** 투표 대상 그룹 (기본: Q2-3만) */
  vote_items: BoardGroupId[];
  /** 투표 받는 중 */
  vote_open: boolean;
  /** 순위 공개 */
  vote_reveal: boolean;
  updated_at: string;
}

export const EMPTY_BOARD_STATE: BoardState = {
  phase: 'waiting',
  question: null,
  current_item: null,
  item_open: false,
  opened_groups: [],
  wall_public: false,
  allow_edit: true,
  timer_ends_at: null,
  screen_theme: 'dark',
  sound_on: false,
  scroll_speed: 40,
  focus: null,
  item_opened_at: null,
  vote_items: ['Q2-3'],
  vote_open: false,
  vote_reveal: false,
  updated_at: '',
};

/** 운영자가 보낼 수 있는 상태 변경 (board_set_state 의 허용 키) */
export interface BoardStatePatch {
  phase?: BoardPhase;
  current_item?: BoardGroupId | null;
  item_open?: boolean;
  wall_public?: boolean;
  allow_edit?: boolean;
  screen_theme?: 'dark' | 'light';
  sound_on?: boolean;
  scroll_speed?: number;
  focus?: BoardFocus | null;
  /** 0이면 타이머 해제 */
  timer_minutes?: number;
  timer_extend_sec?: number;
  vote_items?: BoardGroupId[];
  vote_open?: boolean;
  vote_reveal?: boolean;
}

export type BoardRole = 'recorder' | 'viewer';

export interface BoardMe {
  id: string;
  team_id: string;
  name: string;
  role: BoardRole;
}

export interface BoardMySubmission {
  item_id: BoardItemId;
  body: string;
  submitted_at: string;
  updated_at: string;
  edited_count: number;
  /** 우리 반조 카드 키 — 투표 화면에서 '우리 반조' 카드를 알아보는 용도 */
  card: string;
}

export interface BoardMyView {
  participant: BoardMe;
  submissions: BoardMySubmission[];
}

/** 모아보기 카드 (이름도 반조 ID도 없다 — 불투명 card 키만. 같은 반조의 같은 그룹 카드는 같은 card) */
export interface BoardCard {
  id: string;
  card: string;
  item_id: BoardItemId;
  body: string;
  updated_at: string;
  highlighted: boolean;
}

export interface BoardCounts {
  /** 기록자가 입장한 반조 수 */
  joined: number;
  /** 관전자 기기 수 */
  viewers: number;
  /** 지금 그룹에 투표한 기기 수 */
  voters: number;
  submitted: number;
  by_group: Partial<Record<BoardGroupId, number>>;
}

export interface BoardAdminTeam {
  id: string;
  table_no: number;
  half: 'A' | 'B';
  is_exec: boolean;
  expected_size: number;
  devices: number;
  recorders: number;
  viewers: number;
  last_seen: string | null;
}

export interface BoardAdminSubmission {
  id: string;
  team_id: string;
  card: string;
  item_id: BoardItemId;
  body: string;
  submitted_at: string;
  updated_at: string;
  edited_count: number;
  hidden: boolean;
  hidden_note: string | null;
  highlighted: boolean;
}

export interface BoardVoteRow {
  group_key: BoardGroupId;
  team_id: string;
  votes: number;
}

export interface BoardAdminSnapshot {
  state: BoardState;
  server_now: string;
  teams: BoardAdminTeam[];
  submissions: BoardAdminSubmission[];
  /** 그룹·반조별 득표 (운영자에게만 반조 ID를 준다) */
  votes: BoardVoteRow[];
  /** 지금 그룹에 투표한 기기 수 */
  voters: number;
}

/** 내 표 — card 목록과 남은 표 */
export interface BoardMyVotes {
  my: string[];
  left: number;
}

/** 순위 한 줄 (team_id 없음) */
export interface BoardRankRow {
  card: string;
  votes: number;
  parts: { item_id: BoardItemId; body: string }[];
}

/** 그룹당 1인 최대 표 수 (서버도 같은 값으로 거부) */
export const BOARD_MAX_VOTES = 3;

export type BoardModerateAction = 'hide' | 'unhide' | 'highlight' | 'unhighlight';

export type BoardErrorCode =
  | 'BOARD_CLOSED'
  | 'BOARD_DUPLICATE'
  | 'BOARD_UNKNOWN'
  | 'BOARD_EMPTY'
  | 'BOARD_TOO_LONG'
  | 'BOARD_FORBIDDEN'
  | 'BOARD_NOT_RECORDER'
  | 'BOARD_OWN_CARD'
  | 'BOARD_VOTE_LIMIT'
  | 'BOARD_FULL'
  | 'BOARD_NETWORK';

export class BoardError extends Error {
  constructor(
    readonly code: BoardErrorCode,
    detail?: string,
  ) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'BoardError';
  }
}

export function boardErrorText(err: unknown): string {
  const code = err instanceof BoardError ? err.code : 'BOARD_NETWORK';
  switch (code) {
    case 'BOARD_CLOSED':
      return '이 항목은 지금 닫혀 있어요.';
    case 'BOARD_DUPLICATE':
      return '우리 반조는 이미 제출했어요. (지금은 수정이 막혀 있어요)';
    case 'BOARD_UNKNOWN':
      return '입장 정보가 없어요. 다시 입장해 주세요.';
    case 'BOARD_EMPTY':
      return '필수 칸을 채워 주세요.';
    case 'BOARD_TOO_LONG':
      return '1,000자 이내로 줄여 주세요.';
    case 'BOARD_FORBIDDEN':
      return '권한이 없어요.';
    case 'BOARD_NOT_RECORDER':
      return '관전자는 답을 낼 수 없어요. 기록자로 다시 입장해 주세요.';
    case 'BOARD_OWN_CARD':
      return '우리 반조 카드에는 투표할 수 없어요.';
    case 'BOARD_VOTE_LIMIT':
      return '3표를 모두 썼어요. 다른 표를 취소하면 다시 쓸 수 있어요.';
    case 'BOARD_FULL':
      return '이 반조에 입장한 기기가 너무 많아요. 진행요원에게 알려 주세요.';
    default:
      return '연결이 불안정해요. 잠시 후 다시 보내 주세요.';
  }
}

export const BOARD_STATE_POLL_MS = 3000;
