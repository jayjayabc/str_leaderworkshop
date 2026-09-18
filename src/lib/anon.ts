'use client';

// 자동 별칭 (v1.1.1)
//   이름 입력은 선택 사항이다. 비우고 들어오면 `익명-XXX`가 붙는다.
//   XXX는 [A-Z2-9] 3글자이고, 기기마다 하나를 만들어 localStorage에 재사용한다
//   (같은 사람이 여러 조를 오가도 같은 별칭으로 보이도록).
//
// 배경: 회사 브라우저(Menlo Security 원격 격리)에서 키보드 입력이 막히는 경우가 있어
//       탭만으로 입장이 끝나야 한다.

const ANON_KEY = 'eb:anon-tag';
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ23456789';

function randomTag(): string {
  let tag = '';
  for (let i = 0; i < 3; i += 1) {
    tag += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return tag;
}

/** 이 기기의 고정 별칭 꼬리표 (없으면 만들어 저장한다) */
export function anonTag(): string {
  if (typeof window === 'undefined') return randomTag();
  try {
    const cached = window.localStorage.getItem(ANON_KEY);
    if (cached && /^[A-Z2-9]{3}$/.test(cached)) return cached;
  } catch {
    return randomTag();
  }
  const tag = randomTag();
  try {
    window.localStorage.setItem(ANON_KEY, tag);
  } catch {
    /* noop */
  }
  return tag;
}

export function anonNickname(): string {
  return `익명-${anonTag()}`;
}

/** 입력이 비어 있으면 자동 별칭으로 바꾼다 */
export function resolveNickname(input: string): string {
  return input.trim() || anonNickname();
}
