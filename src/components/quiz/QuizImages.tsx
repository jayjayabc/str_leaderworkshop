'use client';

// 문제 이미지 (Quiz v2.1) — 휴대폰: 탭하면 전체 화면으로 크게(두 번째 탭은 2배 확대), 여러 장이면 넘겨 보기.

import { useEffect, useState } from 'react';
import clsx from 'clsx';

export function PhoneImages({ images, captions }: { images: string[]; captions?: string[] }) {
  const [viewer, setViewer] = useState<number | null>(null);
  if (!images.length) return null;
  const many = images.length > 1;
  return (
    <>
      <div className={clsx('border-t border-black/5 bg-[#F4F3EE]', many && 'grid grid-cols-2 gap-1 p-1')}>
        {images.map((src, i) => (
          <button
            key={src}
            type="button"
            onClick={() => setViewer(i)}
            className="relative block w-full"
            aria-label={`문제 이미지 ${i + 1} 크게 보기`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={src}
              alt={`문제 이미지 ${i + 1}`}
              onError={(e) => (e.currentTarget.style.display = 'none')}
              className={clsx('block w-full bg-white object-contain', many && 'h-[180px]')}
            />
            {captions?.[i] ? (
              <span className="absolute inset-x-0 bottom-0 bg-black/60 px-1.5 py-0.5 text-left text-[11px] font-semibold text-white">{captions[i]}</span>
            ) : null}
            <span className="absolute right-1.5 top-1.5 rounded-full bg-black/55 px-2 py-0.5 text-[11px] font-bold text-white">🔍 크게</span>
          </button>
        ))}
      </div>
      {viewer !== null ? <Viewer images={images} captions={captions} start={viewer} onClose={() => setViewer(null)} /> : null}
    </>
  );
}

function Viewer({ images, captions, start, onClose }: { images: string[]; captions?: string[]; start: number; onClose: () => void }) {
  const [i, setI] = useState(start);
  const [zoom, setZoom] = useState(false);
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);
  const go = (d: number) => {
    setZoom(false);
    setI((x) => (x + d + images.length) % images.length);
  };
  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-black" role="dialog" aria-modal aria-label="문제 이미지">
      <div className="flex items-center gap-2 px-3 py-2 text-white">
        <span className="text-[13px] font-bold tabular-nums">
          {i + 1} / {images.length}
        </span>
        {captions?.[i] ? <span className="truncate text-[13px] text-white/70">{captions[i]}</span> : null}
        <button type="button" onClick={onClose} className="ml-auto rounded-full bg-white/15 px-3 py-1.5 text-[14px] font-bold">
          닫기 ✕
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto" style={{ touchAction: 'pan-x pan-y pinch-zoom' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={images[i]}
          alt={`문제 이미지 ${i + 1}`}
          onClick={() => setZoom((z) => !z)}
          className={clsx('mx-auto block', zoom ? 'w-[200%] max-w-none' : 'max-h-full w-full object-contain')}
        />
      </div>
      <div className="flex items-center gap-2 px-3 py-2 text-white">
        {images.length > 1 ? (
          <button type="button" onClick={() => go(-1)} className="rounded-full bg-white/15 px-4 py-2 text-[15px] font-bold">
            ◀ 이전
          </button>
        ) : null}
        <span className="flex-1 text-center text-[12px] text-white/60">{zoom ? '한 번 더 누르면 원래 크기' : '이미지를 누르면 2배로 확대'}</span>
        {images.length > 1 ? (
          <button type="button" onClick={() => go(1)} className="rounded-full bg-white/15 px-4 py-2 text-[15px] font-bold">
            다음 ▶
          </button>
        ) : null}
      </div>
    </div>
  );
}
