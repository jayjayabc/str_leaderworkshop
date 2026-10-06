-- Quiz v2.1 — 선착순 가산 (2026-10-06)
--   settings.speed['<문항 index>'] = {"on": true, "tiers": [{"upto":1,"mode":"x","v":3},{"upto":5,"mode":"x","v":2}]}
--   정답 순서 = 정답 판정된 조 제출의 서버 시각(created_at; 수정 허용 시 마지막 수정 시각) → id 순.
--   mode 'x' = 배점 × v, '+' = 배점 + v. 위 구간(upto 작은 것)부터 적용, 해당 없으면 기본 배점.
--   ⚠ 규칙은 src/lib/quizScore.ts(scoreTeams)와 같아야 한다.
-- 적용: Supabase SQL Editor에서 이 파일 전체 실행 (여러 번 실행해도 안전).

create or replace function quiz_scoreboard(p_teams int default 30)
returns json
language sql stable security definer set search_path = public as $$
  with st as (select * from quiz_state where id = 1),
  cor as (
    select sub.team_no, sub.question_index,
           row_number() over (partition by sub.question_index order by sub.created_at, sub.id) as rk
      from quiz_submissions sub, st
     where sub.verdict = 'correct' and sub.team_no is not null and sub.question_index > 0
       and (sub.question_index <> st.current_index or st.status in ('revealed','final'))
  ),
  pts as (
    select cor.team_no, cor.rk,
           coalesce((st.settings->'points'->>(cor.question_index::text))::numeric, 10) as base,
           st.settings->'speed'->(cor.question_index::text) as rule
      from cor, st
  ),
  awarded as (
    select pts.team_no,
           case
             when jsonb_typeof(pts.rule) = 'object' and coalesce((pts.rule->>'on')::boolean, false)
                  and jsonb_typeof(pts.rule->'tiers') = 'array' then
               coalesce((
                 select case when t->>'mode' = '+' then pts.base + (t->>'v')::numeric
                             else pts.base * (t->>'v')::numeric end
                   from jsonb_array_elements(pts.rule->'tiers') t
                  where pts.rk <= (t->>'upto')::int
                  order by (t->>'upto')::int
                  limit 1), pts.base)
             else pts.base
           end as p
      from pts
  ),
  scored as (
    select team_no, round(sum(p))::int as score, count(*) as correct from awarded group by team_no
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

-- 운영자 설정에 문항별 선착순 규칙(speed) 추가 — 나머지는 v2.0과 같다
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
                     || case when p_payload ? 'speed'
                          then jsonb_build_object('speed', coalesce(settings->'speed','{}'::jsonb) || (p_payload->'speed'))
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

grant execute on function quiz_scoreboard(int) to anon, authenticated;
