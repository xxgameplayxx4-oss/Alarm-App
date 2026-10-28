// Steps mission: walk N steps. Pure detector + mission wrapper.

export class StepDetector {
  constructor({ minIntervalMs = 300, minAmplitude = 1.0, warmupMs = 500 } = {}) {
    this.minIntervalMs = minIntervalMs;
    this.minAmplitude = minAmplitude; // m/s^2 peak above baseline; rejects tiny wobbles
    this.warmupMs = warmupMs;
    this.reset();
  }
  reset() {
    this.t0 = null; this.lastT = null;
    this.lp = null;       // low-passed magnitude (~3 Hz)
    this.base = null;     // slow baseline (gravity/offset)
    this.env = 0;         // decaying envelope of |signal| for dynamic threshold
    this.p1 = 0; this.p2 = 0; this.p1t = 0; // previous two filtered values
    this.lastStep = -Infinity;
  }
  // t in ms. Returns true when a step is detected.
  push({ x, y, z, t }) {
    if ([x, y, z].some(v => typeof v !== 'number' || !isFinite(v))) return false;
    const m = Math.sqrt(x * x + y * y + z * z);
    if (this.lp === null) { this.lp = m; this.base = m; this.t0 = t; this.lastT = t; return false; }
    const dt = Math.max(0, t - this.lastT);
    this.lastT = t;
    this.lp += (dt / (50 + dt)) * (m - this.lp);
    this.base += (dt / (1000 + dt)) * (this.lp - this.base);
    const s = this.lp - this.base;
    this.env = Math.max(Math.abs(s), this.env * Math.exp(-dt / 2500));
    const thr = Math.max(this.minAmplitude, 0.4 * this.env);

    let step = false;
    // local maximum at previous sample
    if (this.p1 > this.p2 && this.p1 >= s && this.p1 > thr &&
        t - this.t0 >= this.warmupMs && this.p1t - this.lastStep >= this.minIntervalMs) {
      this.lastStep = this.p1t;
      step = true;
    }
    this.p2 = this.p1; this.p1 = s; this.p1t = t;
    return step;
  }
}

export default {
  id: 'steps',
  name: 'Steps',
  icon: '🚶',
  needs: 'motion',
  defaults: { count: 30 },
  settings: [
    { key: 'count', label: 'Steps', type: 'number', min: 10, max: 300 },
  ],
  mount(root, { config = {}, onProgress, onComplete, onStatus }) {
    const total = Math.max(1, Number(config.count) || 30);
    const det = new StepDetector();
    let count = 0, done = false, gotEvent = false, watchdog = null, bumpTimer = null;

    root.innerHTML = `
      <div class="m-motion m-steps">
        <div class="m-motion-walker" aria-hidden="true">🚶</div>
        <div class="m-motion-count"><span class="m-motion-num">0</span><span class="m-motion-of"> / ${total}</span></div>
        <div class="m-motion-bar"><div class="m-motion-fill"></div></div>
        <div class="m-motion-hint">Walk around, phone in hand</div>
      </div>`;
    const wrap = root.querySelector('.m-motion');
    const num = root.querySelector('.m-motion-num');
    const fill = root.querySelector('.m-motion-fill');

    function render() {
      num.textContent = String(count);
      fill.style.width = Math.min(100, (count / total) * 100) + '%';
      wrap.classList.add('m-bump');
      clearTimeout(bumpTimer);
      bumpTimer = setTimeout(() => wrap.classList.remove('m-bump'), 120);
    }

    function onMotion(e) {
      gotEvent = true;
      if (done) return;
      const a = e.accelerationIncludingGravity;
      if (!a) return;
      const t = typeof e.timeStamp === 'number' && e.timeStamp > 0 ? e.timeStamp : performance.now();
      if (det.push({ x: a.x, y: a.y, z: a.z, t })) {
        count++;
        render();
        onProgress && onProgress(count, total);
        if (count >= total) {
          done = true;
          stop();
          onComplete && onComplete();
        }
      }
    }

    function stop() {
      window.removeEventListener('devicemotion', onMotion);
      clearTimeout(watchdog);
      clearTimeout(bumpTimer);
    }

    return {
      async start() {
        onProgress && onProgress(0, total);
        onStatus && onStatus('Walk around, phone in hand');
        window.addEventListener('devicemotion', onMotion);
        watchdog = setTimeout(() => {
          if (!gotEvent && !done) {
            onStatus && onStatus('Motion access is blocked. On iPhone: Settings › Safari › Motion & Orientation Access, or reload this page and tap Allow.');
          }
        }, 3000);
      },
      stop,
    };
  },
};
