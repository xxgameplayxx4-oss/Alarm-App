#!/usr/bin/env bash
# Copies the web app into the APK's assets and uses its icon as the launcher icon.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
app="$root/android/app/src/main"
rm -rf "$app/assets/www"
mkdir -p "$app/assets/www" "$app/res/mipmap-xxxhdpi"
cp -r "$root"/index.html "$root"/manifest.webmanifest "$root"/version.txt \
      "$root"/css "$root"/js "$root"/icons "$root"/vendor "$app/assets/www/"
cp "$root/icons/icon-192.png" "$app/res/mipmap-xxxhdpi/ic_launcher.png"
