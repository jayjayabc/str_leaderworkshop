-- 토의보드 v1.1 (10/8 팀 논의 반영) — 무기명화 · 타이머 정리 · 작성 예시 · 투표 · 관전자
-- Supabase 대시보드 > SQL Editor 에 붙여넣어 실행한다. 여러 번 실행해도 안전하다(idempotent).
-- ▶ 적용 순서: board_v1.0 → sec_v1.0 이 이미 적용된 DB 위에 이 SQL 먼저, 코드 배포는 그다음.
-- 퀴즈 테이블·함수는 건드리지 않는다. 새 객체는 모두 board_ 접두사.
--
-- 바뀌는 것
--   1. 무기명화  — board_feed 에서 team_id 를 빼고 불투명 카드 키 `card` 를 싣는다(HMAC). focus 도 card 로 저장.
--                  salt 는 board_secret(RLS, anon 접근 없음)에 둔다. 운영자 스냅샷에는 team_id 도 card 도 있다.
--   2. 타이머    — board_state.item_opened_at (항목이 열린 시각, 운영자 참고용)
--   3. 작성 예시 — board_items.examples (text[])
--   5. 투표      — board_votes · board_vote / board_my_votes / board_ranking · board_state.vote_items/vote_open/vote_reveal
--   6. 관전자    — board_participants.role · board_join(…, p_role) · board_submit 은 기록자만
--
-- ※ hmac() 는 pgcrypto. Supabase 는 확장을 extensions 스키마에 두므로 card 함수의 search_path 에 extensions 를 더했다.

create extension if not exists "pgcrypto";

-- ─────────────────────────────────────────────────────────────
-- 테이블 · 열
-- ─────────────────────────────────────────────────────────────

-- 카드 키 salt (1행). 읽기 불가 — board_card_key() 만 읽는다.
create table if not exists board_secret (
  id    int primary key default 1 check (id = 1),
  salt  text not null default encode(gen_random_bytes(16), 'hex')
);
insert into board_secret (id) values (1) on conflict (id) do nothing;
alter table board_secret enable row level security;
revoke all on board_secret from anon, authenticated;

alter table board_state add column if not exists item_opened_at timestamptz;
alter table board_state add column if not exists vote_items text[] not null default '{Q2-3}';
alter table board_state add column if not exists vote_open boolean not null default false;
alter table board_state add column if not exists vote_reveal boolean not null default false;

alter table board_items add column if not exists examples text[] not null default '{}';

alter table board_participants add column if not exists role text not null default 'recorder';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ck_board_part_role') then
    alter table board_participants add constraint ck_board_part_role check (role in ('recorder', 'viewer'));
  end if;
end $$;

create table if not exists board_votes (
  participant_id uuid not null references board_participants(id) on delete cascade,
  group_key      text not null,
  team_id        text not null references board_teams(id) on delete cascade,
  created_at     timestamptz not null default now(),
  primary key (participant_id, group_key, team_id)
);
create index if not exists idx_board_votes_group on board_votes (group_key, team_id);
alter table board_votes enable row level security;
revoke all on board_votes from anon, authenticated;

-- v1.0 에서 저장된 크게 보기는 team_id 가 들어 있다(anon 이 board_state 를 읽는다) → 지운다
update board_state set focus = null where focus is not null and focus ? 'team_id';

-- ─────────────────────────────────────────────────────────────
-- 작성 예시 시드 (초안 — 팀 확정 전). src/lib/boardSeed.ts 와 같은 값이다.
-- ─────────────────────────────────────────────────────────────

update board_items i set examples = v.ex
from (values
  ('Q1-1',  array['월급 들어오면 저축·카드값·용돈으로 알아서 나눠 담아 줬으면', '앱을 여는 대신 에이전트한테 ''이번 달 얼마 썼어?''만 물어볼 듯']),
  ('Q1-2',  array['큰돈 움직일 땐 사람한테 한 번 확인받고 싶다', '문제가 생기면 책임지는 곳은 결국 은행']),
  ('Q1-3',  array['가입할 때 서류·인증 단계가 확 줄었으면', '금리 비교도 갈아타기도 에이전트가 한 번에']),
  ('Q1-4',  array['에이전트가 우리 상품을 쉽게 쓸 수 있는 연결 통로', '고객 대신 움직여도 안전한 한도·확인 장치']),
  ('Q2-1',  array['토큰은 많이 쓰는데 정확하게 쓸 줄 몰라 결과가 안 나왔다', '데이터가 어디 있는지 몰라서 AI한테 줄 수가 없었다']),
  ('Q2-2',  array['잘 된 프롬프트·사례를 팀에서 공유하며 일한다', '초안은 AI, 판단은 사람 — 검토 순서를 정해 두고 일한다']),
  ('Q2-3a', array['다음 주 주간보고를 AI 초안으로 만들어 보겠다', '회의록 정리부터 AI로 바꿔 보겠다']),
  ('Q2-3b', array['팀별 도구 가이드를 준비해 달라', '써도 되는 데이터·도구 기준을 한 장으로 정리해 달라'])
) as v(id, ex)
where i.id = v.id;

-- ─────────────────────────────────────────────────────────────
-- 내부 함수 (anon 호출 불가)
-- ─────────────────────────────────────────────────────────────

-- 카드 키 — 같은 반조의 같은 그룹은 항상 같은 값, 반조 ID 는 거꾸로 알 수 없다.
create or replace function board_card_key(p_team text, p_group text) returns text
language sql stable security definer set search_path = public, extensions as $$
  select left(encode(hmac(p_team || ':' || p_group, (select salt from board_secret where id = 1), 'sha256'), 'hex'), 16)
$$;

-- 내 표 {my:[card…], left:n} — 숨겨졌거나 본문이 빈 카드에 준 표는 세지 않는다
create or replace function board_votes_json(p_id uuid, p_group text) returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'my', coalesce(json_agg(x.card order by x.created_at), '[]'::json),
    'left', greatest(0, 3 - count(*))
  )
  from (
    select board_card_key(v.team_id, v.group_key) as card, v.created_at
    from board_votes v
    where v.participant_id = p_id and v.group_key = p_group
      and exists (
        select 1 from board_submissions b join board_items i on i.id = b.item_id
        where b.team_id = v.team_id and i.group_key = v.group_key and not b.hidden and b.body <> '')
  ) x
$$;

-- ─────────────────────────────────────────────────────────────
-- 공개 함수 (anon)
-- ─────────────────────────────────────────────────────────────

-- 입장 — 3-인자 호출도 그대로 동작(p_role 기본 'recorder'). 같은 기기 재입장이면 역할 갱신.
drop function if exists board_join(text, text, text);
create or replace function board_join(p_team text, p_name text, p_device text, p_role text default 'recorder')
returns json
language plpgsql security definer set search_path = public as $$
declare
  r   board_participants;
  rl  text := coalesce(nullif(btrim(coalesce(p_role, '')), ''), 'recorder');
  nm  text;
  dev text := left(nullif(btrim(coalesce(p_device, '')), ''), 64);
begin
  if rl not in ('recorder', 'viewer') then
    raise exception 'BOARD_EMPTY: role';
  end if;
  nm := left(coalesce(nullif(board_clean(p_name), ''), case when rl = 'viewer' then '관전자' else '기록자' end), 20);
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
    update board_participants set name = nm, role = rl, last_seen = now() where id = r.id returning * into r;
  else
    if (select count(*) from board_participants where team_id = p_team) >= 20 then
      raise exception 'BOARD_FULL: team';
    end if;
    insert into board_participants (team_id, name, device_token, role) values (p_team, nm, dev, rl) returning * into r;
  end if;
  return json_build_object('id', r.id, 'team_id', r.team_id, 'name', r.name, 'role', r.role);
end $$;

-- 내 정보 + 우리 반조 제출(각 제출에 우리 카드 키 card — 투표 화면에서 '우리 반조' 표시용)
create or replace function board_my(p_id uuid)
returns json
language plpgsql security definer set search_path = public as $$
declare r board_participants;
begin
  update board_participants set last_seen = now() where id = p_id returning * into r;
  if r.id is null then return null; end if;
  return json_build_object(
    'participant', json_build_object('id', r.id, 'team_id', r.team_id, 'name', r.name, 'role', r.role),
    'submissions', coalesce((
      select json_agg(json_build_object(
        'item_id', s.item_id, 'body', s.body, 'submitted_at', s.submitted_at,
        'updated_at', s.updated_at, 'edited_count', s.edited_count,
        'card', board_card_key(s.team_id, i.group_key)) order by s.item_id)
      from board_submissions s join board_items i on i.id = s.item_id
      where s.team_id = r.team_id), '[]'::json)
  );
end $$;

-- 제출 — 관전자는 거부(BOARD_NOT_RECORDER)
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
  if p.role <> 'recorder' then raise exception 'BOARD_NOT_RECORDER'; end if;
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

-- 집계 — joined = 기록자가 있는 반조 수 · viewers = 관전자 기기 수 · voters = 지금 그룹에 투표한 기기 수
--        by_group = 그룹별 '보이는' 카드를 낸 반조 수(숨김·빈 본문 제외 — 송출 탭의 카드 수)
create or replace function board_counts()
returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'joined', (select count(distinct team_id) from board_participants where role = 'recorder'),
    'viewers', (select count(*) from board_participants where role = 'viewer'),
    'voters', (
      select count(distinct v.participant_id) from board_votes v
      join board_state s on s.id = 1 and v.group_key = s.current_item),
    'submitted', (
      select count(distinct b.team_id) from board_submissions b
      join board_items i on i.id = b.item_id
      join board_state s on s.id = 1 and i.group_key = s.current_item),
    'by_group', coalesce((
      select json_object_agg(g, n) from (
        select i.group_key as g, count(distinct b.team_id) as n
        from board_submissions b join board_items i on i.id = b.item_id
        where not b.hidden and b.body <> '' group by i.group_key) x), '{}'::json)
  )
$$;

-- 모아보기 읽기 — team_id 대신 card. 같은 반조의 같은 그룹 카드는 같은 card.
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
      'id', b.id, 'card', board_card_key(b.team_id, i.group_key), 'item_id', b.item_id, 'body', b.body,
      'updated_at', b.updated_at, 'highlighted', b.highlighted) order by b.updated_at desc, b.team_id)
    from board_submissions b join board_items i on i.id = b.item_id
    where i.group_key = any(p_groups) and not b.hidden and b.body <> ''), '[]'::json);
end $$;

-- 투표 — p_on=true 투표, false 취소. 반환 {my:[card…], left:n}
create or replace function board_vote(p_id uuid, p_group text, p_card text, p_on boolean)
returns json
language plpgsql security definer set search_path = public as $$
declare
  s board_state;
  p board_participants;
  t text;
  n int;
begin
  select * into s from board_state where id = 1 for share;
  select * into p from board_participants where id = p_id for update;   -- 같은 기기의 동시 투표를 순서대로
  if p.id is null then raise exception 'BOARD_UNKNOWN: participant'; end if;
  if p_group is null or not (p_group = any(s.vote_items)) or not s.vote_open then
    raise exception 'BOARD_CLOSED';
  end if;
  if p_card is null then raise exception 'BOARD_UNKNOWN: card'; end if;

  select id into t from board_teams where board_card_key(id, p_group) = p_card;
  if t is null then raise exception 'BOARD_UNKNOWN: card'; end if;

  if coalesce(p_on, true) then
    if t = p.team_id then raise exception 'BOARD_OWN_CARD'; end if;
    if not exists (
      select 1 from board_submissions b join board_items i on i.id = b.item_id
      where b.team_id = t and i.group_key = p_group and not b.hidden and b.body <> ''
    ) then
      raise exception 'BOARD_UNKNOWN: card';
    end if;
    if not exists (select 1 from board_votes where participant_id = p.id and group_key = p_group and team_id = t) then
      select count(*) into n from board_votes v
      where v.participant_id = p.id and v.group_key = p_group
        and exists (
          select 1 from board_submissions b join board_items i on i.id = b.item_id
          where b.team_id = v.team_id and i.group_key = v.group_key and not b.hidden and b.body <> '');
      if n >= 3 then raise exception 'BOARD_VOTE_LIMIT'; end if;
      insert into board_votes (participant_id, group_key, team_id) values (p.id, p_group, t) on conflict do nothing;
    end if;
  else
    delete from board_votes where participant_id = p.id and group_key = p_group and team_id = t;
  end if;

  update board_participants set last_seen = now() where id = p.id;
  return board_votes_json(p.id, p_group);
end $$;

create or replace function board_my_votes(p_id uuid, p_group text)
returns json
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from board_participants where id = p_id) then
    raise exception 'BOARD_UNKNOWN: participant';
  end if;
  return board_votes_json(p_id, p_group);
end $$;

-- 순위 — 공개(vote_reveal)이고 투표 대상 그룹일 때만. team_id 없음. [{card, votes, parts:[{item_id, body}]}]
create or replace function board_ranking(p_group text)
returns json
language plpgsql stable security definer set search_path = public as $$
declare s board_state;
begin
  select * into s from board_state where id = 1;
  if p_group is null or not s.vote_reveal or not (p_group = any(s.vote_items)) then
    raise exception 'BOARD_FORBIDDEN';
  end if;
  return coalesce((
    select json_agg(json_build_object('card', x.card, 'votes', x.votes, 'parts', x.parts) order by x.votes desc, x.card)
    from (
      select board_card_key(c.team_id, p_group) as card,
             coalesce(max(v.n), 0)::int as votes,
             json_agg(json_build_object('item_id', c.item_id, 'body', c.body) order by c.ord) as parts
      from (
        select b.team_id, b.item_id, b.body, i.ord
        from board_submissions b join board_items i on i.id = b.item_id
        where i.group_key = p_group and not b.hidden and b.body <> ''
      ) c
      left join (
        select team_id, count(*) as n from board_votes where group_key = p_group group by team_id
      ) v on v.team_id = c.team_id
      group by c.team_id
    ) x), '[]'::json);
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
        'recorders', (select count(*) from board_participants p where p.team_id = t.id and p.role = 'recorder'),
        'viewers', (select count(*) from board_participants p where p.team_id = t.id and p.role = 'viewer'),
        'last_seen', (select max(p.last_seen) from board_participants p where p.team_id = t.id)
      ) order by t.table_no, t.half) from board_teams t), '[]'::json),
    'submissions', coalesce((
      select json_agg(json_build_object(
        'id', b.id, 'team_id', b.team_id, 'card', board_card_key(b.team_id, i.group_key), 'item_id', b.item_id, 'body', b.body,
        'submitted_at', b.submitted_at, 'updated_at', b.updated_at, 'edited_count', b.edited_count,
        'hidden', b.hidden, 'hidden_note', b.hidden_note, 'highlighted', b.highlighted
      ) order by b.updated_at desc) from board_submissions b join board_items i on i.id = b.item_id), '[]'::json),
    'votes', coalesce((
      select json_agg(json_build_object('group_key', v.group_key, 'team_id', v.team_id, 'votes', v.n)
                      order by v.group_key, v.n desc, v.team_id)
      from (select group_key, team_id, count(*) as n from board_votes group by group_key, team_id) v), '[]'::json),
    'voters', (
      select count(distinct v.participant_id) from board_votes v
      join board_state s on s.id = 1 and v.group_key = s.current_item)
  );
end $$;

-- 상태 바꾸기 — v1.0 키 + vote_items(그룹 배열) · vote_open · vote_reveal.
--   focus 는 {card, group, items} (team_id 가 섞여 오면 지운다). item_opened_at 은 항목이 열릴 때(닫힘→열림, 또는 열린 채 그룹 이동) now().
create or replace function board_set_state(p_key text, p_patch jsonb)
returns board_state
language plpgsql security definer set search_path = public as $$
declare
  s        board_state;
  grp      text;
  vi       text[];
  old_open boolean;
  old_item text;
begin
  perform board_check_key(p_key);
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then raise exception 'BOARD_EMPTY'; end if;
  select * into s from board_state where id = 1 for update;
  old_open := s.item_open;
  old_item := s.current_item;

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
    if jsonb_typeof(p_patch -> 'focus') = 'null' then
      s.focus := null;
    elsif jsonb_typeof(p_patch -> 'focus') = 'object' then
      s.focus := (p_patch -> 'focus') - 'team_id';
    else
      raise exception 'BOARD_EMPTY: focus';
    end if;
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
  if p_patch ? 'vote_items' then
    if jsonb_typeof(p_patch -> 'vote_items') <> 'array' then raise exception 'BOARD_EMPTY: vote_items'; end if;
    select coalesce(array_agg(distinct g order by g), '{}') into vi from jsonb_array_elements_text(p_patch -> 'vote_items') g;
    if exists (select 1 from unnest(vi) g where not exists (select 1 from board_items where group_key = g)) then
      raise exception 'BOARD_UNKNOWN: vote_items';
    end if;
    s.vote_items := vi;
  end if;
  if p_patch ? 'vote_open' then s.vote_open := (p_patch ->> 'vote_open')::boolean; end if;
  if p_patch ? 'vote_reveal' then s.vote_reveal := (p_patch ->> 'vote_reveal')::boolean; end if;

  -- 항목 열림 단계가 아니면 입력은 닫는다
  if s.phase <> 'item_open' then s.item_open := false; end if;
  if s.item_open and s.current_item is not null and not (s.current_item = any(s.opened_groups)) then
    s.opened_groups := s.opened_groups || s.current_item;
  end if;
  if s.current_item is not null then
    s.question := (select question from board_items where group_key = s.current_item limit 1);
  end if;
  -- 열린 지 얼마나 됐는지(운영자 참고용)
  if s.item_open then
    if not old_open or s.current_item is distinct from old_item then s.item_opened_at := now(); end if;
  else
    s.item_opened_at := null;
  end if;

  update board_state set
    phase = s.phase, question = s.question, current_item = s.current_item, item_open = s.item_open,
    opened_groups = s.opened_groups, wall_public = s.wall_public, allow_edit = s.allow_edit,
    screen_theme = s.screen_theme, sound_on = s.sound_on, scroll_speed = s.scroll_speed,
    focus = s.focus, timer_ends_at = s.timer_ends_at, item_opened_at = s.item_opened_at,
    vote_items = s.vote_items, vote_open = s.vote_open, vote_reveal = s.vote_reveal
  where id = 1 returning * into s;
  return s;
end $$;

-- 카드 관리 — 크게 보기 해제는 card 비교
create or replace function board_moderate(p_key text, p_id uuid, p_action text, p_note text default null)
returns json
language plpgsql security definer set search_path = public as $$
declare
  b board_submissions;
  g text;
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
    select group_key into g from board_items where id = b.item_id;
    update board_state set focus = null
      where id = 1 and focus ->> 'group' = g and focus ->> 'card' = board_card_key(b.team_id, g);
  end if;
  return row_to_json(b);
end $$;

-- 초기화 — 'group' 은 그 그룹의 제출 + 투표, 'all' 은 제출 + 참가자 + 투표 + 상태
create or replace function board_reset(p_key text, p_scope text, p_group text default null)
returns void
language plpgsql security definer set search_path = public as $$
begin
  perform board_check_key(p_key);
  -- 잠금 순서를 board_submit·board_vote 와 같게(상태 → 나머지)
  perform 1 from board_state where id = 1 for update;
  if p_scope = 'group' then
    delete from board_votes where group_key = p_group;
    delete from board_submissions where item_id in (select id from board_items where group_key = p_group);
    update board_state set opened_groups = array_remove(opened_groups, p_group), focus = null where id = 1;
  elsif p_scope = 'all' then
    delete from board_votes where true;
    delete from board_submissions where true;
    delete from board_participants where true;
    update board_state set phase = 'waiting', question = null, current_item = null, item_open = false,
      opened_groups = '{}', wall_public = false, timer_ends_at = null, focus = null,
      item_opened_at = null, vote_open = false, vote_reveal = false where id = 1;
  else
    raise exception 'BOARD_EMPTY: scope';
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────
-- 권한
-- ─────────────────────────────────────────────────────────────

revoke execute on function board_check_key(text) from public, anon, authenticated;
revoke execute on function board_clean(text) from public, anon, authenticated;
revoke execute on function board_touch_state() from public, anon, authenticated;
revoke execute on function board_card_key(text, text) from public, anon, authenticated;
revoke execute on function board_votes_json(uuid, text) from public, anon, authenticated;

grant execute on function
  board_join(text, text, text, text),
  board_my(uuid),
  board_submit(uuid, jsonb),
  board_counts(),
  board_feed(text[]),
  board_vote(uuid, text, text, boolean),
  board_my_votes(uuid, text),
  board_ranking(text),
  board_admin_snapshot(text),
  board_set_state(text, jsonb),
  board_moderate(text, uuid, text, text),
  board_reset(text, text, text)
to anon, authenticated;
