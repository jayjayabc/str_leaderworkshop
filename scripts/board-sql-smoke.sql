-- 토의보드 SQL 스모크 (Board v1.0 + v1.1) — 로컬 Postgres에서 anon 권한으로 함수 동작을 확인한다.
--   전제: quiz_schema.sql · board_v1.0 · sec_v1.0 · board_v1.1 적용, quiz_config.operator_key = 'kkkkkkkkkkkkkkkk'(16자)
--   실행: psql -v ON_ERROR_STOP=1 -f scripts/board-sql-smoke.sql   (마지막에 'BOARD SMOKE OK')
--   ⚠ 운영 DB에서 돌리지 말 것 — 마지막에 전체 초기화를 한다.

\set QUIET on
set role anon;

create temp table t_ids (k text primary key, v uuid);

do $$
declare
  a uuid; b uuid; c uuid; a2 uuid; j json; ok boolean; n int; ts timestamptz;
  card12a text;
begin
  perform board_reset('kkkkkkkkkkkkkkkk', 'all');

  -- 직접 접근 차단
  begin perform 1 from board_submissions; raise exception 'FAIL direct read'; exception when insufficient_privilege then null; end;
  begin insert into board_state (id) values (2); raise exception 'FAIL direct write'; exception when insufficient_privilege then null; end;
  begin perform board_check_key('kkkkkkkkkkkkkkkk'); raise exception 'FAIL check_key callable'; exception when insufficient_privilege then null; end;

  -- 입장
  a := (board_join('12A', '', 'dev-a') ->> 'id')::uuid;
  b := (board_join('12B', '  김기록 ', 'dev-b') ->> 'id')::uuid;
  c := (board_join('3A', null, 'dev-c3') ->> 'id')::uuid;
  a2 := (board_join('12A', '', 'dev-a') ->> 'id')::uuid;
  if a <> a2 then raise exception 'FAIL same device should reuse participant'; end if;
  begin perform board_join('30A', '', 'x'); raise exception 'FAIL unknown team'; exception when others then
    if sqlerrm not like 'BOARD_UNKNOWN%' then raise; end if; end;
  if (board_counts() ->> 'joined')::int <> 3 then raise exception 'FAIL joined=%', board_counts() ->> 'joined'; end if;
  -- 같은 기기가 반조를 바꾸면 예전 반조 기록은 지워진다 (유령 반조 없음)
  perform board_join('5B', '', 'dev-c');
  perform board_join('6A', '', 'dev-c');
  if (board_counts() ->> 'joined')::int <> 4 then raise exception 'FAIL ghost team: joined=%', board_counts() ->> 'joined'; end if;
  perform board_reset('kkkkkkkkkkkkkkkk', 'all');
  a := (board_join('12A', '', 'dev-a') ->> 'id')::uuid;
  b := (board_join('12B', '  김기록 ', 'dev-b') ->> 'id')::uuid;
  c := (board_join('3A', null, 'dev-c3') ->> 'id')::uuid;
  if (board_my(a) -> 'participant' ->> 'name') <> '기록자' then raise exception 'FAIL default name'; end if;

  -- 대기 중 제출 거부
  begin perform board_submit(a, '{"Q1-1":"x"}'); raise exception 'FAIL submit while waiting'; exception when others then
    if sqlerrm not like 'BOARD_CLOSED%' then raise; end if; end;
  -- 월 비공개 상태에서 읽기 거부
  begin perform board_feed(array['Q1-1']); raise exception 'FAIL feed while waiting'; exception when others then
    if sqlerrm not like 'BOARD_FORBIDDEN%' then raise; end if; end;
  -- 틀린 키
  begin perform board_set_state('nope', '{"phase":"q1_intro"}'); raise exception 'FAIL wrong key'; exception when others then
    if sqlerrm not like 'BOARD_FORBIDDEN%' then raise; end if; end;

  -- Q1-1 열기
  perform board_set_state('kkkkkkkkkkkkkkkk', '{"phase":"item_open","current_item":"Q1-1","item_open":true,"allow_edit":true,"timer_minutes":3}');
  if (select question from board_state) <> 1 then raise exception 'FAIL question derived'; end if;
  if not exists (select 1 from board_state where 'Q1-1' = any(opened_groups)) then raise exception 'FAIL opened_groups'; end if;
  if (select timer_ends_at from board_state) is null then raise exception 'FAIL timer'; end if;

  -- 다른 그룹 항목 거부 · 빈 필수 거부 · 길이 초과 거부
  begin perform board_submit(a, '{"Q1-2":"x"}'); raise exception 'FAIL other item'; exception when others then
    if sqlerrm not like 'BOARD_CLOSED%' then raise; end if; end;
  begin perform board_submit(a, '{"Q1-1":"   "}'); raise exception 'FAIL empty'; exception when others then
    if sqlerrm not like 'BOARD_EMPTY%' then raise; end if; end;
  begin perform board_submit(a, jsonb_build_object('Q1-1', repeat('가', 1001))); raise exception 'FAIL too long'; exception when others then
    if sqlerrm not like 'BOARD_TOO_LONG%' then raise; end if; end;

  -- 제출 (NFKC: 전각 Ａ → A, 앞뒤 공백 제거)
  ts := board_submit(a, '{"Q1-1":"  에이전트에게 Ａ 이체를 맡긴다  "}');
  perform board_submit(b, '{"Q1-1":"자동 저축"}');
  if (board_my(a) -> 'submissions' -> 0 ->> 'body') <> '에이전트에게 A 이체를 맡긴다' then
    raise exception 'FAIL normalize: %', board_my(a) -> 'submissions' -> 0 ->> 'body'; end if;
  if (board_counts() ->> 'submitted')::int <> 2 then raise exception 'FAIL submitted count'; end if;
  if json_array_length(board_feed(array['Q1-1'])) <> 2 then raise exception 'FAIL feed'; end if;
  -- 이름은 피드에 없다
  if (board_feed(array['Q1-1']) -> 0) ->> 'name' is not null then raise exception 'FAIL name leaked'; end if;
  -- 월 비공개면 다른 그룹 읽기 거부
  begin perform board_feed(array['Q1-2']); raise exception 'FAIL feed other group'; exception when others then
    if sqlerrm not like 'BOARD_FORBIDDEN%' then raise; end if; end;

  -- 수정 허용: 덮어쓰기 → 1장, edited_count 1
  perform board_submit(a, '{"Q1-1":"수정본"}');
  card12a := (select e ->> 'card' from json_array_elements(board_admin_snapshot('kkkkkkkkkkkkkkkk') -> 'submissions') e
              where e ->> 'team_id' = '12A' and e ->> 'item_id' = 'Q1-1');
  select count(*) into n from json_array_elements(board_feed(array['Q1-1'])) e where e ->> 'card' = card12a;
  if n <> 1 or card12a is null then raise exception 'FAIL upsert count %', n; end if;
  if (board_my(a) -> 'submissions' -> 0 ->> 'edited_count')::int <> 1 then raise exception 'FAIL edited_count'; end if;

  -- 수정 허용 끄면 두 번째 제출 거부 (같은 반조의 다른 기기도)
  perform board_set_state('kkkkkkkkkkkkkkkk', '{"allow_edit":false}');
  a2 := (board_join('12A', '', 'dev-a-2') ->> 'id')::uuid;
  begin perform board_submit(a2, '{"Q1-1":"또"}'); raise exception 'FAIL duplicate'; exception when others then
    if sqlerrm not like 'BOARD_DUPLICATE%' then raise; end if; end;
  -- 같은 반조의 두 번째 기기는 우리 반조 제출을 본다
  if (board_my(a2) -> 'submissions' -> 0 ->> 'body') <> '수정본' then raise exception 'FAIL team shared view'; end if;
  perform board_set_state('kkkkkkkkkkkkkkkk', '{"allow_edit":true}');

  -- 닫기 → 제출 거부, 월(지금 그룹)은 계속 읽힌다
  perform board_set_state('kkkkkkkkkkkkkkkk', '{"item_open":false}');
  begin perform board_submit(c, '{"Q1-1":"늦음"}'); raise exception 'FAIL closed'; exception when others then
    if sqlerrm not like 'BOARD_CLOSED%' then raise; end if; end;
  if json_array_length(board_feed(array['Q1-1'])) <> 2 then raise exception 'FAIL feed after close'; end if;

  -- Q1-4 (선택) 빈 제출 허용 → 빈 본문 저장, 월에는 안 나옴
  perform board_set_state('kkkkkkkkkkkkkkkk', '{"current_item":"Q1-4","item_open":true}');
  perform board_submit(c, '{"Q1-4":""}');
  perform board_submit(b, '{}');
  if json_array_length(board_feed(array['Q1-4'])) <> 0 then raise exception 'FAIL blank in feed'; end if;
  if (board_counts() ->> 'submitted')::int <> 2 then raise exception 'FAIL blank counted as submitted'; end if;

  -- Q2-3: 두 칸, a 필수
  perform board_set_state('kkkkkkkkkkkkkkkk', '{"current_item":"Q2-3","item_open":true}');
  if (select question from board_state) <> 2 then raise exception 'FAIL question 2'; end if;
  begin perform board_submit(a, '{"Q2-3b":"가이드"}'); raise exception 'FAIL Q2-3a required'; exception when others then
    if sqlerrm not like 'BOARD_EMPTY%' then raise; end if; end;
  perform board_submit(a, '{"Q2-3a":"주간보고 AI 초안","Q2-3b":"도구 가이드"}');
  if json_array_length(board_feed(array['Q2-3'])) <> 2 then raise exception 'FAIL Q2-3 two rows'; end if;

  -- 숨김 → 월에서 빠짐, 크게 보기 해제 / 하이라이트
  card12a := (select e ->> 'card' from json_array_elements(board_admin_snapshot('kkkkkkkkkkkkkkkk') -> 'submissions') e
              where e ->> 'team_id' = '12A' and e ->> 'item_id' = 'Q2-3a');
  perform board_set_state('kkkkkkkkkkkkkkkk', jsonb_build_object('phase','wall','focus',
    jsonb_build_object('card', card12a, 'team_id', '12A', 'group','Q2-3')));
  -- focus 에는 team_id 가 저장되지 않는다(섞여 와도 지운다)
  if (select focus ? 'team_id' from board_state) then raise exception 'FAIL focus keeps team_id'; end if;
  if (select focus ->> 'card' from board_state) <> card12a then raise exception 'FAIL focus card'; end if;
  perform board_moderate('kkkkkkkkkkkkkkkk', (select (e ->> 'id')::uuid from json_array_elements(board_feed(array['Q2-3'])) e
                               where e ->> 'item_id' = 'Q2-3a'), 'hide', '중복');
  if json_array_length(board_feed(array['Q2-3'])) <> 1 then raise exception 'FAIL hide'; end if;
  if (select focus from board_state) is not null then raise exception 'FAIL focus cleared on hide'; end if;
  begin perform board_moderate('kkkkkkkkkkkkkkkk', gen_random_uuid(), 'boom', null); raise exception 'FAIL bad action'; exception when others then
    if sqlerrm not like 'BOARD_EMPTY%' then raise; end if; end;

  -- 월 공개 → 다른 그룹도 읽힘
  perform board_set_state('kkkkkkkkkkkkkkkk', '{"wall_public":true}');
  if json_array_length(board_feed(array['Q1-1','Q1-2','Q1-3','Q1-4'])) <> 2 then raise exception 'FAIL wall public'; end if;

  -- 운영자 스냅샷: 숨김 카드 포함 전부
  j := board_admin_snapshot('kkkkkkkkkkkkkkkk');
  if json_array_length(j -> 'teams') <> 58 then raise exception 'FAIL snapshot teams'; end if;
  select count(*) into n from json_array_elements(j -> 'submissions') e where (e ->> 'hidden')::boolean;
  if n <> 1 then raise exception 'FAIL snapshot hidden'; end if;
  select count(*) into n from json_array_elements(j -> 'teams') e where (e ->> 'is_exec')::boolean;
  if n <> 8 then raise exception 'FAIL exec teams %', n; end if;

  -- 휴식 단계로 가면 입력은 자동으로 닫힌다
  perform board_set_state('kkkkkkkkkkkkkkkk', '{"phase":"break"}');
  if (select item_open from board_state) then raise exception 'FAIL item_open after break'; end if;
  -- 타이머 연장
  perform board_set_state('kkkkkkkkkkkkkkkk', '{"timer_minutes":0}');
  perform board_set_state('kkkkkkkkkkkkkkkk', '{"timer_extend_sec":60}');
  if (select timer_ends_at from board_state) < now() + interval '55 seconds' then raise exception 'FAIL extend'; end if;

  -- 그룹 초기화 / 전체 초기화
  perform board_reset('kkkkkkkkkkkkkkkk', 'group', 'Q2-3');
  if exists (select 1 from json_array_elements(board_admin_snapshot('kkkkkkkkkkkkkkkk') -> 'submissions') e where e ->> 'item_id' like 'Q2-3%') then
    raise exception 'FAIL group reset'; end if;
  perform board_reset('kkkkkkkkkkkkkkkk', 'all');
  if (board_counts() ->> 'joined')::int <> 0 then raise exception 'FAIL reset all'; end if;
  if board_my(a) is not null then raise exception 'FAIL participant gone'; end if;
  if (select phase from board_state) <> 'waiting' then raise exception 'FAIL phase reset'; end if;

  raise notice 'BOARD SMOKE OK';
end $$;

reset role;

-- Sec v1.0 확인: 기기 표식 없는 입장 거부 · 제어/방향 문자 제거 · 반조당 20대 제한
set role anon;
do $$
declare i int;
begin
  begin perform board_join('3A', '', null); raise exception 'FAIL no-device'; exception when others then
    if sqlerrm not like 'BOARD_EMPTY%' then raise; end if; end;
  for i in 1..20 loop perform board_join('7B', '', 'cap-' || i); end loop;
  begin perform board_join('7B', '', 'cap-21'); raise exception 'FAIL cap'; exception when others then
    if sqlerrm not like 'BOARD_FULL%' then raise; end if; end;
  perform board_join('7B', '', 'cap-5');   -- 이미 들어온 기기의 재입장은 된다
  perform board_reset('kkkkkkkkkkkkkkkk', 'all');
  raise notice 'SEC SMOKE OK';
end $$;
reset role;

-- ─────────────────────────────────────────────────────────────
-- Board v1.1 확인: 무기명(card) · 관전자 · 투표 · 순위 · 초기화 · 3-인자 board_join 호환 · 권한
-- ─────────────────────────────────────────────────────────────
set role anon;
do $$
declare
  K constant text := 'kkkkkkkkkkkkkkkk';
  a uuid; b uuid; c uuid; d uuid; e uuid; v uuid;
  j json; n int; r json;
  ca text; cb text; cc text; cd text; ce text; cb1 text;
  st board_state;
begin
  perform board_reset(K, 'all');

  -- 3-인자 board_join 호환(기본 기록자) · 4-인자 관전자
  a := (board_join('12A', '', 'dev-a') ->> 'id')::uuid;
  if (board_join('12A', '', 'dev-a') ->> 'role') <> 'recorder' then raise exception 'FAIL default role'; end if;
  b := (board_join('12B', '', 'dev-b') ->> 'id')::uuid;
  c := (board_join('3A', '', 'dev-c') ->> 'id')::uuid;
  d := (board_join('5A', '', 'dev-d') ->> 'id')::uuid;
  e := (board_join('6B', '', 'dev-e') ->> 'id')::uuid;
  v := (board_join('12A', '', 'dev-v', 'viewer') ->> 'id')::uuid;
  if (board_my(v) -> 'participant' ->> 'role') <> 'viewer' then raise exception 'FAIL viewer role'; end if;
  if (board_my(v) -> 'participant' ->> 'name') <> '관전자' then raise exception 'FAIL viewer default name'; end if;
  begin perform board_join('12A', '', 'dev-x', 'boss'); raise exception 'FAIL bad role'; exception when others then
    if sqlerrm not like 'BOARD_EMPTY%' then raise; end if; end;
  j := board_counts();
  if (j ->> 'joined')::int <> 5 or (j ->> 'viewers')::int <> 1 then raise exception 'FAIL counts joined/viewers %', j; end if;
  -- 같은 기기가 역할을 바꾸면 갱신(관전자만 있던 반조는 joined 에 안 잡힌다)
  perform board_join('7A', '', 'dev-r', 'viewer');
  if (board_counts() ->> 'joined')::int <> 5 then raise exception 'FAIL viewer-only team counted'; end if;
  perform board_join('7A', '', 'dev-r', 'recorder');
  if (board_counts() ->> 'joined')::int <> 6 or (board_counts() ->> 'viewers')::int <> 1 then raise exception 'FAIL role switch'; end if;
  perform board_join('7A', '', 'dev-r', 'viewer');
  if (board_counts() ->> 'viewers')::int <> 2 then raise exception 'FAIL role switch back'; end if;

  -- 2-3 열기 → item_opened_at 기록 · 관전자 제출 거부
  perform board_set_state(K, '{"phase":"item_open","current_item":"Q2-3","item_open":true}');
  if (select item_opened_at from board_state) is null then raise exception 'FAIL item_opened_at'; end if;
  begin perform board_submit(v, '{"Q2-3a":"관전자가 씀"}'); raise exception 'FAIL viewer submit'; exception when others then
    if sqlerrm not like 'BOARD_NOT_RECORDER%' then raise; end if; end;
  perform board_submit(a, '{"Q2-3a":"A안 주간보고","Q2-3b":"A안 가이드"}');
  perform board_submit(b, '{"Q2-3a":"B안 회의록","Q2-3b":"B안 기준"}');
  perform board_submit(c, '{"Q2-3a":"C안 자동화"}');
  perform board_submit(d, '{"Q2-3a":"D안 요약"}');
  perform board_submit(e, '{"Q2-3a":"E안 점검"}');

  -- 무기명: feed 에 team_id 없음 · card 16자 · 같은 반조 2-3a/b 는 같은 card · 반조 5개
  j := board_feed(array['Q2-3']);
  if position('team_id' in j::text) > 0 then raise exception 'FAIL team_id in feed'; end if;
  if length((j -> 0) ->> 'card') <> 16 then raise exception 'FAIL card length'; end if;
  select count(distinct x ->> 'card') into n from json_array_elements(j) x;
  if n <> 5 then raise exception 'FAIL distinct cards %', n; end if;
  select count(*) into n from json_array_elements(j);
  if n <> 7 then raise exception 'FAIL feed rows %', n; end if;
  ca := (select x ->> 'card' from json_array_elements(board_admin_snapshot(K) -> 'submissions') x where x ->> 'team_id' = '12A' and x ->> 'item_id' = 'Q2-3a');
  if ca is distinct from (select x ->> 'card' from json_array_elements(board_admin_snapshot(K) -> 'submissions') x where x ->> 'team_id' = '12A' and x ->> 'item_id' = 'Q2-3b') then
    raise exception 'FAIL 2-3a/b card differ'; end if;
  select count(*) into n from json_array_elements(j) x where x ->> 'card' = ca;
  if n <> 2 then raise exception 'FAIL 12A rows in feed %', n; end if;
  cb := (select x ->> 'card' from json_array_elements(board_admin_snapshot(K) -> 'submissions') x where x ->> 'team_id' = '12B' and x ->> 'item_id' = 'Q2-3a');
  cc := (select x ->> 'card' from json_array_elements(board_admin_snapshot(K) -> 'submissions') x where x ->> 'team_id' = '3A' and x ->> 'item_id' = 'Q2-3a');
  cd := (select x ->> 'card' from json_array_elements(board_admin_snapshot(K) -> 'submissions') x where x ->> 'team_id' = '5A' and x ->> 'item_id' = 'Q2-3a');
  ce := (select x ->> 'card' from json_array_elements(board_admin_snapshot(K) -> 'submissions') x where x ->> 'team_id' = '6B' and x ->> 'item_id' = 'Q2-3a');
  if board_admin_snapshot(K) -> 'submissions' -> 0 ->> 'team_id' is null then raise exception 'FAIL admin team_id'; end if;
  -- 내 반조 제출에는 우리 card 가 있다(투표 화면에서 우리 카드 표시용)
  if (board_my(a) -> 'submissions' -> 0 ->> 'card') <> ca then raise exception 'FAIL board_my card'; end if;
  -- by_group: 보이는 카드를 낸 반조 수
  if (board_counts() -> 'by_group' ->> 'Q2-3')::int <> 5 then raise exception 'FAIL by_group %', board_counts() -> 'by_group'; end if;

  -- 투표: 마감 중 · 투표 대상 아님
  perform board_set_state(K, '{"phase":"wall"}');
  begin perform board_vote(a, 'Q2-3', cb, true); raise exception 'FAIL vote while closed'; exception when others then
    if sqlerrm not like 'BOARD_CLOSED%' then raise; end if; end;
  perform board_set_state(K, '{"vote_open":true}');
  begin perform board_vote(a, 'Q1-1', cb, true); raise exception 'FAIL vote non-target group'; exception when others then
    if sqlerrm not like 'BOARD_CLOSED%' then raise; end if; end;
  begin perform board_vote(a, 'Q2-3', 'deadbeefdeadbeef', true); raise exception 'FAIL vote unknown card'; exception when others then
    if sqlerrm not like 'BOARD_UNKNOWN%' then raise; end if; end;
  begin perform board_vote(gen_random_uuid(), 'Q2-3', cb, true); raise exception 'FAIL vote unknown participant'; exception when others then
    if sqlerrm not like 'BOARD_UNKNOWN%' then raise; end if; end;
  -- 자기 반조 카드 거부(관전자 v 도 12A 소속)
  begin perform board_vote(a, 'Q2-3', ca, true); raise exception 'FAIL own card'; exception when others then
    if sqlerrm not like 'BOARD_OWN_CARD%' then raise; end if; end;
  begin perform board_vote(v, 'Q2-3', ca, true); raise exception 'FAIL own card (viewer)'; exception when others then
    if sqlerrm not like 'BOARD_OWN_CARD%' then raise; end if; end;
  -- 3표 · 4번째 거부 · 같은 카드 재투표는 표를 더 쓰지 않음
  r := board_vote(a, 'Q2-3', cb, true);
  r := board_vote(a, 'Q2-3', cc, true);
  r := board_vote(a, 'Q2-3', cb, true);
  if (r ->> 'left')::int <> 1 then raise exception 'FAIL idempotent vote left %', r; end if;
  r := board_vote(a, 'Q2-3', cd, true);
  if (r ->> 'left')::int <> 0 or json_array_length(r -> 'my') <> 3 then raise exception 'FAIL left after 3 votes %', r; end if;
  begin perform board_vote(a, 'Q2-3', ce, true); raise exception 'FAIL 4th vote'; exception when others then
    if sqlerrm not like 'BOARD_VOTE_LIMIT%' then raise; end if; end;
  -- 취소 후 재투표
  r := board_vote(a, 'Q2-3', cc, false);
  if (r ->> 'left')::int <> 1 or json_array_length(r -> 'my') <> 2 then raise exception 'FAIL cancel %', r; end if;
  r := board_vote(a, 'Q2-3', ce, true);
  if (r ->> 'left')::int <> 0 then raise exception 'FAIL revote after cancel %', r; end if;
  if (board_my_votes(a, 'Q2-3') ->> 'left')::int <> 0 then raise exception 'FAIL my_votes'; end if;
  if (board_my_votes(v, 'Q2-3') ->> 'left')::int <> 3 then raise exception 'FAIL my_votes (viewer fresh)'; end if;
  -- 다른 기기(관전자 v)도 3표를 따로 가진다
  perform board_vote(v, 'Q2-3', cb, true);
  perform board_vote(v, 'Q2-3', cd, true);
  -- 집계: 투표 기기 2
  if (board_counts() ->> 'voters')::int <> 2 then raise exception 'FAIL voters %', board_counts(); end if;
  j := board_admin_snapshot(K);
  if (j ->> 'voters')::int <> 2 then raise exception 'FAIL snapshot voters'; end if;
  if (select (x ->> 'votes')::int from json_array_elements(j -> 'votes') x where x ->> 'group_key' = 'Q2-3' and x ->> 'team_id' = '12B') <> 2 then
    raise exception 'FAIL snapshot votes 12B'; end if;

  -- 순위: 비공개면 거부 → 공개하면 득표순(12B 2표 · 5A 2표 · …), team_id 없음
  begin perform board_ranking('Q2-3'); raise exception 'FAIL ranking while hidden'; exception when others then
    if sqlerrm not like 'BOARD_FORBIDDEN%' then raise; end if; end;
  perform board_set_state(K, '{"vote_open":false,"vote_reveal":true}');
  begin perform board_vote(a, 'Q2-3', cc, true); raise exception 'FAIL vote after close'; exception when others then
    if sqlerrm not like 'BOARD_CLOSED%' then raise; end if; end;
  r := board_ranking('Q2-3');
  if position('team_id' in r::text) > 0 then raise exception 'FAIL team_id in ranking'; end if;
  if json_array_length(r) <> 5 then raise exception 'FAIL ranking rows %', json_array_length(r); end if;
  if (r -> 0 ->> 'votes')::int <> 2 or (r -> 1 ->> 'votes')::int <> 2 or (r -> 4 ->> 'votes')::int <> 0 then
    raise exception 'FAIL ranking order %', r; end if;
  if (r -> 0 ->> 'card') not in (cb, cd) then raise exception 'FAIL ranking top'; end if;
  select json_array_length(x -> 'parts') into n from json_array_elements(r) x where x ->> 'card' = cb;
  if n <> 2 then raise exception 'FAIL ranking parts % (12B has 2-3a and 2-3b)', n; end if;
  begin perform board_ranking('Q1-1'); raise exception 'FAIL ranking non-target'; exception when others then
    if sqlerrm not like 'BOARD_FORBIDDEN%' then raise; end if; end;

  -- 숨긴 카드는 순위·내 표에서 빠진다
  perform board_moderate(K, (select (x ->> 'id')::uuid from json_array_elements(board_admin_snapshot(K) -> 'submissions') x
                             where x ->> 'team_id' = '5A' and x ->> 'item_id' = 'Q2-3a'), 'hide', '테스트');
  if json_array_length(board_ranking('Q2-3')) <> 4 then raise exception 'FAIL hidden in ranking'; end if;
  if (board_my_votes(a, 'Q2-3') ->> 'left')::int <> 1 then raise exception 'FAIL left after hide %', board_my_votes(a, 'Q2-3'); end if;

  -- 투표 대상 설정: 존재하지 않는 그룹 거부 · 비우면 순위 거부
  begin perform board_set_state(K, '{"vote_items":["Q9-9"]}'); raise exception 'FAIL bad vote_items'; exception when others then
    if sqlerrm not like 'BOARD_UNKNOWN%' then raise; end if; end;
  perform board_set_state(K, '{"vote_items":["Q2-3","Q2-2"]}');
  if (select cardinality(vote_items) from board_state) <> 2 then raise exception 'FAIL vote_items set'; end if;
  perform board_set_state(K, '{"vote_items":[]}');
  begin perform board_ranking('Q2-3'); raise exception 'FAIL ranking after untargeting'; exception when others then
    if sqlerrm not like 'BOARD_FORBIDDEN%' then raise; end if; end;
  perform board_set_state(K, '{"vote_items":["Q2-3"]}');

  -- 크게 보기: card 비교로 숨김 시 해제
  perform board_set_state(K, jsonb_build_object('focus', jsonb_build_object('card', cd, 'team_id', '5A', 'group', 'Q2-3')));
  if (select focus ? 'team_id' from board_state) then raise exception 'FAIL focus team_id kept'; end if;
  perform board_moderate(K, (select (x ->> 'id')::uuid from json_array_elements(board_admin_snapshot(K) -> 'submissions') x
                             where x ->> 'team_id' = '5A' and x ->> 'item_id' = 'Q2-3a'), 'unhide', null);
  perform board_set_state(K, jsonb_build_object('focus', jsonb_build_object('card', cd, 'group', 'Q2-3')));
  perform board_moderate(K, (select (x ->> 'id')::uuid from json_array_elements(board_admin_snapshot(K) -> 'submissions') x
                             where x ->> 'team_id' = '5A' and x ->> 'item_id' = 'Q2-3a'), 'hide', null);
  if (select focus from board_state) is not null then raise exception 'FAIL focus not cleared by card'; end if;
  perform board_moderate(K, (select (x ->> 'id')::uuid from json_array_elements(board_admin_snapshot(K) -> 'submissions') x
                             where x ->> 'team_id' = '5A' and x ->> 'item_id' = 'Q2-3a'), 'unhide', null);

  -- item_opened_at: 닫으면 비고, 다시 열면 새로 찍힌다
  perform board_set_state(K, '{"phase":"item_open","current_item":"Q2-3","item_open":true}');
  if (select item_opened_at from board_state) is null then raise exception 'FAIL reopen item_opened_at'; end if;
  perform board_set_state(K, '{"item_open":false}');
  if (select item_opened_at from board_state) is not null then raise exception 'FAIL item_opened_at on close'; end if;

  -- 초기화: 그룹 초기화는 그 그룹 투표도 지운다
  perform board_set_state(K, '{"phase":"wall","vote_reveal":false,"vote_open":true}');
  perform board_vote(a, 'Q2-3', cb, true);
  perform board_reset(K, 'group', 'Q2-3');
  if (select count(*) from json_array_elements(board_admin_snapshot(K) -> 'votes')) <> 0 then raise exception 'FAIL group reset votes'; end if;
  -- 전체 초기화: 투표·상태 초기화
  perform board_set_state(K, '{"phase":"item_open","current_item":"Q2-3","item_open":true}');
  perform board_submit(b, '{"Q2-3a":"다시 B"}');
  perform board_submit(c, '{"Q2-3a":"다시 C"}');
  perform board_set_state(K, '{"phase":"wall","vote_open":true}');
  perform board_vote(a, 'Q2-3', (select x ->> 'card' from json_array_elements(board_feed(array['Q2-3'])) x limit 1), true);
  perform board_reset(K, 'all');
  select * into st from board_state;
  if st.vote_open or st.vote_reveal or st.item_opened_at is not null then raise exception 'FAIL reset all vote flags'; end if;
  if (select count(*) from json_array_elements(board_admin_snapshot(K) -> 'votes')) <> 0 then raise exception 'FAIL reset all votes'; end if;

  raise notice 'BOARD V1.1 SMOKE OK';
end $$;
reset role;

-- v1.1 권한: 새 테이블 직접 접근 차단 · 내부 함수 호출 차단
set role anon;
do $$
begin
  begin perform 1 from board_secret; raise exception 'FAIL board_secret readable'; exception when insufficient_privilege then null; end;
  begin perform 1 from board_votes; raise exception 'FAIL board_votes readable'; exception when insufficient_privilege then null; end;
  begin perform board_card_key('12A', 'Q1-1'); raise exception 'FAIL card_key callable'; exception when insufficient_privilege then null; end;
  begin perform board_votes_json(gen_random_uuid(), 'Q2-3'); raise exception 'FAIL votes_json callable'; exception when insufficient_privilege then null; end;
  begin perform board_clean('x'); raise exception 'FAIL clean callable'; exception when insufficient_privilege then null; end;
  begin insert into board_votes (participant_id, group_key, team_id) values (gen_random_uuid(), 'Q2-3', '12A'); raise exception 'FAIL votes writable'; exception when insufficient_privilege then null; end;
  raise notice 'BOARD V1.1 PERMISSIONS OK';
end $$;
reset role;

-- ─────────────────────────────────────────────────────────────
-- v1.2 SUMMARY — AI 갈무리 (board_v1.2_migration.sql 적용 필요)
-- ─────────────────────────────────────────────────────────────
set role anon;
do $$
declare
  K constant text := 'kkkkkkkkkkkkkkkk';
  a uuid; b uuid; c uuid;
  src jsonb; sv jsonb; st board_state; n int; sid uuid;
begin
  perform board_reset(K, 'all');
  a := (board_join('12A', '', 'sum-a') ->> 'id')::uuid;
  b := (board_join('12B', '', 'sum-b') ->> 'id')::uuid;
  c := (board_join('3A', '', 'sum-c') ->> 'id')::uuid;
  perform board_set_state(K, '{"phase":"item_open","current_item":"Q2-3","item_open":true}');
  perform board_submit(a, '{"Q2-3a":"A조 해 보겠다 회의록","Q2-3b":"A조 가이드"}');
  perform board_submit(b, '{"Q2-3a":"B조 주간보고 초안","Q2-3b":""}');
  perform board_submit(c, '{"Q2-3a":"C조 숨길 답","Q2-3b":"C조 지원"}');
  perform board_set_state(K, '{"phase":"wall"}');
  -- C조 Q2-3a 숨김
  perform board_moderate(K, (select (x ->> 'id')::uuid from json_array_elements(board_admin_snapshot(K) -> 'submissions') x
                             where x ->> 'team_id' = '3A' and x ->> 'item_id' = 'Q2-3a'), 'hide', null);

  -- 원문: 키 필수 · 그룹 검증
  begin perform board_summary_source('wrong-key-xxxxxxx', 'Q2-3'); raise exception 'FAIL source bad key'; exception when others then
    if sqlerrm not like 'BOARD_FORBIDDEN%' then raise; end if; end;
  begin perform board_summary_source(null, 'Q2-3'); raise exception 'FAIL source null key'; exception when others then
    if sqlerrm not like 'BOARD_FORBIDDEN%' then raise; end if; end;
  begin perform board_summary_source(K, 'Q9-9'); raise exception 'FAIL source unknown group'; exception when others then
    if sqlerrm not like 'BOARD_UNKNOWN%' then raise; end if; end;
  src := board_summary_source(K, 'Q2-3');
  if jsonb_array_length(src -> 'items') <> 2 then raise exception 'FAIL source items'; end if;
  if (src -> 'items' -> 0 ->> 'item_id') <> 'Q2-3a' then raise exception 'FAIL source item order'; end if;
  -- 보이는 답만: A 2건 + B 1건(빈 b 제외) + C 1건(숨김 제외) = 4
  if jsonb_array_length(src -> 'answers') <> 4 then raise exception 'FAIL source answers=%', jsonb_array_length(src -> 'answers'); end if;
  if src::text like '%숨길 답%' then raise exception 'FAIL source leaks hidden'; end if;
  if src::text like '%team_id%' or src::text like '%"card"%' or src::text ~ '"?(12|3)[AB]"?' then raise exception 'FAIL source leaks team/card: %', src; end if;
  if exists (select 1 from jsonb_array_elements(src -> 'answers') x where jsonb_typeof(x) <> 'object' or (select count(*) from jsonb_object_keys(x)) <> 2) then
    raise exception 'FAIL source answer keys';
  end if;

  -- 저장: 키·그룹·형식 검증
  begin perform board_summary_save('wrong-key-xxxxxxx', 'Q2-3', '{"headline":"x"}', 'm', 4); raise exception 'FAIL save bad key'; exception when others then
    if sqlerrm not like 'BOARD_FORBIDDEN%' then raise; end if; end;
  begin perform board_summary_save(K, 'Q9-9', '{"headline":"x"}', 'm', 4); raise exception 'FAIL save unknown group'; exception when others then
    if sqlerrm not like 'BOARD_UNKNOWN%' then raise; end if; end;
  begin perform board_summary_save(K, 'Q2-3', '[1]'::jsonb, 'm', 4); raise exception 'FAIL save non-object'; exception when others then
    if sqlerrm not like 'BOARD_EMPTY%' then raise; end if; end;
  begin perform board_summary_save(K, 'Q2-3', null, 'm', 4); raise exception 'FAIL save null'; exception when others then
    if sqlerrm not like 'BOARD_EMPTY%' then raise; end if; end;
  begin perform board_summary_save(K, 'Q2-3', jsonb_build_object('headline', repeat('가', 30000)), 'm', 4); raise exception 'FAIL save too long'; exception when others then
    if sqlerrm not like 'BOARD_TOO_LONG%' then raise; end if; end;
  sv := board_summary_save(K, 'Q2-3', '{"headline":"첫 번째","takeaway":"t","sections":[]}', 'fake', 4);
  if sv ->> 'group' <> 'Q2-3' or (sv -> 'data' ->> 'headline') <> '첫 번째' or (sv ->> 'source_count')::int <> 4 or sv ->> 'model' <> 'fake' then
    raise exception 'FAIL save result %', sv;
  end if;
  -- 덮어쓰기(upsert)
  perform board_summary_save(K, 'Q2-3', '{"headline":"두 번째","takeaway":"t","sections":[]}', 'fake', 4);
  if (select count(*) from jsonb_array_elements(board_summary_list(K))) <> 1 then raise exception 'FAIL list count after upsert'; end if;
  if (board_summary_list(K) -> 0 -> 'data' ->> 'headline') <> '두 번째' then raise exception 'FAIL upsert value'; end if;
  begin perform board_summary_list('wrong-key-xxxxxxx'); raise exception 'FAIL list bad key'; exception when others then
    if sqlerrm not like 'BOARD_FORBIDDEN%' then raise; end if; end;

  -- 직접 접근 차단
  begin perform 1 from board_summaries; raise exception 'FAIL board_summaries readable'; exception when insufficient_privilege then null; end;
  begin insert into board_summaries (group_key, data) values ('Q1-1', '{}'); raise exception 'FAIL board_summaries writable'; exception when insufficient_privilege then null; end;
  begin update board_state set summary = '{"x":1}'::jsonb where id = 1; raise exception 'FAIL state.summary writable'; exception when insufficient_privilege then null; end;

  -- 송출: 키 필요 · 없는 저장본 거부 · state.summary 에 실림
  begin perform board_summary_show('wrong-key-xxxxxxx', 'Q2-3'); raise exception 'FAIL show bad key'; exception when others then
    if sqlerrm not like 'BOARD_FORBIDDEN%' then raise; end if; end;
  begin perform board_summary_show(K, 'Q1-1'); raise exception 'FAIL show missing'; exception when others then
    if sqlerrm not like 'BOARD_UNKNOWN%' then raise; end if; end;
  st := board_summary_show(K, 'Q2-3');
  if st.summary is null or st.summary ->> 'group' <> 'Q2-3' then raise exception 'FAIL show result'; end if;
  -- anon 이 board_state 를 직접 읽어도 summary 가 보인다(송출 화면용) — 그리고 반조 정보는 없다
  if (select summary ->> 'group' from board_state where id = 1) <> 'Q2-3' then raise exception 'FAIL state read summary'; end if;
  if (select summary::text from board_state where id = 1) ~ '(team_id|"card")' then raise exception 'FAIL summary leaks team'; end if;

  -- 송출 중에 다시 저장하면 송출본도 갱신
  perform board_summary_save(K, 'Q2-3', '{"headline":"세 번째","takeaway":"t","sections":[]}', 'fake', 4);
  if (select summary -> 'data' ->> 'headline' from board_state where id = 1) <> '세 번째' then raise exception 'FAIL on-air refresh'; end if;
  -- 송출 중이 아닌 그룹 저장은 송출본을 안 건드린다
  perform board_summary_save(K, 'Q1-1', '{"headline":"딴 그룹","takeaway":"t","sections":[]}', 'fake', 1);
  if (select summary ->> 'group' from board_state where id = 1) <> 'Q2-3' then raise exception 'FAIL other group touched on-air'; end if;

  -- 내리기
  st := board_summary_show(K, null);
  if st.summary is not null then raise exception 'FAIL show null'; end if;
  perform board_summary_show(K, 'Q2-3');
  st := board_summary_show(K, '');
  if st.summary is not null then raise exception 'FAIL show empty'; end if;

  -- 자동 해제: 탭(current_item) 변경
  perform board_summary_show(K, 'Q2-3');
  perform board_set_state(K, '{"screen_theme":"light"}');   -- 다른 키 변경은 유지
  if (select summary from board_state) is null then raise exception 'FAIL summary dropped by unrelated patch'; end if;
  perform board_set_state(K, '{"current_item":"Q2-3"}');      -- 같은 탭으로 다시 지정해도 유지
  if (select summary from board_state) is null then raise exception 'FAIL summary dropped by same item'; end if;
  perform board_set_state(K, '{"current_item":"Q2-2"}');
  if (select summary from board_state) is not null then raise exception 'FAIL summary kept after tab change'; end if;
  perform board_set_state(K, '{"screen_theme":"dark"}');
  -- 자동 해제: phase 변경
  perform board_set_state(K, '{"current_item":"Q2-3"}');
  perform board_summary_show(K, 'Q2-3');
  perform board_set_state(K, '{"phase":"break"}');
  if (select summary from board_state) is not null then raise exception 'FAIL summary kept after phase change'; end if;
  perform board_set_state(K, '{"phase":"wall"}');
  -- 저장본은 자동 해제와 무관하게 남는다
  if (select count(*) from jsonb_array_elements(board_summary_list(K))) <> 2 then raise exception 'FAIL saved lost after auto-clear'; end if;

  -- 관리자 스냅샷에 summary 가 실린다
  perform board_summary_show(K, 'Q2-3');
  if (board_admin_snapshot(K) -> 'state' -> 'summary' ->> 'group') <> 'Q2-3' then raise exception 'FAIL snapshot summary'; end if;

  -- 초기화: 그룹
  perform board_reset(K, 'group', 'Q1-1');
  if (select count(*) from jsonb_array_elements(board_summary_list(K))) <> 1 then raise exception 'FAIL reset group deletes summary'; end if;
  if (select summary from board_state) is null then raise exception 'FAIL reset other group cleared on-air'; end if;
  perform board_reset(K, 'group', 'Q2-3');
  if (select count(*) from jsonb_array_elements(board_summary_list(K))) <> 0 then raise exception 'FAIL reset group Q2-3 summary'; end if;
  if (select summary from board_state) is not null then raise exception 'FAIL reset group on-air summary'; end if;
  -- 초기화: 전체
  perform board_summary_save(K, 'Q1-1', '{"headline":"a"}', 'm', 1);
  perform board_summary_save(K, 'Q2-1', '{"headline":"b"}', 'm', 1);
  perform board_summary_show(K, 'Q2-1');
  perform board_reset(K, 'all');
  if (select count(*) from jsonb_array_elements(board_summary_list(K))) <> 0 then raise exception 'FAIL reset all summaries'; end if;
  if (select summary from board_state) is not null then raise exception 'FAIL reset all on-air'; end if;

  raise notice 'SUMMARY OK';
end $$;
reset role;
