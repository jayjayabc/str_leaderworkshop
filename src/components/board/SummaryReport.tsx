'use client';

// AI 갈무리 리포트 (Board v1.2) — 송출 화면 전체 화면(1920×1080 기준)과 운영자 미리보기가 같은 컴포넌트를 쓴다.
//   위: 'AI 갈무리 · 그룹' + 답 수 · (예시면 '예시 · AI 아님' 배지) / 헤드라인(가장 큰 글자)
//   왼쪽 약 60%: 주제 막대(제목 + 건수 + 막대 + 작은 인용) — 섹션이 둘(2-3a·2-3b)이면 두 칸
//   오른쪽 약 40%: 눈여겨볼 의견 카드(최대 2) → '그래서' 박스
//   반조 정보는 없다 — 받는 데이터(BoardSummary)에 team_id·card 가 없다.

import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';

import { groupById, groupLabel, itemById } from '@/lib/boardSeed';
import { safeSummaryData, type BoardSummary, type BoardSummarySection } from '@/lib/boardSummary';
import { BOARD_SCREEN_THEMES } from './boardScreenTheme';

const W = 1920;
const H = 1080;

const clampLines = (n: number): React.CSSProperties => ({
  display: '-webkit-box',
  WebkitLineClamp: n,
  WebkitBoxOrient: 'vertical',
  overflow: 'hidden',
});

/** 주제 수(한 섹션)에 따른 글자 크기 — 많을수록 작게 */
function sizeFor(n: number, dual: boolean) {
  if (dual) return { title: 30, count: 28, bar: 12, quote: 20, gap: 20, titleLines: 2, quoteLines: 2 };
  if (n <= 3) return { title: 46, count: 44, bar: 22, quote: 28, gap: 44, titleLines: 2, quoteLines: 2 };
  if (n === 4) return { title: 42, count: 40, bar: 20, quote: 26, gap: 32, titleLines: 2, quoteLines: 2 };
  if (n === 5) return { title: 36, count: 34, bar: 16, quote: 23, gap: 24, titleLines: 1, quoteLines: 1 };
  return { title: 33, count: 31, bar: 14, quote: 21, gap: 16, titleLines: 1, quoteLines: 1 };
}

function Themes({ section, dual, still, baseDelay }: { section: BoardSummarySection; dual: boolean; still: boolean; baseDelay: number }) {
  const themes = dual ? section.themes.slice(0, 4) : section.themes;
  const sz = sizeFor(themes.length, dual);
  const max = Math.max(1, ...themes.map((t) => t.count));
  if (themes.length === 0) {
    return (
      <p className="pt-10 text-[30px] font-bold" style={{ color: 'var(--faint)' }}>
        묶을 답이 아직 없어요
      </p>
    );
  }
  return (
    <ol className="flex min-h-0 flex-1 flex-col" style={{ gap: sz.gap }}>
      {themes.map((t, i) => (
        <li key={`${t.title}-${i}`} data-testid="summary-theme" className="min-w-0">
          <div className="flex items-baseline gap-4">
            <span
              className="min-w-0 flex-1 font-black leading-[1.22]"
              style={{ fontSize: sz.title, wordBreak: 'keep-all', ...clampLines(sz.titleLines) }}
            >
              {t.title}
            </span>
            <span className="shrink-0 font-black tabular-nums" style={{ fontSize: sz.count }}>
              {t.count}
              <span className="ml-0.5 font-bold" style={{ fontSize: Math.round(sz.count * 0.62), color: 'var(--sub)' }}>
                건
              </span>
            </span>
          </div>
          <div className="mt-2 w-full overflow-hidden rounded-full" style={{ height: sz.bar, background: 'var(--bar-track)' }}>
            <motion.div
              className="h-full rounded-full"
              style={{ background: 'var(--bar)' }}
              initial={still ? false : { width: 0 }}
              animate={{ width: `${Math.max(3, (t.count / max) * 100)}%` }}
              transition={{ duration: 0.8, delay: baseDelay + i * 0.09, ease: [0.2, 0.8, 0.3, 1] }}
            />
          </div>
          {t.quote ? (
            <p className="mt-2 font-medium leading-[1.4]" style={{ fontSize: sz.quote, color: 'var(--sub)', wordBreak: 'keep-all', ...clampLines(sz.quoteLines) }}>
              “{t.quote}”
            </p>
          ) : null}
        </li>
      ))}
    </ol>
  );
}

export function SummaryReport({ summary, still = false }: { summary: BoardSummary; still?: boolean }) {
  const data = safeSummaryData(summary.data);
  const g = groupById(summary.group);
  // 그룹의 항목 순서대로, 데이터에 있는 섹션만 (모르는 항목은 버린다)
  const sections = (g?.items ?? [])
    .map((it) => data.sections.find((s) => s.item_id === it.id))
    .filter((s): s is BoardSummarySection => Boolean(s));
  const dual = sections.length > 1;
  // 눈여겨볼 의견은 섹션을 합쳐 최대 2개
  const standouts = sections.flatMap((s) => s.standouts).slice(0, 2);
  const offtopic = sections.reduce((n, s) => n + s.offtopic, 0);
  const fade = (delay: number) => ({
    initial: still ? (false as const) : { opacity: 0, y: 14 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.45, delay, ease: 'easeOut' as const },
  });

  return (
    <div data-testid="summary-report" className="flex h-full flex-col px-[72px] pb-[40px] pt-[34px]">
      {/* 상단 줄 */}
      <div className="flex h-[58px] items-center gap-5">
        <span className="rounded-full px-5 py-1.5 text-[26px] font-black" style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}>
          AI 갈무리
        </span>
        <span className="text-[30px] font-bold" style={{ color: 'var(--sub)' }}>
          {g ? `${groupLabel(g.id)} ${g.title}` : summary.group}
        </span>
        <span className="ml-auto text-[22px] font-medium" style={{ color: 'var(--faint)' }}>
          답 {summary.source_count}건 · 건수는 대략
        </span>
        {data.fake ? (
          <span data-testid="summary-fake-badge" className="rounded-full px-6 py-1.5 text-[26px] font-black" style={{ background: '#FF5A3C', color: '#fff' }}>
            예시 · AI 아님
          </span>
        ) : null}
      </div>

      {/* 헤드라인 */}
      <motion.h1
        {...fade(0)}
        data-testid="summary-headline"
        className="mt-[22px] text-[76px] font-black leading-[1.16] tracking-[-0.01em]"
        style={{ wordBreak: 'keep-all', ...clampLines(2) }}
      >
        {data.headline}
      </motion.h1>

      {/* 본문 */}
      <div className="mt-[30px] grid min-h-0 flex-1 gap-[56px]" style={{ gridTemplateColumns: dual ? '1.9fr 1fr' : '1.5fr 1fr' }}>
        <div data-testid="summary-col-left" className="flex min-h-0 flex-col">
          {dual ? (
            <div className="grid min-h-0 flex-1 grid-cols-2 gap-[36px]">
              {sections.map((s, si) => (
                <section key={s.item_id} className="flex min-h-0 min-w-0 flex-col">
                  <h2 className="mb-4 text-[24px] font-extrabold" style={{ color: 'var(--sub)', wordBreak: 'keep-all', ...clampLines(1) }}>
                    <span className="mr-2 rounded-md px-2 py-0.5 text-[20px]" style={{ background: 'var(--panel)' }}>
                      {groupLabel(s.item_id)}
                    </span>
                    {itemById(s.item_id)?.title}
                  </h2>
                  <Themes section={s} dual still={still} baseDelay={0.25 + si * 0.1} />
                </section>
              ))}
            </div>
          ) : sections[0] ? (
            <Themes section={sections[0]} dual={false} still={still} baseDelay={0.25} />
          ) : null}
          {offtopic > 0 ? (
            <p data-testid="summary-offtopic" className="mt-4 text-[22px] font-medium" style={{ color: 'var(--faint)' }}>
              주제와 다른 답 {offtopic}건
            </p>
          ) : null}
        </div>

        <div data-testid="summary-col-right" className="flex min-h-0 flex-col gap-[18px]">
          {standouts.length ? (
            <>
              <h2 className="text-[24px] font-extrabold" style={{ color: 'var(--sub)' }}>
                눈여겨볼 의견
              </h2>
              {standouts.map((s, i) => (
                <motion.article
                  key={`${s.quote}-${i}`}
                  {...fade(0.5 + i * 0.12)}
                  data-testid="summary-standout"
                  className="rounded-[24px] px-8 py-6"
                  style={{ background: 'var(--card)', border: '1px solid var(--line)' }}
                >
                  <p className="text-[27px] font-bold leading-[1.4]" style={{ wordBreak: 'keep-all', ...clampLines(3) }}>
                    “{s.quote}”
                  </p>
                  {s.why ? (
                    <p className="mt-2 text-[21px] font-semibold leading-[1.35]" style={{ color: 'var(--sub)', wordBreak: 'keep-all', ...clampLines(2) }}>
                      <span style={{ color: 'var(--ink)' }}>▸</span> {s.why}
                    </p>
                  ) : null}
                </motion.article>
              ))}
            </>
          ) : null}
          {data.takeaway ? (
            <motion.div
              {...fade(0.8)}
              data-testid="summary-takeaway"
              className="mt-auto rounded-[28px] px-9 py-7"
              style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}
            >
              <p className="text-[22px] font-black tracking-wide" style={{ opacity: 0.65 }}>
                그래서
              </p>
              <p className="mt-1 text-[36px] font-black leading-[1.28]" style={{ wordBreak: 'keep-all', ...clampLines(3) }}>
                {data.takeaway}
              </p>
            </motion.div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** 운영자 미리보기 — 1920×1080 리포트를 패널 너비에 맞춰 줄여 보여 준다(애니메이션 없이) */
export function SummaryPreview({ summary, theme }: { summary: BoardSummary; theme: 'dark' | 'light' }) {
  const box = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(0.3);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setScale(el.clientWidth / W);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={box} className="relative w-full overflow-hidden rounded-xl border border-black/15" style={{ aspectRatio: '16 / 9' }} data-testid="summary-preview">
      <div
        className="absolute left-0 top-0 origin-top-left overflow-hidden"
        style={{
          width: W,
          height: H,
          transform: `scale(${scale})`,
          background: 'var(--bg)',
          color: 'var(--ink)',
          ...(BOARD_SCREEN_THEMES[theme] as React.CSSProperties),
        }}
      >
        <SummaryReport summary={summary} still />
      </div>
    </div>
  );
}
