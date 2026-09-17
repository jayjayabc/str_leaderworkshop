# 🐘 코끼리 보드

리더워크샵 Day 2 "커스텀 코끼리 진단"을 위한 **실시간 키워드 매핑 보드**입니다.
가운데 5칸(🐘 코끼리 · 🐟 죽은 물고기 · 🤮 토하기 · 🐦 파랑새 · 🌱 새싹)에 왼쪽 풀의 카드를 끌어다 놓으면
같은 링크에 들어온 모든 사람 화면에 즉시 반영됩니다. 로그인 없이 닉네임만으로 참여합니다.

---

## 빠른 시작 (로컬)

```bash
npm install
npm run dev          # http://localhost:3000
```

환경변수 없이 바로 뜹니다. 이때는 **로컬 모드**로 동작합니다(아래 참고).

---

## 배포 3단계

### 1. Supabase 프로젝트 만들고 스키마 실행

1. [supabase.com](https://supabase.com)에서 새 프로젝트를 만듭니다.
2. 대시보드 왼쪽 **SQL Editor** → **New query**.
3. 이 저장소의 [`supabase/schema.sql`](supabase/schema.sql) 내용을 **전부 붙여넣고 Run**.
   테이블 7개(boards·participants·keywords·placements·votes·notes·events),
   Realtime 발행 설정, 익명 읽기·쓰기 RLS 정책이 한 번에 만들어집니다.
4. **Project Settings → API**에서 `Project URL`과 `anon public` 키를 복사해 둡니다.

### 2. 환경변수 설정

프로젝트 루트에 `.env.local`을 만들고 방금 복사한 값을 넣습니다.

```bash
cp .env.example .env.local
```

```env
NEXT_PUBLIC_SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOi...
```

`npm run dev`를 다시 실행하면 상단바 배지가 **실시간**으로 바뀝니다.
두 값 중 하나라도 비어 있으면 자동으로 로컬 모드로 떨어집니다.

### 3. Vercel 배포

1. [vercel.com](https://vercel.com) → **Add New… → Project** → 이 저장소를 Import.
2. **Environment Variables**에 위 두 개를 그대로 추가합니다
   (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`).
   Framework Preset은 Next.js로 자동 인식되고 빌드 설정은 손댈 게 없습니다.
3. **Deploy**. 끝나면 나오는 주소를 열어 보드를 만들고, `/b/{slug}` 링크를 참가자에게 공유하면 됩니다.

---

## 로컬 모드 vs 실시간 모드

| | 로컬 모드 | 실시간 모드 |
|---|---|---|
| 조건 | 환경변수 없음 | `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` 둘 다 있음 |
| 저장 | 브라우저 `localStorage` | Supabase(Postgres) |
| 동기화 | `BroadcastChannel` — **같은 브라우저의 다른 탭끼리만** | Supabase Realtime — 모든 기기·모든 사람 |
| 용도 | 혼자 흐름 확인, 데모, 개발 | 리허설·워크샵 당일 |

> **주의**: 로컬 모드에서 만든 보드는 그 브라우저에만 있습니다.
> 링크를 다른 사람에게 보내도 "보드를 찾을 수 없습니다"가 뜹니다.
> 여러 기기에서 같이 쓰려면 반드시 위 2단계까지 해서 실시간 모드로 띄우세요.

---

## 호스트 권한

- 보드를 **만든 브라우저**에 `host_token`이 저장되고, 그 브라우저가 호스트가 됩니다.
- 호스트만 할 수 있는 것: 단계 전환(배치→투표→발표), 보드 잠금, 되돌리기, 전체 초기화,
  축 표시 토글, 🤮 숨김, 타이머 시작·정지, 축 필터, 카드의 축·예상 칸 보기.
- **다른 기기에서 호스트가 되려면**: 호스트 브라우저의 **⋯ 메뉴 → 호스트 토큰 복사** 로 토큰을 받아,
  그 기기의 **⋯ 메뉴 → 호스트 토큰 입력** 에 붙여넣습니다.
  (진행자가 노트북에서 보드를 만들고 태블릿에서 진행하는 경우에 씁니다. 토큰은 공유하지 마세요.)

---

## 진행 흐름 (S1 팀 리허설 스크립트)

1. 진행자가 `/`에서 제목을 넣고 **보드 만들기** → `/b/{slug}` 링크를 팀에 공유한다.
2. 각자 링크를 열어 **닉네임 + 역할**(전략팀/임원/리더)만 입력하고 들어온다. 상단바에 👥 인원이 뜬다.
3. 왼쪽 풀의 46장을 끌어 5칸에 놓는다. 남이 놓으면 내 화면에서도 카드가 움직이고 토스트가 뜬다.
4. 오른쪽 패널에서 **칸별 개수 · 축 분포 · 예상≠실제**를 보며 이야기한다. 항목을 누르면 그 카드가 강조된다.
5. 호스트가 **투표** 단계로 바꾼다. 각자 점 스티커 3개를 카드에 붙인다. 상위 5개가 패널에 뜬다.
6. 호스트가 **발표** 단계로 잠근 뒤 **발표 모드**를 켠다. 풀·패널이 사라지고 보드만 크게 보인다(🤮 숨김 가능).
7. ⋯ 메뉴에서 **JSON · CSV · PNG**로 내보낸다. 링크를 닫았다 열어도 상태는 그대로다.

타이머(⏱)는 언제든 쓸 수 있습니다. 호스트가 15/30분 또는 직접 입력한 시간으로 시작하면
모든 참가자가 같은 남은 시간을 봅니다.

---

## 화면·조작

- **반응형**: 데스크톱은 풀·보드·패널 3단. 태블릿 가로(≤1180px)는 풀이 하단 서랍, 패널이 우측 시트로 접힙니다.
  휴대폰(≤768px)은 **보기 전용**이고 칸이 세로로 쌓입니다.
- **키보드**: Tab으로 카드를 고르고 `1`~`5`로 칸 이동(코끼리·죽은물고기·토하기·파랑새·새싹), `0`으로 풀 복귀.
  `Enter`/`Space`는 카드 상세, `Esc`는 발표 모드 종료, `Ctrl/Cmd+Z`는 호스트 되돌리기.
- **터치**: 태블릿에서 길게 눌러 끌면 됩니다.

---

## 개발

```bash
npm run dev         # 개발 서버
npm run build       # 프로덕션 빌드
npm run start       # 빌드 결과 실행
npm run lint        # ESLint
npm run typecheck   # tsc --noEmit
```

- 상태는 `src/store/board.ts` 하나(zustand).
- DB 접근은 `src/lib/db.ts` 한 곳에서만. `db.local.ts`(localStorage+BroadcastChannel)와
  `db.supabase.ts`(Postgres+Realtime)가 같은 `BoardAdapter` 인터페이스를 구현합니다.
- 시드 카드 46장·축·칸 정의는 `src/lib/seed.ts`와 `src/lib/design.ts`에 있습니다.
- 자세한 구현 결정과 브리프와의 차이는 [`NOTES.md`](NOTES.md)를 보세요.

---

## 아직 없는 것 (2차 범위)

- 방(room) 다중 생성 + 32테이블 **전체 집계 화면** (BRIEF §2 S2)
- **개인 모드 → 공개 → 합의** 흐름과 역할별(임원 vs 리더) 인식 갭 (§2 S3)
- 사진 업로드 → OCR로 카드 자동 생성
- 상위 카드 5개를 문장으로 요약해 주는 한 줄 요약
- 카드 색 태그(★ 등 참가자 임의 표시)
- `host_token` 서버 검증(Edge Function). 지금은 클라이언트에서만 확인하고,
  RLS는 "slug를 아는 사람은 읽기·쓰기 가능"인 익명 허용 정책입니다.
