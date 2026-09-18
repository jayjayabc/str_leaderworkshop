import type { NextConfig } from "next";

// Vercel의 Supabase 통합은 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY 이름으로 키를 넣어 준다.
// 앱은 NEXT_PUBLIC_SUPABASE_ANON_KEY 를 읽으므로 빌드 시점에 이름을 맞춰 준다.
const supabaseKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  process.env.SUPABASE_ANON_KEY ??
  "";

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: supabaseKey,
  },
};

export default nextConfig;
