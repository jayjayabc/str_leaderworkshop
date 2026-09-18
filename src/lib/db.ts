// 영속·실시간 어댑터 단일 진입점.
//  - Supabase 환경변수가 둘 다 있으면 Supabase 어댑터, 없으면 로컬(localStorage + BroadcastChannel) 어댑터.
//  - UI는 이 파일의 `db`와 `dbMode`만 본다.

import { createLocalAdapter } from './db.local';
import { createSupabaseAdapter } from './db.supabase';
import type {
  AxisKey,
  Board,
  BoardEvent,
  BoardSnapshot,
  EventType,
  Keyword,
  Participant,
  PlaceKey,
  PresenceState,
  Phase,
} from './types';

export type DbMode = 'supabase' | 'local';

export interface CreateBoardInput {
  title: string;
  /**
   * 원하는 slug(예: 조 보드의 't07'). 비우면 임의 slug가 생긴다.
   * 이미 그 slug의 보드가 있으면 어댑터는 새로 만들지 않고 기존 보드를 돌려준다.
   */
  slug?: string;
}

export interface CreateBoardResult {
  board: Board;
  hostToken: string;
}

export interface PlacementInput {
  keyword_id: string;
  zone: PlaceKey;
  sort_order: number;
  placed_by: string | null;
  placed_by_name: string | null;
}

export interface CreateKeywordInput {
  text: string;
  axis?: AxisKey | null;
  axis2?: AxisKey | null;
  expected?: PlaceKey | null;
  expected2?: PlaceKey | null;
  source?: string | null;
  created_by?: string | null;
  created_by_name?: string | null;
  is_seed?: boolean;
}

export interface AddNoteInput {
  keyword_id: string;
  author_id: string | null;
  author_name: string | null;
  text: string;
}

export type BoardFlags = Partial<
  Pick<Board, 'phase' | 'locked' | 'hide_vomit' | 'show_axis' | 'title'> & { settings: Record<string, unknown> }
>;

export interface AppendEventInput {
  actor_id: string | null;
  actor_name: string | null;
  type: EventType;
  payload: Record<string, unknown>;
}

export interface VoteInput {
  keyword_id: string;
  participant_id: string;
}

export interface PresenceAdapter {
  /** 보드 채널에 입장(재호출 시 갱신) */
  join(slug: string, participant: Participant): Promise<void>;
  /** 퇴장 */
  leave(): Promise<void>;
  /** 온라인 목록 구독. 반환값을 호출하면 구독 해제 */
  onPresence(cb: (list: PresenceState[]) => void): () => void;
  /** 드래그 중인 카드 알림(끝나면 null) */
  broadcastDragging(keywordId: string | null): void;
}

/**
 * 보드 어댑터. 이후 단계(투표·단계전환·Undo)는 아래 메서드를 그대로 쓰거나
 * 선택 메서드(undoLast)를 구현하는 식으로 확장한다.
 */
export interface BoardAdapter {
  readonly mode: DbMode;

  createBoard(input: CreateBoardInput): Promise<CreateBoardResult>;
  loadBoard(slug: string): Promise<BoardSnapshot | null>;
  /** 보드 전체 스냅샷 변경 구독. 반환값을 호출하면 구독 해제 */
  subscribe(slug: string, onChange: (snapshot: BoardSnapshot) => void): () => void;

  upsertPlacement(slug: string, input: PlacementInput): Promise<void>;
  /** 칸 내부 순서 재정렬 등 다건 갱신 */
  upsertPlacements(slug: string, inputs: PlacementInput[]): Promise<void>;

  createKeyword(slug: string, input: CreateKeywordInput): Promise<Keyword>;
  deleteKeyword(slug: string, keywordId: string): Promise<void>;

  addNote(slug: string, input: AddNoteInput): Promise<void>;

  setBoardFlags(slug: string, flags: BoardFlags): Promise<void>;

  appendEvent(slug: string, input: AppendEventInput): Promise<BoardEvent | null>;

  /** 7단계(투표)에서 사용 */
  addVote(slug: string, input: VoteInput): Promise<void>;
  removeVote(slug: string, input: VoteInput): Promise<void>;

  /**
   * 전체 초기화 — 배치를 모두 풀로 되돌리고 투표·메모·참가자 생성 카드를 지운다.
   * 시드 카드와 이벤트 로그는 남긴다. (호스트 전용, 앱에서 2단계 확인)
   */
  resetBoard(slug: string): Promise<void>;

  presence: PresenceAdapter;
}

export const DEFAULT_PHASE: Phase = 'placing';

let cached: BoardAdapter | null = null;

function hasSupabaseEnv(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}

export function getDb(): BoardAdapter {
  if (cached) return cached;
  cached = hasSupabaseEnv() ? createSupabaseAdapter() : createLocalAdapter();
  return cached;
}

export const dbMode: DbMode = hasSupabaseEnv() ? 'supabase' : 'local';

export const MODE_BADGE: Record<DbMode, { label: string; short: string; title: string }> = {
  supabase: {
    label: '실시간',
    short: '실시간',
    title: 'Supabase Realtime으로 모든 참가자와 동기화됩니다',
  },
  local: {
    label: '로컬 모드 · 같은 브라우저 탭끼리만 동기화',
    short: '로컬 모드',
    title:
      'Supabase 환경변수가 없어 localStorage + BroadcastChannel로 동작합니다 — 같은 브라우저 탭끼리만 동기화됩니다',
  },
};
