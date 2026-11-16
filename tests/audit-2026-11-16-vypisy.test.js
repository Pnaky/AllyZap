// Audit 2026-11-16, výpisy kategorií, paměť prohlížení, „Spočítat provoz“ a prázdný hlídaný seznam (č. 11, 12, 20, 21
// a nízké nálezy „Výpisy“). Content scripty (category.js, listing-memory.js, content/watch.js) se načtou do izolovaného
// kontextu s jádrem, úložištěm v paměti a malým napodobeným DOM: node --test tests/
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { loadCore } = require("./load-core");

const ROOT = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");
const LANGUAGES = ["cz", "sk", "hu", "en"];
const DAY = 86400000;
const plain = (value) => JSON.parse(JSON.stringify(value));
const tick = (ms = 5) => new Promise((resolve) => setTimeout(resolve, ms));

// === Malý DOM: třídy, atributy, děti a selektory, které skripty používají ===

function parseCompound(text) {
  const match = text.match(/^([a-z][\w-]*)?((?:\.[\w-]+|#[\w-]+|\[[^\]]+\])*)$/i);
  if (!match) throw new Error(`test: nepodporovaný selektor „${text}“`);
  const parts = match[2].match(/\.[\w-]+|#[\w-]+|\[[^\]]+\]/g) || [];
  return {
    tag: match[1]?.toLowerCase() || null,
    classes: parts.filter((part) => part[0] === ".").map((part) => part.slice(1)),
    id: parts.find((part) => part[0] === "#")?.slice(1) || null,
    attrs: parts
      .filter((part) => part[0] === "[")
      .map((part) => {
        const [, name, operator, value] = part.match(/^\[([\w-]+)(?:([\^*]?=)["']?([^"'\]]*)["']?)?\]$/) || [];
        if (!name) throw new Error(`test: nepodporovaný atribut „${part}“`);
        return { name, operator: operator || null, value: value ?? null };
      }),
  };
}

class El {
  constructor(tag, className = "") {
    Object.assign(this, { tag: tag.toLowerCase(), className, children: [], parentElement: null, attrs: {}, dataset: {}, listeners: {}, text: "", title: "", disabled: false, isRoot: false });
    this.style = { order: "", removeProperty: (name) => (this.style[name] = "") };
  }
  get classList() {
    const names = () => this.className.split(/\s+/).filter(Boolean);
    const set = (list) => (this.className = [...new Set(list)].join(" "));
    return {
      contains: (name) => names().includes(name),
      add: (...added) => set([...names(), ...added]),
      remove: (...removed) => set(names().filter((name) => !removed.includes(name))),
      toggle: (name, on = !names().includes(name)) => (set(on ? [...names(), name] : names().filter((other) => other !== name)), on),
    };
  }
  get textContent() {
    return this.text + this.children.map((child) => child.textContent).join("");
  }
  set textContent(value) {
    this.text = String(value);
    this.children.forEach((child) => (child.parentElement = null));
    this.children = [];
  }
  get isConnected() {
    return this.isRoot || Boolean(this.parentElement?.isConnected);
  }
  get firstElementChild() {
    return this.children[0] || null;
  }
  get nextElementSibling() {
    const siblings = this.parentElement?.children || [];
    return siblings[siblings.indexOf(this) + 1] || null;
  }
  get previousElementSibling() {
    const siblings = this.parentElement?.children || [];
    return siblings[siblings.indexOf(this) - 1] || null;
  }
  insert(node, index) {
    node.remove();
    node.parentElement = this;
    this.children.splice(index, 0, node);
    return node;
  }
  appendChild(node) {
    return this.insert(node, this.children.length);
  }
  append(...nodes) {
    nodes.forEach((node) => this.appendChild(node));
  }
  prepend(node) {
    this.insert(node, 0);
  }
  before(node) {
    node.remove();
    this.parentElement.insert(node, this.parentElement.children.indexOf(this));
  }
  after(node) {
    node.remove();
    this.parentElement.insert(node, this.parentElement.children.indexOf(this) + 1);
  }
  remove() {
    if (!this.parentElement) return;
    this.parentElement.children.splice(this.parentElement.children.indexOf(this), 1);
    this.parentElement = null;
  }
  setAttribute(name, value) {
    this.attrs[name] = String(value);
  }
  getAttribute(name) {
    return Object.hasOwn(this.attrs, name) ? this.attrs[name] : null;
  }
  hasAttribute(name) {
    return Object.hasOwn(this.attrs, name);
  }
  removeAttribute(name) {
    delete this.attrs[name];
  }
  toggleAttribute(name, on = !this.hasAttribute(name)) {
    if (on) this.attrs[name] = "";
    else delete this.attrs[name];
    return on;
  }
  addEventListener(type, handler) {
    (this.listeners[type] ||= []).push(handler);
  }
  click() {
    (this.listeners.click || []).forEach((handler) => handler({ preventDefault() {}, stopPropagation() {} }));
  }
  matchesCompound({ tag, classes, id, attrs }) {
    if (tag && tag !== this.tag) return false;
    if (id && this.attrs.id !== id) return false;
    if (!classes.every((name) => this.classList.contains(name))) return false;
    return attrs.every(({ name, operator, value }) => {
      if (!this.hasAttribute(name)) return false;
      if (operator === "=") return this.attrs[name] === value;
      if (operator === "^=") return this.attrs[name].startsWith(value);
      if (operator === "*=") return this.attrs[name].includes(value);
      return true;
    });
  }
  // Jeden selektor bez čárek: „a b c“ (potomci) nebo „:scope > x“ (přímé děti)
  matchesChain(chain, scope) {
    if (!this.matchesCompound(chain.at(-1))) return false;
    let node = this.parentElement;
    for (let index = chain.length - 2; index >= 0; index--) {
      while (node && node !== scope?.parentElement && !node.matchesCompound(chain[index])) node = node.parentElement;
      if (!node || node === scope?.parentElement) return false;
      node = node.parentElement;
    }
    return true;
  }
  descendants(out = []) {
    this.children.forEach((child) => {
      out.push(child);
      child.descendants(out);
    });
    return out;
  }
  querySelectorAll(selector) {
    const found = new Set();
    selector.split(",").forEach((single) => {
      const text = single.trim();
      if (text.startsWith(":scope >")) {
        const compound = parseCompound(text.slice(":scope >".length).trim());
        this.children.filter((child) => child.matchesCompound(compound)).forEach((child) => found.add(child));
        return;
      }
      const chain = text.split(/\s+/).map(parseCompound);
      this.descendants().filter((node) => node.matchesChain(chain, this)).forEach((node) => found.add(node));
    });
    return this.descendants().filter((node) => found.has(node)); // V pořadí dokumentu
  }
  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }
  closest(selector) {
    const compound = parseCompound(selector);
    for (let node = this; node; node = node.parentElement) if (node.matchesCompound(compound)) return node;
    return null;
  }
}

// Stránka výpisu: <html><body><div><div id="boxes">…dlaždice…</div></div></body></html>
function createPage({ withBoxes = true } = {}) {
  const html = new El("html");
  html.isRoot = true;
  const body = html.appendChild(new El("body"));
  const wrap = body.appendChild(new El("div", "wrap"));
  const boxes = wrap.appendChild(new El("div"));
  if (withBoxes) boxes.attrs.id = "boxes";
  const document = {
    documentElement: html,
    body,
    querySelector: (selector) => html.querySelector(selector),
    querySelectorAll: (selector) => html.querySelectorAll(selector),
    createElement: (tag) => new El(tag),
  };
  // Dlaždice jako na alza.cz: .browsingitem > a.name + .Description
  const tile = (id, name, description = "", parent = boxes) => {
    const item = parent.appendChild(new El("div", "browsingitem canBuy"));
    item.attrs["data-id"] = String(id);
    const link = item.appendChild(new El("a", "name"));
    link.attrs.href = `/produkt-d${id}.htm`;
    link.textContent = name;
    const text = item.appendChild(new El("div", "Description"));
    text.textContent = description;
    return { item, link, description: text };
  };
  return { html, body, wrap, boxes, document, tile };
}

const windowAt = (pathname) => ({ location: { hostname: "www.alza.cz", origin: "https://www.alza.cz", hash: "", search: "", pathname, href: `https://www.alza.cz${pathname}` } });
const observerStub = class {
  observe() {}
  disconnect() {}
};

// category.js nad napodobenou stránkou; úložiště zapisuje skutečný AlzaStore (jako služba na pozadí).
// delays = časy předané setTimeout skriptem: rozestup mezi požadavky (energyFetchDelayMs) se v testu nečeká
// a časovač konce pauzy po odmítnutí (minuty) se nespouští vůbec
function loadCategory({ storage = {} } = {}) {
  const { AlzaCore, context, chrome } = loadCore({ storage, files: ["src/shared/store.js"] });
  vm.runInContext("AlzaStore.isWriter = true;", context);
  const page = createPage();
  const delays = [];
  Object.assign(context, {
    document: page.document,
    window: windowAt("/televize/18849604.htm"),
    MutationObserver: observerStub,
    requestAnimationFrame: () => 0,
    AlzaIcons: { prepend: (element) => element },
    setTimeout: (handler, ms, ...args) => {
      delays.push(ms);
      if (ms > 60000) return 0;
      return setTimeout(handler, ms >= 100 ? 0 : ms, ...args);
    },
  });
  vm.runInContext(read("src/category.js"), context, { filename: "src/category.js" });
  const category = vm.runInContext("AlzaUnitPrice", context);
  category.state.domainKey = "alza_cz";
  const requests = [];
  // Odpověď služby na pozadí na fetchProductPage: respond(pořadí požadavku, adresa)
  const respondWith = (respond) =>
    (chrome.runtime.sendMessage = async (message) => {
      if (message?.action !== "fetchProductPage") return undefined;
      requests.push(message.url);
      return respond(requests.length, message.url);
    });
  const enableEnergy = () => {
    category.state.enabled = true;
    category.state.energy.enabled = true;
  };
  const gaps = () => delays.filter((ms) => ms === category.energyFetchDelayMs).length;
  return { AlzaCore, context, chrome, category, page, delays, requests, respondWith, enableEnergy, gaps, data: chrome.storage.local.data };
}

const TV = "Televize - Mini LED, 152cm, 4K Ultra HD, 144Hz";
const product = { ok: true, isProduct: true, energy: { kwh: 75, per: "hours" } };
const barTexts = (category) => category.state.energyFetch.bar?.children.map((child) => child.textContent) || null;
const barButton = (category) => category.state.energyFetch.bar?.children[2] || null;

// === č. 11: značka z názvu ===

test("č. 11: značka u televizí a monitorů je za úhlopříčkou (názvy z živého výpisu alza.cz)", () => {
  const { AlzaCore } = loadCore();
  const brand = (name) => plain(AlzaCore.getBrandFromName(name));
  assert.deepEqual(brand('60" Metz 60MNH7000Z'), { key: "metz", name: "Metz" });
  assert.deepEqual(brand('65" LG OLED65C64LA'), { key: "lg", name: "LG" });
  assert.deepEqual(brand('23,8" Rapture VIDE 24IFF240'), { key: "rapture", name: "Rapture" });
  assert.deepEqual(brand('49" Samsung Odyssey OLED G9'), { key: "samsung", name: "Samsung" });
  assert.deepEqual(brand("55″ TCL 55C805"), { key: "tcl", name: "TCL" }, "jiný znak palců");
  // Samotné číslo úhlopříčka není (bývá součást značky) – značka se raději neurčí, jako dřív
  assert.equal(AlzaCore.getBrandFromName("7 Days Croissant"), null);
  assert.equal(AlzaCore.getBrandFromName("2× baterie"), null);
  assert.equal(AlzaCore.getBrandFromName('55"'), null, "jen úhlopříčka");
  assert.deepEqual(brand("3M páska"), { key: "3m", name: "3M" }, "číslo s písmenem je značka");
});

test("č. 11: první slovo, které samo značka není, bere s sebou druhé", () => {
  const { AlzaCore } = loadCore();
  const key = (name) => AlzaCore.getBrandFromName(name)?.key;
  assert.equal(key("New Balance 574"), "new balance");
  assert.equal(key("New Era 9Forty"), "new era");
  assert.equal(key("La Roche-Posay Effaclar"), "la roche-posay");
  assert.equal(key("La Prairie Skin Caviar"), "la prairie");
  assert.equal(key("The North Face Borealis"), "the north");
  assert.equal(key("The Ordinary Niacinamide"), "the ordinary");
  assert.equal(key("Dr. Max Vitamin C"), "dr. max");
  assert.equal(key("Mr. Proper Citron"), "mr. proper");
  assert.equal(key("Le Creuset Signature"), "le creuset");
  assert.equal(AlzaCore.getBrandFromName("New Balance 574").name, "New Balance", "název do tlačítka „Skrýt značku New Balance“");
  // Jednoznačné značky beze změny
  assert.deepEqual(plain(AlzaCore.getBrandFromName("LEGO® Technic 42100")), { key: "lego", name: "LEGO" });
  assert.equal(key("Samsung Galaxy S26"), "samsung");
  assert.equal(key("Newton Running"), "newton", "jen celé slovo ze seznamu");
  assert.equal(key("New"), "new", "bez druhého slova");
});

test("č. 11: značka uložená starým způsobem skrývá dál totéž a nic navíc", () => {
  const { AlzaCore } = loadCore();
  // Výpočet klíče ve verzích do 2026.11.16 (první slovo názvu)
  const oldKey = (name) => {
    const word = String(name || "").trim().split(/\s+/)[0]?.replace(/[®™©]/g, "").replace(/[,:;]+$/, "") || "";
    return /\p{L}/u.test(word) && word.length >= 2 ? word.toLocaleLowerCase("cs") : null;
  };
  const names = [
    "Samsung Galaxy S26", 'SAMSUNG Galaxy A57', '49" Samsung Odyssey OLED G9', "LEGO® Technic 42100", "New Balance 574", "New Era 9Forty", "Newton Running",
    "La Roche-Posay Effaclar", "La Prairie Skin Caviar", "The North Face Borealis", "The Ordinary Niacinamide", "Dr. Max Vitamin C", "Dr. Oetker Pizza",
    "Apple iPhone 17", '65" LG OLED65C64LA', "LG Gram 16", "Tvrzené sklo AlzaGuard", "2× baterie", "be quiet! Pure Rock 2",
  ];
  const storedOld = { samsung: { name: "Samsung" }, new: { name: "New" }, the: { name: "The" }, "dr.": { name: "Dr." }, lg: { name: "LG" }, lego: { name: "LEGO" } };
  names.forEach((name) => {
    const before = Object.hasOwn(storedOld, oldKey(name) ?? "");
    const after = AlzaCore.isHiddenListing({}, storedOld, "alza_cz_1", name) === "brand";
    if (before) assert.equal(after, true, `dřív skryté zůstává skryté: ${name}`);
    // Navíc se smí skrýt jen tatáž značka u názvu s úhlopříčkou – tam dřív značka chyběla (oprava č. 11)
    if (!before && after) assert.match(name, /^\d+"/, `nově skryté jen televize / monitor téže značky: ${name}`);
  });
  assert.equal(AlzaCore.isHiddenListing({}, storedOld, "alza_cz_1", '49" Samsung Odyssey OLED G9'), "brand", "skrytý Samsung platí i pro jeho televize");
  assert.equal(AlzaCore.isHiddenListing({}, storedOld, "alza_cz_1", "Newton Running"), null);
  // Vrácení starého záznamu: klíč a název, pod kterým je uložený
  assert.deepEqual(plain(AlzaCore.getHiddenBrand(storedOld, "New Balance 574")), { key: "new", name: "New" });
  assert.deepEqual(plain(AlzaCore.getHiddenBrand(storedOld, "Samsung Galaxy S26")), { key: "samsung", name: "Samsung" });
  assert.equal(AlzaCore.getHiddenBrand(storedOld, "Apple iPhone 17"), null);
  assert.equal(AlzaCore.getHiddenBrand(null, "Samsung Galaxy S26"), null);

  // Značka uložená dnešním způsobem skryje jen sebe
  const storedNew = { "new balance": { name: "New Balance" } };
  assert.equal(AlzaCore.isHiddenListing({}, storedNew, "alza_cz_1", "New Balance 574"), "brand");
  assert.equal(AlzaCore.isHiddenListing({}, storedNew, "alza_cz_1", "New Era 9Forty"), null);
  assert.equal(AlzaCore.isHiddenListing({ alza_cz_1: {} }, storedNew, "alza_cz_1", "New Era 9Forty"), "product", "skrytý produkt má přednost");
  // Import zálohy skládá klíč z uloženého názvu (options-backup.js) – starý i nový záznam dostanou svůj klíč zpět
  assert.equal(AlzaCore.getBrandFromName("New").key, "new");
  assert.equal(AlzaCore.getBrandFromName("Dr.").key, "dr.");
  assert.equal(AlzaCore.getBrandFromName("New Balance").key, "new balance");
});

// === č. 12 (a): kandidát „Spočítat provoz“ podle druhu zboží ===

test("č. 12: kandidát je jen televize / monitor podle začátku popisku (popisky z živého výpisu)", () => {
  const { AlzaCore } = loadCore();
  const candidate = (description, name = "Samsung Smart TV monitor") => AlzaCore.isEnergyCandidate(name, description);
  [
    "Televize - Mini LED, 152cm, 4K Ultra HD",
    "Monitor - IPS, 2560 × 1440, 180Hz",
    'Monitor  - úhlopříčka 23,8", Full HD', // I dvě mezery
    "Monitor - OLED, 3440 × 1440",
    'LCD monitor - 27", IPS',
    'Herní monitor - 27", QHD',
    "Televize SMART OLED, 139cm, 4K", // Starší tvar bez pomlčky
    "Televízor - QLED, 139cm", // sk
    "Televízió SMART LED, 108cm", // hu
    "TV - LED, 108cm",
    "Television - OLED, 139cm", // en
    'OLED Monitor – 27", QHD',
    "Monitor",
  ].forEach((description) => assert.equal(candidate(description), true, description));
  [
    "Držák na TV - VESA 200×200, nosnost 35kg",
    'Stojan na televizi 37" až 70", nosnost 40kg',
    "Multimediální centrum - s podporou 4K, tvOS", // Apple TV
    "Monitor dechu - s kamerou, pro novorozence",
    "TV box - Android 14, 4K",
    "TV tuner - DVB-T2",
    "Kabel k monitoru - HDMI 2.1, 2m",
    "Televizní anténa - pokojová, DVB-T2",
    "Monitorovací kamera - IP, 4 Mpx",
    "Dálkový ovladač - pro televize Samsung",
    "",
    null,
  ].forEach((description) => assert.equal(candidate(description), false, String(description)));
  assert.equal(AlzaCore.isEnergyCandidate("Monitor Dell P2425", ""), false, "bez popisku název nerozhoduje");
  assert.equal(AlzaCore.isEnergyCandidate("Apple TV 4K 2022 64GB", "Multimediální centrum - s podporou 4K"), false, "„TV“ v názvu nestačí");
});

test("č. 12: záznam mezipaměti spotřeby s časem v budoucnosti neplatí; prošlé klíče k zahození", () => {
  const { AlzaCore } = loadCore();
  const now = Date.UTC(2026, 10, 16);
  const cache = {
    fresh: { kwh: 70, per: "hours", at: now - DAY },
    none: { none: true, at: now - 59 * DAY },
    old: { kwh: 70, per: "hours", at: now - 61 * DAY },
    future: { kwh: 70, per: "hours", at: now + DAY },
    futureNone: { none: true, at: now + 400 * DAY },
    noTime: { kwh: 70, per: "hours" },
    broken: null,
  };
  assert.deepEqual(plain(AlzaCore.getCachedEnergy(cache, "fresh", now)), { kwh: 70, per: "hours" });
  assert.deepEqual(plain(AlzaCore.getCachedEnergy(cache, "none", now)), { none: true });
  ["old", "future", "futureNone", "noTime", "broken", "missing"].forEach((key) => assert.equal(AlzaCore.getCachedEnergy(cache, key, now), null, key));
  assert.deepEqual(plain(AlzaCore.getExpiredEnergyKeys(cache, now)).sort(), ["broken", "future", "futureNone", "noTime", "old"]);
  assert.deepEqual(plain(AlzaCore.getExpiredEnergyKeys(null, now)), []);
});

test("spotřeba televize ze stránky produktu: „kWh/1000h“ i maďarské „kWh/1000 óra“", () => {
  const { AlzaCore } = loadCore();
  const doc = (value, label = "Spotřeba v SDR režimu") => {
    const root = new El("html");
    const row = root.appendChild(new El("div", "row"));
    row.appendChild(new El("span", "typeName")).textContent = label;
    row.appendChild(new El("span", "value")).textContent = value;
    return root;
  };
  assert.deepEqual(plain(AlzaCore.getDocumentEnergy(doc("75 kWh/1000h"))), { kwh: 75, per: "hours" });
  assert.deepEqual(plain(AlzaCore.getDocumentEnergy(doc("75 kWh/1000 h"))), { kwh: 75, per: "hours" });
  assert.deepEqual(plain(AlzaCore.getDocumentEnergy(doc("75 kWh/1000 óra", "Fogyasztás SDR módban"))), { kwh: 75, per: "hours" });
  assert.equal(AlzaCore.getDocumentEnergy(doc("75 kWh/1000 óra", "Fogyasztás HDR módban")), null, "HDR se nepočítá");
  assert.equal(AlzaCore.getDocumentEnergy(doc("75 W")), null);
});

// === č. 12 (b), (c): běh „Spočítat provoz“ ===

test("č. 12: „bez údaje“ se ukládá jen u detailu produktu; stránka ověření / přihlášení se nezapíše a běh po 3 skončí", async () => {
  const { category, page, respondWith, enableEnergy, requests, data } = loadCategory();
  for (let id = 1; id <= 10; id++) page.tile(id, `55" LG OLED55B${id}`, TV);
  enableEnergy();
  respondWith(() => ({ ok: true, isProduct: false, saveProblem: "notifyProblemLoginUnknown", prices: {}, energy: null }));
  await category.fetchEnergy();
  assert.equal(requests.length, 3, "tři stránky bez detailu produktu za sebou = konec");
  assert.equal(data.alzaEnergy, undefined, "nic se neuložilo");
  assert.deepEqual(plain({ ...category.state.energyFetch, bar: null, anchor: null }), { loading: false, done: 0, total: 10, failed: "errors", anchor: null, pausedUntil: 0, bar: null });
  assert.match(barTexts(category)[1], /nepodařilo načíst \(načteno 0\)/);
  assert.equal(barButton(category).classList.contains("alza-price-tracker-hidden"), false, "po chybách jde zkusit hned znovu");

  // Skutečný detail bez údaje o spotřebě se jako „bez údaje“ uloží
  requests.length = 0;
  respondWith(() => ({ ok: true, isProduct: true, energy: null }));
  await category.fetchEnergy();
  assert.equal(requests.length, 10);
  assert.equal(Object.values(data.alzaEnergy).filter((entry) => entry.none === true).length, 10);
});

test("č. 12: rozestup je před každým požadavkem kromě prvního – i po chybě; tři chyby za sebou běh ukončí", async () => {
  {
    // Samé HTTP 503 (dřív 48 požadavků bez rozestupu)
    const { category, page, respondWith, enableEnergy, requests, gaps } = loadCategory();
    for (let id = 1; id <= 60; id++) page.tile(id, `55" LG OLED55B${id}`, TV);
    enableEnergy();
    respondWith(() => ({ ok: false, status: 503, error: "HTTP 503" }));
    await category.fetchEnergy();
    assert.equal(requests.length, 3);
    assert.equal(gaps(), 2, "rozestup i mezi nepovedenými požadavky");
    assert.equal(category.state.energyFetch.failed, "errors");
  }
  {
    // Síť / služba na pozadí neodpoví
    const { category, page, respondWith, enableEnergy, requests } = loadCategory();
    for (let id = 1; id <= 60; id++) page.tile(id, `55" LG OLED55B${id}`, TV);
    enableEnergy();
    respondWith(() => undefined);
    await category.fetchEnergy();
    assert.equal(requests.length, 3);
  }
  {
    // Chyby, které nejdou za sebou, běh neukončí; strop 48 stránek na kliknutí platí
    const { category, page, respondWith, enableEnergy, requests, gaps, data } = loadCategory();
    for (let id = 1; id <= 60; id++) page.tile(id, `55" LG OLED55B${id}`, TV);
    enableEnergy();
    respondWith((order) => (order % 3 === 0 ? { ok: false, status: 0, error: "timeout" } : product));
    await category.fetchEnergy();
    assert.equal(requests.length, 48);
    assert.equal(gaps(), 47);
    assert.equal(category.state.energyFetch.failed, false);
    assert.equal(category.state.energyFetch.done, 32);
    assert.equal(Object.keys(data.alzaEnergy).length, 32);
    assert.deepEqual(plain(Object.values(data.alzaEnergy)[0]), { kwh: 75, per: "hours", at: Object.values(data.alzaEnergy)[0].at });
  }
});

test("č. 12: po 403 / 429 běh končí a tlačítko je pár minut vypnuté", async () => {
  for (const status of [403, 429]) {
    const { category, page, respondWith, enableEnergy, requests, delays } = loadCategory();
    for (let id = 1; id <= 20; id++) page.tile(id, `55" LG OLED55B${id}`, TV);
    enableEnergy();
    respondWith((order) => (order === 5 ? { ok: false, status, error: `HTTP ${status}` } : product));
    const before = Date.now();
    await category.fetchEnergy();
    const job = category.state.energyFetch;
    assert.equal(requests.length, 5, `${status}: žádný další požadavek`);
    assert.equal(job.failed, "refused");
    assert.equal(job.done, 4);
    assert.ok(job.pausedUntil >= before + 2 * 60 * 1000 && job.pausedUntil <= Date.now() + 15 * 60 * 1000, "pauza v řádu minut");
    assert.ok(delays.some((ms) => ms >= category.energyFetchPauseMs), "po pauze se lišta překreslí (tlačítko zpět)");
    assert.match(barTexts(category)[1], /odmítla další dotazy \(načteno 4\)\. Zkuste to znovu za pár minut\./);
    assert.equal(barButton(category).classList.contains("alza-price-tracker-hidden"), true, "tlačítko vypnuté");

    await category.fetchEnergy(); // Klik během pauzy (např. z klávesnice) nic nestáhne
    assert.equal(requests.length, 5);

    job.pausedUntil = Date.now() - 1; // Pauza uplynula
    category.updateEnergyFetchBar();
    assert.equal(barButton(category).classList.contains("alza-price-tracker-hidden"), false);
    assert.doesNotMatch(barTexts(category)[1], /za pár minut/);
    await category.fetchEnergy();
    assert.ok(requests.length > 5, "po pauze jde načítat dál");
  }
});

test("č. 12: mezipaměť se před každým požadavkem čte znovu – co uložila jiná záložka, se nestahuje", async () => {
  const { category, page, respondWith, enableEnergy, requests, chrome, data } = loadCategory();
  for (let id = 1; id <= 6; id++) page.tile(id, `55" LG OLED55B${id}`, TV);
  enableEnergy();
  respondWith(async (order) => {
    // Během prvního požadavku uloží jiná záložka spotřebu produktů 2 a 3 (state.energyCache téhle záložky o tom neví)
    if (order === 1) {
      const at = Date.now();
      await chrome.storage.local.set({ alzaEnergy: { alza_cz_2: { kwh: 60, per: "hours", at }, alza_cz_3: { none: true, at } } });
    }
    return product;
  });
  await category.fetchEnergy();
  assert.deepEqual(requests.map((url) => url.match(/d(\d+)\.htm/)[1]), ["1", "4", "5", "6"]);
  assert.equal(category.state.energyFetch.done, 6, "hotové jsou všechny");
  assert.equal(data.alzaEnergy.alza_cz_2.kwh, 60, "záznam druhé záložky zůstal");
  assert.equal(Object.keys(data.alzaEnergy).length, 6);
});

test("č. 12 / 18: zápis do alzaEnergy zahodí prošlé záznamy a záznamy z budoucnosti", async () => {
  const now = Date.now();
  const storage = {
    alzaEnergy: {
      alza_cz_901: { kwh: 70, per: "hours", at: now - 5 * DAY }, // platný – zůstává
      alza_cz_902: { kwh: 70, per: "hours", at: now - 61 * DAY }, // starý
      alza_cz_903: { none: true, at: now - 200 * DAY }, // starý „bez údaje“
      alza_cz_904: { kwh: 70, per: "hours", at: now + 30 * DAY }, // čas v budoucnosti
      alza_cz_1: { none: true, at: now - 100 * DAY }, // prošlý záznam produktu, který se právě načítá
    },
  };
  const { category, page, respondWith, enableEnergy, requests, data } = loadCategory({ storage });
  page.tile(1, '55" LG OLED55B1', TV);
  enableEnergy();
  category.state.energyCache = plain(storage.alzaEnergy);
  respondWith(() => product);
  await category.fetchEnergy();
  assert.equal(requests.length, 1, "prošlý záznam produkt nevyřadil");
  assert.deepEqual(Object.keys(data.alzaEnergy).sort(), ["alza_cz_1", "alza_cz_901"]);
  assert.equal(data.alzaEnergy.alza_cz_1.kwh, 75, "nový záznam se nesmazal s prošlým téhož klíče");
});

test("č. 12: stránky produktů se dál otevírají zprávou fetchProductPage (jeden „acquire“ na běh bez změny pozadí nejde)", () => {
  const background = read("src/background.js");
  // Služba na pozadí neumí „acquire“ / „release“ zprávou – až to bude umět, běh „Spočítat provoz“ ho má použít
  assert.doesNotMatch(background, /message\?\.action === "(?:acquire|release)ProductPages"/);
  const fetch = read("src/category.js");
  assert.match(fetch, /sendMessage\(\{ action: "fetchProductPage", url \}\)/);
});

// === č. 21 a nízké: skryté produkty, lišta, řazení ===

test("č. 21: skryté produkty nejsou mezi kandidáty „Spočítat provoz“ (ani ve stropu 48)", () => {
  const { category, page, enableEnergy } = loadCategory();
  const tiles = [];
  for (let id = 1; id <= 60; id++) tiles.push(page.tile(id, `55" LG OLED55B${id}`, TV));
  page.tile(100, "Držák Stell SHO 1050", "Držák na TV - VESA 200×200");
  page.tile(101, "Apple TV 4K 2022", "Multimediální centrum - s podporou 4K");
  enableEnergy();
  assert.equal(category.getEnergyCandidates().length, 60, "držák a Apple TV kandidáti nejsou");
  tiles.slice(0, 20).forEach(({ item }) => item.setAttribute("data-alza-price-tracker-memory-hidden", "brand"));
  const candidates = category.getEnergyCandidates();
  assert.equal(candidates.length, 40);
  assert.equal(candidates[0].key, "alza_cz_21");
  assert.equal(candidates[0].url, "https://www.alza.cz/produkt-d21.htm");
  category.updateEnergyFetchBar();
  assert.match(barTexts(category)[1], /bez ceny provozu: 40$/);
  assert.equal(barButton(category).textContent, "Spočítat provoz (40)");
});

test("č. 21: filtr slev skryté produkty nepočítá do „Vyhovuje X z Y“, atribut filtru jim ale dává", () => {
  const { category, page } = loadCategory();
  const tiles = [];
  for (let id = 1; id <= 6; id++) tiles.push(page.tile(id, `Samsung Galaxy A${id}`));
  // Slevu mají produkty 1–3; produkty 1 a 4 skryl uživatel
  category.getItemDiscount = (item) => ({ discount: Number(item.attrs["data-id"]) <= 3 ? { percent: 25, coupon: false } : null, quantity: false });
  category.loadHistories = async () => {};
  tiles[0].item.setAttribute("data-alza-price-tracker-memory-hidden", "product");
  tiles[3].item.setAttribute("data-alza-price-tracker-memory-hidden", "product");
  Object.assign(category.state, { discountEnabled: true });
  category.state.filter.min = 20;
  category.applyFilter();
  assert.deepEqual(plain(category.state.filterCounts), { shown: 2, total: 4 }, "dřív 3 z 6");
  const filtered = tiles.map(({ item }) => item.hasAttribute("data-alza-price-tracker-discount-hidden"));
  assert.deepEqual(filtered, [false, false, false, true, true, true], "skrytý produkt 4 filtru nevyhovuje – po „Zobrazit skryté“ zůstane skrytý filtrem");
});

test("č. 21: „Zobrazit skryté“ neukáže dlaždici skrytou filtrem slev a nerozbije flex Alzy (CSS)", () => {
  const css = read("css/main.css").replace(/\/\*[\s\S]*?\*\//g, "");
  // Paměť skrývá podmíněným pravidlem – s atributem na <html> pravidlo jen přestane platit
  assert.match(css, /:root:not\(\[data-alza-price-tracker-memory-show\]\) \[data-alza-price-tracker-memory-hidden\]\s*\{\s*display:\s*none\s*!important;\s*\}/);
  assert.doesNotMatch(css, /display:\s*revert/, "žádné display: revert (přepsalo by display: flex dlaždice výchozím)");
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(([, selector]) => selector.includes("data-alza-price-tracker-memory-hidden"));
  const withDisplay = rules.filter(([, , body]) => /(^|[\s;])display\s*:/.test(body)).map(([, selector]) => selector.trim());
  assert.deepEqual(withDisplay, [":root:not([data-alza-price-tracker-memory-show]) [data-alza-price-tracker-memory-hidden]"], "display nastavuje jen podmíněné pravidlo");
  // Skrytí filtrem slev platí bez podmínky – po „Zobrazit skryté“ ho nic nepřebíjí
  assert.match(css, /\[data-alza-price-tracker-discount-hidden\],[^{]*\{[^}]*display:\s*none\s*!important/);
  assert.match(css, /\[data-alza-price-tracker-memory-show\] \[data-alza-price-tracker-memory-hidden\]\s*\{\s*opacity:/);
});

test("č. 21 a řazení „S provozem“: „Seřazeno N“ bez skrytých a počet produktů bez údaje o spotřebě", () => {
  const { category } = loadCategory();
  const base = { loading: false, failed: false, active: true, filterActive: false, counts: null, loaded: 48, total: 48, hasMore: false, small: true, energyListing: false };
  const parts = (change) => plain(category.getStatusParts({ ...base, ...change }));
  assert.deepEqual(parts({}), [["sortDone", 48]], "bez skrytých beze změny");
  assert.deepEqual(parts({ hidden: 5 }), [["sortDone", 43]]);
  assert.deepEqual(parts({ hidden: 5, energyListing: true, noEnergy: 7 }), [["sortDoneEnergy", 43], ["sortNoEnergy", 7]]);
  assert.deepEqual(parts({ energyListing: true, noEnergy: 0 }), [["sortDoneEnergy", 48]]);
  assert.deepEqual(parts({ noEnergy: 7 }), [["sortDone", 48]], "řazení „Za jednotku“ o spotřebě nemluví");
  assert.deepEqual(parts({ active: false, energyListing: true, noEnergy: 7 }), [], "bez řazení nic");
  // Úplnost výpisu se dál posuzuje podle všech načtených (počet Alzy skryté obsahuje)
  assert.deepEqual(parts({ hidden: 5, loaded: 504, total: 3000, hasMore: true }), [["sortPartial", 499, 3000]]);
  assert.deepEqual(parts({ hidden: 5, loaded: 48, total: null, hasMore: true }), [["sortPartialUnknown", 43]]);
  assert.deepEqual(parts({ hidden: 5, failed: true, loaded: 48, total: 132, hasMore: true }), [["sortLoadFailed", 43, 132]]);
  assert.deepEqual(parts({ hidden: 5, loading: true, total: 132 }), [["sortLoading", 48, 132]], "průběh načítání počítá načtené dlaždice");
});

test("nové texty výpisů jsou ve všech jazycích a mají vyplněné parametry", () => {
  const { category } = loadCategory();
  LANGUAGES.forEach((lang) => {
    category.state.lang = lang;
    const noEnergy = category.translate("sortNoEnergy", 7);
    assert.notEqual(noEnergy, "sortNoEnergy", `${lang}: chybí sortNoEnergy`);
    assert.match(noEnergy, /7/);
    const errors = category.translate("energyFetchErrors", 4);
    assert.match(errors, /4/, `${lang} energyFetchErrors`);
    const wait = category.translate("energyFetchWait");
    assert.notEqual(wait, "energyFetchWait", `${lang}: chybí energyFetchWait`);
    [noEnergy, errors, wait].forEach((text) => assert.doesNotMatch(text, /\{\d\}/, `${lang}: nevyplněný parametr`));
    if (lang !== "cz") {
      ["sortNoEnergy", "energyFetchErrors", "energyFetchWait"].forEach((key) => assert.notEqual(category.translations[lang][key], category.translations.cz[key], `${lang} ${key}: nepřeloženo`));
    }
  });
  // Klíče hned za příbuznými, ne na konci slovníku
  const keys = Object.keys(category.translations.cz);
  assert.equal(keys[keys.indexOf("sortDoneEnergy") + 1], "sortNoEnergy");
  assert.deepEqual(keys.slice(keys.indexOf("energyFetchFailed") + 1, keys.indexOf("energyFetchFailed") + 3), ["energyFetchWait", "energyFetchErrors"]);
});

test("řazení „S provozem“: stav v liště počítá viditelné produkty bez klíče řazení", () => {
  const source = read("src/category.js");
  const toolbar = source.slice(source.indexOf("  updateToolbar() {"), source.indexOf("  // Televize a monitory ve výpisu"));
  assert.match(toolbar, /hidden: items\.length - sorted\.length/);
  assert.match(toolbar, /noEnergy: active && energyListing \? sorted\.filter\(\(item\) => !this\.state\.rendered\.get\(item\)\?\.sortKey\)\.length : 0/);
  assert.match(toolbar, /items\.filter\(\(item\) => !item\.hasAttribute\(this\.memoryHiddenAttribute\)\)/);
});

test("lišta „Spočítat provoz“: bez #boxes nespadne a zmizí, po výměně výpisu Alzou se stav běhu vynuluje", async () => {
  const { category, page, respondWith, enableEnergy } = loadCategory();
  const tiles = [];
  for (let id = 1; id <= 4; id++) tiles.push(page.tile(id, `55" LG OLED55B${id}`, TV));
  enableEnergy();
  respondWith(() => product);
  await category.fetchEnergy();
  const job = category.state.energyFetch;
  assert.equal(job.done, 4);
  assert.equal(job.anchor, tiles[0].item, "běh patří výpisu s touto první dlaždicí");
  assert.ok(job.bar?.isConnected, "lišta je nad výpisem");
  assert.equal(job.bar.nextElementSibling, page.boxes);

  // Alza #boxes odebrala (výpis bez výsledků, jiný typ stránky) – dřív TypeError v každém průchodu
  const bar = job.bar;
  page.boxes.remove();
  assert.doesNotThrow(() => category.updateEnergyFetchBar());
  assert.equal(bar.isConnected, false, "lišta pryč");
  assert.equal(job.bar, null);
  assert.equal(job.done, 0, "dlaždice minulého výpisu jsou pryč – stav běhu vynulován");
  category.update(); // Celý průchod bez #boxes
});

test("lišta „Spočítat provoz“: v novém výpisu bez kandidátů nezůstane „Spotřeba načtena“ z minulého", async () => {
  const { category, page, respondWith, enableEnergy, data } = loadCategory();
  const tiles = [];
  for (let id = 1; id <= 3; id++) tiles.push(page.tile(id, `55" LG OLED55B${id}`, TV));
  enableEnergy();
  respondWith(() => product);
  await category.fetchEnergy();
  category.state.energyCache = plain(data.alzaEnergy);
  category.updateEnergyFetchBar();
  assert.match(barTexts(category)[1], /Spotřeba načtena \(3\)/, "po běhu ve stejném výpisu výsledek zůstává");
  assert.equal(barButton(category).classList.contains("alza-price-tracker-hidden"), true);

  // Alza výpis vymění (filtr, jiná kategorie): nové dlaždice bez televizí
  tiles.forEach(({ item }) => item.remove());
  page.tile(50, "Logitech MX Master 3S", "Myš - bezdrátová, laserová");
  category.updateEnergyFetchBar();
  assert.equal(category.state.energyFetch.bar, null, "lišta zmizela");
  assert.deepEqual(plain({ done: category.state.energyFetch.done, failed: category.state.energyFetch.failed }), { done: 0, failed: false });
});

test("výkon: rozbor názvu a popisku pro „Spočítat provoz“ se pro dlaždici dělá jednou, po přepsání dlaždice znovu", () => {
  const { category, page, enableEnergy, AlzaCore } = loadCategory();
  const tiles = [];
  for (let id = 1; id <= 5; id++) tiles.push(page.tile(id, `55" LG OLED55B${id}`, TV));
  enableEnergy();
  let calls = 0;
  const original = AlzaCore.isEnergyCandidate.bind(AlzaCore);
  AlzaCore.isEnergyCandidate = (...args) => (calls++, original(...args));
  assert.equal(category.getEnergyCandidates().length, 5);
  assert.equal(calls, 5);
  category.getEnergyCandidates();
  category.getEnergyCandidates();
  assert.equal(calls, 5, "další průchody z mezipaměti dlaždice");
  tiles[0].description.textContent = "Držák na TV - VESA"; // Alza dlaždici přepsala jiným produktem
  tiles[1].link.attrs.href = "/produkt-d77.htm";
  const candidates = category.getEnergyCandidates();
  assert.equal(calls, 7, "jen dvě změněné dlaždice");
  assert.deepEqual(plain(candidates.map(({ key }) => key)), ["alza_cz_77", "alza_cz_3", "alza_cz_4", "alza_cz_5"]);
});

test("Firefox po aktualizaci: init výpisů odebere i lištu „Spočítat provoz“ staré instance", () => {
  const source = read("src/category.js");
  const init = source.slice(source.indexOf("  async init() {"), source.indexOf("  setFeatures("));
  assert.match(init, /\.alza-price-tracker-energy-bar"\)\s*\.forEach\(\(element\) => element\.remove\(\)\)/);
});

// === Paměť prohlížení (listing-memory.js) ===

function loadMemory({ storage = {}, withBoxes = true, pathname = "/mobily/18843445.htm", prepare = null } = {}) {
  const { AlzaCore, context, chrome } = loadCore({ storage, files: ["src/shared/store.js"] });
  vm.runInContext("AlzaStore.isWriter = true;", context);
  const page = createPage({ withBoxes });
  const reads = [];
  const get = chrome.storage.local.get.bind(chrome.storage.local);
  chrome.storage.local.get = async (keys) => (reads.push(keys), get(keys));
  const categoryUpdates = [];
  Object.assign(context, {
    document: page.document,
    window: windowAt(pathname),
    MutationObserver: observerStub,
    Node: { ELEMENT_NODE: 1 },
    AlzaIcons: { prepend: (element) => element },
    AlzaPriceTracker: {
      createEl(tag, className, text) {
        const element = new El(tag, className || "");
        if (text !== undefined) element.textContent = text;
        return element;
      },
    },
    AlzaUnitPrice: { scheduleUpdate: () => categoryUpdates.push(Date.now()) },
  });
  prepare?.(page);
  vm.runInContext(read("src/content/texts.js"), context, { filename: "src/content/texts.js" });
  vm.runInContext(read("src/listing-memory.js"), context, { filename: "src/listing-memory.js" });
  const memory = vm.runInContext("AlzaListingMemory", context);
  const actions = (item) => item.querySelectorAll(".alza-price-tracker-memory-action");
  const bar = () => page.html.querySelector(".alza-price-tracker-memory-bar");
  const isHidden = (item) => item.hasAttribute(memory.hiddenAttribute);
  return { AlzaCore, context, chrome, memory, page, reads, categoryUpdates, actions, bar, isHidden, data: chrome.storage.local.data };
}

test("paměť: data se načtou až s první dlaždicí", async () => {
  const { memory, page, reads } = loadMemory();
  await tick();
  assert.equal(reads.length, 0, "stránka bez výpisu nečte nastavení ani paměť");
  assert.equal(memory.state.loaded, false);
  memory.scan();
  await tick();
  assert.equal(reads.length, 0);
  const { item } = page.tile(1, "Xiaomi Redmi 15");
  memory.scan(); // Jako po změně DOM (observer)
  memory.scan();
  await tick();
  assert.equal(memory.state.loaded, true);
  assert.equal(reads.length, 2, "nastavení + čtyři klíče paměti jedním čtením, jen jednou");
  assert.ok(item.querySelector(".alza-price-tracker-memory"), "štítek s tlačítky po načtení");
});

test("paměť: dlaždice přepsaná jiným produktem dostane nová tlačítka – „Skrýt“ skryje produkt, který ukazuje", async () => {
  const { memory, page, actions, data, isHidden } = loadMemory();
  const { item, link } = page.tile(111, "Samsung Galaxy A56");
  memory.scan();
  await tick();
  const before = item.querySelector(".alza-price-tracker-memory");
  link.attrs.href = "/produkt-d222.htm"; // Tentýž uzel, jiný produkt téže značky
  link.textContent = "Samsung Galaxy S26";
  memory.scan();
  const after = item.querySelector(".alza-price-tracker-memory");
  assert.notEqual(after, before, "štítek překreslen");
  assert.match(after.dataset.signature, /alza_cz_222/);
  actions(item)[0].click();
  await tick();
  assert.deepEqual(Object.keys(data.alzaHidden), ["alza_cz_222"]);
  assert.equal(data.alzaHidden.alza_cz_222.name, "Samsung Galaxy S26");
  assert.equal(isHidden(item), true);
});

test("paměť: tlačítko „Skrýt“ má přístupný název s názvem produktu, „Skrýt značku“ nese značku", async () => {
  for (const lang of LANGUAGES) {
    const { memory, page, actions } = loadMemory();
    const { item } = page.tile(1, '49" Samsung Odyssey OLED G9');
    memory.scan();
    await tick();
    memory.state.lang = lang;
    memory.state.version++;
    memory.scan();
    const [hide, hideBrand] = actions(item);
    const label = hide.getAttribute("aria-label");
    assert.ok(label.includes('49" Samsung Odyssey OLED G9'), `${lang}: ${label}`);
    assert.ok(label.startsWith(hide.textContent), `${lang}: přístupný název začíná viditelným textem`);
    assert.doesNotMatch(label, /\{0\}/);
    assert.match(hideBrand.textContent, /Samsung/, `${lang}: značka televize je za úhlopříčkou`);
    assert.doesNotMatch(hideBrand.textContent, /49/);
  }
});

test("paměť: skrytá značka u televize a vrácení značky uložené starým klíčem", async () => {
  const storage = { alzaHiddenBrands: { new: { name: "New", at: 1 }, samsung: { name: "Samsung", at: 1 } } };
  const { memory, page, actions, data, isHidden, bar } = loadMemory({ storage });
  const balance = page.tile(1, "New Balance 574");
  const era = page.tile(2, "New Era 9Forty");
  const tv = page.tile(3, '49" Samsung Odyssey OLED G9');
  const apple = page.tile(4, "Apple iPhone 17");
  memory.scan();
  await tick();
  assert.deepEqual([balance, era, tv, apple].map(({ item }) => item.getAttribute(memory.hiddenAttribute)), ["brand", "brand", "brand", null]);
  assert.match(bar().textContent, /3/);
  assert.equal(actions(balance.item).length, 1);
  assert.equal(actions(balance.item)[0].textContent, "Znovu ukazovat New", "název, pod kterým je značka uložená");
  actions(balance.item)[0].click();
  await tick();
  assert.deepEqual(Object.keys(data.alzaHiddenBrands), ["samsung"], "smazán starý klíč „new“");
  assert.equal(isHidden(balance.item), false);
  assert.equal(isHidden(era.item), false);
  // Teď jde skrýt jen New Balance
  const hideBrand = actions(balance.item)[1];
  assert.equal(hideBrand.textContent, "Skrýt značku New Balance");
  hideBrand.click();
  await tick();
  assert.deepEqual(plain(data.alzaHiddenBrands["new balance"]).name, "New Balance");
  assert.equal(isHidden(balance.item), true);
  assert.equal(isHidden(era.item), false, "New Era zůstává");
});

test("paměť: po vrácení posledního skrytého se „Zobrazit skryté“ vypne", async () => {
  const { memory, page, actions, bar, isHidden } = loadMemory();
  const a = page.tile(1, "Xiaomi Redmi 15");
  const b = page.tile(2, "Honor 400");
  memory.scan();
  await tick();
  actions(a.item)[0].click(); // Skrýt A
  await tick();
  bar().querySelector(".alza-price-tracker-memory-action").click(); // Zobrazit skryté
  assert.equal(page.html.hasAttribute(memory.showAttribute), true);
  assert.equal(memory.state.showHidden, true);
  actions(a.item)[0].click(); // Znovu ukazovat A – nic skrytého
  await tick();
  assert.equal(bar(), null);
  assert.equal(memory.state.showHidden, false, "dřív zůstalo true");
  assert.equal(page.html.hasAttribute(memory.showAttribute), false);
  actions(b.item)[0].click(); // Skrýt B
  await tick();
  assert.equal(isHidden(b.item), true);
  assert.equal(page.html.hasAttribute(memory.showAttribute), false, "B je opravdu skrytý");
  assert.equal(bar().querySelector(".alza-price-tracker-memory-action").textContent, "Zobrazit skryté", "dřív „Skrýt je znovu“");
});

test("paměť: skrývá se jen ve výpisu #boxes; mimo něj zůstává „prohlédnuto“ a poznámka bez tlačítek", async () => {
  const storage = {
    alzaHidden: { alza_cz_1: { at: 1 }, alza_cz_2: { at: 1 } },
    alzaHiddenBrands: { honor: { name: "Honor", at: 1 } },
    alzaNotes: { alza_cz_3: { text: "počkat na slevu", at: 1 } },
  };
  const { memory, page, actions, bar, isHidden } = loadMemory({ storage });
  const carousel = page.body.appendChild(new El("div", "carousel"));
  const inList = page.tile(1, "Xiaomi Redmi 15");
  const outside = page.tile(2, "Xiaomi Redmi 14", "", carousel);
  const outsideNote = page.tile(3, "Honor 400", "", carousel);
  const outsidePlain = page.tile(4, "Apple iPhone 17", "", carousel);
  memory.scan();
  await tick();
  assert.equal(isHidden(inList.item), true);
  assert.equal(isHidden(outside.item), false, "mimo výpis by skrytí nešlo vrátit (lišta je jen nad #boxes)");
  assert.equal(isHidden(outsideNote.item), false);
  assert.match(bar().textContent, /1/, "lišta počítá jen výpis");
  assert.equal(outside.item.querySelector(".alza-price-tracker-memory"), null, "bez údajů žádný štítek");
  assert.equal(outsidePlain.item.querySelector(".alza-price-tracker-memory"), null);
  const noteBadge = outsideNote.item.querySelector(".alza-price-tracker-memory");
  assert.match(noteBadge.textContent, /počkat na slevu/);
  assert.equal(actions(outsideNote.item).length, 0, "mimo výpis bez tlačítek skrytí");
  assert.equal(read("src/listing-memory.js").includes("item.closest(this.selectors.container)"), true);
});

test("paměť: stránka bez #boxes nic neskryje", async () => {
  const { memory, page, isHidden, bar } = loadMemory({ storage: { alzaHidden: { alza_cz_1: { at: 1 } } }, withBoxes: false });
  const { item } = page.tile(1, "Xiaomi Redmi 15");
  memory.scan();
  await tick();
  assert.equal(isHidden(item), false, "dřív skrytá bez možnosti vrácení");
  assert.equal(bar(), null);
});

test("paměť: změna skrytí dá vědět výpisu (počty filtru, kandidáti provozu), průchod beze změny ne", async () => {
  const { memory, page, actions, categoryUpdates } = loadMemory();
  const { item } = page.tile(1, "Xiaomi Redmi 15");
  page.tile(2, "Honor 400");
  memory.scan();
  await tick();
  assert.equal(categoryUpdates.length, 0);
  actions(item)[0].click();
  await tick();
  assert.equal(categoryUpdates.length, 1, "skrytí");
  memory.scan();
  memory.scan();
  assert.equal(categoryUpdates.length, 1, "beze změny");
  actions(item)[0].click();
  await tick();
  assert.equal(categoryUpdates.length, 2, "vrácení");
});

test("paměť (Firefox po aktualizaci): init odebere štítky, lištu a atributy staré instance", async () => {
  let oldBadge;
  let oldBar;
  let oldTile;
  const { memory, page, actions } = loadMemory({
    storage: { alzaHidden: { alza_cz_2: { at: 1 } } },
    prepare: (prepared) => {
      // Stará instance: štítek se stejným podpisem (nová by ho nepřekreslila), lišta a „Zobrazit skryté“
      oldTile = prepared.tile(1, "Xiaomi Redmi 15");
      oldBadge = new El("div", "alza-price-tracker-memory");
      oldBadge.dataset.signature = "stará";
      oldTile.link.before(oldBadge);
      oldTile.item.setAttribute("data-alza-price-tracker-memory-hidden", "product"); // Už skrytý není
      oldBar = new El("div", "alza-price-tracker-memory-bar alza-price-tracker-listing-bar");
      prepared.boxes.before(oldBar);
      prepared.html.setAttribute("data-alza-price-tracker-memory-show", "");
    },
  });
  assert.equal(oldBadge.isConnected, false, "starý štítek pryč hned v init");
  assert.equal(oldBar.isConnected, false, "stará lišta pryč");
  assert.equal(page.html.hasAttribute(memory.showAttribute), false);
  assert.equal(oldTile.item.hasAttribute(memory.hiddenAttribute), false);
  await tick();
  assert.equal(actions(oldTile.item).length, 2, "nová instance vykreslila živá tlačítka");
  const init = read("src/listing-memory.js");
  assert.ok(init.indexOf("this.cleanUp();") < init.indexOf("this.listPagePattern.test(window.location.pathname)"), "úklid je první krok init");
});

test("paměť: na nákupním seznamu (Order1.htm) se nic nesleduje", async () => {
  const { memory, page, reads } = loadMemory({ pathname: "/Order1.htm" });
  page.tile(1, "Xiaomi Redmi 15");
  await tick();
  assert.equal(reads.length, 0);
  assert.equal(memory.state.loaded, false);
});

test("výkon paměti: odkaz dlaždice se rozebírá jednou a popis dlaždice jen po změně dat", async () => {
  const { memory, page, AlzaCore, chrome } = loadMemory();
  for (let id = 1; id <= 50; id++) page.tile(id, `Samsung Galaxy A${id}`);
  memory.scan();
  await tick();
  const counts = { key: 0, brand: 0 };
  const getProductKey = AlzaCore.getProductKey.bind(AlzaCore);
  const getBrandFromName = AlzaCore.getBrandFromName.bind(AlzaCore);
  AlzaCore.getProductKey = (...args) => (counts.key++, getProductKey(...args));
  AlzaCore.getBrandFromName = (...args) => (counts.brand++, getBrandFromName(...args));
  memory.scan();
  memory.scan();
  assert.deepEqual(counts, { key: 0, brand: 0 }, "průchod beze změny nic nepočítá");
  await chrome.storage.local.set({ alzaNotes: { alza_cz_7: { text: "poznámka", at: 1 } } });
  assert.equal(counts.key, 0, "odkazy se znovu nerozebírají");
  assert.ok(counts.brand >= 50, "po změně dat se popis dlaždic přepočítá");
  assert.match(page.boxes.children[6].querySelector(".alza-price-tracker-memory").textContent, /poznámka/);
});

// === č. 20: prázdný hlídaný seznam ===

function loadWatch({ loginState = true } = {}) {
  const watched = {
    "alza_cz|111": {
      domain: "alza_cz",
      listId: "111",
      name: "Vánoce",
      url: "https://www.alza.cz/Order1.htm?listId=111",
      since: 1,
      syncedAt: 2,
      products: { "https://www.alza.cz/a-d1.htm": { name: "A" }, "https://www.alza.cz/b-d2.htm": { name: "B" }, "https://www.alza.cz/c-d3.htm": { name: "C" } },
    },
  };
  const { AlzaCore, context, chrome } = loadCore({ storage: { alzaWatchLists: watched }, files: ["src/shared/store.js"] });
  const selectors = {
    listItem: '[data-testid="shoppingListItem"]',
    selectedListTab: '[data-testid="shoppingListsTabs_selectedItem"]',
    listTabName: '[data-testid="shoppingListsTabs_itemName"]',
    listTabCount: '[data-testid="shoppingListsTabs_itemCount"]',
  };
  const page = { tabName: "Vánoce", tabCount: "(0)", items: [], login: loginState };
  const document = {
    title: "Nákupní seznam | Alza.cz",
    querySelector: (selector) =>
      selector.endsWith(selectors.listTabName) ? (page.tabName === null ? null : { textContent: page.tabName }) : selector.endsWith(selectors.listTabCount) ? (page.tabCount === null ? null : { textContent: page.tabCount }) : null,
    querySelectorAll: () => page.items,
  };
  Object.assign(context, { document, window: { location: { href: "https://www.alza.cz/Order1.htm?listId=111", hostname: "www.alza.cz" } } });
  const loginDocs = [];
  AlzaCore.getLoginState = (doc) => (loginDocs.push(doc), page.login);
  vm.runInContext(
    "AlzaStore.isWriter = true; var AlzaPriceTracker = { selectors: null, getAlzaDomain: () => 'alza_cz', getStorageData: (key) => chrome.storage.local.get(key), getProductInfo: (item) => item.product };",
    context
  );
  context.AlzaPriceTracker.selectors = selectors;
  vm.runInContext(read("src/content/watch.js"), context, { filename: "src/content/watch.js" });
  const list = () => chrome.storage.local.data.alzaWatchLists["alza_cz|111"];
  return { tracker: context.AlzaPriceTracker, page, list, document, loginDocs };
}

test("č. 20: hlídaný seznam nepřepíše prázdná záložka jiného seznamu", async () => {
  const { tracker, page, list } = loadWatch();
  page.tabName = "Nákupní seznam"; // Adresa má listId=111, vybraná záložka je jiný prázdný seznam „(0)“
  await tracker.syncWatchedList("111", { allowEmpty: true });
  assert.equal(Object.keys(list().products).length, 3, "dřív 0 produktů");
  assert.equal(list().name, "Vánoce", "dřív cizí jméno „Nákupní seznam“");
  assert.equal(list().syncedAt, 2, "nic se nezapsalo");
  page.tabName = null; // Záložka se nenašla
  await tracker.syncWatchedList("111", { allowEmpty: true });
  assert.equal(Object.keys(list().products).length, 3);
});

test("č. 20: hlídaný seznam se nevyprázdní odhlášenému ani při neznámém stavu přihlášení", async () => {
  for (const loginState of [false, null]) {
    const { tracker, list, loginDocs, document } = loadWatch({ loginState });
    await tracker.syncWatchedList("111", { allowEmpty: true }); // Jméno záložky sedí, počet „(0)“
    assert.equal(Object.keys(list().products).length, 3, `přihlášení ${loginState}`);
    assert.equal(loginDocs[0], document, "stav přihlášení se čte ze stránky");
  }
});

test("č. 20: přihlášenému se seznam se stejným jménem záložky a „(0)“ vyprázdní; ostatní cesty beze změny", async () => {
  const { tracker, page, list } = loadWatch();
  await tracker.syncWatchedList("111"); // Bez allowEmpty prázdný DOM nic nepřepíše
  assert.equal(Object.keys(list().products).length, 3);
  page.tabCount = null;
  await tracker.syncWatchedList("111", { allowEmpty: true }); // Záložka bez počtu
  assert.equal(Object.keys(list().products).length, 3);
  page.tabCount = "(2)";
  await tracker.syncWatchedList("111", { allowEmpty: true }); // Záložka říká 2, stránka nic – nedokreslený seznam
  assert.equal(Object.keys(list().products).length, 3);

  page.tabCount = "(0)";
  page.tabName = "  Vánoce "; // Mezery kolem jména nevadí
  await tracker.syncWatchedList("111", { allowEmpty: true });
  assert.equal(Object.keys(list().products).length, 0, "opravdu prázdný seznam se vyprázdní");
  assert.equal(list().since, 1, "hlídá se dál od stejné doby");
  assert.equal(list().name, "Vánoce");
});

test("č. 20: seznam s položkami se synchronizuje jako dřív – i odhlášenému a po přejmenování", async () => {
  const { tracker, page, list } = loadWatch({ loginState: false });
  page.tabName = "Dárky";
  page.tabCount = "(1)";
  page.items = [{ product: { url: "https://www.alza.cz/x-d9.htm", name: "X", image: null } }];
  await tracker.syncWatchedList("111");
  assert.deepEqual(Object.keys(list().products), ["https://www.alza.cz/x-d9.htm"]);
  assert.equal(list().name, "Dárky");
});

test("č. 20: content.js vyprázdnění dál spouští jen po ustálení stránky a s „(0)“; podmínky jsou v syncWatchedList", () => {
  const watch = read("src/content/watch.js");
  const sync = watch.slice(watch.indexOf("async syncWatchedList("), watch.indexOf("markListSeen("));
  assert.match(sync, /length === 0 && !this\.isOwnEmptyList\(existing\)\) return;/);
  assert.ok(sync.indexOf("isOwnEmptyList(existing)") < sync.indexOf("AlzaStore.run("), "kontrola před zápisem");
  assert.match(watch, /AlzaCore\.getLoginState\(document\) !== true\) return false;/);
});

// === Celý průchod: category.js i listing-memory.js nad stejnou stránkou ===

test("celý průchod: výpis televizí – lišta „Spočítat provoz“, skrytí značky, načtení spotřeby a štítek provozu", async () => {
  const { category, page, context, chrome, respondWith, requests, data } = loadCategory();
  // Paměť prohlížení ve stejném kontextu (jako v prohlížeči – skripty sdílí globální prostor)
  Object.assign(context, {
    Node: { ELEMENT_NODE: 1 },
    AlzaPriceTracker: {
      createEl(tag, className, text) {
        const element = new El(tag, className || "");
        if (text !== undefined) element.textContent = text;
        return element;
      },
    },
  });
  context.requestAnimationFrame = (callback) => (setTimeout(callback, 0), 0); // scheduleUpdate opravdu proběhne
  const tiles = [
    page.tile(1, '65" LG OLED65C64LA', "Televize - OLED, 164cm, 4K Ultra HD"),
    page.tile(2, '60" Metz 60MNH7000Z', TV),
    page.tile(3, '55" LG OLED55B65LA', "Televize - OLED, 139cm, 4K Ultra HD"),
    page.tile(4, "Stell SHO 1050", "Držák na TV - VESA 200×200, nosnost 35kg"),
    page.tile(5, "Apple TV 4K 2022 64GB", "Multimediální centrum - s podporou 4K"),
  ];
  // Cenový box dlaždice (kotva štítku provozu) – ceny dodá náhrada čtení cen
  tiles.forEach(({ item }) => item.appendChild(new El("div", "price__price-box-wrapper")));
  context.AlzaCore.hasListingQuantityDiscount = () => false;
  context.AlzaCore.extractPricesFromListingItem = () => ({ original: 20000 });
  vm.runInContext(read("src/content/texts.js"), context, { filename: "src/content/texts.js" });
  vm.runInContext(read("src/listing-memory.js"), context, { filename: "src/listing-memory.js" });
  const memory = vm.runInContext("AlzaListingMemory", context);
  await category.init();
  await tick();
  assert.equal(category.state.energy.enabled, true, "cena provozu je ve výchozím nastavení zapnutá");
  assert.equal(barButton(category).textContent, "Spočítat provoz (3)", "držák a Apple TV se nenačítají");

  // Skrytí značky LG na první dlaždici: paměť nastaví atribut a dá vědět výpisu
  const hideBrand = tiles[0].item.querySelectorAll(".alza-price-tracker-memory-action")[1];
  assert.equal(hideBrand.textContent, "Skrýt značku LG");
  hideBrand.click();
  await tick(20);
  assert.deepEqual(tiles.map(({ item }) => item.hasAttribute(memory.hiddenAttribute)), [true, false, true, false, false]);
  assert.equal(barButton(category).textContent, "Spočítat provoz (1)", "skryté televize LG se nenačítají");

  respondWith(() => product);
  await category.fetchEnergy();
  await tick(20);
  assert.deepEqual(requests, ["https://www.alza.cz/produkt-d2.htm"]);
  assert.deepEqual(Object.keys(data.alzaEnergy), ["alza_cz_2"]);
  const label = tiles[1].item.querySelector(".alza-price-tracker-param-price");
  assert.match(label?.textContent || "", /^provoz 10 let: /, "štítek ceny provozu u načtené televize");
  assert.match(barTexts(category)[1], /Spotřeba načtena \(1\)/);
  assert.equal(chrome.storage.local.data.alzaHiddenBrands.lg.name, "LG");
});
