// 코끼리 보드 — 공통 타입 정의

export type ZoneKey = 'elephant' | 'deadfish' | 'vomit' | 'bluebird' | 'sprout';
export type PlaceKey = 'pool' | ZoneKey;
export type Phase = 'placing' | 'voting' | 'review';
export type Role = 'strategy' | 'exec' | 'leader';
export type AxisKey = 'T' | 'D' | 'C' | 'W' | 'R' | 'AI-S' | 'AI-W' | 'AI-I' | 'ORG';

export interface Board {
  id: string;
  slug: string;
  title: string;
  phase: Phase;
  locked: boolean;
  hide_vomit: boolean;
  show_axis: boolean;
  settings: BoardSettings;
  /** Supabase 스키마의 컬럼. 로컬 어댑터는 settings.host_token에 넣는다. */
  host_token?: string | null;
  created_at: string;
}

/** boards.settings(jsonb)에 담기는 값들 */
export interface BoardSettings {
  host_token?: string;
  /** 타이머 종료 시각(ISO). 진행 중일 때만 채워진다. */
  timer_ends_at?: string | null;
  /** 일시정지 상태에서 남은 밀리초 */
  timer_paused_ms?: number | null;
  /** 이번 타이머의 총 길이(밀리초) — 재설정용 */
  timer_total_ms?: number | null;
  [key: string]: unknown;
}

export interface Participant {
  id: string;
  board_id: string;
  nickname: string;
  role: Role;
  color: string;
  last_seen: string;
}

export interface Keyword {
  id: string;
  board_id: string;
  text: string;
  axis: AxisKey | null;
  axis2: AxisKey | null;
  expected: PlaceKey | null;
  expected2: PlaceKey | null;
  source: string | null;
  created_by: string | null;
  created_by_name: string | null;
  created_at: string;
  is_seed: boolean;
}

export interface Placement {
  id: string;
  board_id: string;
  keyword_id: string;
  zone: PlaceKey;
  sort_order: number;
  placed_by: string | null;
  placed_by_name: string | null;
  updated_at: string;
}

export interface Note {
  id: string;
  keyword_id: string;
  author_id: string | null;
  author_name: string | null;
  text: string;
  created_at: string;
}

export interface Vote {
  id: string;
  board_id: string;
  keyword_id: string;
  participant_id: string;
  created_at: string;
}

export type EventType =
  | 'board.create'
  | 'placement.move'
  | 'keyword.create'
  | 'keyword.delete'
  | 'note.add'
  | 'board.flags'
  | 'vote.add'
  | 'vote.remove'
  | 'undo'
  | 'reset';

/** Undo 대상이 되는 이벤트 종류 (호스트 되돌리기, 최근 20건) */
export const UNDOABLE_EVENTS: EventType[] = [
  'placement.move',
  'keyword.create',
  'keyword.delete',
  'vote.add',
  'vote.remove',
];

export interface BoardEvent {
  id: number;
  board_id: string;
  actor_id: string | null;
  actor_name: string | null;
  type: EventType;
  payload: Record<string, unknown>;
  created_at: string;
}

/** 어댑터가 주고받는 보드 전체 스냅샷 */
export interface BoardSnapshot {
  board: Board;
  keywords: Keyword[];
  placements: Placement[];
  notes: Note[];
  votes: Vote[];
  events: BoardEvent[];
}

/** 프레즌스(온라인 참가자 + 드래그 중 표시) */
export interface PresenceState {
  participant: Participant;
  dragging: string | null;
  at: number;
}
