// Push-up Alarm — multi-mission alarm: UI + flow controller.
import { createAlarm } from './alarm.js';
import { MISSIONS, loadMissions } from './missions/index.js';
import { native, initAndroid, quietNativeWhen, stopNative, nativeRinging } from './android.js';

const $ = (id) => document.getElementById(id);
const body = document.body;

/* ---------- safe storage ---------- */
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } },
};
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const byId = (id) => MISSIONS.find((m) => m.id === id);

/* ---------- settings ---------- */
const settings = {
  volume: clamp(Number(store.get('pa.volume', 1)), 0, 1),
  ramp: !!store.get('pa.ramp', false),
  check: !!store.get('pa.check', false),
  checkMin: clamp(parseInt(store.get('pa.checkMin', 3), 10) || 3, 1, 30),
};
if (Number.isNaN(settings.volume)) settings.volume = 1;
let savedPlan = store.get('pa.plan', null);
if (!Array.isArray(savedPlan) || !savedPlan.length) savedPlan = [{ id: 'pushups', config: {} }];
let plan = savedPlan.filter((p) => p && typeof p.id === 'string').map((p) => ({ id: p.id, config: { ...(p.config || {}) } }));
let planIsOverride = false;

const params = new URLSearchParams(location.search);
if (params.get('auto') === '1') { body.classList.add('auto'); $('start-hint').textContent = 'Alarm! Tap to start'; }

/* ---------- state ---------- */
const alarm = createAlarm();
alarm.setVolume(settings.volume);
let phase = 'loading'; // loading | start | mission | done | check | alarming | skipped
let runPlan = [];
let idx = 0;
let current = null; // { mission, ctrl }
let startedAt = 0, timerId = 0, rampId = 0, wakeLock = null, checkId = 0;
let missionDone = 0, missionTotal = 0;

function show(name) {
  phase = name;
  body.dataset.screen = name;
  body.classList.toggle('done', name === 'done' || name === 'check');
  for (const s of ['start', 'mission', 'done', 'check', 'skipped']) {
    const active = s === name || (name === 'alarming' && s === 'check') || (name === 'loading' && s === 'start');
    $('screen-' + s).classList.toggle('is-active', active);
  }
}
const fmtTime = (ms) => { const s = Math.round(ms / 1000); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
const cfgOf = (entry) => { const m = byId(entry.id); return { ...(m ? m.defaults : {}), ...entry.config }; };
function persistPlan() { if (!planIsOverride) store.set('pa.plan', plan); }
function persistSettings() {
  store.set('pa.volume', settings.volume); store.set('pa.ramp', settings.ramp);
  store.set('pa.check', settings.check); store.set('pa.checkMin', settings.checkMin);
}

/* ---------- URL overrides (applied once missions are known) ---------- */
function applyUrlOverrides() {
  const m = params.get('m');
  if (m) {
    const ids = m.split(',').map((x) => x.trim().toLowerCase()).filter((id) => byId(id));
    if (ids.length) { plan = ids.map((id) => ({ id, config: {} })); planIsOverride = true; }
  }
  const n = parseInt(params.get('n'), 10);
  if (n > 0) {
    const first = plan.find((p) => p.id === 'pushups' || p.id === 'squats');
    if (first) {
      if (!planIsOverride) plan = plan.map((p) => ({ id: p.id, config: { ...p.config } })); // work on copy; don't persist
      planIsOverride = true;
      const f = plan.find((p) => p.id === 'pushups' || p.id === 'squats');
      f.config.count = clamp(n, 1, 200);
    }
  }
}

/* ---------- start screen ---------- */
function activePlan() { return plan.filter((p) => byId(p.id)); }
function refreshStart() {
  const ap = activePlan();
  $('start-icons').textContent = ap.map((p) => byId(p.id).icon).join(' ');
  $('start-summary').textContent = ap.length === 1
    ? `${byId(ap[0].id).name} to silence it`
    : `${ap.length} missions to silence it`;
  $('btn-start').disabled = !ap.length;
  if (!ap.length && phase !== 'loading') $('start-icons').textContent = '⚠️';
}

/* ---------- mission runner ---------- */
function setStatus(t) { if (phase === 'mission' && t != null) $('status').textContent = t; }
function setProgress(done, total) {
  missionDone = done; missionTotal = total || 1;
  const el = $('m-count');
  el.textContent = total ? `${done} / ${total}` : '';
  el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump');
  const frac = (idx + clamp(done / (total || 1), 0, 1)) / runPlan.length;
  $('m-line-fill').style.width = (frac * 100) + '%';
}

function mountMission(i) {
  idx = i;
  const entry = runPlan[i];
  const mission = byId(entry.id);
  $('error').hidden = true;
  $('m-title').textContent = `Mission ${i + 1} of ${runPlan.length} · ${mission.name}`;
  $('m-count').textContent = '';
  $('status').textContent = '';
  setProgress(0, 0);
  const root = $('mission-root');
  root.innerHTML = '';
  root.classList.remove('swap'); void root.offsetWidth; root.classList.add('swap');
  let completed = false;
  const ctrl = mission.mount(root, {
    config: cfgOf(entry),
    onProgress: (d, t) => { if (current && current.ctrl === ctrl) setProgress(d, t); },
    onStatus: (t) => setStatus(t),
    onComplete: () => { if (completed) return; completed = true; setTimeout(() => missionFinished(ctrl), 0); },
  });
  current = { mission, ctrl };
  return ctrl;
}
async function startCurrent(permPromise) {
  const { mission, ctrl } = current;
  $('error').hidden = true;
  try {
    if (mission.needs === 'motion' && permPromise) await permPromise;
    await ctrl.start();
  } catch (e) {
    console.error(e);
    if (phase !== 'mission' || !current || current.ctrl !== ctrl) return;
    const name = e && e.name;
    let msg = (e && e.message) || 'Could not start this mission.';
    if (name === 'NotAllowedError' || name === 'SecurityError') msg = mission.needs === 'motion'
      ? 'Motion access was denied. Allow motion & orientation for this page, then retry.'
      : 'Access was denied. Allow it for this page in Settings, then retry.';
    else if (name === 'NotFoundError') msg = 'No camera was found on this device.';
    else if (name === 'NotReadableError') msg = 'The camera is in use by another app. Close it and retry.';
    $('error-title').textContent = mission.name + ' problem';
    $('error-msg').textContent = msg;
    $('error').hidden = false;
  }
}
function stopCurrent() {
  if (!current) return;
  try { current.ctrl && current.ctrl.stop && current.ctrl.stop(); } catch (e) { console.error(e); }
  current = null;
  try { $('mission-root').innerHTML = ''; } catch { /* ignore */ }
}
function missionFinished(ctrl) {
  if (phase !== 'mission' || !current || current.ctrl !== ctrl) return;
  stopCurrent();
  if (idx + 1 >= runPlan.length) { finish(); return; }
  $('m-line-fill').style.width = (((idx + 1) / runPlan.length) * 100) + '%';
  $('status').textContent = 'Mission complete!';
  setTimeout(() => {
    if (phase !== 'mission') return;
    mountMission(idx + 1);
    startCurrent(null);
  }, 900);
}

/* ---------- audio-locked fallback (auto-start without a gesture) ---------- */
const needsMotionPerm = () => typeof DeviceMotionEvent !== 'undefined' && !!DeviceMotionEvent.requestPermission;
let gestureArmed = false, motionDeferred = null, audioPoll = 0;
const GESTURE_EVENTS = ['pointerdown', 'touchend', 'click'];
function setBanner(on, text) {
  const b = $('audio-banner');
  if (text) b.textContent = text;
  b.hidden = !on;
  body.classList.toggle('audio-locked', on);
}
function disarmGesture() {
  if (gestureArmed) GESTURE_EVENTS.forEach((ev) => document.removeEventListener(ev, onFirstGesture, true));
  gestureArmed = false; motionDeferred = null;
  clearInterval(audioPoll); audioPoll = 0;
  setBanner(false);
}
function armGesture(wantMotion) {
  disarmGesture();
  let promise = null;
  if (wantMotion) {
    promise = new Promise((resolve, reject) => { motionDeferred = { resolve, reject }; });
    promise.catch(() => {});
  }
  GESTURE_EVENTS.forEach((ev) => document.addEventListener(ev, onFirstGesture, true));
  gestureArmed = true;
  // Give an allowed AudioContext a moment to reach 'running' before showing the banner.
  setTimeout(() => {
    if (!gestureArmed || phase !== 'mission') return;
    if (alarm.isRunning && !motionDeferred) { disarmGesture(); return; }
    setBanner(true, alarm.isRunning ? '👆 Tap anywhere to allow motion' : '🔇 Tap anywhere to turn on the siren');
  }, 400);
  // If the context gets allowed on its own later, drop the banner.
  audioPoll = setInterval(() => {
    if (!alarm.isRunning) return;
    if (motionDeferred) setBanner(!$('audio-banner').hidden, '👆 Tap anywhere to allow motion'); else disarmGesture();
  }, 400);
  return promise;
}
function onFirstGesture() {
  // Never preventDefault / stopPropagation: the tap still reaches whatever was under the finger.
  if (phase !== 'mission') { disarmGesture(); return; }
  try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch { /* ignore */ }
  try { alarm.unlock(); } catch (e) { console.error(e); }
  try { alarm.start(); } catch (e) { console.error(e); } // no-op if already scheduled; unlock() resumed the context
  if (motionDeferred) {
    const d = motionDeferred; motionDeferred = null;
    try { d.resolve(DeviceMotionEvent.requestPermission()); } catch (e) { d.reject(e); }
  }
  setBanner(false);
  setTimeout(() => {
    if (phase !== 'mission' || !gestureArmed) return;
    if (alarm.isRunning) { disarmGesture(); } else { setBanner(true, '🔇 Tap anywhere to turn on the siren'); }
  }, 600);
}

function beginRun({ fromGesture }) {
  if (phase !== 'start') return;
  const ap = activePlan();
  if (!ap.length) return;
  // iOS: ignore the silent switch for Web Audio.
  try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch { /* ignore */ }
  try { alarm.unlock(); } catch (e) { console.error(e); }
  clearInterval(rampId);
  if (settings.ramp) alarm.setVolume(settings.volume * 0.4); else alarm.setVolume(settings.volume);
  try { alarm.start(); } catch (e) { console.error(e); }
  const wantMotion = ap.some((p) => byId(p.id).needs === 'motion') && needsMotionPerm();
  let permPromise = null;
  if (fromGesture) {
    try {
      if (wantMotion) { permPromise = DeviceMotionEvent.requestPermission(); permPromise.catch(() => {}); }
    } catch (e) { console.error(e); }
  }
  runPlan = ap.map((p) => ({ id: p.id, config: { ...p.config } }));
  cancelCheck();
  startedAt = Date.now();
  $('timer').textContent = '0:00';
  clearInterval(timerId);
  timerId = setInterval(() => { $('timer').textContent = fmtTime(Date.now() - startedAt); }, 500);
  if (settings.ramp) {
    const t0 = Date.now();
    rampId = setInterval(() => {
      const f = clamp((Date.now() - t0) / 60000, 0, 1);
      alarm.setVolume(settings.volume * (0.4 + 0.6 * f));
      if (f >= 1) clearInterval(rampId);
    }, 1000);
  }
  show('mission');
  quietNativeWhen(() => alarm.isRunning);
  requestWakeLock();
  if (!fromGesture) permPromise = armGesture(wantMotion);
  mountMission(0);
  startCurrent(permPromise);
}
$('btn-start').addEventListener('click', () => beginRun({ fromGesture: true }));
$('btn-retry').addEventListener('click', () => {
  if (!current) return;
  // Mount a fresh instance so the mission starts from a clean state (inside this gesture).
  const i = idx; stopCurrent(); mountMission(i);
  let perm = null;
  try { if (byId(runPlan[i].id).needs === 'motion' && DeviceMotionEvent.requestPermission) perm = DeviceMotionEvent.requestPermission(); } catch { /* ignore */ }
  startCurrent(perm);
});

/* ---------- streak ---------- */
const dayKey = (d = new Date()) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
function recordCompletion() {
  const today = dayKey();
  const y = new Date(); y.setDate(y.getDate() - 1);
  let streak = Number(store.get('pa.streak', 0)) || 0;
  const last = store.get('pa.lastDone', '');
  if (last === today) { /* already counted */ } else if (last === dayKey(y)) streak += 1; else streak = 1;
  store.set('pa.streak', streak); store.set('pa.lastDone', today); store.set('pa.lastTimeMs', Date.now() - startedAt);
  return streak;
}
function recordSkip() { store.set('pa.streak', 0); store.set('pa.lastSkip', dayKey()); }

/* ---------- finish / skip ---------- */
function silence() {
  stopNative();
  clearInterval(timerId); clearInterval(rampId);
  disarmGesture();
  try { alarm.stop(); } catch (e) { console.error(e); }
  alarm.setVolume(settings.volume);
  stopCurrent();
  cancelHold();
}
function finish() {
  if (phase !== 'mission') return;
  const elapsed = Date.now() - startedAt;
  silence();
  try { alarm.playSuccess(); } catch (e) { console.error(e); }
  const streak = recordCompletion();
  $('done-streak').textContent = streak;
  $('done-streak-label').textContent = streak === 1 ? 'day streak' : 'days in a row';
  $('done-time').textContent = fmtTime(elapsed);
  $('done-reps').textContent = runPlan.length;
  const note = $('check-note');
  if (settings.check) {
    note.hidden = false;
    note.textContent = `Wake-up check in ${settings.checkMin} min — keep this page open.`;
    scheduleCheck();
  } else { note.hidden = true; releaseWakeLock(); }
  show('done');
}
function emergencyStop() {
  if (phase !== 'mission') return;
  silence(); releaseWakeLock(); recordSkip(); show('skipped');
}
function backToStart() { cancelCheck(); releaseWakeLock(); refreshStart(); show('start'); }
$('btn-again').addEventListener('click', backToStart);
$('btn-again2').addEventListener('click', backToStart);

/* ---------- wake-up check ---------- */
let checkAt = 0, checkDeadline = 0;
function scheduleCheck() {
  cancelCheck();
  checkAt = Date.now() + settings.checkMin * 60000;
  checkId = setInterval(checkTick, 1000);
}
function cancelCheck() { clearInterval(checkId); checkId = 0; checkAt = 0; checkDeadline = 0; }
function checkTick() {
  const now = Date.now();
  if (phase === 'done' && checkAt && now >= checkAt) {
    checkAt = 0; checkDeadline = now + 60000;
    $('check-text').innerHTML = 'Tap within <b id="check-left">60</b> s or the siren returns.';
    $('btn-awake').textContent = "I'm awake";
    $('screen-check').querySelector('.done-title').textContent = 'Still awake?';
    $('screen-check').querySelector('.done-emoji').textContent = '☀️';
    show('check');
    try { navigator.vibrate && navigator.vibrate([200, 100, 200]); } catch { /* ignore */ }
  } else if (phase === 'check') {
    const left = Math.ceil((checkDeadline - now) / 1000);
    const el = $('check-left'); if (el) el.textContent = Math.max(0, left);
    if (left <= 0) rearm();
  }
}
function rearm() {
  cancelCheck();
  try { alarm.unlock(); } catch { /* ignore */ }
  alarm.setVolume(settings.volume);
  try { alarm.start(); } catch (e) { console.error(e); }
  $('screen-check').querySelector('.done-title').textContent = 'Wake up!';
  $('screen-check').querySelector('.done-emoji').textContent = '🚨';
  $('check-text').textContent = 'You fell back asleep. Tap the button to silence the siren.';
  $('btn-awake').textContent = "I'm awake — stop siren";
  show('alarming');
}
$('btn-awake').addEventListener('click', () => {
  if (phase === 'alarming') { try { alarm.stop(); } catch { /* ignore */ } }
  cancelCheck(); releaseWakeLock();
  const note = $('check-note'); note.hidden = false; note.textContent = 'Checked in. Have a great day.';
  show('done');
});

/* ---------- emergency hold (5 s) ---------- */
const HOLD_MS = 5000, SOS_C = 2 * Math.PI * 19;
let holdStart = 0, holdRaf = 0;
const sos = $('btn-sos');
function holdTick() {
  const t = performance.now() - holdStart;
  $('sos-fg').style.strokeDashoffset = SOS_C * (1 - Math.min(1, t / HOLD_MS));
  if (t >= HOLD_MS) { cancelHold(); emergencyStop(); return; }
  holdRaf = requestAnimationFrame(holdTick);
}
function beginHold(e) {
  e.preventDefault();
  if (holdRaf) return;
  try { sos.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  sos.classList.add('holding'); $('sos-cap').textContent = 'Keep holding…';
  holdStart = performance.now(); holdRaf = requestAnimationFrame(holdTick);
}
function cancelHold() {
  cancelAnimationFrame(holdRaf); holdRaf = 0;
  sos.classList.remove('holding'); $('sos-fg').style.strokeDashoffset = SOS_C; $('sos-cap').textContent = 'Emergency stop';
}
sos.addEventListener('pointerdown', beginHold);
for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) sos.addEventListener(ev, cancelHold);
sos.addEventListener('contextmenu', (e) => e.preventDefault());
// No rubber-band scroll outside the settings sheet and mission content that needs it.
document.addEventListener('touchmove', (e) => {
  if (phase === 'start' || phase === 'done' || phase === 'check' || phase === 'alarming' || phase === 'mission') {
    if (!e.target.closest('.sheet-panel, .setup-scroll')) e.preventDefault();
  }
}, { passive: false });

/* ---------- wake lock & visibility ---------- */
async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator && !wakeLock) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    }
  } catch { wakeLock = null; }
}
function releaseWakeLock() { try { wakeLock && wakeLock.release(); } catch { /* ignore */ } wakeLock = null; }
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  if (phase === 'mission' || phase === 'alarming') {
    try { alarm.start(); } catch (e) { console.error(e); }
    if (phase === 'mission') quietNativeWhen(() => alarm.isRunning);
  }
  // Android: opened from the launcher while an alarm rings.
  if (phase === 'start' && nativeRinging() && activePlan().length) beginRun({ fromGesture: false });
  if (phase === 'mission' || phase === 'done' || phase === 'check') requestWakeLock();
  if (phase === 'done' || phase === 'check') checkTick();
});

/* ---------- settings sheet ---------- */
const sheet = $('sheet');
let expanded = -1;
function openSheet() {
  if (phase !== 'start') return;
  $('set-volume').value = settings.volume;
  $('vol-val').textContent = Math.round(settings.volume * 100) + '%';
  $('set-ramp').checked = settings.ramp; $('set-check').checked = settings.check; $('set-check-min').value = settings.checkMin;
  $('check-min-row').classList.toggle('off', !settings.check);
  $('set-url').value = location.origin + location.pathname;
  $('picker').hidden = true; expanded = -1;
  renderPlan();
  sheet.classList.add('open'); sheet.setAttribute('aria-hidden', 'false');
}
function closeSheet() { stopTest(); sheet.classList.remove('open'); sheet.setAttribute('aria-hidden', 'true'); refreshStart(); }

function cfgSummary(entry) {
  const m = byId(entry.id); if (!m) return '';
  const c = cfgOf(entry);
  return (m.settings || []).slice(0, 2).map((s) => c[s.key]).join(' · ');
}
function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
function renderPlan() {
  const ol = $('plan'); ol.innerHTML = '';
  plan.forEach((entry, i) => {
    const m = byId(entry.id);
    const li = el('li');
    const row = el('div', 'plan-row');
    const main = el('button', 'plan-main'); main.type = 'button';
    main.append(el('span', 'ic', m ? m.icon : '❔'), el('span', null, m ? m.name : entry.id + ' (unavailable)'), el('span', 'sum', cfgSummary(entry)));
    main.addEventListener('click', () => { expanded = expanded === i ? -1 : i; renderPlan(); });
    const mk = (txt, label, fn, dis, cls) => { const b = el('button', 'mini' + (cls ? ' ' + cls : ''), txt); b.type = 'button'; b.setAttribute('aria-label', label); b.disabled = !!dis; b.addEventListener('click', fn); return b; };
    row.append(main,
      mk('↑', 'Move up', () => { [plan[i - 1], plan[i]] = [plan[i], plan[i - 1]]; expanded = -1; persistPlan(); renderPlan(); }, i === 0),
      mk('↓', 'Move down', () => { [plan[i + 1], plan[i]] = [plan[i], plan[i + 1]]; expanded = -1; persistPlan(); renderPlan(); }, i === plan.length - 1),
      mk('✕', 'Remove', () => { plan.splice(i, 1); expanded = -1; persistPlan(); renderPlan(); }, plan.length <= 1, 'rm'));
    li.append(row);
    if (expanded === i && m) {
      const cfg = el('div', 'plan-cfg');
      const c = cfgOf(entry);
      for (const s of m.settings || []) {
        const r = el('label', 'cfg-row', s.label);
        let input;
        if (s.type === 'select') {
          input = el('select');
          for (const o of s.options) { const op = el('option', null, String(o)); op.value = String(o); if (String(c[s.key]) === String(o)) op.selected = true; input.append(op); }
          input.addEventListener('change', () => { entry.config[s.key] = input.value; persistPlan(); });
        } else {
          input = el('input'); input.type = 'number'; input.inputMode = 'numeric';
          if (s.min != null) input.min = s.min; if (s.max != null) input.max = s.max;
          input.value = c[s.key];
          input.addEventListener('change', () => {
            let v = parseInt(input.value, 10); if (Number.isNaN(v)) v = m.defaults[s.key];
            v = clamp(v, s.min ?? -Infinity, s.max ?? Infinity); input.value = v; entry.config[s.key] = v; persistPlan();
          });
        }
        r.append(input); cfg.append(r);
      }
      li.append(cfg);
    }
    ol.append(li);
  });
}
$('btn-add').addEventListener('click', () => {
  const p = $('picker');
  if (!p.hidden) { p.hidden = true; return; }
  p.innerHTML = '';
  for (const m of MISSIONS) {
    const b = el('button'); b.type = 'button';
    b.append(el('span', null, m.icon), document.createTextNode(m.name));
    b.addEventListener('click', () => { plan.push({ id: m.id, config: {} }); expanded = plan.length - 1; p.hidden = true; persistPlan(); renderPlan(); });
    p.append(b);
  }
  p.hidden = false;
});
$('btn-settings').addEventListener('click', openSheet);
$('btn-close-settings').addEventListener('click', closeSheet);
$('sheet-backdrop').addEventListener('click', closeSheet);
$('set-volume').addEventListener('input', (e) => {
  settings.volume = clamp(Number(e.target.value), 0, 1);
  alarm.setVolume(settings.volume); persistSettings();
  $('vol-val').textContent = Math.round(settings.volume * 100) + '%';
});
$('set-ramp').addEventListener('change', (e) => { settings.ramp = e.target.checked; persistSettings(); });
$('set-check').addEventListener('change', (e) => { settings.check = e.target.checked; $('check-min-row').classList.toggle('off', !settings.check); persistSettings(); });
$('set-check-min').addEventListener('change', (e) => {
  settings.checkMin = clamp(parseInt(e.target.value, 10) || 3, 1, 30); e.target.value = settings.checkMin; persistSettings();
});

let testTimer = 0;
function stopTest() {
  if (!testTimer) return;
  clearTimeout(testTimer); testTimer = 0;
  try { alarm.stop(); } catch { /* ignore */ }
  $('btn-test').textContent = 'Test siren';
}
$('btn-test').addEventListener('click', () => {
  if (testTimer) { stopTest(); return; }
  try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch { /* ignore */ }
  try { alarm.unlock(); alarm.setVolume(settings.volume); alarm.start(); } catch (e) { console.error(e); }
  $('btn-test').textContent = 'Stop test';
  testTimer = setTimeout(stopTest, 3000);
});
$('btn-copy').addEventListener('click', async () => {
  const e = $('set-url'); const b = $('btn-copy');
  try { await navigator.clipboard.writeText(e.value); }
  catch { e.select(); e.setSelectionRange(0, 9999); try { document.execCommand('copy'); } catch { /* ignore */ } }
  b.textContent = 'Copied'; setTimeout(() => { b.textContent = 'Copy'; }, 1500);
});

/* ---------- auto-open setup ---------- */
const setupEl = $('setup');
const stepEls = [...setupEl.querySelectorAll('.step')];
let setupDone = [false, false, false, false, false];
try {
  const v = JSON.parse(localStorage.getItem('pa.setup'));
  if (Array.isArray(v)) setupDone = setupDone.map((_, i) => v[i] === true);
} catch { /* ignore */ }
function autoUrl() { return location.origin + location.pathname + '?auto=1'; }
function renderSetup() {
  stepEls.forEach((el, i) => {
    el.classList.toggle('done', setupDone[i]);
    el.querySelector('input').checked = setupDone[i];
  });
  const all = setupDone.every(Boolean);
  document.querySelectorAll('[data-setup-badge]').forEach((b) => { b.hidden = !all; });
}
stepEls.forEach((el, i) => el.querySelector('input').addEventListener('change', (e) => {
  setupDone[i] = e.target.checked;
  try { localStorage.setItem('pa.setup', JSON.stringify(setupDone)); } catch { /* ignore */ }
  renderSetup();
}));
const isStandalone = () => navigator.standalone === true || (window.matchMedia && matchMedia('(display-mode: standalone)').matches);
function openSetup() {
  $('setup-url').textContent = autoUrl();
  $('a2hs').hidden = isStandalone();
  $('a2hs-hint').hidden = true;
  renderSetup();
  setupEl.classList.add('open'); setupEl.setAttribute('aria-hidden', 'false');
}
function closeSetup() { setupEl.classList.remove('open'); setupEl.setAttribute('aria-hidden', 'true'); }
$('btn-setup').addEventListener('click', () => { if (phase === 'start') openSetup(); });
$('btn-setup2').addEventListener('click', openSetup);
$('btn-close-setup').addEventListener('click', closeSetup);
$('btn-setup-copy').addEventListener('click', async () => {
  const b = $('btn-setup-copy'); const box = $('setup-url');
  let ok = false;
  try { await navigator.clipboard.writeText(autoUrl()); ok = true; } catch { /* fall back */ }
  if (!ok) {
    try {
      const r = document.createRange(); r.selectNodeContents(box);
      const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
      ok = document.execCommand('copy');
    } catch { /* ignore */ }
  }
  b.textContent = ok ? 'Copied ✓' : 'Selected — press and hold to copy';
  setTimeout(() => { b.textContent = 'Copy link'; }, 2500);
});
$('btn-open-shortcuts').addEventListener('click', () => { location.href = 'shortcuts://'; });
$('btn-a2hs').addEventListener('click', () => { $('a2hs-hint').hidden = false; });
renderSetup();

initAndroid({ canOpen: () => phase === 'start' });

/* ---------- boot ---------- */
$('btn-start').disabled = true;
loadMissions().then(() => {
  applyUrlOverrides();
  phase = 'start';
  refreshStart();
  show('start');
  if (params.get('auto') === '1' && activePlan().length) beginRun({ fromGesture: false });
});

/* ---------- updates ---------- */
// A new service worker takes over as soon as it installs; reload once so the new
// files show up, but never in the middle of a mission.
let swReg = null;
try {
  // The Android app ships these files inside the APK, so it needs no offline cache.
  if ('serviceWorker' in navigator && !native) {
    navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' })
      .then((r) => { swReg = r; r.update().catch(() => {}); })
      .catch(() => {});
    // First install also fires controllerchange; only reload when replacing an old worker.
    let reloaded = !navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloaded || (phase !== 'start' && phase !== 'loading')) return;
      reloaded = true;
      location.reload();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && swReg) swReg.update().catch(() => {});
    });
  }
} catch { /* ignore */ }

fetch('./version.txt', { cache: 'no-store' })
  .then((r) => (r.ok ? r.text() : ''))
  .then((v) => { $('app-version').textContent = v.trim() || '?'; })
  .catch(() => { $('app-version').textContent = 'offline'; });

$('btn-update').addEventListener('click', async () => {
  $('btn-update').textContent = 'Updating…';
  try {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
    if (swReg) await swReg.update();
  } catch { /* ignore */ }
  location.reload();
});
