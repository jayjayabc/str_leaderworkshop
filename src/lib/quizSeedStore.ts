// 운영자 화면용 정답 시드 보관소 (Quiz v1.3)
// 정답 키는 클라이언트 번들에 넣지 않는다. 운영자 키 확인 후 /api/quiz/keys 에서 받아 여기에 넣는다.

import { QUIZ_QUESTIONS } from './quizQuestions';
import type { QuizAnswerKey, QuizQuestion } from './quizSeed';

let seed: QuizQuestion[] = [];

export function setQuizKeys(keys: QuizAnswerKey[]): void {
  seed = QUIZ_QUESTIONS.map((q) => {
    const key = keys.find((k) => k.id === q.id);
    if (!key) throw new Error(`정답 키 없음: ${q.id}`);
    return { ...q, ...key };
  });
}

export function getSeed(): QuizQuestion[] {
  return seed;
}

/** 운영자 키로 서버에서 정답 키를 받아 보관소에 넣는다 */
export async function loadQuizKeys(operatorKey: string): Promise<void> {
  const res = await fetch('/api/quiz/keys', {
    method: 'POST',
    headers: { 'x-operator-key': operatorKey },
    cache: 'no-store',
  });
  if (res.status === 401) throw new Error('QUIZ_FORBIDDEN');
  if (!res.ok) throw new Error('QUIZ_NETWORK');
  setQuizKeys((await res.json()) as QuizAnswerKey[]);
}
