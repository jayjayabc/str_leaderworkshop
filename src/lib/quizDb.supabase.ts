// 스피드 퀴즈 Supabase 어댑터 (Quiz v1.0) — 스키마는 supabase/quiz_schema.sql.
//   - 쓰기와 조회는 모두 RPC(SECURITY DEFINER 함수). 테이블 직접 접근은 quiz_state 읽기뿐이다.
//   - 참가자는 quiz_state만 구독한다(제출 테이블은 방송하지 않는다).
//   - Realtime + 3초 폴링을 함께 돌린다 — 웹소켓이 막힌 원격 격리 브라우저에서도 ≤3초.

import type { RealtimeChannel } from '@supabase/supabase-js';

import { sb } from './supabaseClient';
import type { QuizAdapter, QuizCounts, QuizLiveCounts } from './quizDb';
import {
  EMPTY_QUIZ_STATE,
  QuizError,
  STATE_POLL_MS,
  type QuizAdminSnapshot,
  type QuizControlAction,
  type QuizErrorCode,
  type QuizMySubmission,
  type QuizParticipant,
  type QuizRole,
  type QuizScoreRow,
  type QuizState,
  type QuizTeamStatus,
} from './quizTypes';

const CODES: QuizErrorCode[] = [
  'QUIZ_CLOSED',
  'QUIZ_DUPLICATE',
  'QUIZ_UNKNOWN',
  'QUIZ_EMPTY',
  'QUIZ_FORBIDDEN',
  'QUIZ_ALREADY_WON',
  'QUIZ_ANSWERER_TAKEN',
  'QUIZ_NOT_ANSWERER',
];

/** PostgREST 오류 → QuizError (함수가 'QUIZ_…'로 시작하는 메시지로 raise한다) */
function toQuizError(err: { message?: string } | null | undefined): QuizError {
  const msg = err?.message ?? '';
  const code = CODES.find((c) => msg.includes(c));
  return new QuizError(code ?? 'QUIZ_NETWORK', msg || undefined);
}

function normalizeState(row: Partial<QuizState> | null | undefined): QuizState {
  return {
    ...EMPTY_QUIZ_STATE,
    ...(row ?? {}),
    settings: (row?.settings as QuizState['settings']) ?? {},
  };
}

/** Realtime이 살아 있을 때의 안전망 폴링 주기 */
const STATE_POLL_LIVE_MS = 15_000;

class SupabaseQuizAdapter implements QuizAdapter {
  readonly mode = 'supabase' as const;

  async serverNow(): Promise<number> {
    const { data, error } = await sb().rpc('server_now');
    if (error || !data) throw toQuizError(error);
    return new Date(data as string).getTime();
  }

  async getState(): Promise<QuizState> {
    const { data, error } = await sb().from('quiz_state').select('*').eq('id', 1).maybeSingle();
    if (error) throw toQuizError(error);
    return normalizeState(data as Partial<QuizState> | null);
  }

  subscribeState(cb: (state: QuizState) => void): () => void {
    let last = '';
    let disposed = false;
    const emit = (s: QuizState) => {
      if (disposed) return;
      const sig = `${s.updated_at}|${s.status}|${s.current_index}`;
      if (sig === last) return;
      last = sig;
      cb(s);
    };
    let live = false; // Realtime 연결이 살아 있으면 폴링을 15초로 늦춘다(250대 × 3초 폴링 부하 줄이기)
    let lastPull = 0;
    const pull = () => {
      lastPull = Date.now();
      void this.getState()
        .then(emit)
        .catch(() => undefined);
    };

    // Realtime — 행 전체가 payload.new로 온다
    const channel: RealtimeChannel = sb()
      .channel('quiz_state')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'quiz_state' }, (payload) => {
        emit(normalizeState(payload.new as Partial<QuizState>));
      })
      .subscribe((status) => {
        live = status === 'SUBSCRIBED';
        if (live) pull();
      });

    // 폴링 — 웹소켓이 막혀도 3초 안에 따라온다. 탭이 다시 보이거나 온라인이 되면 즉시 한 번 더.
    const poll = setInterval(() => {
      if (!live || Date.now() - lastPull >= STATE_POLL_LIVE_MS) pull();
    }, STATE_POLL_MS);
    const onWake = () => {
      if (document.visibilityState !== 'hidden') pull();
    };
    document.addEventListener('visibilitychange', onWake);
    window.addEventListener('online', onWake);
    window.addEventListener('focus', onWake);
    pull();

    return () => {
      disposed = true;
      clearInterval(poll);
      document.removeEventListener('visibilitychange', onWake);
      window.removeEventListener('online', onWake);
      window.removeEventListener('focus', onWake);
      void sb().removeChannel(channel);
    };
  }

  async join(name: string, tableNo: number): Promise<QuizParticipant> {
    const { data, error } = await sb().rpc('quiz_join', { p_name: name, p_table: tableNo });
    if (error || !data) throw toQuizError(error);
    return data as QuizParticipant;
  }

  async joinTeam(tableNo: number, role: QuizRole, takeover: boolean): Promise<QuizParticipant> {
    const { data, error } = await sb().rpc('quiz_join_team', { p_table: tableNo, p_role: role, p_takeover: takeover });
    if (error || !data) throw toQuizError(error);
    return data as QuizParticipant;
  }

  async setRole(participantId: string, role: QuizRole, takeover: boolean): Promise<QuizParticipant> {
    const { data, error } = await sb().rpc('quiz_set_role', {
      p_participant: participantId,
      p_role: role,
      p_takeover: takeover,
    });
    if (error || !data) throw toQuizError(error);
    return data as QuizParticipant;
  }

  async teamStatus(participantId: string, index: number): Promise<QuizTeamStatus | null> {
    const { data, error } = await sb().rpc('quiz_team_status', { p_participant: participantId, p_index: index });
    if (error) throw toQuizError(error);
    return (data as QuizTeamStatus | null) ?? null;
  }

  async scoreboard(teams: number): Promise<QuizScoreRow[]> {
    const { data, error } = await sb().rpc('quiz_scoreboard', { p_teams: teams });
    if (error) throw toQuizError(error);
    return (data as QuizScoreRow[] | null) ?? [];
  }

  async me(id: string): Promise<QuizParticipant | null> {
    const { data, error } = await sb().rpc('quiz_me', { p_id: id });
    if (error) throw toQuizError(error);
    const row = data as QuizParticipant | null;
    return row && row.id ? row : null;
  }

  async submit(participantId: string, index: number, answer: string): Promise<string> {
    const { data, error } = await sb().rpc('submit_answer', {
      p_participant: participantId,
      p_index: index,
      p_answer: answer,
    });
    if (error || !data) throw toQuizError(error);
    return data as string;
  }

  async mySubmission(participantId: string, index: number): Promise<QuizMySubmission | null> {
    const { data, error } = await sb().rpc('quiz_my_submission', {
      p_participant: participantId,
      p_index: index,
    });
    if (error) throw toQuizError(error);
    return (data as QuizMySubmission | null) ?? null;
  }

  async counts(index: number): Promise<QuizCounts> {
    const { data, error } = await sb().rpc('quiz_counts', { p_index: index });
    if (error || !data) throw toQuizError(error);
    return data as QuizCounts;
  }

  async control(key: string, act: QuizControlAction): Promise<QuizState> {
    const { action, ...payload } = act;
    const { data, error } = await sb().rpc('quiz_control', {
      p_key: key,
      p_action: action,
      p_payload: payload,
    });
    if (error || !data) throw toQuizError(error);
    return normalizeState(data as Partial<QuizState>);
  }

  async pushLive(key: string, index: number, live: QuizLiveCounts): Promise<void> {
    const { error } = await sb().rpc('quiz_live_update', {
      p_key: key,
      p_index: index,
      p_correct: live.correct,
      p_wrong: live.wrong,
      p_review: live.review,
    });
    if (error) throw toQuizError(error);
  }

  async adminSnapshot(key: string, index: number | null): Promise<QuizAdminSnapshot> {
    const { data, error } = await sb().rpc('quiz_admin_snapshot', { p_key: key, p_index: index });
    if (error || !data) throw toQuizError(error);
    return data as QuizAdminSnapshot;
  }
}

export function createSupabaseQuizAdapter(): QuizAdapter {
  return new SupabaseQuizAdapter();
}
