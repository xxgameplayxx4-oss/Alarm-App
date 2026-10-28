// pose.js — push-up detection on top of MediaPipe PoseLandmarker.
//
// Two layers:
//   1. Pure logic (angle, RepCounter): no DOM, importable from node for unit tests.
//   2. createPushupTracker(): camera + MediaPipe + canvas drawing (browser only).
//      The vendor bundle is imported lazily inside start() so node never touches it.

// ---------------------------------------------------------------------------
// Landmark indices (MediaPipe Pose, 33 points)
// ---------------------------------------------------------------------------
const NOSE = 0;
const L_SHOULDER = 11, R_SHOULDER = 12;
const L_ELBOW = 13, R_ELBOW = 14;
const L_WRIST = 15, R_WRIST = 16;
const L_HIP = 23, R_HIP = 24;
const L_KNEE = 25, R_KNEE = 26;
const L_ANKLE = 27, R_ANKLE = 28;

// Per-exercise joint triples (vertex is the middle one) for the primary angle signal.
const JOINTS = {
  pushup: [[L_SHOULDER, L_ELBOW, L_WRIST], [R_SHOULDER, R_ELBOW, R_WRIST]],
  squat: [[L_HIP, L_KNEE, L_ANKLE], [R_HIP, R_KNEE, R_ANKLE]],
};

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------
export const DEFAULTS = {
  minVisibility: 0.5,   // landmark visibility below this is ignored
  minRepMs: 400,        // minimum time between two counted reps
  armHoldMs: 600,       // keep arm state this long when the arm briefly disappears
  aspect: 1,            // video width/height, so x and y distances are comparable

  // Primary signal: elbow angle (degrees) with hysteresis.
  downAngle: 100,       // below this = bottom of push-up
  upAngle: 150,         // above this = arms extended again
  armSmoothing: 0.5,    // EMA alpha (higher = less smoothing)

  // Fallback signal: vertical head/shoulder position in shoulder-width units,
  // measured as displacement from an auto-calibrated "up" baseline.
  headDown: 0.2,        // displacement beyond this = down
  headUp: 0.08,         // displacement back under this = up
  headSmoothing: 0.4,
  headCalibFrames: 8,   // valid frames used to establish the initial baseline
};

// Squat overrides: knee angle is the primary signal; the fallback is hip-midpoint
// vertical displacement in torso lengths.
export const SQUAT_DEFAULTS = {
  downAngle: 100,
  upAngle: 160,
  headDown: 0.2,
  headUp: 0.08,
};

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** Angle in degrees at point b formed by a-b-c (2D, using x/y). NaN if degenerate. */
export function angle(a, b, c) {
  const v1x = a.x - b.x, v1y = a.y - b.y;
  const v2x = c.x - b.x, v2y = c.y - b.y;
  const n1 = Math.hypot(v1x, v1y), n2 = Math.hypot(v2x, v2y);
  if (n1 < 1e-9 || n2 < 1e-9) return NaN;
  const cos = Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / (n1 * n2)));
  return (Math.acos(cos) * 180) / Math.PI;
}

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const vis = (p) => (p && typeof p.visibility === 'number' ? p.visibility : 1);

/**
 * Counts push-up reps from a stream of pose landmark frames.
 * A rep = down then up. Uses the elbow angle when an arm is visible,
 * otherwise falls back to vertical head movement.
 */
export class RepCounter {
  constructor(options = {}) {
    this.exercise = options.exercise === 'squat' ? 'squat' : 'pushup';
    this.cfg = { ...DEFAULTS, ...(this.exercise === 'squat' ? SQUAT_DEFAULTS : null), ...options };
    this.reset();
  }

  reset() {
    this.count = 0;
    this.lastRepT = -Infinity;
    this.lastArmValidT = -Infinity;
    this.source = null;        // 'arm' | 'head' | null
    this.phase = 'unknown';    // 'unknown' | 'up' | 'down'
    this.progress = 0;
    this.shoulderWidth = null; // smoothed scale (shoulder width, or torso length for squats), aspect-corrected
    this._resetArm();
    this._resetHead();
  }

  _resetArm() { this.arm = { phase: null, ema: null }; }
  _resetHead() { this.head = { phase: null, ema: null, baseline: null, calib: [], kind: null }; }

  /**
   * @param sample either `{landmarks, timestamp}` (also accepts `t`) or a bare landmark array
   * @param t      timestamp in ms (only needed when `sample` is a bare array)
   * @returns {{repCompleted:boolean, phase:string, progress:number, visible:boolean, source:string|null, count:number}}
   */
  update(sample, t) {
    const landmarks = Array.isArray(sample) ? sample : sample && sample.landmarks;
    if (!Array.isArray(sample) && sample) t = sample.timestamp ?? sample.t ?? t;
    if (!landmarks || landmarks.length < 17 || !Number.isFinite(t)) return this._result(false, false);

    const cfg = this.cfg;
    this._updateScale(landmarks);

    // --- Primary: best-visibility arm -------------------------------------
    const armAngle = this._armAngle(landmarks);
    if (armAngle !== null) {
      this.lastArmValidT = t;
      if (this.source !== 'arm') { this.source = 'arm'; this._resetHead(); }
      return this._result(this._stepArm(armAngle, t), true);
    }
    // Arm just flickered out: hold state rather than switching signals.
    if (t - this.lastArmValidT < cfg.armHoldMs) return this._result(false, false);

    // --- Fallback: vertical head/shoulder motion --------------------------
    const headY = this._headSignal(landmarks);
    if (headY !== null) {
      if (this.source !== 'head') { this.source = 'head'; this._resetArm(); }
      return this._result(this._stepHead(headY, t), true);
    }
    return this._result(false, false);
  }

  // Track the normalising scale with a slow EMA; keeps the last value when landmarks vanish.
  // Push-ups: shoulder width. Squats: torso length (shoulder midpoint to hip midpoint).
  _updateScale(lm) {
    if (this.exercise === 'squat') {
      const ids = [L_SHOULDER, R_SHOULDER, L_HIP, R_HIP];
      if (ids.some((i) => vis(lm[i]) < this.cfg.minVisibility)) return;
      const a = this.cfg.aspect;
      const dx = ((lm[L_SHOULDER].x + lm[R_SHOULDER].x) - (lm[L_HIP].x + lm[R_HIP].x)) / 2 * a;
      const dy = ((lm[L_SHOULDER].y + lm[R_SHOULDER].y) - (lm[L_HIP].y + lm[R_HIP].y)) / 2;
      const len = Math.hypot(dx, dy);
      if (len < 0.03) return;
      this.shoulderWidth = this.shoulderWidth === null ? len : this.shoulderWidth * 0.9 + len * 0.1;
      return;
    }
    const l = lm[L_SHOULDER], r = lm[R_SHOULDER];
    if (vis(l) < this.cfg.minVisibility || vis(r) < this.cfg.minVisibility) return;
    const w = Math.abs(l.x - r.x) * this.cfg.aspect;
    if (w < 0.03) return; // side view: shoulders overlap, width is meaningless
    this.shoulderWidth = this.shoulderWidth === null ? w : this.shoulderWidth * 0.9 + w * 0.1;
  }

  // Elbow (push-up) or knee (squat) angle of the more visible side, or null if neither is reliable.
  _armAngle(lm) {
    const sides = JOINTS[this.exercise];
    let best = null, bestVis = -1;
    for (const [s, e, w] of sides) {
      const v = Math.min(vis(lm[s]), vis(lm[e]), vis(lm[w]));
      if (v > bestVis) { bestVis = v; best = [s, e, w]; }
    }
    if (bestVis < this.cfg.minVisibility) return null;
    const a = this.cfg.aspect;
    const p = best.map((i) => ({ x: lm[i].x * a, y: lm[i].y }));
    const deg = angle(p[0], p[1], p[2]);
    return Number.isFinite(deg) ? deg : null;
  }

  // Vertical position in scale units. Down = larger.
  // Push-ups: nose, else shoulder midpoint. Squats: hip midpoint.
  _headSignal(lm) {
    if (!this.shoulderWidth) return null;
    let y, kind;
    if (this.exercise === 'squat') {
      if (vis(lm[L_HIP]) < this.cfg.minVisibility || vis(lm[R_HIP]) < this.cfg.minVisibility) return null;
      y = (lm[L_HIP].y + lm[R_HIP].y) / 2; kind = 'hips';
    } else if (vis(lm[NOSE]) >= this.cfg.minVisibility) {
      y = lm[NOSE].y; kind = 'nose';
    } else if (vis(lm[L_SHOULDER]) >= this.cfg.minVisibility && vis(lm[R_SHOULDER]) >= this.cfg.minVisibility) {
      y = (lm[L_SHOULDER].y + lm[R_SHOULDER].y) / 2; kind = 'shoulders';
    } else return null;
    if (this.head.kind && this.head.kind !== kind) this._resetHead(); // baseline no longer comparable
    this.head.kind = kind;
    return y / this.shoulderWidth;
  }

  _stepArm(deg, t) {
    const { downAngle, upAngle, armSmoothing } = this.cfg;
    const s = this.arm;
    s.ema = s.ema === null ? deg : armSmoothing * deg + (1 - armSmoothing) * s.ema;
    this.progress = clamp01((upAngle - s.ema) / (upAngle - downAngle));
    return this._transition(s, s.ema > upAngle, s.ema < downAngle, t);
  }

  _stepHead(y, t) {
    const { headDown, headUp, headSmoothing, headCalibFrames } = this.cfg;
    const s = this.head;
    s.ema = s.ema === null ? y : headSmoothing * y + (1 - headSmoothing) * s.ema;

    // Calibration: average the first frames as the "up" baseline.
    if (s.baseline === null) {
      s.calib.push(s.ema);
      if (s.calib.length < headCalibFrames) { this.phase = 'unknown'; this.progress = 0; return false; }
      s.baseline = s.calib.reduce((a, b) => a + b, 0) / s.calib.length;
      s.phase = 'up';
    }
    const dev = s.ema - s.baseline;
    this.progress = clamp01(dev / headDown);

    // While up, keep the baseline following the resting position:
    // snap quickly toward a higher head, drift slowly otherwise.
    if (s.phase === 'up' && dev < headDown * 0.6) {
      s.baseline += (dev < 0 ? 0.2 : 0.03) * dev;
    }
    return this._transition(s, dev < headUp, dev > headDown, t);
  }

  // Shared hysteresis state machine. Returns true when a rep completes.
  _transition(s, isUp, isDown, t) {
    let rep = false;
    if (s.phase === null) {
      if (isUp) s.phase = 'up'; // must see the top before arming
    } else if (s.phase === 'up') {
      if (isDown) s.phase = 'down';
    } else if (isUp) {
      s.phase = 'up';
      if (t - this.lastRepT >= this.cfg.minRepMs) {
        this.lastRepT = t;
        this.count++;
        rep = true;
      }
    }
    this.phase = s.phase || 'unknown';
    return rep;
  }

  _result(repCompleted, visible) {
    return {
      repCompleted, visible, phase: this.phase, progress: visible ? this.progress : 0,
      source: this.source, count: this.count,
    };
  }
}

// ---------------------------------------------------------------------------
// Browser tracker
// ---------------------------------------------------------------------------

const WASM_URL = new URL('../vendor/wasm', import.meta.url).href;
const MODEL_URL = new URL('../vendor/pose_landmarker_lite.task', import.meta.url).href;
const BUNDLE_URL = '../vendor/vision_bundle.mjs';

/**
 * Creates a push-up or squat tracker (`exercise: 'pushup' | 'squat'`) bound to a <video> and an overlay <canvas>.
 * The canvas is drawn mirrored to match a CSS-mirrored selfie video, so do NOT
 * also mirror the canvas via CSS.
 * Callbacks: onRep(count), onStatus(text), onFrame({visible, phase, progress}).
 */
export async function createRepTracker({ videoEl, canvasEl, onRep, onStatus, onFrame, mirror = true, exercise = 'pushup' } = {}) {
  const squat = exercise === 'squat';
  const counter = new RepCounter({ exercise });
  let landmarker = null, drawing = null, ctx = null, mod = null;
  let stream = null, rafId = 0, running = false, lastVideoTime = -1, lastStatus = '', everVisible = false;

  const status = (text) => {
    if (text !== lastStatus) { lastStatus = text; onStatus && onStatus(text); }
  };

  async function loadLandmarker() {
    if (landmarker) return;
    status('Loading model…');
    mod = await import(BUNDLE_URL);
    const fileset = await mod.FilesetResolver.forVisionTasks(WASM_URL);
    const make = (delegate) => mod.PoseLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL_URL, delegate },
      runningMode: 'VIDEO',
      numPoses: 1,
    });
    try { landmarker = await make('GPU'); } catch (e) { landmarker = await make('CPU'); }
  }

  function draw(landmarks) {
    const { width, height } = canvasEl;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, width, height);
    if (!landmarks) return;
    if (mirror) ctx.setTransform(-1, 0, 0, 1, width, 0);
    drawing.drawConnectors(landmarks, mod.PoseLandmarker.POSE_CONNECTIONS, { color: '#00e676', lineWidth: 4 });
    drawing.drawLandmarks(landmarks, { color: '#ffffff', fillColor: '#ff1744', radius: 4 });
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  function coach(r) {
    if (!r.visible) return status(everVisible ? 'Body not visible' : 'Get in frame');
    everVisible = true;
    if (r.phase === 'down') status(squat ? 'Stand up' : 'Push up!');
    else status(squat ? 'Squat down' : 'Go down');
  }

  function loop() {
    if (!running) return;
    rafId = requestAnimationFrame(loop);
    if (videoEl.readyState < 2 || videoEl.currentTime === lastVideoTime) return;
    lastVideoTime = videoEl.currentTime;
    const now = performance.now();

    let landmarks = null;
    try {
      const result = landmarker.detectForVideo(videoEl, now);
      landmarks = result.landmarks && result.landmarks[0] ? result.landmarks[0] : null;
    } catch (e) { /* skip a bad frame */ }

    draw(landmarks);
    const r = landmarks ? counter.update({ landmarks, timestamp: now }) : { visible: false, phase: counter.phase, progress: 0, repCompleted: false };
    coach(r);
    if (onFrame) onFrame({ visible: r.visible, phase: r.phase, progress: r.progress });
    if (r.repCompleted && onRep) onRep(counter.count);
  }

  return {
    async start() {
      if (running) return;
      status('Starting camera…');
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
      videoEl.muted = true;
      videoEl.playsInline = true;
      videoEl.srcObject = stream;
      try {
        if (videoEl.readyState < 1) await new Promise((res) => videoEl.addEventListener('loadedmetadata', res, { once: true }));
        await videoEl.play();
      } catch (e) { this.stop(); throw e; }

      canvasEl.width = videoEl.videoWidth || 640;
      canvasEl.height = videoEl.videoHeight || 480;
      ctx = canvasEl.getContext('2d');
      counter.cfg.aspect = canvasEl.width / canvasEl.height;

      try { await loadLandmarker(); } catch (e) { this.stop(); status('Could not load model'); throw e; }
      drawing = new mod.DrawingUtils(ctx);

      running = true;
      lastVideoTime = -1;
      everVisible = false;
      status('Get in frame');
      loop();
    },
    stop() {
      running = false;
      cancelAnimationFrame(rafId);
      if (stream) stream.getTracks().forEach((t) => t.stop());
      stream = null;
      if (videoEl) videoEl.srcObject = null;
      if (ctx) { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvasEl.width, canvasEl.height); }
    },
    reset() { counter.reset(); counter.cfg.aspect = counter.cfg.aspect || 1; },
    get count() { return counter.count; },
  };
}

/** Back-compat alias: defaults to push-ups, accepts the same `exercise` option. */
export const createPushupTracker = createRepTracker;
