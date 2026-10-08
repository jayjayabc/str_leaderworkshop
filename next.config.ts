import type { NextConfig } from "next";

// Vercel의 Supabase 통합은 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY 이름으로 키를 넣어 준다.
// 앱은 NEXT_PUBLIC_SUPABASE_ANON_KEY 를 읽으므로 빌드 시점에 이름을 맞춰 준다.
const supabaseKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  process.env.SUPABASE_ANON_KEY ??
  "";

// 배포마다 달라지는 빌드 표식 — 열려 있던 화면이 예전 코드인지 알아내는 데 쓴다(/api/version)
const buildId = (process.env.VERCEL_GIT_COMMIT_SHA ?? "").slice(0, 7) || `local-${Date.now()}`;

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_BUILD_ID: buildId,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: supabaseKey,
  },
  // 보안 헤더 — 다른 사이트가 운영 화면을 iframe으로 감싸 클릭을 가로채지 못하게 (Sec v1.0)
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
  // 퀴즈·토의보드 전용 주소 처리는 src/proxy.ts 로 옮겼다 (Sites v1.0).
  //   호스트에 'quiz'가 들어간 주소는 예전처럼 첫 화면이 퀴즈 참가 페이지다(이제 /screen·/admin 짧은 경로도 된다).
};

export default nextConfig;
