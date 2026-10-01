// 정답 키 — 운영자 키가 맞을 때만 내려준다 (Quiz v1.3). 정답이 공개 JS 번들에 실리지 않게 하려는 것.
import { QUIZ_KEYS } from '@/lib/quizSeed';

export const dynamic = 'force-dynamic';

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

/** Supabase의 운영자 함수로 키를 확인한다 (quiz_check_key는 직접 못 부르므로 빈 스냅샷으로) */
async function keyOk(key: string): Promise<boolean> {
  if (!URL_ || !ANON) return true; // 로컬 모드(개발) — 게이트 없음
  if (!key) return false;
  const res = await fetch(`${URL_}/rest/v1/rpc/quiz_admin_snapshot`, {
    method: 'POST',
    headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_key: key, p_index: -1 }),
    cache: 'no-store',
  });
  return res.ok;
}

export async function POST(req: Request) {
  const key = (req.headers.get('x-operator-key') ?? '').trim();
  if (!(await keyOk(key))) {
    return Response.json({ error: 'forbidden' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
  }
  return Response.json(QUIZ_KEYS, { headers: { 'Cache-Control': 'no-store' } });
}
