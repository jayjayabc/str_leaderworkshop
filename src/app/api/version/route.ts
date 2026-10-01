// 지금 배포된 빌드 표식 — 열려 있는 화면이 자기 빌드와 비교해 새 버전이 나왔는지 안다.
export const dynamic = 'force-dynamic';

export function GET() {
  return Response.json(
    { build: process.env.NEXT_PUBLIC_BUILD_ID ?? '' },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
