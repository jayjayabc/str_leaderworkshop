'use client';

import { X } from 'lucide-react';
import clsx from 'clsx';
import { toast } from 'sonner';

import { ZONES, placeEmoji, placeLabel } from '@/lib/design';
import {
  useBoard,
  useCanWrite,
  useMyVotedIds,
  useVoteCounts,
  VOTES_PER_PERSON,
} from '@/store/board';
import { useViewport } from '@/lib/viewport';
import type { PlaceKey } from '@/lib/types';

/**
 * 탭-투-플레이스 시트 (v1.1 B).
 * 폰에서는 카드를 누르면 바로 열리는 1순위 이동 경로이고,
 * 태블릿·데스크톱에서도 길게 누르기 / 상세의 "이동 →"으로 열 수 있다.
 * 이동은 드래그와 같은 store 액션(movePlacement)을 쓴다.
 */
export function CardActionSheet() {
  const actionCard = useBoard((s) => s.actionCard);
  const setActionCard = useBoard((s) => s.setActionCard);
  const setOpenCard = useBoard((s) => s.setOpenCard);
  const keywords = useBoard((s) => s.keywords);
  const placements = useBoard((s) => s.placements);
  const movePlacement = useBoard((s) => s.movePlacement);
  const toggleVote = useBoard((s) => s.toggleVote);
  const phase = useBoard((s) => s.board?.phase ?? 'placing');
  const hideVomit = useBoard((s) => s.board?.hide_vomit ?? false);
  const canWrite = useCanWrite();
  const voteCounts = useVoteCounts();
  const myVoted = useMyVotedIds();
  const viewport = useViewport();

  const keyword = keywords.find((k) => k.id === actionCard) ?? null;
  if (!keyword) return null;

  const current = placements.find((p) => p.keyword_id === keyword.id)?.zone ?? 'pool';
  const voted = myVoted.has(keyword.id);
  const votes = voteCounts.get(keyword.id) ?? 0;

  function move(zone: PlaceKey) {
    if (!keyword) return;
    if (!canWrite) {
      toast.message('지금은 카드를 옮길 수 없습니다');
      return;
    }
    if (zone !== current) void movePlacement(keyword.id, zone, Number.MAX_SAFE_INTEGER);
    setActionCard(null);
  }

  const zones = hideVomit ? ZONES.filter((z) => z.key !== 'vomit') : ZONES;

  return (
    <div
      className={clsx(
        'fixed inset-0 z-[55] flex bg-black/25',
        viewport === 'phone' ? 'items-end' : 'items-center justify-center px-6',
      )}
      onClick={() => setActionCard(null)}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`카드 ${keyword.text} 이동`}
        onClick={(e) => e.stopPropagation()}
        className={clsx(
          'flex max-h-[88vh] w-full flex-col overflow-hidden bg-white shadow-xl',
          viewport === 'phone'
            ? 'rounded-t-2xl'
            : 'max-w-[420px] rounded-2xl border border-eb-line',
        )}
        style={
          viewport === 'phone'
            ? { paddingBottom: 'env(safe-area-inset-bottom)' }
            : undefined
        }
      >
        <div className="flex shrink-0 items-start gap-2 border-b border-eb-line px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-[16px] font-bold">{keyword.text}</p>
            <p className="mt-0.5 text-[12px] text-eb-muted">
              지금 {placeEmoji(current)} {placeLabel(current)}
              {votes > 0 ? ` · ●${votes}` : ''}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setActionCard(null)}
            aria-label="닫기"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-eb-muted"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="eb-scroll min-h-0 flex-1 overflow-y-auto p-3">
          <p className="mb-2 px-1 text-[12px] font-semibold text-eb-muted">어디에 놓을까요?</p>
          <ul className="space-y-1.5">
            {zones.map((z) => {
              const active = current === z.key;
              return (
                <li key={z.key}>
                  <button
                    type="button"
                    onClick={() => move(z.key)}
                    aria-current={active}
                    className={clsx(
                      'flex w-full items-start gap-3 rounded-xl border px-3 py-3 text-left transition',
                      active ? 'border-transparent' : 'border-eb-line hover:bg-[#fafaf8]',
                    )}
                    style={active ? { background: z.tint } : undefined}
                  >
                    <span className="mt-px text-[22px] leading-6" aria-hidden>
                      {z.emoji}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span
                        className="block text-[15px] font-bold"
                        style={{ color: z.label }}
                      >
                        {z.name}
                        {active ? (
                          <span className="ml-1.5 text-[11px] font-semibold text-eb-muted">
                            현재 위치
                          </span>
                        ) : null}
                      </span>
                      <span className="mt-0.5 block text-[12px] leading-4 text-eb-muted">
                        {z.definition}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>

          <div className="mt-3 space-y-1.5 border-t border-eb-line pt-3">
            <button
              type="button"
              onClick={() => move('pool')}
              disabled={current === 'pool'}
              className="flex h-11 w-full items-center justify-center rounded-xl border border-eb-line text-[14px] font-medium disabled:opacity-40"
            >
              📥 풀로 되돌리기
            </button>

            {phase === 'voting' ? (
              <button
                type="button"
                disabled={!canWrite || (!voted && myVoted.size >= VOTES_PER_PERSON)}
                onClick={() => {
                  void toggleVote(keyword.id);
                  setActionCard(null);
                }}
                className={clsx(
                  'flex h-11 w-full items-center justify-center rounded-xl text-[14px] font-semibold disabled:opacity-40',
                  voted ? 'bg-[#EEF0F7] text-[#3D4A7A]' : 'bg-[#3D4A7A] text-white',
                )}
              >
                {voted
                  ? '● 스티커 떼기'
                  : `● 스티커 붙이기 (${myVoted.size}/${VOTES_PER_PERSON})`}
              </button>
            ) : null}

            <button
              type="button"
              onClick={() => {
                setActionCard(null);
                setOpenCard(keyword.id);
              }}
              className="flex h-11 w-full items-center justify-center rounded-xl border border-eb-line text-[14px] font-medium"
            >
              상세 보기
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
