// Memory mission: watch the pattern flash, then tap the same tiles back (any order).
export function makePattern(size = 3, k = 5, rng = Math.random) {
  const n = size * size; k = Math.min(Math.max(1, k), n - 1);
  const idx = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
  return new Set(idx.slice(0, k));
}
// -> 'wrong' | 'correct' (tap in pattern) | 'complete' (all found). `picked` includes the new tap.
export function checkTap(pattern, picked, tile) {
  if (!pattern.has(tile)) return 'wrong';
  const all = [...pattern].every(t => picked.has(t) || t === tile);
  return all ? 'complete' : 'correct';
}

export default {
  id: 'memory',
  name: 'Memory',
  icon: '🧠',
  needs: null,
  defaults: { rounds: 3, grid: 4, tiles: 5 },
  settings: [
    { key: 'rounds', label: 'Rounds', type: 'number', min: 1, max: 10 },
    { key: 'grid', label: 'Grid size', type: 'select', options: [3, 4, 5] },
    { key: 'tiles', label: 'Tiles to remember', type: 'number', min: 3, max: 12 },
  ],
  mount(root, { config = {}, onProgress = () => {}, onComplete = () => {}, onStatus = () => {} } = {}) {
    const cfg = { ...this.defaults, ...config };
    const size = [3, 4, 5].includes(Number(cfg.grid)) ? Number(cfg.grid) : 4;
    const total = Math.max(1, Number(cfg.rounds) || 1);
    const k = Math.min(Math.max(1, Number(cfg.tiles) || 5), size * size - 1);
    let round = 0, pattern = new Set(), picked = new Set(), accepting = false, finished = false;
    const timers = new Set();
    const later = (fn, ms) => { const t = setTimeout(() => { timers.delete(t); fn(); }, ms); timers.add(t); };

    root.innerHTML = `
      <div class="m-memory m-screen">
        <div class="m-prompt"></div>
        <div class="m-grid" style="--m-n:${size}">
          ${Array.from({ length: size * size }, (_, i) => `<button type="button" class="m-tile" data-i="${i}" aria-label="Tile ${i + 1}"></button>`).join('')}
        </div>
        <div class="m-hint"></div>
      </div>`;
    const prompt = root.querySelector('.m-prompt'), hint = root.querySelector('.m-hint');
    const tiles = [...root.querySelectorAll('.m-tile')];
    const clear = () => tiles.forEach(t => t.classList.remove('m-lit', 'm-hit', 'm-miss', 'm-reveal'));

    const startRound = () => {
      clear(); picked = new Set(); accepting = false;
      pattern = makePattern(size, k);
      prompt.textContent = `Round ${round + 1} of ${total}`;
      hint.textContent = 'Memorize the tiles…'; onStatus('Memorize the tiles');
      later(() => {
        pattern.forEach(i => tiles[i].classList.add('m-lit'));
        later(() => {
          clear(); accepting = true;
          hint.textContent = `Tap the ${k} tiles you saw`; onStatus('Tap the tiles you saw');
        }, 1400 + k * 150);
      }, 700);
    };

    const onClick = e => {
      const t = e.target.closest('.m-tile'); if (!t || !accepting || finished) return;
      const i = Number(t.dataset.i);
      if (picked.has(i)) return;
      const r = checkTap(pattern, picked, i);
      if (r === 'wrong') {
        accepting = false; t.classList.add('m-miss');
        hint.textContent = 'Wrong! Here is the pattern…'; onStatus('Wrong tile. Same round again.');
        later(() => { pattern.forEach(p => tiles[p].classList.add('m-reveal')); }, 350);
        later(startRound, 2300);
        return;
      }
      picked.add(i); t.classList.add('m-hit');
      if (r === 'complete') {
        accepting = false; round++; onProgress(round, total);
        if (round >= total) { finished = true; hint.textContent = 'Perfect!'; onStatus('Perfect!'); later(onComplete, 500); }
        else { hint.textContent = 'Nice!'; later(startRound, 800); }
      }
    };
    root.addEventListener('click', onClick);

    return {
      async start() { onProgress(0, total); startRound(); },
      stop() { timers.forEach(clearTimeout); timers.clear(); root.removeEventListener('click', onClick); finished = true; accepting = false; root.innerHTML = ''; },
    };
  },
};
