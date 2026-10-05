// 송출 화면 효과음 (Quiz v2.0) — 퀴즈쇼 톤으로 Web Audio에서 합성한다(음원 파일 없음).
//
// 소리 설계
//   - 마스터: 컴프레서 + 합성 리버브(룸 2.4초)로 한 공간에서 울리는 느낌을 준다.
//   - 악기: 디튠 톱니파 화음(브라스 스탭), 비배음 벨(글로켄), 필터 노이즈(라이저·우시·심벌·스네어), 피치 드롭 킥.
//   - 문제 시작 = 라이저 → 스탭 · 남은 10초 = 째깍(6~10초)·심장박동(1~5초) · 마감 = 하강 화음 + 공
//   - 정답 공개 = 스네어 롤 → 장조 스탭 + 심벌 + 벨 아르페지오 · 아무도 못 맞힘 = 짧은 롤 → 단조 하강
//   - 제출 = 조가 답을 낼 때마다 펜타토닉 벨 한 음씩 · 진행 중 배경 = 낮은 패드 + 은은한 펄스(켜고 끌 수 있음)
// 브라우저는 사용자가 한 번 눌러야 소리를 낼 수 있으므로 송출 화면의 '효과음 켜기' 버튼으로 시작한다.

export type QuizSfx =
  | 'open'
  | 'tick'
  | 'tickHigh'
  | 'timeup'
  | 'submit'
  | 'reveal'
  | 'revealNone'
  | 'transition'
  | 'final';

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let reverb: ConvolverNode | null = null;
let reverbIn: GainNode | null = null;
let noiseBuf: AudioBuffer | null = null;

const NOTE = (n: string): number => {
  // 'C4', 'F#3', 'Bb5'
  const m = /^([A-G])([#b]?)(-?\d)$/.exec(n);
  if (!m) return 440;
  const base: Record<string, number> = { C: -9, D: -7, E: -5, F: -4, G: -2, A: 0, B: 2 };
  const semi = base[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + (Number(m[3]) - 4) * 12;
  return 440 * 2 ** (semi / 12);
};

function makeImpulse(c: AudioContext, seconds: number, decay: number): AudioBuffer {
  const len = Math.floor(c.sampleRate * seconds);
  const buf = c.createBuffer(2, len, c.sampleRate);
  for (let ch = 0; ch < 2; ch += 1) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i += 1) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** decay;
  }
  return buf;
}

export function unlockSound(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return false;
    if (!ctx) {
      ctx = new AC();
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -16;
      comp.knee.value = 12;
      comp.ratio.value = 3.5;
      comp.attack.value = 0.004;
      comp.release.value = 0.25;
      master = ctx.createGain();
      master.gain.value = 0.85;
      master.connect(comp).connect(ctx.destination);
      reverb = ctx.createConvolver();
      reverb.buffer = makeImpulse(ctx, 2.4, 3.2);
      reverbIn = ctx.createGain();
      reverbIn.gain.value = 0.32;
      reverbIn.connect(reverb).connect(master);
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i += 1) d[i] = Math.random() * 2 - 1;
    }
    void ctx.resume();
    return true;
  } catch {
    return false;
  }
}

/** 소리를 마스터(드라이)와 리버브로 보낸다 */
function out(node: AudioNode, wet = 1): void {
  if (!ctx || !master || !reverbIn) return;
  node.connect(master);
  if (wet > 0) {
    const send = ctx.createGain();
    send.gain.value = wet;
    node.connect(send).connect(reverbIn);
  }
}

function env(g: GainNode, t0: number, peak: number, attack: number, hold: number, release: number): void {
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + attack);
  g.gain.setValueAtTime(Math.max(0.0002, peak), t0 + attack + hold);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + hold + release);
}

/** 브라스 스탭 — 디튠 톱니파 2개 + 필터 엔벨로프 */
function brass(freqs: number[], at: number, dur: number, gain = 0.16, wet = 0.9): void {
  if (!ctx) return;
  const t0 = ctx.currentTime + at;
  freqs.forEach((f) => {
    const g = ctx!.createGain();
    const lp = ctx!.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 0.8;
    lp.frequency.setValueAtTime(400, t0);
    lp.frequency.exponentialRampToValueAtTime(Math.min(9000, f * 9), t0 + 0.06);
    lp.frequency.exponentialRampToValueAtTime(Math.max(600, f * 3), t0 + dur);
    [-7, 7].forEach((cents) => {
      const o = ctx!.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.detune.value = cents;
      o.connect(lp);
      o.start(t0);
      o.stop(t0 + dur + 0.6);
    });
    lp.connect(g);
    env(g, t0, gain / freqs.length ** 0.5, 0.015, dur * 0.35, dur * 0.65 + 0.4);
    out(g, wet);
  });
}

/** 벨(글로켄) — 비배음 부분음 */
function bell(freq: number, at: number, gain = 0.12, decay = 1.6, wet = 1): void {
  if (!ctx) return;
  const t0 = ctx.currentTime + at;
  [
    [1, 1],
    [2.76, 0.42],
    [5.4, 0.2],
    [8.93, 0.08],
  ].forEach(([ratio, amp]) => {
    const o = ctx!.createOscillator();
    o.type = 'sine';
    o.frequency.value = freq * ratio;
    const g = ctx!.createGain();
    env(g, t0, gain * amp, 0.002, 0, decay / ratio ** 0.5);
    o.connect(g);
    out(g, wet);
    o.start(t0);
    o.stop(t0 + decay + 0.1);
  });
}

/** 필터 노이즈 — 라이저·우시·심벌·스네어의 재료 */
function noise(opts: {
  at: number;
  dur: number;
  gain: number;
  type: BiquadFilterType;
  from: number;
  to?: number;
  q?: number;
  attack?: number;
  wet?: number;
  rise?: boolean;
}): void {
  if (!ctx || !noiseBuf) return;
  const t0 = ctx.currentTime + opts.at;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  src.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = opts.type;
  f.Q.value = opts.q ?? 0.9;
  f.frequency.setValueAtTime(opts.from, t0);
  if (opts.to) f.frequency.exponentialRampToValueAtTime(opts.to, t0 + opts.dur);
  const g = ctx.createGain();
  if (opts.rise) {
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(opts.gain, t0 + opts.dur * 0.92);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + opts.dur + 0.05);
  } else {
    env(g, t0, opts.gain, opts.attack ?? 0.003, 0, opts.dur);
  }
  src.connect(f).connect(g);
  out(g, opts.wet ?? 0.6);
  src.start(t0, Math.random());
  src.stop(t0 + opts.dur + 0.2);
}

/** 킥 — 피치가 떨어지는 사인 */
function kick(at: number, gain = 0.5, from = 150, to = 42): void {
  if (!ctx) return;
  const t0 = ctx.currentTime + at;
  const o = ctx.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(from, t0);
  o.frequency.exponentialRampToValueAtTime(to, t0 + 0.18);
  const g = ctx.createGain();
  env(g, t0, gain, 0.002, 0.02, 0.32);
  o.connect(g);
  out(g, 0.15);
  o.start(t0);
  o.stop(t0 + 0.5);
}

function snare(at: number, gain: number): void {
  noise({ at, dur: 0.11, gain, type: 'bandpass', from: 1800, q: 0.6, wet: 0.35 });
}

function cymbal(at: number, gain = 0.09, dur = 2.2): void {
  noise({ at, dur, gain, type: 'highpass', from: 6500, q: 0.4, attack: 0.002, wet: 0.8 });
}

/** 스네어 롤 — 점점 빨라지고 커진다 */
function roll(at: number, dur: number): void {
  let t = 0;
  let step = 0.075;
  while (t < dur) {
    const p = t / dur;
    snare(at + t, 0.05 + 0.13 * p);
    t += step;
    step = Math.max(0.032, step * 0.965);
  }
}

let tickFlip = false;
let submitStep = 0;
const PENTA = ['C6', 'D6', 'E6', 'G6', 'A6', 'C7', 'D7', 'E7'].map(NOTE);

export function playSfx(kind: QuizSfx): void {
  if (!ctx || ctx.state !== 'running') return;
  switch (kind) {
    case 'open': {
      // 라이저 → 히트: 스탭 + 킥 + 심벌 + 반짝이는 벨
      noise({ at: 0, dur: 0.85, gain: 0.16, type: 'bandpass', from: 300, to: 5200, q: 1.2, rise: true, wet: 0.5 });
      kick(0.85, 0.55);
      brass(['C4', 'E4', 'G4', 'D5'].map(NOTE), 0.85, 0.5, 0.2);
      brass([NOTE('C3')], 0.85, 0.5, 0.12, 0.4);
      cymbal(0.85, 0.08, 1.8);
      bell(NOTE('G6'), 0.95, 0.06);
      bell(NOTE('C7'), 1.05, 0.05);
      submitStep = 0;
      break;
    }
    case 'tick': {
      // 시계 째깍 — 틱/톡 번갈아
      tickFlip = !tickFlip;
      noise({ at: 0, dur: 0.035, gain: 0.12, type: 'highpass', from: tickFlip ? 4200 : 3200, q: 0.7, wet: 0.15 });
      bell(tickFlip ? 1760 : 1320, 0, 0.035, 0.12, 0.1);
      break;
    }
    case 'tickHigh': {
      // 마지막 5초 — 째깍 + 심장박동(두 번)
      noise({ at: 0, dur: 0.04, gain: 0.16, type: 'highpass', from: 4600, q: 0.7, wet: 0.15 });
      bell(1975, 0, 0.05, 0.14, 0.1);
      kick(0.0, 0.42, 90, 38);
      kick(0.16, 0.3, 80, 36);
      break;
    }
    case 'timeup': {
      // 하강 화음 + 공
      brass(['G4', 'D5', 'G5'].map(NOTE), 0, 0.22, 0.17);
      brass(['C4', 'G4', 'C5'].map(NOTE), 0.24, 0.7, 0.19);
      kick(0.24, 0.5, 120, 40);
      bell(NOTE('C3'), 0.24, 0.16, 3.2, 1);
      bell(NOTE('G2') * 1.01, 0.26, 0.1, 3.2, 1);
      break;
    }
    case 'submit': {
      // 조가 답을 낼 때마다 펜타토닉 한 음씩 올라간다
      const f = PENTA[submitStep % PENTA.length];
      submitStep += 1;
      bell(f, 0, 0.05, 0.7, 0.8);
      break;
    }
    case 'reveal': {
      // 스네어 롤 → 장조 스탭 + 심벌 + 벨 아르페지오
      roll(0, 1.05);
      kick(1.1, 0.6);
      brass(['F3', 'C4', 'F4', 'A4', 'C5', 'G5'].map(NOTE), 1.1, 0.75, 0.24);
      cymbal(1.1, 0.12, 2.6);
      ['C6', 'F6', 'A6', 'C7'].forEach((n, i) => bell(NOTE(n), 1.25 + i * 0.07, 0.05, 1.4));
      break;
    }
    case 'revealNone': {
      // 짧은 롤 → 단조로 내려가는 두 음
      roll(0, 0.7);
      brass(['E4', 'G4', 'B4'].map(NOTE), 0.75, 0.32, 0.15);
      brass(['Eb4', 'Gb4', 'Bb4'].map(NOTE), 1.1, 0.32, 0.15);
      brass(['D4', 'F4', 'A4'].map(NOTE), 1.45, 0.9, 0.15);
      kick(1.45, 0.35, 100, 40);
      break;
    }
    case 'transition': {
      // 우시 + 낮은 쿵
      noise({ at: 0, dur: 0.6, gain: 0.12, type: 'bandpass', from: 2600, to: 280, q: 1.1, attack: 0.18, wet: 0.6 });
      kick(0.42, 0.32, 110, 45);
      bell(NOTE('E6'), 0.45, 0.03, 0.9);
      break;
    }
    case 'final': {
      // 팡파르 — C · F/C · G · C + 심벌 + 벨
      const seq: [string[], number, number][] = [
        [['C4', 'E4', 'G4', 'C5'], 0, 0.16],
        [['C4', 'E4', 'G4', 'C5'], 0.2, 0.16],
        [['C4', 'F4', 'A4', 'C5'], 0.4, 0.3],
        [['D4', 'G4', 'B4', 'D5'], 0.75, 0.3],
        [['C4', 'E4', 'G4', 'C5', 'E5', 'G5'], 1.1, 1.1],
      ];
      seq.forEach(([ns, at, d]) => brass(ns.map(NOTE), at, d, 0.22));
      [0, 0.2, 0.4, 0.75].forEach((t) => kick(t, 0.35));
      kick(1.1, 0.6);
      cymbal(1.1, 0.13, 3);
      ['C6', 'E6', 'G6', 'C7', 'E7'].forEach((n, i) => bell(NOTE(n), 1.2 + i * 0.08, 0.05, 1.6));
      break;
    }
  }
}

// ─── 진행 중 배경음(생각하는 시간) ─────────────────────────────

let ambient: { stop: () => void } | null = null;

/** 문제가 열려 있는 동안 낮은 패드 + 은은한 펄스. 켜면 서서히 들어오고 끄면 서서히 빠진다 */
export function setAmbient(on: boolean): void {
  if (!on) {
    ambient?.stop();
    ambient = null;
    return;
  }
  if (ambient || !ctx || ctx.state !== 'running') return;
  const c = ctx;
  const t0 = c.currentTime;
  const bus = c.createGain();
  bus.gain.setValueAtTime(0.0001, t0);
  bus.gain.exponentialRampToValueAtTime(0.09, t0 + 2.5);
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 700;
  lp.Q.value = 0.5;
  const lfo = c.createOscillator();
  const lfoGain = c.createGain();
  lfo.frequency.value = 0.12;
  lfoGain.gain.value = 260;
  lfo.connect(lfoGain).connect(lp.frequency);
  lfo.start(t0);
  const oscs: OscillatorNode[] = [];
  ['A2', 'E3', 'G3', 'B3', 'C4'].forEach((n) => {
    [-6, 6].forEach((cents) => {
      const o = c.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = NOTE(n);
      o.detune.value = cents;
      o.connect(lp);
      o.start(t0);
      oscs.push(o);
    });
  });
  lp.connect(bus);
  out(bus, 0.6);

  // 펄스 — 0.6초마다 아주 작은 하이햇
  let alive = true;
  const pulse = () => {
    if (!alive || !ctx) return;
    noise({ at: 0, dur: 0.05, gain: 0.025, type: 'highpass', from: 7000, q: 0.6, wet: 0.2 });
  };
  const timer = setInterval(pulse, 600);

  ambient = {
    stop: () => {
      alive = false;
      clearInterval(timer);
      const t = c.currentTime;
      bus.gain.cancelScheduledValues(t);
      bus.gain.setValueAtTime(Math.max(0.0001, bus.gain.value), t);
      bus.gain.exponentialRampToValueAtTime(0.0001, t + 0.8);
      oscs.forEach((o) => o.stop(t + 0.9));
      lfo.stop(t + 0.9);
    },
  };
}
