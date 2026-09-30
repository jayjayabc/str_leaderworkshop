import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: '스피드 퀴즈',
  description: '리더워크샵 스피드 퀴즈',
};

export default function QuizLayout({ children }: { children: React.ReactNode }) {
  return children;
}
