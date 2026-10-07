import type { Metadata, Viewport } from 'next';

export const metadata: Metadata = {
  title: '토의보드',
  description: '리더워크샵 리더 토론세션 토의보드',
};

// 안드로이드에서 키보드가 올라오면 화면을 줄여 제출 버튼이 키보드 밑에 숨지 않게
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  interactiveWidget: 'resizes-content',
};

export default function BoardLayout({ children }: { children: React.ReactNode }) {
  return children;
}
