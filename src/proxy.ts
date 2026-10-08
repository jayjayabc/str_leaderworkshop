// 행사별 짧은 주소 (Sites v1.0) — 같은 앱을 주소로 나눠 쓴다.
//   lw2026-quiz.vercel.app   →  /  = /quiz   ·  /screen = /quiz/screen   ·  /admin = /quiz/admin
//   lw2026-board.vercel.app  →  /  = /board  ·  /screen = /board/screen  ·  /admin = /board/admin
//   그 밖의 주소(elephant-board.vercel.app, 미리보기)는 아무것도 바꾸지 않는다.
//   짧은 주소에서 다른 행사 경로(/board, /quiz)로 들어오면 그 주소의 첫 화면으로 돌려보낸다.
//   주소를 바꾸려면 Vercel 환경변수 SITE_QUIZ_HOSTS / SITE_BOARD_HOSTS(쉼표로 여러 개) 또는 아래 기본값을 고친다.

import { NextResponse, type NextRequest } from 'next/server';

const DEFAULT_QUIZ_HOSTS = 'lw2026-quiz.vercel.app';
const DEFAULT_BOARD_HOSTS = 'lw2026-board.vercel.app';

function hosts(v: string | undefined, fallback: string): string[] {
  return (v || fallback)
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
}

const SITES: { base: '/quiz' | '/board'; other: '/quiz' | '/board'; match: (host: string) => boolean }[] = [
  {
    base: '/quiz',
    other: '/board',
    // Quiz v2.1부터 쓰던 규칙 유지: 호스트에 'quiz'가 들어가면 퀴즈 주소
    match: (h) => hosts(process.env.SITE_QUIZ_HOSTS, DEFAULT_QUIZ_HOSTS).includes(h) || h.includes('quiz'),
  },
  {
    base: '/board',
    other: '/quiz',
    // 'board'는 기본 주소(elephant-board…)에도 들어 있어서 정확히 등록한 주소만
    match: (h) => hosts(process.env.SITE_BOARD_HOSTS, DEFAULT_BOARD_HOSTS).includes(h),
  },
];

const SHORT: Record<string, string> = { '/': '', '/screen': '/screen', '/admin': '/admin' };

export function proxy(req: NextRequest) {
  const host = (req.headers.get('host') ?? '').split(':')[0].toLowerCase();
  const site = SITES.find((s) => s.match(host));
  if (!site) return NextResponse.next();

  const { pathname } = req.nextUrl;
  if (pathname in SHORT) {
    const url = req.nextUrl.clone();
    url.pathname = site.base + SHORT[pathname];
    return NextResponse.rewrite(url);
  }
  // 다른 행사 화면과 코끼리보드 화면은 이 주소에서 열지 않는다
  if (pathname === site.other || pathname.startsWith(`${site.other}/`) || pathname.startsWith('/b/')) {
    const url = req.nextUrl.clone();
    url.pathname = '/';
    url.search = '';
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  // 화면 경로만 — 정적 파일·API·이미지 최적화는 건드리지 않는다
  matcher: ['/', '/screen', '/admin', '/quiz/:path*', '/board/:path*', '/b/:path*'],
};
