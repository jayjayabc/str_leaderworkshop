'use client';

import { useEffect, useRef, useState } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { toast } from 'sonner';
import clsx from 'clsx';

import { exportCsv, exportJson, exportPng } from '@/lib/export';
import { teamNoOf, teamTitle } from '@/lib/teams';
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
import { ResetDialog } from './ResetDialog';
import { TimerWidget } from './TimerWidget';

/**
 * 폰 전용 상단바 (v1.1 B).
 * 제목(조 이름) · 단계 · 👥 · ⋯ 만 남기고, 나머지(타이머·호스트·내보내기)는 ⋯ 메뉴로 들어간다.
 * 발표 모드는 폰에서 제공하지 않는다.
 */
export function TopBarPhone() {
  const board = useBoard((s) => s.board);
  const slug = useBoard((s) => s.slug);
  const isHost = useBoard((s) => s.isHost);
  const me = useBoard((s) => s.me);
  const events = useBoard((s) => s.events);
  const presence = useBoard((s) => s.presence);
  const setFlags = useBoard((s) => s.setFlags);
  const setPhase = useBoard((s) => s.setPhase);
  const toggleLock = useBoard((s) => s.toggleLock);
  const undo = useBoard((s) => s.undo);

  const myVoted = useMyVotedIds();
  const [menuOpen, setMenuOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [tokenOpen, setTokenOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [menuOpen]);

  if (!board) return null;

  const teamNo = slug ? teamNoOf(slug) : null;
  const heading = teamNo ? teamTitle(teamNo) : board.title;
  const blocked = board.phase === 'review' || board.locked;
  const used = myVoted.size;
  const undoTarget = undoTargetOf(events);

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
    <header className="flex h-14 shrink-0 items-center gap-2 border-b border-eb-line bg-white px-3">
      <h1 className="shrink-0 text-[17px] font-bold" title={board.title}>
        {heading}
      </h1>

      <span
        className="shrink-0 rounded-full bg-[#EEF0F7] px-2 py-0.5 text-[12px] font-semibold text-[#3D4A7A]"
        aria-label={`단계 ${PHASE_LABEL[board.phase]}`}
      >
        {PHASE_LABEL[board.phase]}
      </span>

      {blocked ? (
        <span
          className="shrink-0 rounded-full bg-[#F8F0E6] px-1.5 py-0.5 text-[12px] font-semibold text-[#9A5B1E]"
          title={board.locked ? '보드가 잠겨 있습니다' : '발표 단계에서는 호스트만 수정할 수 있습니다'}
        >
          🔒
        </span>
      ) : null}

      {board.phase === 'voting' && me ? (
        <span
          className="shrink-0 text-[14px] font-semibold tracking-tight text-[#3D4A7A]"
          aria-label={`남은 스티커 ${Math.max(0, VOTES_PER_PERSON - used)}개`}
        >
          {'●'.repeat(used)}
          {'○'.repeat(Math.max(0, VOTES_PER_PERSON - used))}
        </span>
      ) : null}

      <div className="ml-auto flex shrink-0 items-center gap-1">
        <span className="text-[14px] tabular-nums text-eb-muted" aria-label={`온라인 ${presence.length}명`}>
          👥 {presence.length}
        </span>

        <div className="relative" ref={menuRef}>
          <button
            type="button"
            aria-label="더보기"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
            className="flex h-10 w-10 items-center justify-center rounded-lg border border-eb-line"
          >
            <MoreHorizontal className="h-5 w-5" aria-hidden />
          </button>

          {menuOpen ? (
            <div
              role="menu"
              className="eb-panel absolute right-0 top-[calc(100%+6px)] z-50 max-h-[70vh] w-[248px] overflow-y-auto p-1.5 shadow-xl"
            >
              <div className="px-2 pb-1.5 pt-1">
                <TimerWidget />
              </div>

              {isHost ? (
                <>
                  <div className="my-1 border-t border-eb-line" />
                  <p className="px-2 pb-1 pt-1 text-[11px] font-semibold text-eb-muted">단계</p>
                  <div className="flex gap-1 px-1 pb-1">
                    {PHASES.map((p) => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => {
                          void setPhase(p);
                          setMenuOpen(false);
                        }}
                        className={clsx(
                          'h-10 flex-1 rounded-lg border text-[13px]',
                          board.phase === p
                            ? 'border-[#3D4A7A] bg-[#EEF0F7] font-semibold text-[#3D4A7A]'
                            : 'border-eb-line',
                        )}
                      >
                        {PHASE_LABEL[p]}
                      </button>
                    ))}
                  </div>
                </>
              ) : null}

              <div className="my-1 border-t border-eb-line" />
              <p className="px-2 pb-1 pt-1 text-[11px] font-semibold text-eb-muted">내보내기</p>
              <PhoneMenuItem
                label="JSON (전체 상태)"
                onClick={() => {
                  const snap = snapshot();
                  if (snap) exportJson(snap);
                  setMenuOpen(false);
                }}
              />
              <PhoneMenuItem
                label="CSV (카드·칸·축·득표)"
                onClick={() => {
                  const snap = snapshot();
                  if (snap) exportCsv(snap);
                  setMenuOpen(false);
                }}
              />
              <PhoneMenuItem
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
                  <PhoneMenuItem
                    label="되돌리기"
                    disabled={!undoTarget}
                    onClick={() => {
                      void undo();
                      setMenuOpen(false);
                    }}
                  />
                  <PhoneMenuItem
                    label={board.show_axis ? '축 표시 끄기' : '축 표시 켜기'}
                    onClick={() => {
                      void setFlags({ show_axis: !board.show_axis });
                      setMenuOpen(false);
                    }}
                  />
                  <PhoneMenuItem
                    label={board.hide_vomit ? '🤮 칸 다시 보이기' : '🤮 칸 숨기기'}
                    onClick={() => {
                      void setFlags({ hide_vomit: !board.hide_vomit });
                      setMenuOpen(false);
                    }}
                  />
                  <PhoneMenuItem
                    label="호스트 토큰 복사"
                    onClick={() => {
                      const token = readHostToken(slug ?? '') ?? boardHostToken(board);
                      if (!token) {
                        toast.error('호스트 토큰을 찾을 수 없습니다');
                      } else {
                        void navigator.clipboard
                          .writeText(token)
                          .then(() => toast.success('호스트 토큰을 복사했습니다'))
                          .catch(() => toast.message(token));
                      }
                      setMenuOpen(false);
                    }}
                  />
                  <PhoneMenuItem
                    label={board.locked ? '보드 잠금 풀기' : '보드 잠그기'}
                    onClick={() => {
                      void toggleLock();
                      setMenuOpen(false);
                    }}
                  />
                  <PhoneMenuItem
                    label="전체 초기화"
                    danger
                    onClick={() => {
                      setMenuOpen(false);
                      setResetOpen(true);
                    }}
                  />
                </>
              ) : (
                <PhoneMenuItem
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

function PhoneMenuItem({
  label,
  onClick,
  danger = false,
  disabled = false,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className={clsx(
        'flex h-11 w-full items-center rounded-md px-2 text-left text-[14px] hover:bg-[#fafaf8] disabled:opacity-35',
        danger && 'text-[#9A5B1E]',
      )}
    >
      {label}
    </button>
  );
}
