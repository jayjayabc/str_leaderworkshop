'use client';

import { useMemo, useState } from 'react';
import { X } from 'lucide-react';

import clsx from 'clsx';

import { AXIS_MAP, placeEmoji, placeLabel, ZONE_MAP } from '@/lib/design';
import { useViewport } from '@/lib/viewport';
import {
  useBoard,
  useCanWrite,
  useMyVotedIds,
  useVoteCounts,
  VOTES_PER_PERSON,
} from '@/store/board';
import type { AxisKey, PlaceKey, ZoneKey } from '@/lib/types';

function isZoneKey(key: PlaceKey): key is ZoneKey {
  return key !== 'pool';
}

function fmt(iso: string): string {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(
    d.getMinutes(),
  ).padStart(2, '0')}`;
}

export function CardPopover() {
  const openCard = useBoard((s) => s.openCard);
  const setOpenCard = useBoard((s) => s.setOpenCard);
  const setActionCard = useBoard((s) => s.setActionCard);
  const keywords = useBoard((s) => s.keywords);
  const placements = useBoard((s) => s.placements);
  const notes = useBoard((s) => s.notes);
  const events = useBoard((s) => s.events);
  const isHost = useBoard((s) => s.isHost);
  const addNote = useBoard((s) => s.addNote);
  const removeKeyword = useBoard((s) => s.removeKeyword);
  const toggleVote = useBoard((s) => s.toggleVote);
  const me = useBoard((s) => s.me);
  const phase = useBoard((s) => s.board?.phase ?? 'placing');
  const canWrite = useCanWrite();
  const voteCounts = useVoteCounts();
  const myVoted = useMyVotedIds();
  const [draft, setDraft] = useState('');
  const viewport = useViewport();
  const isPhone = viewport === 'phone';

  const keyword = keywords.find((k) => k.id === openCard) ?? null;
  const placement = placements.find((p) => p.keyword_id === openCard);

  const cardNotes = useMemo(
    () => notes.filter((n) => n.keyword_id === openCard).sort((a, b) => a.created_at.localeCompare(b.created_at)),
    [notes, openCard],
  );

  const history = useMemo(
    () =>
      events
        .filter((e) => e.type === 'placement.move' && e.payload.keyword_id === openCard)
        .slice(-20)
        .reverse(),
    [events, openCard],
  );

  if (!keyword) return null;

  const zone = placement?.zone ?? 'pool';
  const zoneMeta = isZoneKey(zone) ? ZONE_MAP[zone] : null;
  const votes = voteCounts.get(keyword.id) ?? 0;
  const voted = myVoted.has(keyword.id);

  function axisLine(key: AxisKey | null, label: string) {
    if (!key) return null;
    const a = AXIS_MAP[key];
    return (
      <div className="flex items-center gap-1.5 text-[12px]">
        <span className="h-2 w-2 rounded-full" style={{ background: a.color }} aria-hidden />
        <span className="text-eb-muted">{label}</span>
        <span className="font-medium">
          {a.key} · {a.name}
        </span>
      </div>
    );
  }

  return (
    <div
      className={clsx(
        'fixed inset-0 z-40 flex bg-black/15',
        isPhone ? 'items-end' : 'items-center justify-center px-6',
      )}
      onClick={() => setOpenCard(null)}
    >
      <div
        className={clsx(
          'w-full overflow-y-auto bg-white shadow-xl',
          isPhone
            ? 'max-h-[85vh] rounded-t-2xl p-4'
            : 'eb-panel max-h-[80vh] max-w-[420px] p-5',
        )}
        style={isPhone ? { paddingBottom: 'calc(16px + env(safe-area-inset-bottom))' } : undefined}
        role="dialog"
        aria-modal="true"
        aria-label={`카드 ${keyword.text}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <h3 className="text-[17px] font-bold leading-6">{keyword.text}</h3>
            <p className="mt-0.5 text-[12px] text-eb-muted">
              {placeEmoji(zone)} {placeLabel(zone)}
              {keyword.source ? ` · 출처 ${keyword.source}` : ''}
              {keyword.is_seed ? '' : ` · ${keyword.created_by_name ?? '참가자'} 작성`}
            </p>
          </div>
          <button type="button" onClick={() => setOpenCard(null)} aria-label="닫기" className="p-1 text-eb-muted">
            <X className="h-4 w-4" />
          </button>
        </div>

        {zoneMeta ? (
          <div className="mt-3 rounded-lg p-3 text-[12px] leading-5" style={{ background: zoneMeta.tint, color: zoneMeta.label }}>
            <strong className="font-semibold">
              {zoneMeta.emoji} {zoneMeta.name}
            </strong>{' '}
            — {zoneMeta.definition}
          </div>
        ) : null}

        {/* 이동 → — 드래그 없이 칸을 고르는 경로 (v1.1 B: 모든 화면에서) */}
        <button
          type="button"
          onClick={() => {
            setOpenCard(null);
            setActionCard(keyword.id);
          }}
          className="mt-3 flex h-11 w-full items-center justify-between rounded-lg border border-eb-line px-3 text-[13px] font-medium hover:bg-[#fafaf8]"
        >
          <span>다른 칸으로 이동</span>
          <span aria-hidden>→</span>
        </button>

        {/* 점 스티커 — 투표 단계에서만 (§6.3) */}
        {phase === 'voting' ? (
          <div className="mt-3 flex items-center gap-2 rounded-lg border border-eb-line p-2.5">
            <span className="text-[12px] font-semibold">점 스티커</span>
            <span className="text-[12px] tabular-nums text-eb-muted">
              이 카드 {votes}표 · 내 스티커 {myVoted.size}/{VOTES_PER_PERSON}
            </span>
            <button
              type="button"
              disabled={!canWrite || !me || (!voted && myVoted.size >= VOTES_PER_PERSON)}
              onClick={() => void toggleVote(keyword.id)}
              className={clsx(
                'ml-auto rounded-lg px-2.5 py-1 text-[12px] font-semibold disabled:opacity-40',
                voted ? 'bg-[#EEF0F7] text-[#3D4A7A]' : 'bg-[#3D4A7A] text-white',
              )}
            >
              {voted ? '스티커 떼기' : '+1'}
            </button>
          </div>
        ) : null}

        {isHost ? (
          <div className="mt-4 space-y-1 border-t border-eb-line pt-3">
            <p className="mb-1 text-[12px] font-semibold">축 (호스트만 보임)</p>
            {axisLine(keyword.axis, '주')}
            {axisLine(keyword.axis2, '부차')}
            {!keyword.axis && !keyword.axis2 ? <p className="text-[12px] text-eb-muted">축 없음</p> : null}
            <p className="pt-1 text-[12px] text-eb-muted">
              예상 칸: {keyword.expected ? `${placeEmoji(keyword.expected)} ${placeLabel(keyword.expected)}` : '—'}
              {keyword.expected2 ? ` · 부차 ${placeLabel(keyword.expected2)}` : ''}
            </p>
          </div>
        ) : null}

        <div className="mt-4 border-t border-eb-line pt-3">
          <p className="mb-2 text-[12px] font-semibold">근거 메모 ({cardNotes.length})</p>
          <ul className="eb-selectable space-y-1.5">
            {cardNotes.length === 0 ? (
              <li className="text-[12px] text-eb-muted">아직 메모가 없습니다.</li>
            ) : (
              cardNotes.map((n) => (
                <li key={n.id} className="rounded-lg bg-[#fafaf8] px-2.5 py-1.5 text-[12px]">
                  <span>{n.text}</span>
                  <span className="ml-1.5 text-[11px] text-eb-muted">
                    — {n.author_name ?? '익명'} {fmt(n.created_at)}
                  </span>
                </li>
              ))
            )}
          </ul>
          <div className="mt-2 flex gap-1.5">
            <input
              value={draft}
              disabled={!canWrite}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && draft.trim()) {
                  void addNote(keyword.id, draft);
                  setDraft('');
                }
              }}
              placeholder={canWrite ? '한 줄 근거 메모' : '보드가 잠겨 있습니다'}
              aria-label="메모 입력"
              className="flex-1 rounded-lg border border-eb-line px-2 py-1.5 text-[12px] outline-none focus:border-[#9aa4b8] disabled:bg-[#fafaf8]"
            />
            <button
              type="button"
              disabled={!draft.trim() || !canWrite}
              onClick={() => {
                void addNote(keyword.id, draft);
                setDraft('');
              }}
              className="rounded-lg bg-[#3D4A7A] px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-40"
            >
              추가
            </button>
          </div>
        </div>

        <div className="mt-4 border-t border-eb-line pt-3">
          <p className="mb-2 text-[12px] font-semibold">이동 이력 ({history.length})</p>
          <ul className="eb-selectable space-y-1">
            {history.length === 0 ? (
              <li className="text-[12px] text-eb-muted">아직 이동 이력이 없습니다.</li>
            ) : (
              history.map((e) => (
                <li key={e.id} className="text-[12px] text-eb-muted">
                  {fmt(e.created_at)} · {e.actor_name ?? '누군가'}님 {placeLabel(e.payload.from as PlaceKey)} →{' '}
                  <span className="font-medium text-eb-ink">{placeLabel(e.payload.to as PlaceKey)}</span>
                </li>
              ))
            )}
          </ul>
        </div>

        {isHost && !keyword.is_seed ? (
          <button
            type="button"
            onClick={() => void removeKeyword(keyword.id)}
            className="mt-4 w-full rounded-lg border border-eb-line py-2 text-[12px] text-[#9A5B1E]"
          >
            카드 삭제
          </button>
        ) : null}
      </div>
    </div>
  );
}
