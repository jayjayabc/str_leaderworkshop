// AI 갈무리 만들기 (Board v1.2) — 운영자 키를 Supabase 로 먼저 확인한 뒤에만 Claude 를 부른다.
//   Supabase 모드: board_summary_source(키 확인 + 그 그룹의 보이는 답) → Claude(또는 가짜) → 검증·정리 → board_summary_save
//   로컬 모드(Supabase 환경변수 없음 — 개발·E2E 전용): body.source 를 쓰고 저장은 클라이언트(로컬 어댑터)가 한다.
//   반조 정보(team_id·card)는 어디로도 가지 않는다 — 원문 RPC 가 싣지 않고, 여기서도 item_id·body 만 골라 쓴다.
import { BOARD_GROUPS, groupById, type BoardGroupId, type BoardItemId } from '@/lib/boardSeed';
import { fakeSummary, type BoardSummary, type BoardSummaryData, type BoardSummarySource } from '@/lib/boardSummary';
import { SummaryError, summarizeWithClaude } from '@/lib/boardSummary.server';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;
export const runtime = 'nodejs';

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

const HEADERS = { 'Cache-Control': 'no-store' };
/** 로컬 모드에서 받는 본문 크기 상한 (글자) */
const MAX_BODY = 400_000;

function fail(error: string, status: number): Response {
  return Response.json({ error }, { status, headers: HEADERS });
}

/** Supabase REST RPC — apikey 는 anon. 키 확인·저장은 모두 DB 함수가 한다 */
async function rpc(fn: string, args: Record<string, unknown>): Promise<Response> {
  return fetch(`${URL_}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
    cache: 'no-store',
    signal: AbortSignal.timeout(15_000),
  });
}

function str(v: unknown, max: number): string {
  return typeof v === 'string' ? v.slice(0, max) : '';
}

/** 그룹의 항목 id 만 남기고, item_id·title·prompt·body 외의 필드는 버린다 */
function toSource(group: BoardGroupId, rawItems: unknown, rawAnswers: unknown): BoardSummarySource {
  const g = groupById(group)!;
  const ids = new Set<string>(g.items.map((i) => i.id));
  const fromRaw = new Map<string, { title: string; prompt: string }>();
  if (Array.isArray(rawItems)) {
    for (const it of rawItems as Record<string, unknown>[]) {
      if (it && typeof it.item_id === 'string' && ids.has(it.item_id)) fromRaw.set(it.item_id, { title: str(it.title, 100), prompt: str(it.prompt, 300) });
    }
  }
  // 항목 목록은 시드(=DB 시드와 같은 값) 순서를 따른다
  const items = g.items.map((i) => ({ item_id: i.id as BoardItemId, title: fromRaw.get(i.id)?.title || i.title, prompt: fromRaw.get(i.id)?.prompt || i.prompt }));
  const answers: BoardSummarySource['answers'] = [];
  if (Array.isArray(rawAnswers)) {
    for (const a of (rawAnswers as Record<string, unknown>[]).slice(0, 600)) {
      if (!a || typeof a.item_id !== 'string' || !ids.has(a.item_id)) continue;
      const body = str(a.body, 1000).trim();
      if (body) answers.push({ item_id: a.item_id as BoardItemId, body });
    }
  }
  return { items, answers };
}

export async function POST(req: Request) {
  const key = (req.headers.get('x-operator-key') ?? '').trim();

  let payload: { group?: unknown; source?: unknown };
  try {
    const raw = await req.text();
    if (raw.length > MAX_BODY) return fail('bad_request', 413);
    payload = JSON.parse(raw) as typeof payload;
  } catch {
    return fail('bad_request', 400);
  }
  const group = BOARD_GROUPS.find((g) => g.id === payload.group)?.id;
  if (!group) return fail('bad_request', 400);

  const supabase = Boolean(URL_ && ANON);
  let source: BoardSummarySource;

  if (supabase) {
    // 1) 운영자 키 확인 — 이 RPC 가 통과하기 전에는 Anthropic 을 부르지 않는다. body.source 는 무시한다.
    if (!key) return fail('forbidden', 401);
    let res: Response;
    try {
      res = await rpc('board_summary_source', { p_key: key, p_group: group });
    } catch (e) {
      console.error('[board/summary] source rpc failed', e instanceof Error ? e.name : 'error');
      return fail('unavailable', 503);
    }
    if (res.status === 400 || res.status === 401 || res.status === 403) return fail('forbidden', 401);
    if (!res.ok) {
      console.error('[board/summary] source rpc status', res.status);
      return fail('unavailable', 503);
    }
    const j = (await res.json().catch(() => null)) as { items?: unknown; answers?: unknown } | null;
    source = toSource(group, j?.items, j?.answers);
  } else {
    // 로컬 모드 — 키 검사는 로컬 어댑터가 한다. 이 모드에서는 Supabase 도 안 쓴다.
    const src = payload.source as { items?: unknown; answers?: unknown } | undefined;
    source = toSource(group, src?.items, src?.answers);
  }

  // 2) 보이는 답이 없으면 요약할 것이 없다
  if (source.answers.length === 0) return fail('empty', 400);

  // 3) AI 키 — 없으면 (BOARD_SUMMARY_FAKE=1 일 때만) 가짜 요약, 아니면 안내용 오류
  const apiKey = (process.env.ANTHROPIC_API_KEY ?? '').trim();
  // 로컬 모드는 키 검사가 없으므로, Supabase 환경변수를 빠뜨린 Vercel 배포(운영·미리보기 모두)에서는
  // 아무나 API 비용을 쓰지 못하도록 가짜만 쓴다
  const localOnProd = !supabase && Boolean(process.env.VERCEL);
  let data: BoardSummaryData;
  let model: string;
  if (!apiKey || localOnProd) {
    if (supabase && process.env.BOARD_SUMMARY_FAKE !== '1') return fail('no_api_key', 503);
    data = fakeSummary(source);
    model = 'fake';
  } else {
    try {
      const out = await summarizeWithClaude(group, source, {
        apiKey,
        model: process.env.BOARD_SUMMARY_MODEL || undefined,
        baseUrl: process.env.ANTHROPIC_BASE_URL || undefined,
      });
      data = out.data;
      model = out.model;
    } catch (e) {
      const kind = e instanceof SummaryError ? e.kind : 'api_error';
      console.error('[board/summary] claude failed:', e instanceof Error ? e.message : kind);
      return fail(kind === 'timeout' ? 'ai_timeout' : 'ai_failed', kind === 'timeout' ? 504 : 502);
    }
  }

  // 4) 저장 — 로컬 모드는 클라이언트가 저장한다
  if (!supabase) {
    const out: BoardSummary = { group, data, model, source_count: source.answers.length, created_at: new Date().toISOString() };
    return Response.json(out, { headers: HEADERS });
  }
  let saved: Response;
  try {
    saved = await rpc('board_summary_save', { p_key: key, p_group: group, p_data: data, p_model: model, p_count: source.answers.length });
  } catch (e) {
    console.error('[board/summary] save rpc failed', e instanceof Error ? e.name : 'error');
    return fail('save_failed', 502);
  }
  if (saved.status === 401 || saved.status === 403) return fail('forbidden', 401);
  if (!saved.ok) {
    console.error('[board/summary] save rpc status', saved.status);
    return fail('save_failed', 502);
  }
  const row = (await saved.json().catch(() => null)) as BoardSummary | null;
  if (!row || !row.data) return fail('save_failed', 502);
  return Response.json({ group: row.group, data: row.data, model: row.model, source_count: row.source_count, created_at: row.created_at }, { headers: HEADERS });
}
