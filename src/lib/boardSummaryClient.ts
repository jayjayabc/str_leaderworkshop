// AI 갈무리 요청 (Board v1.2) — 두 어댑터가 함께 쓰는 /api/board/summary 호출.
//   기존 RPC 의 8초 제한을 쓰지 않는다 — Claude 호출이 10~30초 걸린다(서버 45초 + 여유).
import type { BoardGroupId } from './boardSeed';
import type { BoardSummary, BoardSummarySource } from './boardSummary';
import { BoardError } from './boardTypes';

export const SUMMARY_REQUEST_TIMEOUT_MS = 70_000;

/** 서버가 돌려주는 error 코드 → BoardError (no_api_key→BOARD_NO_AI_KEY, forbidden→FORBIDDEN, empty→EMPTY, 그 외→BOARD_AI_FAILED) */
export function summaryErrorFrom(code: string | undefined): BoardError {
  if (code === 'no_api_key') return new BoardError('BOARD_NO_AI_KEY');
  if (code === 'forbidden') return new BoardError('BOARD_FORBIDDEN');
  if (code === 'empty') return new BoardError('BOARD_EMPTY', 'summary');
  return new BoardError('BOARD_AI_FAILED', code);
}

export async function requestSummary(key: string, group: BoardGroupId, source?: BoardSummarySource): Promise<BoardSummary> {
  let res: Response;
  try {
    res = await fetch('/api/board/summary', {
      method: 'POST',
      headers: { 'x-operator-key': key, 'content-type': 'application/json' },
      body: JSON.stringify(source ? { group, source } : { group }),
      cache: 'no-store',
      signal: AbortSignal.timeout(SUMMARY_REQUEST_TIMEOUT_MS),
    });
  } catch {
    // 시간 초과 · 네트워크 끊김
    throw new BoardError('BOARD_AI_FAILED', 'request');
  }
  const body = (await res.json().catch(() => null)) as (Partial<BoardSummary> & { error?: string }) | null;
  if (!res.ok || !body || body.error || !body.data || !body.group) throw summaryErrorFrom(body?.error ?? `http_${res.status}`);
  return { group: body.group, data: body.data, model: body.model ?? '', source_count: body.source_count ?? 0, created_at: body.created_at ?? new Date().toISOString() };
}
