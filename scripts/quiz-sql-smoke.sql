-- ⚠ v2.0: 단체전 기준(quiz_join_team). 조당 1건 제출 규칙이라 일부 v1 시나리오 기대값은 다를 수 있다.
-- 스피드 퀴즈 SQL 스모크 테스트 (Quiz v1.0)
-- ⚠ 운영 DB가 아니라 버리는 로컬 Postgres에서만 돌린다 (데이터를 지운다).
--
--   psql -v ON_ERROR_STOP=1 -c "create role anon nologin; create role authenticated nologin; create publication supabase_realtime;"
--   psql -v ON_ERROR_STOP=1 -f supabase/quiz_schema.sql
--   psql -v ON_ERROR_STOP=1 -f scripts/quiz-sql-smoke.sql
--
-- 모든 확인은 anon 역할로 RPC만 불러서 한다(실제 휴대폰·운영자 화면과 같은 권한).

\set ON_ERROR_STOP 1
reset role;
delete from quiz_winners; delete from quiz_submissions; delete from quiz_participants;
insert into quiz_config (id, operator_key) values (1, 'smoke-key')
  on conflict (id) do update set operator_key = excluded.operator_key;
update quiz_state set status = 'lobby', current_index = 0, opened_at = null, reveal = null,
  leaderboard = null, winner_submission_id = null, allow_edit = false, settings = '{}' where id = 1;

set role anon;

do $$
declare
  a quiz_participants; b quiz_participants;
  st quiz_state; ts timestamptz; j json; err text; snap json;
  sid_a uuid; sid_b uuid;
begin
  -- 참가
  a := quiz_join_team(3, 'answerer', false, '제인');
  b := quiz_join_team(7, 'answerer', false, '');
  assert b.name = '익명', '빈 이름은 익명';
  assert (quiz_me(a.id)).table_no = 3, 'quiz_me';

  -- 대기 중 제출 거부
  begin perform submit_answer(a.id, 1, '뱅크런'); raise exception 'should fail';
  exception when others then err := sqlerrm; end;
  assert err like 'QUIZ_CLOSED%', '대기 중 제출 거부: ' || err;

  -- 틀린 운영자 키
  begin perform quiz_control('wrong', 'open', '{"index":1,"duration_sec":30}'); raise exception 'should fail';
  exception when others then err := sqlerrm; end;
  assert err like 'QUIZ_FORBIDDEN%', '틀린 키 거부: ' || err;

  -- 테이블 직접 읽기 금지
  begin perform count(*) from quiz_submissions; raise exception 'should fail';
  exception when insufficient_privilege then err := 'denied'; end;
  assert err = 'denied', 'anon은 제출 테이블을 못 읽음';
  begin perform count(*) from quiz_participants; raise exception 'should fail';
  exception when insufficient_privilege then err := 'denied2'; end;
  assert err = 'denied2', 'anon은 참가자 테이블을 못 읽음';

  -- 열기 → 제출
  st := quiz_control('smoke-key', 'open', '{"index":1,"duration_sec":30}');
  assert st.status = 'open' and st.current_index = 1, 'open';
  assert st.settings->'opened' ? '1', 'opened 기록';
  ts := submit_answer(a.id, 1, '  뱅크런 ');
  assert ts is not null, '제출 시각 반환';

  -- 다른 번호 제출 거부
  begin perform submit_answer(a.id, 2, 'x'); raise exception 'should fail';
  exception when others then err := sqlerrm; end;
  assert err like 'QUIZ_CLOSED%', '현재 문제가 아니면 거부';

  -- 중복 제출 거부
  begin perform submit_answer(a.id, 1, '두 번째'); raise exception 'should fail';
  exception when others then err := sqlerrm; end;
  assert err like 'QUIZ_DUPLICATE%', '중복 거부: ' || err;

  -- 빈 답·모르는 참가자
  begin perform submit_answer(b.id, 1, '   '); raise exception 'should fail';
  exception when others then err := sqlerrm; end;
  assert err like 'QUIZ_EMPTY%', '빈 답 거부';
  begin perform submit_answer(gen_random_uuid(), 1, 'x'); raise exception 'should fail';
  exception when others then err := sqlerrm; end;
  assert err like 'QUIZ_UNKNOWN%', '모르는 참가자 거부';

  perform submit_answer(b.id, 1, '런닝맨');
  j := quiz_counts(1);
  assert (j->>'submissions')::int = 2 and (j->>'participants')::int = 2, 'counts ' || j::text;

  j := quiz_my_submission(a.id, 1);
  assert j->>'answer' = '뱅크런', '내 답(앞뒤 공백 제거)';

  -- 수정 허용
  perform quiz_control('smoke-key', 'settings', '{"allow_edit":true}');
  ts := submit_answer(b.id, 1, '뱅크런');
  assert (quiz_my_submission(b.id, 1))->>'answer' = '뱅크런', '수정 허용 시 덮어씀';
  perform quiz_control('smoke-key', 'settings', '{"allow_edit":false}');

  -- 마감 후 거부
  st := quiz_control('smoke-key', 'close');
  assert st.status = 'closed', 'close';
  begin perform submit_answer(a.id, 1, 'x'); raise exception 'should fail';
  exception when others then err := sqlerrm; end;
  assert err like 'QUIZ_CLOSED%', '마감 후 거부';

  -- 운영자 스냅샷 + 수상자 + 공개
  snap := quiz_admin_snapshot('smoke-key', 1);
  assert json_array_length(snap->'submissions') = 2, '스냅샷 제출 2건';
  sid_a := ((snap->'submissions')->0->>'id')::uuid;   -- 시간순 첫 번째 = a
  sid_b := ((snap->'submissions')->1->>'id')::uuid;
  st := quiz_control('smoke-key', 'set_winner', json_build_object('index', 1, 'submission_id', sid_a)::jsonb);
  assert st.winner_submission_id = sid_a, 'winner 지정';
  st := quiz_control('smoke-key', 'reveal', json_build_object(
          'reveal', json_build_object('index', 1, 'answer', '뱅크런', 'explanation', '…',
                                      'winner', json_build_object('participant_id', a.id, 'name', a.name, 'table_no', 3)),
          'verdicts', json_build_object(sid_a::text, json_build_object('auto','correct','verdict','correct'),
                                        sid_b::text, json_build_object('auto','correct','verdict','correct')))::jsonb);
  assert st.status = 'revealed' and st.reveal->>'answer' = '뱅크런', 'reveal';
  assert (quiz_my_submission(b.id, 1))->>'verdict' = 'correct', '공개 후 내 판정';

  -- 1인 1회 수상: a가 Q2에서도 첫 정답이어도 지정 불가
  st := quiz_control('smoke-key', 'next', '{"index":2}');
  assert st.status = 'lobby' and st.current_index = 2 and st.reveal is null, 'next';
  st := quiz_control('smoke-key', 'open', '{"index":2,"duration_sec":30}');
  perform submit_answer(a.id, 2, '2793만');
  perform submit_answer(b.id, 2, '2793만');
  snap := quiz_admin_snapshot('smoke-key', 2);
  begin
    perform quiz_control('smoke-key', 'set_winner',
      json_build_object('index', 2, 'submission_id', (snap->'submissions')->0->>'id')::jsonb);
    raise exception 'should fail';
  exception when others then err := sqlerrm; end;
  assert err like 'QUIZ_ALREADY_WON%', '이미 수상한 사람은 거부: ' || err;
  st := quiz_control('smoke-key', 'set_winner',
    json_build_object('index', 2, 'submission_id', (snap->'submissions')->1->>'id')::jsonb);
  assert st.winner_submission_id is not null, '다음 사람 지정';

  -- 연습 문제(0번) 첫 정답은 1인 1회에서 제외 — 이미 수상한 a도 지정할 수 있다
  perform quiz_control('smoke-key', 'next', '{"index":0}');
  perform quiz_control('smoke-key', 'open', '{"index":0,"duration_sec":30}');
  perform submit_answer(a.id, 0, '2');
  snap := quiz_admin_snapshot('smoke-key', 0);
  st := quiz_control('smoke-key', 'set_winner',
    json_build_object('index', 0, 'submission_id', (snap->'submissions')->0->>'id')::jsonb);
  assert st.winner_submission_id is not null, '연습 문제는 수상자도 첫 정답 지정 가능';

  -- 시간 초과(+2초 유예) — 운영자가 연 뒤 제한시간이 지나면 거부
  perform quiz_control('smoke-key', 'extend', '{"seconds":15}');
  assert (select duration_sec from quiz_state) = 45, 'extend +15';

  -- 문제 초기화 / 전체 초기화
  perform quiz_control('smoke-key', 'reset_question', '{"index":2}');
  assert (quiz_counts(2)->>'submissions')::int = 0, 'reset_question';
  assert json_array_length(quiz_admin_snapshot('smoke-key')->'winners') = 2, 'Q1·연습 수상자는 남음';
  perform quiz_control('smoke-key', 'final', '{"leaderboard":[]}');
  assert (select status from quiz_state) = 'final', 'final';
  perform quiz_control('smoke-key', 'reset_all', '{"participants":true}');
  assert (quiz_counts(0)->>'participants')::int = 0, 'reset_all participants';

  raise notice 'QUIZ SQL SMOKE: ALL PASSED';
end $$;

-- 제한시간 경과 거부는 opened_at을 과거로 돌려 확인한다 (운영자 권한 필요 없음 — 테스트용)
reset role;
update quiz_state set status = 'open', current_index = 5, opened_at = now() - interval '40 seconds',
  duration_sec = 30 where id = 1;
set role anon;
do $$
declare p quiz_participants; err text;
begin
  p := quiz_join_team(1, 'answerer', false, '늦은 사람');
  begin perform submit_answer(p.id, 5, '1'); raise exception 'should fail';
  exception when others then err := sqlerrm; end;
  assert err like 'QUIZ_CLOSED%', '제한시간 + 2초 지나면 거부: ' || err;
  raise notice 'QUIZ SQL TIMER: PASSED';
end $$;
reset role;
