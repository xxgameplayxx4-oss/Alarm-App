# Push-up Alarm

An Alarmy-style wake-up alarm that runs in iPhone Safari. You don't need an App Store app or a Mac.
After your iPhone alarm goes off, this page plays a loud siren until you finish your wake-up missions:

| Mission | How it works |
|---|---|
| 💪 Push-ups | Front camera + on-device pose detection (MediaPipe) counts reps |
| 🏋️ Squats | Same, tracking knee angle |
| 🧮 Math | Solve problems at easy, medium, hard or insane difficulty |
| 🧠 Memory | Remember and re-tap a flashed tile pattern |
| ⌨️ Typing | Type a phrase exactly |
| 📳 Shake | Shake the phone N times |
| 🚶 Steps | Walk N steps |

You can chain missions together. Extras: a siren that gets louder over time, a "Still awake?" check after you finish, a streak counter, and a 5-second-hold emergency stop.

All processing happens on the phone, and video never leaves the device.

## URL options
- `?m=math,pushups` runs these missions for this run only, without changing your saved plan.
- `?n=20` sets the count for the first push-up or squat mission.
- `?auto=1` shows the "Alarm! Tap to start" banner (use this one in the Shortcut).

## iPhone setup
1. Open the site in Safari, then tap **Share → Add to Home Screen**.
2. Open it once, tap ⚙️ to pick your missions, and allow camera and motion access when asked.
3. Open the **Shortcuts** app, then go to **Automation → + → Alarm → "Is Stopped"** (any alarm, or pick one), and choose **Run Immediately**.
   Add the actions **Set Volume 100%** and **Open URLs** with `https://xxgameplayxx4-oss.github.io/Alarm-App/?auto=1`.
4. When the alarm stops, the page opens. Tap **START**, and the siren keeps playing until your missions are done.

Limits: iOS needs one tap before a web page can play sound, and the siren pauses if you leave the page. It restarts when you come back.

## Development
Static files and no build step. Run `python3 -m http.server`, then the tests with `node tests/<name>.test.mjs`.
MediaPipe tasks-vision 0.10.14 and the pose_landmarker_lite model are vendored in `vendor/`.
Bump `CACHE` in `sw.js` whenever you ship changes.
