'use client';

import { useState } from 'react';
import { toast } from 'sonner';

import { useBoard } from '@/store/board';

/**
 * 호스트 토큰 입력 — 보드를 만든 브라우저 외의 기기에서도 호스트가 되기 위한 통로.
 * 토큰은 보드를 만든 브라우저의 localStorage에만 있으므로, 호스트가 ⋯ 메뉴에서 복사해 전달한다.
 */
export function HostTokenDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const claimHost = useBoard((s) => s.claimHost);
  const [value, setValue] = useState('');

  if (!open) return null;

  function submit() {
    if (!value.trim()) return;
    if (claimHost(value)) {
      toast.success('이제 이 기기가 호스트입니다');
      onClose();
    } else {
      toast.error('토큰이 올바르지 않습니다');
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/25 px-6">
      <div
        className="eb-panel w-full max-w-[400px] p-6 shadow-xl"
        role="dialog"
        aria-modal="true"
        aria-label="호스트 토큰 입력"
      >
        <h2 className="text-[17px] font-bold">호스트 토큰 입력</h2>
        <p className="mt-2 text-[13px] leading-5 text-eb-muted">
          호스트 권한은 보드를 만든 브라우저에만 저장됩니다. 다른 기기에서 진행하려면 그 브라우저의
          ⋯ 메뉴에서 <strong>호스트 토큰 복사</strong>를 눌러 받은 값을 여기에 붙여넣으세요.
        </p>
        <input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
          }}
          aria-label="호스트 토큰"
          placeholder="예) 3f2a1c8e-…"
          className="mt-4 w-full rounded-lg border border-eb-line px-3 py-2 text-[13px] outline-none focus:border-[#9aa4b8]"
        />
        <div className="mt-5 flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-lg border border-eb-line py-2 text-[13px]"
          >
            취소
          </button>
          <button
            type="button"
            disabled={!value.trim()}
            onClick={submit}
            className="flex-1 rounded-lg bg-[#3D4A7A] py-2 text-[13px] font-semibold text-white disabled:opacity-40"
          >
            호스트 되기
          </button>
        </div>
      </div>
    </div>
  );
}
