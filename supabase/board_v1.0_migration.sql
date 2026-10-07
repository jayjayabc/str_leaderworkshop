-- 토의보드 스키마 (Board v1.0) — 리더 토론세션(10/14 D2 15:50~17:00)
-- Supabase 대시보드 > SQL Editor 에 붙여넣어 실행한다. 여러 번 실행해도 안전하다(idempotent).
-- ▶ 적용 순서: 이 SQL 먼저, 코드 배포는 그다음 (퀴즈 v1.1과 같은 규칙).
-- ▶ quiz_schema.sql 이 먼저 적용돼 있어야 한다 — 운영자 키는 quiz_config.operator_key 를 그대로 쓴다
--   (퀴즈 /quiz/admin 과 같은 키. 키를 두 곳에 두면 엇갈리므로 board_config 는 만들지 않았다).
-- 퀴즈·보드 테이블은 건드리지 않는다. 새 객체는 모두 board_ 접두사.
--
-- 보안 모델 (퀴즈와 같다)
--   - 모든 board_ 테이블에 RLS. anon이 직접 읽을 수 있는 것은 board_state 한 행뿐이다.
--   - 입장·제출·내 반조 답·집계·월 읽기는 SECURITY DEFINER 함수(RPC)로만 한다.
--   - 제출 가능 여부(열린 항목·현재 그룹·수정 허용)는 서버가 판정하고, 제출 시각은 서버 now()다.
--   - 월 읽기(board_feed)는 지금 송출 중인 항목이거나 운영자가 '월 공개'를 켰을 때만 된다.
--   - 운영 조작은 board_check_key(= quiz_config.operator_key)로 확인한다.

create extension if not exists "pgcrypto";

-- ─────────────────────────────────────────────────────────────
-- 테이블
-- ─────────────────────────────────────────────────────────────

create table if not exists board_state (
  id             int primary key default 1 check (id = 1),
  phase          text not null default 'waiting'
                 check (phase in ('waiting','q1_intro','item_open','wall','break','q2_intro','ended')),
  question       int check (question in (1, 2)),
  current_item   text,                       -- 항목 그룹: Q1-1 … Q1-4, Q2-1, Q2-2, Q2-3
  item_open      boolean not null default false,
  opened_groups  text[] not null default '{}',  -- 한 번이라도 열렸던 그룹(참가자 화면의 '지난 항목')
  wall_public    boolean not null default false,
  allow_edit     boolean not null default true,
  timer_ends_at  timestamptz,
  screen_theme   text not null default 'dark' check (screen_theme in ('dark','light')),
  sound_on       boolean not null default false,
  scroll_speed   int not null default 40 check (scroll_speed between 0 and 400),  -- 송출 월 자동 스크롤 px/s (0 = 끔)
  focus          jsonb,                      -- 크게 보기 카드 {id, team_id, group, items:[{item_id, body}]}
  updated_at     timestamptz not null default now()
);
insert into board_state (id) values (1) on conflict (id) do nothing;
-- Realtime UPDATE 이벤트에 행 전체를 싣는다 — 바뀌지 않은 큰 칸(focus)이 빠져 크게 보기가 사라지지 않게
alter table board_state replica identity full;

create table if not exists board_items (
  id         text primary key,
  question   int  not null check (question in (1, 2)),
  ord        int  not null,
  group_key  text not null,
  title      text not null,
  prompt     text not null,
  hint       text[] not null default '{}',
  example    text,
  required   boolean not null default true
);

create table if not exists board_teams (
  id             text primary key,            -- '12A'
  table_no       int  not null check (table_no between 1 and 29),
  half           text not null check (half in ('A','B')),
  is_exec        boolean not null default false,
  expected_size  int  not null default 4 check (expected_size in (3, 4))
);

create table if not exists board_participants (
  id            uuid primary key default gen_random_uuid(),
  team_id       text not null references board_teams(id) on delete cascade,
  name          text not null default '기록자',
  device_token  text,
  joined_at     timestamptz not null default now(),
  last_seen     timestamptz not null default now()
);
create index if not exists idx_board_part_team on board_participants (team_id);
create index if not exists idx_board_part_device on board_participants (device_token, team_id);

create table if not exists board_submissions (
  id            uuid primary key default gen_random_uuid(),
  team_id       text not null references board_teams(id) on delete cascade,
  item_id       text not null references board_items(id) on delete cascade,
  body          text not null default '',
  submitted_at  timestamptz not null default now(),   -- 서버 시각(첫 제출)
  updated_at    timestamptz not null default now(),   -- 서버 시각(마지막 제출)
  edited_count  int not null default 0,
  hidden        boolean not null default false,
  hidden_note   text,
  highlighted   boolean not null default false,
  unique (team_id, item_id)
);
create index if not exists idx_board_sub_item_time on board_submissions (item_id, updated_at desc);

-- ─────────────────────────────────────────────────────────────
-- 시드 — 문구는 진행안 v2 기준 (src/lib/boardSeed.ts 와 같다)
-- ─────────────────────────────────────────────────────────────

insert into board_items (id, question, ord, group_key, title, prompt, hint, example, required) values
  ('Q1-1', 1, 1, 'Q1-1', '나의 변화', 'AI 에이전트 시대에 나는 금융을 이렇게 쓰게 될 것 같다',
     array['키노트 사례처럼 에이전트가 내 돈을 움직여 준다면 무엇부터 맡길까','에이전트가 금리를 다 비교해 준다면 그래도 내가 고르는 은행은 어디이고 왜일까','앱을 열지 않아도 된다면 내가 굳이 앱을 여는 순간은 언제일까'], null, true),
  ('Q1-2', 1, 2, 'Q1-2', '남았으면 하는 것', '그래도 은행에 남았으면 하는 것',
     array['키노트 사례처럼 에이전트가 내 돈을 움직여 준다면 무엇부터 맡길까','에이전트가 금리를 다 비교해 준다면 그래도 내가 고르는 은행은 어디이고 왜일까','앱을 열지 않아도 된다면 내가 굳이 앱을 여는 순간은 언제일까'], null, true),
  ('Q1-3', 1, 3, 'Q1-3', '바뀌었으면 하는 것', '바뀌었으면 하는 것',
     array['키노트 사례처럼 에이전트가 내 돈을 움직여 준다면 무엇부터 맡길까','에이전트가 금리를 다 비교해 준다면 그래도 내가 고르는 은행은 어디이고 왜일까','앱을 열지 않아도 된다면 내가 굳이 앱을 여는 순간은 언제일까'], null, true),
  ('Q1-4', 1, 4, 'Q1-4', '카뱅이 준비할 것', '그래서 카뱅이 내년에 먼저 준비했으면 하는 것',
     array['키노트 사례처럼 에이전트가 내 돈을 움직여 준다면 무엇부터 맡길까','에이전트가 금리를 다 비교해 준다면 그래도 내가 고르는 은행은 어디이고 왜일까','앱을 열지 않아도 된다면 내가 굳이 앱을 여는 순간은 언제일까'], null, false),
  ('Q2-1', 2, 5, 'Q2-1', '막힌 것', '올해 AI를 써 보니 우리는 ___ 때문에 막혔다(어려웠다)',
     array['AI에 맡겨 봤는데 생각보다 안 된 일은? 데이터·절차·숙련도·도구 중 무엇이 막았나','AI로 빨라진 일 뒤에서 오히려 느려진 일(의사결정·검토)은 없나','AI를 들였는데 여전히 예전 순서대로 하는 일은?','내일 당장 팀에서 바꿀 수 있는 일하는 순서 하나는?'],
     '토큰은 많이 쓰는데 정확하게 쓸 줄 몰라 결과가 안 나왔다', true),
  ('Q2-2', 2, 6, 'Q2-2', '일하는 방식', '그래서 앞으로는 ___ 하게 일해야 한다',
     array['AI에 맡겨 봤는데 생각보다 안 된 일은? 데이터·절차·숙련도·도구 중 무엇이 막았나','AI로 빨라진 일 뒤에서 오히려 느려진 일(의사결정·검토)은 없나','AI를 들였는데 여전히 예전 순서대로 하는 일은?','내일 당장 팀에서 바꿀 수 있는 일하는 순서 하나는?'],
     '잘 된 프롬프트·사례를 팀에서 공유하며 일한다', true),
  ('Q2-3a', 2, 7, 'Q2-3', '당장 할 것', '당장 ___ 부터 해 보겠다',
     array['AI에 맡겨 봤는데 생각보다 안 된 일은? 데이터·절차·숙련도·도구 중 무엇이 막았나','AI로 빨라진 일 뒤에서 오히려 느려진 일(의사결정·검토)은 없나','AI를 들였는데 여전히 예전 순서대로 하는 일은?','내일 당장 팀에서 바꿀 수 있는 일하는 순서 하나는?'],
     '다음 주 주간보고를 AI 초안으로 만들어 보겠다', true),
  ('Q2-3b', 2, 8, 'Q2-3', '회사가 지원해 줬으면 하는 것', '회사가 지원해 줬으면 하는 것: ___',
     array['AI에 맡겨 봤는데 생각보다 안 된 일은? 데이터·절차·숙련도·도구 중 무엇이 막았나','AI로 빨라진 일 뒤에서 오히려 느려진 일(의사결정·검토)은 없나','AI를 들였는데 여전히 예전 순서대로 하는 일은?','내일 당장 팀에서 바꿀 수 있는 일하는 순서 하나는?'],
     '회사는 팀별 도구 가이드를 준비해 달라', false)
on conflict (id) do update set
  question = excluded.question, ord = excluded.ord, group_key = excluded.group_key, title = excluded.title,
  prompt = excluded.prompt, hint = excluded.hint, example = excluded.example, required = excluded.required;

-- 58개 반조 (1A … 29B). 임원 테이블 8·13·14·18. expected_size 는 기본 4 —
-- 7명 테이블(6개)이 확정되면 해당 B 반조만 3으로 바꾼다:  update board_teams set expected_size = 3 where id in ('..B', …);
insert into board_teams (id, table_no, half, is_exec)
select t::text || h, t, h, t in (8, 13, 14, 18)
from generate_series(1, 29) as t, unnest(array['A','B']) as h
on conflict (id) do update set table_no = excluded.table_no, half = excluded.half, is_exec = excluded.is_exec;

-- ─────────────────────────────────────────────────────────────
-- RLS — board_state만 읽기 허용, 나머지는 함수로만
-- ─────────────────────────────────────────────────────────────

alter table board_state        enable row level security;
alter table board_items        enable row level security;
alter table board_teams        enable row level security;
alter table board_participants enable row level security;
alter table board_submissions  enable row level security;

drop policy if exists board_state_read on board_state;
create policy board_state_read on board_state for select to anon, authenticated using (true);

revoke all on board_items, board_teams, board_participants, board_submissions from anon, authenticated;
revoke insert, update, delete on board_state from anon, authenticated;
grant select on board_state to anon, authenticated;

-- Realtime: board_state 변경만 방송한다(제출은 방송하지 않는다)
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'board_state'
     ) then
    alter publication supabase_realtime add table board_state;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────
-- 내부 함수
-- ─────────────────────────────────────────────────────────────

create or replace function board_check_key(p_key text) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if p_key is null or btrim(p_key) = ''
     or not exists (select 1 from quiz_config where id = 1 and operator_key = p_key) then
    raise exception 'BOARD_FORBIDDEN';
  end if;
end $$;

-- 본문 정리: NFKC · 앞뒤 공백 제거 · 줄바꿈 정리
create or replace function board_clean(p text) returns text
language sql immutable as $$
  select btrim(regexp_replace(normalize(coalesce(p, ''), NFKC), E'\r\n?', E'\n', 'g'), E' \t\n')
$$;

create or replace function board_touch_state() returns trigger
language plpgsql as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end $$;

drop trigger if exists trg_board_state_touch on board_state;
create trigger trg_board_state_touch before update on board_state
for each row execute function board_touch_state();

-- ─────────────────────────────────────────────────────────────
-- 공개 함수 (anon)
-- ─────────────────────────────────────────────────────────────

-- 입장 — 같은 기기·같은 반조로 다시 들어오면 같은 참가자로 이어 준다
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
  if dev is not null then
    select * into r from board_participants where device_token = dev and team_id = p_team
      order by joined_at desc limit 1;
  end if;
  -- 같은 기기가 반조를 바꾸면 예전 반조의 입장 기록은 지운다(입장 수에 유령 반조가 남지 않게)
  if dev is not null then
    delete from board_participants where device_token = dev and team_id <> p_team;
  end if;
  if r.id is not null then
    update board_participants set name = nm, last_seen = now() where id = r.id returning * into r;
  else
    insert into board_participants (team_id, name, device_token) values (p_team, nm, dev) returning * into r;
  end if;
  return json_build_object('id', r.id, 'team_id', r.team_id, 'name', r.name);
end $$;

-- 내 정보 + 우리 반조 제출(같은 반조의 다른 기기 것 포함). 참가자가 없으면 null(전체 초기화 → 다시 입장)
create or replace function board_my(p_id uuid)
returns json
language plpgsql security definer set search_path = public as $$
declare r board_participants;
begin
  update board_participants set last_seen = now() where id = p_id returning * into r;
  if r.id is null then return null; end if;
  return json_build_object(
    'participant', json_build_object('id', r.id, 'team_id', r.team_id, 'name', r.name),
    'submissions', coalesce((
      select json_agg(json_build_object(
        'item_id', s.item_id, 'body', s.body, 'submitted_at', s.submitted_at,
        'updated_at', s.updated_at, 'edited_count', s.edited_count) order by s.item_id)
      from board_submissions s where s.team_id = r.team_id), '[]'::json)
  );
end $$;

-- 제출 — p_bodies = {"Q2-3a": "...", "Q2-3b": "..."} (지금 열린 그룹의 항목만). 반환 = 서버 제출 시각
create or replace function board_submit(p_id uuid, p_bodies jsonb)
returns timestamptz
language plpgsql security definer set search_path = public as $$
declare
  s     board_state;
  p     board_participants;
  it    board_items;
  ts    timestamptz := now();
  txt   text;
  k     text;
  nfilled int := 0;
begin
  select * into p from board_participants where id = p_id;
  if p.id is null then raise exception 'BOARD_UNKNOWN: participant'; end if;
  if p_bodies is null or jsonb_typeof(p_bodies) <> 'object' then raise exception 'BOARD_EMPTY'; end if;

  select * into s from board_state where id = 1 for share;
  if s.phase <> 'item_open' or not s.item_open or s.current_item is null then
    raise exception 'BOARD_CLOSED';
  end if;

  -- 열린 그룹 밖의 항목이 섞였으면 거부
  for k in select jsonb_object_keys(p_bodies) loop
    if not exists (select 1 from board_items where id = k and group_key = s.current_item) then
      raise exception 'BOARD_CLOSED: %', k;
    end if;
  end loop;

  -- 필수 항목 · 길이 검사
  for it in select * from board_items where group_key = s.current_item order by ord loop
    txt := board_clean(p_bodies ->> it.id);
    if it.required and txt = '' then raise exception 'BOARD_EMPTY: %', it.id; end if;
    if char_length(txt) > 1000 then raise exception 'BOARD_TOO_LONG: %', it.id; end if;
    if txt <> '' then nfilled := nfilled + 1; end if;
  end loop;

  -- 수정 허용이 꺼져 있으면 반조당 그룹 1회
  if not s.allow_edit and exists (
    select 1 from board_submissions b join board_items i on i.id = b.item_id
    where b.team_id = p.team_id and i.group_key = s.current_item
  ) then
    raise exception 'BOARD_DUPLICATE';
  end if;

  for it in select * from board_items where group_key = s.current_item order by ord loop
    txt := board_clean(p_bodies ->> it.id);
    insert into board_submissions as b (team_id, item_id, body, submitted_at, updated_at)
    values (p.team_id, it.id, txt, ts, ts)
    on conflict (team_id, item_id) do update
      set body = excluded.body,
          updated_at = ts,
          edited_count = b.edited_count + case when b.body is distinct from excluded.body then 1 else 0 end;
  end loop;

  update board_participants set last_seen = ts where id = p.id;
  return ts;
end $$;

-- 집계 — 입장한 반조 수 · 지금 그룹에 제출한 반조 수 · 그룹별 제출 수
create or replace function board_counts()
returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'joined', (select count(distinct team_id) from board_participants),
    'submitted', (
      select count(distinct b.team_id) from board_submissions b
      join board_items i on i.id = b.item_id
      join board_state s on s.id = 1 and i.group_key = s.current_item),
    'by_group', coalesce((
      select json_object_agg(g, n) from (
        select i.group_key as g, count(distinct b.team_id) as n
        from board_submissions b join board_items i on i.id = b.item_id group by i.group_key) x), '{}'::json)
  )
$$;

-- 월 읽기 — 지금 송출 중인 그룹(항목 열림·월 단계)은 누구나, 그 밖은 '월 공개'일 때만.
-- 숨김 카드와 빈 본문은 내려가지 않는다. 이름은 싣지 않는다(반조 ID만).
create or replace function board_feed(p_groups text[])
returns json
language plpgsql stable security definer set search_path = public as $$
declare s board_state;
begin
  select * into s from board_state where id = 1;
  if p_groups is null or cardinality(p_groups) = 0 then return '[]'::json; end if;
  if not s.wall_public and not (
       s.phase in ('item_open','wall') and s.current_item is not null and p_groups <@ array[s.current_item]
     ) then
    raise exception 'BOARD_FORBIDDEN';
  end if;
  return coalesce((
    select json_agg(json_build_object(
      'id', b.id, 'team_id', b.team_id, 'item_id', b.item_id, 'body', b.body,
      'updated_at', b.updated_at, 'highlighted', b.highlighted) order by b.updated_at desc, b.team_id)
    from board_submissions b join board_items i on i.id = b.item_id
    where i.group_key = any(p_groups) and not b.hidden and b.body <> ''), '[]'::json);
end $$;

-- ─────────────────────────────────────────────────────────────
-- 운영자 함수 (키 확인)
-- ─────────────────────────────────────────────────────────────

create or replace function board_admin_snapshot(p_key text)
returns json
language plpgsql stable security definer set search_path = public as $$
begin
  perform board_check_key(p_key);
  return json_build_object(
    'state', (select row_to_json(s) from board_state s where id = 1),
    'server_now', now(),
    'teams', coalesce((
      select json_agg(json_build_object(
        'id', t.id, 'table_no', t.table_no, 'half', t.half, 'is_exec', t.is_exec,
        'expected_size', t.expected_size,
        'devices', (select count(*) from board_participants p where p.team_id = t.id),
        'last_seen', (select max(p.last_seen) from board_participants p where p.team_id = t.id)
      ) order by t.table_no, t.half) from board_teams t), '[]'::json),
    'submissions', coalesce((
      select json_agg(json_build_object(
        'id', b.id, 'team_id', b.team_id, 'item_id', b.item_id, 'body', b.body,
        'submitted_at', b.submitted_at, 'updated_at', b.updated_at, 'edited_count', b.edited_count,
        'hidden', b.hidden, 'hidden_note', b.hidden_note, 'highlighted', b.highlighted
      ) order by b.updated_at desc) from board_submissions b), '[]'::json)
  );
end $$;

-- 상태 바꾸기 — p_patch 의 허용된 키만 반영한다.
--   phase · question · current_item · item_open · wall_public · allow_edit · screen_theme · sound_on
--   scroll_speed · focus(null 이면 해제) · timer_minutes(null/0 이면 해제) · timer_extend_sec
create or replace function board_set_state(p_key text, p_patch jsonb)
returns board_state
language plpgsql security definer set search_path = public as $$
declare
  s   board_state;
  grp text;
begin
  perform board_check_key(p_key);
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then raise exception 'BOARD_EMPTY'; end if;
  select * into s from board_state where id = 1 for update;

  if p_patch ? 'phase' then s.phase := p_patch ->> 'phase'; end if;
  if p_patch ? 'question' then s.question := nullif(p_patch ->> 'question', '')::int; end if;
  if p_patch ? 'current_item' then
    grp := nullif(p_patch ->> 'current_item', '');
    if grp is not null and not exists (select 1 from board_items where group_key = grp) then
      raise exception 'BOARD_UNKNOWN: item';
    end if;
    s.current_item := grp;
  end if;
  if p_patch ? 'item_open' then s.item_open := (p_patch ->> 'item_open')::boolean; end if;
  if p_patch ? 'wall_public' then s.wall_public := (p_patch ->> 'wall_public')::boolean; end if;
  if p_patch ? 'allow_edit' then s.allow_edit := (p_patch ->> 'allow_edit')::boolean; end if;
  if p_patch ? 'screen_theme' then s.screen_theme := p_patch ->> 'screen_theme'; end if;
  if p_patch ? 'sound_on' then s.sound_on := (p_patch ->> 'sound_on')::boolean; end if;
  if p_patch ? 'scroll_speed' then s.scroll_speed := (p_patch ->> 'scroll_speed')::int; end if;
  if p_patch ? 'focus' then
    s.focus := case when jsonb_typeof(p_patch -> 'focus') = 'null' then null else p_patch -> 'focus' end;
  end if;
  if p_patch ? 'timer_minutes' then
    s.timer_ends_at := case
      when coalesce((p_patch ->> 'timer_minutes')::numeric, 0) <= 0 then null
      else now() + make_interval(secs => (p_patch ->> 'timer_minutes')::numeric * 60) end;
  end if;
  if p_patch ? 'timer_extend_sec' then
    s.timer_ends_at := greatest(coalesce(s.timer_ends_at, now()), now())
                       + make_interval(secs => (p_patch ->> 'timer_extend_sec')::numeric);
  end if;

  -- 항목 열림 단계가 아니면 입력은 닫는다
  if s.phase <> 'item_open' then s.item_open := false; end if;
  if s.item_open and s.current_item is not null and not (s.current_item = any(s.opened_groups)) then
    s.opened_groups := s.opened_groups || s.current_item;
  end if;
  if s.current_item is not null then
    s.question := (select question from board_items where group_key = s.current_item limit 1);
  end if;

  update board_state set
    phase = s.phase, question = s.question, current_item = s.current_item, item_open = s.item_open,
    opened_groups = s.opened_groups, wall_public = s.wall_public, allow_edit = s.allow_edit,
    screen_theme = s.screen_theme, sound_on = s.sound_on, scroll_speed = s.scroll_speed,
    focus = s.focus, timer_ends_at = s.timer_ends_at
  where id = 1 returning * into s;
  return s;
end $$;

-- 카드 관리 — hide(사유 메모) / unhide / highlight / unhighlight
create or replace function board_moderate(p_key text, p_id uuid, p_action text, p_note text default null)
returns json
language plpgsql security definer set search_path = public as $$
declare b board_submissions;
begin
  perform board_check_key(p_key);
  if p_action is null or p_action not in ('hide','unhide','highlight','unhighlight') then
    raise exception 'BOARD_EMPTY: action';
  end if;
  -- 잠금 순서를 board_submit 과 같게(상태 → 제출) — 교착 방지
  perform 1 from board_state where id = 1 for update;
  update board_submissions set
    hidden      = case p_action when 'hide' then true when 'unhide' then false else hidden end,
    hidden_note = case p_action when 'hide' then left(nullif(btrim(coalesce(p_note, '')), ''), 200)
                                when 'unhide' then null else hidden_note end,
    highlighted = case p_action when 'highlight' then true when 'unhighlight' then false else highlighted end
  where id = p_id returning * into b;
  if b.id is null then raise exception 'BOARD_UNKNOWN: submission'; end if;
  -- 크게 보기 중인 카드를 숨기면 크게 보기도 내린다
  if p_action = 'hide' then
    update board_state set focus = null where id = 1 and focus ->> 'team_id' = b.team_id
      and focus ->> 'group' = (select group_key from board_items where id = b.item_id);
  end if;
  return row_to_json(b);
end $$;

-- 초기화 — p_scope 'group'(p_group 그룹의 제출만) / 'all'(제출 + 참가자 + 상태)
create or replace function board_reset(p_key text, p_scope text, p_group text default null)
returns void
language plpgsql security definer set search_path = public as $$
begin
  perform board_check_key(p_key);
  if p_scope = 'group' then
    delete from board_submissions where item_id in (select id from board_items where group_key = p_group);
    update board_state set opened_groups = array_remove(opened_groups, p_group), focus = null where id = 1;
  elsif p_scope = 'all' then
    delete from board_submissions where true;
    delete from board_participants where true;
    update board_state set phase = 'waiting', question = null, current_item = null, item_open = false,
      opened_groups = '{}', wall_public = false, timer_ends_at = null, focus = null where id = 1;
  else
    raise exception 'BOARD_EMPTY: scope';
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────
-- 권한
-- ─────────────────────────────────────────────────────────────

revoke execute on function board_check_key(text) from public, anon, authenticated;

grant execute on function
  board_join(text, text, text),
  board_my(uuid),
  board_submit(uuid, jsonb),
  board_counts(),
  board_feed(text[]),
  board_admin_snapshot(text),
  board_set_state(text, jsonb),
  board_moderate(text, uuid, text, text),
  board_reset(text, text, text)
to anon, authenticated;
