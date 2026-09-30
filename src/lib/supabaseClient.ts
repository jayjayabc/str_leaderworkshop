// Supabase 클라이언트 단일 인스턴스 — 보드 어댑터와 퀴즈 어댑터가 함께 쓴다.
// (클라이언트를 두 번 만들면 GoTrueClient 중복 경고가 뜨고 웹소켓도 두 개가 된다)

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let client: SupabaseClient | null = null;

export function hasSupabaseEnv(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}

export function sb(): SupabaseClient {
  if (!client) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) throw new Error('Supabase 환경변수가 없습니다');
    client = createClient(url, key, { realtime: { params: { eventsPerSecond: 20 } } });
  }
  return client;
}
