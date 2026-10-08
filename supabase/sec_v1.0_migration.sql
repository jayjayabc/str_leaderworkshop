-- 보안 보강 (Sec v1.0, 10/8) — 독립 보안 리뷰 + Supabase 보안 어드바이저 지적 반영. 여러 번 실행해도 안전.
-- 퀴즈 함수·테이블의 동작은 바꾸지 않는다(서버 시각 함수 search_path 고정만).

-- ─────────────────────────────────────────────────────────────
-- 1. 퇴역한 코끼리보드 테이블 잠그기 (H1)
--    anon 에게 읽기·쓰기·삭제가 전부 열려 있었고 Realtime 으로도 방송되고 있었다.
--    누구나 공개 키로 대량 insert 를 해 같은 DB 를 쓰는 퀴즈·토의보드를 느리게 만들 수 있었다.
--    → 정책 삭제 · 권한 회수 · 방송 해제. 데이터는 지우지 않는다(필요하면 대시보드에서 볼 수 있음).
--    부작용: elephant-board.vercel.app 의 옛 보드 화면(/, /b/…, /admin)은 더 이상 동작하지 않는다.
-- ─────────────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['boards','participants','keywords','placements','votes','notes','events'] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop policy if exists anon_all on public.%I', t);
      execute format('revoke all on public.%I from anon, authenticated', t);
      execute format('alter table public.%I enable row level security', t);
      if exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime drop table public.%I', t);
      end if;
    end if;
  end loop;
end $$;

-- ─────────────────────────────────────────────────────────────
-- 2. 토의보드 본문 정리 강화 (L1) — 제어문자·글자 방향 뒤집기 문자 제거
--    (U+202E 등을 넣으면 송출 화면 글자가 거꾸로 보이는 장난이 가능했다)
-- ─────────────────────────────────────────────────────────────
create or replace function board_clean(p text) returns text
language sql immutable set search_path = public as $$
  select btrim(
    regexp_replace(
      regexp_replace(normalize(coalesce(p, ''), NFKC), E'\r\n?', E'\n', 'g'),
      '[\u0000-\u0008\u000B-\u001F\u007F​-‏‪-‮⁦-⁩﻿]', '', 'g'),
    E' \t\n')
$$;

-- ─────────────────────────────────────────────────────────────
-- 3. 토의보드 입장 남용 막기 (M2) — 기기 표식 필수 · 반조당 기기 20대까지
--    (앱은 항상 기기 표식을 보낸다. 스크립트로 무한 입장해 입장 수를 부풀리는 것만 막는다)
-- ─────────────────────────────────────────────────────────────
create or replace function board_join(p_team text, p_name text, p_device text)
returns json
language plpgsql security definer set search_path = public as $$
declare
  r   board_participants;
  nm  text := left(coalesce(nullif(board_clean(p_name), ''), '기록자'), 20);
  dev text := left(nullif(btrim(coalesce(p_device, '')), ''), 64);
begin
  if p_team is null or not exists (select 1 from board_teams where id = p_team) then
    raise exception 'BOARD_UNKNOWN: team';
  end if;
  if dev is null then
    raise exception 'BOARD_EMPTY: device';
  end if;
  select * into r from board_participants where device_token = dev and team_id = p_team
    order by joined_at desc limit 1;
  delete from board_participants where device_token = dev and team_id <> p_team;
  if r.id is not null then
    update board_participants set name = nm, last_seen = now() where id = r.id returning * into r;
  else
    if (select count(*) from board_participants where team_id = p_team) >= 20 then
      raise exception 'BOARD_FULL: team';
    end if;
    insert into board_participants (team_id, name, device_token) values (p_team, nm, dev) returning * into r;
  end if;
  return json_build_object('id', r.id, 'team_id', r.team_id, 'name', r.name);
end $$;

-- ─────────────────────────────────────────────────────────────
-- 4. 어드바이저 경고 정리 — search_path 고정 · 내부용 함수는 anon 호출 막기
-- ─────────────────────────────────────────────────────────────
alter function public.server_now() set search_path = public;
alter function public.board_touch_state() set search_path = public;
revoke execute on function public.board_clean(text) from public, anon, authenticated;
revoke execute on function public.board_touch_state() from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────
-- 5. 운영자 키 최소 길이 (L4) — 빈 키나 짧은 키로 바뀌지 않게
-- ─────────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ck_quiz_config_oplen') then
    alter table quiz_config add constraint ck_quiz_config_oplen check (length(operator_key) >= 16);
  end if;
end $$;
