// Math mission: solve arithmetic problems on a big custom keypad.
const ri = (rng, a, b) => a + Math.floor(rng() * (b - a + 1));

export function makeProblem(difficulty = 'medium', rng = Math.random) {
  let text, answer;
  switch (difficulty) {
    case 'easy': {
      const a = ri(rng, 10, 99), b = ri(rng, 10, 99);
      if (rng() < 0.5) { text = `${a} + ${b}`; answer = a + b; }
      else { const hi = Math.max(a, b), lo = Math.min(a, b); text = `${hi} − ${lo}`; answer = hi - lo; }
      break;
    }
    case 'hard': {
      const a = ri(rng, 12, 49), b = ri(rng, 11, 29), c = ri(rng, 10, 99);
      text = `${a} × ${b} + ${c}`; answer = a * b + c;
      break;
    }
    case 'insane': {
      const a = ri(rng, 12, 39), b = ri(rng, 12, 29), c = ri(rng, 100, 499);
      if (rng() < 0.5) { text = `${a} × ${b} − ${c}`; answer = a * b - c; }
      else { const d = ri(rng, 3, 9), e = ri(rng, 3, 9); text = `${a} × ${d} + ${b} × ${e}`; answer = a * d + b * e; }
      break;
    }
    case 'medium':
    default: {
      if (rng() < 0.5) { const a = ri(rng, 12, 99), b = ri(rng, 3, 9); text = `${a} × ${b}`; answer = a * b; }
      else { const a = ri(rng, 100, 899), b = ri(rng, 100, 899); text = `${a} + ${b}`; answer = a + b; }
    }
  }
  return { text, answer };
}

export function checkAnswer(problem, input) {
  const s = String(input ?? '').trim();
  if (!/^-?\d+$/.test(s)) return false;
  return Number(s) === problem.answer;
}

export default {
  id: 'math',
  name: 'Math',
  icon: '🧮',
  needs: null,
  defaults: { difficulty: 'medium', count: 3 },
  settings: [
    { key: 'count', label: 'Problems', type: 'number', min: 1, max: 20 },
    { key: 'difficulty', label: 'Difficulty', type: 'select', options: ['easy', 'medium', 'hard', 'insane'] },
  ],
  mount(root, { config = {}, onProgress = () => {}, onComplete = () => {}, onStatus = () => {} } = {}) {
    const cfg = { ...this.defaults, ...config };
    const total = Math.max(1, Number(cfg.count) || 1);
    let done = 0, input = '', problem = null, finished = false, locked = false;
    const timers = new Set();
    const later = (fn, ms) => { const t = setTimeout(() => { timers.delete(t); fn(); }, ms); timers.add(t); };

    root.innerHTML = `
      <div class="m-math m-screen">
        <div class="m-prompt"></div>
        <div class="m-eq" aria-live="polite"></div>
        <div class="m-answer"><span class="m-answer-text"></span><span class="m-caret"></span></div>
        <div class="m-keypad">
          ${['7','8','9','4','5','6','1','2','3','−','0','⌫'].map(k =>
            `<button type="button" class="m-key${k==='⌫'||k==='−'?' m-key-alt':''}" data-k="${k}">${k}</button>`).join('')}
          <button type="button" class="m-key m-key-ok" data-k="ok">Check</button>
        </div>
      </div>`;
    const $ = s => root.querySelector(s);
    const eq = $('.m-eq'), ans = $('.m-answer'), ansText = $('.m-answer-text'), box = $('.m-math');

    const render = () => { ansText.textContent = input; };
    const next = () => {
      problem = makeProblem(cfg.difficulty);
      eq.textContent = `${problem.text} = ?`;
      input = ''; render();
    };
    const submit = () => {
      if (finished || locked || input === '' || input === '-') return;
      if (checkAnswer(problem, input)) {
        done++; onProgress(done, total);
        ans.classList.add('m-ok');
        locked = true;
        if (done >= total) {
          finished = true; onStatus('Solved!');
          later(onComplete, 350);
        } else {
          onStatus('Correct! Next one.');
          later(() => { ans.classList.remove('m-ok'); locked = false; next(); }, 450);
        }
      } else {
        locked = true; onStatus('Wrong. Try this one.');
        ans.classList.add('m-bad'); box.classList.remove('m-shake'); void box.offsetWidth; box.classList.add('m-shake');
        later(() => { ans.classList.remove('m-bad'); box.classList.remove('m-shake'); locked = false; next(); }, 600);
      }
    };
    const onClick = e => {
      const b = e.target.closest('.m-key'); if (!b || finished || locked) return;
      const k = b.dataset.k;
      if (k === 'ok') return submit();
      if (k === '⌫') input = input.slice(0, -1);
      else if (k === '−') { if (input === '') input = '-'; else if (input === '-') input = ''; }
      else if (input.length < 8) input = (input === '0' ? '' : input === '-0' ? '-' : input) + k;
      render();
    };
    root.addEventListener('click', onClick);

    return {
      async start() {
        $('.m-prompt').textContent = 'Solve to turn off the alarm';
        onProgress(0, total); onStatus('Solve the problem'); next();
      },
      stop() { timers.forEach(clearTimeout); timers.clear(); root.removeEventListener('click', onClick); finished = true; root.innerHTML = ''; },
    };
  },
};
