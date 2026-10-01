-- Quiz v1.2 마이그레이션: 진행 중 문제의 정답/오답 집계(송출 화면용).
-- 운영자 화면이 판정 집계를 quiz_live에 올리고, 송출 화면은 quiz_counts로 2초마다 읽는다.
-- quiz_state를 건드리지 않으므로 참가자 폰으로 실시간 방송이 늘지 않는다.

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

grant execute on function quiz_live_update(text, int, int, int, int) to anon, authenticated;
grant execute on function quiz_counts(int) to anon, authenticated;
