'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  closestCorners,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';

import { BoardGrid } from './Board';
import { BoardSkeleton } from './BoardSkeleton';
import { CardChipGhost } from './CardChip';
import { CardPopover } from './CardPopover';
import { JoinModal } from './JoinModal';
import { Panel } from './Panel';
import { PanelSheet } from './PanelSheet';
import { Pool } from './Pool';
import { PoolDrawer } from './PoolDrawer';
import { PresentBar } from './PresentBar';
import { TopBar } from './TopBar';
import { isWriteBlocked, useBoard } from '@/store/board';
import { useViewport } from '@/lib/viewport';
import type { PlaceKey } from '@/lib/types';

const PLACE_KEYS: PlaceKey[] = ['pool', 'elephant', 'deadfish', 'vomit', 'bluebird', 'sprout'];

function isPlaceKey(v: unknown): v is PlaceKey {
  return typeof v === 'string' && (PLACE_KEYS as string[]).includes(v);
}

export function BoardScreen({ slug }: { slug: string }) {
  const init = useBoard((s) => s.init);
  const dispose = useBoard((s) => s.dispose);
  const loading = useBoard((s) => s.loading);
  const missing = useBoard((s) => s.missing);
  const mode = useBoard((s) => s.mode);
  const keywords = useBoard((s) => s.keywords);
  const placements = useBoard((s) => s.placements);
  const movePlacement = useBoard((s) => s.movePlacement);
  const setDragging = useBoard((s) => s.setDragging);
  const board = useBoard((s) => s.board);
  const isHost = useBoard((s) => s.isHost);
  const present = useBoard((s) => s.present);
  const setPresent = useBoard((s) => s.setPresent);
  const undo = useBoard((s) => s.undo);

  const viewport = useViewport();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);

  const viewOnly = viewport === 'phone';
  const blocked = viewOnly || isWriteBlocked(board, isHost);

  useEffect(() => {
    void init(slug);
    return () => dispose();
  }, [slug, init, dispose]);

  // Esc = 발표 모드 종료 · Ctrl/Cmd+Z = 호스트 되돌리기
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && useBoard.getState().present) {
        setPresent(false);
        return;
      }
      const typing =
        e.target instanceof HTMLElement &&
        ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName);
      if (!typing && (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        if (!useBoard.getState().isHost) return;
        e.preventDefault();
        void undo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setPresent, undo]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 120, tolerance: 6 } }),
  );

  function onDragStart(e: DragStartEvent) {
    const id = String(e.active.id);
    setActiveId(id);
    setDragging(id);
  }

  async function onDragEnd(e: DragEndEvent) {
    setActiveId(null);
    setDragging(null);
    if (blocked) return;
    const { active, over } = e;
    if (!over) return;

    const keywordId = String(active.id);
    const overId = String(over.id);

    let targetZone: PlaceKey | null = null;
    let index = Number.MAX_SAFE_INTEGER;

    if (overId.startsWith('zone:')) {
      const z = overId.slice(5);
      if (isPlaceKey(z)) targetZone = z;
    } else {
      const overPlacement = placements.find((p) => p.keyword_id === overId);
      if (overPlacement) {
        targetZone = overPlacement.zone;
        const inZone = placements
          .filter((p) => p.zone === overPlacement.zone)
          .sort((a, b) => a.sort_order - b.sort_order);
        index = inZone.findIndex((p) => p.keyword_id === overId);
      }
    }

    if (!targetZone) return;
    const current = placements.find((p) => p.keyword_id === keywordId);
    if (current && current.zone === targetZone && index === Number.MAX_SAFE_INTEGER) return;

    await movePlacement(keywordId, targetZone, index);
  }

  // 로딩이 먼저 — "보드를 찾을 수 없습니다"가 잠깐 스쳐 보이지 않게 한다
  if (loading) return <BoardSkeleton />;

  if (missing) {
    return (
      <main className="flex min-h-screen items-center justify-center px-6">
        <div className="max-w-[440px] text-center">
          <p className="text-[28px]" aria-hidden>
            🐘
          </p>
          <h1 className="mt-2 text-[20px] font-bold">보드를 찾을 수 없습니다</h1>
          <p className="mt-3 text-[13px] leading-6 text-eb-muted">
            {mode === 'local' ? (
              <>
                지금은 <strong>로컬 모드</strong>라 보드가 이 브라우저에만 저장되어 있어, 보드를 만든
                그 브라우저에서만 열 수 있습니다. 다른 기기·다른 사람과 링크를 공유하려면 Supabase
                환경변수 두 개를 설정해 실시간 모드로 실행해야 합니다.
              </>
            ) : (
              <>주소의 링크가 잘못되었거나 보드가 삭제되었습니다. 링크를 다시 확인해 주세요.</>
            )}
          </p>
          <div className="mt-5 flex items-center justify-center gap-2">
            <Link
              href="/"
              className="rounded-lg bg-[#3D4A7A] px-4 py-2 text-[13px] font-semibold text-white"
            >
              새 보드 만들기
            </Link>
            {mode === 'local' ? (
              <a
                href="https://github.com/#readme-2-env"
                onClick={(e) => {
                  e.preventDefault();
                  window.alert(
                    'README.md의 "2. 환경변수 설정" 항목을 참고하세요.\n프로젝트 루트의 README.md에 3단계(스키마 → env → 배포)가 정리되어 있습니다.',
                  );
                }}
                className="rounded-lg border border-eb-line px-4 py-2 text-[13px]"
              >
                설정 방법 보기
              </a>
            ) : null}
          </div>
        </div>
      </main>
    );
  }

  const activeKeyword = activeId ? keywords.find((k) => k.id === activeId) ?? null : null;

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      {present ? <PresentBar /> : <TopBar />}

      {viewOnly && !present ? (
        <p
          className="shrink-0 bg-[#F8F0E6] px-4 py-2 text-center text-[12px] font-medium text-[#9A5B1E]"
          role="status"
        >
          휴대폰에서는 보기 전용입니다
        </p>
      ) : null}

      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={onDragStart}
        onDragEnd={(e) => void onDragEnd(e)}
        onDragCancel={() => {
          setActiveId(null);
          setDragging(null);
        }}
      >
        {present ? (
          // 발표 모드 — 풀·패널 없이 보드만 화면을 채운다 (16:9 기준, 스크롤 없음)
          <main className="min-h-0 flex-1 overflow-hidden p-5" aria-label="보드 (발표 모드)">
            <BoardGrid present />
          </main>
        ) : viewOnly ? (
          // 폰 — 5칸을 세로로 쌓고 세로 스크롤
          <main className="eb-scroll min-h-0 flex-1 overflow-y-auto p-3" aria-label="보드">
            <BoardGrid stacked />
          </main>
        ) : viewport === 'tablet' ? (
          // 태블릿 — 보드 전체 폭, 풀은 하단 서랍, 패널은 우측 시트
          <main className="min-h-0 flex-1 p-3 pb-12" aria-label="보드">
            <BoardGrid />
          </main>
        ) : (
          <main className="grid min-h-0 flex-1 grid-cols-[240px_1fr_300px] gap-4 p-4">
            <Pool />
            <section className="min-h-0" aria-label="보드">
              <BoardGrid />
            </section>
            <Panel />
          </main>
        )}

        {viewport === 'tablet' && !present ? (
          <PoolDrawer open={drawerOpen} onToggle={() => setDrawerOpen((v) => !v)} />
        ) : null}

        <DragOverlay dropAnimation={{ duration: 150, easing: 'cubic-bezier(0.2, 0.8, 0.3, 1)' }}>
          {activeKeyword ? <CardChipGhost keyword={activeKeyword} /> : null}
        </DragOverlay>
      </DndContext>

      {viewport === 'tablet' && !present ? (
        <PanelSheet
          open={sheetOpen}
          onOpen={() => setSheetOpen(true)}
          onClose={() => setSheetOpen(false)}
        />
      ) : null}

      {present ? null : (
        <>
          <JoinModal />
          <CardPopover />
        </>
      )}
    </div>
  );
}
