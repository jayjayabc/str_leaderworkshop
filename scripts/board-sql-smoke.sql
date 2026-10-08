-- 토의보드 SQL 스모크 (Board v1.0) — 로컬 Postgres에서 anon 권한으로 함수 동작을 확인한다.
--   전제: quiz_schema.sql · board_v1.0 · sec_v1.0 적용, quiz_config.operator_key = 'kkkkkkkkkkkkkkkk'(16자)
--   실행: psql -v ON_ERROR_STOP=1 -f scripts/board-sql-smoke.sql   (마지막에 'BOARD SMOKE OK')
--   ⚠ 운영 DB에서 돌리지 말 것 — 마지막에 전체 초기화를 한다.

\set QUIET on
set role anon;

create temp table t_ids (k text primary key, v uuid);

do $$
declare
  a uuid; b uuid; c uuid; a2 uuid; j json; ok boolean; n int; ts timestamptz;
  procedure_expect_fail text;
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
  select count(*) into n from json_array_elements(board_feed(array['Q1-1'])) e where e ->> 'team_id' = '12A';
  if n <> 1 then raise exception 'FAIL upsert count %', n; end if;
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
  perform board_set_state('kkkkkkkkkkkkkkkk', jsonb_build_object('phase','wall','focus',
    jsonb_build_object('team_id','12A','group','Q2-3')));
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
