// ============================================================================
// Mineblock — tiny procedural sound effects (WebAudio, no asset files)
//   sfx.play('dig' | 'place' | 'hurt' | 'splash' | 'pop' | 'portal' | 'click' | 'eat' | 'explode', pitch?)
// The AudioContext is created lazily on the first user gesture.
// ============================================================================
let ctx = null, master = null, noiseBuf = null, enabled = true, portalOsc = null;
function ensure() {
  if (ctx) return true;
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain(); master.gain.value = 0.35; master.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return true;
  } catch { return false; }
}
function noise(dur, freq, q, vol, type = 'lowpass', slide = 0) {
  const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
  const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
  if (slide) f.frequency.exponentialRampToValueAtTime(Math.max(40, freq * slide), ctx.currentTime + dur);
  const g = ctx.createGain(); g.gain.setValueAtTime(vol, ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
  src.connect(f); f.connect(g); g.connect(master); src.start(); src.stop(ctx.currentTime + dur + 0.05);
}
function tone(dur, f0, f1, vol, type = 'square') {
  const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f0, ctx.currentTime); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), ctx.currentTime + dur);
  const g = ctx.createGain(); g.gain.setValueAtTime(vol, ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
  o.connect(g); g.connect(master); o.start(); o.stop(ctx.currentTime + dur + 0.05);
}
export const sfx = {
  setEnabled(v) { enabled = v; if (!v) this.portalHum(false); },
  unlock() { if (ensure() && ctx.state === 'suspended') ctx.resume(); },
  play(name, pitch = 1) {
    if (!enabled || !ensure()) return;
    if (ctx.state === 'suspended') ctx.resume();
    switch (name) {
      case 'dig': noise(0.09, 900 * pitch, 1, 0.5); break;
      case 'place': noise(0.07, 500 * pitch, 2, 0.5); tone(0.05, 180 * pitch, 90, 0.15, 'triangle'); break;
      case 'hurt': tone(0.18, 300, 120, 0.3, 'sawtooth'); noise(0.12, 600, 1, 0.3); break;
      case 'splash': noise(0.35, 1800, 0.7, 0.45, 'bandpass', 0.3); break;
      case 'pop': tone(0.08, 500 * pitch, 900 * pitch, 0.2, 'sine'); break;
      case 'click': tone(0.03, 800, 600, 0.1, 'square'); break;
      case 'eat': noise(0.06, 1500, 2, 0.4); setTimeout(() => ctx && noise(0.06, 1300, 2, 0.4), 90); break;
      case 'explode': noise(0.6, 500, 0.5, 0.8, 'lowpass', 0.2); break;
      case 'portal': tone(1.2, 200, 500, 0.12, 'sine'); tone(1.2, 303, 700, 0.06, 'sine'); break;
      case 'zombie': tone(0.35, 110, 70, 0.22, 'sawtooth'); break;
      case 'pig': tone(0.12, 260 * pitch, 180 * pitch, 0.2, 'square'); break;
      case 'fire': noise(0.25, 2500, 1, 0.35, 'highpass'); break;
    }
  },
  portalHum(on) {
    if (!ensure()) return;
    if (on && !portalOsc && enabled) {
      portalOsc = ctx.createOscillator(); portalOsc.type = 'sine'; portalOsc.frequency.value = 90;
      const g = ctx.createGain(); g.gain.value = 0.12; portalOsc.connect(g); g.connect(master); portalOsc.start();
    } else if (!on && portalOsc) { portalOsc.stop(); portalOsc = null; }
  },
};
