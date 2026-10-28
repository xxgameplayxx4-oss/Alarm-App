import assert from 'node:assert/strict';
import { ShakeDetector } from '../js/missions/shake.js';
import { StepDetector } from '../js/missions/steps.js';

let seed = 12345;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 - 0.5; };
const HZ = 60, DT = 1000 / HZ;

function run(det, seconds, fn) {
  let n = 0;
  for (let i = 0; i * DT < seconds * 1000; i++) {
    const t = i * DT, a = fn(t / 1000);
    if (det.push({ x: a[0], y: a[1], z: a[2], t })) n++;
  }
  return n;
}

// Shake: 20 clean shakes, one every 400ms, each a 100ms 6Hz burst of ~25 m/s^2 on x
{
  const burst = s => { const p = s % 0.4; return p < 0.1 ? 25 * Math.sin(2 * Math.PI * 5 * p) : 0; };
  const n = run(new ShakeDetector(), 0.5 + 20 * 0.4, s => s < 0.5 ? [0, 0, 9.81] : [burst(s - 0.5) + 0.3 * rnd(), 0.3 * rnd(), 9.81]);
  assert.ok(Math.abs(n - 20) <= 1, `clean shakes: ${n}`);
  console.log('shake clean 20 ->', n);
}
// Shake: sustained noise / still / gentle carrying
{
  const n = run(new ShakeDetector(), 20, () => [3 * rnd(), 3 * rnd(), 9.81 + 3 * rnd()]);
  assert.equal(n, 0); console.log('shake noise ->', n);
  const n2 = run(new ShakeDetector(), 20, s => [0, 0.5 * Math.sin(s * 2), 9.81]);
  assert.equal(n2, 0);
}
// Shake: vigorous continuous shaking still limited by refractory period (<= 4/s)
{
  const n = run(new ShakeDetector(), 5, s => [30 * Math.sin(2 * Math.PI * 6 * s), 0, 9.81]);
  assert.ok(n > 5 && n <= 20, `continuous shaking: ${n}`); console.log('shake continuous 5s ->', n);
}
// Steps: 2 Hz walking for 15 s -> ~30
{
  const walk = s => { const w = 3 * Math.sin(2 * Math.PI * 2 * s); return [0.5 * rnd() + 1 * Math.sin(2*Math.PI*s), 0.5 * rnd(), 9.81 + w + 0.4 * rnd()]; };
  const n = run(new StepDetector(), 15, walk);
  assert.ok(n >= 27 && n <= 33, `walking: ${n}`); console.log('steps walking 15s ->', n);
  // device in arbitrary orientation
  const n2 = run(new StepDetector(), 15, s => { const [a, b, c] = walk(s); return [c * 0.6, b, c * 0.8]; });
  assert.ok(n2 >= 27 && n2 <= 33, `rotated walking: ${n2}`);
}
// Steps: still / tiny wobble -> 0
{
  const n = run(new StepDetector(), 20, () => [0.1 * rnd(), 0.1 * rnd(), 9.81 + 0.2 * rnd()]);
  assert.equal(n, 0); console.log('steps still ->', n);
  const n2 = run(new StepDetector(), 20, s => [0, 0, 9.81 + 0.5 * Math.sin(2 * Math.PI * 2 * s) + 0.2 * rnd()]);
  assert.equal(n2, 0);
}
console.log('missions-motion: all passed');
