'use client';

import { toast } from 'sonner';

import { teamNumbers, teamSlug } from '@/lib/teams';
import { PHASE_LABEL } from '@/store/board';
import { fmtTime, teamAgg, type TeamEntry } from '@/lib/aggregate';
import { AdminSection } from './AdminScreen';

/** 1. 보드 준비 — 조 보드 만들기/확인 + 현황 표 (v1.1 C-1) */
export function AdminBoards({
  entries,
  origin,
  firstLoad,
  busy,
  onEnsure,
  onTakeHost,
  onLinksCsv,
}: {
  entries: TeamEntry[];
  origin: string;
  firstLoad: boolean;
  busy: boolean;
  onEnsure: () => void;
  onTakeHost: () => void;
  onLinksCsv: () => void;
}) {
  const byNo = new Map(entries.map((e) => [e.teamNo, e]));
  const rows = teamNumbers();

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      toast.success('링크를 복사했습니다');
    } catch {
      toast.message(url);
    }
  }

  return (
    <AdminSection
      title="보드 준비"
      right={
        <>
          <button
            type="button"
            disabled={busy}
            onClick={onEnsure}
            className="rounded-lg bg-[#3D4A7A] px-3 py-2 text-[13px] font-semibold text-white disabled:opacity-40"
          >
            {rows.length}개 조 보드 만들기/확인
          </button>
          <button
            type="button"
            disabled={busy || !entries.length}
            onClick={onTakeHost}
            className="rounded-lg border border-eb-line px-3 py-2 text-[13px] disabled:opacity-40"
          >
            호스트 권한 이 브라우저에 가져오기
          </button>
          <button
            type="button"
            onClick={onLinksCsv}
            className="rounded-lg border border-eb-line px-3 py-2 text-[13px]"
          >
            링크 목록 CSV
          </button>
        </>
      }
    >
      <div className="eb-scroll -mx-1 max-h-[420px] overflow-auto px-1">
        <table className="w-full min-w-[640px] border-collapse text-[13px]">
          <thead className="sticky top-0 z-10 bg-white">
            <tr className="border-b border-eb-line text-left text-[12px] text-eb-muted">
              <th className="py-2 pr-2 font-semibold">조</th>
              <th className="w-full py-2 pr-2 font-semibold">링크</th>
              <th className="py-2 pr-2 text-right font-semibold">배치 카드</th>
              <th className="py-2 pr-2 text-right font-semibold">득표</th>
              <th className="py-2 pr-2 font-semibold">마지막 활동</th>
              <th className="py-2 pr-2 font-semibold">단계</th>
              <th className="py-2 font-semibold">잠금</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((n) => {
              const entry = byNo.get(n);
              const slug = teamSlug(n);
              const url = `${origin}/b/${slug}`;
              const agg = entry ? teamAgg(entry) : null;
              return (
                <tr key={n} className="border-b border-eb-line/70">
                  <td className="py-2 pr-2 font-semibold tabular-nums">{n}조</td>
                  <td className="py-2 pr-2">
                    <a
                      href={`/b/${slug}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[#3D4A7A] underline underline-offset-2"
                    >
                      /b/{slug}
                    </a>
                    <button
                      type="button"
                      onClick={() => void copy(url)}
                      aria-label={`${n}조 링크 복사`}
                      className="ml-2 rounded border border-eb-line px-1.5 py-0.5 text-[11px]"
                    >
                      복사
                    </button>
                  </td>
                  {agg ? (
                    <>
                      <td className="py-2 pr-2 text-right tabular-nums">
                        <span className="font-semibold">{agg.placed}</span>
                        <span className="text-eb-muted"> / {agg.total}</span>
                      </td>
                      <td className="py-2 pr-2 text-right tabular-nums">{agg.votes}</td>
                      <td className="py-2 pr-2 text-eb-muted">{fmtTime(agg.lastActivity)}</td>
                      <td className="py-2 pr-2">{PHASE_LABEL[agg.phase]}</td>
                      <td className="py-2">{agg.locked ? '🔒 잠김' : '—'}</td>
                    </>
                  ) : (
                    <td colSpan={5} className="py-2 text-eb-muted">
                      {firstLoad ? '불러오는 중…' : '아직 보드 없음'}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </AdminSection>
  );
}
