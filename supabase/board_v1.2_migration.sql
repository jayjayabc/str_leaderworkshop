-- 토의보드 v1.2 — AI 갈무리 리포트 (모아보기 탭 단위로 답 전체를 묶은 1장짜리 리포트를 송출 화면에 띄운다)
-- Supabase 대시보드 > SQL Editor 에 붙여넣어 실행한다. 여러 번 실행해도 안전하다(idempotent).
-- ▶ 적용 순서: board_v1.0 → sec_v1.0 → board_v1.1 이 이미 적용된 DB 위에 이 SQL 먼저, 코드 배포는 그다음.
-- 퀴즈 테이블·함수는 건드리지 않는다. 새 객체는 모두 board_ 접두사.
--
-- 바뀌는 것
--   1. board_summaries     — 그룹(탭)별 AI 갈무리 저장본. RLS 켜고 anon 접근 없음(함수로만).
--   2. board_state.summary — 지금 송출 중인 리포트 {group, data, model, source_count, created_at} 또는 null
--   3. board_summary_source — (운영자) 그 그룹의 보이는 답(숨김·빈 답 제외)을 AI 입력용으로. team_id·card 는 싣지 않는다.
--      board_summary_save   — (운영자) 서버 라우트가 검증한 리포트 저장. 송출 중인 그룹이면 송출본도 갱신.
--      board_summary_list   — (운영자) 저장본 전부
--      board_summary_show   — (운영자) 송출/내리기
--   4. board_set_state     — 모아보기가 아니거나 탭이 바뀌면 송출 리포트를 자동으로 내린다
--      board_reset         — 초기화 시 저장본·송출본도 지운다
--
-- ※ board_admin_snapshot 은 그대로다(state 가 row_to_json(board_state) 라 summary 가 자동으로 실린다).

-- ─────────────────────────────────────────────────────────────
-- 테이블 · 열
-- ─────────────────────────────────────────────────────────────

create table if not exists board_summaries (
  group_key     text primary key,
  data          jsonb not null,
  model         text not null default '',
  source_count  int  not null default 0,
  created_at    timestamptz not null default now()
);
alter table board_summaries enable row level security;
revoke all on board_summaries from anon, authenticated;

alter table board_state add column if not exists summary jsonb;

-- ─────────────────────────────────────────────────────────────
-- 운영자 함수 (키 확인)
-- ─────────────────────────────────────────────────────────────

-- AI 입력용 원문 — 반조 정보(team_id)도 카드 키(card)도 싣지 않는다.
create or replace function board_summary_source(p_key text, p_group text)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform board_check_key(p_key);
  if p_group is null or not exists (select 1 from board_items where group_key = p_group) then
    raise exception 'BOARD_UNKNOWN: group';
  end if;
  return jsonb_build_object(
    'group', p_group,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object('item_id', i.id, 'title', i.title, 'prompt', i.prompt) order by i.ord)
      from board_items i where i.group_key = p_group), '[]'::jsonb),
    'answers', coalesce((
      select jsonb_agg(jsonb_build_object('item_id', b.item_id, 'body', b.body) order by b.item_id, b.updated_at)
      from board_submissions b join board_items i on i.id = b.item_id
      where i.group_key = p_group and b.hidden = false and btrim(b.body) <> ''), '[]'::jsonb)
  );
end $$;

-- 저장 — 서버 라우트가 검증·정리한 리포트. 그 그룹이 지금 송출 중이면 송출본도 새 값으로.
create or replace function board_summary_save(p_key text, p_group text, p_data jsonb, p_model text, p_count int)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r board_summaries;
  j jsonb;
begin
  perform board_check_key(p_key);
  if p_group is null or not exists (select 1 from board_items where group_key = p_group) then
    raise exception 'BOARD_UNKNOWN: group';
  end if;
  if p_data is null or jsonb_typeof(p_data) <> 'object' then raise exception 'BOARD_EMPTY: data'; end if;
  if octet_length(p_data::text) > 60000 then raise exception 'BOARD_TOO_LONG'; end if;
  -- 잠금 순서를 board_set_state 와 같게(상태 → 나머지)
  perform 1 from board_state where id = 1 for update;
  insert into board_summaries (group_key, data, model, source_count, created_at)
  values (p_group, p_data, left(coalesce(p_model, ''), 100), greatest(coalesce(p_count, 0), 0), now())
  on conflict (group_key) do update set
    data = excluded.data, model = excluded.model, source_count = excluded.source_count, created_at = excluded.created_at
  returning * into r;
  j := jsonb_build_object('group', r.group_key, 'data', r.data, 'model', r.model,
                          'source_count', r.source_count, 'created_at', r.created_at);
  update board_state set summary = j where id = 1 and summary ->> 'group' = p_group;
  return j;
end $$;

create or replace function board_summary_list(p_key text)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform board_check_key(p_key);
  return coalesce((
    select jsonb_agg(jsonb_build_object('group', s.group_key, 'data', s.data, 'model', s.model,
                                        'source_count', s.source_count, 'created_at', s.created_at)
                     order by s.group_key)
    from board_summaries s), '[]'::jsonb);
end $$;

-- 송출 / 내리기 — p_group 이 null 이거나 '' 이면 내린다
create or replace function board_summary_show(p_key text, p_group text)
returns board_state
language plpgsql security definer set search_path = public as $$
declare
  s board_state;
  r board_summaries;
begin
  perform board_check_key(p_key);
  perform 1 from board_state where id = 1 for update;
  if p_group is null or p_group = '' then
    update board_state set summary = null where id = 1 returning * into s;
    return s;
  end if;
  select * into r from board_summaries where group_key = p_group;
  if r.group_key is null then raise exception 'BOARD_UNKNOWN: summary'; end if;
  update board_state set summary = jsonb_build_object('group', r.group_key, 'data', r.data, 'model', r.model,
                                                       'source_count', r.source_count, 'created_at', r.created_at)
  where id = 1 returning * into s;
  return s;
end $$;

-- 상태 바꾸기 — v1.1 본문 그대로 + (모아보기가 아니거나 탭이 바뀌면 summary 해제)
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
  -- v1.2: 모아보기가 아니거나 탭(current_item)이 바뀌면 띄워 둔 AI 갈무리 리포트는 내린다
  if s.phase <> 'wall' then s.summary := null; end if;
  if s.current_item is distinct from old_item then s.summary := null; end if;

  update board_state set
    phase = s.phase, question = s.question, current_item = s.current_item, item_open = s.item_open,
    opened_groups = s.opened_groups, wall_public = s.wall_public, allow_edit = s.allow_edit,
    screen_theme = s.screen_theme, sound_on = s.sound_on, scroll_speed = s.scroll_speed,
    focus = s.focus, timer_ends_at = s.timer_ends_at, item_opened_at = s.item_opened_at,
    vote_items = s.vote_items, vote_open = s.vote_open, vote_reveal = s.vote_reveal,
    summary = s.summary
  where id = 1 returning * into s;
  return s;
end $$;

-- 초기화 — v1.1 + 'group' 은 그 그룹의 AI 갈무리 저장본·송출본도, 'all' 은 모든 저장본·송출본을 지운다
create or replace function board_reset(p_key text, p_scope text, p_group text default null)
returns void
language plpgsql security definer set search_path = public as $$
begin
  perform board_check_key(p_key);
  -- 잠금 순서를 board_submit·board_vote 와 같게(상태 → 나머지)
  perform 1 from board_state where id = 1 for update;
  if p_scope = 'group' then
    delete from board_votes where group_key = p_group;
    delete from board_summaries where group_key = p_group;
    delete from board_submissions where item_id in (select id from board_items where group_key = p_group);
    update board_state set opened_groups = array_remove(opened_groups, p_group), focus = null,
      summary = case when summary ->> 'group' = p_group then null else summary end where id = 1;
  elsif p_scope = 'all' then
    delete from board_votes where true;
    delete from board_summaries where true;
    delete from board_submissions where true;
    delete from board_participants where true;
    update board_state set phase = 'waiting', question = null, current_item = null, item_open = false,
      opened_groups = '{}', wall_public = false, timer_ends_at = null, focus = null,
      item_opened_at = null, vote_open = false, vote_reveal = false, summary = null where id = 1;
  else
    raise exception 'BOARD_EMPTY: scope';
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────
-- 권한 — 운영자 함수는 키로 보호된다(기존 board 운영자 함수와 같은 방식)
-- ─────────────────────────────────────────────────────────────

grant execute on function
  board_summary_source(text, text),
  board_summary_save(text, text, jsonb, text, int),
  board_summary_list(text),
  board_summary_show(text, text),
  board_set_state(text, jsonb),
  board_reset(text, text, text)
to anon, authenticated;
