// Regresní testy oprav z auditu 2026-11-16, balík „historie a ceny“ (č. 1, 13, 16, 17, 18, 19, dárkový šek, nízké
// z jádra). Skripty se načítají do izolovaného kontextu (load-core.js); kde je logika jen ve stránce s DOM
// (content.js, options.js), kontroluje se zdrojový text. Spuštění: node --test "tests/*.test.js"
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { loadCore } = require("./load-core");

const ROOT = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8").replace(/\r\n/g, "\n");
// Objekty z izolovaného kontextu mají jiný prototyp – porovnávat jako prostá data
const plain = (value) => JSON.parse(JSON.stringify(value));
const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const NOW = Date.UTC(2026, 10, 16, 10); // Pevný čas testů
const ago = (days) => NOW - days * DAY;
const URL_1 = "https://www.alza.cz/produkt-d1.htm";

const { AlzaCore } = loadCore();

function setupStore(storage = {}) {
  const { AlzaCore: core, chrome, context } = loadCore({ storage, files: ["src/shared/store.js"] });
  context.AlzaStore.isWriter = true;
  return { AlzaCore: core, AlzaStore: context.AlzaStore, data: chrome.storage.local.data };
}

// === č. 1 Díra mezi pozorováními není známá cena ===

// Produkt viděný jen při procházení: dvě pozorování 150 dní od sebe
const browsedTwice = (first, last) => [
  { t: ago(150), s: ago(150), p: first, a: "in" },
  { t: NOW - 60e3, s: NOW, p: last, a: "in" },
];

test("č. 1 getEntryEnd: nejdéle do dalšího záznamu a nejdéle priceGapDays po posledním potvrzení", () => {
  assert.equal(AlzaCore.priceGapDays, 2);
  const entries = [
    { t: ago(100), s: ago(90), p: { original: 1 } }, // potvrzovaný 10 dní, pak díra
    { t: ago(50), s: ago(40) - HOUR, p: { original: 2 } }, // potvrzený hodinu před dalším záznamem
    { t: ago(40), s: ago(1), p: { original: 3 } }, // poslední
  ];
  assert.equal(AlzaCore.getEntryEnd(entries, 0), ago(88), "díra: konec 2 dny po posledním potvrzení");
  assert.equal(AlzaCore.getEntryEnd(entries, 1), ago(40), "souvislé sledování: do dalšího záznamu");
  assert.equal(AlzaCore.getEntryEnd(entries, 2), ago(1), "poslední záznam končí posledním potvrzením");
  assert.equal(AlzaCore.getEntryEnd(entries, 2, true), ago(1) + 2 * DAY, "open: poslední platí ještě priceGapDays");
  // Záznam bez s (poškozená data) – bere se čas zjištění
  assert.equal(AlzaCore.getEntryEnd([{ t: ago(9), p: {} }, { t: ago(1), p: {} }], 0), ago(7));
});

test("č. 1 dvě pozorování 150 dní od sebe nejsou 150 dní známé ceny (hodnocení, přeškrtnutá cena, podezřelá sleva)", () => {
  const gap = browsedTwice({ original: 1000 }, { original: 1200 });
  const covered = AlzaCore.getCoveredDays(AlzaCore.getPriceSegments(gap, Infinity, NOW));
  assert.ok(covered > 1.9 && covered < 2.1, `dny se známou cenou: ${covered}`);
  assert.equal(AlzaCore.getPriceVerdict(gap, 1200, NOW), null, "„nad obvyklou cenou“ ze dvou čísel ne");
  assert.equal(AlzaCore.getStrikethroughWarning(gap, { original: 1500, special: 1200 }, NOW), null);
  const sale = browsedTwice({ original: 1000, special: 800 }, { original: 1200, special: 900 });
  assert.equal(AlzaCore.getDiscountWarning(sale, { original: 1200, special: 900 }, NOW), null, "podezřelá sleva z díry ne");
  // Sleva ve filtru výpisu: bez obvyklé ceny jen proti přeškrtnuté
  assert.equal(AlzaCore.getListingDiscount({ original: 1200 }, gap, NOW).source, null);
  // 10 dní sledování a pak díra 140 dní – pořád málo dní (10 + 2)
  const watchedThenGap = [{ t: ago(150), s: ago(140), p: { original: 1000 }, a: "in" }, { t: NOW - 60e3, s: NOW, p: { original: 1200 }, a: "in" }];
  assert.equal(AlzaCore.getPriceVerdict(watchedThenGap, 1200, NOW), null);
});

test("č. 1 průběžně sledovaný produkt se hodnotí jako dřív", () => {
  const tracked = [{ t: ago(150), s: NOW - 61e3, p: { original: 1000 }, a: "in" }, { t: NOW - 60e3, s: NOW, p: { original: 1200 }, a: "in" }];
  const verdict = AlzaCore.getPriceVerdict(tracked, 1200, NOW);
  assert.equal(verdict.level, "high");
  assert.equal(verdict.typical, 1000);
  assert.equal(verdict.days, 150);
  // Denní kontrola: mezera den mezi potvrzením a změnou díra není
  const daily = [{ t: ago(100), s: ago(31), p: { original: 1000 }, a: "in" }, { t: ago(30), s: NOW, p: { original: 900 }, a: "in" }];
  assert.equal(Math.round(AlzaCore.getCoveredDays(AlzaCore.getPriceSegments(daily, Infinity, NOW))), 100);
  assert.equal(AlzaCore.getPriceSegments(daily, Infinity, NOW)[0].resume, undefined);
});

test("č. 1 getLowestInWindow: díra v okně se nepočítá do dní a okno není úplné", () => {
  // Bez děr jako dřív
  const full = [{ t: ago(60), s: ago(10) - 1000, p: { original: 900 }, a: "in" }, { t: ago(10), s: NOW, p: { original: 1000 }, a: "in" }];
  assert.deepEqual(plain(AlzaCore.getLowestInWindow(full, 30, NOW)), { value: 900, at: ago(10), days: 30, complete: true });
  const short = [{ t: ago(10), s: NOW, p: { original: 1000 }, a: "in" }];
  assert.deepEqual(plain(AlzaCore.getLowestInWindow(short, 30, NOW)), { value: 1000, at: NOW, days: 10, complete: false });
  // Staré pozorování 800 před 150 dny do okna nepatří; z okna známe jen dnešek
  const gap = browsedTwice({ original: 800 }, { original: 900 });
  assert.deepEqual(plain(AlzaCore.getLowestInWindow(gap, 30, NOW)), { value: 900, at: NOW, days: 0, complete: false });
  // Díra uvnitř okna: 800 potvrzená naposledy před 20 dny, další záznam před 5 dny → 13 dní neznámých
  const hole = [{ t: ago(60), s: ago(20), p: { original: 800 }, a: "in" }, { t: ago(5), s: NOW, p: { original: 1000 }, a: "in" }];
  assert.deepEqual(plain(AlzaCore.getLowestInWindow(hole, 30, NOW)), { value: 800, at: ago(18), days: 17, complete: false });
});

test("č. 1 getStrikethroughWarning: „naposledy platila“ končí posledním potvrzením, ne dalším záznamem", () => {
  // 1500 Kč potvrzeno naposledy před 120 dny, pak díra a od 30 dnů akce 1200
  const entries = [{ t: ago(140), s: ago(120), p: { original: 1500 }, a: "in" }, { t: ago(30), s: NOW, p: { original: 1500, special: 1200 }, a: "in" }];
  const warning = AlzaCore.getStrikethroughWarning(entries, { original: 1500, special: 1200 }, NOW);
  assert.equal(warning.never, false);
  assert.equal(warning.at, ago(118), "konec úseku 2 dny po potvrzení");
  assert.equal(warning.days, 52, "22 + 30 dní se známou cenou");
});

test("č. 1 getSaleRuns: krátká díra v pozorování akci nerozdělí, dlouhá a výpadek prodeje ano", () => {
  const base = { t: ago(170), s: ago(60) - 1000, p: { original: 1000 }, a: "in" };
  const count = (entries) => AlzaCore.getPriceVerdict(entries, 1000, NOW).sales.count;
  // Akce 800 → 790, mezi tím 4 dny bez kontroly (vypnutý počítač)
  const short = [base, { t: ago(60), s: ago(54), p: { original: 800 }, a: "in" }, { t: ago(50), s: ago(40) - 1000, p: { original: 790 }, a: "in" }, { t: ago(40), s: NOW, p: { original: 1000 }, a: "in" }];
  assert.equal(count(short), 1);
  // Díra 28 dní mezi dvěma zlevněnými pozorováními – dvě akce
  const long = [base, { t: ago(60), s: ago(58), p: { original: 800 }, a: "in" }, { t: ago(28), s: ago(20) - 1000, p: { original: 790 }, a: "in" }, { t: ago(20), s: NOW, p: { original: 1000 }, a: "in" }];
  assert.equal(count(long), 2);
  // Výpadek prodeje mezi dvěma zlevněnými úseky – dvě akce jako dřív
  const unsold = [base, { t: ago(60), s: ago(55) - 1000, p: { original: 800 }, a: "in" }, { t: ago(55), s: ago(53) - 1000, p: {}, a: "out" }, { t: ago(53), s: ago(40) - 1000, p: { original: 790 }, a: "in" }, { t: ago(40), s: NOW, p: { original: 1000 }, a: "in" }];
  assert.equal(count(unsold), 2);
});

test("č. 1 hlídání po nákupu: staré pozorování není cena v době nákupu", () => {
  const bought = ago(5);
  // Před půl rokem viděno za 800, detail 2 h před nákupem 1000, koupeno za 1000, včera 900
  const history = [
    { t: bought - 180 * DAY, s: bought - 180 * DAY, p: { original: 800 }, a: "in" },
    { t: bought - 2 * HOUR, s: bought, p: { original: 1000 }, a: "in" },
    { t: ago(1), s: NOW, p: { original: 900 }, a: "in" },
  ];
  assert.equal(AlzaCore.getPurchaseReferencePrice(history, bought), 1000);
  const purchase = { price: 1000, boughtAt: bought, returnUntil: bought + 14 * DAY, domain: "alza_cz" };
  assert.deepEqual(plain(AlzaCore.getPurchaseDrop(purchase, { original: 900 }, NOW, history.slice(0, 2))), { lowest: 900, saving: 100, reference: 1000 });
  // Jen staré pozorování a nic dalšího – cenu z doby nákupu neznáme (první kontrola), nic
  assert.equal(AlzaCore.getPurchaseReferencePrice(history.slice(0, 1), bought), null);
  assert.equal(AlzaCore.getPurchaseDrop(purchase, { original: 700 }, NOW, history.slice(0, 1)), null);
  // Staré pozorování + první cena až po nákupu (do purchaseReferenceLateDays) – platí ta
  const after = [history[0], { t: bought + DAY, s: NOW, p: { original: 950 }, a: "in" }];
  assert.equal(AlzaCore.getPurchaseReferencePrice(after, bought), 950);
  // Poslední záznam potvrzený den a půl před nákupem (denní kontrola) platí dál
  const recent = [{ t: bought - 30 * DAY, s: bought - 1.5 * DAY, p: { original: 1000 }, a: "in" }];
  assert.equal(AlzaCore.getPurchaseReferencePrice(recent, bought), 1000);
});

// === č. 13 Loni touhle dobou ===

test("č. 13 getLastYearOutlook: trvalé zdražení není loňská akce", () => {
  // 900 → 1000 Kč před 200 dny, žádná akce
  const raised = [{ t: ago(500), s: ago(200) - 1000, p: { original: 900 }, a: "in" }, { t: ago(200), s: NOW, p: { original: 1000 }, a: "in" }];
  assert.deepEqual(plain(AlzaCore.getLastYearOutlook(raised, 1000, NOW)), { lowest: 900, at: ago(365), then: 900, lower: true, cheaper: false });
  // Loňská akce v okně: 1000 → 800 → 1000
  const sale = [
    { t: ago(400), s: ago(350) - 1000, p: { original: 1000 }, a: "in" },
    { t: ago(350), s: ago(345) - 1000, p: { original: 1000, special: 800 }, a: "in" },
    { t: ago(345), s: NOW, p: { original: 1000 }, a: "in" },
  ];
  assert.deepEqual(plain(AlzaCore.getLastYearOutlook(sale, 1000, NOW)), { lowest: 800, at: ago(350), then: 1000, lower: true, cheaper: true });
  // Dnes je levněji než v loňské akci – není na co čekat
  assert.deepEqual(plain(AlzaCore.getLastYearOutlook(sale, 790, NOW)), { lowest: 800, at: ago(350), then: 1000, lower: false, cheaper: false });
  // Pokles v toleranci (2 %) není akce
  const dip = [sale[0], { t: ago(350), s: ago(345) - 1000, p: { original: 980 }, a: "in" }, sale[2]];
  assert.equal(AlzaCore.getLastYearOutlook(dip, 1200, NOW).cheaper, false);
  // Karta detailu: trvalé zdražení (lower bez cheaper) neukáže ani radu, ani „nebyl levnější než teď“
  assert.match(read("src/content/product-panel.js"), /if \(lastYear && \(lastYear\.cheaper \|\| !lastYear\.lower\)\) \{/);
  // Košík radí jen při cheaper
  assert.match(read("src/content/basket-insights.js"), /if \(lastYear\?\.cheaper\) \{/);
});

test("č. 1 + 13 getLastYearOutlook: jedno pozorování před 400 dny cenu z loňska neurčuje", () => {
  const lastYear = [{ t: ago(400), s: ago(400), p: { original: 800 }, a: "in" }, { t: ago(1), s: NOW, p: { original: 1000 }, a: "in" }];
  assert.equal(AlzaCore.getLastYearOutlook(lastYear, 1000, NOW), null);
  // Cenu přesně před rokem neznáme (díra), akce v okně vidět je – bez srovnání s then neradíme čekat
  const unknownThen = [{ t: ago(400), s: ago(380), p: { original: 1000 }, a: "in" }, { t: ago(350), s: ago(345), p: { original: 800 }, a: "in" }, { t: ago(300), s: NOW, p: { original: 1000 }, a: "in" }];
  assert.deepEqual(plain(AlzaCore.getLastYearOutlook(unknownThen, 1000, NOW)), { lowest: 800, at: ago(350), then: null, lower: true, cheaper: false });
});

// === č. 16 Vyplatí se AlzaPlus+? a cena v den nákupu ===

test("č. 16 estimateAlzaPlus: člen jen půl roku – „ušetřili jste“ jen nákupy za cenu AlzaPlus+, zbytek „mohli jste“", () => {
  const owned = {};
  const histories = {};
  // 6 nákupů před členstvím (zaplaceno 1000 = cena pro všechny), 7 se členstvím (zaplaceno 900)
  for (let i = 0; i < 13; i++) {
    const key = `alza_cz_${i + 1}`;
    const t = ago(350 - i * 25);
    owned[key] = { domain: "alza_cz", buys: [{ t, n: 1, o: String(1000 + i), p: i >= 6 ? 900 : 1000 }] };
    histories[key] = [{ t: t - 3 * DAY, s: t + 2 * DAY, p: { original: 1000, applus: 900 } }];
  }
  assert.deepEqual(plain(AlzaCore.estimateAlzaPlus(owned, histories, NOW)), { buys: 13, known: 13, cheaper: 13, saving: { alza_cz: 700 }, missed: { alza_cz: 600 }, member: true });
  // Nečlen (většina za běžnou cenu): oč zaplatil víc; nákup s benefitem 950 jen o 50
  const nonMember = {
    alza_cz_1: { domain: "alza_cz", buys: [{ t: ago(30), n: 2, p: 1000 }] },
    alza_cz_2: { domain: "alza_cz", buys: [{ t: ago(40), n: 1, p: 950 }] },
    alza_cz_3: { domain: "alza_cz", buys: [{ t: ago(50), n: 1, p: 700 }] }, // slevový kód pod cenou AlzaPlus+
  };
  const sameHistory = (days) => [{ t: ago(days + 3), s: ago(days - 2), p: { original: 1000, applus: 900 } }];
  const estimate = AlzaCore.estimateAlzaPlus(nonMember, { alza_cz_1: sameHistory(30), alza_cz_2: sameHistory(40), alza_cz_3: sameHistory(50) }, NOW);
  assert.deepEqual(plain(estimate), { buys: 3, known: 3, cheaper: 3, saving: { alza_cz: 250 }, missed: {}, member: false });
});

test("č. 16 estimateAlzaPlus: nákup na slevový kód ve výši ceny AlzaPlus+ členství nedokládá; bez ceny kusu se nepočítá", () => {
  const history = { alza_cz_1: [{ t: ago(40), s: ago(20), p: { original: 1000, applus: 900, discount: 900 } }] };
  const withCode = { alza_cz_1: { domain: "alza_cz", buys: [{ t: ago(30), n: 1, p: 900 }] } };
  assert.deepEqual(plain(AlzaCore.estimateAlzaPlus(withCode, history, NOW)), { buys: 1, known: 1, cheaper: 1, saving: { alza_cz: 100 }, missed: {}, member: null });
  // Kód o korunu jinde (v toleranci) je stejný případ
  const nearCode = { alza_cz_1: [{ t: ago(40), s: ago(20), p: { original: 1000, applus: 900, discount: 899 } }] };
  assert.equal(AlzaCore.estimateAlzaPlus(withCode, nearCode, NOW).member, null);
  // Bez kódu v záznamu je cena AlzaPlus+ dokladem členství
  const plusOnly = { alza_cz_1: [{ t: ago(40), s: ago(20), p: { original: 1000, applus: 900, cashback: 900 } }] };
  assert.equal(AlzaCore.estimateAlzaPlus(withCode, plusOnly, NOW).member, true);
  // Nákup bez ceny kusu (detail objednávky ještě není) – nevíme, co se zaplatilo
  const noPrice = { alza_cz_1: { domain: "alza_cz", buys: [{ t: ago(30), n: 5 }] } };
  assert.deepEqual(plain(AlzaCore.estimateAlzaPlus(noPrice, history, NOW)), { buys: 1, known: 0, cheaper: 0, saving: {}, missed: {}, member: null });
});

test("č. 16 getPricesAt / getOwnedSaving: záznam z doby nákupu má přednost před záznamem vzniklým po něm", () => {
  const t = ago(30);
  // Cena s AlzaPlus+ se objevila 12 h po nákupu – při nákupu neexistovala
  const plusLater = [{ t: t - 10 * DAY, s: t + 0.4 * DAY, p: { original: 1000 }, a: "in" }, { t: t + 0.5 * DAY, s: NOW, p: { original: 1000, applus: 850 }, a: "in" }];
  assert.deepEqual(plain(AlzaCore.getPricesAt(plusLater, t)), { public: 1000, applus: null, applusOnly: false });
  const owned = { alza_cz_1: { domain: "alza_cz", buys: [{ t, n: 2, o: "1", p: 1000 }] } };
  assert.deepEqual(plain(AlzaCore.estimateAlzaPlus(owned, { alza_cz_1: plusLater }, NOW).saving), {});
  // Konec akce 12 h po nákupu: koupeno za 800 při běžné ceně 1000 → úspora 200, ne 500
  const saleEnded = [{ t: t - 10 * DAY, s: t + 0.4 * DAY, p: { original: 1000, special: 800 }, a: "in" }, { t: t + 0.5 * DAY, s: NOW, p: { original: 1300 }, a: "in" }];
  assert.equal(AlzaCore.getOwnedSaving({ t, n: 1, p: 800 }, saleEnded, "alza_cz"), 200);
  // Historie začala až kontrolou po nákupu (do dne) – bere se ta
  const onlyAfter = [{ t: t + 0.5 * DAY, s: NOW, p: { original: 1000, applus: 900 }, a: "in" }];
  assert.deepEqual(plain(AlzaCore.getPricesAt(onlyAfter, t)), { public: 1000, applus: 900, applusOnly: true });
  // Staré pozorování (neplatilo týden před nákupem) + záznam do dne po nákupu – bere se ten pozdější
  const staleThenAfter = [{ t: t - 100 * DAY, s: t - 100 * DAY, p: { original: 700 }, a: "in" }, ...onlyAfter];
  assert.equal(AlzaCore.getPricesAt(staleThenAfter, t).public, 1000);
  // Záznam až dva dny po nákupu cenu z doby nákupu neurčuje
  assert.equal(AlzaCore.getPricesAt([{ t: t + 2 * DAY, s: NOW, p: { original: 1000 } }], t), null);
});

// === č. 17 Cena k zaplacení všude ===

test("č. 17 mergePriceRecord: šipka změny z ceny k zaplacení – nový cashback není zlevnění", () => {
  const record = AlzaCore.mergePriceRecord({}, { original: 10000 }, null, 1);
  assert.equal(record.oldLowestPrice, 10000);
  AlzaCore.mergePriceRecord(record, { original: 10000, cashback: 8000 }, null, 2);
  assert.equal(record.newLowestPrice, undefined, "přibyl jen cashback");
  assert.equal(record.oldLowestPrice, 10000);
  AlzaCore.mergePriceRecord(record, { original: 10000, special: 9500, cashback: 7500 }, null, 3);
  assert.equal(record.newLowestPrice, 9500, "skutečné zlevnění");
  // Jen cashback bez jiné ceny – šipka z něj (není s čím jiným srovnat)
  assert.equal(AlzaCore.mergePriceRecord({}, { cashback: 500 }, null, 1).oldLowestPrice, 500);
});

test("č. 17 getSuspiciousPrices: hranice z cen k zaplacení – cashback mezi cenami chybně přečtenou cenu nezakryje", () => {
  const found = plain(AlzaCore.getSuspiciousPrices([], { original: 1000, applus: 480, cashback: 900 }, NOW));
  assert.deepEqual(found, [{ type: "applus", price: 480, reason: "gap", reference: 1000 }]);
  // Cashback pod cenou k zaplacení podezřelý není; nesmyslně nízký ano (jako dřív)
  assert.deepEqual(plain(AlzaCore.getSuspiciousPrices([], { original: 1000, cashback: 900 }, NOW)), []);
  assert.equal(AlzaCore.getSuspiciousPrices([], { original: 29490, cashback: 77 }, NOW)[0]?.reason, "gap");
  assert.equal(AlzaCore.getSuspiciousPrices([], { original: 29490, special: 776 }, NOW)[0]?.reason, "gap");
});

test("č. 17 repairPayNowRecord: minimum z historie jen z cen k zaplacení, kde historie dobu minima pokrývá", () => {
  const history = [
    { t: 1000, s: 1900, p: { original: 10000, cashback: 8000 }, a: "in" },
    { t: 2000, s: 3000, p: { original: 10000, special: 9500 }, a: "in" },
  ];
  const record = { original: 10000, special: 9500, minPrice: { value: 8000, timestamp: 1000 }, maxPrice: { value: 10000, timestamp: 1000 }, oldLowestPrice: 9500 };
  assert.equal(AlzaCore.repairPayNowRecord(record, history), true);
  assert.deepEqual(plain(record.minPrice), { value: 9500, timestamp: 2000 });
  assert.deepEqual(plain(record.maxPrice), { value: 10000, timestamp: 1000 });
  assert.equal(AlzaCore.repairPayNowRecord(record, history), false, "podruhé beze změny");
  // Minimum starší než historie není čím ověřit – zůstává
  const older = { original: 10000, minPrice: { value: 8000, timestamp: 500 } };
  assert.equal(AlzaCore.repairPayNowRecord(older, history), false);
  assert.equal(older.minPrice.value, 8000);
  // Bez historie nic
  assert.equal(AlzaCore.repairPayNowRecord({ original: 1, minPrice: { value: 1, timestamp: 1 } }, undefined), false);
  // Bez historie, ale minimum je právě cena s cashbackem ze záznamu → cena k zaplacení ze záznamu
  const refund = { original: 10000, cashback: { price: 8000 }, minPrice: { value: 8000, timestamp: 500 }, lastUpdated: 900 };
  assert.equal(AlzaCore.repairPayNowRecord(refund, undefined), true);
  assert.deepEqual(plain(refund.minPrice), { value: 10000, timestamp: 900 });
  // Minimum pod cashbackem (dřívější skutečná akce) zůstává
  const lowerSale = { original: 10000, cashback: 8000, minPrice: { value: 7000, timestamp: 500 } };
  assert.equal(AlzaCore.repairPayNowRecord(lowerSale, undefined), false);
  // Šipka stojící na cashbacku: cena k zaplacení a žádná šipka
  const arrow = { original: 10000, cashback: 8000, oldLowestPrice: 10000, newLowestPrice: 8000 };
  assert.equal(AlzaCore.repairPayNowRecord(arrow, []), true);
  assert.deepEqual(plain(arrow), { original: 10000, cashback: 8000, oldLowestPrice: 10000 });
  // Skutečná šipka (bez cashbacku) zůstává
  const real = { original: 10000, special: 9000, oldLowestPrice: 10000, newLowestPrice: 9000 };
  assert.equal(AlzaCore.repairPayNowRecord(real, []), false);
  assert.equal(real.newLowestPrice, 9000);
});

test("č. 17 runCleanups: uložené minimum s cashbackem se jednou opraví z historie", async () => {
  const { AlzaCore: core, AlzaStore, data } = setupStore({
    alzaPrice_alza_cz_1: { url: URL_1, original: 10000, cashback: 8000, minPrice: { value: 8000, timestamp: ago(20) }, oldLowestPrice: 8000, lastUpdated: ago(1) },
    alzaHistory_alza_cz_1: [{ t: ago(30), s: ago(1), p: { original: 10000, cashback: 8000 }, a: "in" }],
    // Produkt bez cashbacku a produkt s minimem starším než historie zůstanou
    alzaPrice_alza_cz_2: { original: 500, minPrice: { value: 450, timestamp: ago(20) }, oldLowestPrice: 500 },
    alzaHistory_alza_cz_2: [{ t: ago(30), s: ago(25) - 1000, p: { original: 500 }, a: "in" }, { t: ago(25), s: ago(15) - 1000, p: { original: 450 }, a: "in" }, { t: ago(15), s: ago(1), p: { original: 500 }, a: "in" }],
    alzaPrice_alza_cz_3: { original: 500, minPrice: { value: 300, timestamp: ago(90) } },
    alzaHistory_alza_cz_3: [{ t: ago(30), s: ago(1), p: { original: 500 }, a: "in" }],
    [AlzaCore.storageKeys.cleanups]: { "quantityTierListingPrices-2026-11": 1 },
  });
  assert.equal(await AlzaStore.exclusive(() => AlzaStore.runCleanups()), 1);
  assert.deepEqual(plain(data.alzaPrice_alza_cz_1.minPrice), { value: 10000, timestamp: ago(30) });
  assert.equal(data.alzaPrice_alza_cz_1.oldLowestPrice, 10000);
  assert.equal(data.alzaPrice_alza_cz_2.minPrice.value, 450);
  assert.equal(data.alzaPrice_alza_cz_3.minPrice.value, 300);
  const done = data[core.storageKeys.cleanups];
  assert.equal(done["quantityTierListingPrices-2026-11"], 1, "dřívější oprava zůstává zapsaná");
  assert.ok(done["payNowMinPrice-2026-11"] > 0);
  // Podruhé už neběží
  data.alzaPrice_alza_cz_1.minPrice = { value: 8000, timestamp: ago(20) };
  assert.equal(await AlzaStore.exclusive(() => AlzaStore.runCleanups()), 0);
  assert.equal(data.alzaPrice_alza_cz_1.minPrice.value, 8000);
});

test("č. 17 importData: stará záloha nevrátí minimum s cashbackem", async () => {
  const history = [{ t: ago(30), s: ago(1), p: { original: 10000, cashback: 8000 }, a: "in" }];
  const { AlzaStore, data } = setupStore({
    alzaPrice_alza_cz_1: { url: URL_1, original: 10000, cashback: 8000, minPrice: { value: 10000, timestamp: ago(30) }, oldLowestPrice: 10000, lastUpdated: ago(1) },
    alzaHistory_alza_cz_1: history,
  });
  // Záloha z dřívější verze: jen záznam ceny (historii má úložiště), minimum i s cashbackem
  await AlzaStore.run({ type: "importData", items: { alzaPrice_alza_cz_1: { url: URL_1, original: 10000, cashback: 8000, minPrice: { value: 8000, timestamp: ago(20) }, oldLowestPrice: 8000, lastUpdated: ago(5) } } });
  assert.deepEqual(plain(data.alzaPrice_alza_cz_1.minPrice), { value: 10000, timestamp: ago(30) });
  // Starý formát záznamů cen s historií v téže záloze
  const fresh = setupStore();
  await fresh.AlzaStore.run({
    type: "importData",
    items: {
      alzaPrices_alza_cz: { [URL_1]: { original: 10000, cashback: 8000, minPrice: { value: 8000, timestamp: ago(20) }, oldLowestPrice: 8000, lastUpdated: ago(5) } },
      alzaHistory_alza_cz_1: history,
    },
  });
  assert.equal(fresh.data.alzaPrice_alza_cz_1.minPrice.value, 10000);
  assert.equal(fresh.data.alzaPrice_alza_cz_1.oldLowestPrice, 10000);
  // Produkt bez historie (jen ze seznamu): minimum ze zálohy je cena s cashbackem – stávající správné minimum zůstane
  const listed = setupStore({ alzaPrice_alza_cz_5: { original: 10000, minPrice: { value: 10000, timestamp: ago(1) }, lastUpdated: NOW } });
  await listed.AlzaStore.run({
    type: "importData",
    items: { alzaPrice_alza_cz_5: { original: 10000, cashback: { price: 8000 }, minPrice: { value: 8000, timestamp: ago(20) }, maxPrice: { value: 12000, timestamp: ago(20) }, lastUpdated: ago(10) } },
  });
  assert.equal(listed.data.alzaPrice_alza_cz_5.minPrice.value, 10000);
  assert.equal(listed.data.alzaPrice_alza_cz_5.maxPrice.value, 12000, "maximum ze zálohy se dál slučuje");
  assert.equal(listed.data.alzaPrice_alza_cz_5.cashback, undefined, "ceny z novějšího záznamu");
});

test("č. 17 seznam a nastavení počítají s cenou k zaplacení (zdrojový text)", () => {
  const content = read("src/content.js");
  assert.match(content, /const ownLowest = AlzaCore\.getPlausiblePayNowPrice\(/, "„rozbalené levněji“ proti ceně k zaplacení");
  const options = read("src/options/options.js");
  assert.match(options, /lowest: AlzaCore\.getPlausiblePayNowPrice\(Object\.keys\(recordPrices\)/, "sloupec aktuální ceny");
});

// === č. 18 Úklid starých dat ===

test("č. 18 findStaleProducts: koupené za poslední rok a zboží s neprošlou připomínkou cashbacku se nemaže", () => {
  const old = ago(200);
  const product = (id) => ({
    [`alzaPrice_alza_cz_${id}`]: { original: 1000, lastUpdated: old, url: `https://www.alza.cz/x-d${id}.htm` },
    [`alzaHistory_alza_cz_${id}`]: [{ t: old, s: old, p: { original: 1000, applus: 900 }, a: "in" }],
  });
  const buy = (t, extra = {}) => ({ domain: "alza_cz", buys: [{ t, n: 1, o: "1", p: 900, ...extra }] });
  const reminder = (boughtAt, registerUntil = null) => ({ url: URL_1, domain: "alza_cz", boughtAt, registerUntil });
  const all = {
    ...product(1), // koupeno před 199 dny
    ...product(2), // koupeno před 2 lety
    ...product(3), // koupeno a vráceno
    ...product(4), // připomínka cashbacku s lhůtou v budoucnu
    ...product(5), // prošlá připomínka
    ...product(6), // nic
    ...product(7), // připomínka bez lhůty, nákup před 104 dny (drží se cashbackKeepDays)
    alzaOwned: { alza_cz_1: buy(old + DAY), alza_cz_2: buy(ago(800)), alza_cz_3: buy(old + DAY, { ret: true }) },
    alzaCashbackReminders: { alza_cz_4: reminder(old, NOW + 10 * DAY), alza_cz_5: reminder(old, ago(3)), alza_cz_7: reminder(ago(104)) },
  };
  assert.equal(AlzaCore.storageKeys.owned, "alzaOwned");
  assert.equal(AlzaCore.storageKeys.cashbackReminders, "alzaCashbackReminders");
  assert.deepEqual(plain(AlzaCore.findStaleProducts(all, NOW).map(({ key }) => key)).sort(), ["alza_cz_2", "alza_cz_3", "alza_cz_5", "alza_cz_6"]);
});

test("č. 18 removeProducts: smaže i načtenou spotřebu, poznámku a skrytí uživatele nechá", async () => {
  const { AlzaCore: core, AlzaStore, data } = setupStore({
    alzaHistory_alza_cz_1: [{ t: 1, s: 1, p: { original: 1 }, a: "in" }],
    alzaPrice_alza_cz_1: { original: 1 },
    [AlzaCore.storageKeys.energy]: { alza_cz_1: { kwh: 75, per: "hours", at: 1 }, alza_cz_2: { kwh: 60, per: "hours", at: 1 } },
    [AlzaCore.storageKeys.notes]: { alza_cz_1: { text: "pozn", url: URL_1, domain: "alza_cz", at: 1 } },
    [AlzaCore.storageKeys.hidden]: { alza_cz_1: { url: URL_1, domain: "alza_cz", at: 1 } },
  });
  await AlzaStore.run({ type: "removeProducts", productKeys: ["alza_cz_1"] });
  assert.equal(data.alzaHistory_alza_cz_1, undefined);
  assert.deepEqual(Object.keys(data[core.storageKeys.energy]), ["alza_cz_2"]);
  assert.ok(data[core.storageKeys.notes].alza_cz_1, "poznámka zůstává");
  assert.ok(data[core.storageKeys.hidden].alza_cz_1, "skrytí zůstává");
});

// === č. 19 Import zálohy ===

test("č. 19 importData: novější poznámka, skrytí a značka zůstanou; starší se doplní", async () => {
  const { notes, hidden, hiddenBrands } = AlzaCore.storageKeys;
  const note = (text, at) => ({ text, url: URL_1, domain: "alza_cz", name: null, at });
  const { AlzaStore, data } = setupStore({
    [notes]: { alza_cz_1: note("nová", 200), alza_cz_2: note("stará", 100) },
    [hidden]: { alza_cz_1: { url: URL_1, domain: "alza_cz", name: "Nový název", at: 200 } },
    [hiddenBrands]: { lego: { name: "LEGO", at: 200 } },
  });
  await AlzaStore.run({
    type: "importData",
    items: {
      [notes]: { alza_cz_1: note("ze zálohy starší", 150), alza_cz_2: note("ze zálohy novější", 150), alza_cz_3: note("jen v záloze", 50) },
      [hidden]: { alza_cz_1: { url: URL_1, domain: "alza_cz", name: "Starý název", at: 100 }, alza_cz_9: { url: "https://www.alza.cz/x-d9.htm", domain: "alza_cz", name: null, at: 100 } },
      [hiddenBrands]: { lego: { name: "Lego", at: 100 }, apple: { name: "Apple", at: 100 } },
    },
  });
  assert.deepEqual(plain(Object.fromEntries(Object.entries(data[notes]).map(([key, item]) => [key, item.text]))), { alza_cz_1: "nová", alza_cz_2: "ze zálohy novější", alza_cz_3: "jen v záloze" });
  assert.equal(data[hidden].alza_cz_1.name, "Nový název");
  assert.ok(data[hidden].alza_cz_9);
  assert.deepEqual(plain(data[hiddenBrands]), { lego: { name: "LEGO", at: 200 }, apple: { name: "Apple", at: 100 } });
});

test("č. 19 importData: procházené produkty – pozdější čas a „prohlédnuto“ zůstane", async () => {
  const browsed = AlzaCore.storageKeys.browsed;
  const { AlzaStore, data } = setupStore({
    [browsed]: {
      alza_cz_1: { url: URL_1, domain: "alza_cz", name: "Nový název", image: null, seenAt: 500, openedAt: 400 },
      alza_cz_2: { url: "https://www.alza.cz/x-d2.htm", domain: "alza_cz", name: "Starý", image: null, seenAt: 100 },
    },
    alzaTargets: { alza_cz_1: { price: 1 } },
  });
  await AlzaStore.run({
    type: "importData",
    items: {
      // Záloha z 2026.11.12: starší čas, bez openedAt
      [browsed]: {
        alza_cz_1: { url: URL_1, domain: "alza_cz", name: "Starý název", image: null, seenAt: 300 },
        alza_cz_2: { url: "https://www.alza.cz/x-d2.htm", domain: "alza_cz", name: "Novější", image: null, seenAt: 300, openedAt: 250 },
        alza_cz_3: { url: "https://www.alza.cz/x-d3.htm", domain: "alza_cz", name: "Jen v záloze", image: null, seenAt: 50 },
      },
      alzaTargets: { alza_cz_1: { price: 2 } },
    },
  });
  assert.deepEqual(plain(data[browsed].alza_cz_1), { url: URL_1, domain: "alza_cz", name: "Nový název", image: null, seenAt: 500, openedAt: 400 });
  assert.deepEqual(plain(data[browsed].alza_cz_2), { url: "https://www.alza.cz/x-d2.htm", domain: "alza_cz", name: "Novější", image: null, seenAt: 300, openedAt: 250 });
  assert.equal(data[browsed].alza_cz_3.seenAt, 50);
  // Ostatní mapy jako dřív: položka ze zálohy přepíše stávající
  assert.equal(data.alzaTargets.alza_cz_1.price, 2);
});

test("č. 19 kontrola importu: časy poukazu v mezích, skryté produkty jen ze známých polí", () => {
  const { context } = loadCore({ files: ["src/options/options-backup.js"] });
  const { sanitizeVouchers, sanitizeHidden, sanitizeProductMap } = context.OptionsData;
  const voucher = (code, extra) => ({ code, domain: "alza_cz", kind: "amount", value: 500, addedAt: NOW - DAY, ...extra });
  const vouchers = plain(
    sanitizeVouchers(
      {
        a: voucher("AAA111", { until: 1e18, applied: 1e18, usedAt: 1e18 }),
        b: voucher("BBB222", { until: NOW + 300 * DAY, applied: NOW - HOUR, usedAt: NOW - HOUR }),
        c: voucher("CCC333", { until: NOW - 10 * DAY }), // prošlá platnost zůstává (poukaz se ukáže jako prošlý)
      },
      NOW
    )
  );
  assert.deepEqual(vouchers.alza_cz_AAA111, { code: "AAA111", domain: "alza_cz", kind: "amount", value: 500, addedAt: NOW - DAY, usedAt: NOW });
  assert.deepEqual(vouchers.alza_cz_BBB222, { code: "BBB222", domain: "alza_cz", kind: "amount", value: 500, until: NOW + 300 * DAY, addedAt: NOW - DAY, applied: NOW - HOUR, usedAt: NOW - HOUR });
  assert.equal(vouchers.alza_cz_CCC333.until, NOW - 10 * DAY);
  Object.values(vouchers).forEach((item) => Object.values(item).filter((value) => typeof value === "number" && value > 1e6).forEach((time) => assert.ok(!Number.isNaN(new Date(time).getTime()))));

  const hidden = plain(
    sanitizeHidden(
      {
        x: { url: URL_1, domain: "alza_cz", name: "N".repeat(900), at: NOW - DAY, extra: "cokoli", nested: { a: 1 }, image: "https://evil.example/x.png" },
        y: { url: "https://www.alza.cz/y-d2.htm", domain: "alza_cz", at: 1e18 },
        z: { url: "https://evil.example/z-d3.htm", domain: "alza_cz", at: 1 },
        w: { url: "https://www.alza.sk/w-d4.htm", domain: "alza_cz", at: 1 }, // doména nepatří k adrese
      },
      NOW
    )
  );
  assert.deepEqual(Object.keys(hidden).sort(), ["alza_cz_1", "alza_cz_2"]);
  assert.deepEqual(Object.keys(hidden.alza_cz_1).sort(), ["at", "domain", "name", "url"]);
  assert.equal(hidden.alza_cz_1.name.length, 500);
  assert.deepEqual(hidden.alza_cz_2, { url: "https://www.alza.cz/y-d2.htm", domain: "alza_cz", name: null, at: NOW });

  // Procházené: neplatné „prohlédnuto“ se zahodí, platné zůstane
  const browsed = plain(sanitizeProductMap({ a: { url: URL_1, domain: "alza_cz", seenAt: 5, openedAt: 1e18 }, b: { url: "https://www.alza.cz/y-d2.htm", domain: "alza_cz", seenAt: 5, openedAt: 4 } }, false));
  assert.equal("openedAt" in browsed.alza_cz_1, false);
  assert.equal(browsed.alza_cz_2.openedAt, 4);
  // Stránka nastavení používá pro skryté produkty sanitizeHidden
  assert.match(read("src/options/options.js"), /key === AlzaCore\.storageKeys\.hidden\) \{\n\s+valid\[key\] = sanitizeHidden\(value\);/);
});

// === Dárkový šek je platba, ne sleva ===

test("dárkový šek cenu kusu nesnižuje, slevový kód ano (parseOrderPurchases, parseOwnedDetails)", () => {
  const order = (items) => ({ parts: [{ created: "2026-11-05T19:27:53.69Z", items }] });
  const goods = { commodityId: 1, commodityName: "Myš", commodityUrl: "/mys-d1.htm", pricePerItem: "1 000 Kč/ks", count: 1, onClaimItemGuideClick: { enabled: true } };
  const gift = (name) => ({ commodityName: name, commodityUrl: "", pricePerItem: "-400 Kč/ks", price: "-400 Kč", count: 1 });
  const code = { commodityName: "Sleva na zboží - kód", commodityUrl: "", pricePerItem: "-100 Kč/ks", price: "-100 Kč", count: 1 };
  const price = (items) => AlzaCore.parseOrderPurchases(order(items), "alza_cz")[0].price;
  assert.equal(price([goods, gift("- Sleva na zboží - dárkový šek (uplatnění, typ H.A.)")]), 1000);
  assert.equal(price([goods, gift("Zľava na tovar - darčekový šek")]), 1000);
  assert.equal(price([goods, gift("Ajándékutalvány beváltása")]), 1000);
  assert.equal(price([goods, gift("Gift voucher")]), 1000);
  assert.equal(price([goods, code]), 900, "slevový kód je dál sleva");
  assert.equal(price([goods, code, gift("Sleva na zboží - Dárkový šek")]), 900, "kód ano, šek ne");
  // Moje nákupy čtou cenu kusu stejně
  assert.equal(AlzaCore.parseOwnedDetails(order([goods, gift("Sleva na zboží - dárkový šek")]), "alza_cz").alza_cz_1.p, 1000);
  // Hlídání po nákupu pak zlevnění 1000 → 900 ohlásí
  const purchase = { price: price([goods, gift("Sleva na zboží - dárkový šek")]), boughtAt: ago(2), returnUntil: ago(-12), domain: "alza_cz" };
  assert.deepEqual(plain(AlzaCore.getPurchaseDrop(purchase, { original: 900 }, NOW)), { lowest: 900, saving: 100, reference: 1000 });
  // Čtení řádků pro peněženku poukazů se nemění – řádek šeku tam dál je
  assert.deepEqual(plain(AlzaCore.parseOrderVoucherLines(order([goods, gift("Sleva na zboží - dárkový šek")])).map(({ amount }) => amount)), [400]);
});

// === Nízké z jádra ===

test("patchMap: pole pod klíčem mapy se nahradí mapou – zápis se neztratí", async () => {
  const { AlzaStore, data } = setupStore({ alzaTargets: [{ price: 1 }] });
  const map = await AlzaStore.run({ type: "patchMap", key: "alzaTargets", set: { alza_cz_1: { price: 5 } } });
  assert.deepEqual(plain(map), { alza_cz_1: { price: 5 } });
  assert.equal(Array.isArray(data.alzaTargets), false);
  // Po uložení a načtení (JSON, jako chrome.storage) položka zůstává
  assert.deepEqual(JSON.parse(JSON.stringify(data.alzaTargets)), { alza_cz_1: { price: 5 } });
});

test("mrtvý kód je pryč: parseCashbackTerms a ikona play", () => {
  assert.equal(AlzaCore.parseCashbackTerms, undefined);
  // AlzaIcons je const (ne vlastnost kontextu) – přečíst výrazem
  const context = vm.createContext({});
  vm.runInContext(`${read("src/shared/icons.js")}\n;globalThis.icons = AlzaIcons;`, context);
  assert.ok(Object.hasOwn(context.icons.paths, "bell"), "ikony načtené");
  assert.equal(Object.hasOwn(context.icons.paths, "play"), false);
});
