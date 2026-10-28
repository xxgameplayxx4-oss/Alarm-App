// Web Audio siren + success chime. No DOM/window access at import time.
export function createAlarm() {
  let ctx = null;
  let master = null;      // volume gain -> destination
  let comp = null;        // compressor feeding master
  let volume = 0.8;
  let playing = false;
  let nodes = [];         // siren nodes for the current run
  let hooked = false;

  const AC = () => (typeof globalThis !== 'undefined' && (globalThis.AudioContext || globalThis.webkitAudioContext)) || null;

  function ensureContext() {
    if (ctx && ctx.state !== 'closed') return ctx;
    const Ctor = AC();
    if (!Ctor) return null;
    ctx = new Ctor({ latencyHint: 'interactive' });
    comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -20;
    comp.knee.value = 12;
    comp.ratio.value = 12;
    comp.attack.value = 0.003;
    comp.release.value = 0.15;
    master = ctx.createGain();
    master.gain.value = volume;
    comp.connect(master);
    master.connect(ctx.destination);
    ctx.onstatechange = () => { if (playing) tryResume(); };
    hookLifecycle();
    return ctx;
  }

  function tryResume() {
    if (!ctx || ctx.state === 'closed' || ctx.state === 'running') return Promise.resolve();
    // 'interrupted' is a Safari-only state (calls, Siri, etc.); resume() works for it too.
    try { return ctx.resume().catch(() => {}); } catch (e) { return Promise.resolve(); }
  }

  function hookLifecycle() {
    if (hooked || typeof document === 'undefined') return;
    hooked = true;
    const wake = () => { if (ctx) tryResume(); };
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') wake(); });
    if (typeof window !== 'undefined') {
      window.addEventListener('pageshow', wake);
      window.addEventListener('focus', wake);
    }
    // Last resort: any touch while the siren should be playing re-resumes the context.
    ['touchend', 'pointerdown', 'click'].forEach((ev) =>
      document.addEventListener(ev, () => { if (playing) wake(); }, { passive: true, capture: true }));
  }

  async function unlock() {
    const c = ensureContext();
    if (!c) return;
    try {
      const buf = c.createBuffer(1, 1, 22050);
      const src = c.createBufferSource();
      src.buffer = buf;
      src.connect(c.destination);
      src.start(0);
    } catch (e) { /* ignore */ }
    try { await c.resume(); } catch (e) { /* ignore */ }
  }

  function osc(type, freq) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    nodes.push(o);
    return o;
  }
  function gain(v) {
    const g = ctx.createGain();
    g.gain.value = v;
    nodes.push(g);
    return g;
  }

  function start() {
    if (playing) return;
    const c = ensureContext();
    if (!c) return;
    playing = true;
    tryResume();
    nodes = [];

    // Pulsing amplitude: 0.65 +/- 0.35 at ~7 Hz.
    const pulse = gain(0.65);
    const pulseLfo = osc('sine', 7);
    const pulseDepth = gain(0.35);
    pulseLfo.connect(pulseDepth).connect(pulse.gain);
    pulse.connect(comp);

    // Alternation gate: slow square LFO, A on while B off and vice versa.
    const gateLfo = osc('square', 1.1);
    const gateA = gain(0.5), gateB = gain(0.5);
    const gateDepthA = gain(0.5), gateDepthB = gain(-0.5);
    gateLfo.connect(gateDepthA).connect(gateA.gain);
    gateLfo.connect(gateDepthB).connect(gateB.gain);

    // Voice A: sawtooth sweeping 600..1400 Hz (+ detuned partner for harshness).
    // Voice B: square sweeping the opposite way, an octave-ish higher in character.
    const sweep = osc('sine', 2.2);                // shared sweep LFO
    const sweepA = gain(400);
    const sweepB = gain(-300);
    sweep.connect(sweepA);
    sweep.connect(sweepB);

    const a1 = osc('sawtooth', 1000), a2 = osc('sawtooth', 1006);
    sweepA.connect(a1.frequency); sweepA.connect(a2.frequency);
    const aMix = gain(0.28);
    a1.connect(aMix); a2.connect(aMix);
    aMix.connect(gateA);

    const b1 = osc('square', 1500), b2 = osc('sawtooth', 750);
    sweepB.connect(b1.frequency);
    const sweepB2 = gain(-150);
    sweep.connect(sweepB2); sweepB2.connect(b2.frequency);
    const bMix = gain(0.2);
    b1.connect(bMix); b2.connect(bMix);
    bMix.connect(gateB);

    gateA.connect(pulse);
    gateB.connect(pulse);

    const t = c.currentTime + 0.02;
    nodes.forEach((n) => { if (n.start) { try { n.start(t); } catch (e) {} } });
    master.gain.cancelScheduledValues(c.currentTime);
    master.gain.setValueAtTime(volume, c.currentTime);
  }

  function stop() {
    playing = false;
    if (!ctx) return;
    const old = nodes;
    nodes = [];
    try {
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.setValueAtTime(0, ctx.currentTime); // instant silence
    } catch (e) {}
    old.forEach((n) => {
      try { if (n.stop) n.stop(0); } catch (e) {}
      try { n.disconnect(); } catch (e) {}
    });
    try {
      // restore volume for later sounds (chime/test) once the siren graph is gone
      master.gain.setValueAtTime(volume, ctx.currentTime + 0.05);
    } catch (e) {}
  }

  function setVolume(v) {
    volume = Math.max(0, Math.min(1, Number(v) || 0));
    if (ctx && master) master.gain.setTargetAtTime(volume, ctx.currentTime, 0.01);
  }

  function playSuccess() {
    const c = ensureContext();
    if (!c) return;
    tryResume();
    const out = c.createGain();
    out.gain.value = Math.max(0.3, volume) * 0.5;
    out.connect(c.destination);
    const notes = [523.25, 659.25, 783.99, 1046.5];
    const t0 = c.currentTime + 0.05;
    notes.forEach((f, i) => {
      const t = t0 + i * 0.12;
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = 'sine';
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.6, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + (i === notes.length - 1 ? 0.9 : 0.4));
      o.connect(g).connect(out);
      o.start(t);
      o.stop(t + 1);
    });
  }

  return {
    unlock, start, stop, setVolume, playSuccess,
    get isPlaying() { return playing; },
    get contextState() { return ctx ? ctx.state : 'none'; },
    get isRunning() { return !!ctx && ctx.state === 'running'; },
  };
}
