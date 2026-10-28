// Shared factory for camera-based rep missions (push-ups, squats).
import { createRepTracker } from '../pose.js';

export function makeCameraMission({ id, name, icon, exercise, defaultCount, hint, maxCount }) {
  return {
    id, name, icon,
    needs: 'camera',
    defaults: { count: defaultCount },
    settings: [{ key: 'count', label: 'Reps', type: 'number', min: 1, max: maxCount }],

    mount(root, { config = {}, onProgress, onComplete, onStatus } = {}) {
      const total = Math.max(1, Math.round(Number(config.count ?? defaultCount)) || defaultCount);
      let done = false, tracker = null, stopped = false;

      root.innerHTML = '';
      root.classList.add('m-cam');
      const el = (tag, cls, text) => {
        const e = document.createElement(tag);
        e.className = cls;
        if (text != null) e.textContent = text;
        return e;
      };
      const video = el('video', 'm-cam-video');
      video.setAttribute('playsinline', ''); video.setAttribute('muted', ''); video.setAttribute('autoplay', '');
      video.muted = true; video.playsInline = true; video.autoplay = true;
      const canvas = el('canvas', 'm-cam-canvas');
      const counter = el('div', 'm-cam-counter', `0 / ${total}`);
      const hintEl = el('div', 'm-cam-hint', hint);
      const statusEl = el('div', 'm-cam-status', 'Starting camera…');
      const bar = el('div', 'm-cam-bar');
      const fill = el('div', 'm-cam-bar-fill');
      bar.appendChild(fill);
      root.append(video, canvas, bar, counter, statusEl, hintEl);

      const setStatus = (t) => { statusEl.textContent = t; if (onStatus) onStatus(t); };
      const showCount = (n) => {
        counter.textContent = `${n} / ${total}`;
        counter.classList.remove('m-pop'); void counter.offsetWidth; counter.classList.add('m-pop');
      };

      return {
        async start() {
          if (tracker || stopped) return;
          onProgress && onProgress(0, total);
          tracker = await createRepTracker({
            videoEl: video, canvasEl: canvas, exercise,
            onStatus: setStatus,
            onFrame: ({ visible, progress }) => {
              fill.style.transform = `scaleX(${visible ? progress : 0})`;
              if (visible) hintEl.classList.add('m-hidden');
            },
            onRep: (n) => {
              if (done) return;
              showCount(Math.min(n, total));
              onProgress && onProgress(Math.min(n, total), total);
              if (n >= total) {
                done = true;
                setStatus('Done!');
                tracker.stop();         // release the camera as soon as we are finished
                onComplete && onComplete();
              }
            },
          });
          try { await tracker.start(); }
          catch (e) { tracker = null; throw e; } // runner shows the error / retry
        },
        stop() {
          stopped = true;
          if (tracker) { tracker.stop(); tracker = null; }
          video.srcObject = null;
          root.classList.remove('m-cam');
          root.innerHTML = '';
        },
      };
    },
  };
}
