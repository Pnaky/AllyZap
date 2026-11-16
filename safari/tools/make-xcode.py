#!/usr/bin/env python3
"""Xcode projekt aplikace AllyZap pro vydání do Mac App Store (safari/release.sh).

    python3 -I make-xcode.py <safari> <web-extension> <iconset> <výstup> <verze> <číslo sestavení> <tým> <bundle id>

Stejné zdrojáky jako safari/build.sh (macos/App, macos/Extension, macos/Shared), Info.plist podle build.sh – navíc
bez nepodepsané varianty a s ITSAppUsesNonExemptEncryption = false. Projekt je ve formátu Xcode 27 (project.xcproj,
JSON); Xcode při sestavení sám doplní údaje o SDK a nástrojích (DTXcode, DTSDKName…), které App Store kontroluje.
Podpis automaticky týmem <tým> – certifikáty a profily si xcodebuild vyžádá sám (-allowProvisioningUpdates).
"""

import json
import plistlib
import shutil
import sys
from pathlib import Path

APP_NAME = "AllyZap"
EXT_NAME = "AllyZap Extension"
MIN_MACOS = "13.0"
COPYRIGHT = "AllyZap © Jan Pňakovič, GNU GPL v3.0. Bez vztahu k Alza.cz a.s."


def fail(message):
    print(f"make-xcode.py: {message}", file=sys.stderr)
    sys.exit(1)


def main():
    if len(sys.argv) != 9:
        fail("použití: make-xcode.py <safari> <web-extension> <iconset> <výstup> <verze> <sestavení> <tým> <bundle id>")
    safari, web, iconset, out = (Path(arg).resolve() for arg in sys.argv[1:5])
    version, build, team, bundle_id = sys.argv[5:9]
    ext_id = f"{bundle_id}.Extension"
    if out.exists():
        shutil.rmtree(out)
    (out / "App").mkdir(parents=True)
    (out / "Extension").mkdir()
    (out / "Shared").mkdir()

    # Zdrojáky a entitlements (jen sandbox – stejné jako build.sh)
    for name in ("main.swift", "AppDelegate.swift", "MainWindowController.swift", "App.entitlements"):
        shutil.copy2(safari / "macos/App" / name, out / "App" / name)
    for name in ("SafariWebExtensionHandler.swift", "Extension.entitlements"):
        shutil.copy2(safari / "macos/Extension" / name, out / "Extension" / name)
    shutil.copy2(safari / "macos/Shared/AlzaNotifications.swift", out / "Shared/AlzaNotifications.swift")
    # Soubory rozšíření (prepare.py) = Resources rozšíření
    shutil.copytree(web, out / "Extension/Resources")
    resources = sorted(item.name for item in (out / "Extension/Resources").iterdir() if not item.name.startswith("."))

    # Ikona v katalogu (App Store chce AppIcon s 512 pt @2x)
    icon_set = out / "App/Assets.xcassets/AppIcon.appiconset"
    icon_set.mkdir(parents=True)
    images = []
    for size in (16, 32, 128, 256, 512):
        for scale in (1, 2):
            name = f"icon_{size}x{size}{'@2x' if scale == 2 else ''}.png"
            if not (iconset / name).is_file():
                fail(f"v {iconset} chybí {name}")
            shutil.copy2(iconset / name, icon_set / name)
            images.append({"filename": name, "idiom": "mac", "scale": f"{scale}x", "size": f"{size}x{size}"})
    (icon_set / "Contents.json").write_text(json.dumps({"images": images, "info": {"author": "xcode", "version": 1}}, indent=2))
    (out / "App/Assets.xcassets/Contents.json").write_text(json.dumps({"info": {"author": "xcode", "version": 1}}, indent=2))

    # Info.plist – proměnné doplní Xcode z nastavení sestavení
    common = {
        "CFBundleDevelopmentRegion": "en",
        "CFBundleExecutable": "$(EXECUTABLE_NAME)",
        "CFBundleIdentifier": "$(PRODUCT_BUNDLE_IDENTIFIER)",
        "CFBundleInfoDictionaryVersion": "6.0",
        "CFBundleShortVersionString": "$(MARKETING_VERSION)",
        "CFBundleVersion": "$(CURRENT_PROJECT_VERSION)",
        "LSMinimumSystemVersion": "$(MACOSX_DEPLOYMENT_TARGET)",
        "NSHumanReadableCopyright": COPYRIGHT,
    }
    app_plist = {
        **common,
        "CFBundleAllowMixedLocalizations": True,
        "CFBundleDisplayName": APP_NAME,
        "CFBundleName": APP_NAME,
        "CFBundlePackageType": "APPL",
        "LSApplicationCategoryType": "public.app-category.shopping",
        "NSHighResolutionCapable": True,
        "NSPrincipalClass": "NSApplication",
        # Aplikace nic nešifruje (síť má jen Safari) – App Store Connect se pak na šifrování neptá
        "ITSAppUsesNonExemptEncryption": False,
        "AlzaExtensionBundleIdentifier": ext_id,
        "AlzaAdHocSigned": False,
    }
    ext_plist = {
        **common,
        "CFBundleDisplayName": APP_NAME,
        "CFBundleName": EXT_NAME,
        "CFBundlePackageType": "$(PRODUCT_BUNDLE_PACKAGE_TYPE)",
        "NSExtension": {
            "NSExtensionPointIdentifier": "com.apple.Safari.web-extension",
            "NSExtensionPrincipalClass": "SafariWebExtensionHandler",
        },
    }
    with open(out / "App/Info.plist", "wb") as handle:
        plistlib.dump(app_plist, handle)
    with open(out / "Extension/Info.plist", "wb") as handle:
        plistlib.dump(ext_plist, handle)

    target_settings = {
        "CODE_SIGN_STYLE": "Automatic",
        "DEVELOPMENT_TEAM": team,
        # Na macOS se bez schopností (capabilities) podepisuje bez profilu – rozšíření by pak ani v exportu pro App Store
        # profil nedostalo (App Store ho vyžaduje u aplikace i rozšíření). Takhle si Xcode zaregistruje App ID a profily
        # pro obě části už při archivu
        "PROVISIONING_PROFILE_REQUIRED": "YES",
        "MARKETING_VERSION": version,
        "CURRENT_PROJECT_VERSION": build,
        "MACOSX_DEPLOYMENT_TARGET": MIN_MACOS,
        "ENABLE_APP_SANDBOX": "YES",
        "ENABLE_HARDENED_RUNTIME": "YES",
        "GENERATE_INFOPLIST_FILE": "NO",
        "PRODUCT_NAME": "$(TARGET_NAME)",
        "SWIFT_VERSION": "5.0",
    }
    project = {
        "default-configuration": "Release",
        "configurations": ["Debug", "Release"],
        "localizations": {"development": "en", "supported": ["Base"]},
        "files": [
            {
                "kind": "group",
                "path": "App",
                "children": [
                    {"path": "main.swift", "target-membership": [f"{APP_NAME}/compile-sources"]},
                    {"path": "AppDelegate.swift", "target-membership": [f"{APP_NAME}/compile-sources"]},
                    {"path": "MainWindowController.swift", "target-membership": [f"{APP_NAME}/compile-sources"]},
                    {"path": "Assets.xcassets", "target-membership": [f"{APP_NAME}/resources"]},
                    {"path": "Info.plist"},
                    {"path": "App.entitlements"},
                ],
            },
            {
                "kind": "group",
                "path": "Shared",
                "children": [
                    {"path": "AlzaNotifications.swift", "target-membership": [f"{APP_NAME}/compile-sources", f"{EXT_NAME}/compile-sources"]},
                ],
            },
            {
                "kind": "group",
                "path": "Extension",
                "children": [
                    {
                        "kind": "group",
                        "path": "<PROJECT>/Extension",
                        "name": "Resources",
                        "children": [{"path": f"Resources/{name}", "target-membership": [f"{EXT_NAME}/resources"]} for name in resources],
                    },
                    {"path": "SafariWebExtensionHandler.swift", "target-membership": [f"{EXT_NAME}/compile-sources"]},
                    {"path": "Info.plist"},
                    {"path": "Extension.entitlements"},
                ],
            },
            {
                "kind": "group",
                "name": "Products",
                "children": [
                    {"path": f"<PRODUCTS>/{APP_NAME}.app", "id": "A11E2A9000000000000000A1", "type": "wrapper.application", "index": False},
                    {
                        "path": f"<PRODUCTS>/{EXT_NAME}.appex",
                        "id": "A11E2A9000000000000000A2",
                        "type": "wrapper.app-extension",
                        "index": False,
                        "target-membership": [{"build-phase": f"{APP_NAME}/copy/Embed Foundation Extensions", "header-preservation": "remove-on-copy"}],
                    },
                ],
            },
        ],
        "targets": [
            {
                "name": APP_NAME,
                "id": "A11E2A9000000000000000B1",
                "product": f"Products/{APP_NAME}.app",
                "product-type": "application",
                "dependencies": [EXT_NAME],
                "build-phases": [
                    "compile-sources",
                    "frameworks",
                    "resources",
                    {"kind": "copy", "name": "Embed Foundation Extensions", "bundle-base-path": "plugins-directory"},
                ],
                "build-settings": {
                    **target_settings,
                    "ASSETCATALOG_COMPILER_APPICON_NAME": "AppIcon",
                    "CODE_SIGN_ENTITLEMENTS": "App/App.entitlements",
                    "INFOPLIST_FILE": "App/Info.plist",
                    "LD_RUNPATH_SEARCH_PATHS": ["$(inherited)", "@executable_path/../Frameworks"],
                    "OTHER_LDFLAGS": ["-framework", "SafariServices"],
                    "PRODUCT_BUNDLE_IDENTIFIER": bundle_id,
                },
            },
            {
                "name": EXT_NAME,
                "id": "A11E2A9000000000000000B2",
                "product": f"Products/{EXT_NAME}.appex",
                "product-type": "app-extension",
                "build-phases": ["compile-sources", "frameworks", "resources"],
                "build-settings": {
                    **target_settings,
                    "CODE_SIGN_ENTITLEMENTS": "Extension/Extension.entitlements",
                    "INFOPLIST_FILE": "Extension/Info.plist",
                    "LD_RUNPATH_SEARCH_PATHS": ["$(inherited)", "@executable_path/../Frameworks", "@executable_path/../../../../Frameworks"],
                    "OTHER_LDFLAGS": ["-framework", "SafariServices"],
                    "PRODUCT_BUNDLE_IDENTIFIER": ext_id,
                    "SKIP_INSTALL": "YES",
                },
            },
        ],
        "build-settings": {
            "ALWAYS_SEARCH_USER_PATHS": "NO",
            "CLANG_ENABLE_MODULES": "YES",
            "CLANG_ENABLE_OBJC_ARC": "YES",
            "COPY_PHASE_STRIP": "NO",
            "DEBUG_INFORMATION_FORMAT[config=Debug]": "dwarf",
            "DEBUG_INFORMATION_FORMAT[config=Release]": "dwarf-with-dsym",
            "ENABLE_STRICT_OBJC_MSGSEND": "YES",
            "ENABLE_USER_SCRIPT_SANDBOXING": "YES",
            "MACOSX_DEPLOYMENT_TARGET": MIN_MACOS,
            "ONLY_ACTIVE_ARCH[config=Debug]": "YES",
            "SDKROOT": "macosx",
            "SWIFT_COMPILATION_MODE[config=Release]": "wholemodule",
            "SWIFT_OPTIMIZATION_LEVEL[config=Debug]": "-Onone",
        },
    }
    (out / f"{APP_NAME}.xcodeproj").mkdir()
    (out / f"{APP_NAME}.xcodeproj/project.xcproj").write_text(json.dumps(project, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Xcode projekt {APP_NAME} {version} ({build}) pro tým {team}: {out}")


if __name__ == "__main__":
    main()
