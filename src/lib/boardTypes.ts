// 토의보드 타입 (Board v1.0) — supabase/board_v1.0_migration.sql 의 행·함수 반환값과 같은 모양.

import type { BoardGroupId, BoardItemId } from './boardSeed';

export type BoardPhase = 'waiting' | 'q1_intro' | 'item_open' | 'wall' | 'break' | 'q2_intro' | 'ended';

export interface BoardFocus {
  /** 반조 ID */
  team_id: string;
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
}

export interface BoardMe {
  id: string;
  team_id: string;
  name: string;
}

export interface BoardMySubmission {
  item_id: BoardItemId;
  body: string;
  submitted_at: string;
  updated_at: string;
  edited_count: number;
}

export interface BoardMyView {
  participant: BoardMe;
  submissions: BoardMySubmission[];
}

/** 월 카드 (이름 없음, 반조 ID만) */
export interface BoardCard {
  id: string;
  team_id: string;
  item_id: BoardItemId;
  body: string;
  updated_at: string;
  highlighted: boolean;
}

export interface BoardCounts {
  joined: number;
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
  last_seen: string | null;
}

export interface BoardAdminSubmission {
  id: string;
  team_id: string;
  item_id: BoardItemId;
  body: string;
  submitted_at: string;
  updated_at: string;
  edited_count: number;
  hidden: boolean;
  hidden_note: string | null;
  highlighted: boolean;
}

export interface BoardAdminSnapshot {
  state: BoardState;
  server_now: string;
  teams: BoardAdminTeam[];
  submissions: BoardAdminSubmission[];
}

export type BoardModerateAction = 'hide' | 'unhide' | 'highlight' | 'unhighlight';

export type BoardErrorCode =
  | 'BOARD_CLOSED'
  | 'BOARD_DUPLICATE'
  | 'BOARD_UNKNOWN'
  | 'BOARD_EMPTY'
  | 'BOARD_TOO_LONG'
  | 'BOARD_FORBIDDEN'
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
    default:
      return '연결이 불안정해요. 잠시 후 다시 보내 주세요.';
  }
}

export const BOARD_STATE_POLL_MS = 3000;
