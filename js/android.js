// Android app only: window.AndroidAlarm is the native bridge (android/…/MainActivity.java).
// In Safari this module does nothing, so the iPhone web app is unchanged.
export const native = (typeof window !== 'undefined' && window.AndroidAlarm) || null;

const $ = (id) => document.getElementById(id);
const DAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** The page's siren is audible: let the native alarm go quiet while the app is open. */
export function quietNativeWhen(isRunning) {
  if (!native) return;
  setTimeout(() => { if (isRunning()) { try { native.quiet(); } catch { /* ignore */ } } }, 500);
}
export function stopNative() {
  if (!native) return;
  try { native.stopRinging(); } catch { /* ignore */ }
}
export function nativeRinging() {
  if (!native) return false;
  try { return !!native.isRinging(); } catch { return false; }
}

function load() {
  try { const v = JSON.parse(native.getAlarms()); return Array.isArray(v) ? v : []; } catch { return []; }
}

export function initAndroid({ canOpen }) {
  if (!native) return;
  document.body.classList.add('android');
  let alarms = load();
  const panel = $('alarms');

  const save = () => {
    let msg = '';
    try { msg = native.setAlarms(JSON.stringify(alarms)); } catch { msg = 'Could not save alarms'; }
    $('alarms-next').textContent = msg;
  };
  const fmt = (a) => String(a.h).padStart(2, '0') + ':' + String(a.m).padStart(2, '0');
  const daysText = (a) => !a.days || !a.days.length ? 'Once'
    : a.days.length === 7 ? 'Every day'
    : a.days.slice().sort().map((d) => DAY_NAMES[d]).join(' ');

  function render() {
    const ul = $('alarms-list');
    ul.innerHTML = '';
    if (!alarms.length) {
      const p = document.createElement('p'); p.className = 'fine left'; p.textContent = 'No alarms yet. Add one below.';
      ul.append(p);
    }
    alarms.forEach((a, i) => {
      const li = document.createElement('li'); li.className = 'al-item' + (a.on ? '' : ' off');
      const top = document.createElement('div'); top.className = 'al-top';
      const time = document.createElement('input'); time.type = 'time'; time.value = fmt(a); time.className = 'al-time';
      time.addEventListener('change', () => {
        const [h, m] = time.value.split(':').map((x) => parseInt(x, 10));
        if (Number.isInteger(h) && Number.isInteger(m)) { a.h = h; a.m = m; a.on = true; save(); render(); }
      });
      const tog = document.createElement('label'); tog.className = 'toggle al-toggle';
      const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = !!a.on; cb.setAttribute('aria-label', 'Alarm on');
      cb.addEventListener('change', () => { a.on = cb.checked; save(); render(); });
      tog.append(cb);
      const rm = document.createElement('button'); rm.type = 'button'; rm.className = 'mini rm'; rm.textContent = '✕'; rm.setAttribute('aria-label', 'Delete alarm');
      rm.addEventListener('click', () => { alarms.splice(i, 1); save(); render(); });
      top.append(time, tog, rm);
      const days = document.createElement('div'); days.className = 'al-days';
      DAYS.forEach((d, n) => {
        const b = document.createElement('button'); b.type = 'button'; b.textContent = d;
        b.setAttribute('aria-label', DAY_NAMES[n]);
        b.classList.toggle('on', (a.days || []).includes(n));
        b.addEventListener('click', () => {
          const set = new Set(a.days || []);
          if (set.has(n)) set.delete(n); else set.add(n);
          a.days = [...set].sort(); a.on = true; save(); render();
        });
        days.append(b);
      });
      const sum = document.createElement('small'); sum.textContent = daysText(a);
      li.append(top, days, sum);
      ul.append(li);
    });
  }

  function renderPerms() {
    let p = {};
    try { p = JSON.parse(native.permissions()); } catch { /* ignore */ }
    $('perm-notif').hidden = p.notifications !== false;
    $('perm-full').hidden = p.fullScreen !== false;
  }

  function open() {
    if (!canOpen()) return;
    alarms = load();
    render(); renderPerms();
    try { $('alarms-next').textContent = native.nextAlarm(); } catch { /* ignore */ }
    panel.classList.add('open'); panel.setAttribute('aria-hidden', 'false');
  }
  function close() { panel.classList.remove('open'); panel.setAttribute('aria-hidden', 'true'); }

  $('btn-alarms').addEventListener('click', open);
  $('btn-alarms2').addEventListener('click', open);
  $('btn-close-alarms').addEventListener('click', close);
  $('btn-alarm-add').addEventListener('click', () => {
    const id = alarms.reduce((mx, a) => Math.max(mx, a.id | 0), 0) + 1;
    alarms.push({ id, h: 7, m: 0, days: [1, 2, 3, 4, 5], on: true });
    save(); render();
  });
  $('btn-alarm-test').addEventListener('click', () => {
    try { native.testAlarm(); } catch { /* ignore */ }
    const b = $('btn-alarm-test'); b.textContent = 'Rings in 10 s — lock your phone';
    setTimeout(() => { b.textContent = 'Test alarm in 10 s'; }, 10000);
  });
  $('btn-perm-notif').addEventListener('click', () => native.openSettings('notifications'));
  $('btn-perm-full').addEventListener('click', () => native.openSettings('fullScreen'));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && panel.classList.contains('open')) renderPerms();
  });
}
