# 토의보드 v1.1 구현 명세 (10/8 팀 논의 반영) — 구현자용

근거 문서: 개선 계획 v1.0 (아래 요약이 전부). 현재 운영본 v1.0 코드·SQL을 그대로 확장한다. 퀴즈 코드·테이블은 건드리지 않는다.

## 0. 원칙
- 송출·참가자 화면에는 **반조(작성 조) 정보가 어떤 형태로도 나오지 않는다**(화면은 물론, 참가자가 받는 RPC 응답에도 team_id를 싣지 않는다). 운영자 화면·CSV에만 남긴다.
- 새 기능은 운영자가 켜고 끌 수 있다. 기본값은 아래에 적힌 대로.
- 기존 보안 규칙 유지: 테이블 직접 접근 금지, 쓰기는 RPC, 운영 RPC는 `board_check_key`, SECURITY DEFINER + `set search_path = public`, 새 함수는 필요한 것만 anon에 grant, 내부 함수는 revoke.
- `supabase/board_v1.1_migration.sql` 새 파일(멱등). `board_v1.0` + `sec_v1.0` 이 이미 적용된 DB 위에 얹는다. 적용 순서는 SQL → 코드.

## 1. 무기명화 (P0-1)
- `board_feed` 응답에서 `team_id` 제거, 대신 **`card`**(불투명 카드 키) 추가: `card = encode(hmac(team_id || ':' || group_key, salt, 'sha256'), 'hex')` 앞 16자. salt는 새 테이블 `board_secret(id int pk check(id=1), salt text not null default encode(gen_random_bytes(16),'hex'))`, RLS on + `revoke all from anon, authenticated`. 같은 반조의 같은 그룹 카드(2-3a·2-3b)는 같은 `card` → 송출에서 한 장으로 묶는다.
- `board_admin_snapshot.submissions` 각 행에 `card` 추가(운영자는 team_id도 그대로).
- `focus`(크게 보기)는 `team_id` 대신 `card`를 저장. `board_moderate`의 '숨기면 크게 보기 해제'도 card 비교로. 송출 크게 보기 카드에 반조 배지 없음.
- 송출 월 카드·크게 보기·폰 월(다른 반조 카드)에서 반조 배지 제거. 참가자 자신의 화면 상단 `12A` 표시는 유지(본인 확인용).

## 2. 타이머 제거 (P0-2)
- 송출·폰에서 타이머 표시 전부 제거. 운영자 화면의 "항목 열 때 자동 시작" 기본 **끔**, 타이머 패널은 접어 두는 '고급' 영역으로.
- `board_state.item_opened_at timestamptz` 추가: `item_open`이 false→true가 될 때 now(). 운영자 상단에 "열린 지 n분 m초"(참고용)만 표시.

## 3. 작성 예시 (P0-3)
- `board_items.examples text[]` 추가(기존 `example`은 남겨 두되 화면은 `examples` 사용). 시드(초안 — 팀 확정 전):
  - Q1-1: "월급 들어오면 저축·카드값·용돈으로 알아서 나눠 담아 줬으면" / "앱을 여는 대신 에이전트한테 '이번 달 얼마 썼어?'만 물어볼 듯"
  - Q1-2: "큰돈 움직일 땐 사람한테 한 번 확인받고 싶다" / "문제가 생기면 책임지는 곳은 결국 은행"
  - Q1-3: "가입할 때 서류·인증 단계가 확 줄었으면" / "금리 비교도 갈아타기도 에이전트가 한 번에"
  - Q1-4: "에이전트가 우리 상품을 쉽게 쓸 수 있는 연결 통로" / "고객 대신 움직여도 안전한 한도·확인 장치"
  - Q2-1: "토큰은 많이 쓰는데 정확하게 쓸 줄 몰라 결과가 안 나왔다" / "데이터가 어디 있는지 몰라서 AI한테 줄 수가 없었다"
  - Q2-2: "잘 된 프롬프트·사례를 팀에서 공유하며 일한다" / "초안은 AI, 판단은 사람 — 검토 순서를 정해 두고 일한다"
  - Q2-3a: "다음 주 주간보고를 AI 초안으로 만들어 보겠다" / "회의록 정리부터 AI로 바꿔 보겠다"
  - Q2-3b: "팀별 도구 가이드를 준비해 달라" / "써도 되는 데이터·도구 기준을 한 장으로 정리해 달라"
- 폰 입력 카드: 입력칸 위에 "예시 — 이 정도로 가볍게 써도 돼요" + 예시 2개(옅은 말풍선). placeholder는 "2~3문장이면 충분해요".
- 송출 월: 해당 그룹 카드가 0장일 때 예시 카드 2장을 `예시` 꼬리표·점선 테두리·옅은 투명도로 표시, 첫 카드가 오면 사라짐.
- `boardSeed.ts`도 같은 값으로(로컬 어댑터·화면용).

## 4. 모아보기 탭 (P0-4) + 명칭
- '월 보기' → **'모아보기'** (운영자·송출·폰 모든 문구).
- 운영자 진행 순서의 "모아보기 ①/②"는 그 질문의 첫 항목 탭으로 열린다(기존과 같음). 송출 모아보기 화면 상단에 **탭 바**: 그 질문의 그룹들(1-1·1-2·1-3·1-4 / 2-1·2-2·2-3)을 가로로, 각 탭에 카드 수, 현재 탭(`current_item`) 강조. 탭 전환은 운영자 카드 패널의 그룹 버튼(이미 wall 단계에서 current_item을 바꿈) + 운영자 화면에 **"◀ 이전 탭 / 다음 탭 ▶"** 버튼과 단축키 **← →**.
- 폰 모아보기(월 공개 시)도 같은 탭 구조로(이미 질문별 섹션이 있으니 탭 버튼으로 전환).

## 5. 넘버링 (P0-5)
- 표시용 라벨: 대질문 **"질문 1 · AI for User" / "질문 2 · AI for Company"**(원문자 ①② 쓰지 않음). 세부 항목 라벨 **"1-1", "1-2", … "2-3"**(Q 접두사 제거, `groupLabel(id)` 헬퍼). 생각의 틀(돈의 네 영역)은 **번호 없는 칩**(송출 소개 화면의 "영역 1" 제거). 질문 2 아젠다 칩도 번호 없이 "2-1 막힌 것" 식이 아니라 그냥 "막힌 것 → 일하는 방식 → 당장 할 것" 화살표 흐름.
- DB의 item id(Q1-1 등)·CSV 열 이름은 그대로 둔다.

## 6. 질문 상시 노출 (P1-8)
- 송출 항목 입력 화면·모아보기 화면 상단(헤더 아래)에 대질문 문장 한 줄(작은 글씨, 말줄임 없이 최대 2줄).

## 7. 투표 (P1-6) — 기본: 2-3만 켬
- `board_state`에 `vote_items text[] not null default '{Q2-3}'`(투표 대상 그룹), `vote_open boolean default false`(투표 받는 중), `vote_reveal boolean default false`(순위 공개) 추가. `board_set_state` 허용 키에 추가(vote_items는 존재하는 group_key만).
- 새 테이블 `board_votes(participant_id uuid references board_participants on delete cascade, group_key text, team_id text references board_teams on delete cascade, created_at timestamptz default now(), primary key(participant_id, group_key, team_id))`. RLS on, anon 권한 없음.
- RPC `board_vote(p_id uuid, p_group text, p_card text, p_on boolean) returns json`: 참가자 존재, `p_group = any(vote_items)`, `vote_open`, card→team 매핑(해당 그룹에 숨김 아닌·빈 본문 아닌 제출이 있는 반조 중 card 일치), **자기 반조 카드 투표 불가**(BOARD_OWN_CARD), 그룹당 **최대 3표**(BOARD_VOTE_LIMIT). p_on=false면 취소. 반환 `{ my: [card…], left: n }`.
- RPC `board_my_votes(p_id uuid, p_group text) returns json` → `{ my: [card…], left: n }`.
- RPC `board_ranking(p_group text) returns json`: `vote_reveal`이거나 운영자… (anon은 vote_reveal=true이고 p_group=any(vote_items)일 때만, 아니면 BOARD_FORBIDDEN) → `[{card, votes, parts:[{item_id, body}]}]` 득표순, 숨김 제외, team_id 없음.
- `board_admin_snapshot`에 `votes: [{group_key, team_id, votes}]`, `voters: n`(투표한 기기 수) 추가.
- `board_reset`: 'group'은 그 그룹 투표도 삭제, 'all'은 votes 전부 삭제 + vote_open/vote_reveal false.
- 송출: 현재 그룹이 투표 대상이고 `vote_open`이면 상단 배너 "공감 가는 아이디어에 ♥ (한 사람 3표) — 폰에서 투표" + 우측 작은 QR(참가 주소) + "투표한 기기 n"(board_counts에 voters 추가). `vote_reveal`이면 **순위 화면**: 상위 5장 크게(득표수 막대), 나머지는 작게.
- 폰: 현재 그룹이 투표 대상이고 `vote_open`이면 역할과 무관하게 **투표 화면**(카드 목록, 각 카드 ♥ 토글, "남은 표 n", 자기 반조 카드는 "우리 반조" 회색 표시·투표 불가 — 이건 본인 반조라 표시해도 무기명 위반 아님). `vote_reveal`이면 순위 보기.
- 운영자: "투표" 패널 — 그룹별 투표 대상 스위치(전 그룹 나열, 기본 2-3 켬), **투표 열기/마감**, **순위 공개/숨김**, 현재 그룹 득표 순위표(운영자에게는 반조 ID 포함), 투표 기기 수.
- CSV: 와이드에 `Q2-3_votes` 같은 열을 추가하지 말고, 롱 CSV에 `votes` 열(그 행의 그룹·반조 득표) 추가. 투표 그룹이 아니면 빈칸.

## 8. 관전자 입장 (P1-7)
- `board_participants.role text not null default 'recorder' check (role in ('recorder','viewer'))`.
- `board_join(p_team, p_name, p_device, p_role text default 'recorder')` — 기존 3-인자 호출도 동작해야 함(옛 함수 drop 후 4-인자로 재생성). 반조당 20대 제한 유지. 같은 기기 재입장 시 역할 갱신.
- `board_submit`: viewer면 `BOARD_NOT_RECORDER`.
- `board_counts`: `joined` = recorder가 있는 반조 수(기존 의미 유지), `viewers` = viewer 수, `voters` = 현재 그룹에 투표한 기기 수.
- 폰 입장 흐름: 조 번호 → A/B → **역할 선택 2버튼**: "기록자로 입장 — 우리 반조 답을 입력해요(반조당 1명)" / "관전자로 입장 — 보면서 이야기하고, 투표 때 참여해요". 이름 입력은 기록자일 때만.
- 관전자 화면: 기록자와 같은 화면이되 입력 카드 대신 "기록자가 입력 중이에요" + 우리 반조 제출 내용 읽기 전용. 투표 때 투표 화면.
- 폰 하단 "반조 바꾸기" 옆에 "역할 바꾸기".

## 9. 진행 순서 정리 (P2 반영)
- 운영자 STEPS: 대기 → 질문 1 소개 → 1-1 … 1-4 → **모아보기 1** → **휴식(선택)** → 질문 2 소개 → 2-1 → 2-2 → 2-3 → **모아보기 2** → 종료. Space로 '다음' 갈 때 휴식은 건너뛴다(휴식은 버튼으로만 들어감). 발표 관련 문구 제거(하이라이트 기능은 유지).
- 휴식 송출 화면에서 "16:30" 같은 고정 시각 문구 제거 → "잠시 쉬어 갑니다".

## 10. 문서·테스트
- `scripts/board-sql-smoke.sql`에 v1.1 검사 추가: feed에 team_id 없음·card 있음, 같은 반조 2-3a/b card 동일, viewer 제출 거부, 투표 대상 아님/마감 거부, 자기 반조 거부, 4번째 표 거부, 취소 후 재투표, ranking 비공개 시 거부·공개 시 득표순, reset 시 votes 삭제, 3-인자 board_join 호환.
- 로컬 PG16(아래)에서 quiz_schema → board_v1.0 → sec_v1.0 → board_v1.1 → board_v1.1(두 번) 적용 후 스모크 통과.
- `npm run typecheck`, `npm run lint`, `npm run build`, `npm run test:quiz` 통과.
- Playwright E2E `/tmp/claude-0/pw/board-e2e.mjs`를 v1.1에 맞게 갱신(무기명·타이머 없음·예시 카드·탭·투표·관전자 시나리오 추가). 로컬 모드 서버(`npx next start -p 3100`, Supabase 환경변수 없이)로 전부 통과. 브라우저: `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`. 폰 여러 대는 `?as=라벨`.
- 로컬 어댑터(`boardDb.local.ts`)도 같은 규칙(card 키는 간단한 해시로).
- NOTES.md에 "Board v1.1" 절, BOARD_RUNBOOK.md 갱신(단축키 ← →, 투표 진행 멘트, 관전자 안내 멘트).
- git commit 하지 말 것, push 하지 말 것.
