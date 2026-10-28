// Shake mission: shake the phone N times. Pure detector + mission wrapper.

export const SHAKE_THRESHOLDS = { low: 18, medium: 12, high: 7 }; // m/s^2 of gravity-removed magnitude

export class ShakeDetector {
  constructor({ sensitivity = 'medium', threshold, refractoryMs = 250 } = {}) {
    this.threshold = threshold ?? SHAKE_THRESHOLDS[sensitivity] ?? SHAKE_THRESHOLDS.medium;
    this.refractoryMs = refractoryMs;
    this.tau = 500; // ms, gravity low-pass time constant (high-pass = raw - gravity)
    this.g = null;
    this.lastT = null;
    this.lastShake = -Infinity;
  }
  // t in ms. Returns true when a new shake is counted.
  push({ x, y, z, t }) {
    if ([x, y, z].some(v => typeof v !== 'number' || !isFinite(v))) return false;
    if (!this.g) { this.g = { x, y, z }; this.lastT = t; return false; }
    const dt = Math.max(0, t - this.lastT);
    this.lastT = t;
    const a = dt / (this.tau + dt);
    const g = this.g;
    const dx = x - g.x, dy = y - g.y, dz = z - g.z;
    g.x += a * dx; g.y += a * dy; g.z += a * dz;
    const mag = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (mag > this.threshold && t - this.lastShake >= this.refractoryMs) {
      this.lastShake = t;
      return true;
    }
    return false;
  }
  reset() { this.g = null; this.lastT = null; this.lastShake = -Infinity; }
}

export default {
  id: 'shake',
  name: 'Shake',
  icon: '📳',
  needs: 'motion',
  defaults: { count: 30, sensitivity: 'medium' },
  settings: [
    { key: 'count', label: 'Shakes', type: 'number', min: 5, max: 200 },
    { key: 'sensitivity', label: 'Sensitivity', type: 'select', options: ['low', 'medium', 'high'] },
  ],
  mount(root, { config = {}, onProgress, onComplete, onStatus }) {
    const total = Math.max(1, Number(config.count) || 30);
    const det = new ShakeDetector({ sensitivity: config.sensitivity || 'medium' });
    let count = 0, done = false, gotEvent = false, watchdog = null, bumpTimer = null;

    root.innerHTML = `
      <div class="m-motion m-shake">
        <div class="m-motion-phone" aria-hidden="true">📱</div>
        <div class="m-motion-count"><span class="m-motion-num">0</span><span class="m-motion-of"> / ${total}</span></div>
        <div class="m-motion-bar"><div class="m-motion-fill"></div></div>
        <div class="m-motion-hint">Shake your phone!</div>
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
        onStatus && onStatus('Shake your phone!');
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
