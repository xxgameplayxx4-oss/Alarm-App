// Typing mission: type the shown phrase exactly (case-insensitive).
export const SHORT = [
  'Rise and shine', 'Today is mine', 'Get out of bed', 'Coffee time, champ', 'No more snooze',
  'Make today count', 'Feet on the floor', 'Wake up and win', 'Sunrise is waiting', 'Be unstoppable today',
  'Stand up, stretch out', 'Dream big, start now', 'Your bed can wait', 'Good morning, legend', 'Move your body',
];
export const LONG = [
  'The early riser gets to write the first line of the day.',
  "I'm awake, I'm up, and I'm ready to make something happen.",
  'Every great day begins with the decision to get out of bed.',
  "Future me is thankful that I didn't hit snooze this morning.",
  'A glass of water, a deep breath, and a brand new day ahead.',
  "Nobody ever regretted getting up early, so let's get moving.",
  'The sun is up, the world is moving, and so am I right now.',
  'Small steps this morning will become big wins by tonight.',
  "Discipline is choosing what I want most over what I want now.",
  'Open the curtains, stretch your arms, and welcome the morning light.',
  'Today I will do one hard thing before the world wakes up.',
  "The comfort of the blanket is temporary, but the day's wins last.",
  'I choose to be the kind of person who gets up when the alarm rings.',
  'Breakfast, sunshine, and a good plan are waiting just outside.',
  'Take a breath, shake off the sleep, and go meet the day.',
];

export function normalize(s) {
  return String(s ?? '')
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}
export const matches = (phrase, input) => normalize(phrase) === normalize(input);

export function pickPhrases(count, length = 'short', rng = Math.random) {
  const pool = (length === 'long' ? LONG : SHORT).slice();
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  const out = [];
  while (out.length < count) out.push(...pool.slice(0, count - out.length));
  return out;
}

export default {
  id: 'typing',
  name: 'Typing',
  icon: '⌨️',
  needs: null,
  defaults: { count: 2, length: 'short' },
  settings: [
    { key: 'count', label: 'Phrases', type: 'number', min: 1, max: 10 },
    { key: 'length', label: 'Length', type: 'select', options: ['short', 'long'] },
  ],
  mount(root, { config = {}, onProgress = () => {}, onComplete = () => {}, onStatus = () => {} } = {}) {
    const cfg = { ...this.defaults, ...config };
    const total = Math.max(1, Number(cfg.count) || 1);
    const phrases = pickPhrases(total, cfg.length);
    let done = 0, finished = false;
    const timers = new Set();
    const later = (fn, ms) => { const t = setTimeout(() => { timers.delete(t); fn(); }, ms); timers.add(t); };

    root.innerHTML = `
      <div class="m-typing m-screen">
        <div class="m-prompt">Type this exactly</div>
        <div class="m-phrase"></div>
        <input class="m-input" type="text" autocomplete="off" autocorrect="off" autocapitalize="off"
               spellcheck="false" enterkeyhint="done" inputmode="text" placeholder="Start typing…" aria-label="Type the phrase" />
        <button type="button" class="m-submit">Check</button>
      </div>`;
    const phraseEl = root.querySelector('.m-phrase'), input = root.querySelector('.m-input'),
      btn = root.querySelector('.m-submit'), box = root.querySelector('.m-typing');

    const show = () => { phraseEl.textContent = phrases[done]; input.value = ''; input.classList.remove('m-bad', 'm-ok'); };
    const submit = () => {
      if (finished) return;
      if (matches(phrases[done], input.value)) {
        done++; onProgress(done, total); input.classList.add('m-ok');
        if (done >= total) { finished = true; onStatus('Nice typing!'); later(onComplete, 350); }
        else { onStatus('Correct! Next phrase.'); later(show, 450); }
      } else {
        onStatus('Not quite. Match it exactly.');
        input.classList.add('m-bad'); box.classList.remove('m-shake'); void box.offsetWidth; box.classList.add('m-shake');
        later(() => { input.classList.remove('m-bad'); box.classList.remove('m-shake'); }, 600);
      }
    };
    const onKey = e => { if (e.key === 'Enter') { e.preventDefault(); submit(); } };
    input.addEventListener('keydown', onKey);
    btn.addEventListener('click', submit);

    return {
      async start() { onProgress(0, total); onStatus('Type the phrase'); show(); try { input.focus(); } catch {} },
      stop() { timers.forEach(clearTimeout); timers.clear(); input.removeEventListener('keydown', onKey); btn.removeEventListener('click', submit); finished = true; root.innerHTML = ''; },
    };
  },
};
