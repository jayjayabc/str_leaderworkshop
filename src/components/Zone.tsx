'use client';

import { useDroppable } from '@dnd-kit/core';
import { SortableContext, rectSortingStrategy } from '@dnd-kit/sortable';
import clsx from 'clsx';

import { CardChip } from './CardChip';
import { useBoard, useZoneKeywords } from '@/store/board';
import type { ZoneMeta } from '@/lib/design';

interface Props {
  meta: ZoneMeta;
  className?: string;
  /** 발표 모드 — 칸 제목 28px, 카드 22px (§8 프로젝터 기준) */
  present?: boolean;
}

export function Zone({ meta, className, present = false }: Props) {
  const keywords = useZoneKeywords(meta.key);
  const hideVomit = useBoard((s) => s.board?.hide_vomit ?? false);
  const hidden = hideVomit && meta.key === 'vomit';
  const { setNodeRef, isOver } = useDroppable({ id: `zone:${meta.key}`, data: { zone: meta.key } });

  // 발표 모드에서 숨겨진 🤮 칸은 아예 렌더하지 않는다(좌측 열이 2행이 된다).
  if (hidden && present) return null;

  if (hidden) {
    return (
      <section
        className={clsx(
          'flex items-center justify-center rounded-xl border border-dashed border-eb-line text-[12px] text-eb-muted',
          className,
        )}
        aria-label="토하기 칸 (숨김)"
      >
        🤮 칸은 숨김 상태입니다 ({keywords.length}장)
      </section>
    );
  }

  return (
    <section
      ref={setNodeRef}
      aria-label={`${meta.name} 칸 — ${meta.definition}`}
      className={clsx(
        'flex min-h-0 flex-col rounded-xl transition-shadow',
        present ? 'p-5' : 'p-3',
        isOver && 'ring-2 ring-offset-2',
        className,
      )}
      style={{
        background: meta.tint,
        // ring 색은 칸 라벨색을 따른다
        ...(isOver ? ({ ['--tw-ring-color']: meta.label } as React.CSSProperties) : {}),
      }}
    >
      <header className={clsx('flex shrink-0 items-center', present ? 'mb-3 gap-3' : 'mb-2 gap-2')}>
        <span className={present ? 'text-[32px]' : 'text-[18px]'} aria-hidden>
          {meta.emoji}
        </span>
        <h2
          className={clsx('font-bold', present ? 'text-[28px] leading-8' : 'text-[14px]')}
          style={{ color: meta.label }}
        >
          {meta.name}
        </h2>
        <span
          className={clsx(
            'ml-auto rounded-full bg-white/70 font-semibold tabular-nums',
            present ? 'px-3 py-1 text-[20px]' : 'px-2 py-0.5 text-[12px]',
          )}
          style={{ color: meta.label }}
        >
          {keywords.length}
        </span>
      </header>

      <SortableContext items={keywords.map((k) => k.id)} strategy={rectSortingStrategy}>
        <div
          className={clsx(
            'eb-scroll flex min-h-0 flex-1 flex-wrap content-start overflow-y-auto',
            present ? 'gap-3' : 'min-h-[64px] gap-2',
          )}
        >
          {keywords.length === 0 ? (
            <p
              className={clsx(
                'max-w-[92%] select-none leading-5 opacity-45',
                present ? 'text-[18px] leading-7' : 'text-[12px]',
              )}
              style={{ color: meta.label }}
            >
              {meta.definition}
            </p>
          ) : (
            keywords.map((k) => (
              <CardChip key={k.id} keyword={k} zone={meta.key} present={present} />
            ))
          )}
        </div>
      </SortableContext>
    </section>
  );
}
