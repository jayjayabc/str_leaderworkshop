'use client';

import { useState } from 'react';
import { X } from 'lucide-react';

import { useBoard } from '@/store/board';

/**
 * 폰 첫 사용 안내 (v1.1 폴리시).
 * 이 기기에서 카드를 한 번도 놓지 않았을 때만, 풀 서랍 핸들 바로 위에 뜬다.
 * 첫 배치가 끝나면(store의 hasPlaced) 저절로 사라지고, X로 바로 닫을 수도 있다.
 */
export function PhoneHint({ drawerOpen }: { drawerOpen: boolean }) {
  const hasPlaced = useBoard((s) => s.hasPlaced);
  const [dismissed, setDismissed] = useState(false);

  if (hasPlaced || dismissed) return null;

  return (
    <div
      className="pointer-events-none fixed inset-x-0 z-40 flex justify-center px-3"
      style={{
        // 서랍이 열려 있으면 서랍 높이만큼 더 띄워 핸들 위에 계속 붙어 있게 한다
        bottom: `calc(${drawerOpen ? '45vh + ' : ''}52px + env(safe-area-inset-bottom))`,
      }}
      role="status"
    >
      <p className="pointer-events-auto flex max-w-[360px] items-start gap-2 rounded-xl bg-[#3D4A7A] px-3 py-2.5 text-[13px] leading-5 text-white shadow-[0_4px_14px_rgba(16,24,40,0.22)]">
        <span className="flex-1">
          아래 &lsquo;키워드 풀&rsquo;을 열고 카드를 누르면 칸을 고를 수 있어요
          <span className="ml-1" aria-hidden>
            ↓
          </span>
        </span>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          aria-label="안내 닫기"
          className="-mr-1 -mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-white/80"
        >
          <X className="h-4 w-4" />
        </button>
      </p>
    </div>
  );
}
