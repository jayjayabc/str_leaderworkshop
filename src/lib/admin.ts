// 운영자 페이지 보조 — 키 게이트와 동시 실행 헬퍼 (v1.1 C).

const KEY_STORAGE = 'eb:operator-key';

/**
 * (Sec v1.0) 예전에는 NEXT_PUBLIC_OPERATOR_KEY 를 여기서 읽었는데, NEXT_PUBLIC_ 값은 공개 JS 에 글자 그대로 실린다.
 * 그 값이 실제 운영 키와 같아서 누구나 운영 키를 볼 수 있었다 → 더 이상 읽지 않는다(빈 값 고정).
 * 운영 키 확인은 Supabase 의 quiz_config.operator_key 로만 한다(퀴즈·토의보드 운영 화면).
 * 영향: 로컬 모드(환경변수 없는 개발)의 게이트가 꺼지고, 퇴역한 코끼리보드 /admin 게이트도 꺼진다
 *       (그 테이블은 sec_v1.0_migration.sql 로 잠가서 화면이 열려도 아무것도 읽거나 쓸 수 없다).
 */
export const OPERATOR_KEY: string = '';

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
