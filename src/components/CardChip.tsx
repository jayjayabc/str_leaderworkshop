'use client';

import { useEffect, useRef } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { motion } from 'framer-motion';
import clsx from 'clsx';

import { toast } from 'sonner';

import { AXIS_MAP, clipText, placeLabel } from '@/lib/design';
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

interface Props {
  keyword: Keyword;
  zone: PlaceKey;
  compact?: boolean;
  /** 발표 모드 — 프로젝터에서 읽히도록 글자를 키운다 (§8) */
  present?: boolean;
}

export function CardChip({ keyword, zone, compact = false, present = false }: Props) {
  const canWrite = useCanWrite();
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
  const toggleVote = useBoard((s) => s.toggleVote);
  const movePlacement = useBoard((s) => s.movePlacement);
  const highlight = useBoard((s) => s.highlight);
  const highlightTop = useBoard((s) => s.highlightTop);

  const voteCounts = useVoteCounts();
  const myVoted = useMyVotedIds();
  const topRanks = useTopRanks();

  const boxRef = useRef<HTMLDivElement | null>(null);
  const isHighlighted = highlight === keyword.id;

  useEffect(() => {
    if (isHighlighted) boxRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [isHighlighted]);

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
      setOpenCard(keyword.id);
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

  const ring = isHighlighted
    ? '0 0 0 3px #F0B429'
    : rank
      ? '0 0 0 3px rgba(61,74,122,0.35)'
      : remoteDragger
        ? `0 0 0 2px ${remoteDragger.participant.color}`
        : undefined;

  return (
    <motion.div
      layout
      layoutId={`card-${keyword.id}`}
      transition={{ type: 'spring', duration: 0.15, bounce: 0.2 }}
    >
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
        title={keyword.text}
        tabIndex={0}
        aria-label={`카드 ${keyword.text}, ${placeLabel(zone)}`}
        onKeyDown={onKeyDown}
        onClick={() => setOpenCard(keyword.id)}
        className={clsx(
          'eb-card flex touch-none items-center',
          canWrite ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer',
          present ? 'gap-2.5 px-4 py-3' : 'gap-1.5',
          present ? '' : compact ? 'px-2.5 py-1.5' : 'px-3 py-2',
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
            present ? 'text-[22px] leading-7' : compact ? 'text-[12px]' : 'text-[13px]',
          )}
        >
          {present ? keyword.text : clipText(keyword.text)}
        </span>

        {!keyword.is_seed && keyword.created_by_name && !present ? (
          <span className="shrink-0 rounded bg-[#f1f1ee] px-1 py-px text-[10px] text-eb-muted">
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
              'ml-auto shrink-0 rounded-full border text-[11px] leading-none',
              'flex h-4 w-4 items-center justify-center',
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
    </motion.div>
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
