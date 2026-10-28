// Registry of wake-up missions. Each module is imported dynamically so one broken or
// missing file never takes the whole app down.
const ORDER = ['pushups', 'squats', 'math', 'memory', 'typing', 'shake', 'steps'];

export const MISSIONS = [];
let loading = null;

export function loadMissions() {
  if (loading) return loading;
  loading = Promise.allSettled(ORDER.map((id) => import(`./${id}.js`))).then((results) => {
    MISSIONS.length = 0;
    results.forEach((r, i) => {
      const m = r.status === 'fulfilled' && r.value && r.value.default;
      if (m && typeof m.mount === 'function') MISSIONS.push(m);
      else console.warn('mission unavailable:', ORDER[i], r.reason || '');
    });
    return MISSIONS;
  });
  return loading;
}
