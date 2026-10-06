-- v2.1 선착순 가산 SQL 테스트 — 버리는 로컬 Postgres에서만 (데이터를 지운다)
--   psql -f supabase/quiz_schema.sql && psql -f scripts/quiz-sql-speed.sql
\set ON_ERROR_STOP 1
reset role;
delete from quiz_winners where true; delete from quiz_submissions where true; delete from quiz_participants where true;
insert into quiz_config (id, operator_key) values (1, 'smoke-key') on conflict (id) do update set operator_key = excluded.operator_key;
update quiz_state set status = 'lobby', current_index = 0, opened_at = null, reveal = null, settings = '{}' where id = 1;
set role anon;
create temp table ids (team int, pid uuid);
insert into ids select t, (quiz_join_team(t, 'answerer', false, 't'||t)).id from generate_series(1,8) t;
select quiz_control('smoke-key', 'settings', '{"points":{"5":10,"6":20},"speed":{"5":{"on":true,"tiers":[{"upto":1,"mode":"x","v":3},{"upto":5,"mode":"x","v":2}]}}}');
select quiz_control('smoke-key', 'open', '{"index":5,"duration_sec":60}');
-- 조 1..7 순서대로 제출 (각각 별도 트랜잭션 → 서버 시각이 다름). 8조 미제출
select submit_answer((select pid from ids where team=1), 5, '1');
select submit_answer((select pid from ids where team=2), 5, '1');
select submit_answer((select pid from ids where team=3), 5, '2');  -- 오답
select submit_answer((select pid from ids where team=4), 5, '1');
select submit_answer((select pid from ids where team=5), 5, '1');
select submit_answer((select pid from ids where team=6), 5, '1');
select submit_answer((select pid from ids where team=7), 5, '1');
reset role;
update quiz_submissions set verdict = case when answer = '1' then 'correct' else 'wrong' end where question_index = 5;
update quiz_state set status = 'revealed' where id = 1;
set role anon;
-- 기대: 1조 30(1등×3), 2·4·5·6조 20(2~5등×2), 7조 10(6등), 3조 0
do $$
declare j json; got text;
begin
  select string_agg((e->>'team_no')||':'||(e->>'score'), ',' order by (e->>'team_no')::int) into got
    from json_array_elements(quiz_scoreboard(8)) e;
  assert got = '1:30,2:20,3:0,4:20,5:20,6:20,7:10,8:0', 'speed ×: '||got;
end $$;
-- 추가점수 모드 + 문항 6(선착순 꺼짐, 배점 20)
select quiz_control('smoke-key', 'settings', '{"speed":{"5":{"on":true,"tiers":[{"upto":2,"mode":"+","v":5}]}}}');
do $$
declare got text;
begin
  select string_agg((e->>'team_no')||':'||(e->>'score'), ',' order by (e->>'team_no')::int) into got
    from json_array_elements(quiz_scoreboard(8)) e;
  assert got = '1:15,2:15,3:0,4:10,5:10,6:10,7:10,8:0', 'speed +: '||got;
end $$;
-- 끄기
select quiz_control('smoke-key', 'settings', '{"speed":{"5":{"on":false,"tiers":[]}}}');
do $$
declare got text;
begin
  select string_agg((e->>'team_no')||':'||(e->>'score'), ',' order by (e->>'team_no')::int) into got
    from json_array_elements(quiz_scoreboard(8)) e;
  assert got = '1:10,2:10,3:0,4:10,5:10,6:10,7:10,8:0', 'speed off: '||got;
end $$;
-- null 값도 꺼짐으로
select quiz_control('smoke-key', 'settings', '{"speed":{"5":null}}');
do $$
declare got text;
begin
  select string_agg((e->>'score'), ',' order by (e->>'team_no')::int) into got from json_array_elements(quiz_scoreboard(8)) e;
  assert got = '10,10,0,10,10,10,10,0', 'speed null: '||got;
end $$;
\echo speed SQL OK
