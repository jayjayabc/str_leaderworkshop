// 문제 문장 렌더러 — **…** 를 강조로 바꾸고, 한국어가 단어 중간에서 끊기지 않게 한다.

import clsx from 'clsx';

export function RichText({ text, className, mark = 'screen' }: { text: string; className?: string; mark?: 'screen' | 'phone' | 'admin' }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <span className={clsx('qz-text', className)}>
      {parts.map((p, i) =>
        p.startsWith('**') && p.endsWith('**') ? (
          <mark
            key={i}
            className={clsx(
              'rounded-[0.2em] px-[0.15em] font-black',
              mark === 'screen' && 'bg-[#FFE300] text-[#0E0F13]',
              mark === 'phone' && 'bg-[#FFE300] text-[#1E1E1E]',
              mark === 'admin' && 'bg-[#FFE300] text-[#1E1E1E]',
            )}
          >
            {p.slice(2, -2)}
          </mark>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </span>
  );
}

/** 강조 표시를 뺀 문장 (길이 계산·키워드용) */
export function plainText(text: string): string {
  return text.replace(/\*\*([^*]+)\*\*/g, '$1');
}
