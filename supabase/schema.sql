-- 코끼리 보드 — Supabase 스키마 (BRIEF §4)
-- Supabase 대시보드 > SQL Editor 에 그대로 붙여넣어 실행합니다.

create extension if not exists "pgcrypto";

-- ─────────────────────────────────────────────────────────────
-- 테이블
-- ─────────────────────────────────────────────────────────────

create table if not exists boards (
  id          uuid primary key default gen_random_uuid(),
  slug        text unique not null,
  title       text not null,
  phase       text not null default 'placing' check (phase in ('placing','voting','review')),
  locked      boolean not null default false,
  hide_vomit  boolean not null default false,
  show_axis   boolean not null default false,
  settings    jsonb not null default '{}'::jsonb,
  host_token  text,                                  -- 보드 생성자 브라우저에 저장되는 호스트 토큰
  created_at  timestamptz not null default now()
);

create table if not exists participants (
  id         uuid primary key default gen_random_uuid(),
  board_id   uuid not null references boards(id) on delete cascade,
  nickname   text not null,
  role       text not null check (role in ('strategy','exec','leader')),
  color      text not null,
  last_seen  timestamptz not null default now()
);

create table if not exists keywords (
  id              uuid primary key default gen_random_uuid(),
  board_id        uuid not null references boards(id) on delete cascade,
  text            text not null,
  axis            text,
  axis2           text,
  expected        text,
  expected2       text,
  source          text,
  created_by      uuid,
  created_by_name text,
  created_at      timestamptz not null default now(),
  is_seed         boolean not null default false
);

create table if not exists placements (
  id              uuid primary key default gen_random_uuid(),
  board_id        uuid not null references boards(id) on delete cascade,
  keyword_id      uuid not null unique references keywords(id) on delete cascade,
  zone            text not null check (zone in ('pool','elephant','deadfish','vomit','bluebird','sprout')),
  sort_order      int not null default 0,
  placed_by       uuid,
  placed_by_name  text,
  updated_at      timestamptz not null default now()
);

create table if not exists votes (
  id             uuid primary key default gen_random_uuid(),
  board_id       uuid not null references boards(id) on delete cascade,
  keyword_id     uuid not null references keywords(id) on delete cascade,
  participant_id uuid not null,
  created_at     timestamptz not null default now(),
  unique (board_id, keyword_id, participant_id)   -- 1인 1카드 1표 (총 3표는 앱에서 제한)
);

create table if not exists notes (
  id          uuid primary key default gen_random_uuid(),
  board_id    uuid not null references boards(id) on delete cascade,
  keyword_id  uuid not null references keywords(id) on delete cascade,
  author_id   uuid,
  author_name text,
  text        text not null,
  created_at  timestamptz not null default now()
);

create table if not exists events (
  id          bigserial primary key,
  board_id    uuid not null references boards(id) on delete cascade,
  actor_id    uuid,
  actor_name  text,
  type        text not null,
  payload     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists idx_keywords_board on keywords(board_id);
create index if not exists idx_placements_board on placements(board_id);
create index if not exists idx_notes_board on notes(board_id);
create index if not exists idx_votes_board on votes(board_id);
create index if not exists idx_events_board on events(board_id, id);

-- ─────────────────────────────────────────────────────────────
-- Realtime 발행
-- ─────────────────────────────────────────────────────────────

alter publication supabase_realtime add table boards;
alter publication supabase_realtime add table keywords;
alter publication supabase_realtime add table placements;
alter publication supabase_realtime add table votes;
alter publication supabase_realtime add table notes;
alter publication supabase_realtime add table events;

alter table placements replica identity full;
alter table keywords   replica identity full;
alter table boards     replica identity full;

-- ─────────────────────────────────────────────────────────────
-- RLS — slug를 아는 익명 사용자가 읽고 쓸 수 있는 단순 정책.
-- 삭제·초기화·단계 변경은 앱에서 host_token으로 제한하고,
-- 운영 단계에서 Edge Function 검증으로 옮긴다(BRIEF §4).
-- ─────────────────────────────────────────────────────────────

alter table boards       enable row level security;
alter table participants enable row level security;
alter table keywords     enable row level security;
alter table placements   enable row level security;
alter table votes        enable row level security;
alter table notes        enable row level security;
alter table events       enable row level security;

do $$
declare t text;
begin
  foreach t in array array['boards','participants','keywords','placements','votes','notes','events'] loop
    execute format('drop policy if exists anon_all on %I', t);
    execute format(
      'create policy anon_all on %I for all to anon, authenticated using (true) with check (true)', t);
  end loop;
end $$;

-- host_token은 클라이언트에 노출되면 안 되므로 뷰로 가려 읽는 것을 권장한다.
-- (MVP에서는 boards.host_token을 select 대상에서 앱이 사용하지 않는다.)
