'use client';

// 반응형 분기 (BRIEF §5)
//   desktop (>1180px)  : 풀 + 보드 + 패널 3단
//   tablet  (≤1180px)  : 풀은 하단 서랍, 패널은 우측 시트 (가로 1024 태블릿 기준)
//   phone   (≤768px)   : 보기 전용

import { useSyncExternalStore } from 'react';

export type Viewport = 'desktop' | 'tablet' | 'phone';

export const TABLET_MAX = 1180;
export const PHONE_MAX = 768;

function subscribe(onChange: () => void): () => void {
  window.addEventListener('resize', onChange);
  window.addEventListener('orientationchange', onChange);
  return () => {
    window.removeEventListener('resize', onChange);
    window.removeEventListener('orientationchange', onChange);
  };
}

function getWidth(): number {
  return window.innerWidth;
}

/** 서버 렌더에서는 데스크톱 폭으로 가정한다(하이드레이션 불일치 방지) */
function getServerWidth(): number {
  return 1920;
}

export function useViewport(): Viewport {
  const width = useSyncExternalStore(subscribe, getWidth, getServerWidth);
  if (width <= PHONE_MAX) return 'phone';
  if (width <= TABLET_MAX) return 'tablet';
  return 'desktop';
}
