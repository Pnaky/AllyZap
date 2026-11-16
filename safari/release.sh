#!/bin/bash
# Vydání AllyZap pro Mac App Store: Xcode projekt ze stejných zdrojáků jako build.sh, archiv a export pro
# App Store Connect (podepsaný instalační balíček .pkg), volitelně rovnou nahrání.
#
#   safari/release.sh            balíček do safari/build-release/export/AllyZap.pkg
#   safari/release.sh --upload   balíček rovnou nahraje do App Store Connect (Xcode → Settings → Accounts)
#   safari/release.sh --test     zkušební sestavení z vývojové verze RRRR.M.D.N (verze pro App Store = RRRR.M.D)
#
# Potřebuje Xcode přihlášené k vývojářskému účtu (Settings → Accounts) a běží v přihlášené relaci na obrazovce
# (podpis z klíčenky) – z notebooku přes tools/safari-release.sh. Certifikáty Apple Distribution a Mac Installer
# Distribution, App ID rozšíření a profily si xcodebuild vyžádá sám (-allowProvisioningUpdates).
#
# Proměnné prostředí: TEAM_ID (výchozí 8L2SZ35SH2), BUNDLE_ID (výchozí cz.janpnakovic.allyzap),
# UPSTREAM (složka rozšíření s manifest.json, výchozí kořen repozitáře), BUILD_DIR (výchozí safari/build-release)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
UPSTREAM="${UPSTREAM:-$(cd "$ROOT/.." && pwd)}"
BUILD="${BUILD_DIR:-$ROOT/build-release}"
TEAM_ID="${TEAM_ID:-8L2SZ35SH2}"
BUNDLE_ID="${BUNDLE_ID:-cz.janpnakovic.allyzap}"
JSC=/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc

UPLOAD=0
TEST=0
for arg in "$@"; do
  case "$arg" in
    --upload) UPLOAD=1 ;;
    --test) TEST=1 ;;
    *) echo "neznámá volba: $arg" >&2; exit 2 ;;
  esac
done

step() { printf '\n==> %s\n' "$*"; }
die() { printf '\nChyba: %s\n' "$*" >&2; exit 1; }

command -v xcodebuild >/dev/null || die "chybí Xcode (xcodebuild)"
MANIFEST_VERSION="$(/usr/bin/python3 -I -c 'import json, sys; print(json.load(open(sys.argv[1], encoding="utf-8"))["version"])' "$UPSTREAM/manifest.json")"
# App Store bere nejvýš tři čísla – vydání má RRRR.M.D (vývojová RRRR.M.D.N jen zkušebně)
if [[ "$MANIFEST_VERSION" =~ ^[0-9]{4}\.[0-9]{1,2}\.[0-9]{1,2}$ ]]; then
  VERSION="$MANIFEST_VERSION"
elif [ "$TEST" = 1 ] && [[ "$MANIFEST_VERSION" =~ ^([0-9]{4}\.[0-9]{1,2}\.[0-9]{1,2})\.[0-9]+$ ]]; then
  VERSION="${BASH_REMATCH[1]}"
  [ "$UPLOAD" = 0 ] || die "zkušební sestavení (--test) se nenahrává"
else
  die "verze $MANIFEST_VERSION není verze vydání (RRRR.M.D) – zkušebně: --test"
fi
# Číslo sestavení: jedno celé číslo, každé nahrání vyšší (App Store odmítne stejné nebo nižší)
BUILD_NUMBER="$(date +%Y%m%d%H%M)"

case "$BUILD" in "$ROOT/build-release" | */build-release) ;; *) die "BUILD_DIR musí končit /build-release (složka se maže)" ;; esac
rm -rf "$BUILD"
mkdir -p "$BUILD"

step "Rozšíření $MANIFEST_VERSION pro Safari"
/usr/bin/python3 -I "$ROOT/tools/prepare.py" "$UPSTREAM" "$ROOT" "$BUILD/web-extension"
if [ -x "$JSC" ]; then
  count=0
  while IFS= read -r -d '' file; do
    "$JSC" -e 'checkSyntax(arguments[0])' -- "$file" >/dev/null || die "chyba syntaxe v ${file#"$BUILD/web-extension/"}"
    count=$((count + 1))
  done < <(find "$BUILD/web-extension" -name '*.js' -print0)
  echo "syntaxe: $count souborů v pořádku"
fi

step "Ikona"
SDK="$(xcrun --sdk macosx --show-sdk-path)"
swiftc -sdk "$SDK" -swift-version 5 "$ROOT/macos/Tools/MakeIcon.swift" -o "$BUILD/make-icon"
"$BUILD/make-icon" "$BUILD/AppIcon.iconset"

step "Xcode projekt (verze $VERSION, sestavení $BUILD_NUMBER, tým $TEAM_ID)"
/usr/bin/python3 -I "$ROOT/tools/make-xcode.py" "$ROOT" "$BUILD/web-extension" "$BUILD/AppIcon.iconset" "$BUILD/project" \
  "$VERSION" "$BUILD_NUMBER" "$TEAM_ID" "$BUNDLE_ID"

step "Archiv (xcodebuild archive)"
# Archiv se podepisuje vývojovým profilem – ten Apple vydá jen pro Mac zaregistrovaný v týmu (Devices); xcodebuild
# ho při prvním sestavení zaregistruje sám (cíl = tento Mac; Release se i tak sestaví pro arm64 i x86_64)
xcodebuild -project "$BUILD/project/AllyZap.xcodeproj" -scheme AllyZap -configuration Release \
  -destination "platform=macOS" -archivePath "$BUILD/AllyZap.xcarchive" \
  -allowProvisioningUpdates -allowProvisioningDeviceRegistration archive >"$BUILD/archive.log" 2>&1 || { tail -40 "$BUILD/archive.log"; die "archiv se nepovedl (celý výpis: $BUILD/archive.log)"; }
echo "archiv: $BUILD/AllyZap.xcarchive"

DESTINATION=export
[ "$UPLOAD" = 1 ] && DESTINATION=upload
cat >"$BUILD/ExportOptions.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>method</key>
	<string>app-store-connect</string>
	<key>destination</key>
	<string>$DESTINATION</string>
	<key>teamID</key>
	<string>$TEAM_ID</string>
	<key>signingStyle</key>
	<string>automatic</string>
	<key>manageAppVersionAndBuildNumber</key>
	<false/>
	<key>uploadSymbols</key>
	<true/>
</dict>
</plist>
EOF

step "Export pro App Store Connect ($DESTINATION)"
xcodebuild -exportArchive -archivePath "$BUILD/AllyZap.xcarchive" -exportPath "$BUILD/export" \
  -exportOptionsPlist "$BUILD/ExportOptions.plist" -allowProvisioningUpdates >"$BUILD/export.log" 2>&1 \
  || { tail -40 "$BUILD/export.log"; die "export se nepovedl (celý výpis: $BUILD/export.log)"; }

if [ "$UPLOAD" = 1 ]; then
  printf '\nNahráno do App Store Connect: AllyZap %s (%s). Build se objeví v TestFlight / u verze po zpracování (desítky minut).\n' "$VERSION" "$BUILD_NUMBER"
else
  PKG="$(find "$BUILD/export" -name '*.pkg' -maxdepth 1 | head -1)"
  [ -n "$PKG" ] || die "export nevytvořil .pkg (výpis: $BUILD/export.log)"
  pkgutil --check-signature "$PKG" | head -4
  printf '\nHotovo: %s (AllyZap %s, sestavení %s)\n' "$PKG" "$VERSION" "$BUILD_NUMBER"
fi
