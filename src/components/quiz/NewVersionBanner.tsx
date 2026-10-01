'use client';

import { useEffect, useState } from 'react';

const MY_BUILD = process.env.NEXT_PUBLIC_BUILD_ID ?? '';
const CHECK_MS = 60_000;

/** 새 배포가 나왔는지 1분마다 확인 — 예전 코드로 판정·운영하는 일을 막는다 */
export function useNewVersion(): boolean {
  const [stale, setStale] = useState(false);
  useEffect(() => {
    if (!MY_BUILD || MY_BUILD.startsWith('local-')) return;
    let cancelled = false;
    const check = () =>
      fetch('/api/version', { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : null))
        .then((d: { build?: string } | null) => {
          if (!cancelled && d?.build && d.build !== MY_BUILD) setStale(true);
        })
        .catch(() => undefined);
    void check();
    const t = setInterval(() => void check(), CHECK_MS);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);
  return stale;
}

/** 운영자·송출 화면용 — 새 버전이 있으면 상단에 새로고침 안내 */
export function NewVersionBanner() {
  const stale = useNewVersion();
  if (!stale) return null;
  return (
    <div className="sticky top-0 z-50 flex items-center gap-3 bg-[#C23A1E] px-4 py-2 text-[14px] font-bold text-white" role="alert">
      새 버전이 배포되었습니다. 이 화면은 예전 코드로 동작 중이에요.
      <button type="button" onClick={() => window.location.reload()} className="ml-auto rounded-md bg-white px-3 py-1 text-[#C23A1E]">
        새로고침
      </button>
    </div>
  );
}
