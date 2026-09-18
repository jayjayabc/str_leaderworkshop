import type { Metadata, Viewport } from 'next';
import { Toaster } from 'sonner';

import './globals.css';

export const metadata: Metadata = {
  title: '코끼리 보드',
  description: '리더워크샵 실시간 키워드 매핑 보드',
};

// 폰에서 노치·홈 인디케이터 영역까지 쓰고(env(safe-area-inset-*)) 확대 축소는 허용한다
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <head>
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css"
        />
      </head>
      <body className="bg-eb-bg text-eb-ink antialiased">
        {children}
        <Toaster position="bottom-center" richColors closeButton toastOptions={{ duration: 3200 }} />
      </body>
    </html>
  );
}
