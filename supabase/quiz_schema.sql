-- 코끼리 보드 · 스피드 퀴즈 스키마 (Quiz v1.0)
-- Supabase 대시보드 > SQL Editor 에 붙여넣어 실행한다. 여러 번 실행해도 안전하다(idempotent).
-- 기존 보드 테이블(boards·keywords·…)은 건드리지 않는다.
--
-- ▶ 실행 후 운영자 키를 한 번 넣는다 (키 값은 저장소에 커밋하지 말 것):
--
--     insert into quiz_config (id, operator_key) values (1, '여기에-운영자-키')
--     on conflict (id) do update set operator_key = excluded.operator_key;
--
--   /quiz/admin에서 입력하는 키(= NEXT_PUBLIC_OPERATOR_KEY)와 같은 값이어야 운영 조작이 된다.
--
-- 보안 모델
--   - 모든 퀴즈 테이블에 RLS를 켜고, anon이 직접 읽을 수 있는 것은 quiz_state 한 행뿐이다.
--   - 참가·제출·내 답 조회·집계 수는 SECURITY DEFINER 함수(RPC)로만 한다.
--   - 제출 가능 여부(열린 문제·현재 번호·제한시간 + 2초)는 서버가 판정하고, 제출 시각은 서버 now()다.
--   - 운영 조작(quiz_control)과 운영자 스냅샷은 quiz_config.operator_key를 확인한다.
--   - 참가자 id(uuid)는 본인만 아는 값이라 '내 답 조회'의 열쇠로 쓴다.

create extension if not exists "pgcrypto";

-- ─────────────────────────────────────────────────────────────
-- 테이블
-- ─────────────────────────────────────────────────────────────

create table if not exists quiz_config (
  id            int primary key default 1 check (id = 1),
  operator_key  text not null
);

create table if not exists quiz_state (
  id                    int primary key default 1 check (id = 1),
  status                text not null default 'lobby'
                        check (status in ('lobby','open','closed','revealed','final')),
  current_index         int  not null default 0,
  opened_at             timestamptz,
  duration_sec          int  not null default 90 check (duration_sec between 5 and 3600),
  display_mode          text not null default 'full' check (display_mode in ('full','keyword')),
  allow_edit            boolean not null default false,
  winner_submission_id  uuid,
  settings              jsonb not null default '{}'::jsonb,
  reveal                jsonb,
  leaderboard           jsonb,
  updated_at            timestamptz not null default now()
);

insert into quiz_state (id) values (1) on conflict (id) do nothing;

create table if not exists quiz_participants (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  table_no    int  not null check (table_no between 1 and 99),
  created_at  timestamptz not null default now()
);

create table if not exists quiz_submissions (
  id              uuid primary key default gen_random_uuid(),
  question_index  int  not null,
  participant_id  uuid not null references quiz_participants(id) on delete cascade,
  answer          text not null,
  created_at      timestamptz not null default now(),   -- 서버 시각
  updated_at      timestamptz,
  auto_verdict    text,
  verdict         text check (verdict in ('correct','wrong')),
  unique (question_index, participant_id)
);

create index if not exists idx_quiz_sub_index_time on quiz_submissions (question_index, created_at);

create table if not exists quiz_winners (
  question_index  int  primary key,
  participant_id  uuid not null references quiz_participants(id) on delete cascade,
  submission_id   uuid not null references quiz_submissions(id) on delete cascade
);

-- 1인 1회 수상은 운영 설정(settings.one_win)으로 켜고 끈다 (v1.1 — 기본 꺼짐).
-- 예전에 걸던 유니크 인덱스는 지운다. 규칙 검사는 quiz_control('set_winner')가 한다.
drop index if exists uq_quiz_winners_participant;
drop index if exists uq_quiz_winners_participant_prize;

-- ─────────────────────────────────────────────────────────────
-- RLS — quiz_state만 읽기 허용, 나머지는 함수로만
-- ─────────────────────────────────────────────────────────────

alter table quiz_config       enable row level security;
alter table quiz_state        enable row level security;
alter table quiz_participants enable row level security;
alter table quiz_submissions  enable row level security;
alter table quiz_winners      enable row level security;

drop policy if exists quiz_state_read on quiz_state;
create policy quiz_state_read on quiz_state for select to anon, authenticated using (true);

-- Realtime: quiz_state 변경만 방송한다(제출은 방송하지 않는다 — 참가자가 남의 답을 볼 수 없게)
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'quiz_state'
  ) then
    alter publication supabase_realtime add table quiz_state;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────
-- 공개 함수 (anon)
-- ─────────────────────────────────────────────────────────────

-- 시계 맞추기 — 클라이언트는 이 값으로 서버와의 시차를 구해 타이머를 그린다
create or replace function server_now() returns timestamptz
language sql stable as $$ select now() $$;

create or replace function quiz_join(p_name text, p_table int)
returns quiz_participants
language plpgsql security definer set search_path = public as $$
declare r quiz_participants;
begin
  if p_table is null or p_table < 1 or p_table > 99 then
    raise exception 'QUIZ_EMPTY: table';
  end if;
  insert into quiz_participants (name, table_no)
  values (left(coalesce(nullif(btrim(p_name), ''), '익명'), 20), p_table)
  returning * into r;
  return r;
end $$;

create or replace function quiz_me(p_id uuid)
returns quiz_participants
language sql stable security definer set search_path = public as $$
  select * from quiz_participants where id = p_id
$$;

-- 제출 — 열린 문제 · 현재 번호 · opened_at + duration + 2초 안에서만. 반환값 = 서버 제출 시각
create or replace function submit_answer(p_participant uuid, p_index int, p_answer text)
returns timestamptz
language plpgsql security definer set search_path = public as $$
declare
  s   quiz_state;
  ts  timestamptz := now();
  ans text := left(btrim(coalesce(p_answer, '')), 200);
  sid uuid;
begin
  if ans = '' then raise exception 'QUIZ_EMPTY'; end if;

  select * into s from quiz_state where id = 1;
  if s.status <> 'open' or s.current_index <> p_index or s.opened_at is null
     or ts > s.opened_at + make_interval(secs => s.duration_sec + 2) then
    raise exception 'QUIZ_CLOSED';
  end if;

  if not exists (select 1 from quiz_participants where id = p_participant) then
    raise exception 'QUIZ_UNKNOWN';
  end if;

  select id into sid from quiz_submissions
   where question_index = p_index and participant_id = p_participant;

  if sid is not null then
    if not s.allow_edit then raise exception 'QUIZ_DUPLICATE'; end if;
    -- 수정: 시각도 새로 찍는다(첫 정답 판정은 마지막으로 낸 답의 시각 기준)
    update quiz_submissions set answer = ans, created_at = ts, updated_at = ts where id = sid;
    return ts;
  end if;

  begin
    insert into quiz_submissions (question_index, participant_id, answer, created_at)
    values (p_index, p_participant, ans, ts);
  exception when unique_violation then
    raise exception 'QUIZ_DUPLICATE';
  end;
  return ts;
end $$;

-- 내 답 조회 (새로고침·공개 화면용) — 참가자 id를 아는 본인만
create or replace function quiz_my_submission(p_participant uuid, p_index int)
returns json
language sql stable security definer set search_path = public as $$
  select json_build_object('answer', answer, 'created_at', created_at, 'verdict', verdict)
    from quiz_submissions
   where participant_id = p_participant and question_index = p_index
$$;

-- 스크린용 숫자 — 입장 인원, 현재 문제 제출 수, 운영자가 올린 정답/오답 집계(v1.2)

create table if not exists quiz_live (
  id             int primary key default 1 check (id = 1),
  question_index int,
  correct        int not null default 0,
  wrong          int not null default 0,
  review         int not null default 0,
  updated_at     timestamptz not null default now()
);
insert into quiz_live (id) values (1) on conflict (id) do nothing;
alter table quiz_live enable row level security; -- 정책 없음 = 직접 읽기/쓰기 불가, 함수로만

create or replace function quiz_live_update(p_key text, p_index int, p_correct int, p_wrong int, p_review int)
returns void
language plpgsql security definer set search_path = public as $$
begin
  perform quiz_check_key(p_key);
  update quiz_live
     set question_index = p_index,
         correct = greatest(0, coalesce(p_correct, 0)),
         wrong   = greatest(0, coalesce(p_wrong, 0)),
         review  = greatest(0, coalesce(p_review, 0)),
         updated_at = now()
   where id = 1;
end $$;

create or replace function quiz_counts(p_index int)
returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'participants', (select count(*) from quiz_participants),
    'submissions',  (select count(*) from quiz_submissions where question_index = p_index),
    'live', (select json_build_object('correct', correct, 'wrong', wrong, 'review', review)
               from quiz_live where id = 1 and question_index = p_index)
  )
$$;

-- ─────────────────────────────────────────────────────────────
-- 운영자 함수 (operator_key 확인)
-- ─────────────────────────────────────────────────────────────

create or replace function quiz_check_key(p_key text) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if p_key is null or not exists (select 1 from quiz_config where id = 1 and operator_key = p_key) then
    raise exception 'QUIZ_FORBIDDEN';
  end if;
end $$;

-- 운영자 스냅샷 — p_index가 null이면 모든 문제의 제출
create or replace function quiz_admin_snapshot(p_key text, p_index int default null)
returns json
language plpgsql stable security definer set search_path = public as $$
begin
  perform quiz_check_key(p_key);
  return json_build_object(
    'participants', coalesce((select json_agg(p order by p.created_at) from quiz_participants p), '[]'::json),
    'submissions',  coalesce((
        select json_agg(s order by s.question_index, s.created_at)
          from quiz_submissions s
         where p_index is null or s.question_index = p_index), '[]'::json),
    'winners',      coalesce((select json_agg(w order by w.question_index) from quiz_winners w), '[]'::json)
  );
end $$;

-- 상태 조작 — action별 payload는 README/NOTES 참고
create or replace function quiz_control(p_key text, p_action text, p_payload jsonb default '{}'::jsonb)
returns quiz_state
language plpgsql security definer set search_path = public as $$
declare
  s    quiz_state;
  idx  int;
  sid  uuid;
  pid  uuid;
  k    text;
  v    jsonb;
begin
  perform quiz_check_key(p_key);
  select * into s from quiz_state where id = 1 for update;

  if p_action = 'open' then
    idx := (p_payload->>'index')::int;
    update quiz_state set
      status = 'open',
      current_index = idx,
      opened_at = now(),
      duration_sec = greatest(5, coalesce((p_payload->>'duration_sec')::int, duration_sec)),
      winner_submission_id = (select submission_id from quiz_winners where question_index = idx),
      reveal = null,
      leaderboard = null,
      settings = jsonb_set(settings, '{opened}',
                   coalesce(settings->'opened', '{}'::jsonb) || jsonb_build_object(idx::text, now()))
    where id = 1;

  elsif p_action = 'extend' then
    update quiz_state set duration_sec = duration_sec + coalesce((p_payload->>'seconds')::int, 15)
     where id = 1 and status = 'open';

  elsif p_action = 'close' then
    update quiz_state set status = 'closed' where id = 1 and status = 'open';

  elsif p_action = 'set_verdict' then
    update quiz_submissions set verdict = nullif(p_payload->>'verdict', '')
     where id = (p_payload->>'submission_id')::uuid;

  elsif p_action = 'set_winner' then
    idx := (p_payload->>'index')::int;
    sid := nullif(p_payload->>'submission_id', '')::uuid;
    delete from quiz_winners where question_index = idx;
    if sid is not null then
      select participant_id into pid from quiz_submissions where id = sid and question_index = idx;
      if pid is null then raise exception 'QUIZ_UNKNOWN'; end if;
      -- 1인 1회 (설정 one_win이 켜졌을 때만, 연습 문제 0번은 제외)
      if idx > 0 and coalesce((s.settings->>'one_win')::boolean, false)
         and exists (select 1 from quiz_winners where participant_id = pid and question_index > 0) then
        raise exception 'QUIZ_ALREADY_WON';
      end if;
      insert into quiz_winners (question_index, participant_id, submission_id) values (idx, pid, sid);
      update quiz_submissions set verdict = 'correct' where id = sid;
    end if;
    update quiz_state set winner_submission_id = sid where id = 1 and current_index = idx;

  elsif p_action = 'reveal' then
    for k, v in select * from jsonb_each(coalesce(p_payload->'verdicts', '{}'::jsonb)) loop
      update quiz_submissions
         set auto_verdict = v->>'auto', verdict = v->>'verdict'
       where id = k::uuid;
    end loop;
    update quiz_state set status = 'revealed', reveal = p_payload->'reveal' where id = 1;

  elsif p_action = 'next' then
    idx := (p_payload->>'index')::int;
    update quiz_state set
      status = 'lobby', current_index = idx, opened_at = null, reveal = null, leaderboard = null,
      winner_submission_id = (select submission_id from quiz_winners where question_index = idx)
    where id = 1;

  elsif p_action = 'settings' then
    update quiz_state set
      display_mode = coalesce(p_payload->>'display_mode', display_mode),
      allow_edit   = coalesce((p_payload->>'allow_edit')::boolean, allow_edit),
      settings     = settings
                     || case when p_payload ? 'keywords'
                          then jsonb_build_object('keywords', coalesce(settings->'keywords','{}'::jsonb) || (p_payload->'keywords'))
                          else '{}'::jsonb end
                     || case when p_payload ? 'one_win'
                          then jsonb_build_object('one_win', coalesce((p_payload->>'one_win')::boolean, false))
                          else '{}'::jsonb end
                     || case when p_payload ? 'durations'
                          then jsonb_build_object('durations', coalesce(settings->'durations','{}'::jsonb) || (p_payload->'durations'))
                          else '{}'::jsonb end
    where id = 1;

  elsif p_action = 'final' then
    update quiz_state set status = 'final', leaderboard = p_payload->'leaderboard', reveal = null where id = 1;

  elsif p_action = 'reset_question' then
    idx := (p_payload->>'index')::int;
    delete from quiz_winners where question_index = idx;
    delete from quiz_submissions where question_index = idx;
    update quiz_state set
      settings = settings #- array['opened', idx::text]
    where id = 1;
    update quiz_state set status = 'lobby', opened_at = null, reveal = null, winner_submission_id = null
     where id = 1 and current_index = idx;

  elsif p_action = 'reset_all' then
    -- Supabase(pg_safeupdate)는 WHERE 없는 DELETE를 막으므로 where true를 붙인다
    delete from quiz_winners where true;
    delete from quiz_submissions where true;
    if coalesce((p_payload->>'participants')::boolean, false) then
      delete from quiz_participants where true;
    end if;
    update quiz_state set
      status = 'lobby', current_index = 0, opened_at = null, reveal = null, leaderboard = null,
      winner_submission_id = null, settings = settings - 'opened'
    where id = 1;

  else
    raise exception 'unknown action %', p_action;
  end if;

  update quiz_state set updated_at = now() where id = 1 returning * into s;
  return s;
end $$;

-- ─────────────────────────────────────────────────────────────
-- 권한 — 테이블 직접 쓰기는 막고 함수 실행만 허용
-- ─────────────────────────────────────────────────────────────

revoke all on quiz_config, quiz_participants, quiz_submissions, quiz_winners from anon, authenticated;
revoke insert, update, delete on quiz_state from anon, authenticated;
grant select on quiz_state to anon, authenticated;

revoke execute on function quiz_check_key(text) from public, anon, authenticated;

grant execute on function
  server_now(),
  quiz_join(text, int),
  quiz_me(uuid),
  submit_answer(uuid, int, text),
  quiz_my_submission(uuid, int),
  quiz_counts(int),
  quiz_live_update(text, int, int, int, int),
  quiz_admin_snapshot(text, int),
  quiz_control(text, text, jsonb)
to anon, authenticated;
