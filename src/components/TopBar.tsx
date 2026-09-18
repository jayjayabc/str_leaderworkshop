'use client';

import { useEffect, useRef, useState } from 'react';
import { Link2, MoreHorizontal, Undo2 } from 'lucide-react';
import { toast } from 'sonner';
import clsx from 'clsx';

import { MODE_BADGE } from '@/lib/db';
import { exportCsv, exportJson, exportPng } from '@/lib/export';
import { useViewport } from '@/lib/viewport';
import {
  boardHostToken,
  PHASES,
  PHASE_LABEL,
  readHostToken,
  useBoard,
  useMyVotedIds,
  undoTargetOf,
  VOTES_PER_PERSON,
} from '@/store/board';
import { HostTokenDialog } from './HostTokenDialog';
import { PresenceList } from './PresenceList';
import { TopBarPhone } from './TopBarPhone';
import { ResetDialog } from './ResetDialog';
import { TimerWidget } from './TimerWidget';

export function TopBar() {
  const board = useBoard((s) => s.board);
  const mode = useBoard((s) => s.mode);
  const isHost = useBoard((s) => s.isHost);
  const me = useBoard((s) => s.me);
  const events = useBoard((s) => s.events);
  const setFlags = useBoard((s) => s.setFlags);
  const setPhase = useBoard((s) => s.setPhase);
  const toggleLock = useBoard((s) => s.toggleLock);
  const undo = useBoard((s) => s.undo);
  const setPresent = useBoard((s) => s.setPresent);

  const myVoted = useMyVotedIds();
  const viewport = useViewport();
  const compact = viewport !== 'desktop';
  const [menuOpen, setMenuOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [tokenOpen, setTokenOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [menuOpen]);

  // 폰은 전용 상단바를 쓴다 (v1.1 B)
  if (viewport === 'phone') return <TopBarPhone />;
  if (!board) return null;
  const badge = MODE_BADGE[mode];
  const undoTarget = undoTargetOf(events);
  const blocked = board.phase === 'review' || board.locked;
  const used = myVoted.size;

  async function share() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      toast.success('링크를 복사했습니다');
    } catch {
      toast.message(window.location.href);
    }
  }

  /** 다른 기기에서도 호스트가 될 수 있도록 토큰을 복사한다 */
  async function copyHostToken() {
    const token = readHostToken(useBoard.getState().slug ?? '') ?? boardHostToken(board);
    if (!token) {
      toast.error('호스트 토큰을 찾을 수 없습니다');
      return;
    }
    try {
      await navigator.clipboard.writeText(token);
      toast.success('호스트 토큰을 복사했습니다 — 다른 기기의 ⋯ 메뉴에 붙여넣으세요');
    } catch {
      toast.message(token);
    }
  }

  function snapshot() {
    const s = useBoard.getState();
    if (!s.board) return null;
    return {
      board: s.board,
      keywords: s.keywords,
      placements: s.placements,
      notes: s.notes,
      votes: s.votes,
      events: s.events,
    };
  }

  return (
    <header
      className={clsx(
        'flex h-14 shrink-0 items-center gap-3 border-b border-eb-line bg-white',
        compact ? 'px-3' : 'px-6',
      )}
    >
      <h1
        className={clsx(
          'truncate text-[15px] font-bold',
          compact ? 'max-w-[150px]' : 'max-w-[260px]',
        )}
        title={board.title}
      >
        {board.title}
      </h1>

      {/* 단계 — 호스트만 전환 가능 (§6.4) */}
      <div
        className="flex shrink-0 items-center gap-0.5 rounded-lg border border-eb-line p-0.5"
        role="group"
        aria-label="단계"
      >
        {PHASES.map((p) => {
          const active = board.phase === p;
          return (
            <button
              key={p}
              type="button"
              disabled={!isHost}
              aria-pressed={active}
              onClick={() => void setPhase(p)}
              title={isHost ? `${PHASE_LABEL[p]} 단계로` : '호스트만 단계를 바꿀 수 있습니다'}
              className={clsx(
                'whitespace-nowrap rounded-md px-2 py-1 text-[12px] transition',
                active ? 'bg-[#EEF0F7] font-semibold text-[#3D4A7A]' : 'text-eb-muted',
                isHost && !active && 'hover:bg-[#fafaf8]',
                !isHost && 'cursor-default',
              )}
            >
              {active ? '●' : '○'}
              {PHASE_LABEL[p]}
            </button>
          );
        })}
      </div>

      {board.phase === 'voting' && me ? (
        <span className="shrink-0 text-[12px] text-eb-muted" aria-label="남은 스티커">
          내 스티커{' '}
          <span className="font-semibold tracking-widest text-[#3D4A7A]">
            {'●'.repeat(used)}
            {'○'.repeat(Math.max(0, VOTES_PER_PERSON - used))}
          </span>
        </span>
      ) : null}

      {blocked ? (
        <span
          className="shrink-0 rounded-full bg-[#F8F0E6] px-2 py-0.5 text-[11px] font-semibold text-[#9A5B1E]"
          title={board.locked ? '보드가 잠겨 있습니다' : '발표 단계에서는 호스트만 수정할 수 있습니다'}
        >
          🔒 잠김
        </span>
      ) : null}

      <span
          title={badge.title}
          className={clsx(
            'shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px]',
            mode === 'supabase' ? 'bg-[#EAF5EA] text-[#2F7A3E]' : 'bg-[#F8F0E6] text-[#9A5B1E]',
          )}
        >
          {compact ? badge.short : badge.label}
      </span>

      <div className="ml-auto flex shrink-0 items-center gap-2">
        <PresenceList />
        <TimerWidget />

        {isHost ? (
          <>
            <button
              type="button"
              onClick={() => void undo()}
              disabled={!undoTarget}
              aria-label="되돌리기"
              title="되돌리기 (Ctrl/Cmd+Z)"
              className="flex items-center gap-1 rounded-lg border border-eb-line px-2 py-1.5 text-[12px] disabled:opacity-35"
            >
              <Undo2 className="h-3.5 w-3.5" aria-hidden />
              {compact ? null : '되돌리기'}
            </button>
            {/* 태블릿에서는 자리 때문에 축·🤮 토글을 ⋯ 메뉴로 옮긴다 */}
            {compact ? null : (
              <>
                <button
                  type="button"
                  onClick={() => void setFlags({ show_axis: !board.show_axis })}
                  className={clsx(
                    'whitespace-nowrap rounded-lg border px-2 py-1.5 text-[12px]',
                    board.show_axis
                      ? 'border-[#3D4A7A] bg-[#EEF0F7] text-[#3D4A7A]'
                      : 'border-eb-line',
                  )}
                >
                  축 표시
                </button>
                <button
                  type="button"
                  onClick={() => void setFlags({ hide_vomit: !board.hide_vomit })}
                  className={clsx(
                    'whitespace-nowrap rounded-lg border px-2 py-1.5 text-[12px]',
                    board.hide_vomit
                      ? 'border-[#9A5B1E] bg-[#F8F0E6] text-[#9A5B1E]'
                      : 'border-eb-line',
                  )}
                >
                  🤮 숨김
                </button>
              </>
            )}
          </>
        ) : null}

        <button
          type="button"
          onClick={() => setPresent(true)}
          className="whitespace-nowrap rounded-lg border border-eb-line px-2 py-1.5 text-[12px] font-medium"
        >
          발표 모드
        </button>

        <button
          type="button"
          onClick={() => void share()}
          aria-label="공유"
          className="flex items-center gap-1 whitespace-nowrap rounded-lg border border-eb-line px-2 py-1.5 text-[12px]"
        >
          <Link2 className="h-3.5 w-3.5" aria-hidden />
          {compact ? null : '공유'}
        </button>

        <div className="relative" ref={menuRef}>
          <button
            type="button"
            aria-label="더보기"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
            className="flex items-center rounded-lg border border-eb-line px-2 py-1.5"
          >
            <MoreHorizontal className="h-4 w-4" aria-hidden />
          </button>

          {menuOpen ? (
            <div
              role="menu"
              className="eb-panel absolute right-0 top-[calc(100%+6px)] z-50 w-[220px] p-1.5 shadow-xl"
            >
              <p className="px-2 pb-1 pt-1 text-[11px] font-semibold text-eb-muted">내보내기</p>
              <MenuItem
                label="JSON (전체 상태)"
                onClick={() => {
                  const snap = snapshot();
                  if (snap) exportJson(snap);
                  setMenuOpen(false);
                }}
              />
              <MenuItem
                label="CSV (카드·칸·축·득표)"
                onClick={() => {
                  const snap = snapshot();
                  if (snap) exportCsv(snap);
                  setMenuOpen(false);
                }}
              />
              <MenuItem
                label="PNG (보드 스냅샷)"
                onClick={() => {
                  setMenuOpen(false);
                  void exportPng(board.slug).catch(() => toast.error('PNG 내보내기에 실패했습니다'));
                }}
              />

              <div className="my-1 border-t border-eb-line" />
              <p className="px-2 pb-1 pt-1 text-[11px] font-semibold text-eb-muted">호스트</p>
              {isHost ? (
                <>
                  {compact ? (
                    <>
                      <MenuItem
                        label={board.show_axis ? '축 표시 끄기' : '축 표시 켜기'}
                        onClick={() => {
                          void setFlags({ show_axis: !board.show_axis });
                          setMenuOpen(false);
                        }}
                      />
                      <MenuItem
                        label={board.hide_vomit ? '🤮 칸 다시 보이기' : '🤮 칸 숨기기'}
                        onClick={() => {
                          void setFlags({ hide_vomit: !board.hide_vomit });
                          setMenuOpen(false);
                        }}
                      />
                    </>
                  ) : null}
                  <MenuItem
                    label="호스트 토큰 복사"
                    onClick={() => {
                      void copyHostToken();
                      setMenuOpen(false);
                    }}
                  />
                  <MenuItem
                    label={board.locked ? '보드 잠금 풀기' : '보드 잠그기'}
                    onClick={() => {
                      void toggleLock();
                      setMenuOpen(false);
                    }}
                  />
                  <MenuItem
                    label="전체 초기화"
                    danger
                    onClick={() => {
                      setMenuOpen(false);
                      setResetOpen(true);
                    }}
                  />
                </>
              ) : (
                <MenuItem
                  label="호스트 토큰 입력"
                  onClick={() => {
                    setMenuOpen(false);
                    setTokenOpen(true);
                  }}
                />
              )}
            </div>
          ) : null}
        </div>
      </div>

      <ResetDialog
        key={resetOpen ? 'reset-open' : 'reset-closed'}
        open={resetOpen}
        onClose={() => setResetOpen(false)}
      />
      <HostTokenDialog
        key={tokenOpen ? 'token-open' : 'token-closed'}
        open={tokenOpen}
        onClose={() => setTokenOpen(false)}
      />
    </header>
  );
}

function MenuItem({
  label,
  onClick,
  danger = false,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={clsx(
        'w-full rounded-md px-2 py-1.5 text-left text-[12px] hover:bg-[#fafaf8]',
        danger && 'text-[#9A5B1E]',
      )}
    >
      {label}
    </button>
  );
}
