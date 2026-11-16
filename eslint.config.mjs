// ESLint jen na banální chyby (nedefinovaná proměnná, překlep v názvu, nedosažitelný kód, duplicitní klíč…), ne na styl.
// Spouští ho pre-commit hook: npx --yes eslint@10 . (konfigurace se najde sama). Skripty rozšíření jsou klasické
// skripty se sdíleným globálním prostorem (pořadí v manifestu a HTML) – sdílené názvy se berou z deklarací na nejvyšší
// úrovni všech souborů v src/ a safari/src/
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const listJs = (dir) =>
  fs.existsSync(dir)
    ? fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const file = path.join(dir, entry.name);
        return entry.isDirectory() ? listJs(file) : file.endsWith(".js") ? [file] : [];
      })
    : [];

// Názvy z rozkladu "{ a, b: c, d = 1, ...e }" / "[a, , b]" (jen první úroveň – víc se nepoužívá)
function patternNames(pattern) {
  const inner = pattern.trim().slice(1, -1);
  const parts = [];
  let depth = 0;
  let current = "";
  for (const char of inner) {
    if ("{[(".includes(char)) depth++;
    if ("}])".includes(char)) depth--;
    if (char === "," && depth === 0) {
      parts.push(current);
      current = "";
    } else current += char;
  }
  parts.push(current);
  return parts
    .map((part) => part.replace(/=[\s\S]*$/, "").trim())
    .filter(Boolean)
    .map((part) => (part.startsWith("...") ? part.slice(3) : part.includes(":") ? part.split(":").pop().trim() : part))
    .filter((name) => /^[A-Za-z_$][\w$]*$/.test(name));
}

function sharedGlobals() {
  const names = {};
  for (const file of ["src", "safari/src", "safari/tests"].flatMap((dir) => listJs(path.join(ROOT, dir)))) {
    const text = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
    for (const [, name] of text.matchAll(/^(?:const|let|var|class|function\*?|async function\*?)\s+([A-Za-z_$][\w$]*)/gm)) names[name] = "writable";
    for (const [, pattern] of text.matchAll(/^(?:const|let|var)\s+(\{[\s\S]*?\}|\[[\s\S]*?\])\s*=/gm)) patternNames(pattern).forEach((name) => (names[name] = "writable"));
    for (const [, name] of text.matchAll(/^(?:globalThis|self|window)\.([A-Za-z_$][\w$]*)\s*=/gm)) names[name] = "writable";
  }
  return names;
}

const browserGlobals = Object.fromEntries(
  `window document navigator location console setTimeout clearTimeout setInterval clearInterval fetch URL URLSearchParams Blob File
  FileReader HTMLElement Element Node NodeFilter MutationObserver IntersectionObserver ResizeObserver CustomEvent Event KeyboardEvent
  MouseEvent PointerEvent FocusEvent InputEvent DOMParser Intl structuredClone requestAnimationFrame cancelAnimationFrame
  getComputedStyle matchMedia history localStorage sessionStorage crypto TextEncoder TextDecoder AbortController AbortSignal
  Response Request Headers FormData Image alert confirm prompt self globalThis importScripts performance queueMicrotask atob btoa CSS
  DocumentFragment SVGElement Range Selection getSelection screen devicePixelRatio innerWidth innerHeight scrollX scrollY open print
  caches clients registration OffscreenCanvas createImageBitmap ImageData XMLHttpRequest WebSocket Worker BroadcastChannel
  MessageChannel postMessage addEventListener removeEventListener dispatchEvent HTMLInputElement HTMLSelectElement HTMLTextAreaElement
  HTMLAnchorElement HTMLImageElement HTMLCanvasElement HTMLTemplateElement Path2D DOMRect ClipboardItem Notification indexedDB
  EventTarget DOMException ShadowRoot customElements Text Comment Document Window NodeList HTMLCollection DataTransfer FileList
  ReadableStream WritableStream TransformStream CompressionStream DecompressionStream
  Option Audio chrome browser safari content`
    .split(/\s+/)
    .filter(Boolean)
    .map((name) => [name, "readonly"])
);
const nodeGlobals = Object.fromEntries(
  "require module exports __dirname __filename process Buffer console setTimeout clearTimeout setInterval clearInterval structuredClone URL URLSearchParams TextEncoder TextDecoder globalThis queueMicrotask AbortSignal AbortController atob btoa fetch Response Request Headers crypto"
    .split(" ")
    .map((name) => [name, "readonly"])
);

const rules = {
  "no-undef": "error",
  "no-dupe-keys": "error",
  "no-dupe-class-members": "error",
  "no-dupe-else-if": "error",
  "no-duplicate-case": "error",
  "no-unreachable": "error",
  "no-const-assign": "error",
  "no-func-assign": "error",
  "no-self-assign": "error",
  "no-self-compare": "error",
  "no-cond-assign": "error",
  "no-constant-condition": ["error", { checkLoops: false }],
  "no-constant-binary-expression": "error",
  "no-unsafe-negation": "error",
  "no-unsafe-optional-chaining": "error",
  "no-unsafe-finally": "error",
  "no-sparse-arrays": "error",
  "no-loss-of-precision": "error",
  "no-async-promise-executor": "error",
  "no-unmodified-loop-condition": "error",
  "no-invalid-regexp": "error",
  "no-empty-character-class": "error",
  "no-useless-backreference": "error",
  "no-misleading-character-class": "error",
  "use-isnan": "error",
  "valid-typeof": "error",
  "getter-return": "error",
  "no-setter-return": "error",
  "for-direction": "error",
  "no-compare-neg-zero": "error",
  "no-redeclare": ["error", { builtinGlobals: false }],
  "no-shadow-restricted-names": "error",
  "no-unused-vars": ["error", { vars: "local", args: "none", caughtErrors: "none", ignoreRestSiblings: true }],
};

export default [
  { ignores: ["**/node_modules/**", "**/build/**", "safari/macos/**"] },
  {
    // safari/tests běží v prohlížeči (WebHarness.swift), ne v Node
    files: ["src/**/*.js", "safari/src/**/*.js", "safari/tests/**/*.js"],
    languageOptions: { ecmaVersion: 2024, sourceType: "script", globals: { ...browserGlobals, ...sharedGlobals() } },
    rules,
  },
  {
    // Kontrola AMO (a bezpečnost): HTML z řetězce ani spouštění kódu z textu – obsah stránky Alzy je cizí vstup.
    // Povolené je jen vyprázdnění (innerHTML = "")
    files: ["src/**/*.js", "safari/src/**/*.js"],
    rules: {
      "no-restricted-syntax": [
        "error",
        { selector: "AssignmentExpression[left.property.name=/^(innerHTML|outerHTML)$/]:not([right.type='Literal'][right.value=''])", message: "HTML z řetězce – použijte DOM (createElement, textContent)" },
        { selector: "CallExpression[callee.property.name='insertAdjacentHTML']", message: "insertAdjacentHTML – použijte DOM" },
        { selector: "CallExpression[callee.object.name='document'][callee.property.name=/^(write|writeln)$/]", message: "document.write" },
        { selector: "CallExpression[callee.name=/^(setTimeout|setInterval)$/][arguments.0.type=/^(Literal|TemplateLiteral)$/]", message: "časovač s kódem v řetězci" },
      ],
      "no-eval": "error",
      "no-implied-eval": "error",
      "no-new-func": "error",
      "no-script-url": "error",
    },
  },
  {
    files: ["tests/**/*.js", "safari/tools/**/*.js"],
    languageOptions: { ecmaVersion: 2024, sourceType: "commonjs", globals: nodeGlobals },
    rules,
  },
  {
    files: ["eslint.config.mjs"],
    languageOptions: { ecmaVersion: 2024, sourceType: "module", globals: nodeGlobals },
    rules,
  },
];
