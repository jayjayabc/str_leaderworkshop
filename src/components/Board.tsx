'use client';

import clsx from 'clsx';

import { LEFT_COLUMN, RIGHT_COLUMN, ZONE_MAP } from '@/lib/design';
import { CAPTURE_ID } from '@/lib/export';
import { useBoard } from '@/store/board';
import { Zone } from './Zone';

/**
 * 좌측 열 = 부정 3칸(🐘·🐟·🤮), 우측 열 = 긍정 2칸(🐦·🌱) — §5 와이어.
 * 발표 모드에서 🤮가 숨겨지면 좌측 열은 2행이 된다.
 */
export function BoardGrid({
  present = false,
  stacked = false,
}: {
  present?: boolean;
  /** 폰 — 5칸을 세로로 쌓고 페이지가 스크롤된다 */
  stacked?: boolean;
}) {
  const hideVomit = useBoard((s) => s.board?.hide_vomit ?? false);
  const leftZones = present && hideVomit ? LEFT_COLUMN.filter((z) => z !== 'vomit') : LEFT_COLUMN;

  if (stacked) {
    return (
      // 빈 칸은 머리글 + 정의 한 줄 높이(112px)면 되고, 카드가 들어오면 늘어난다.
      // 5칸 머리글이 390×844 한 화면에 모두 들어와야 서랍 핸들이 가려지지 않는다.
      <div id={CAPTURE_ID} className="flex flex-col gap-2" style={{ background: '#F7F7F5' }}>
        {[...LEFT_COLUMN, ...RIGHT_COLUMN].map((z) => (
          <Zone key={z} meta={ZONE_MAP[z]} stacked className="min-h-[112px]" />
        ))}
      </div>
    );
  }

  return (
    <div
      id={CAPTURE_ID}
      className={clsx('grid h-full min-h-0 grid-cols-2', present ? 'gap-5' : 'gap-4')}
      style={{ background: '#F7F7F5' }}
    >
      <div
        className={clsx('grid min-h-0', present ? 'gap-5' : 'gap-4')}
        style={{ gridTemplateRows: `repeat(${leftZones.length}, minmax(0, 1fr))` }}
      >
        {leftZones.map((z) => (
          <Zone key={z} meta={ZONE_MAP[z]} present={present} />
        ))}
      </div>
      <div className={clsx('grid min-h-0 grid-rows-2', present ? 'gap-5' : 'gap-4')}>
        {RIGHT_COLUMN.map((z) => (
          <Zone key={z} meta={ZONE_MAP[z]} present={present} />
        ))}
      </div>
    </div>
  );
}
