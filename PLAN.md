# Push-up Alarm — build plan

A static PWA (no build step, vanilla ES modules) hosted on GitHub Pages. User flow on iPhone:
iOS Clock alarm rings → user stops it → Shortcuts automation "When alarm is stopped → Open URL"
opens this page → user taps START (iOS requires a gesture for audio) → loud siren plays and front
camera counts push-ups → siren stops only when the target count is reached → "done" screen.

## Hard constraints
- iPhone Safari (iOS 17+), portrait, front camera. Must work served over HTTPS from a subpath
  (`https://<user>.github.io/pushup-alarm/`) — use RELATIVE paths everywhere.
- No bundler, no npm runtime deps. MediaPipe is vendored in `vendor/` (do not edit it):
  - `vendor/vision_bundle.mjs` (ES module exporting `FilesetResolver`, `PoseLandmarker`, `DrawingUtils`)
  - `vendor/wasm/` (pass `"./vendor/wasm"` resolved against the page URL to `FilesetResolver.forVisionTasks`)
  - `vendor/pose_landmarker_lite.task` (modelAssetPath)
- Audio on iOS: must be unlocked inside a user-gesture handler; Web Audio API (AudioContext) is the
  reliable path. iOS silent switch mutes HTMLAudio less reliably than Web Audio — prefer Web Audio,
  and also play a looping <audio> fallback is NOT needed. navigator.vibrate does not exist on iOS.
- `<video>` must have `playsinline muted autoplay` for iOS.

## Module contracts (ES modules in `js/`)

### js/pose.js  (Agent A)
```js
export async function createPushupTracker({ videoEl, canvasEl, onRep, onStatus, onFrame })
// returns { start(): Promise<void>, stop(): void, reset(): void, get count(): number }
```
- `start()` calls getUserMedia({video:{facingMode:'user', width:{ideal:640}, height:{ideal:480}}, audio:false}),
  attaches to videoEl, loads PoseLandmarker (runningMode 'VIDEO', numPoses 1, GPU delegate with CPU fallback),
  runs a requestAnimationFrame loop calling detectForVideo, draws landmarks/skeleton on canvasEl (mirrored to match the selfie video).
- `onRep(count)` fires on each completed rep. `onStatus(text)` gives coaching text
  ("Loading model…", "Get in frame", "Go down", "Push up!", "Body not visible"...). `onFrame({visible, phase, progress})`
  optional per-frame info (progress 0..1 = how deep in the rep).
- Rep detection must work with the phone propped on the floor / against something in front of the user's head
  (front view) AND from the side. Use a robust approach: primary signal = elbow angle (shoulder–elbow–wrist,
  best-visibility arm) with hysteresis (down < ~100°, up > ~150°); fallback signal when arms are not reliable =
  vertical movement of shoulders/nose normalized by shoulder width, with auto-calibrated baseline + hysteresis.
  A rep = down then up. Debounce (min ~400ms per rep). Ignore frames with low landmark visibility.
- Expose pure functions for unit testing: `export function angle(a,b,c)` and
  `export class RepCounter { update(sample) -> {repCompleted:boolean, phase, progress} }` where sample is
  the 33-landmark array (normalized {x,y,z,visibility}) + timestamp.

### js/alarm.js  (Agent B)
```js
export function createAlarm()
// returns { unlock(): Promise<void>, start(): void, stop(): void, setVolume(v0to1): void,
//           playSuccess(): void, get isPlaying(): boolean }
```
- Web Audio siren: loud, harsh, attention-grabbing (e.g. square/sawtooth sweeping 600–1400Hz + pulsing),
  through a compressor to maximize loudness without clipping. Loops until stop().
- `unlock()` must be called from a tap handler; creates/resumes AudioContext and plays a silent buffer.
- Re-resume the AudioContext on `visibilitychange` when returning visible (iOS suspends it).
- `playSuccess()` = short pleasant chime.

### PWA (Agent B)
- `manifest.webmanifest` (name "Push-up Alarm", start_url "./", display "standalone", dark theme, icons).
- `icons/icon-192.png`, `icons/icon-512.png`, `icons/apple-touch-icon.png` (180) — generate with a script
  (e.g. Python PIL or node canvas — whatever is available), simple bold design.
- `sw.js`: cache-first for app shell + vendor files (versioned cache name), so it works offline after first load.

### UI — index.html, css/style.css, js/app.js  (Agent C)
- Screens: (1) **Start** full-screen: big pulsing red START button, target count shown; small settings link.
  (2) **Workout**: mirrored video with skeleton overlay, giant rep counter "3 / 10", status text, progress ring.
  Siren plays throughout. (3) **Done**: "You're up 💪", streak (days in a row, localStorage), time taken.
  (4) **Settings** (sheet/modal): target reps (5–100), volume, "test siren" button, and a "Copy Shortcut link"
  helper showing the page URL.
- URL params override settings: `?n=20` sets target for this run. `?auto=1` hint text "Alarm! Tap to start".
- Wake Lock API (`navigator.wakeLock.request('screen')`) during workout if available.
- If camera permission denied or fails: show clear error + fallback "manual mode" is NOT allowed to stop the
  siren cheaply — instead offer a retry button. (No easy escape hatch; but include a tiny "emergency stop"
  that requires holding a button for 5 seconds, so the user is never trapped.)
- Register `sw.js`. Link manifest + apple-touch-icon + apple-mobile-web-app-capable meta.
- Mobile-first, safe-area insets, no scroll during workout, big touch targets, dark theme.

---

# Phase 2: Alarmy-style missions (added after user request)

Wake-up "missions" (own implementations, inspired by Alarmy's public feature list; no copied code/assets):
Push-ups, Squats (camera pose), Math, Memory, Typing, Shake, Steps (DeviceMotion). Several missions can be
chained on one alarm; the siren keeps playing until ALL are done. Optional "Wake-up check": N minutes after
finishing, the page asks "Still awake?" and restarts the siren if not tapped within 60 s. Optional volume ramp.

## Mission interface — every file in `js/missions/<id>.js` default-exports:
```js
export default {
  id: 'math',                 // matches filename
  name: 'Math',               // display name
  icon: '🧮',                 // emoji icon
  needs: null,                // null | 'camera' | 'motion'  (runner requests permission inside the START tap)
  defaults: { difficulty: 'medium', count: 3 },   // per-mission config defaults
  settings: [                 // drives the settings UI generically
    { key: 'count', label: 'Problems', type: 'number', min: 1, max: 20 },
    { key: 'difficulty', label: 'Difficulty', type: 'select', options: ['easy','medium','hard','insane'] },
  ],
  // Render into `root` (an empty full-screen <div> the runner owns). Return a controller.
  mount(root, { config, onProgress, onComplete, onStatus }) {
    // onProgress(done, total)  -> runner shows "done / total"
    // onStatus(text)           -> coaching / hint line
    // onComplete()             -> call exactly once when mission finished
    return { async start() {}, stop() {} };   // start() may await camera/model; stop() must release everything
  }
}
```
- Missions must not touch the alarm; the runner owns audio. Missions must clean up all listeners/streams in stop().
- Missions use only CSS classes prefixed `m-` (styles go in `css/missions.css`), dark theme, big touch targets,
  iPhone-portrait friendly, safe areas handled by the runner's container.
- Wrong answers in math/typing/memory should give clear feedback and NOT count; no skipping.
- `js/missions/index.js` exports `MISSIONS` (array of all mission objects in display order) — written by the integrator.

## Motion permission (iOS)
`DeviceMotionEvent.requestPermission()` must be called inside the START tap. The runner does this when any chained
mission has `needs: 'motion'`, before awaiting anything else other than alarm.unlock(). Missions can assume permission.
