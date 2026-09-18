'use client';

import { useEffect, useRef } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import clsx from 'clsx';

import { toast } from 'sonner';

import { AXIS_MAP, clipText, placeLabel } from '@/lib/design';
import { useViewport } from '@/lib/viewport';
import {
  useBoard,
  useCanWrite,
  useMyVotedIds,
  useTopRanks,
  useVoteCounts,
} from '@/store/board';
import type { Keyword, PlaceKey } from '@/lib/types';

/** 숫자키 → 칸 (§5 좌측 위부터: 코끼리·죽은물고기·토하기, 그다음 파랑새·새싹) */
const KEY_TO_PLACE: Record<string, PlaceKey | undefined> = {
  '1': 'elephant',
  '2': 'deadfish',
  '3': 'vomit',
  '4': 'bluebird',
  '5': 'sprout',
  '0': 'pool',
};

/** 길게 누르기 → 액션 시트 (태블릿·데스크톱) */
const LONG_PRESS_MS = 500;

interface Props {
  keyword: Keyword;
  zone: PlaceKey;
  compact?: boolean;
  /** 발표 모드 — 프로젝터에서 읽히도록 글자를 키운다 (§8) */
  present?: boolean;
}

export function CardChip({ keyword, zone, compact = false, present = false }: Props) {
  const canWrite = useCanWrite();
  const viewport = useViewport();
  const isPhone = viewport === 'phone' && !present;

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: keyword.id,
    data: { zone },
    disabled: !canWrite,
  });

  const placement = useBoard((s) => s.placements.find((p) => p.keyword_id === keyword.id));
  const showAxis = useBoard((s) => s.board?.show_axis ?? false);
  const phase = useBoard((s) => s.board?.phase ?? 'placing');
  const presence = useBoard((s) => s.presence);
  const me = useBoard((s) => s.me);
  const setOpenCard = useBoard((s) => s.setOpenCard);
  const setActionCard = useBoard((s) => s.setActionCard);
  const toggleVote = useBoard((s) => s.toggleVote);
  const movePlacement = useBoard((s) => s.movePlacement);
  const highlight = useBoard((s) => s.highlight);
  const highlightTop = useBoard((s) => s.highlightTop);

  const voteCounts = useVoteCounts();
  const myVoted = useMyVotedIds();
  const topRanks = useTopRanks();

  const boxRef = useRef<HTMLDivElement | null>(null);
  const longPress = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressClick = useRef(false);
  const isHighlighted = highlight === keyword.id;

  useEffect(() => {
    if (isHighlighted) boxRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [isHighlighted]);

  useEffect(() => () => {
    if (longPress.current) clearTimeout(longPress.current);
  }, []);

  const placer = placement?.placed_by
    ? presence.find((p) => p.participant.id === placement.placed_by)
    : undefined;
  const placerColor =
    placer?.participant.color ??
    (placement?.placed_by && me && placement.placed_by === me.id ? me.color : undefined);

  const remoteDragger = presence.find(
    (p) => p.dragging === keyword.id && p.participant.id !== me?.id,
  );

  const axis = keyword.axis ? AXIS_MAP[keyword.axis] : null;
  const votes = voteCounts.get(keyword.id) ?? 0;
  const voted = myVoted.has(keyword.id);
  const rank = present && highlightTop ? topRanks.get(keyword.id) : undefined;
  const votingOpen = phase === 'voting' && canWrite && Boolean(me);

  // 키보드 접근 — 카드에 포커스한 뒤 1~5로 칸 이동, 0으로 풀 (§10 Should)
  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      // 키보드 사용자에게도 이동 시트를 준다
      setActionCard(keyword.id);
      return;
    }
    const target = KEY_TO_PLACE[e.key];
    if (!target) return;
    e.preventDefault();
    if (!canWrite) {
      toast.message('지금은 카드를 옮길 수 없습니다');
      return;
    }
    if (target === zone) return;
    void movePlacement(keyword.id, target, Number.MAX_SAFE_INTEGER);
  }

  function cancelLongPress() {
    if (longPress.current) {
      clearTimeout(longPress.current);
      longPress.current = null;
    }
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    // dnd-kit 센서가 먼저 봐야 한다
    (listeners?.onPointerDown as ((ev: React.PointerEvent<HTMLDivElement>) => void) | undefined)?.(e);
    if (isPhone || present) return; // 폰은 탭 자체가 시트를 연다
    suppressClick.current = false;
    cancelLongPress();
    longPress.current = setTimeout(() => {
      suppressClick.current = true;
      setActionCard(keyword.id);
    }, LONG_PRESS_MS);
  }

  function onActivate() {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    // 폰에서는 탭이 이동 시트를 연다(1순위 경로). 그 외에는 상세 팝오버.
    if (isPhone) setActionCard(keyword.id);
    else setOpenCard(keyword.id);
  }

  const ring = isHighlighted
    ? '0 0 0 3px #F0B429'
    : rank
      ? '0 0 0 3px rgba(61,74,122,0.35)'
      : remoteDragger
        ? `0 0 0 2px ${remoteDragger.participant.color}`
        : undefined;

  return (
    <div>
      <div
        ref={(el) => {
          setNodeRef(el);
          boxRef.current = el;
        }}
        style={{
          transform: CSS.Translate.toString(transform),
          transition,
          opacity: isDragging ? 0.35 : 1,
          boxShadow: ring,
        }}
        {...attributes}
        {...listeners}
        onPointerDown={onPointerDown}
        onPointerUp={cancelLongPress}
        onPointerMove={cancelLongPress}
        onPointerCancel={cancelLongPress}
        onPointerLeave={cancelLongPress}
        title={keyword.text}
        tabIndex={0}
        aria-label={`카드 ${keyword.text}, ${placeLabel(zone)}`}
        onKeyDown={onKeyDown}
        onClick={onActivate}
        className={clsx(
          'eb-card flex touch-none items-center',
          canWrite ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer',
          present
            ? 'gap-2.5 px-4 py-3'
            : isPhone
              ? 'min-h-[40px] gap-1.5 px-3 py-2'
              : clsx('gap-1.5', compact ? 'px-2.5 py-1.5' : 'px-3 py-2'),
          remoteDragger && 'eb-wiggle',
        )}
      >
        {rank ? (
          <span
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#3D4A7A] text-[13px] font-bold tabular-nums text-white"
            aria-label={`득표 ${rank}위`}
          >
            {rank}
          </span>
        ) : null}

        {placerColor && !rank ? (
          <span
            className={clsx('shrink-0 rounded-full', present ? 'h-2.5 w-2.5' : 'h-1.5 w-1.5')}
            style={{ background: placerColor }}
            aria-hidden
          />
        ) : null}

        <span
          className={clsx(
            'truncate font-medium',
            present
              ? 'text-[22px] leading-7'
              : isPhone
                ? 'text-[14px]'
                : compact
                  ? 'text-[12px]'
                  : 'text-[13px]',
          )}
        >
          {present ? keyword.text : clipText(keyword.text)}
        </span>

        {!keyword.is_seed && keyword.created_by_name && !present ? (
          <span
            className={clsx(
              'shrink-0 rounded bg-[#f1f1ee] px-1 py-px text-eb-muted',
              isPhone ? 'text-[11px]' : 'text-[10px]',
            )}
          >
            {keyword.created_by_name}
          </span>
        ) : null}

        {votes > 0 ? (
          <span
            className={clsx(
              'shrink-0 rounded-full bg-[#EEF0F7] font-semibold tabular-nums text-[#3D4A7A]',
              present ? 'px-2.5 py-0.5 text-[18px]' : 'px-1.5 py-px text-[11px]',
            )}
            aria-label={`득표 ${votes}`}
          >
            ●{votes}
          </span>
        ) : null}

        {votingOpen && !present ? (
          <button
            type="button"
            aria-label={voted ? `${keyword.text} 스티커 떼기` : `${keyword.text}에 스티커 붙이기`}
            title={voted ? '스티커 떼기' : '스티커 붙이기'}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              void toggleVote(keyword.id);
            }}
            className={clsx(
              'ml-auto flex shrink-0 items-center justify-center rounded-full border leading-none',
              // 폰에서는 손가락으로 누를 수 있도록 히트 영역을 36px로 (v1.1 B)
              isPhone ? 'h-9 w-9 text-[15px]' : 'h-4 w-4 text-[11px]',
              voted ? 'border-[#3D4A7A] bg-[#3D4A7A] text-white' : 'border-[#c9cbd3] text-[#c9cbd3]',
            )}
          >
            ●
          </button>
        ) : null}

        {showAxis && axis ? (
          <span
            className={clsx(
              'shrink-0 rounded-full',
              votingOpen && !present ? '' : 'ml-auto',
              present ? 'h-3 w-3' : 'h-2 w-2',
            )}
            style={{ background: axis.color }}
            title={`축 ${axis.key} · ${axis.name}`}
            aria-hidden
          />
        ) : null}
      </div>
    </div>
  );
}

/** 드래그 오버레이용 정적 칩 */
export function CardChipGhost({ keyword }: { keyword: Keyword }) {
  return (
    <div className="eb-card flex items-center gap-1.5 px-3 py-2 shadow-lg">
      <span className="text-[13px] font-medium">{clipText(keyword.text)}</span>
    </div>
  );
}
