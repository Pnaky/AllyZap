// Kouřový test načtení: každá skupina skriptů (content scripty a pozadí z manifestu, service worker Chromu přes
// importScripts, popup, nastavení, průvodce, nápověda) se načte v deklarovaném pořadí do izolovaného prostředí.
// Prohlížeč nahrazuje tolerantní náhrada (každá vlastnost i volání vrací zase náhradu), takže kód při načtení
// doběhne – spadne jen na chybě, kterou by udělal i v prohlížeči: nedefinovaný název (překlep, špatné pořadí
// skriptů, soubor chybí v seznamu) nebo syntaxe. Pokrývá i soubory, které žádný jiný test nespouští
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");
const manifest = JSON.parse(read("manifest.json"));

// Tolerantní náhrada: funkce i objekt zároveň, then = undefined (await na ní neuvízne), převod na text = ""
function stub(name = "stub") {
  const target = function () {};
  return new Proxy(target, {
    get(_, key) {
      if (key === "then") return undefined;
      if (key === Symbol.toPrimitive) return () => "";
      if (key === Symbol.iterator) return function* () {};
      if (key === "length") return 0;
      if (key === "toString" || key === "valueOf") return () => "";
      return stub(`${name}.${String(key)}`);
    },
    apply: () => stub(`${name}()`),
    construct: () => stub(`new ${name}`),
    has: () => true,
    set: () => true,
  });
}

// Prostředí: skutečné vestavěné objekty JavaScriptu, prohlížečové API jako náhrada; neznámý název = ReferenceError
// jako v prohlížeči (globalThis není Proxy, jen obsahuje náhrady pro API prohlížeče)
function createEnvironment(baseDir, loaded) {
  const browserApi = `window document navigator location chrome browser safari content self localStorage sessionStorage
    MutationObserver IntersectionObserver ResizeObserver CustomEvent Event KeyboardEvent MouseEvent DOMParser HTMLElement Element Node
    NodeFilter Image Option Audio Blob File FileReader FormData Headers Request Response AbortController AbortSignal fetch history
    getComputedStyle matchMedia requestAnimationFrame cancelAnimationFrame alert confirm prompt open print screen getSelection
    caches clients registration OffscreenCanvas createImageBitmap ImageData XMLHttpRequest BroadcastChannel MessageChannel postMessage
    addEventListener removeEventListener dispatchEvent CSS ClipboardItem Notification indexedDB performance crypto innerWidth innerHeight
    scrollX scrollY devicePixelRatio customElements DocumentFragment`
    .split(/\s+/)
    .filter(Boolean);
  const context = { console: { log() {}, info() {}, warn() {}, error() {}, debug() {} } };
  browserApi.forEach((name) => (context[name] = stub(name)));
  Object.assign(context, { setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {}, queueMicrotask() {} });
  Object.assign(context, { URL, URLSearchParams, TextEncoder, TextDecoder, structuredClone, atob, btoa, Intl });
  context.importScripts = (...files) => files.forEach((file) => run(path.posix.join(baseDir, file)));
  vm.createContext(context);
  context.globalThis = context;
  const run = (file) => {
    loaded.push(file);
    vm.runInContext(read(file), context, { filename: file });
  };
  return run;
}

function loadGroup(files, baseDir = "") {
  const loaded = [];
  const run = createEnvironment(baseDir, loaded);
  const errors = [];
  const onRejection = () => {}; // Nedokončené async kroky s náhradou – nejsou chyba načtení
  process.on("unhandledRejection", onRejection);
  try {
    for (const file of files) {
      try {
        run(file);
      } catch (error) {
        // Chyby, které by nastaly i v prohlížeči; TypeError z náhrady (např. new URL(náhrada)) se nepočítá
        if (error?.name === "ReferenceError" || error?.name === "SyntaxError") errors.push(`${file}: ${error.name}: ${error.message}`);
      }
    }
  } finally {
    process.off("unhandledRejection", onRejection);
  }
  return { errors, loaded };
}

// <script src> stránky v pořadí, cesty od kořene repozitáře
function pageScripts(page) {
  const dir = path.posix.dirname(page);
  return [...read(page).matchAll(/<script[^>]*\ssrc="([^"]+)"/g)].map(([, src]) => path.posix.normalize(path.posix.join(dir, src)));
}

test("kouřový test: content scripty z manifestu se načtou v pořadí bez nedefinovaných názvů", () => {
  manifest.content_scripts.forEach((group) => {
    const { errors } = loadGroup(group.js);
    assert.deepEqual(errors, [], group.js.join(", "));
  });
});

test("kouřový test: pozadí Firefoxu (background.scripts) i service worker Chromu (importScripts) se načtou", () => {
  assert.deepEqual(loadGroup(manifest.background.scripts).errors, []);
  const worker = manifest.background.service_worker;
  const { errors, loaded } = loadGroup([worker], path.posix.dirname(worker));
  assert.deepEqual(errors, []);
  // Chrome načítá stejné skripty jako Firefox (jen vlastní product-pages.js); rozbor stránky produktu
  // (shared/product-page.js – DOMParser) dělá v Chromu offscreen dokument, service worker DOMParser nemá
  const name = (file) => path.posix.basename(file);
  assert.deepEqual(loaded.slice(1).map(name), manifest.background.scripts.map(name).filter((file) => file !== "product-page.js"));
  assert.ok(pageScripts("src/chrome/offscreen/offscreen.html").includes("src/shared/product-page.js"), "offscreen bez product-page.js");
});

test("kouřový test: stránky rozšíření (popup, nastavení, průvodce, nápověda, offscreen) se načtou", () => {
  const pages = [];
  const walk = (dir) =>
    fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).forEach((entry) => {
      const file = path.posix.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (file.endsWith(".html")) pages.push(file);
    });
  walk("src");
  assert.ok(pages.length >= 5, `stránky: ${pages.join(", ")}`);
  for (const page of pages) {
    const scripts = pageScripts(page);
    scripts.forEach((file) => assert.ok(fs.existsSync(path.join(ROOT, file)), `${page}: chybí ${file}`));
    assert.deepEqual(loadGroup(scripts).errors, [], page);
  }
});

test("kouřový test sám chytí nedefinovaný název a špatné pořadí skriptů", () => {
  const dir = fs.mkdtempSync(path.join(require("os").tmpdir(), "alza-smoke-"));
  try {
    const relative = path.relative(ROOT, dir).split(path.sep).join("/");
    fs.writeFileSync(path.join(dir, "a.js"), "const Shared = { ok: true };\n");
    fs.writeFileSync(path.join(dir, "b.js"), "const Uses = Shared.ok;\n");
    fs.writeFileSync(path.join(dir, "typo.js"), "const Uses = Shraed.ok;\n");
    assert.deepEqual(loadGroup([`${relative}/a.js`, `${relative}/b.js`]).errors, []);
    assert.equal(loadGroup([`${relative}/b.js`, `${relative}/a.js`]).errors.length, 1, "špatné pořadí");
    assert.equal(loadGroup([`${relative}/a.js`, `${relative}/typo.js`]).errors.length, 1, "překlep");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
