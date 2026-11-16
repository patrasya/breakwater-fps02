// audio.js — every sound is synthesized with WebAudio at play time: filtered
// noise bursts for gunfire, square blips for the charge, a soft thock for hits.
// No audio files, no network. The context is created lazily on the first user
// gesture (browser policy); distance attenuation is a plain gain falloff.

let ctx = null, master = null;
export function initAudio() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain(); master.gain.value = 0.5; master.connect(ctx.destination);
  } catch { ctx = null; }
}
const now = () => (ctx ? ctx.currentTime : 0);

function noiseBuffer(dur) {
  const len = Math.max(1, (ctx.sampleRate * dur) | 0);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}
let _nb = null;
function burst({ dur = 0.15, freq = 1200, q = 0.8, gain = 0.5, type = 'lowpass', slide = 0, delay = 0 }) {
  if (!ctx) return;
  const t = now() + delay;
  const src = ctx.createBufferSource(); src.buffer = _nb || (_nb = noiseBuffer(0.5));
  const f = ctx.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
  if (slide) f.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(f); f.connect(g); g.connect(master); src.start(t); src.stop(t + dur + 0.02);
}
function blip({ freq = 880, dur = 0.07, gain = 0.2, type = 'square', slide = 0, delay = 0 }) {
  if (!ctx) return;
  const t = now() + delay;
  const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.02);
}
const att = (dist) => 1 / (1 + dist * dist * 0.004); // distance gain

export const sfx = {
  shot(kind, dist = 0) {
    const g = att(dist);
    if (kind === 'sniper') { burst({ dur: 0.32, freq: 900, gain: 0.85 * g, slide: -700 }); burst({ dur: 0.1, freq: 3200, gain: 0.4 * g }); }
    else if (kind === 'shotgun') { burst({ dur: 0.24, freq: 700, gain: 0.8 * g, slide: -500 }); }
    else if (kind === 'smg') { burst({ dur: 0.09, freq: 1600, gain: 0.42 * g, slide: -900 }); }
    else if (kind === 'pistol') { burst({ dur: 0.11, freq: 1900, gain: 0.5 * g, slide: -1100 }); }
    else { burst({ dur: 0.13, freq: 1400, gain: 0.55 * g, slide: -1000 }); burst({ dur: 0.05, freq: 2800, gain: 0.25 * g }); }
  },
  dryFire() { blip({ freq: 1400, dur: 0.03, gain: 0.12 }); },
  reload() { blip({ freq: 300, dur: 0.05, gain: 0.15, type: 'square' }); blip({ freq: 210, dur: 0.05, gain: 0.15, delay: 0.18 }); blip({ freq: 420, dur: 0.05, gain: 0.18, delay: 0.36 }); },
  hit() { blip({ freq: 2100, dur: 0.045, gain: 0.16, type: 'sine' }); },
  kill() { blip({ freq: 1560, dur: 0.06, gain: 0.2, type: 'sine' }); blip({ freq: 2340, dur: 0.09, gain: 0.2, type: 'sine', delay: 0.06 }); },
  hurt() { burst({ dur: 0.12, freq: 300, gain: 0.3 }); },
  jump() { burst({ dur: 0.05, freq: 500, gain: 0.06 }); },
  land() { burst({ dur: 0.07, freq: 240, gain: 0.12 }); },
  throwNade() { burst({ dur: 0.08, freq: 900, gain: 0.1 }); },
  frag(dist = 0) { const g = att(dist); burst({ dur: 0.7, freq: 500, gain: 1.0 * g, slide: -420 }); burst({ dur: 0.3, freq: 150, gain: 0.8 * g }); },
  flash(dist = 0) { const g = att(dist); blip({ freq: 5200, dur: 0.25, gain: 0.3 * g, type: 'sine', slide: -2600 }); burst({ dur: 0.08, freq: 3000, gain: 0.3 * g }); },
  smoke(dist = 0) { burst({ dur: 0.4, freq: 800, gain: 0.18 * att(dist), slide: -500 }); },
  plantBeep(n) { blip({ freq: 1180, dur: 0.06, gain: 0.22 }); if (n) blip({ freq: 1180, dur: 0.06, gain: 0.22, delay: 0.12 }); },
  defuse() { blip({ freq: 760, dur: 0.08, gain: 0.2 }); },
  bombSite() { blip({ freq: 990, dur: 0.09, gain: 0.25 }); blip({ freq: 990, dur: 0.09, gain: 0.25, delay: 0.55 }); },
  explosion() { burst({ dur: 1.4, freq: 220, gain: 1.0, slide: -160 }); burst({ dur: 0.5, freq: 90, gain: 0.9 }); },
  buy() { blip({ freq: 1320, dur: 0.05, gain: 0.15 }); blip({ freq: 1760, dur: 0.07, gain: 0.15, delay: 0.05 }); },
  deny() { blip({ freq: 220, dur: 0.09, gain: 0.18 }); },
  roundWin() { [660, 880, 1100].forEach((f, i) => blip({ freq: f, dur: 0.12, gain: 0.18, delay: i * 0.09 })); },
  roundLose() { [440, 349, 262].forEach((f, i) => blip({ freq: f, dur: 0.14, gain: 0.18, delay: i * 0.1 })); },
  plantStart() { blip({ freq: 880, dur: 0.05, gain: 0.15 }); },
};
