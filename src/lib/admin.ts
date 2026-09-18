// 운영자 페이지 보조 — 키 게이트와 동시 실행 헬퍼 (v1.1 C).

const KEY_STORAGE = 'eb:operator-key';

/** NEXT_PUBLIC_OPERATOR_KEY — 비어 있으면 게이트가 꺼진다(개발 편의) */
export const OPERATOR_KEY: string = (process.env.NEXT_PUBLIC_OPERATOR_KEY ?? '').trim();

export const GATE_ENABLED = OPERATOR_KEY.length > 0;

export function readStoredKey(): string {
  if (typeof window === 'undefined') return '';
  try {
    return window.localStorage.getItem(KEY_STORAGE) ?? '';
  } catch {
    return '';
  }
}

export function writeStoredKey(value: string): void {
  try {
    window.localStorage.setItem(KEY_STORAGE, value);
  } catch {
    /* noop */
  }
}

export function clearStoredKey(): void {
  try {
    window.localStorage.removeItem(KEY_STORAGE);
  } catch {
    /* noop */
  }
}

/** URL의 ?key= 값 (있으면) */
export function keyFromUrl(): string | null {
  if (typeof window === 'undefined') return null;
  const value = new URLSearchParams(window.location.search).get('key');
  return value ? value.trim() : null;
}

/** 동시에 최대 limit개씩 실행하고 진행 상황을 알려 준다 */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
  onProgress?: (done: number, total: number) => void,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let cursor = 0;
  let done = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = cursor;
      cursor += 1;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
      done += 1;
      onProgress?.(done, items.length);
    }
  });
  await Promise.all(workers);
  return out;
}
