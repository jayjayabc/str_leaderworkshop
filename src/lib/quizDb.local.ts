// 스피드 퀴즈 로컬 어댑터 (Quiz v1.0) — 환경변수 없이 한 브라우저 안에서 전체 흐름을 시연한다.
//   저장: localStorage['eb:quiz:v1'] (상태·참가자·제출·수상자 전부)
//   동기화: BroadcastChannel('eb:quiz') + storage 이벤트 + 3초 폴링
//   서버 시각 = 이 브라우저의 Date.now() (탭끼리 같은 시계라 시차 0)
//
// 규칙은 supabase/quiz_schema.sql의 함수와 똑같이 맞췄다(제출 마감 +2초, 1인 1회 수상, 중복 제출 거부 …).

import { OPERATOR_KEY } from './admin';
import type { QuizAdapter, QuizCounts } from './quizDb';
import {
  EMPTY_QUIZ_STATE,
  STATE_POLL_MS,
  QuizError,
  SUBMIT_GRACE_MS,
  type QuizAdminSnapshot,
  type QuizControlAction,
  type QuizMySubmission,
  type QuizParticipant,
  type QuizState,
  type QuizSubmission,
  type QuizWinner,
} from './quizTypes';

const KEY = 'eb:quiz:v1';
const CHANNEL = 'eb:quiz';

interface LocalDb {
  state: QuizState;
  participants: QuizParticipant[];
  submissions: QuizSubmission[];
  winners: QuizWinner[];
}

function uid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `id-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
}

function empty(): LocalDb {
  return {
    state: { ...EMPTY_QUIZ_STATE, updated_at: new Date().toISOString() },
    participants: [],
    submissions: [],
    winners: [],
  };
}

function read(): LocalDb {
  if (typeof window === 'undefined') return empty();
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return empty();
    const db = JSON.parse(raw) as LocalDb;
    db.state = { ...EMPTY_QUIZ_STATE, ...db.state };
    return db;
  } catch {
    return empty();
  }
}

function write(db: LocalDb): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(db));
  } catch {
    /* quota 등 무시 */
  }
}

/** updated_at이 이전 값과 같아지지 않도록 단조 증가시킨다(같은 ms 안의 연속 조작) */
function bumpTime(prev: string): string {
  const now = Date.now();
  const before = new Date(prev).getTime();
  return new Date(Math.max(now, before + 1)).toISOString();
}

class LocalQuizAdapter implements QuizAdapter {
  readonly mode = 'local' as const;
  private channel: BroadcastChannel | null = null;
  private listeners = new Set<() => void>();

  private ch(): BroadcastChannel | null {
    if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') return null;
    if (!this.channel) {
      this.channel = new BroadcastChannel(CHANNEL);
      this.channel.addEventListener('message', () => this.listeners.forEach((l) => l()));
    }
    return this.channel;
  }

  private commit(db: LocalDb, stateChanged: boolean): void {
    if (stateChanged) db.state.updated_at = bumpTime(db.state.updated_at);
    write(db);
    this.ch()?.postMessage({ kind: 'changed' });
    // 같은 탭의 구독자에게도
    this.listeners.forEach((l) => l());
  }

  async serverNow(): Promise<number> {
    return Date.now();
  }

  async getState(): Promise<QuizState> {
    return read().state;
  }

  subscribeState(cb: (state: QuizState) => void): () => void {
    let last = '';
    const emit = () => {
      const s = read().state;
      const sig = `${s.updated_at}|${s.status}|${s.current_index}`;
      if (sig === last) return;
      last = sig;
      cb(s);
    };
    this.ch();
    this.listeners.add(emit);
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY) emit();
    };
    window.addEventListener('storage', onStorage);
    const poll = setInterval(emit, STATE_POLL_MS);
    emit();
    return () => {
      this.listeners.delete(emit);
      window.removeEventListener('storage', onStorage);
      clearInterval(poll);
    };
  }

  async join(name: string, tableNo: number): Promise<QuizParticipant> {
    if (!Number.isInteger(tableNo) || tableNo < 1 || tableNo > 99) throw new QuizError('QUIZ_EMPTY');
    const db = read();
    const p: QuizParticipant = {
      id: uid(),
      name: (name.trim() || '익명').slice(0, 20),
      table_no: tableNo,
      created_at: new Date().toISOString(),
    };
    db.participants.push(p);
    this.commit(db, false);
    return p;
  }

  async me(id: string): Promise<QuizParticipant | null> {
    return read().participants.find((p) => p.id === id) ?? null;
  }

  async submit(participantId: string, index: number, answer: string): Promise<string> {
    const ans = answer.trim().slice(0, 200);
    if (!ans) throw new QuizError('QUIZ_EMPTY');
    const db = read();
    const s = db.state;
    const now = Date.now();
    if (
      s.status !== 'open' ||
      s.current_index !== index ||
      !s.opened_at ||
      now > new Date(s.opened_at).getTime() + s.duration_sec * 1000 + SUBMIT_GRACE_MS
    ) {
      throw new QuizError('QUIZ_CLOSED');
    }
    if (!db.participants.some((p) => p.id === participantId)) throw new QuizError('QUIZ_UNKNOWN');
    const ts = new Date(now).toISOString();
    const existing = db.submissions.find(
      (x) => x.question_index === index && x.participant_id === participantId,
    );
    if (existing) {
      if (!s.allow_edit) throw new QuizError('QUIZ_DUPLICATE');
      existing.answer = ans;
      existing.created_at = ts;
    } else {
      db.submissions.push({
        id: uid(),
        question_index: index,
        participant_id: participantId,
        answer: ans,
        created_at: ts,
        auto_verdict: null,
        verdict: null,
      });
    }
    this.commit(db, false);
    return ts;
  }

  async mySubmission(participantId: string, index: number): Promise<QuizMySubmission | null> {
    const s = read().submissions.find(
      (x) => x.participant_id === participantId && x.question_index === index,
    );
    return s ? { answer: s.answer, created_at: s.created_at, verdict: s.verdict } : null;
  }

  async counts(index: number): Promise<QuizCounts> {
    const db = read();
    return {
      participants: db.participants.length,
      submissions: db.submissions.filter((x) => x.question_index === index).length,
    };
  }

  private checkKey(key: string): void {
    // 로컬 모드: NEXT_PUBLIC_OPERATOR_KEY가 있으면 그 값과 대조, 없으면 통과(개발 편의)
    if (OPERATOR_KEY && key !== OPERATOR_KEY) throw new QuizError('QUIZ_FORBIDDEN');
  }

  async adminSnapshot(key: string, index: number | null): Promise<QuizAdminSnapshot> {
    this.checkKey(key);
    const db = read();
    return {
      participants: [...db.participants].sort((a, b) => a.created_at.localeCompare(b.created_at)),
      submissions: db.submissions
        .filter((x) => index === null || x.question_index === index)
        .sort((a, b) => a.question_index - b.question_index || a.created_at.localeCompare(b.created_at)),
      winners: [...db.winners].sort((a, b) => a.question_index - b.question_index),
    };
  }

  async control(key: string, act: QuizControlAction): Promise<QuizState> {
    this.checkKey(key);
    const db = read();
    const s = db.state;
    const now = new Date().toISOString();

    switch (act.action) {
      case 'open': {
        s.status = 'open';
        s.current_index = act.index;
        s.opened_at = now;
        s.duration_sec = Math.max(5, act.duration_sec || s.duration_sec);
        s.winner_submission_id = db.winners.find((w) => w.question_index === act.index)?.submission_id ?? null;
        s.reveal = null;
        s.leaderboard = null;
        s.settings = { ...s.settings, opened: { ...(s.settings.opened ?? {}), [String(act.index)]: now } };
        break;
      }
      case 'extend':
        if (s.status === 'open') s.duration_sec += act.seconds || 15;
        break;
      case 'close':
        if (s.status === 'open') s.status = 'closed';
        break;
      case 'set_verdict': {
        const sub = db.submissions.find((x) => x.id === act.submission_id);
        if (sub) sub.verdict = act.verdict;
        break;
      }
      case 'set_winner': {
        db.winners = db.winners.filter((w) => w.question_index !== act.index);
        if (act.submission_id) {
          const sub = db.submissions.find(
            (x) => x.id === act.submission_id && x.question_index === act.index,
          );
          if (!sub) throw new QuizError('QUIZ_UNKNOWN');
          // 1인 1회 — 연습 문제(0번)는 상품이 없으므로 제외
          if (
            act.index > 0 &&
            s.settings.one_win === true &&
            db.winners.some((w) => w.participant_id === sub.participant_id && w.question_index > 0)
          ) {
            throw new QuizError('QUIZ_ALREADY_WON');
          }
          db.winners.push({
            question_index: act.index,
            participant_id: sub.participant_id,
            submission_id: sub.id,
          });
          sub.verdict = 'correct';
        }
        if (s.current_index === act.index) s.winner_submission_id = act.submission_id;
        break;
      }
      case 'reveal': {
        Object.entries(act.verdicts).forEach(([id, v]) => {
          const sub = db.submissions.find((x) => x.id === id);
          if (sub) {
            sub.auto_verdict = v.auto;
            sub.verdict = v.verdict;
          }
        });
        s.status = 'revealed';
        s.reveal = act.reveal;
        break;
      }
      case 'next':
        s.status = 'lobby';
        s.current_index = act.index;
        s.opened_at = null;
        s.reveal = null;
        s.leaderboard = null;
        s.winner_submission_id = db.winners.find((w) => w.question_index === act.index)?.submission_id ?? null;
        break;
      case 'settings':
        if (act.display_mode) s.display_mode = act.display_mode;
        if (typeof act.allow_edit === 'boolean') s.allow_edit = act.allow_edit;
        if (typeof act.one_win === 'boolean') s.settings = { ...s.settings, one_win: act.one_win };
        if (act.keywords) s.settings = { ...s.settings, keywords: { ...(s.settings.keywords ?? {}), ...act.keywords } };
        if (act.durations) s.settings = { ...s.settings, durations: { ...(s.settings.durations ?? {}), ...act.durations } };
        break;
      case 'final':
        s.status = 'final';
        s.leaderboard = act.leaderboard;
        s.reveal = null;
        break;
      case 'reset_question': {
        db.winners = db.winners.filter((w) => w.question_index !== act.index);
        db.submissions = db.submissions.filter((x) => x.question_index !== act.index);
        const opened = { ...(s.settings.opened ?? {}) };
        delete opened[String(act.index)];
        s.settings = { ...s.settings, opened };
        if (s.current_index === act.index) {
          s.status = 'lobby';
          s.opened_at = null;
          s.reveal = null;
          s.winner_submission_id = null;
        }
        break;
      }
      case 'reset_all': {
        db.winners = [];
        db.submissions = [];
        if (act.participants) db.participants = [];
        const rest = { ...s.settings };
        delete rest.opened;
        Object.assign(s, {
          status: 'lobby',
          current_index: 0,
          opened_at: null,
          reveal: null,
          leaderboard: null,
          winner_submission_id: null,
          settings: rest,
        });
        break;
      }
      default:
        break;
    }

    this.commit(db, true);
    return db.state;
  }
}

export function createLocalQuizAdapter(): QuizAdapter {
  return new LocalQuizAdapter();
}
