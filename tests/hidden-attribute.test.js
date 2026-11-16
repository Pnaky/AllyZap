// Atribut hidden musí prvek skrýt na každé stránce rozšíření – i když mu styl stránky nastavuje display (flex,
// inline-flex…). Jinak je vidět prázdný řádek nebo tlačítko, které tam být nemá (popup: Novinky po přečtení
// a prázdný řádek Kódy a poukazy se šipkou, nalezeno testem stránek v Safari 2026-11-16).
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const HIDDEN_RULE = /\[hidden\]\s*\{\s*display:\s*none\s*!important;?\s*\}/;

function pages(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) return pages(full);
    return entry.name.endsWith(".html") ? [full] : [];
  });
}

test("každá stránka rozšíření skryje prvek s atributem hidden vždy", () => {
  const pageCss = fs.readFileSync(path.join(ROOT, "src/shared/page.css"), "utf8");
  assert.match(pageCss, HIDDEN_RULE, "src/shared/page.css");
  const missing = pages(path.join(ROOT, "src"))
    .filter((file) => !file.includes(`${path.sep}offscreen${path.sep}`)) // bez zobrazení
    .filter((file) => {
      const html = fs.readFileSync(file, "utf8");
      return !html.includes("shared/page.css") && !HIDDEN_RULE.test(html);
    })
    .map((file) => path.relative(ROOT, file));
  assert.deepStrictEqual(missing, [], "stránky bez pravidla [hidden] { display: none !important } (ani page.css)");
});
