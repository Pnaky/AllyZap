#!/bin/bash
# Testy Safari vrstvy ve WebKitu (WKWebView – stejný engine jako Safari) a nativní části, bez Safari a bez instalace:
#   safari/tests/run.sh
#   SNAPSHOTS=<složka> safari/tests/run.sh   – navíc snímky všech stránek rozšíření (kontrola vzhledu očima)
# Stránka na pozadí, průvodce a ostatní stránky (nastavení po záložkách, popup, nápověda, Co je nového) běží
# s napodobeným API Safari (tests/mock-safari.js) – bez chrome.notifications, nativní aplikaci zastupuje mock.
# Ceny ze stránek Alzy test nestahuje (parser je stejný jako v Chrome / Firefoxu).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UPSTREAM="${UPSTREAM:-$(cd "$ROOT/.." && pwd)}"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/alza-safari-tests.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

/usr/bin/python3 -I "$ROOT/tools/prepare.py" "$UPSTREAM" "$ROOT" "$WORK/ext" >/dev/null
cp "$ROOT/tests/mock-safari.js" "$ROOT/tests/background.test.js" "$ROOT/tests/welcome.test.js" "$ROOT/tests/pages.test.js" "$WORK/"
/usr/bin/python3 -I "$ROOT/tests/make-pages.py" "$WORK"
SDK="$(xcrun --sdk macosx --show-sdk-path)"
swiftc -O -sdk "$SDK" "$ROOT/tests/WebHarness.swift" -o "$WORK/WebHarness"
swiftc -sdk "$SDK" -swift-version 5 "$ROOT/tests/NativeTests/main.swift" \
  "$ROOT/macos/Extension/SafariWebExtensionHandler.swift" "$ROOT/macos/Shared/AlzaNotifications.swift" -o "$WORK/NativeTests"

status=0
echo "== Stránka na pozadí"
"$WORK/WebHarness" "$WORK/background.html" "$WORK" || status=1
echo
echo "== Průvodce nastavením"
"$WORK/WebHarness" "$WORK/ext/src/welcome/welcome-test.html" "$WORK" || status=1
echo
echo "== Stránky rozšíření"
# stránka#kotva:šířkaxvýška – Moje data a Nastavení po záložkách, popup, novinky a nápověda ve všech jazycích
PAGES=(
  "options#lists:1280x1100" "options#products:1280x1100" "options#owned:1280x1100" "options#codes:1280x1100"
  "options#hidden:1280x1100" "options#data:1280x1100"
  "options#s-tracking:1280x2200" "options#s-notifications:1280x2200" "options#s-categories:1280x2200"
  "options#s-general:1280x2200" "options#s-log:1280x1100"
  "popup:420x700" "welcome#news:1100x1100"
  "help:1100x6000" "help-sk:1100x6000" "help-hu:1100x6000" "help-en:1100x6000"
)
[ -n "${SNAPSHOTS:-}" ] && mkdir -p "$SNAPSHOTS"
for entry in "${PAGES[@]}"; do
  target="${entry%%:*}"
  file="${target%%#*}"
  folder="$file"; case "$file" in help*) folder=help ;; esac
  anchor=""; [ "$target" != "$file" ] && anchor="#${target#*#}"
  shot=""; [ -n "${SNAPSHOTS:-}" ] && shot="$SNAPSHOTS/$(echo "$target" | tr '#' '-').png"
  HARNESS_SIZE="${entry##*:}" HARNESS_SNAPSHOT="$shot" \
    "$WORK/WebHarness" "$WORK/ext/src/$folder/$file-pages-test.html$anchor" "$WORK" || status=1
done
echo
echo "== Nativní část (SafariWebExtensionHandler)"
"$WORK/NativeTests" || status=1
exit $status
