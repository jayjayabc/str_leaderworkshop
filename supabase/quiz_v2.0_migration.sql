-- Quiz v2.0 마이그레이션 — 단체전(30조 · 답변자 1명/조 · 관전자) + 문항별 배점 + 점수판
-- 여러 번 실행해도 안전. Supabase SQL Editor에 통째로 붙여 넣고 Run.

-- 1) 참가자 역할 · 조당 답변자 1명
alter table quiz_participants add column if not exists role text not null default 'spectator';
alter table quiz_participants drop constraint if exists quiz_participants_role_check;
alter table quiz_participants add constraint quiz_participants_role_check check (role in ('answerer','spectator'));
create unique index if not exists uq_quiz_team_answerer on quiz_participants (table_no) where role = 'answerer';

-- 2) 제출은 조 단위 — 문항마다 조당 1건
alter table quiz_submissions add column if not exists team_no int;
create unique index if not exists uq_quiz_sub_team on quiz_submissions (question_index, team_no) where team_no is not null;

-- 3) 조 입장 — 답변자는 조당 1명(이미 있으면 p_takeover=true일 때만 넘겨받는다)
create or replace function quiz_join_team(p_table int, p_role text, p_takeover boolean default false, p_name text default '')
returns quiz_participants
language plpgsql security definer set search_path = public as $$
declare r quiz_participants;
begin
  if p_table is null or p_table < 1 or p_table > 99 then raise exception 'QUIZ_EMPTY: table'; end if;
  if p_role not in ('answerer','spectator') then raise exception 'QUIZ_EMPTY: role'; end if;
  if p_role = 'answerer' then
    perform pg_advisory_xact_lock(4242, p_table);
    if exists (select 1 from quiz_participants where table_no = p_table and role = 'answerer') then
      if not coalesce(p_takeover, false) then raise exception 'QUIZ_ANSWERER_TAKEN'; end if;
      update quiz_participants set role = 'spectator' where table_no = p_table and role = 'answerer';
    end if;
  end if;
  insert into quiz_participants (name, table_no, role)
  values (left(coalesce(nullif(btrim(p_name), ''), p_table || '조 ' || case p_role when 'answerer' then '답변자' else '관전자' end), 20),
          p_table, p_role)
  returning * into r;
  return r;
end $$;

-- 4) 이미 입장한 사람의 역할 바꾸기(관전자 ↔ 답변자)
create or replace function quiz_set_role(p_participant uuid, p_role text, p_takeover boolean default false)
returns quiz_participants
language plpgsql security definer set search_path = public as $$
declare r quiz_participants;
begin
  select * into r from quiz_participants where id = p_participant;
  if r.id is null then raise exception 'QUIZ_UNKNOWN'; end if;
  if p_role not in ('answerer','spectator') then raise exception 'QUIZ_EMPTY: role'; end if;
  -- 넘겨받기와 겹치지 않게 조 단위 잠금을 먼저 잡고 역할을 다시 읽는다
  perform pg_advisory_xact_lock(4242, r.table_no);
  select * into r from quiz_participants where id = p_participant;
  if p_role = 'answerer' and r.role <> 'answerer' then
    if exists (select 1 from quiz_participants where table_no = r.table_no and role = 'answerer' and id <> r.id) then
      if not coalesce(p_takeover, false) then raise exception 'QUIZ_ANSWERER_TAKEN'; end if;
      update quiz_participants set role = 'spectator' where table_no = r.table_no and role = 'answerer' and id <> r.id;
    end if;
  end if;
  update quiz_participants set role = p_role where id = r.id returning * into r;
  return r;
end $$;

-- 5) 답 제출 — 그 조의 답변자만, 조당 1건
create or replace function submit_answer(p_participant uuid, p_index int, p_answer text)
returns timestamptz
language plpgsql security definer set search_path = public as $$
declare
  s   quiz_state;
  p   quiz_participants;
  ts  timestamptz := now();
  ans text := left(btrim(coalesce(p_answer, '')), 300);
  sid uuid;
begin
  if ans = '' then raise exception 'QUIZ_EMPTY'; end if;

  select * into s from quiz_state where id = 1;
  if s.status <> 'open' or s.current_index <> p_index or s.opened_at is null
     or ts > s.opened_at + make_interval(secs => s.duration_sec + 2) then
    raise exception 'QUIZ_CLOSED';
  end if;

  select * into p from quiz_participants where id = p_participant;
  if p.id is null then raise exception 'QUIZ_UNKNOWN'; end if;
  if p.role <> 'answerer' then raise exception 'QUIZ_NOT_ANSWERER'; end if;

  select id into sid from quiz_submissions where question_index = p_index and team_no = p.table_no;
  if sid is not null then
    if not s.allow_edit then raise exception 'QUIZ_DUPLICATE'; end if;
    update quiz_submissions set answer = ans, participant_id = p.id, created_at = ts, updated_at = ts where id = sid;
    return ts;
  end if;

  begin
    insert into quiz_submissions (question_index, participant_id, team_no, answer, created_at)
    values (p_index, p.id, p.table_no, ans, ts);
  exception when unique_violation then
    raise exception 'QUIZ_DUPLICATE';
  end;
  return ts;
end $$;

-- 6) 우리 조 상황 — 역할, 답변자 유무, 조원 수, 이번 문제 우리 조 제출
create or replace function quiz_team_status(p_participant uuid, p_index int)
returns json
language plpgsql stable security definer set search_path = public as $$
declare p quiz_participants;
begin
  select * into p from quiz_participants where id = p_participant;
  if p.id is null then return null; end if;
  return json_build_object(
    'team_no', p.table_no,
    'role', p.role,
    'answerer', exists (select 1 from quiz_participants where table_no = p.table_no and role = 'answerer'),
    'members', (select count(*) from quiz_participants where table_no = p.table_no),
    'submission', (select json_build_object('answer', answer, 'created_at', created_at, 'verdict', verdict)
                     from quiz_submissions where question_index = p_index and team_no = p.table_no)
  );
end $$;

-- 7) 점수판 — 공개된 문항의 정답 × 배점(settings.points, 없으면 10점 · 연습 0점)
create or replace function quiz_scoreboard(p_teams int default 30)
returns json
language sql stable security definer set search_path = public as $$
  with st as (select * from quiz_state where id = 1),
  scored as (
    select sub.team_no,
           sum(coalesce((st.settings->'points'->>(sub.question_index::text))::int, 10)) as score,
           count(*) as correct
      from quiz_submissions sub, st
     where sub.verdict = 'correct' and sub.team_no is not null and sub.question_index > 0
       and (sub.question_index <> st.current_index or st.status in ('revealed','final'))
     group by sub.team_no
  ),
  mem as (select table_no, count(*) as members from quiz_participants group by table_no)
  select coalesce(json_agg(json_build_object(
           'team_no', t,
           'score', coalesce(scored.score, 0),
           'correct', coalesce(scored.correct, 0),
           'members', coalesce(mem.members, 0)) order by t), '[]'::json)
    from generate_series(1, greatest(1, least(coalesce(p_teams, 30), 99))) t
    left join scored on scored.team_no = t
    left join mem on mem.table_no = t
$$;

-- 8) 송출 화면 숫자 — 입장 인원, 입장한 조, 답변자 있는 조, 이번 문제 제출 조 수, 정답/오답 집계
create or replace function quiz_counts(p_index int)
returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'participants', (select count(*) from quiz_participants),
    'teams',        (select count(distinct table_no) from quiz_participants),
    'answerers',    (select count(*) from quiz_participants where role = 'answerer'),
    'submissions',  (select count(*) from quiz_submissions where question_index = p_index),
    'live', (select json_build_object('correct', correct, 'wrong', wrong, 'review', review)
               from quiz_live where id = 1 and question_index = p_index)
  )
$$;

-- 9) 운영자 설정에 문항별 배점(points) 추가
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
                     || case when p_payload ? 'points'
                          then jsonb_build_object('points', coalesce(settings->'points','{}'::jsonb) || (p_payload->'points'))
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

grant execute on function quiz_join_team(int, text, boolean, text) to anon, authenticated;
grant execute on function quiz_set_role(uuid, text, boolean) to anon, authenticated;
grant execute on function submit_answer(uuid, int, text) to anon, authenticated;
grant execute on function quiz_team_status(uuid, int) to anon, authenticated;
grant execute on function quiz_scoreboard(int) to anon, authenticated;
grant execute on function quiz_counts(int) to anon, authenticated;
