'use client';

// 브라우저에만 있는 값(localStorage·location)을 렌더 중 안전하게 읽기 위한 헬퍼.
// useSyncExternalStore로 읽으면 서버 렌더는 서버 스냅샷을 쓰고 클라이언트에서 한 번 다시 렌더된다.
// (useEffect + setState 조합은 계단식 렌더를 만들어 lint 규칙에 걸린다.)

import { useSyncExternalStore } from 'react';

/** 값이 바뀌지 않는 스냅샷용 — 구독할 것이 없다 */
export function noopSubscribe(): () => void {
  return () => {};
}

/**
 * 스냅샷은 매번 같은 참조를 돌려줘야 하므로, 처음 읽은 값을 모듈에 캐시해 쓴다.
 * `reset()`으로 캐시를 비울 수 있다.
 */
export function cachedSnapshot<T>(read: () => T): { get: () => T; reset: () => void } {
  let cached: { value: T } | null = null;
  return {
    get: () => {
      if (!cached) cached = { value: read() };
      return cached.value;
    },
    reset: () => {
      cached = null;
    },
  };
}

export function useClientValue<T>(getSnapshot: () => T, serverValue: T): T {
  return useSyncExternalStore(noopSubscribe, getSnapshot, () => serverValue);
}
