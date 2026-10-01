-- Quiz v1.1 마이그레이션: 1인 1회 수상 규칙을 설정(one_win, 기본 꺼짐)으로 바꾼다. Supabase SQL Editor에 통째로 붙여 넣고 Run.
drop index if exists uq_quiz_winners_participant;
drop index if exists uq_quiz_winners_participant_prize;

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
