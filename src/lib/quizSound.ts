// 송출 화면 효과음 (Quiz v1.1) — 파일 없이 Web Audio로 합성한다.
// 브라우저는 사용자가 한 번 눌러야 소리를 낼 수 있으므로, 송출 화면의 '소리 켜기' 버튼으로 시작한다.

let ctx: AudioContext | null = null;

export function unlockSound(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return false;
    ctx ??= new AC();
    void ctx.resume();
    return true;
  } catch {
    return false;
  }
}

function tone(freq: number, at: number, dur: number, type: OscillatorType = 'sine', gain = 0.25): void {
  if (!ctx) return;
  const t0 = ctx.currentTime + at;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

function whoosh(at = 0, dur = 0.35, gain = 0.18): void {
  if (!ctx) return;
  const t0 = ctx.currentTime + at;
  const len = Math.floor(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i += 1) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.setValueAtTime(400, t0);
  f.frequency.exponentialRampToValueAtTime(3000, t0 + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t0);
  src.connect(f).connect(g).connect(ctx.destination);
  src.start(t0);
}

export type QuizSfx = 'open' | 'tick' | 'tickHigh' | 'timeup' | 'reveal' | 'noWinner' | 'transition' | 'final';

export function playSfx(kind: QuizSfx): void {
  if (!ctx || ctx.state !== 'running') return;
  switch (kind) {
    case 'open': // 문제 시작 — 올라가는 두 음
      tone(660, 0, 0.18, 'triangle');
      tone(990, 0.15, 0.3, 'triangle');
      break;
    case 'tick': // 남은 10초 — 째깍
      tone(1200, 0, 0.05, 'square', 0.08);
      break;
    case 'tickHigh': // 남은 3초 — 더 높고 큰 째깍
      tone(1600, 0, 0.08, 'square', 0.14);
      break;
    case 'timeup': // 마감 — 낮은 부저
      tone(220, 0, 0.6, 'sawtooth', 0.18);
      tone(165, 0.05, 0.6, 'sawtooth', 0.12);
      break;
    case 'reveal': // 정답 공개 — 팡파르
      [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.09, 0.35, 'triangle', 0.22));
      tone(1047, 0.4, 0.6, 'sine', 0.18);
      break;
    case 'noWinner':
      tone(392, 0, 0.25, 'triangle');
      tone(330, 0.22, 0.4, 'triangle');
      break;
    case 'transition': // 다음 문제로 — 휙
      whoosh();
      break;
    case 'final':
      [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, i * 0.12, 0.5, 'triangle', 0.22));
      break;
  }
}
