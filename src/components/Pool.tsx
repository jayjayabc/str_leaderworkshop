'use client';

import { useMemo, useState } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, rectSortingStrategy, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { Plus, Search } from 'lucide-react';
import clsx from 'clsx';

import { AXES } from '@/lib/design';
import { useBoard, useCanWrite, useZoneKeywords } from '@/store/board';
import { CardChip } from './CardChip';
import type { AxisKey } from '@/lib/types';

export function Pool({ variant = 'column' }: { variant?: 'column' | 'drawer' }) {
  const all = useZoneKeywords('pool');
  const isHost = useBoard((s) => s.isHost);
  const addKeyword = useBoard((s) => s.addKeyword);
  const duplicateOf = useBoard((s) => s.duplicateOf);
  const canWrite = useCanWrite();

  const [query, setQuery] = useState('');
  const [axisFilter, setAxisFilter] = useState<AxisKey | 'all'>('all');
  const [draft, setDraft] = useState('');
  const [adding, setAdding] = useState(false);

  const { setNodeRef, isOver } = useDroppable({ id: 'zone:pool', data: { zone: 'pool' } });

  const keywords = useMemo(() => {
    const q = query.trim().toLowerCase();
    return all.filter((k) => {
      if (q && !k.text.toLowerCase().includes(q)) return false;
      if (axisFilter !== 'all' && k.axis !== axisFilter) return false;
      return true;
    });
  }, [all, query, axisFilter]);

  const dup = draft.trim() ? duplicateOf(draft) : null;

  async function submit() {
    const text = draft.trim();
    if (!text) return;
    await addKeyword(text);
    setDraft('');
    setAdding(false);
  }

  return (
    <aside
      ref={setNodeRef}
      aria-label="키워드 풀"
      className={clsx(
        'flex h-full min-h-0 flex-col transition-shadow',
        variant === 'drawer' ? 'bg-white' : 'eb-panel p-3',
        isOver && 'ring-2 ring-[#9aa4b8] ring-offset-2',
      )}
    >
      <div className="mb-2 flex shrink-0 items-center justify-between">
        <h2 className="text-[13px] font-bold">키워드 풀</h2>
        <span className="text-[12px] tabular-nums text-eb-muted">{all.length}장</span>
      </div>

      <div className="relative mb-2 shrink-0">
        <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-eb-muted" aria-hidden />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="검색"
          aria-label="키워드 검색"
          className="w-full rounded-lg border border-eb-line py-1.5 pl-7 pr-2 text-[12px] outline-none focus:border-[#9aa4b8]"
        />
      </div>

      {isHost ? (
        <select
          value={axisFilter}
          onChange={(e) => setAxisFilter(e.target.value as AxisKey | 'all')}
          aria-label="축 필터"
          className="mb-2 w-full shrink-0 rounded-lg border border-eb-line px-2 py-1.5 text-[12px] outline-none"
        >
          <option value="all">전체 축</option>
          {AXES.map((a) => (
            <option key={a.key} value={a.key}>
              {a.key} · {a.name}
            </option>
          ))}
        </select>
      ) : null}

      <SortableContext
        items={keywords.map((k) => k.id)}
        strategy={variant === 'drawer' ? rectSortingStrategy : verticalListSortingStrategy}
      >
        <div
          className={clsx(
            'eb-scroll min-h-[80px] flex-1 overflow-y-auto pb-2',
            variant === 'drawer'
              ? 'flex flex-wrap content-start gap-2'
              : 'flex flex-col gap-1.5',
          )}
        >
          {keywords.length === 0 ? (
            <p className="text-[12px] text-eb-muted">해당하는 카드가 없습니다.</p>
          ) : (
            keywords.map((k) => <CardChip key={k.id} keyword={k} zone="pool" compact />)
          )}
        </div>
      </SortableContext>

      <div className="mt-2 shrink-0 border-t border-eb-line pt-2">
        {adding ? (
          <div>
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void submit();
                if (e.key === 'Escape') {
                  setDraft('');
                  setAdding(false);
                }
              }}
              placeholder="새 키워드 (12자 권장)"
              aria-label="새 키워드 문구"
              className="w-full rounded-lg border border-eb-line px-2 py-1.5 text-[12px] outline-none focus:border-[#9aa4b8]"
            />
            {dup ? (
              <p className="mt-1 text-[11px] text-[#9A5B1E]">
                이미 &apos;{dup.text}&apos; 카드가 있습니다. 그래도 만들 수 있습니다.
              </p>
            ) : null}
            <div className="mt-1.5 flex gap-1.5">
              <button
                type="button"
                onClick={() => void submit()}
                disabled={!draft.trim()}
                className="flex-1 rounded-lg bg-[#3D4A7A] py-1.5 text-[12px] font-semibold text-white disabled:opacity-40"
              >
                추가
              </button>
              <button
                type="button"
                onClick={() => {
                  setDraft('');
                  setAdding(false);
                }}
                className="rounded-lg border border-eb-line px-3 py-1.5 text-[12px]"
              >
                취소
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            disabled={!canWrite}
            title={canWrite ? undefined : '지금은 보드가 잠겨 있습니다'}
            onClick={() => setAdding(true)}
            className="flex w-full items-center justify-center gap-1 rounded-lg border border-dashed border-eb-line py-2 text-[12px] font-medium text-eb-muted hover:bg-[#fafaf8] disabled:opacity-40 disabled:hover:bg-transparent"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden /> 빈 카드
          </button>
        )}
      </div>
    </aside>
  );
}
