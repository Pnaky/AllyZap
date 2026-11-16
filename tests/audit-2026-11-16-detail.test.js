// Audit 2026-11-16, balík „detail produktu, souhrn košíku, recenze, Dochází vám?“: souhrn košíku z ceny v řádku (č. 14),
// Recenze naruby – věty bez výtky, kmeny slov, váha kritických recenzí (č. 15), chyby načtení recenzí, poznámka
// k produktu (zápis, fokus, popisek), rytmus nákupů podle kusů, cena „teď“ v Dochází vám?, faktura bez dobropisu,
// změna adresy detailu bez načtení stránky a přístupnost panelu recenzí.
// Spuštění: node --test "tests/*.test.js"
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { loadCore } = require("./load-core");

const ROOT = path.resolve(__dirname, "..");
// Konce řádků sjednotit – pracovní kopie na Windows (core.autocrlf) má CRLF, regexy počítají s LF
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8").replace(/\r\n/g, "\n");
// Objekty z izolovaného kontextu mají jiný prototyp – porovnávat jako prostá data
const plain = (value) => JSON.parse(JSON.stringify(value));
const DAY = 24 * 60 * 60 * 1000;
const LANGS = ["cz", "sk", "hu", "en"];
const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

// === Náhrada DOM: jen to, co karta detailu a košík používají (třídy, atributy, posluchače, fokus) ===

class FakeText {
  constructor(text) {
    this.text = String(text);
    this.parentNode = null;
  }
  get textContent() {
    return this.text;
  }
  remove() {
    this.parentNode?.removeChild(this);
  }
}

class FakeElement {
  constructor(tag, doc) {
    Object.assign(this, { tagName: String(tag).toUpperCase(), ownerDocument: doc, childNodes: [], parentNode: null, attributes: new Map(), listeners: new Map() });
    Object.assign(this, { className: "", hidden: false, style: {}, dataset: {}, value: "", title: "" });
  }
  get children() {
    return this.childNodes.filter((node) => node instanceof FakeElement);
  }
  get firstElementChild() {
    return this.children[0] || null;
  }
  get nextSibling() {
    const siblings = this.parentNode?.childNodes || [];
    return siblings[siblings.indexOf(this) + 1] || null;
  }
  get textContent() {
    return this.childNodes.map((node) => node.textContent).join("");
  }
  set textContent(value) {
    [...this.childNodes].forEach((node) => this.removeChild(node));
    if (String(value) !== "") this.appendChild(String(value));
  }
  adopt(node) {
    const child = typeof node === "string" ? new FakeText(node) : node;
    child.parentNode?.removeChild(child);
    child.parentNode = this;
    return child;
  }
  removeChild(node) {
    const index = this.childNodes.indexOf(node);
    if (index >= 0) this.childNodes.splice(index, 1);
    node.parentNode = null;
    // Odebraný prvek s fokusem o něj přijde (jako v prohlížeči)
    const active = this.ownerDocument.activeElement;
    if (active && node instanceof FakeElement && node.contains(active)) this.ownerDocument.activeElement = null;
  }
  appendChild(node) {
    this.childNodes.push(this.adopt(node));
    return node;
  }
  append(...nodes) {
    nodes.forEach((node) => this.appendChild(node));
  }
  insertBefore(node, reference) {
    const child = this.adopt(node);
    const index = reference ? this.childNodes.indexOf(reference) : -1;
    if (index < 0) this.childNodes.push(child);
    else this.childNodes.splice(index, 0, child);
    return node;
  }
  remove() {
    this.parentNode?.removeChild(this);
  }
  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }
  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }
  removeAttribute(name) {
    this.attributes.delete(name);
  }
  addEventListener(type, listener) {
    this.listeners.set(type, [...(this.listeners.get(type) || []), listener]);
  }
  // Událost na prvku a (jako bublání) na předcích
  dispatch(type, init = {}) {
    const event = { type, target: this, preventDefault() {}, stopPropagation() {}, ...init };
    for (let node = this; node; node = node.parentNode) (node.listeners?.get(type) || []).forEach((listener) => listener(event));
    return event;
  }
  click() {
    this.dispatch("click");
  }
  focus() {
    this.ownerDocument.activeElement = this;
  }
  matches(selector) {
    return selector.startsWith(".") && this.className.split(/\s+/).includes(selector.slice(1));
  }
  closest(selector) {
    for (let node = this; node; node = node.parentNode) if (node.matches?.(selector)) return node;
    return null;
  }
  contains(other) {
    for (let node = other; node; node = node.parentNode) if (node === this) return true;
    return false;
  }
  querySelectorAll(selector) {
    return this.children.flatMap((child) => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]);
  }
  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }
}

function createDocument() {
  const doc = { activeElement: null, title: "Produkt" };
  doc.createElement = (tag) => new FakeElement(tag, doc);
  doc.body = doc.createElement("body");
  doc.querySelector = (selector) => doc.body.querySelector(selector);
  doc.querySelectorAll = (selector) => doc.body.querySelectorAll(selector);
  return doc;
}

// Části content scriptu nad jádrem: texty, hodnocení cen, košík a karta detailu. AlzaPriceTracker tu má jen metody,
// které jinak dodává content.js / history.js (překlad, createEl, doména); storeRun = náhrada AlzaStore.run
function loadTracker({ fetch = null, storeRun = async () => {}, pathname = "/produkt-d111.htm" } = {}) {
  const { AlzaCore, context, chrome } = loadCore();
  const document = createDocument();
  const calls = { store: [] };
  Object.assign(context, {
    document,
    window: { location: { origin: "https://www.alza.cz", hostname: "www.alza.cz", pathname, search: "", href: `https://www.alza.cz${pathname}` } },
    AbortController,
    fetch,
    AlzaStore: {
      run: async (op) => {
        calls.store.push(op);
        return storeRun(op);
      },
    },
    AlzaIcons: { create: (doc) => doc.createElement("svg"), prepend: (element) => element },
  });
  vm.runInContext(read("src/content/texts.js"), context, { filename: "src/content/texts.js" });
  vm.runInContext(
    `var AlzaPriceTracker = {
      translations: AlzaPriceTrackerTexts,
      state: { uiLanguage: "cz", language: "cz", locale: "cs-CZ", targets: {}, productNote: null, ownedProduct: null },
      translate(key, ...params) { return AlzaCore.translateFrom(this.translations, this.state.uiLanguage, key, params); },
      createEl(tag, className, text) {
        const element = document.createElement(tag);
        if (className) element.className = className;
        if (text !== undefined) element.textContent = text;
        return element;
      },
      getAlzaDomain() { return "alza_cz"; },
      getProductKey(url) { return AlzaCore.getProductKey("alza_cz", url); },
      getHistoryKey(url) { return AlzaCore.getHistoryKey("alza_cz", url); },
      formatPrice(price) { return AlzaCore.formatPrice(price, "alza_cz"); },
      config: { verdictColors: {} },
    };`,
    context
  );
  for (const file of ["src/content/insights.js", "src/content/basket-codes.js", "src/content/basket-insights.js", "src/content/product-panel.js"]) {
    vm.runInContext(read(file), context, { filename: file });
  }
  return { AlzaCore, context, chrome, document, calls, tracker: vm.runInContext("AlzaPriceTracker", context) };
}

const review = (rating, negatives, extra = {}) => ({ rating, negatives, reviewDate: new Date(Date.now() - 10 * DAY).toISOString(), verifiedPurchaseTag: { label: "Ověřený nákup" }, description: "", ...extra });
const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => (body === undefined ? Promise.reject(new SyntaxError("Unexpected token < in JSON")) : body) });

// === č. 14 – Košík: souhrn a chipy z ceny v řádku, starý záznam se nepočítá ===

test("č. 14 – košík: cena za kus se čte z řádku košíku (cena řádku / počet kusů)", () => {
  const { tracker, context } = loadTracker();
  const row = (text, count) => {
    const link = { textContent: "Produkt", getAttribute: () => "/produkt-d123.htm" };
    const cell = { textContent: text, querySelector: () => null };
    return {
      querySelector: (selector) => (selector === ".c5" ? cell : selector === ".countInput input" ? { value: String(count) } : null),
      querySelectorAll: () => [link],
    };
  };
  context.document.querySelectorAll = () => [row("1 998 Kč", 2), row("Zdarma", 1)];
  const rows = tracker.getBasketRows();
  assert.deepEqual(plain(rows.map(({ url, count, unit }) => ({ url, count, unit }))), [
    { url: "https://www.alza.cz/produkt-d123.htm", count: 2, unit: 999 },
    { url: "https://www.alza.cz/produkt-d123.htm", count: 1, unit: null },
  ]);
  // Cenový box s uplatněným kódem: jen hlavní cena, ne přeškrtnutá
  const boxed = { querySelector: (selector) => (selector === ".c5" ? { textContent: "33 990 Kč 31 490 Kč", querySelector: (inner) => (inner.includes("price-value") ? { textContent: "31 490 Kč" } : { matches: () => true }) } : null) };
  assert.deepEqual(plain(tracker.getBasketRowPrice(boxed)), { value: 31490, discounted: true });
});

// Živý košík 2026-11-16: zlevněná položka má v buňce ceny přeškrtnutou původní cenu a pod ní cenu k zaplacení –
// <div class="c5"><div><span class="originalPrice">93 320 Kč</span></div>74 990 Kč</div>. Četla se první částka
// (přeškrtnutá) a zboží za obvyklou cenu dostalo „o 24 % nad obvyklou cenou“
test("košík: z buňky s přeškrtnutou původní cenou se bere cena k zaplacení", () => {
  const { tracker, context } = loadTracker();
  const struck = { textContent: "93 320 Kč" };
  const cell = { textContent: " 93 320 Kč74 990 Kč ", querySelector: () => null, querySelectorAll: (selector) => (selector.includes(".originalPrice") ? [struck] : []) };
  const link = { textContent: "Televize", getAttribute: () => "/televize-d123.htm" };
  const row = { querySelector: (selector) => (selector === ".c5" ? cell : selector === ".countInput input" ? { value: "1" } : null), querySelectorAll: () => [link] };
  assert.deepEqual(plain(tracker.getBasketRowPrice(row)), { value: 74990, discounted: false });
  context.document.querySelectorAll = () => [row];
  assert.equal(tracker.getBasketRows()[0].unit, 74990);

  // Hodnocení: 74 990 Kč je obvyklá cena – žádné „nad obvyklou cenou“ u položky ani v souhrnu
  const now = Date.UTC(2026, 10, 16, 12);
  const ago = (days) => now - days * DAY;
  const entries = [
    { t: ago(14), s: ago(8), p: { original: 93320, special: 74990 } },
    { t: ago(8), s: ago(7), p: { original: 93320, special: 69990 } },
    { t: ago(7), s: now, p: { original: 93320, special: 74990 } },
  ];
  const record = { original: 93320, special: 74990, lastUpdated: now };
  assert.notEqual(tracker.getBasketRowStats(record, entries, 1, 74990, now).level, "high");
  assert.deepEqual(plain(tracker.getBasketInsightChips(record, entries, 1, 74990, now).filter(({ tone }) => tone === "high")), []);
});

test("č. 14 – košík: záznam starý 90 dní s akcí 799 Kč neudělá z dnešních 999 Kč „pod obvyklou cenou“ ani podezřelou slevu", () => {
  const { tracker } = loadTracker();
  const now = Date.UTC(2026, 10, 16, 12);
  const ago = (days) => now - days * DAY;
  // Naposledy viděno před 90 dny v akci za 799 Kč; od té doby nic
  const entries = [
    { t: ago(300), s: ago(100), p: { original: 999 } },
    { t: ago(100), s: ago(90), p: { original: 999, special: 799 } },
  ];
  const stale = { original: 999, special: 799, lastUpdated: ago(90) };
  const fromRow = tracker.getBasketRowStats(stale, entries, 2, 999, now);
  assert.equal(fromRow.current, 999, "cena z řádku košíku, ne 799 ze záznamu");
  assert.notEqual(fromRow.level, "good");
  assert.equal(fromRow.warn, false, "podezřelá sleva stojí na cenách ze starého záznamu");
  // Cenu řádku nejde přečíst → starý záznam se do souhrnu nepočítá vůbec
  assert.equal(tracker.getBasketRowStats(stale, entries, 2, null, now), null);
  assert.deepEqual(plain(tracker.getBasketInsightChips(stale, entries, 2, null, now)), []);
  // Chipy u položky berou totéž: ze starého záznamu žádná výstraha ani „pod obvyklou cenou“
  const chips = tracker.getBasketInsightChips(stale, entries, 2, 999, now);
  assert.deepEqual(plain(chips.filter(({ tone }) => tone === "warn" || tone === "good")), []);
  // Limit je stejný jako u kódů (3 dny)
  assert.equal(tracker.basketCodeMaxAgeDays, 3);
  assert.equal(tracker.getBasketItemPrice({ original: 999, lastUpdated: ago(4) }, null, now), null);
  assert.deepEqual(plain(tracker.getBasketItemPrice({ original: 999, lastUpdated: ago(2) }, null, now)), { current: 999, priceMap: { original: 999 } });
  assert.equal(tracker.getBasketItemPrice(null, 999, now), null, "bez záznamu není historie – nic se nehodnotí");
  // Špatně přečtená cena řádku (pod polovinou / nad dvojnásobkem cen záznamu) se nebere: čerstvý záznam ji nahradí,
  // se starým se nehodnotí nic
  assert.equal(tracker.getBasketItemPrice({ original: 999, lastUpdated: ago(1) }, 99, now).current, 999);
  assert.equal(tracker.getBasketItemPrice({ original: 999, lastUpdated: ago(1) }, 2500, now).current, 999);
  assert.equal(tracker.getBasketItemPrice({ original: 999, lastUpdated: ago(90) }, 99, now), null);
  assert.equal(tracker.getBasketItemPrice({ original: 999, lastUpdated: ago(90) }, 899, now).current, 899);
});

test("č. 14 – košík: čerstvý záznam dál hlásí slevu i podezřelou slevu; cena řádku má přednost před cenou ze záznamu", () => {
  const { tracker, AlzaCore } = loadTracker();
  const now = Date.UTC(2026, 10, 16, 12);
  const ago = (days) => now - days * DAY;
  // Souvislá historie: 999 Kč, před 2 dny akce 799 Kč
  const sale = [
    { t: ago(300), s: ago(2), p: { original: 999 } },
    { t: ago(2), s: now, p: { original: 999, special: 799 } },
  ];
  const fresh = { original: 999, special: 799, lastUpdated: ago(1) };
  assert.equal(AlzaCore.getPriceVerdict(sale, 799, now).level !== "usual", true, "předpoklad testu: 799 Kč je pod obvyklou cenou");
  // Cenu řádku nejde přečíst → čerstvý záznam ji nahradí
  const fromRecord = tracker.getBasketRowStats(fresh, sale, 1, null, now);
  assert.deepEqual(plain({ level: fromRecord.level, current: fromRecord.current, typical: fromRecord.typical }), { level: "good", current: 799, typical: 999 });
  // V košíku je ale 999 Kč (akce se na tenhle nákup nevztahuje) → hodnotí se 999 Kč
  const fromRow = tracker.getBasketRowStats(fresh, sale, 1, 999, now);
  assert.deepEqual(plain({ level: fromRow.level, current: fromRow.current }), { level: "usual", current: 999 });
  assert.deepEqual(plain(AlzaCore.summarizeBasket([fromRow])), { high: { n: 0, amount: 0 }, good: { n: 0, amount: 0 }, wait: 0, warn: 0 });

  // Podezřelá sleva: „akce“ 899 Kč, před 15 dny bylo 799 Kč – s čerstvým záznamem výstraha zůstává
  const suspicious = [
    { t: ago(300), s: ago(20), p: { original: 999 } },
    { t: ago(20), s: ago(10), p: { original: 999, special: 799 } },
    { t: ago(10), s: now, p: { original: 999, special: 899 } },
  ];
  const record = { original: 999, special: 899, lastUpdated: ago(1) };
  assert.equal(tracker.getBasketRowStats(record, suspicious, 1, 899, now).warn, true);
  assert.equal(tracker.getBasketInsightChips(record, suspicious, 1, 899, now).some(({ tone }) => tone === "warn"), true);
  // Týž záznam o 5 dní starší → výstraha se z něj nedělá
  assert.equal(tracker.getBasketRowStats({ ...record, lastUpdated: ago(5) }, suspicious, 1, 899, now).warn, false);
  assert.equal(tracker.getBasketInsightChips({ ...record, lastUpdated: ago(5) }, suspicious, 1, 899, now).some(({ tone }) => tone === "warn"), false);
});

// === č. 15 – Recenze naruby ===

test("č. 15 – recenze: věty bez výtky se vyřadí podle obsahu (cz / sk / hu / en)", () => {
  const { AlzaCore } = loadCore();
  const empty = {
    cz: ["Zatím jsem na nic nepřišel", "Zatím jsem na nic nepřišla", "Na nic jsem nepřišel", "Žádné zápory", "Bez záporů", "Nenašel jsem", "Zatím nic nenašel", "Nic mě nenapadá", "Zatím bez problémů", "Žádné zápory jsem nenašel", "Nevím o žádných", "Zatím žádné", "nic", "-", "Zatím nic.", "Žádné!", "Nemám výhrady", "Bez výhrad", "Nemám co vytknout", "Vše OK", "n/a"],
    sk: ["Zatiaľ som na nič neprišiel", "Žiadne zápory", "Zatiaľ žiadne", "Nenašiel som", "Zatiaľ bez problémov", "Žiadne zápory som nenašiel", "nič", "Zatiaľ nič"],
    hu: ["Nincs negatívum", "Eddig semmi", "Nem találtam hibát", "Nincs hátránya", "Eddig nincs", "Nem találtam", "semmi", "nincs"],
    en: ["No cons so far", "Nothing so far", "No cons", "None so far", "nothing", "No issues so far", "Can't think of anything", "Haven't found any"],
  };
  for (const [lang, phrases] of Object.entries(empty)) {
    for (const phrase of phrases) assert.equal(AlzaCore.isEmptyReviewNegative(phrase), true, `${lang}: „${phrase}“ není výtka`);
    // Audit: „nenašel ×3, nepřišel ×2, zápory ×2“ – z těchhle vět nesmí vzniknout žádná výtka
    const analysis = AlzaCore.analyzeReviews(phrases.map((phrase) => review(5, [phrase])));
    assert.deepEqual(plain(analysis.complaints), [], lang);
    assert.equal(analysis.count, phrases.length);
  }
  // Skutečná výtka zůstává, i když začíná stejně nebo obsahuje zápor
  for (const phrase of ["Zatím nic, jen vyšší cena", "Nemá NFC", "Bez nabíječky", "Nevydrží ani den", "Chybí sluchátka", "Slabá baterie", "Nem jó az akkumulátor", "No headphone jack", "Nič moc výdrž", "Není v pořádku", "Not good", "Problémy"]) {
    assert.equal(AlzaCore.isEmptyReviewNegative(phrase), false, `„${phrase}“ je výtka`);
  }
  // Vata z věty s výtkou se mezi výtky nedostane („nenašel“, „zápory“), výtka ano
  const mixed = AlzaCore.analyzeReviews([review(4, ["Zápory jsem nenašel, snad jen vyšší cena"]), review(5, ["Žádné zápory jsem nenašel, možná cena"])]);
  assert.deepEqual(plain(mixed.complaints.map(({ word, count }) => [word, count])), [["cena", 2]]);
});

test("č. 15 – recenze: tvary téhož slova se sečtou podle kmene, chip ukáže nejčastější tvar", () => {
  const { AlzaCore } = loadCore();
  const battery = AlzaCore.analyzeReviews([review(2, ["slabá baterie"]), review(2, ["výdrž baterky"]), review(1, ["baterii vybije za den"]), review(3, ["baterka"])]);
  assert.deepEqual(plain(battery.complaints.map(({ word, count, critical }) => [word, count, critical])), [["baterie", 4, 4]]);
  for (const forms of [["baterie", "baterka", "baterii", "baterky", "bateriemi"], ["cena", "ceny", "cenu", "cenou", "cenách"], ["výdrž", "výdrže", "výdrží"], ["kabel", "kabelu", "kabelem"], ["displej", "displeje", "displejem"]]) {
    assert.equal(new Set(forms.map((form) => AlzaCore.getReviewStem(form))).size, 1, forms.join(" / "));
  }
  // Různá slova zůstávají různá
  assert.equal(new Set(["baterie", "cena", "výdrž", "kabel", "displej", "váha", "hluk"].map((word) => AlzaCore.getReviewStem(word))).size, 7);
  // Jedna recenze se pro kmen počítá jednou, i když slovo opakuje v různých tvarech
  const once = AlzaCore.analyzeReviews([review(2, ["baterie, baterka a zase baterie"]), review(2, ["baterie"])]);
  assert.deepEqual(plain(once.complaints.map(({ word, count }) => [word, count])), [["baterie", 2]]);
});

test("č. 15 – recenze: výtky ze všech recenzí, kritické (do 3 ★) váží v pořadí dvojnásob; příklad z nejhorší recenze", () => {
  const { AlzaCore } = loadCore();
  const analysis = AlzaCore.analyzeReviews([
    review(5, ["vyšší cena"]),
    review(5, ["cena"]),
    review(4, ["cena mohla být nižší"]),
    review(1, ["Hlučný ventilátor, nedá se vedle něj spát"]),
    review(2, ["ventilátor hučí"]),
    review(5, ["ventilátor je slyšet"]),
    review(5, ["zatím nic"]),
  ]);
  // ventilátor: 3 recenze, 2 kritické (váha 5) před cenou: 3 recenze, žádná kritická (váha 3); počet zůstává skutečný
  assert.deepEqual(plain(analysis.complaints.map(({ word, count, critical }) => [word, count, critical])), [
    ["ventilátor", 3, 2],
    ["cena", 3, 0],
  ]);
  assert.equal(analysis.complaints[0].example, "Hlučný ventilátor, nedá se vedle něj spát");
  // Výtka jen ze spokojených recenzí nezmizí – u dobře hodnoceného zboží jiné nejsou
  assert.equal(analysis.complaints.some(({ word }) => word === "cena"), true);
  // Jedna zmínka nestačí
  assert.deepEqual(plain(AlzaCore.analyzeReviews([review(1, ["rozbitý displej"])]).complaints), []);
  // Zápory jako jeden řetězec nebo položky { text } se čtou také
  assert.equal(AlzaCore.analyzeReviews([review(1, "praská kloub"), review(2, [{ text: "kloub praská" }])]).complaints.length > 0, true);
});

// === Recenze – chyby načtení ===

test("recenze: nečekaná odpověď není „žádné recenze“", async () => {
  const { AlzaCore } = loadCore();
  assert.deepEqual(plain(AlzaCore.parseReviewsPage({ value: [], paging: {} })), { reviews: [], more: false });
  assert.equal(AlzaCore.parseReviewsPage({ value: Array(100).fill({}), paging: { next: "x" } }).more, true);
  for (const body of [null, {}, { items: [] }, { value: "x" }, [], "text"]) assert.equal(AlzaCore.parseReviewsPage(body), null, JSON.stringify(body));

  const product = { url: "https://www.alza.cz/produkt-d111.htm" };
  const load = (response) => loadTracker({ fetch: async () => response }).tracker.loadReviews(product);
  assert.equal((await load(reply(200, { value: [] }))).count, 0, "prázdné value = produkt nemá recenze");
  await assert.rejects(load(reply(200, { data: { reviews: [] } })), { kind: "format" });
  await assert.rejects(load(reply(200, undefined)), { kind: "format" }, "odpověď, která není JSON");
  await assert.rejects(load(reply(200, { value: [{ stars: 5 }, { stars: 1 }] })), { kind: "format" }, "recenze bez hodnocení 1–5");
  await assert.rejects(load(reply(500, {})), { kind: "http", status: 500 });
  await assert.rejects(load(reply(403, {})), { kind: "blocked", status: 403 });
  await assert.rejects(loadTracker({ fetch: async () => Promise.reject(new TypeError("Failed to fetch")) }).tracker.loadReviews(product), { kind: "network" });
});

test("recenze: chyba na 2. stránce nezahodí už načtené", async () => {
  const page = Array.from({ length: 100 }, () => review(4, ["hlučný ventilátor"]));
  for (const second of [reply(500, {}), reply(200, { unexpected: true }), reply(429, {})]) {
    const urls = [];
    const { tracker } = loadTracker({
      fetch: async (url) => {
        urls.push(url);
        return urls.length === 1 ? reply(200, { value: page, paging: { next: "x" } }) : second;
      },
    });
    const analysis = await tracker.loadReviews({ url: "https://www.alza.cz/produkt-d111.htm" });
    assert.equal(analysis.count, 100, `HTTP ${second.status}`);
    assert.equal(urls.length, 2);
    assert.match(urls[1], /offset=100&limit=100$/);
    assert.equal(Boolean(tracker.state.reviewsBlockedUntil), second.status === 429, "odstup jen po 403 / 429");
  }
});

test("recenze: časový limit – karta se uvolní a požadavek se zruší", async () => {
  let signal = null;
  const { tracker, AlzaCore } = loadTracker({
    fetch: (url, options) => {
      signal = options.signal;
      return new Promise(() => {}); // Alza neodpoví nikdy
    },
  });
  assert.equal(AlzaCore.reviewTimeoutMs, 15000);
  AlzaCore.reviewTimeoutMs = 20;
  await assert.rejects(tracker.loadReviews({ url: "https://www.alza.cz/produkt-d111.htm" }), { kind: "timeout" });
  assert.equal(signal.aborted, true);
});

test("recenze: ve Firefoxu jde požadavek přes content.fetch bez signálu, limit hlídá odpočet", async () => {
  const seen = [];
  const { tracker, context, AlzaCore } = loadTracker({ fetch: async () => assert.fail("ve Firefoxu se má volat content.fetch") });
  context.content = {
    fetch(url, options) {
      seen.push({ self: this, options });
      return new Promise(() => {});
    },
  };
  AlzaCore.reviewTimeoutMs = 20;
  await assert.rejects(tracker.loadReviews({ url: "https://www.alza.cz/produkt-d111.htm" }), { kind: "timeout" });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].self, context.content);
  assert.equal("signal" in seen[0].options, false);
  assert.equal(seen[0].options.credentials, "include");
});

test("recenze: po HTTP 403 / 429 se další pokus chvíli nedělá", async () => {
  let requests = 0;
  const { tracker, AlzaCore } = loadTracker({ fetch: async () => (requests++, reply(429, {})) });
  const product = { url: "https://www.alza.cz/produkt-d111.htm" };
  const extras = tracker.getProductExtras(product);
  tracker.startReviews(product, extras);
  await tick(5);
  assert.deepEqual(plain({ loading: extras.loading, error: extras.error, requests }), { loading: false, error: { kind: "blocked", status: 429 }, requests: 1 });
  assert.equal(tracker.state.reviewsBlockedUntil > Date.now() + AlzaCore.reviewRetryAfterMs - 5000, true);
  // Hned znovu (zavřít a otevřít panel): žádný požadavek, stejná hláška
  tracker.startReviews(product, extras);
  await tick(5);
  assert.deepEqual(plain({ loading: extras.loading, kind: extras.error.kind, requests }), { loading: false, kind: "blocked", requests: 1 });
  // Po odstupu se zkouší znovu
  tracker.state.reviewsBlockedUntil = Date.now() - 1;
  tracker.startReviews(product, extras);
  await tick(5);
  assert.equal(requests, 2);
});

test("recenze: chyba je přeložená ve 4 jazycích, žádné syrové „Unexpected token“", async () => {
  const { tracker } = loadTracker({ fetch: async () => reply(200, undefined) });
  const product = { url: "https://www.alza.cz/produkt-d111.htm" };
  const extras = tracker.getProductExtras(product);
  tracker.startReviews(product, extras);
  await tick(5);
  assert.deepEqual(plain(extras.error), { kind: "format", status: null });
  const errors = [{ kind: "timeout" }, { kind: "blocked", status: 429 }, { kind: "http", status: 502 }, { kind: "format" }, { kind: "network" }, { kind: "cokoli" }];
  const seen = new Set();
  for (const lang of LANGS) {
    tracker.state.uiLanguage = lang;
    const panel = tracker.createReviewsPanel();
    for (const error of errors) {
      tracker.fillReviewsPanel(panel, { ...extras, error });
      const text = panel.textContent;
      assert.doesNotMatch(text, /Unexpected token|SyntaxError|TypeError|\{\d\}|undefined|reviews:/, `${lang} ${error.kind}`);
      assert.equal(text.startsWith(tracker.translate("reviewsFailed", "")), true, `${lang} ${error.kind}: ${text}`);
      if (error.kind === "http") assert.match(text, /HTTP 502/, lang);
      seen.add(`${lang}:${text}`);
    }
  }
  // 5 různých hlášek v každém jazyce (neznámý druh = síťová), žádný jazyk nepadá zpět do češtiny
  assert.equal(seen.size, 4 * 5);
});

test("recenze: titulek netvrdí „nejnovější“ – řazení se v dotazu nežádá", () => {
  const { AlzaCore, context } = loadTracker();
  const url = AlzaCore.getReviewsApiUrl("alza_cz", "123", 0);
  assert.doesNotMatch(url, /sort|order/i, "dotaz řazení nežádá");
  const texts = vm.runInContext("AlzaPriceTrackerTexts", context);
  for (const lang of LANGS) {
    assert.doesNotMatch(texts[lang].reviewsTitle, /nejnov|najnov|legújabb|latest|newest/i, lang);
    assert.match(texts[lang].reviewsTitle, /\{0\}.*\{1\}/, lang);
  }
});

// === Panel recenzí: přístupnost ===

test("přístupnost recenzí: načtení ohlásí živá oblast, příklad výtky jde ukázat z klávesnice", () => {
  const { tracker, document, AlzaCore } = loadTracker();
  const product = { url: "https://www.alza.cz/produkt-d111.htm" };
  const extras = tracker.getProductExtras(product);
  const card = document.createElement("div");
  const foot = document.createElement("div");
  card.appendChild(foot);
  const buttons = { noteButton: document.createElement("button"), reviewsButton: document.createElement("button"), focusNote: false };
  extras.reviews = extras.loading = true;
  tracker.paintProductExtras(card, foot, product, extras, buttons);
  const panel = card.querySelector(".alza-price-tracker-reviews");
  const status = panel.firstElementChild;
  assert.equal(status.getAttribute("aria-live"), "polite");
  assert.equal(status.getAttribute("role"), "status");
  assert.equal(status.textContent, "Načítám recenze…");
  assert.equal(buttons.reviewsButton.getAttribute("aria-expanded"), "true");

  // Výsledek se vypíše do téhož panelu a téže živé oblasti (nový prvek by čtečka neohlásila)
  extras.loading = false;
  extras.analysis = AlzaCore.analyzeReviews([review(2, ["slabá baterie"]), review(1, ["baterka nevydrží den"], { description: "Po měsíci drží půl dne." })]);
  tracker.paintProductExtras(card, foot, product, extras, buttons);
  assert.equal(card.querySelector(".alza-price-tracker-reviews"), panel);
  assert.equal(panel.firstElementChild, status);
  assert.equal(status.textContent, "Z 2 načtených recenzí (2 z ověřených nákupů)");
  assert.equal(status.className, "alza-price-tracker-reviews-title");

  // Výtka: tlačítko dostupné tabulátorem, příklad v bublině i po Enter / mezerníku / kliknutí jako text
  const [chip] = panel.querySelectorAll(".alza-price-tracker-reviews-chip");
  assert.equal(chip.textContent, "baterie ×2");
  assert.equal(chip.tabIndex, 0);
  assert.equal(chip.getAttribute("role"), "button");
  assert.equal(chip.getAttribute("aria-expanded"), "false");
  assert.equal(chip.title, "baterka nevydrží den");
  const example = panel.children.find((child) => child.getAttribute("aria-live") === "polite" && child !== status);
  assert.equal(example.hidden, true);
  let prevented = false;
  chip.dispatch("keydown", { key: "Enter", preventDefault: () => (prevented = true) });
  assert.equal(prevented, true);
  assert.deepEqual([example.hidden, example.textContent, chip.getAttribute("aria-expanded")], [false, "baterie: baterka nevydrží den", "true"]);
  chip.dispatch("keydown", { key: "a" });
  assert.equal(example.hidden, false, "jiná klávesa nic nemění");
  // Rozbalený příklad přežije překreslení panelu
  tracker.paintProductExtras(card, foot, product, extras, buttons);
  const repainted = panel.children.find((child) => child.getAttribute("aria-live") === "polite" && child !== status);
  assert.deepEqual([repainted.hidden, repainted.textContent], [false, "baterie: baterka nevydrží den"]);
  panel.querySelector(".alza-price-tracker-reviews-chip").dispatch("keydown", { key: " " });
  assert.equal(panel.children.find((child) => child.getAttribute("aria-live") === "polite" && child !== status).hidden, true);

  // Zavření panel odebere
  extras.reviews = false;
  tracker.paintProductExtras(card, foot, product, extras, buttons);
  assert.equal(card.querySelector(".alza-price-tracker-reviews"), null);
});

// === Poznámka k produktu ===

function openNote({ storeRun } = {}) {
  const loaded = loadTracker({ storeRun });
  const { tracker, document } = loaded;
  const product = { url: "https://www.alza.cz/produkt-d111.htm", name: "Produkt" };
  const extras = tracker.getProductExtras(product);
  const card = document.createElement("div");
  card.className = "alza-price-tracker-product";
  const foot = document.createElement("div");
  card.appendChild(foot);
  document.body.appendChild(card);
  const buttons = { noteButton: document.createElement("button"), reviewsButton: document.createElement("button"), focusNote: false };
  extras.repaint = () => tracker.paintProductExtras(card, foot, product, extras, buttons);
  extras.note = true;
  extras.repaint();
  const editor = card.querySelector(".alza-price-tracker-note-editor");
  const field = editor.querySelector(".alza-price-tracker-note-field");
  const [save, remove] = editor.querySelectorAll(".alza-price-tracker-product-button");
  const alert = editor.children.find((child) => child.getAttribute("role") === "alert");
  // Překreslení karty jen počítat
  const renders = { scheduled: 0 };
  tracker.scheduleProductPanel = () => renders.scheduled++;
  return { ...loaded, product, extras, card, editor, field, save, remove, alert, renders };
}

test("poznámka: editor se zavře až po úspěšném uložení; při chybě zůstane text a ukáže se hláška", async () => {
  let fail = true;
  const { tracker, calls, extras, card, field, save, alert } = openNote({
    storeRun: async () => {
      if (fail) throw new Error("Služba na pozadí neodpověděla (patchMap)");
    },
  });
  const errors = [];
  const original = console.error;
  console.error = (...args) => errors.push(args.join(" "));
  try {
    assert.equal(field.getAttribute("aria-label"), "Poznámka k produktu");
    assert.equal(alert.hidden, true);
    field.value = "Koupit až po výplatě";
    field.dispatch("input");
    save.click();
    await tick();
    assert.equal(extras.note, true, "editor zůstává otevřený");
    assert.notEqual(card.querySelector(".alza-price-tracker-note-editor"), null);
    assert.equal(field.value, "Koupit až po výplatě");
    assert.equal(extras.draft, "Koupit až po výplatě");
    assert.deepEqual([alert.hidden, alert.textContent], [false, "Poznámku se nepodařilo uložit. Text zůstal v poli, zkuste to znovu."]);
    assert.equal(errors.length, 1);
    // Hláška přežije i překreslení karty (nový editor)
    card.querySelector(".alza-price-tracker-note-editor").remove();
    extras.repaint();
    const again = card.querySelector(".alza-price-tracker-note-editor");
    assert.equal(again.querySelector(".alza-price-tracker-note-field").value, "Koupit až po výplatě");
    assert.equal(again.children.find((child) => child.getAttribute("role") === "alert").hidden, false);

    // Druhý pokus projde → zápis přes AlzaStore.run a editor se zavře
    fail = false;
    again.querySelectorAll(".alza-price-tracker-product-button")[0].click();
    await tick();
    assert.equal(extras.note, false);
    assert.equal(extras.draft, null);
    assert.equal(extras.noteProblem, null);
    assert.equal(card.querySelector(".alza-price-tracker-note-editor"), null);
    assert.equal(calls.store.length, 2);
    const op = plain(calls.store[1]);
    assert.deepEqual({ type: op.type, key: op.key, text: op.set.alza_cz_111.text, url: op.set.alza_cz_111.url }, { type: "patchMap", key: tracker.state && "alzaNotes", text: "Koupit až po výplatě", url: "https://www.alza.cz/produkt-d111.htm" });
  } finally {
    console.error = original;
  }
});

test("poznámka: nepovedené smazání editor nezavře; druhý klik během zápisu nic neodešle", async () => {
  let release = null;
  const { calls, extras, card, save, remove, alert, editor } = openNote({ storeRun: () => new Promise((resolve, reject) => (release = { resolve, reject })) });
  const original = console.error;
  console.error = () => {};
  try {
    remove.click();
    remove.click();
    save.click();
    assert.equal(calls.store.length, 1, "jeden zápis, dokud první neskončí");
    assert.equal(editor.getAttribute("aria-busy"), "true");
    assert.equal(Boolean(save.disabled || remove.disabled), false, "tlačítka se nevypínají – vypnuté by přišlo o fokus");
    release.reject(new Error("chyba zápisu"));
    await tick();
    assert.equal(extras.note, true);
    assert.equal(editor.getAttribute("aria-busy"), null);
    assert.deepEqual([alert.hidden, alert.textContent], [false, "Poznámku se nepodařilo smazat, zkuste to znovu."]);
    remove.click();
    release.resolve();
    await tick();
    assert.equal(extras.note, false);
    assert.equal(card.querySelector(".alza-price-tracker-note-editor"), null);
    assert.deepEqual(plain(calls.store.map(({ type, remove: keys }) => [type, keys])), [["patchMap", ["alza_cz_111"]], ["patchMap", ["alza_cz_111"]]]);
  } finally {
    console.error = original;
  }
});

test("poznámka: překreslení karty počká, dokud je fokus v editoru", async () => {
  const { tracker, document, card, field, save, editor, renders, extras } = openNote();
  field.focus();
  assert.equal(tracker.isNoteEditorFocused(), true);
  // Změna ve storage → renderProductPanel: nic nepřekreslí, jen si poznamená, že má
  await tracker.renderProductPanel();
  assert.equal(document.querySelector(".alza-price-tracker-product"), card, "karta zůstala");
  assert.equal(document.activeElement, field, "fokus zůstal v poli");
  assert.equal(tracker.state.productPanelPending, true);
  assert.equal(renders.scheduled, 0);
  // Fokus přešel na Uložit (uvnitř editoru) – pořád se čeká
  save.focus();
  editor.dispatch("focusout", { relatedTarget: save });
  await tick(5);
  assert.equal(renders.scheduled, 0);
  // Fokus mimo editor → odložené překreslení doběhne
  document.activeElement = null;
  editor.dispatch("focusout", { relatedTarget: null });
  await tick(5);
  assert.equal(renders.scheduled, 1);
  assert.equal(tracker.state.productPanelPending, false);
  // Bez odloženého překreslení se nic neplánuje
  editor.dispatch("focusout", { relatedTarget: null });
  await tick(5);
  assert.equal(renders.scheduled, 1);

  // Esc editor zavře a odložené překreslení také doběhne
  field.focus();
  await tracker.renderProductPanel();
  assert.equal(tracker.state.productPanelPending, true);
  field.dispatch("keydown", { key: "Escape" });
  assert.equal(extras.note, false);
  assert.equal(renders.scheduled, 2);
  assert.equal(tracker.isNoteEditorFocused(), false);
});

// === Detail: změna adresy bez načtení stránky ===

test("detail: jiný produkt v adrese bez načtení stránky → stav karty se založí znovu", async () => {
  const { tracker, context, chrome } = loadTracker();
  const records = [];
  tracker.getPriceRecord = async (url) => (records.push(url), { original: 500 });
  tracker.state.product = { url: "https://www.alza.cz/produkt-d111.htm", name: "První", image: null };
  tracker.state.productData = { original: 100 };
  tracker.state.productSaveProblem = "notifyProblemLogin";
  await chrome.storage.local.set({ alzaNotes: { alza_cz_222: { text: "poznámka druhého" } } });
  const extras = tracker.getProductExtras(tracker.state.product);
  Object.assign(extras, { note: true, draft: "rozepsáno u prvního", reviews: true });

  // Stejný produkt (jen parametr v adrese) – nic se nemění
  context.window.location.search = "?foo=1";
  assert.equal(await tracker.syncProductPage(), false);
  assert.equal(tracker.getProductExtras(tracker.state.product), extras);

  // Adresa jiného produktu
  context.window.location.pathname = "/druhy-produkt-d222.htm";
  context.window.location.search = "";
  assert.equal(await tracker.syncProductPage(), true);
  assert.equal(tracker.state.product.url, "https://www.alza.cz/druhy-produkt-d222.htm");
  assert.deepEqual(records, ["https://www.alza.cz/druhy-produkt-d222.htm"]);
  assert.deepEqual(plain(tracker.state.productData), { original: 500 });
  assert.equal(tracker.state.productSaveProblem, null);
  assert.equal(tracker.state.productNote.text, "poznámka druhého");
  const fresh = tracker.getProductExtras(tracker.state.product);
  assert.notEqual(fresh, extras);
  assert.deepEqual(plain({ note: fresh.note, draft: fresh.draft, reviews: fresh.reviews }), { note: false, draft: null, reviews: false });
  assert.equal(await tracker.syncProductPage(), false, "podruhé už sedí");

  // Stránka, která není detail produktu, stav nemění
  context.window.location.pathname = "/mobily/18843445.htm";
  assert.equal(await tracker.syncProductPage(), false);
  assert.equal(tracker.state.product.url, "https://www.alza.cz/druhy-produkt-d222.htm");
  // Vykreslení se na změnu adresy ptá a posluchač storage bere klíč historie podle aktuálního produktu
  const source = read("src/content/product-panel.js");
  assert.match(source, /async renderProductPanel\(\) \{[\s\S]{0,200}await this\.syncProductPage\(\);/);
  assert.match(source, /const historyKey = this\.getHistoryKey\(this\.state\.product\.url\);[\s\S]{0,400}changes\[historyKey\]/);
});

test("detail: záruka ze stránky se po změně adresy nezapíše k jinému produktu", async () => {
  const { tracker, context, calls, AlzaCore } = loadTracker();
  Object.assign(AlzaCore, { getSettings: async () => ({ ownedItems: true }), isContextAlive: () => true, getDocumentWarranty: () => 24 });
  tracker.state.product = { url: "https://www.alza.cz/produkt-d111.htm" };
  await tracker.setupWarranty();
  assert.deepEqual(plain(calls.store), [{ type: "setWarranty", domain: "alza_cz", url: "https://www.alza.cz/produkt-d111.htm", warranty: 24 }]);
  // Adresa už patří jinému produktu (stav karty se ještě nepřepnul) → nic se nezapisuje
  context.window.location.pathname = "/druhy-produkt-d222.htm";
  await tracker.setupWarranty();
  assert.equal(calls.store.length, 1);
});

// === Dochází vám? ===

test("dochází vám: 12 ks naráz nevydrží stejně jako 1 ks", () => {
  const { AlzaCore } = loadCore();
  const now = Date.UTC(2026, 10, 16);
  const ago = (days) => now - days * DAY;
  // 1 ks každých 30 dní, naposledy před 20 dny 12 ks → dřív „za 10 dní“, teď za 340 dní
  const bulk = { domain: "alza_cz", buys: [{ t: ago(110), n: 1 }, { t: ago(80), n: 1 }, { t: ago(50), n: 1 }, { t: ago(20), n: 12 }] };
  const rhythm = AlzaCore.getRestockRhythm(bulk);
  assert.deepEqual(plain(rhythm), { interval: 30, last: ago(20), pieces: 12, supply: 360, next: ago(20) + 360 * DAY, buys: 4 });
  assert.equal(AlzaCore.getRestockDays(rhythm, now), 340);
  assert.equal(AlzaCore.isRestockUnusual(rhythm), true);
  assert.deepEqual(plain(AlzaCore.getRestockList({ alza_cz_1: bulk }, now)), []);
  // Stejné kusy pokaždé → jako dřív: další nákup za medián odstupů
  const steady = { domain: "alza_cz", buys: [{ t: ago(100), n: 2 }, { t: ago(70), n: 2 }, { t: ago(40), n: 2 }, { t: ago(10), n: 2 }] };
  assert.deepEqual(plain(AlzaCore.getRestockRhythm(steady)), { interval: 30, last: ago(10), pieces: 2, supply: 30, next: ago(10) + 30 * DAY, buys: 4 });
  assert.equal(AlzaCore.isRestockUnusual(AlzaCore.getRestockRhythm(steady)), false);
  assert.deepEqual(plain(AlzaCore.getRestockList({ alza_cz_2: steady }, now).map(({ key, days, pieces }) => [key, days, pieces])), [["alza_cz_2", 20, 2]]);
  // Po velkém balení delší odstup není nepravidelnost: 1 ks / 30 dní, 3 ks / 90 dní
  const mixed = { domain: "alza_cz", buys: [{ t: ago(190), n: 1 }, { t: ago(160), n: 1 }, { t: ago(130), n: 3 }, { t: ago(40), n: 1 }] };
  assert.deepEqual(plain(AlzaCore.getRestockRhythm(mixed)), { interval: 30, last: ago(40), pieces: 1, supply: 30, next: ago(10), buys: 4 });
  // Bez počtu kusů = 1 ks; nesmyslný počet také
  assert.equal(AlzaCore.getRestockRhythm({ buys: [{ t: ago(90) }, { t: ago(60), n: 0 }, { t: ago(30), n: "x" }] }).supply, 30);
  // Odhad dávno v minulosti (o víc než půl doby, na kterou nákup vystačí) se neukazuje
  const old = AlzaCore.getRestockRhythm({ domain: "alza_cz", buys: [{ t: ago(400) }, { t: ago(370) }, { t: ago(340) }] });
  assert.equal(AlzaCore.getRestockDays(old, now), null);
  assert.equal(AlzaCore.getRestockDays(old, ago(300)), -10);
  assert.equal(AlzaCore.getRestockDays(old, ago(295)), -15);
  assert.equal(AlzaCore.getRestockDays(old, ago(294)), null);
  assert.equal(AlzaCore.getRestockDays(null, now), null);
});

test("dochází vám na detailu: rytmus se neukáže, když je odhad dalšího nákupu dávno v minulosti", () => {
  const { tracker } = loadTracker();
  const ago = (days) => Date.now() - days * DAY;
  const note = (buys) => {
    tracker.state.ownedProduct = { domain: "alza_cz", buys };
    return tracker.createOwnedNote().textContent;
  };
  // Další nákup vychází na před 10 dny (do půl intervalu) → ukáže se
  assert.match(note([{ t: ago(100), p: 99 }, { t: ago(70), p: 99 }, { t: ago(40), p: 99 }]), /kupujete asi každých 30 dní – další kolem /);
  // Naposledy před 340 dny → odhad 310 dní v minulosti, už nekupujete
  const stale = note([{ t: ago(400), p: 99 }, { t: ago(370), p: 99 }, { t: ago(340), p: 99 }]);
  assert.doesNotMatch(stale, /kupujete/);
  assert.match(stale, /Koupili jste/);
  // Velké balení: text řekne, na jak dlouho kusy vystačí
  assert.match(note([{ t: ago(80), p: 99 }, { t: ago(50), p: 99 }, { t: ago(20), p: 99 }, { t: ago(5), n: 12, p: 99 }]), /kupujete asi každých \d+ dní – 12 ks vystačí asi do /);
});

// Funkce renderOwnedRestock ze stránky rozšíření nad náhradou DOM; t() vrací „klíč(parametry)“
async function renderRestock(histories, buys) {
  const { context } = loadCore();
  const document = createDocument();
  const elements = {};
  document.getElementById = (id) => (elements[id] ||= Object.assign(document.createElement("div"), { replaceChildren: (...nodes) => ((elements[id].textContent = ""), elements[id].append(...nodes)) }));
  Object.assign(context, {
    document,
    t: (key, ...params) => `${key}(${params.join("|")})`,
    ui: { lang: "cz" },
    formatDate: (time) => new Date(time).toISOString().slice(0, 10),
    productLink: (url, name) => Object.assign(document.createElement("a"), { href: url, textContent: name }),
    nameFromUrl: (url) => url,
    ownedHistories: histories,
  });
  const source = read("src/options/options-owned.js").match(/async function renderOwnedRestock\(rows\) \{[\s\S]*?\n\}\n/)[0];
  vm.runInContext(source, context, { filename: "src/options/options-owned.js" });
  await context.renderOwnedRestock([{ key: "alza_cz_1", product: { domain: "alza_cz", url: "https://www.alza.cz/kava-d1.htm", name: "Káva", buys } }]);
  return elements.ownedRestockList.children.map((item) => item.children.map((child) => child.textContent));
}

test("dochází vám v Mých nákupech: cena „teď“ je cena k zaplacení a jen z čerstvého záznamu", async () => {
  const now = Date.now();
  const ago = (days) => now - days * DAY;
  const buys = [{ t: ago(70) }, { t: ago(40) }, { t: ago(10) }];
  // Čerstvý záznam: 100 Kč k zaplacení, 60 Kč až s cashbackem
  const [fresh] = await renderRestock({ alza_cz_1: [{ t: ago(200), s: now - 3600000, p: { original: 100, cashback: 60 } }] }, buys);
  assert.equal(fresh[0], "Káva");
  assert.match(fresh[1], /^ownedRestockNext\(/);
  assert.match(fresh[2], /^ownedRestockRhythm\(30 dní\|/);
  assert.match(fresh[3], /^ownedRestockPrice\(100 Kč\)/, "cena bez cashbacku");
  // Záznam naposledy potvrzený před 30 dny: cena s datem, bez „teď“ a bez hodnocení
  const seen = ago(30);
  const [stale] = await renderRestock({ alza_cz_1: [{ t: ago(200), s: ago(60), p: { original: 150 } }, { t: ago(60), s: seen, p: { original: 100, special: 80 } }] }, buys);
  assert.equal(stale[3], `ownedRestockPriceAt(80 Kč|${new Date(seen).toISOString().slice(0, 10)})`);
  // Bez historie nebo bez ceny k zaplacení cena chybí
  assert.equal((await renderRestock({}, buys))[0].length, 3);
  assert.equal((await renderRestock({ alza_cz_1: [{ t: ago(5), s: now, p: {} }] }, buys))[0].length, 3);
  // Velké balení naposledy → rytmus s počtem kusů
  const bulk = await renderRestock({}, [{ t: ago(130) }, { t: ago(100) }, { t: ago(70) }, { t: ago(45), n: 2 }]);
  assert.match(bulk[0][2], /^ownedRestockRhythmPieces\(30 dní\|[\d-]+\|2\)$/);
  // Nové texty jsou ve všech jazycích
  const { context } = loadCore({ files: ["src/options/options-texts.js"] });
  const texts = vm.runInContext("OPTIONS_TEXTS", context);
  for (const lang of LANGS) {
    assert.match(texts[lang].ownedRestockPriceAt, /\{0\}.*\{1\}|\{1\}.*\{0\}/, lang);
    assert.match(texts[lang].ownedRestockRhythmPieces, /\{2\}/, lang);
  }
});

// === Faktura ===

test("faktura: slovenská „Faktúra“ i „Számla“ se poznají; dobropis se nevrátí ani jako náhrada", () => {
  const { AlzaCore } = loadCore();
  const goods = (id) => ({ commodityId: id, commodityUrl: `/zbozi-d${id}.htm`, onClaimItemGuideClick: { enabled: true }, pricePerItem: "100 Kč" });
  const pdf = (id, name) => ({ self: { href: `https://pdf.alza.sk/Apps/pdfdoc.asp?d=${id}` }, name });
  const pick = (documents, domain = "alza_sk") => AlzaCore.pickOrderInvoice({ parts: [{ items: [goods(5)], documents }] }, domain, `${domain}_5`);
  // Dobropis je první, faktura až druhá – dřív (vzor bez „faktúr“) vyhrál první doklad
  assert.equal(pick([pdf(1, "Dobropis 123"), pdf(2, "Faktúra 456")]), "https://pdf.alza.sk/Apps/pdfdoc.asp?d=2");
  assert.equal(pick([pdf(1, "Jóváíró számla"), pdf(2, "Számla 456")], "alza_hu"), "https://pdf.alza.sk/Apps/pdfdoc.asp?d=2");
  assert.equal(pick([pdf(1, "Opravný daňový doklad"), pdf(2, "Daňový doklad")]), "https://pdf.alza.sk/Apps/pdfdoc.asp?d=2");
  assert.equal(pick([pdf(1, "Credit note"), pdf(2, "INVOICE 7")]), "https://pdf.alza.sk/Apps/pdfdoc.asp?d=2");
  // Náhradní výběr (žádný název nesedí): první doklad, který není dobropis
  assert.equal(pick([pdf(1, "Dobropis"), pdf(2, "Doklad 9")]), "https://pdf.alza.sk/Apps/pdfdoc.asp?d=2");
  assert.equal(pick([pdf(1, "Doklad 9"), pdf(2, "Příloha")]), "https://pdf.alza.sk/Apps/pdfdoc.asp?d=1");
  // Jen dobropisy / opravné doklady → nic (dřív se vrátil dobropis)
  assert.equal(pick([pdf(1, "Dobropis"), pdf(2, "Opravný doklad"), pdf(3, "Jóváírás"), pdf(4, "Storno faktúra"), pdf(5, "Helyesbítő számla")]), null);
  // Část s produktem má jen dobropis → faktura z jiné části objednávky
  const detail = { parts: [{ items: [goods(5)], documents: [pdf(1, "Dobropis")] }, { items: [goods(6)], documents: [pdf(2, "Faktúra")] }] };
  assert.equal(AlzaCore.pickOrderInvoice(detail, "alza_sk", "alza_sk_5"), "https://pdf.alza.sk/Apps/pdfdoc.asp?d=2");
});

// === Drobnosti ===

test("graf historie: třída --zoomed bez stylu se už nepřepíná", () => {
  assert.doesNotMatch(read("src/content/history-chart.js"), /history-chart--zoomed/);
  assert.doesNotMatch(read("css/main.css"), /history-chart--zoomed/);
});

test("nové texty karty jsou ve všech jazycích a liší se od češtiny tam, kde mají", () => {
  const { context } = loadTracker();
  const texts = vm.runInContext("AlzaPriceTrackerTexts", context);
  const keys = ["reviewsErrorTimeout", "reviewsErrorBlocked", "reviewsErrorHttp", "reviewsErrorFormat", "reviewsErrorNetwork", "noteFieldLabel", "noteSaveFailed", "noteDeleteFailed", "productOwnedRhythmPieces"];
  for (const key of keys) {
    for (const lang of LANGS) assert.equal(typeof texts[lang][key] === "string" && texts[lang][key].length > 0, true, `${lang}.${key}`);
    assert.notEqual(texts.hu[key], texts.cz[key], key);
    assert.notEqual(texts.en[key], texts.cz[key], key);
  }
  // Nový klíč je hned za příbuzným klíčem, ne na konci slovníku
  const source = read("src/content/texts.js");
  assert.match(source, /reviewsFailed: .*\n\s+reviewsErrorTimeout: /);
  assert.match(source, /notePlaceholder: .*\n\s+noteFieldLabel: /);
  assert.match(source, /productOwnedRhythm: .*\n\s+productOwnedRhythmPieces: /);
});
