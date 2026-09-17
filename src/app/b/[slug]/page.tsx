import { BoardScreen } from '@/components/BoardScreen';

export default async function BoardPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <BoardScreen slug={slug} />;
}
