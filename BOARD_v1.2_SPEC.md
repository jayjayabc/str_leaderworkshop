# 토의보드 v1.2 — AI 갈무리 리포트 (명세)

목표: 모아보기 단계에서 운영자가 버튼 하나로 **그 탭(그룹) 답 전체를 AI가 묶은 1장짜리 리포트**를 만들고, 확인한 뒤 **송출 화면에 띄운다**.
진행자 대본이 아니라 **스크린에 띄우는 갈무리 리포트**가 목적이다. 반조 정보는 AI에도, 화면에도 절대 가지 않는다.

API 키(`ANTHROPIC_API_KEY`)는 아직 없다. 키 없이도 화면·흐름은 끝까지 동작해야 한다(아래 §5 가짜 요약 / §7 사전 생성본).

---

## 1. 흐름

1. 운영자 화면 · 모아보기(wall) 단계 · 탭(그룹) 선택 상태 → 오른쪽에 **「AI 갈무리」 패널**
2. [AI 갈무리 만들기] → `POST /api/board/summary` → 서버가 운영자 키 확인 → 그 그룹의 보이는 답(숨김·빈 답 제외)을 DB에서 읽음 → Claude API 호출(10~30초) → 출력 검증 → DB 저장 → 패널에 미리보기
3. [스크린에 띄우기] → `board_state.summary` 에 그 리포트가 실림 → 송출 화면이 Realtime으로 받아 **전체 화면 리포트**로 전환
4. [스크린에서 내리기] → `board_state.summary = null` → 원래 모아보기로
5. 다른 탭으로 넘기면(←/→ 포함) 띄워 둔 리포트는 **자동으로 내려간다**(그 탭 리포트를 띄우려면 다시 누른다). 단계가 wall 이 아니게 되면 서버가 자동으로 내린다.
6. 실패하면 패널에 이유 표시(키 없음 / 시간 초과 / API 오류). 진행은 기본 흐름(탭 넘기며 구두 갈무리)으로 계속.

## 2. DB — `supabase/board_v1.2_migration.sql` (idempotent, board_v1.1 위에)

맨 위 주석 형식은 v1.1 파일을 따른다. Supabase SQL Editor 붙여넣기용. `create extension` 불필요.

```sql
create table if not exists board_summaries (
  group_key     text primary key,
  data          jsonb not null,          -- §4 BoardSummaryData
  model         text not null default '',
  source_count  int  not null default 0, -- 요약에 쓴 답 수
  created_at    timestamptz not null default now()
);
alter table board_summaries enable row level security;
revoke all on board_summaries from anon, authenticated;

alter table board_state add column if not exists summary jsonb;  -- 송출 중인 리포트 {group, data, model, source_count, created_at} 또는 null
```

함수 (모두 `security definer set search_path = public`, 운영자 함수는 `perform board_check_key(p_key)` 먼저):

- `board_summary_source(p_key text, p_group text) returns jsonb`
  - 그룹이 없으면 `BOARD_UNKNOWN: group`
  - 반환: `{"group": .., "items": [{"item_id","title","prompt"}...], "answers": [{"item_id","body"}...]}`
  - answers = 그 그룹 항목들의 `hidden = false and btrim(body) <> ''` 제출, `item_id, updated_at` 순. **team_id·card 는 싣지 않는다.**
- `board_summary_save(p_key text, p_group text, p_data jsonb, p_model text, p_count int) returns jsonb`
  - 그룹 검증, `jsonb_typeof(p_data) = 'object'` 아니면 `BOARD_EMPTY: data`, `octet_length(p_data::text) > 60000` 이면 `BOARD_TOO_LONG`
  - upsert 후 저장된 행을 jsonb 로 반환 `{group, data, model, source_count, created_at}`
  - 그 그룹이 지금 송출 중이면(`board_state.summary->>'group' = p_group`) board_state.summary 도 새 값으로 갱신
- `board_summary_list(p_key text) returns jsonb` — 모든 행 `[{group, data, model, source_count, created_at}]`
- `board_summary_show(p_key text, p_group text) returns board_state`
  - `p_group` null/'' → `summary := null`
  - 아니면 저장본이 없으면 `BOARD_UNKNOWN: summary`, 있으면 `summary := {group, data, model, source_count, created_at}`
  - board_set_state 와 같은 잠금 순서(`board_state for update`)
- `board_set_state` 재정의(v1.1 본문 그대로 + 두 줄): 
  - `if s.phase <> 'wall' then s.summary := null; end if;`
  - `current_item` 이 바뀌면(`s.current_item is distinct from old_item`) `s.summary := null`
- `board_reset` 재정의(v1.1 그대로 + ): group → `delete from board_summaries where group_key = p_group;` 그리고 송출 중이 그 그룹이면 summary null / all → `delete from board_summaries where true;` + `summary = null`
- 권한: 새 운영자 함수 4개 `grant execute ... to anon, authenticated` (키로 보호 — 기존 board 운영자 함수와 같은 방식). 내부 함수 revoke 패턴 유지.
- `board_admin_snapshot` 은 손대지 않는다(이미 `row_to_json(board_state)` 라 summary 가 자동으로 실림).

`scripts/board-sql-smoke.sql` 에 `-- SUMMARY` 블록 추가: source 가 team_id 를 안 싣는지, 숨김 답 제외, 잘못된 키 거부, anon 이 board_summaries 를 직접 못 읽음, show→state.summary 실림, current_item 변경·phase 변경 시 자동 해제, reset 시 삭제. 마지막에 `SUMMARY OK` 출력. 기존 BOARD/SEC/V1.1/PERMISSIONS OK 도 그대로 통과해야 한다.

로컬 PG: `su postgres -c "psql -h /var/tmp -p 5499 -d postgres ..."` (v1.0·sec·v1.1 적용돼 있음, 운영자 키 `'kkkkkkkkkkkkkkkk'`). 스모크 실행 방법은 스크립트 머리 주석 참고. 안 떠 있으면 `/usr/lib/postgresql/16/bin/pg_ctl -D /var/tmp/pgdata -o '-p 5499 -k /var/tmp' -l /var/tmp/pg.log start` (postgres 사용자로).

## 3. 서버 라우트 — `src/app/api/board/summary/route.ts`

`export const dynamic = 'force-dynamic'; export const maxDuration = 60; export const runtime = 'nodejs';`
패턴은 `src/app/api/quiz/keys/route.ts` (fetch 로 `${URL}/rest/v1/rpc/<fn>` 호출, apikey=anon) 를 따른다.

`POST` body `{ group: BoardGroupId, source?: Source }`, 헤더 `x-operator-key`.

**Supabase 모드** (`NEXT_PUBLIC_SUPABASE_URL`·`ANON` 있음):
1. `board_summary_source(p_key, p_group)` 호출 — 401/400 이면 즉시 `{error:'forbidden'}` 401. **키 확인 전에는 절대 Anthropic 을 부르지 않는다.** body.source 는 무시.
2. answers 0건 → `{error:'empty'}` 400
3. `ANTHROPIC_API_KEY` 없으면: `BOARD_SUMMARY_FAKE === '1'` 이면 §5 가짜 요약, 아니면 `{error:'no_api_key'}` 503
4. Claude 호출(§4) → 검증·정리(§4) → `board_summary_save` → 저장 결과 그대로 200 응답

**로컬 모드** (Supabase 환경변수 없음 — 개발·E2E 전용): body.source(`{items, answers}`) 를 쓴다. 키 검사 없음(로컬 어댑터가 함). API 키가 있으면 진짜 호출, 없으면 가짜 요약. 저장은 클라이언트(로컬 어댑터)가 한다 → 응답 `{group, data, model, source_count, created_at}`.

응답 헤더 `Cache-Control: no-store`. 에러 본문에 키·내부 메시지를 싣지 않는다(서버 `console.error` 만).

## 4. Claude 호출 · 출력 스키마 · 검증 — `src/lib/boardSummary.ts` (서버·클라이언트 공용 타입 + 서버 전용 함수는 route 쪽에)

```ts
export interface BoardSummaryTheme { title: string; count: number; quote: string }   // quote: 원문 그대로 일부 or ''
export interface BoardSummaryStandout { quote: string; why: string }
export interface BoardSummarySection { item_id: BoardItemId; themes: BoardSummaryTheme[]; standouts: BoardSummaryStandout[]; offtopic: number }
export interface BoardSummaryData { headline: string; takeaway: string; sections: BoardSummarySection[]; fake?: boolean }
export interface BoardSummary { group: BoardGroupId; data: BoardSummaryData; model: string; source_count: number; created_at: string }
```
`BoardState` 에 `summary: BoardSummary | null` 추가(EMPTY_BOARD_STATE 도 null).

호출: `fetch('https://api.anthropic.com/v1/messages')`, 헤더 `x-api-key`, `anthropic-version: 2023-06-01`, `content-type: application/json`. 모델 `process.env.BOARD_SUMMARY_MODEL || 'claude-sonnet-5-5'`, `max_tokens: 3000`, `AbortController` 45초. **tool 강제**: `tools:[{name:'board_report', input_schema}]`, `tool_choice:{type:'tool', name:'board_report'}` → `content` 에서 `type==='tool_use'` 블록의 `input` 을 쓴다. temperature 등 다른 파라미터는 넣지 않는다.

input_schema: 위 BoardSummaryData 모양(fake 제외), `sections[].item_id` enum = 그룹의 항목 id, themes minItems 2 maxItems 6, standouts maxItems 2.

system 프롬프트(그대로 사용, 필요시 문장 다듬기만):
```
당신은 카카오뱅크 리더 워크샵 토론세션의 갈무리 담당이다. 반조(4명 안팎의 리더 모임)들이 폰으로 급히 적은 답을 모아,
진행자가 대형 스크린에 띄워 1분 안에 함께 읽을 "갈무리 리포트" 한 장을 만든다.
원칙:
- 답에 실제로 있는 내용만 쓴다. 지어내지 않는다.
- 비슷한 답을 4~6개 주제로 묶는다. 주제 제목은 16자 이내 명사형, 읽는 사람이 바로 이해하는 말로.
- count 는 그 주제로 묶은 답의 수(대략이어도 된다). 큰 주제부터 정렬한다.
- quote 는 그 주제를 대표하는 답 하나에서 원문 그대로 옮긴 구절(80자 이내, 자르면 끝에 …). 고치거나 요약하지 않는다.
- standouts 는 수는 적어도 짚어 볼 만한 의견 최대 2개(원문 그대로) + why(30자 이내, 왜 눈여겨볼지).
- 질문과 무관한 답은 주제에 넣지 말고 offtopic 수로만 센다.
- headline 은 방 전체가 한 말을 한 문장(40자 이내)으로. takeaway 는 "그래서 우리는" 관점의 시사점 한 문장(60자 이내).
- 반조 이름, 사람 이름, 특정 부서명은 쓰지 않는다. 존댓말 대신 간결한 명사형·평서형.
```
user 메시지: 그룹 제목·질문 + 항목별 블록 `[항목 1-2 · 남았으면 하는 것 — 그래도 은행에 남았으면 하는 것]\n1. 답\n2. 답…` (번호는 항목 안에서). 항목이 두 개(Q2-3)면 각각 섹션을 만들라고 명시.

**검증·정리(서버에서, 저장 전)** — `sanitizeSummary(raw, source)`:
- 문자열 trim, 제어문자 제거, 길이 자르기(headline 60, takeaway 90, title 24, quote 100, why 40)
- quote: 끝의 `…`/`...` 와 앞뒤 따옴표 떼고 공백 정규화 후 **그 항목 답 중 하나의 부분 문자열이 아니면 '' 로 비운다**(standout 은 통째로 버린다)
- count: 정수, 0~답 수로 clamp. themes 는 count 내림차순, 최대 6
- sections: 그룹 항목 순서대로 하나씩(없으면 빈 섹션), 모르는 item_id 버림
- 결과에 headline 이 비면 '오늘 나온 답 모아보기'

## 5. 가짜 요약 (`fakeSummary(source)`) — 키 없을 때·로컬·E2E

AI 아님이 화면에 분명히 보이게 `fake: true`. 결정적(같은 입력 → 같은 출력):
- 각 항목 답을 길이순으로 정렬해 상위 4개를 theme(제목 = 답 앞 12자 + '…', count = 그 항목 답 수를 4로 나눠 배분, quote = 그 답 앞 60자)
- standouts = 가장 짧은 답 1개(why '예시')
- headline `'[예시] AI 키를 넣으면 진짜 갈무리가 나옵니다'`, takeaway `'지금은 화면 모양 확인용 예시입니다'`
- model `'fake'`

## 6. 클라이언트

**어댑터** (`boardDb.ts` 인터페이스 + supabase/local 구현):
- `summaries(key): Promise<BoardSummary[]>` — supabase: rpc board_summary_list / local: localStorage
- `summarize(key, group): Promise<BoardSummary>` — supabase: `fetch('/api/board/summary', {method:'POST', headers:{'x-operator-key':key,'content-type':'application/json'}, body: JSON.stringify({group})})`, 타임아웃 70초(기존 8초 RPC 타임아웃 쓰지 말 것). 오류 코드 → `BoardError`(no_api_key→새 코드 `BOARD_NO_AI_KEY`, forbidden→FORBIDDEN, empty→EMPTY, 그 외→`BOARD_AI_FAILED`). boardErrorText 에 문구 추가: 'AI 키가 아직 설정되지 않았어요. (Vercel 환경변수 ANTHROPIC_API_KEY)', 'AI 갈무리를 만들지 못했어요. 잠시 후 다시 시도하거나 카드 읽기로 진행하세요.'
  - local: 로컬 저장소에서 source 만들어(숨김·빈 답 제외, 항목 순) POST(body.source) → 받은 결과를 로컬 저장 + 브로드캐스트
- `showSummary(key, group | null): Promise<BoardState>` — supabase: rpc board_summary_show / local: state.summary 갱신 + 브로드캐스트
- local `setState` 에도 §2 의 자동 해제 규칙(phase≠wall, current_item 변경) 적용. local `reset` 도 summaries 삭제.

**운영자 화면 `BoardAdmin.tsx`** — wall 단계일 때 기존 패널들 사이(모아보기 카드 패널 위쪽이 자연스러움)에 `SummaryPanel`:
- 대상 = 지금 선택된 탭 `state.current_item`
- 상태 줄: 저장본 없음 / `만드는 중… n초`(1초마다) / `HH:mm 생성 · 답 n건 · 모델` (+ `fake` 면 `예시` 배지) / 오류 문구
- 저장본이 있고 지금 그 그룹의 보이는 답 수(스냅샷 기준) ≠ source_count 면 `그 뒤 답이 바뀌었어요 — 다시 만들기 권장` 안내
- 버튼: [AI 갈무리 만들기]/[다시 만들기] (만드는 중 비활성), [스크린에 띄우기]/[스크린에서 내리기] (state.summary?.group === 현재 그룹이면 내리기), 저장본 없으면 띄우기 비활성
- 미리보기: 송출 리포트와 같은 컴포넌트를 축소(`scale`)해 보여 주거나, 간단 목록(headline, 주제·건수, standouts) — 둘 중 구현 쉬운 쪽
- 진입 시·탭 바뀔 때 `summaries(key)` 로 불러와 그룹별 캐시. 생성 직후 캐시 갱신.
- 단축키 추가 없음. busy 패턴은 기존 `busyRef` 관례를 따른다.

**송출 화면 `BoardCast.tsx`** — `state.summary` 가 있고 `state.phase === 'wall'` 이면 모아보기 대신 `SummaryReport` 전체 화면(크게 보기 FocusCard 보다 아래 우선순위: focus 가 있으면 focus 가 위에 뜨는 기존 동작 유지).
- 기존 screen_theme(dark/light) 색 체계·폰트 크기 관례를 따른다. 16:9 1920×1080 기준, 1280×720 에서도 넘치지 않게(긴 글은 line-clamp).
- 레이아웃:
  - 상단 줄: `AI 갈무리 · {groupLabel} {group.title}` + 오른쪽 작게 `답 {source_count}건 · 건수는 대략`
  - 헤드라인(가장 큰 글자, 1~2줄)
  - 본문 왼쪽(약 60%): 주제 막대 — 제목 + `{count}건` + 막대(최대 count 기준 상대 길이) + 그 아래 작은 글씨로 “quote” (quote 비면 생략)
  - 본문 오른쪽(약 40%): `눈여겨볼 의견` 카드 최대 2개(“quote” + why) → 아래 `그래서` 박스에 takeaway
  - 섹션이 2개(Q2-3)면 왼쪽 영역을 두 칸으로 나눠 항목별 주제(각 최대 4개), 칸 머리에 항목 제목. standouts 는 두 섹션 것을 합쳐 최대 2개.
  - offtopic > 0 이면 하단에 작게 `주제와 다른 답 n건`
  - `fake` 면 우상단에 눈에 띄는 `예시 · AI 아님` 배지
  - 등장 애니메이션은 framer-motion 으로 가볍게(막대가 0→길이), 과하지 않게
- 반조 표기·card 키 어디에도 없음.

**폰 화면(BoardPlayer)** 변경 없음.

## 7. 사전 생성본(운영 DB) — 구현 범위 밖, Claude(오케스트레이터)가 따로 넣음

## 8. 테스트·마무리

- `npm run lint`, `npx tsc --noEmit`, `npm run build` 통과
- SQL 스모크(로컬 PG)에 SUMMARY 포함 전부 OK
- 기존 E2E `/tmp/claude-0/pw/board-e2e.mjs` (132 checks, `npx next start -p 3100`, env 없이 로컬 모드) 그대로 통과. 시작 전 `ps aux | grep next-server` 로 남은 서버 정리.
- 새 E2E `/tmp/claude-0/pw/board-summary-e2e.mjs`: 로컬 모드에서 답 몇 건 만들고 wall → 운영자 [만들기] → 패널에 예시 배지·주제 → [띄우기] → 송출 화면에 리포트(헤드라인·예시 배지) → 탭 이동 시 자동 해제 → 다시 띄우기 → [내리기]. 스크린샷 `/tmp/claude-0/pw/shots/summary-*.png` (1920×1080 dark, 1280×720 light, Q2-3 두 섹션)
- `NOTES.md`·`BOARD_RUNBOOK.md` 에 v1.2 절 추가(키 등록 방법: Vercel → Settings → Environment Variables → `ANTHROPIC_API_KEY` (Production, Sensitive) → 재배포 / 선택 `BOARD_SUMMARY_MODEL`)
- 커밋은 board-v1 브랜치에 의미 단위로(푸시는 하지 말 것). git 사용자 설정은 이미 되어 있음. 커밋 메시지 끝에:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01TzhF74uwi5R28txsCGWPoz
  ```
