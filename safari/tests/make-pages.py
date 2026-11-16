#!/usr/bin/env python3
"""Testovací stránky pro WebHarness (tests/run.sh): <work>/background.html a <work>/ext/src/welcome/welcome-test.html.

Stránka na pozadí načte skripty v pořadí z manifestu pro Safari, průvodce je kopie welcome.html z rozšíření
pro Safari. Před skripty rozšíření jde vždy napodobenina API Safari (mock-safari.js), na konec test.
"""

import html
import json
import sys
from pathlib import Path

work = Path(sys.argv[1]).resolve()
ext = work / "ext"
manifest = json.loads((ext / "manifest.json").read_text(encoding="utf-8"))
manifest_script = f"<script>window.__MANIFEST__ = {json.dumps(manifest, ensure_ascii=False)};</script>"


def tag(src):
    return f'<script src="{html.escape(src)}"></script>'


UTF8_BOM = b"\xef\xbb\xbf"

# Testovací soubory (kopie v <work>) potřebují značku UTF-8 stejně jako skripty rozšíření (prepare.py)
for name in ("mock-safari.js", "background.test.js", "welcome.test.js", "pages.test.js"):
    path = work / name
    data = path.read_bytes()
    if not data.startswith(UTF8_BOM):
        path.write_bytes(UTF8_BOM + data)

# Jako _generated_background_page.html v Safari: bez deklarace kódování – skript bez značky UTF-8 se pak
# přečte špatně a test to odhalí
background = "\n".join(
    [
        "<!doctype html>",
        "<title>Safari background test</title>",
        "<script>window.__FAKE_TIMERS__ = true;</script>",
        f"<script>window.__MANIFEST__ = {json.dumps(manifest, ensure_ascii=True)};</script>",
        tag("mock-safari.js"),
        *(tag(f"ext/{script}") for script in manifest["background"]["scripts"]),
        tag("background.test.js"),
        "",
    ]
)
(work / "background.html").write_text(background, encoding="utf-8")

welcome = (ext / "src/welcome/welcome.html").read_text(encoding="utf-8")
first_script = welcome.index("<script src=")
welcome = welcome[:first_script] + manifest_script + "\n    " + tag("../../../mock-safari.js") + "\n    " + welcome[first_script:]
end = welcome.rindex("</body>")
welcome = welcome[:end] + "  " + tag("../../../welcome.test.js") + "\n  " + welcome[end:]
(ext / "src/welcome/welcome-test.html").write_text(welcome, encoding="utf-8")

# Ostatní stránky rozšíření (pages.test.js): <stránka>-pages-test.html vedle originálu, ať platí relativní cesty.
# Napodobenina API před první skript stránky, test na konec. Průvodce je už upravený pro Safari (prepare.py)
PAGES = ["src/options/options.html", "src/popup/popup.html", "src/welcome/welcome.html",
         "src/help/help.html", "src/help/help-sk.html", "src/help/help-hu.html", "src/help/help-en.html"]
for relative in PAGES:
    source = ext / relative
    text = source.read_text(encoding="utf-8")
    first = text.index("<script src=")
    text = text[:first] + manifest_script + "\n    " + tag("../../../mock-safari.js") + "\n    " + text[first:]
    end = text.rindex("</body>")
    text = text[:end] + "  " + tag("../../../pages.test.js") + "\n  " + text[end:]
    source.with_name(source.stem + "-pages-test.html").write_text(text, encoding="utf-8")
