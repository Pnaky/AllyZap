// Načte src/shared/core.js do izolovaného kontextu s náhradou chrome.* (úložiště v paměti) – pro testy
// v Node bez prohlížeče: node --test tests/
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");

function createChromeMock(initial = {}) {
  const data = structuredClone(initial);
  const listeners = [];
  const pick = (keys) => {
    if (keys === null || keys === undefined) return structuredClone(data);
    const list = Array.isArray(keys) ? keys : typeof keys === "string" ? [keys] : Object.keys(keys);
    return Object.fromEntries(list.filter((key) => Object.hasOwn(data, key)).map((key) => [key, structuredClone(data[key])]));
  };
  const notify = (changes) => Object.keys(changes).length && listeners.forEach((listener) => listener(changes, "local"));
  const local = {
    data,
    async get(keys) {
      return pick(keys);
    },
    async set(items) {
      const changes = {};
      Object.entries(structuredClone(items)).forEach(([key, value]) => {
        changes[key] = { oldValue: data[key], newValue: value };
        data[key] = value;
      });
      notify(changes);
    },
    async remove(keys) {
      const changes = {};
      (Array.isArray(keys) ? keys : [keys]).forEach((key) => {
        if (!Object.hasOwn(data, key)) return;
        changes[key] = { oldValue: data[key] };
        delete data[key];
      });
      notify(changes);
    },
  };
  return {
    storage: { local, onChanged: { addListener: (listener) => listeners.push(listener) } },
    runtime: { getManifest: () => ({ version: "test" }), getURL: (file) => `chrome-extension://test/${file}`, sendMessage: async () => undefined },
    i18n: { getUILanguage: () => "cs-CZ", getMessage: () => "" },
  };
}

// Vrací { AlzaCore, chrome, context }. files = další skripty načtené po core.js (sdílejí globální prostor)
function loadCore({ storage = {}, files = [] } = {}) {
  const chrome = createChromeMock(storage);
  const context = vm.createContext({ chrome, console, setTimeout, clearTimeout, URL, structuredClone });
  context.globalThis = context;
  for (const file of ["src/shared/core.js", ...files]) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, file), "utf8"), context, { filename: file });
  }
  return { AlzaCore: context.AlzaCore, chrome, context };
}

// Služba na pozadí (src/background.js) se skripty z manifestu; ProductPages je náhrada (nic nestahuje).
// Navíc proti createChromeMock: alarmy, ikona, záložky, storage.session a notifikace – notifications.created =
// vytvořené, notifications.fail(options) → true = create selže. now = pevný Date.now v kontextu.
// errors = zachycené console.error. ready = start služby (migrace, obnova stavu, alarm) doběhl.
// alarms = alarmy, které při startu služby už existují ({ jméno: { scheduledTime } } – chrome.alarms.get).
// Funkce (function …) jsou vlastnosti kontextu, const / let se čtou přes get("jméno")
function loadBackground({ storage = {}, now = null, alarms = {} } = {}) {
  const chrome = createChromeMock(storage);
  const listener = () => {
    const list = [];
    return { list, addListener: (fn) => list.push(fn), hasListeners: () => list.length > 0 };
  };
  const notifications = { created: [], fail: null };
  const sessionData = {};
  chrome.storage.session = {
    data: sessionData,
    async get(keys) {
      const list = keys === null || keys === undefined ? Object.keys(sessionData) : Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(list.filter((key) => Object.hasOwn(sessionData, key)).map((key) => [key, sessionData[key]]));
    },
    async set(items) {
      Object.assign(sessionData, structuredClone(items));
    },
    async remove(keys) {
      (Array.isArray(keys) ? keys : [keys]).forEach((key) => delete sessionData[key]);
    },
  };
  Object.assign(chrome.runtime, { onInstalled: listener(), onStartup: listener(), onMessage: listener(), getPlatformInfo: async () => ({ os: "test" }) });
  Object.assign(chrome, {
    alarms: { get: async (name) => alarms[name], create: async () => {}, clear: async () => true, onAlarm: listener() },
    action: { setBadgeBackgroundColor: async () => {}, setBadgeText: async () => {}, setTitle: async () => {} },
    tabs: { create: async () => ({}) },
    notifications: {
      async create(id, options) {
        if (notifications.fail?.(options)) throw new Error("test: notifikace odmítnuta");
        notifications.created.push({ id, options: structuredClone(options) });
        return id;
      },
      clear: async () => true,
      onClicked: listener(),
      onClosed: listener(),
    },
  });
  const errors = [];
  const quietConsole = { ...console, error: (...args) => errors.push(args.map(String).join(" ")), warn: () => {}, info: () => {} };
  const context = vm.createContext({
    chrome,
    console: quietConsole,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    URL,
    structuredClone,
    AbortSignal,
    btoa,
    navigator: { onLine: true },
    fetch: async () => {
      throw new Error("test: bez sítě");
    },
  });
  context.globalThis = context;
  if (now !== null) vm.runInContext(`Date.now = () => ${Number(now)};`, context);
  for (const file of ["src/shared/core.js", "src/shared/store.js", "src/shared/orders.js"]) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, file), "utf8"), context, { filename: file });
  }
  vm.runInContext(
    "var ProductPages = { open: async () => {}, close: async () => {}, fetch: async () => ({ ok: false, error: 'test' }), terms: async () => ({ ok: false, error: 'test' }) };",
    context
  );
  vm.runInContext(fs.readFileSync(path.join(ROOT, "src/background.js"), "utf8"), context, { filename: "src/background.js" });
  const get = (name) => vm.runInContext(name, context);
  const ready = get("Promise.all([storeReady, staleRunReset, alarmQueue])");
  return { AlzaCore: context.AlzaCore, chrome, context, notifications, errors, ready, get, data: chrome.storage.local.data };
}

module.exports = { loadCore, createChromeMock, loadBackground };
