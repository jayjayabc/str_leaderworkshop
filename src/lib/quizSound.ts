// 효과음 (Quiz v2.2) — 중앙 화면(송출·운영자 중 '효과음 켜기'를 누른 한 곳)에서만 난다. 참가자 폰은 소리 없음.
//
// 효과음이 나는 곳은 다섯 군데뿐이다 (2026-10-06 결정)
//   lobby    맨 처음 입장 대기 화면 — 기대감을 주는 리드미컬한 음악 (반복)
//   open     문제 시작 — 한 번
//   thinking 문제 진행 중 — 시계 째깍 소리만 계속 (반복)
//   timeup   마감(운영자가 마감을 누르거나 시간이 다 됨) — 한 번
//   reveal   정답 공개 — "빠밤빰 바밤!" 한 번
//
// 음원: public/quiz/sfx/{lobby,open,thinking,timeup,reveal}.mp3 — Mixkit 무료 효과음(Mixkit Sound Effects Free License)
//   lobby = Game show intro(943) · open = Movie impact intro presentation(2902) · thinking = Wall clock tick tock(1060, 정확히 22박으로 자름)
//   timeup = Ice hockey sports buzzer(941) · reveal = Musical reveal(961)
//   final(최종 순위 BGM, 반복) = Game show uplifting(944) · applause(최종 순위 첫 박수) = Auditorium applause(502). 앞 무음 제거 + 라우드니스 맞춤.
// 파일이 없으면 그 효과음은 조용히 건너뛴다(대신 합성음을 내지 않는다).
// 반복 음원은 끝과 처음을 0.6초 겹쳐(크로스페이드) 이어 붙이므로 아무 길이의 파일이어도 끊김 없이 돈다.

export type QuizCue = 'open' | 'timeup' | 'reveal' | 'applause';
export type QuizLoop = 'lobby' | 'thinking' | 'final';
const FILES = ['lobby', 'open', 'thinking', 'timeup', 'reveal', 'final', 'applause'] as const;
type FileKey = (typeof FILES)[number];

/** 음량 — 반복 음원은 진행자 목소리를 덮지 않게 낮게 */
const GAIN: Record<FileKey, number> = { lobby: 0.6, open: 0.95, thinking: 0.55, timeup: 0.95, reveal: 1, final: 0.7, applause: 0.9 };
const XFADE = 0.6;

let ctx: AudioContext | null = null;
let out: GainNode | null = null;
const buffers: Partial<Record<FileKey, AudioBuffer>> = {};
const waiters: Partial<Record<FileKey, (() => void)[]>> = {};

function load(c: AudioContext, k: FileKey): void {
  fetch(`/quiz/sfx/${k}.mp3`, { cache: 'force-cache' })
    .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
    .then((ab) => c.decodeAudioData(ab))
    .then((buf) => {
      buffers[k] = buf;
      (waiters[k] ?? []).forEach((f) => f());
      waiters[k] = [];
    })
    .catch(() => undefined);
}

/** 브라우저 정책상 사용자가 한 번 눌러야 소리를 낼 수 있다 — '효과음 켜기' 버튼에서 부른다 */
export function unlockSound(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return false;
    if (!ctx) {
      ctx = new AC();
      out = ctx.createGain();
      out.gain.value = 1;
      out.connect(ctx.destination);
      FILES.forEach((k) => load(ctx!, k));
    }
    void ctx.resume();
    return true;
  } catch {
    return false;
  }
}

export function soundReady(): Record<FileKey, boolean> {
  return Object.fromEntries(FILES.map((k) => [k, Boolean(buffers[k])])) as Record<FileKey, boolean>;
}

function source(k: FileKey, at: number, gain: number): { src: AudioBufferSourceNode; g: GainNode } | null {
  const buf = buffers[k];
  if (!ctx || !out || !buf) return null;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const g = ctx.createGain();
  g.gain.value = gain;
  src.connect(g).connect(out);
  src.start(at);
  return { src, g };
}

/** 한 번 울리는 효과음 */
function log(ev: string): void {
  if (typeof window === 'undefined') return;
  const w = window as unknown as { __quizSoundLog?: string[] };
  (w.__quizSoundLog ??= []).push(ev);
  if (w.__quizSoundLog.length > 50) w.__quizSoundLog.shift();
}

export function playCue(cue: QuizCue): void {
  if (!ctx || ctx.state !== 'running') return;
  log(`cue:${cue}${buffers[cue] ? '' : '(파일 없음)'}`);
  source(cue, ctx.currentTime, GAIN[cue]);
}

// ─── 반복 음원 ────────────────────────────────────────────────

let loop: { key: QuizLoop; timer: ReturnType<typeof setTimeout> | null; nodes: { src: AudioBufferSourceNode; g: GainNode }[]; bus: GainNode } | null =
  null;

function stopLoop(fade = 0.8): void {
  if (!loop || !ctx) {
    loop = null;
    return;
  }
  const l = loop;
  loop = null;
  if (l.timer) clearTimeout(l.timer);
  const t = ctx.currentTime;
  l.bus.gain.cancelScheduledValues(t);
  l.bus.gain.setValueAtTime(l.bus.gain.value, t);
  l.bus.gain.linearRampToValueAtTime(0, t + fade);
  l.nodes.forEach((n) => {
    try {
      n.src.stop(t + fade + 0.05);
    } catch {
      /* 이미 멈춤 */
    }
  });
}

/**
 * 반복 음원을 바꾼다 (null = 끄기). delay초 뒤에 fadeIn초에 걸쳐 들어온다.
 * 파일이 아직 안 받아졌으면 받아지는 대로 시작한다.
 */
export function setLoop(key: QuizLoop | null, opts: { delay?: number; fadeIn?: number } = {}): void {
  if (loop?.key === key) return;
  if (loop || key) log(`loop:${key ?? 'off'}`);
  stopLoop();
  if (!key || !ctx || ctx.state !== 'running') return;
  const c = ctx;
  const buf = buffers[key];
  if (!buf) {
    (waiters[key] ??= []).push(() => {
      if (!loop && pendingLoop === key) setLoop(key, opts);
    });
    pendingLoop = key;
    return;
  }
  pendingLoop = null;
  const bus = c.createGain();
  bus.connect(out!);
  const t0 = c.currentTime + (opts.delay ?? 0);
  bus.gain.setValueAtTime(0, c.currentTime);
  bus.gain.setValueAtTime(0, t0);
  bus.gain.linearRampToValueAtTime(GAIN[key], t0 + (opts.fadeIn ?? 1.2));
  const me = { key, timer: null as ReturnType<typeof setTimeout> | null, nodes: [] as { src: AudioBufferSourceNode; g: GainNode }[], bus };
  loop = me;
  if (key === 'thinking') {
    // 시계 째깍은 박자가 정확해야 하므로 겹치지 않고 그대로 반복(파일을 정확히 22박으로 잘라 둠)
    const src = c.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const g = c.createGain();
    src.connect(g).connect(bus);
    src.start(t0);
    me.nodes.push({ src, g });
    return;
  }
  const len = buf.duration;
  const step = Math.max(1, len - XFADE);
  const schedule = (at: number) => {
    if (loop !== me) return;
    const src = c.createBufferSource();
    src.buffer = buf;
    const g = c.createGain();
    // 앞뒤 0.6초 크로스페이드
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(1, at + XFADE);
    g.gain.setValueAtTime(1, at + len - XFADE);
    g.gain.linearRampToValueAtTime(0, at + len);
    src.connect(g).connect(bus);
    src.start(at);
    me.nodes.push({ src, g });
    if (me.nodes.length > 3) me.nodes.shift();
    // 다음 조각은 미리(끝나기 2초 전) 예약
    me.timer = setTimeout(() => schedule(at + step), Math.max(0, (at + step - c.currentTime - 2) * 1000));
  };
  schedule(t0);
}
let pendingLoop: QuizLoop | null = null;

export function stopAllSound(): void {
  pendingLoop = null;
  stopLoop(0.3);
}
