// Run with: node tests/pose.test.mjs
import assert from 'node:assert/strict';
import { angle, RepCounter } from '../js/pose.js';

const FRAME_MS = 33;

// --- synthetic landmark builders -------------------------------------------
function blank(v = 0.99) {
  return Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: v }));
}
// Front-ish pose with both arms bent to `deg` at the elbow.
function armFrame(deg, { visibility = 0.99, rightVis } = {}) {
  const lm = blank(visibility);
  lm[11] = { x: 0.65, y: 0.3, z: 0, visibility }; lm[12] = { x: 0.35, y: 0.3, z: 0, visibility: rightVis ?? visibility };
  const rad = (deg * Math.PI) / 180;
  const arm = (sx, i, v) => {
    lm[i + 2] = { x: sx, y: 0.5, z: 0, visibility: v };                                   // elbow
    lm[i + 4] = { x: sx + 0.2 * Math.sin(rad), y: 0.5 - 0.2 * Math.cos(rad), z: 0, visibility: v }; // wrist
  };
  // shoulder at (sx, 0.3), elbow 0.2 below it; wrist rotated by deg from the upper arm
  arm(0.65, 11, visibility); arm(0.35, 12, rightVis ?? visibility);
  lm[0] = { x: 0.5, y: 0.2, z: 0, visibility: 0.99 };
  return lm;
}
// Arms invisible; only nose + shoulders (width 0.3) are tracked.
function headFrame(noseY) {
  const lm = blank(0.1);
  lm[0] = { x: 0.5, y: noseY, z: 0, visibility: 0.99 };
  lm[11] = { x: 0.65, y: 0.4, z: 0, visibility: 0.99 };
  lm[12] = { x: 0.35, y: 0.4, z: 0, visibility: 0.99 };
  return lm;
}

// Cosine dip: 1 at start/end, 0 mid-rep. Returns value in [lo, hi] going hi -> lo -> hi.
const dip = (u, hi, lo) => lo + (hi - lo) * (0.5 + 0.5 * Math.cos(2 * Math.PI * u));

// Feeds a series of frames; returns {counter, reps, t}.
function run(frames, counter = new RepCounter(), t0 = 0) {
  let t = t0, reps = 0;
  for (const lm of frames) {
    if (counter.update({ landmarks: lm, timestamp: t }).repCompleted) reps++;
    t += FRAME_MS;
  }
  return { counter, reps, t };
}
function repAngles(n, { hi = 170, lo = 80, frames = 36, restFrames = 10 } = {}) {
  const out = [];
  for (let i = 0; i < restFrames; i++) out.push(hi);
  for (let r = 0; r < n; r++) for (let f = 0; f < frames; f++) out.push(dip(f / frames, hi, lo));
  for (let i = 0; i < restFrames; i++) out.push(hi);
  return out;
}
// deterministic pseudo-random noise in [-1, 1]
function rng(seed = 1) { return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32) * 2 - 1; }

// Squat builders: hip (0.5,0.5), knee 0.2 below hip, ankle rotated so the knee angle = deg.
function kneeFrame(deg, { visibility = 0.99, hipY = 0.5 } = {}) {
  const lm = blank(visibility);
  const rad = (deg * Math.PI) / 180;
  lm[11] = { x: 0.6, y: hipY - 0.3, z: 0, visibility: 0.99 }; lm[12] = { x: 0.4, y: hipY - 0.3, z: 0, visibility: 0.99 };
  for (const [sx, h] of [[0.6, 23], [0.4, 24]]) {
    lm[h] = { x: sx, y: hipY, z: 0, visibility };
    lm[h + 2] = { x: sx, y: hipY + 0.2, z: 0, visibility };
    lm[h + 4] = { x: sx + 0.2 * Math.sin(rad), y: hipY + 0.2 - 0.2 * Math.cos(rad), z: 0, visibility };
  }
  return lm;
}
// Legs invisible; shoulders+hips tracked (torso length 0.3).
function hipFrame(hipY) {
  const lm = blank(0.1);
  lm[11] = { x: 0.6, y: hipY - 0.3, z: 0, visibility: 0.99 }; lm[12] = { x: 0.4, y: hipY - 0.3, z: 0, visibility: 0.99 };
  lm[23] = { x: 0.58, y: hipY, z: 0, visibility: 0.99 }; lm[24] = { x: 0.42, y: hipY, z: 0, visibility: 0.99 };
  return lm;
}
const squatCounter = () => new RepCounter({ exercise: 'squat' });

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

// --- tests -----------------------------------------------------------------
test('angle(): right angle, straight line, acute, degenerate', () => {
  assert.ok(Math.abs(angle({ x: 0, y: 1 }, { x: 0, y: 0 }, { x: 1, y: 0 }) - 90) < 1e-9);
  assert.ok(Math.abs(angle({ x: -1, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 }) - 180) < 1e-9);
  assert.ok(Math.abs(angle({ x: 1, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 1 }) - 45) < 1e-9);
  assert.ok(Number.isNaN(angle({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 1 })));
});

test('armFrame builder produces the intended elbow angle', () => {
  const lm = armFrame(100);
  assert.ok(Math.abs(angle(lm[11], lm[13], lm[15]) - 100) < 1e-6);
});

test('clean 5-rep elbow sequence counts exactly 5', () => {
  const { counter, reps } = run(repAngles(5).map((d) => armFrame(d)));
  assert.equal(reps, 5);
  assert.equal(counter.count, 5);
  assert.equal(counter.source, 'arm');
});

test('rep result reports phase/progress while moving', () => {
  const c = new RepCounter();
  let r;
  for (let i = 0; i < 5; i++) r = c.update({ landmarks: armFrame(170), timestamp: i * FRAME_MS });
  assert.equal(r.phase, 'up'); assert.equal(r.progress, 0); assert.equal(r.visible, true);
  for (let i = 5; i < 15; i++) r = c.update({ landmarks: armFrame(70), timestamp: i * FRAME_MS });
  assert.equal(r.phase, 'down'); assert.equal(r.progress, 1);
});

test('starting in the bottom position does not count until the top is seen', () => {
  const frames = [...Array(10).fill(80), ...Array(10).fill(170)].map((d) => armFrame(d));
  assert.equal(run(frames).reps, 0);
});

test('half reps (never reaching down threshold) are not counted', () => {
  const { reps } = run(repAngles(4, { hi: 170, lo: 120 }).map((d) => armFrame(d)));
  assert.equal(reps, 0);
});

test('jitter around thresholds does not double count', () => {
  const noise = rng(7);
  const seq = [];
  const hold = (center, n, amp) => { for (let i = 0; i < n; i++) seq.push(center + noise() * amp); };
  for (let rep = 0; rep < 3; rep++) {
    hold(170, 12, 4);
    for (let a = 170; a > 105; a -= 8) seq.push(a);   // descend
    hold(100, 40, 8);                                  // jitter on the down threshold
    for (let a = 100; a < 145; a += 6) seq.push(a);    // ascend
    hold(150, 40, 8);                                  // jitter on the up threshold
    hold(170, 12, 4);
  }
  const { reps } = run(seq.map((d) => armFrame(d)));
  assert.equal(reps, 3);
});

test('min rep duration: two completions within 400ms count once', () => {
  // 5-frame (165ms) down/up flicks; the second completes <400ms after the first
  const flick = [80, 80, 80, 170, 170, 170];
  const frames = [...Array(8).fill(170), ...flick, ...flick, ...Array(30).fill(170)].map((d) => armFrame(d));
  const { reps } = run(frames, new RepCounter({ armSmoothing: 1 }));
  assert.equal(reps, 1);
});

test('low-visibility frames are ignored (garbage angles do not count)', () => {
  const frames = [];
  for (const d of repAngles(4, { frames: 40 })) {
    frames.push(armFrame(d));
    // every real frame is followed by a junk, low-visibility frame with wild angle
    frames.push(armFrame(d > 130 ? 60 : 175, { visibility: 0.1 }));
  }
  // low-vis frames are 33ms apart too; keep timing consistent
  const { reps, counter } = run(frames);
  assert.equal(reps, 4);
  assert.equal(counter.count, 4);
});

test('all-low-visibility stream reports not visible and counts nothing', () => {
  const c = new RepCounter();
  let r;
  const frames = repAngles(3).map((d) => armFrame(d, { visibility: 0.1 }).map((p) => ({ ...p, visibility: 0.1 })));
  frames.forEach((lm, i) => { r = c.update({ landmarks: lm, timestamp: i * FRAME_MS }); });
  assert.equal(r.visible, false);
  assert.equal(c.count, 0);
});

test('picks the higher-visibility arm', () => {
  // right arm hidden with junk angle; left arm does clean reps
  const frames = repAngles(3).map((d) => {
    const lm = armFrame(d, { rightVis: 0.2 });
    return lm;
  });
  assert.equal(run(frames).reps, 3);
});

test('fallback: front-view head bobbing, arms invisible, counts 6 (with baseline drift)', () => {
  const frames = [];
  for (let i = 0; i < 20; i++) frames.push(headFrame(0.2));
  for (let r = 0; r < 6; r++) {
    const rest = 0.2 + r * 0.004; // slow drift of the resting position
    for (let f = 0; f < 36; f++) frames.push(headFrame(dip(f / 36, rest, rest + 0.15)));
  }
  for (let i = 0; i < 10; i++) frames.push(headFrame(0.22));
  const { reps, counter } = run(frames);
  assert.equal(reps, 6);
  assert.equal(counter.source, 'head');
});

test('fallback: noise on nose position does not double count', () => {
  const noise = rng(3);
  const frames = [];
  for (let i = 0; i < 20; i++) frames.push(headFrame(0.2 + noise() * 0.004));
  for (let r = 0; r < 4; r++) for (let f = 0; f < 40; f++) frames.push(headFrame(dip(f / 40, 0.2, 0.35) + noise() * 0.004));
  assert.equal(run(frames).reps, 4);
});

test('fallback: calibrates to wherever the "up" position is', () => {
  const frames = [];
  for (let i = 0; i < 20; i++) frames.push(headFrame(0.55));
  for (let r = 0; r < 3; r++) for (let f = 0; f < 36; f++) frames.push(headFrame(dip(f / 36, 0.55, 0.7)));
  assert.equal(run(frames).reps, 3);
});

test('reset() clears count and state', () => {
  const { counter } = run(repAngles(2).map((d) => armFrame(d)));
  assert.equal(counter.count, 2);
  counter.reset();
  assert.equal(counter.count, 0);
  assert.equal(counter.phase, 'unknown');
});

test('bare-array sample with separate timestamp is accepted', () => {
  const c = new RepCounter();
  let reps = 0, t = 0;
  for (const d of repAngles(2)) { if (c.update(armFrame(d), t).repCompleted) reps++; t += FRAME_MS; }
  assert.equal(reps, 2);
});

test('squat: clean 5-rep knee sequence counts 5', () => {
  const { counter, reps } = run(repAngles(5, { hi: 175, lo: 70 }).map((d) => kneeFrame(d)), squatCounter());
  assert.equal(reps, 5);
  assert.equal(counter.source, 'arm');
});

test('squat: knee angle at 130 (shallow) is not a rep', () => {
  assert.equal(run(repAngles(4, { hi: 175, lo: 130 }).map((d) => kneeFrame(d)), squatCounter()).reps, 0);
});

test('squat: jitter around thresholds does not double count', () => {
  const noise = rng(11);
  const seq = [];
  const hold = (c, n, amp) => { for (let i = 0; i < n; i++) seq.push(c + noise() * amp); };
  for (let rep = 0; rep < 3; rep++) {
    hold(175, 12, 3);
    for (let a = 175; a > 105; a -= 8) seq.push(a);
    hold(100, 40, 8);
    for (let a = 100; a < 155; a += 6) seq.push(a);
    hold(160, 40, 8);
    hold(175, 12, 3);
  }
  assert.equal(run(seq.map((d) => kneeFrame(d)), squatCounter()).reps, 3);
});

test('squat: low-visibility junk frames ignored', () => {
  const frames = [];
  for (const d of repAngles(4, { hi: 175, lo: 70, frames: 40 })) {
    frames.push(kneeFrame(d));
    frames.push(kneeFrame(d > 130 ? 60 : 178, { visibility: 0.1 }));
  }
  assert.equal(run(frames, squatCounter()).reps, 4);
});

test('squat fallback: hip drop with legs invisible counts 5', () => {
  const frames = [];
  for (let i = 0; i < 20; i++) frames.push(hipFrame(0.5));
  for (let r = 0; r < 5; r++) for (let f = 0; f < 40; f++) frames.push(hipFrame(dip(f / 40, 0.5, 0.65)));
  for (let i = 0; i < 10; i++) frames.push(hipFrame(0.5));
  const { reps, counter } = run(frames, squatCounter());
  assert.equal(reps, 5);
  assert.equal(counter.source, 'head');
});

test('squat fallback: noise does not double count', () => {
  const noise = rng(5);
  const frames = [];
  for (let i = 0; i < 20; i++) frames.push(hipFrame(0.5 + noise() * 0.003));
  for (let r = 0; r < 4; r++) for (let f = 0; f < 40; f++) frames.push(hipFrame(dip(f / 40, 0.5, 0.66) + noise() * 0.003));
  assert.equal(run(frames, squatCounter()).reps, 4);
});

test('pose.js exports createRepTracker and the createPushupTracker alias', async () => {
  const m = await import('../js/pose.js');
  assert.equal(m.createRepTracker, m.createPushupTracker);
});

test('pose.js imports under node without touching the vendor bundle', async () => {
  const mod = await import('../js/pose.js');
  assert.equal(typeof mod.createPushupTracker, 'function');
});

// --- runner ----------------------------------------------------------------
let failed = 0;
for (const [name, fn] of tests) {
  try { await fn(); console.log(`ok   - ${name}`); }
  catch (e) { failed++; console.log(`FAIL - ${name}\n${e.stack}`); }
}
console.log(`\n${tests.length - failed}/${tests.length} passed`);
process.exit(failed ? 1 : 0);
