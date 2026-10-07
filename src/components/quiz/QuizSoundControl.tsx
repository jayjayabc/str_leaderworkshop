'use client';

// 중앙 효과음 제어 (Quiz v2.2) — 송출 화면·운영자 화면이 함께 쓴다. 둘 중 한 곳에서만 켠다.
//   맨 처음 대기 = lobby 음악 · 문제 시작 = open · 진행 중 = thinking(째깍) · 마감 = timeup · 공개 = reveal

import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';

import { playCue, setLoop, stopAllSound, unlockSound } from '@/lib/quizSound';
import type { QuizState } from '@/lib/quizTypes';

export function useQuizSound(state: QuizState | null, leftMs: number | null) {
  const [on, setOn] = useState(false);
  const prev = useRef<{ status: string; index: number } | null>(null);
  const timeupFor = useRef<string>('');

  const anyOpened = Boolean(state?.settings.opened && Object.keys(state.settings.opened).length > 0);
  const running = state?.status === 'open' && leftMs !== null && leftMs > 0;
  const wantLoop = !on || !state ? null : state.status === 'lobby' && !anyOpened ? 'lobby' : running ? 'thinking' : null;

  // 반복 음원: 처음 대기 화면 → lobby, 문제 진행 중 → thinking(문제 시작 효과음 뒤에 들어옴)
  useEffect(() => {
    setLoop(wantLoop, wantLoop === 'thinking' ? { delay: 1.5, fadeIn: 1.0 } : { fadeIn: 1.5 });
  }, [wantLoop]);

  // 한 번 울리는 효과음: 문제 시작 · 마감 · 정답 공개
  useEffect(() => {
    if (!state) return;
    const p = prev.current;
    prev.current = { status: state.status, index: state.current_index };
    if (!on || !p) return;
    const changed = state.status !== p.status || state.current_index !== p.index;
    const key = `${state.current_index}:${state.opened_at ?? ''}`;
    if (changed && state.status === 'open') playCue('open');
    // 마감: 운영자가 마감을 눌렀거나(open → closed) 시간이 다 됨(남은 0초) — 문제당 한 번
    const closedNow = changed && state.status === 'closed' && p.status === 'open';
    const ranOut = state.status === 'open' && leftMs === 0;
    if ((closedNow || ranOut) && timeupFor.current !== key) {
      timeupFor.current = key;
      playCue('timeup');
    }
    if (changed && state.status === 'revealed') playCue('reveal');
  }, [state, leftMs, on]);

  useEffect(() => () => stopAllSound(), []);

  const toggle = () => {
    if (on) {
      stopAllSound();
      setOn(false);
      return;
    }
    if (unlockSound()) setOn(true);
  };
  return { on, toggle };
}

export function SoundToggle({ on, onToggle, className }: { on: boolean; onToggle: () => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={clsx(
        'rounded-full px-2.5 py-1 text-[12px] font-bold transition-opacity',
        on ? 'bg-white/10 text-white/40 opacity-40 hover:opacity-100' : 'bg-[#FFE300] text-[#1E1E1E]',
        className,
      )}
      data-testid="sound-toggle"
      title="효과음은 송출 화면이나 운영자 화면 중 스피커에 연결된 한 곳에서만 켜 주세요"
    >
      {on ? '🔊 효과음 켜짐' : '🔇 효과음 켜기'}
    </button>
  );
}
