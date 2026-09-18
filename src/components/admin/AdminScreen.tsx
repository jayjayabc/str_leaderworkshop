'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import clsx from 'clsx';

import { MODE_BADGE, getDb } from '@/lib/db';
import { useBoard, boardHostToken, writeHostToken, PHASE_LABEL, PHASES } from '@/store/board';
import { TEAM_COUNT, teamNumbers, teamSlug, teamTitle } from '@/lib/teams';
import { GATE_ENABLED, OPERATOR_KEY, keyFromUrl, mapLimit, readStoredKey, writeStoredKey } from '@/lib/admin';
import { cachedSnapshot, useClientValue } from '@/lib/clientStore';
import { exportAllCsv, exportAllJson, exportLinksCsv } from '@/lib/export';
import type { TeamEntry } from '@/lib/aggregate';
import type { Phase } from '@/lib/types';
import { AdminBoards } from './AdminBoards';
import { AdminAggregate } from './AdminAggregate';
import { AdminDanger } from './AdminDanger';

const POLL_MS = 5000;

/**
 * 게이트 판정을 한 번만 하고 캐시한다.
 * 'pending'은 서버 렌더용 값이고, 클라이언트에서 'open' 또는 'locked'로 바뀐다.
 */
const gate = cachedSnapshot<'open' | 'locked'>(() => {
  if (!GATE_ENABLED) return 'open';
  const fromUrl = keyFromUrl();
  if (fromUrl && fromUrl === OPERATOR_KEY) {
    writeStoredKey(fromUrl);
    return 'open';
  }
  return readStoredKey() === OPERATOR_KEY ? 'open' : 'locked';
});

/** 현재 창의 origin (링크 표시·복사용) */
const originSnapshot = cachedSnapshot(() => window.location.origin);

export function AdminScreen() {
  const state = useClientValue<'open' | 'locked' | 'pending'>(gate.get, 'pending');
  const [unlocked, setUnlocked] = useState(false);
  const [input, setInput] = useState('');

  if (state === 'pending') return null;

  if (state === 'locked' && !unlocked) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        <div className="eb-panel w-full max-w-[400px] p-6">
          <h1 className="text-[19px] font-bold">운영자 페이지</h1>
          <p className="mt-2 text-[13px] leading-5 text-eb-muted">
            운영자 키를 입력하세요. 주소에 <code>?key=…</code>를 붙여도 됩니다. 이 키는 편의용
            구분일 뿐 보안 장치가 아닙니다.
          </p>
          <input
            autoFocus
            type="password"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return;
              if (input.trim() === OPERATOR_KEY) {
                writeStoredKey(input.trim());
                setUnlocked(true);
              } else toast.error('키가 올바르지 않습니다');
            }}
            placeholder="운영자 키"
            aria-label="운영자 키"
            className="mt-4 w-full rounded-lg border border-eb-line px-3 py-2.5 text-[14px] outline-none focus:border-[#9aa4b8]"
          />
          <button
            type="button"
            onClick={() => {
              if (input.trim() === OPERATOR_KEY) {
                writeStoredKey(input.trim());
                setUnlocked(true);
              } else toast.error('키가 올바르지 않습니다');
            }}
            className="mt-4 h-11 w-full rounded-lg bg-[#3D4A7A] text-[15px] font-semibold text-white"
          >
            들어가기
          </button>
        </div>
      </main>
    );
  }

  return <AdminConsole />;
}

function AdminConsole() {
  const db = useMemo(() => getDb(), []);
  const mode = useBoard((s) => s.mode);
  const [entries, setEntries] = useState<TeamEntry[]>([]);
  const [progress, setProgress] = useState<string | null>(null);
  const [firstLoad, setFirstLoad] = useState(true);
  const [live, setLive] = useState(true);
  const origin = useClientValue(originSnapshot.get, '');
  const busyRef = useRef(false);

  const loadAll = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      const nums = teamNumbers();
      const loaded = await mapLimit(nums, 6, async (n) => {
        const slug = teamSlug(n);
        const snapshot = await db.loadBoard(slug).catch(() => null);
        return snapshot ? ({ teamNo: n, slug, snapshot } satisfies TeamEntry) : null;
      });
      setEntries(loaded.filter((e): e is TeamEntry => Boolean(e)));
    } finally {
      busyRef.current = false;
      setFirstLoad(false);
    }
  }, [db]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  // 라이브 — 5초 폴링 (두 어댑터 모두에서 같은 방식으로 동작한다)
  useEffect(() => {
    if (!live) return undefined;
    const t = setInterval(() => {
      if (!progress) void loadAll();
    }, POLL_MS);
    return () => clearInterval(t);
  }, [live, loadAll, progress]);

  /** 없는 조 보드를 만든다 (멱등) */
  async function ensureBoards() {
    const nums = teamNumbers();
    setProgress(`보드 확인 중… 0/${nums.length}`);
    let created = 0;
    await mapLimit(
      nums,
      4,
      async (n) => {
        const slug = teamSlug(n);
        const existing = await db.loadBoard(slug).catch(() => null);
        if (existing) return;
        await db.createBoard({ title: teamTitle(n), slug });
        created += 1;
      },
      (done, total) => setProgress(`보드 확인 중… ${done}/${total}`),
    );
    setProgress(null);
    await loadAll();
    toast.success(created ? `${created}개 조 보드를 만들었습니다` : '모든 조 보드가 이미 있습니다');
  }

  /** 각 보드의 host_token을 이 브라우저에 저장해 모든 조의 호스트가 된다 */
  function takeHost() {
    let ok = 0;
    let miss = 0;
    entries.forEach((e) => {
      const token = boardHostToken(e.snapshot.board);
      if (token) {
        writeHostToken(e.slug, token);
        ok += 1;
      } else miss += 1;
    });
    toast.success(
      `호스트 권한 ${ok}개 조를 이 브라우저로 가져왔습니다${miss ? ` (토큰을 읽지 못한 조 ${miss}개)` : ''}`,
    );
  }

  async function applyAll(
    label: string,
    flags: Record<string, unknown>,
  ) {
    if (!entries.length) {
      toast.message('먼저 조 보드를 만들어 주세요');
      return;
    }
    if (!window.confirm(`${entries.length}개 조에 "${label}"를 적용할까요?`)) return;
    setProgress(`${label} 적용 중… 0/${entries.length}`);
    await mapLimit(
      entries,
      4,
      async (e) => {
        await db.setBoardFlags(e.slug, flags).catch(() => undefined);
      },
      (done, total) => setProgress(`${label} 적용 중… ${done}/${total}`),
    );
    setProgress(null);
    await loadAll();
    toast.success(`${label} — ${entries.length}개 조에 적용했습니다`);
  }

  async function resetAll() {
    setProgress(`초기화 중… 0/${entries.length}`);
    await mapLimit(
      entries,
      3,
      async (e) => {
        await db.resetBoard(e.slug).catch(() => undefined);
      },
      (done, total) => setProgress(`초기화 중… ${done}/${total}`),
    );
    setProgress(null);
    await loadAll();
    toast.success('모든 조를 초기화했습니다');
  }

  return (
    <main className="mx-auto w-full max-w-[1200px] px-4 py-6 sm:px-6">
      <header className="flex flex-wrap items-center gap-2">
        <h1 className="text-[22px] font-bold">운영자 콘솔</h1>
        <span
          className={clsx(
            'rounded-full px-2 py-0.5 text-[11px]',
            mode === 'supabase' ? 'bg-[#EAF5EA] text-[#2F7A3E]' : 'bg-[#F8F0E6] text-[#9A5B1E]',
          )}
        >
          {MODE_BADGE[mode].short}
        </span>
        <span className="text-[13px] text-eb-muted">
          {entries.length}/{TEAM_COUNT}개 조 보드
        </span>

        <div className="ml-auto flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-[12px] text-eb-muted">
            <input
              type="checkbox"
              checked={live}
              onChange={(e) => setLive(e.target.checked)}
              className="h-4 w-4"
            />
            라이브 (5초)
          </label>
          <button
            type="button"
            onClick={() => void loadAll()}
            className="rounded-lg border border-eb-line px-3 py-2 text-[13px]"
          >
            새로고침
          </button>
        </div>
      </header>

      {!GATE_ENABLED ? (
        <p className="mt-3 rounded-lg bg-[#F8F0E6] px-3 py-2 text-[12px] leading-5 text-[#9A5B1E]">
          <strong>NEXT_PUBLIC_OPERATOR_KEY</strong>가 설정되어 있지 않아 이 페이지가 누구에게나
          열려 있습니다. 배포 환경에서는 환경변수를 넣어 주세요(보안 장치가 아니라 실수 방지용입니다).
        </p>
      ) : null}

      {progress ? (
        <p
          className="mt-3 rounded-lg bg-[#EEF0F7] px-3 py-2 text-[13px] font-medium text-[#3D4A7A]"
          role="status"
        >
          {progress}
        </p>
      ) : null}

      <div className="mt-5 flex flex-col gap-5">
        <AdminBoards
          entries={entries}
          origin={origin}
          firstLoad={firstLoad}
          onEnsure={() => void ensureBoards()}
          onTakeHost={takeHost}
          onLinksCsv={() =>
            exportLinksCsv(
              teamNumbers().map((n) => ({ team: n, url: `${origin}/b/${teamSlug(n)}` })),
            )
          }
          busy={Boolean(progress)}
        />

        <AdminPhases onApply={(label, flags) => void applyAll(label, flags)} busy={Boolean(progress)} />

        <AdminAggregate entries={entries} />

        <AdminSection title="일괄 내보내기">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={!entries.length}
              onClick={() => exportAllCsv(entries.map((e) => ({ teamNo: e.teamNo, snapshot: e.snapshot })))}
              className="rounded-lg border border-eb-line px-3 py-2 text-[13px] font-medium disabled:opacity-40"
            >
              전체 CSV (모든 조 카드)
            </button>
            <button
              type="button"
              disabled={!entries.length}
              onClick={() => exportAllJson(entries.map((e) => ({ teamNo: e.teamNo, snapshot: e.snapshot })))}
              className="rounded-lg border border-eb-line px-3 py-2 text-[13px] font-medium disabled:opacity-40"
            >
              전체 JSON (스냅샷)
            </button>
          </div>
          <p className="mt-2 text-[12px] text-eb-muted">
            파일명은 <code>elephant-board_all_yyyyMMdd-HHmm.csv / .json</code>입니다.
          </p>
        </AdminSection>

        <AdminDanger count={entries.length} busy={Boolean(progress)} onReset={() => void resetAll()} />
      </div>
    </main>
  );
}

export function AdminSection({
  title,
  children,
  right,
}: {
  title: string;
  children: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <section className="eb-panel p-4 sm:p-5">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="text-[15px] font-bold">{title}</h2>
        {right ? <div className="ml-auto flex flex-wrap gap-2">{right}</div> : null}
      </div>
      {children}
    </section>
  );
}

function AdminPhases({
  onApply,
  busy,
}: {
  onApply: (label: string, flags: Record<string, unknown>) => void;
  busy: boolean;
}) {
  return (
    <AdminSection title="전체 단계 전환">
      <div className="flex flex-wrap gap-2">
        {PHASES.map((p: Phase) => (
          <button
            key={p}
            type="button"
            disabled={busy}
            onClick={() => onApply(`${PHASE_LABEL[p]} 단계`, { phase: p })}
            className="rounded-lg border border-[#3D4A7A] bg-[#EEF0F7] px-3 py-2 text-[13px] font-semibold text-[#3D4A7A] disabled:opacity-40"
          >
            전체 {PHASE_LABEL[p]}
          </button>
        ))}
        <span className="mx-1 w-px bg-eb-line" aria-hidden />
        <button
          type="button"
          disabled={busy}
          onClick={() => onApply('전체 잠금', { locked: true })}
          className="rounded-lg border border-eb-line px-3 py-2 text-[13px] disabled:opacity-40"
        >
          전체 잠금
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => onApply('전체 잠금 해제', { locked: false })}
          className="rounded-lg border border-eb-line px-3 py-2 text-[13px] disabled:opacity-40"
        >
          전체 잠금 해제
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => onApply('🤮 전체 숨김', { hide_vomit: true })}
          className="rounded-lg border border-eb-line px-3 py-2 text-[13px] disabled:opacity-40"
        >
          🤮 전체 숨김
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => onApply('🤮 전체 표시', { hide_vomit: false })}
          className="rounded-lg border border-eb-line px-3 py-2 text-[13px] disabled:opacity-40"
        >
          🤮 전체 표시
        </button>
      </div>
      <p className="mt-2 text-[12px] text-eb-muted">
        모든 조 보드에 한 번에 적용됩니다. 누르면 확인 창이 뜨고, 진행 상황이 위에 표시됩니다.
      </p>
    </AdminSection>
  );
}
