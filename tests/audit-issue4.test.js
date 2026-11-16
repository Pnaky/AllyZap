// Regresní testy oprav z auditu (GitHub issue #4, vydání 2026.11.12.15): každá opravená chyba má svůj test,
// aby se nevrátila. Skripty se načítají do izolovaného kontextu (load-core.js), služba na pozadí s náhradou
// notifikací (loadBackground); kde to nejde (Safari, obsluha tlačítka v popupu), kontroluje se zdrojový text.
// Spuštění: node --test "tests/*.test.js"
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { loadCore, loadBackground } = require("./load-core");

const ROOT = path.resolve(__dirname, "..");
// Konce řádků sjednotit – pracovní kopie na Windows má CRLF, regexy počítají s LF
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8").replace(/\r\n/g, "\n");
// Objekty z izolovaného kontextu mají jiný prototyp – porovnávat jako prostá data
const plain = (value) => JSON.parse(JSON.stringify(value));
const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 10, 12, 10); // Pevný čas testů
const URL_101 = "https://www.alza.cz/produkt-d101.htm";

function setupStore(storage = {}) {
  const { AlzaCore, chrome, context } = loadCore({ storage, files: ["src/shared/store.js"] });
  context.AlzaStore.isWriter = true;
  return { AlzaCore, AlzaStore: context.AlzaStore, data: chrome.storage.local.data };
}

// Text funkce ze zdrojáku (od deklarace po první řádek "}" na začátku řádku)
function functionSource(source, name) {
  const match = source.match(new RegExp(`(?:async )?function ${name}\\([^)]*\\) \\{\\n[\\s\\S]*?\\n\\}\\n`));
  assert.ok(match, `funkce ${name} ve zdrojáku`);
  return match[0];
}

// === #1 Úklid množstevních cen jen před opravou (2026.11.9) a jen v chybném tvaru ===

const TIERS = [[1, 1, 89], [2, 2, 83], [3, 100000, 76]];
function tierHistory(F) {
  return [
    { t: F - 5 * DAY, s: F - 5 * DAY + 1, p: { original: 89 }, a: "in" },
    { t: F - 4 * DAY, s: F - 4 * DAY + 1, p: { original: 76 }, a: "in" }, // chyba čtení výpisu – smazat
    { t: F - 3 * DAY, s: F - 3 * DAY + 1, p: { original: 89 }, a: "in" }, // sloučí se s prvním
    { t: F - 2 * DAY, s: F - 2 * DAY + 1, p: { special: 76, original: 89 }, a: "in" }, // akce s přeškrtnutou cenou
    { t: F + DAY, s: F + DAY + 1, p: { original: 76 }, a: "in" }, // po opravě – skutečná cena
  ];
}

test("issue #4 – #1 removeQuantityTierEntries: maže jen starý chybný tvar, ne záznamy po opravě ani s přeškrtnutou cenou", () => {
  const { AlzaCore } = loadCore();
  const F = AlzaCore.quantityTierFixedAt;
  assert.equal(F, Date.UTC(2026, 10, 9));
  const entries = tierHistory(F);
  assert.equal(AlzaCore.removeQuantityTierEntries(entries, TIERS), 1);
  assert.deepEqual(plain(entries).map((entry) => entry.t), [F - 5 * DAY, F - 2 * DAY, F + DAY]);
  assert.equal(entries[0].s, F - 3 * DAY + 1, "sousední stejné záznamy sloučené");
  // Těsně před opravou se chybný záznam ještě maže, v okamžiku opravy už ne
  const edge = [{ t: F - 1, s: F - 1, p: { original: 76 }, a: "in" }, { t: F, s: F, p: { original: 76 }, a: "in" }];
  assert.equal(AlzaCore.removeQuantityTierEntries(edge, TIERS), 1);
  assert.deepEqual(plain(edge).map((entry) => entry.t), [F]);
});

test("issue #4 – #1 runCleanups: oprava historie v úložišti jednou, se stejným výsledkem", async () => {
  const { AlzaCore, AlzaStore, data } = setupStore({
    alzaPrice_alza_cz_101: { original: 89, url: URL_101, quantityTiers: TIERS, lastUpdated: NOW },
    alzaHistory_alza_cz_101: tierHistory(Date.UTC(2026, 10, 9)),
  });
  const F = AlzaCore.quantityTierFixedAt;
  assert.equal(await AlzaStore.exclusive(() => AlzaStore.runCleanups()), 1);
  assert.deepEqual(plain(data.alzaHistory_alza_cz_101).map((entry) => entry.t), [F - 5 * DAY, F - 2 * DAY, F + DAY]);
  assert.ok(Object.keys(data[AlzaCore.storageKeys.cleanups] || {}).length > 0, "oprava zapsaná jako proběhlá");
  assert.equal(await AlzaStore.exclusive(() => AlzaStore.runCleanups()), 0, "podruhé nic");
});

// === #2 Úklid starých dat: podmínka se ověří znovu ve frontě ===

test("issue #4 – #2 removeStaleProducts: produkt obnovený mezi výběrem a smazáním zůstane", async () => {
  const old = (id) => ({
    [`alzaPrice_alza_cz_${id}`]: { original: 100, lastUpdated: 1000, url: `https://www.alza.cz/x-d${id}.htm` },
    [`alzaHistory_alza_cz_${id}`]: [{ t: 1000, s: 1000, p: { original: 100 }, a: "in" }],
  });
  const { AlzaCore, AlzaStore, data } = setupStore({ ...old(1), ...old(2), ...old(3) });
  const selected = AlzaCore.findStaleProducts(structuredClone(data)).map((product) => product.key);
  assert.deepEqual(plain(selected).sort(), ["alza_cz_1", "alza_cz_2", "alza_cz_3"]);
  // Mezitím: produkt 2 zkontrolovaný (nová historie), produkt 3 hlídaný z detailu
  data.alzaHistory_alza_cz_2.push({ t: Date.now(), s: Date.now(), p: { original: 90 }, a: "in" });
  data[AlzaCore.storageKeys.watchProducts] = { alza_cz_3: { url: "https://www.alza.cz/x-d3.htm", domain: "alza_cz", name: "C", since: 1 } };
  const removed = await AlzaStore.run({ type: "removeStaleProducts", productKeys: selected });
  assert.deepEqual(plain(removed), ["alza_cz_1"]);
  assert.equal(data.alzaPrice_alza_cz_1, undefined);
  assert.equal(data.alzaHistory_alza_cz_1, undefined);
  assert.ok(data.alzaHistory_alza_cz_2 && data.alzaPrice_alza_cz_2, "obnovený produkt zůstal");
  assert.ok(data.alzaHistory_alza_cz_3 && data.alzaPrice_alza_cz_3, "hlídaný produkt zůstal");
  assert.deepEqual(plain(await AlzaStore.run({ type: "removeStaleProducts", productKeys: ["alza_cz_9"] })), [], "neznámý klíč nic nesmaže");
});

// === #3 Diagnostika: koupené zboží skryté i po vypadnutí běhu z logu ===

test("issue #4 – #3 redactDiagnostics: příznak purchaseOnly ze stavu stačí i s prázdným logem", () => {
  const { context } = loadCore({ files: ["src/options/options-backup.js"] });
  const secretUrl = "https://www.alza.cz/tajny-vysavac-d111.htm";
  const input = {
    watchLog: [],
    watchState: {
      recent: [{ key: "alza_cz_111", at: 2, name: "Tajný vysavač", url: secretUrl, image: null, lines: ["Tajný vysavač zlevnil"], purchaseOnly: true }],
      // Stejný produkt bez příznaku, jinak zapsaná adresa – pozná se podle čísla produktu
      changes: [{ name: "Tajný vysavač", url: "https://www.alza.cz/jinak-d111.htm?x=1", lines: ["zlevnění"] }],
      pendingNotifications: [{ name: "Tajná lampa", url: "https://www.alza.cz/lampa-d222.htm", domain: "alza_cz", lines: ["Tajná lampa: koupili jste za 900 Kč"], purchaseOnly: true }],
      unseen: ["alza_cz_111", "alza_cz_222", "alza_cz_333"],
    },
    errors: [],
  };
  const result = plain(context.OptionsData.redactDiagnostics(input));
  const text = JSON.stringify(result);
  ["Tajný", "Tajná", "d111", "d222", "alza_cz_111", "alza_cz_222"].forEach((secret) => assert.ok(!text.includes(secret), `v diagnostice zůstalo „${secret}“`));
  assert.deepEqual(result.watchState.unseen, ["(skryto)", "(skryto)", "alza_cz_333"]);
  assert.equal(result.watchState.changes[0].name, "(koupené zboží)");
});

// === #4 patchMap sameBy: upozornění patří k jednomu nákupu ===

test("issue #4 – #4 patchMap sameBy boughtAt: keep a merge jen u téhož nákupu", async () => {
  const { AlzaStore, data } = setupStore({ alzaPurchases: { a: { boughtAt: 100, price: 500, notifiedPrice: 390 }, b: { boughtAt: 100, price: 500, notifiedPrice: 390 } } });
  const patch = (op) => AlzaStore.run({ type: "patchMap", key: "alzaPurchases", sameBy: "boughtAt", ...op });
  // Týž nákup načtený znovu – upozornění zůstane; jiný nákup téhož produktu začíná bez něj
  await patch({ set: { a: { boughtAt: 100, price: 428 }, b: { boughtAt: 200, price: 1200 } }, keep: ["notifiedPrice"] });
  assert.deepEqual(plain(data.alzaPurchases.a), { boughtAt: 100, price: 428, notifiedPrice: 390 });
  assert.deepEqual(plain(data.alzaPurchases.b), { boughtAt: 200, price: 1200 });
  // Stav upozornění k nákupu, který synchronizace mezitím nahradila, se nezapíše
  await patch({ merge: { b: { notifiedPrice: 300, boughtAt: 100 } }, existingOnly: true });
  assert.equal(data.alzaPurchases.b.notifiedPrice, undefined);
  await patch({ merge: { b: { notifiedPrice: 300, boughtAt: 200 } }, existingOnly: true });
  assert.equal(data.alzaPurchases.b.notifiedPrice, 300);
  // Bez sameBy se chová jako dřív (merge vždy)
  await AlzaStore.run({ type: "patchMap", key: "alzaPurchases", merge: { a: { boughtAt: 999, x: 1 } } });
  assert.equal(data.alzaPurchases.a.x, 1);
});

test("issue #4 – #4 patchMap sameBy: NaN, undefined a null jsou totéž (položka se shoduje sama se sebou)", async () => {
  const { AlzaStore, data } = setupStore({ alzaPurchases: { nan: { boughtAt: NaN, notifiedPrice: 1 }, none: { notifiedPrice: 2 }, nul: { boughtAt: null, notifiedPrice: 3 } } });
  const patch = (op) => AlzaStore.run({ type: "patchMap", key: "alzaPurchases", sameBy: "boughtAt", ...op });
  await patch({ set: { nan: { boughtAt: null, price: 1 }, none: { boughtAt: NaN, price: 2 }, nul: { price: 3 } }, keep: ["notifiedPrice"] });
  assert.deepEqual([data.alzaPurchases.nan.notifiedPrice, data.alzaPurchases.none.notifiedPrice, data.alzaPurchases.nul.notifiedPrice], [1, 2, 3]);
  await patch({ merge: { nan: { seen: true }, none: { boughtAt: undefined, seen: true }, nul: { boughtAt: NaN, seen: true } }, existingOnly: true });
  assert.deepEqual(["nan", "none", "nul"].map((key) => data.alzaPurchases[key].seen), [true, true, true]);
  // Číslo proti null se neshoduje
  await patch({ merge: { nul: { boughtAt: 5, other: true } } });
  assert.equal(data.alzaPurchases.nul.other, undefined);
});

// === #6 Neúplná synchronizace objednávek se zopakuje brzy ===

const USER = "987654321";
const ORIGIN = "https://www.alza.cz";
const BASE = `${ORIGIN}/api/users/${USER}/v1/orders`;

function setupOrders(start) {
  const { AlzaCore, chrome, context } = loadCore({ files: ["src/shared/store.js", "src/shared/orders.js"] });
  context.AlzaStore.isWriter = true;
  vm.runInContext(`var testNow = ${start}; Date.now = () => testNow;`, context);
  const AlzaOrders = vm.runInContext("AlzaOrders", context);
  AlzaOrders.detailDelayMs = 0;
  return { AlzaCore, AlzaOrders, context, data: chrome.storage.local.data };
}

// API objednávek: archive = pole, nebo Error (načtení selže); details = { číslo: detail }
function ordersApi({ archive = [], details = {} }) {
  const calls = [];
  return {
    calls,
    args: {
      domainKey: "alza_cz",
      origin: ORIGIN,
      getUserId: async () => USER,
      getJson: async (url) => {
        const rest = url.slice(BASE.length);
        calls.push(rest);
        if (rest.startsWith("/active?")) return { groups: [{ orders: [] }] };
        if (rest.startsWith("/archive?")) {
          if (archive instanceof Error) throw archive;
          return { value: archive };
        }
        const id = rest.match(/^\/(\d+)\/$/)?.[1];
        if (!id || !Object.hasOwn(details, id)) throw new Error("HTTP 404");
        return details[id];
      },
    },
  };
}

test("issue #4 – #6 AlzaOrders.check: nenačtený archiv nebo detail → další úplné načtení za failedSyncRetryMinutes", async () => {
  const T0 = Date.UTC(2026, 10, 12, 8);
  const order = { orderId: "1001", created: new Date(T0 - 2 * DAY).toISOString(), state: "Vyřízena", self: { href: `${BASE}/1001/` } };
  for (const [name, api] of [
    ["archiv selhal", ordersApi({ archive: new Error("HTTP 500") })],
    ["detail chybí", ordersApi({ archive: [order], details: {} })],
  ]) {
    const { AlzaCore, AlzaOrders, context, data } = setupOrders(T0);
    assert.equal((await AlzaOrders.check(api.args)).status, "synced", name);
    const fullMs = AlzaCore.purchaseSyncHours * 60 * 60 * 1000;
    const retryMs = AlzaOrders.failedSyncRetryMinutes * 60 * 1000;
    assert.ok(retryMs < fullMs);
    assert.equal(data.alzaPurchasesSync.alza_cz + fullMs - T0, retryMs, `${name}: úplné načtení znovu za ${AlzaOrders.failedSyncRetryMinutes} min`);
    // Po uplynutí failedSyncRetryMinutes (a času kontroly) se archiv načte znovu, i když se aktivní objednávky nezměnily
    context.testNow = T0 + Math.max(retryMs, AlzaCore.purchaseProbeMinutes * 60 * 1000) + 1000;
    api.calls.length = 0;
    await AlzaOrders.check(api.args);
    assert.ok(api.calls.some((call) => call.startsWith("/archive?")), `${name}: archiv se načetl znovu`);
  }
});

test("issue #4 – #6 AlzaOrders.check: úplné načtení platí purchaseSyncHours", async () => {
  const T0 = Date.UTC(2026, 10, 12, 8);
  const { AlzaCore, AlzaOrders, context, data } = setupOrders(T0);
  const api = ordersApi({ archive: [] });
  assert.equal((await AlzaOrders.check(api.args)).status, "synced");
  assert.equal(data.alzaPurchasesSync.alza_cz, T0);
  context.testNow = T0 + AlzaOrders.failedSyncRetryMinutes * 60 * 1000 + AlzaCore.purchaseProbeMinutes * 60 * 1000;
  api.calls.length = 0;
  assert.equal((await AlzaOrders.check(api.args)).status, "unchanged");
  assert.ok(!api.calls.some((call) => call.startsWith("/archive?")), "archiv se nenačítá dřív než za purchaseSyncHours");
});

// === #8, #9, #10, vnořená balení, cashback bez ceny k zaplacení ===

test("issue #4 – #8 getNextQuantityTier: úspora v centech", () => {
  const { AlzaCore } = loadCore();
  assert.equal(AlzaCore.getNextQuantityTier([[1, 1, 1.99], [2, 99, 1.89]], 1.99, 1).saving, 0.2);
  assert.equal(AlzaCore.getNextQuantityTier([[1, 2, 4.35], [3, 99, 4.1]], 4.35, 2).saving, 0.75);
  assert.equal(AlzaCore.getNextQuantityTier([[1, 1, 0.33], [2, 9, 0.3]], 0.33, 1).saving, 0.06);
  assert.equal(AlzaCore.getNextQuantityTier([[1, 1, 89], [2, 9, 83]], 89, 1).saving, 12); // Koruny beze změny
});

test("issue #4 – #9 getListingDiscount: procenta přesně (žádné 29,999… → 29)", () => {
  const { AlzaCore } = loadCore();
  const percent = (original, special) => AlzaCore.getListingDiscount({ original, special }).percent;
  assert.equal(percent(6.3, 4.41), 30);
  assert.equal(percent(0.7, 0.49), 30);
  assert.equal(percent(1.15, 0.92), 20);
  assert.equal(percent(2.55, 2.04), 20);
  assert.equal(percent(5.05, 4.04), 20);
  assert.equal(percent(1000, 804), 19, "19,6 % zůstane 19");
  assert.equal(percent(100, 100), 0);
});

test("issue #4 – #10 findTermDates: neexistující datum se zahodí", () => {
  const { AlzaCore } = loadCore();
  const ref = Date.UTC(2026, 10, 10);
  const dates = (text) =>
    plain(AlzaCore.findTermDates(text, ref)).map(({ time }) => {
      const date = new Date(time);
      return [date.getFullYear(), date.getMonth() + 1, date.getDate()];
    });
  assert.deepEqual(dates("do 31. 4. 2027"), []);
  assert.deepEqual(dates("do 30. 2. 2027"), []);
  assert.deepEqual(dates("do 29. 2. 2027"), []);
  assert.deepEqual(dates("do 29. 2. 2028"), [[2028, 2, 29]], "přestupný rok");
  assert.deepEqual(dates("od 1. 3. 2027 do 31. 4. 2027"), [[2027, 3, 1]], "platné datum vedle neplatného zůstane");
  assert.deepEqual(plain(AlzaCore.findTermDates("2027. 02. 30.", ref, "hu")), []);
});

test("issue #4 – vnořená balení a rozměry v parseVariantSize", () => {
  const { AlzaCore } = loadCore();
  const size = (text) => plain(AlzaCore.parseVariantSize(text));
  assert.deepEqual(size("2 × 3 × 4 ks"), { amount: 24, unit: "ks" });
  assert.deepEqual(size("2 balení po 60 ks"), { amount: 120, unit: "ks" });
  assert.deepEqual(size("3 balení po 2 × 5 ks"), { amount: 30, unit: "ks" });
  assert.deepEqual(size("2 balení po 500 g"), { amount: 1, unit: "kg" });
  assert.equal(AlzaCore.parseVariantSize("20 × 30 × 40 cm"), null);
  assert.equal(AlzaCore.parseVariantSize("10 x 20 mm"), null);
  assert.equal(AlzaCore.parseVariantSize("2 × 1 m"), null);
  assert.deepEqual(size("50 cm"), { amount: 0.5, unit: "m" }, "samotná délka dál platí");
});

test("issue #4 – jen cashback / výkup není cena k zaplacení (getPurchaseDrop, getPurchaseReferencePrice)", () => {
  const { AlzaCore } = loadCore();
  const purchase = { price: 1000, returnUntil: NOW + 5 * DAY, domain: "alza_cz", boughtAt: NOW - 2 * DAY };
  assert.equal(AlzaCore.getPurchaseDrop(purchase, { cashback: 700 }, NOW), null);
  assert.equal(AlzaCore.getPurchaseDrop(purchase, { scrappage: 600 }, NOW), null);
  assert.equal(AlzaCore.getPurchaseDrop(purchase, { cashback: 700, scrappage: 600 }, NOW), null);
  assert.equal(AlzaCore.getPurchaseDrop(purchase, { original: 900, cashback: 700 }, NOW).lowest, 900);
  // Historie kolem nákupu: záznam jen s cashbackem cenu nákupu nesnižuje
  const boughtAt = purchase.boughtAt;
  assert.equal(AlzaCore.getPurchaseReferencePrice([{ t: boughtAt - 1000, p: { cashback: 500 } }], boughtAt), null);
  assert.equal(AlzaCore.getPurchaseReferencePrice([{ t: boughtAt - 2000, p: { original: 1000 } }, { t: boughtAt - 1000, p: { original: 1000, cashback: 500 } }], boughtAt), 1000);
  assert.equal(AlzaCore.getPurchaseDrop(purchase, { original: 950 }, NOW, [{ t: boughtAt - 1000, p: { cashback: 500 } }]), null, "historie bez ceny k zaplacení = cenu nákupu neznáme");
});

// === #11 Procházení: vypnutí zahodí i podpis neuložených pozorování ===

function loadBrowsing() {
  const { AlzaCore, context } = loadCore({ storage: { alzaSettings: { saveBrowsing: false } } });
  const timers = [];
  Object.assign(context, {
    window: { location: { hostname: "www.alza.cz", origin: "https://www.alza.cz", pathname: "/kategorie/18851136.htm", search: "" } },
    document: { items: [], querySelectorAll() { return this.items; }, addEventListener() {}, body: {} },
    MutationObserver: class {
      observe() {}
      disconnect() {}
    },
  });
  vm.runInContext(read("src/browsing.js"), context, { filename: "src/browsing.js" });
  // Odložený zápis (scheduleFlush) se nespouští – test sleduje jen frontu pozorování
  context.setTimeout = (fn, ms) => timers.push({ fn, ms });
  context.clearTimeout = () => {};
  const browsing = vm.runInContext("AlzaBrowsing", context);
  browsing.state.domainKey = "alza_cz";
  browsing.readItem = (item) => item.product;
  return { AlzaCore, context, browsing };
}

test("issue #4 – #11 browsing: po vypnutí a zapnutí se neuložené pozorování zapíše znovu", () => {
  const { context, browsing } = loadBrowsing();
  const product = { url: "https://www.alza.cz/x-d555.htm", name: "X", image: null, prices: [["original", 100]], availability: "in" };
  context.document.items = [{ product }];
  const { pending, seen } = browsing.state;
  browsing.setEnabled(true);
  assert.ok(pending.has("alza_cz_555") && seen.has("alza_cz_555"));
  browsing.setEnabled(false);
  assert.equal(pending.size, 0);
  assert.ok(!seen.has("alza_cz_555"), "podpis neuloženého pozorování pryč");
  browsing.setEnabled(true);
  assert.ok(pending.has("alza_cz_555"), "po zapnutí se pozorování sebere znovu");
  // Uložené pozorování (zápis proběhl) se po vypnutí a zapnutí nezapisuje znovu
  pending.clear();
  browsing.setEnabled(false);
  browsing.setEnabled(true);
  assert.equal(pending.size, 0);
  assert.ok(seen.has("alza_cz_555"));
});

// === #12 Výpis kategorie: historie zapsaná za běhu stránky ===

function loadCategory() {
  const { AlzaCore, context } = loadCore();
  Object.assign(context, {
    document: { querySelector: () => null, querySelectorAll: () => [], documentElement: { toggleAttribute() {} } },
    window: { location: { hostname: "www.alza.cz", origin: "https://www.alza.cz", hash: "", pathname: "/kapsle/18851136.htm" } },
    MutationObserver: class {
      observe() {}
      disconnect() {}
    },
    requestAnimationFrame: () => 0,
  });
  vm.runInContext(read("src/category.js"), context, { filename: "src/category.js" });
  return { AlzaCore, category: vm.runInContext("AlzaUnitPrice", context) };
}

test("issue #4 – #12 category applyHistoryChanges: načtené produkty dostanou novou historii, neznámé se ignorují", () => {
  const { category } = loadCategory();
  let updates = 0;
  category.scheduleUpdate = () => updates++;
  category.state.domainKey = "alza_cz";
  category.state.histories.set("alza_cz_101", null);
  category.state.histories.set("alza_cz_102", [{ t: 1 }]);
  const entries = [
    { t: NOW - 40 * DAY, s: NOW - 20 * DAY, p: { original: 100 }, a: "in" },
    { t: NOW - 20 * DAY, s: NOW - DAY, p: { original: 90 }, a: "in" },
  ];
  category.applyHistoryChanges({
    alzaHistory_alza_cz_101: { newValue: entries },
    alzaHistory_alza_cz_102: { oldValue: entries }, // smazaná historie
    alzaHistory_alza_cz_999: { newValue: entries }, // produkt, který výpis nemá
    alzaPrice_alza_cz_101: { newValue: { original: 90 } },
  });
  assert.ok(Array.isArray(category.state.histories.get("alza_cz_101")) && category.state.histories.get("alza_cz_101").length > 0);
  assert.equal(category.state.histories.get("alza_cz_102"), null);
  assert.ok(!category.state.histories.has("alza_cz_999"));
  assert.equal(updates, 1);
  category.applyHistoryChanges({ alzaHistory_alza_cz_999: { newValue: entries }, alzaSettings: { newValue: {} } });
  assert.equal(updates, 1, "beze změny načtených produktů žádný přepočet");
  // init se k posluchači změn úložiště přihlásí
  assert.match(read("src/category.js"), /if \(area === "local"\) this\.applyHistoryChanges\(changes\)/);
});

// === #13 Popup: tlačítko Hotovo po chybě zápisu znovu použitelné ===

test("issue #4 – #13 popup: Hotovo u připomínky cashbacku se po chybě znovu povolí", () => {
  const source = read("src/popup/popup.js");
  const start = source.indexOf('done.addEventListener("click"');
  assert.ok(start > 0, "obsluha tlačítka Hotovo");
  const handler = source.slice(start, source.indexOf("line.appendChild(done)", start));
  const disabled = handler.indexOf("done.disabled = true");
  const run = handler.indexOf("AlzaStore.run(");
  const caught = handler.indexOf(".catch(", run);
  assert.ok(disabled >= 0 && disabled < run, "zakázat před zápisem");
  assert.ok(caught > run, "chyba zápisu ošetřená");
  assert.match(handler.slice(caught), /done\.disabled = false/, "v catch se tlačítko znovu povolí");
});

// === #16 Hlášení chyby: text nesmí tvrdit, že se nic neodešle ===

test("issue #4 – #16 reportBugTitle: GitHub dostane údaje už při otevření (všechny 4 jazyky)", () => {
  const context = vm.createContext({});
  vm.runInContext(read("src/options/options-texts.js"), context);
  const texts = vm.runInContext("OPTIONS_TEXTS", context);
  const expected = {
    cz: { banned: /Nic se neodešle/i, opens: /dostane GitHub[\s\S]*při (?:jejím )?otevření/ },
    sk: { banned: /Nič sa neodošle/i, opens: /dostane GitHub[\s\S]*pri (?:jej )?otvorení/ },
    hu: { banned: /Semmi sem kerül elküldésre/i, opens: /GitHub[\s\S]*megnyitáskor megkapja/ },
    en: { banned: /Nothing is sent/i, opens: /GitHub receives[\s\S]*as soon as the page opens/ },
  };
  for (const [lang, { banned, opens }] of Object.entries(expected)) {
    const title = texts[lang].reportBugTitle;
    assert.equal(typeof title, "string", lang);
    assert.doesNotMatch(title, banned, `${lang}: tvrdí, že se nic neodešle`);
    assert.match(title, opens, `${lang}: chybí, že GitHub údaje dostane při otevření`);
  }
});

// === Košík: HTTP 5xx bez ErrorLevel je nejistý výsledek ===

function loadCartWarning(reply) {
  const { context } = loadCore();
  vm.runInContext("var AlzaPriceTracker = { selectors: { productLink: 'a.name', quantityInput: 'input.count' } };", context);
  Object.assign(context, {
    window: { location: { origin: "https://www.alza.cz" } },
    fetch: async () => {
      const { status, body } = reply();
      return { ok: status >= 200 && status < 300, status, json: async () => (body === undefined ? Promise.reject(new Error("bez JSON")) : body) };
    },
  });
  vm.runInContext(read("src/content/cart-warning.js"), context, { filename: "src/content/cart-warning.js" });
  const tracker = vm.runInContext("AlzaPriceTracker", context);
  const item = { querySelector: (selector) => (selector === "a.name" ? { href: "https://www.alza.cz/x-d123.htm" } : { value: "2" }) };
  return { tracker, item };
}

test("issue #4 – košík: HTTP 5xx bez ErrorLevel → nevíme, jestli se vložilo; 4xx → nevložilo se", async () => {
  const cases = [
    [{ status: 500 }, true],
    [{ status: 502, body: { d: { ErrorLevel: 0 } } }, true],
    [{ status: 504, body: { d: null } }, true],
    [{ status: 503, body: { d: { ErrorLevel: 2, Message: "Chyba" } } }, false],
    [{ status: 400 }, false],
    [{ status: 404, body: { d: {} } }, false],
    [{ status: 200, body: { d: { ErrorLevel: 1, Message: "Neplatný kód" } } }, false],
    [{ status: 200, body: { d: {} } }, true],
  ];
  for (const [reply, ambiguous] of cases) {
    const { tracker, item } = loadCartWarning(() => reply);
    await assert.rejects(tracker.addToCartWithCode(item, "KOD"), (error) => {
      assert.equal(error.ambiguous, ambiguous, `HTTP ${reply.status} ${JSON.stringify(reply.body)}`);
      return true;
    });
  }
  const { tracker, item } = loadCartWarning(() => ({ status: 200, body: { d: { Id: 5, ItemsCount: 2 } } }));
  assert.equal((await tracker.addToCartWithCode(item, "KOD")).ItemsCount, 2);
});

// === Smazání všech dat: záloha musí odpovídat současným datům ===

test("issue #4 – smazání dat: sameBackupData nezávisle na pořadí, pozná přidaný, změněný i chybějící klíč", () => {
  const source = functionSource(read("src/options/options.js"), "sameBackupData");
  const sameBackupData = new Function(`${source}\nreturn sameBackupData;`)();
  const backup = { a: { x: 1, list: [1, 2] }, b: "text", c: null };
  assert.equal(sameBackupData({ c: null, b: "text", a: { x: 1, list: [1, 2] } }, backup), true, "jiné pořadí klíčů");
  assert.equal(sameBackupData({ ...backup, d: 1 }, backup), false, "přidaný klíč");
  assert.equal(sameBackupData({ a: backup.a, b: "text" }, backup), false, "chybějící klíč");
  assert.equal(sameBackupData({ ...backup, b: "jiný" }, backup), false, "změněná hodnota");
  assert.equal(sameBackupData({ ...backup, a: { x: 1, list: [2, 1] } }, backup), false, "změněné pořadí v poli");
  assert.equal(sameBackupData({ a: 1, x: undefined }, { a: 1, y: 2 }), false, "stejný počet, jiné klíče");
  assert.equal(sameBackupData({}, {}), true);
  // Před smazáním se data porovnají se zálohou
  assert.match(read("src/options/options.js"), /if \(!sameBackupData\(await getBackupData\(\), wipeBackup\)\)/);
});

// === Safari: ochrany cest při sestavení a instalaci ===

test("issue #4 – Safari build.sh: BUILD ověřená před rm -rf, instalace přes .new, pluginkit bez || true", () => {
  const script = read("safari/build.sh");
  const rmBuild = script.indexOf('rm -rf "$BUILD"');
  assert.ok(rmBuild > 0, 'rm -rf "$BUILD"');
  const before = script.slice(0, rmBuild);
  for (const guard of ['BUILD="$(cd "$BUILD" && pwd -P)"', 'case "$ROOT_REAL/" in "$BUILD/"*) die', 'case "$UPSTREAM_REAL/" in "$BUILD/"*) die', '"$HOME"', "$BUILD_MARK", 'ls -A "$BUILD"']) {
    assert.ok(before.includes(guard), `před smazáním chybí kontrola: ${guard}`);
  }
  assert.equal(script.indexOf('rm -rf "$BUILD"', rmBuild + 1), -1, "jediné mazání složky sestavení");
  assert.ok(script.indexOf('touch "$BUILD/$BUILD_MARK"') > rmBuild, "značka sestavení po vytvoření složky");
  // Instalace: nová kopie vedle, stará se smaže až po úspěšném zkopírování
  const copy = script.indexOf('ditto "$APP" "$TARGET.new" || die');
  const rmTarget = script.indexOf('rm -rf "$TARGET"\n');
  const move = script.indexOf('mv "$TARGET.new" "$TARGET"');
  assert.ok(copy > 0 && rmTarget > copy && move > rmTarget, "pořadí ditto → rm → mv");
  assert.ok(script.indexOf("CFBundleIdentifier") < rmTarget, "cizí aplikace se nepřepíše");
  assert.doesNotMatch(script, /pluginkit -a [^\n]*\|\| true/, "chyba registrace se nesmí spolknout");
});

test("issue #4 – Safari prepare.py: překryv výstupu se zdrojáky se ověří před rmtree", () => {
  const source = read("safari/tools/prepare.py");
  const overlap = source.indexOf("se překrývá se zdrojáky");
  const rmtree = source.indexOf("shutil.rmtree(out)");
  assert.ok(overlap > 0 && rmtree > overlap);
  assert.match(source.slice(0, rmtree), /out == source or out in source\.parents/);
});

test("issue #4 – Safari AppDelegate: spuštění kvůli notifikaci podle klíče, okno od uživatele se nezavře", () => {
  const source = read("safari/macos/App/AppDelegate.swift");
  assert.match(source, /private var launchedForNotification = false/);
  assert.match(source, /private var openedByUser = false/);
  assert.match(source, /launchUserNotificationUserInfoKey\] != nil \{\s*launchedForNotification = true/);
  assert.match(source, /applicationShouldHandleReopen[\s\S]*?openedByUser = true/);
  assert.match(source, /&& !self\.openedByUser/, "odhad podle času jen bez okna od uživatele");
  assert.doesNotMatch(source, /let launchedForNotification = self\.mainWindow == nil \|\| Date\(\)/, "jen 5s odhad");
});

// === #5 Notifikace: nedoručené se vrátí do fronty, příznaky připomínky až po doručení ===

const pendingChange = (id, name) => ({ name, url: `https://www.alza.cz/x-d${id}.htm`, image: null, listUrl: null, domain: "alza_cz", lang: "cz", lines: [`${name} zlevnil`] });

test("issue #4 – #5 flushPendingNotifications: nedoručená notifikace zpět do fronty, nejvýš notifyMaxAttempts×", async () => {
  // Fronta až po startu služby – frontu nalezenou při startu (bez alarmu) služba odešle hned (audit 2026-11-16)
  const bg = loadBackground({ now: NOW });
  await bg.ready;
  bg.data.alzaWatchState = { ...bg.data.alzaWatchState, pendingNotifications: [pendingChange(1, "A"), pendingChange(2, "B")] };
  const max = bg.get("config.notifyMaxAttempts");
  assert.ok(max >= 2);
  let failedA = 0;
  bg.notifications.fail = (options) => options.title === "A" && ++failedA > 0;
  const pending = () => plain(bg.data.alzaWatchState.pendingNotifications || []);
  await bg.context.flushPendingNotifications();
  assert.deepEqual(bg.notifications.created.map(({ options }) => options.title), ["B"]);
  assert.deepEqual(pending().map(({ name, attempts }) => [name, attempts]), [["A", 1]]);
  for (let attempt = 2; attempt < max; attempt++) {
    await bg.context.flushPendingNotifications();
    assert.deepEqual(pending().map(({ name, attempts }) => [name, attempts]), [["A", attempt]]);
  }
  await bg.context.flushPendingNotifications();
  assert.deepEqual(pending(), [], "po posledním pokusu se zahodí");
  assert.equal(failedA, max, "celkem notifyMaxAttempts pokusů");
  // Doručená po opakování odejde jen jednou
  bg.data.alzaWatchState.pendingNotifications = [pendingChange(3, "C")];
  let failedC = 0;
  bg.notifications.fail = (options) => options.title === "C" && failedC++ === 0;
  await bg.context.flushPendingNotifications();
  await bg.context.flushPendingNotifications();
  assert.deepEqual(bg.notifications.created.map(({ options }) => options.title), ["B", "C"]);
  assert.deepEqual(pending(), []);
});

test("issue #4 – #5 souhrnná notifikace: při chybě se vrátí všechny změny", async () => {
  const changes = [1, 2, 3, 4].map((id) => pendingChange(id, `P${id}`));
  // Fronta až po startu služby (při startu by ji služba odeslala hned – audit 2026-11-16)
  const bg = loadBackground({ now: NOW });
  await bg.ready;
  bg.data.alzaWatchState = { ...bg.data.alzaWatchState, pendingNotifications: changes };
  bg.notifications.fail = () => true;
  await bg.context.flushPendingNotifications();
  const pending = plain(bg.data.alzaWatchState.pendingNotifications);
  assert.deepEqual(pending.map(({ name, attempts }) => [name, attempts]), changes.map(({ name }) => [name, 1]));
  // Úspěch: fronta prázdná, jedna souhrnná notifikace
  bg.notifications.fail = null;
  await bg.context.flushPendingNotifications();
  assert.equal(bg.notifications.created.length, 1);
  assert.deepEqual(plain(bg.data.alzaWatchState.pendingNotifications), []);
});

test("issue #4 – #5 připomínka cashbacku: příznak notifiedOpen až po doručení", async () => {
  const key = "alza_cz_777";
  const url = "https://www.alza.cz/vysavac-d777.htm";
  const bg = loadBackground({
    now: NOW,
    storage: {
      alzaSettings: { watchPurchases: true, remindCashback: true, quietHours: false },
      alzaPurchases: { [key]: { url, domain: "alza_cz", name: "Vysavač", price: 5000, boughtAt: NOW - 2 * DAY, returnUntil: NOW + 12 * DAY } },
      alzaCashbackReminders: {
        [key]: { url, domain: "alza_cz", name: "Vysavač", image: null, terms: null, title: null, refund: 500, boughtAt: NOW - 2 * DAY, registerFrom: null, registerUntil: NOW + 30 * DAY, termsRead: true, termsTries: 0 },
      },
    },
  });
  await bg.ready;
  assert.equal(bg.AlzaCore.getCashbackReminderStep(bg.data.alzaCashbackReminders[key], NOW), "open");
  bg.notifications.fail = () => true;
  await bg.context.updateCashbackReminders();
  assert.equal(bg.data.alzaCashbackReminders[key].notifiedOpen, undefined, "nedoručená připomínka se neoznačí");
  bg.notifications.fail = null;
  await bg.context.updateCashbackReminders();
  assert.equal(bg.data.alzaCashbackReminders[key].notifiedOpen, true);
  assert.equal(bg.notifications.created.length, 1);
  await bg.context.updateCashbackReminders();
  assert.equal(bg.notifications.created.length, 1, "doručená se neopakuje");
});

test("issue #4 – #5 finishRun a flushPendingNotifications vracejí nedoručené do fronty", () => {
  const source = read("src/background.js");
  for (const name of ["finishRun", "flushPendingNotifications"]) {
    assert.match(functionSource(source, name), /notifyChanges\(pending\)\s*\.then\(requeueNotifications\)/, name);
  }
  const reminders = functionSource(source, "updateCashbackReminders");
  const notify = reminders.indexOf("await notifyCashback(");
  const flags = reminders.indexOf("merge: { [key]: flags }");
  assert.ok(notify > 0 && flags > notify, "příznaky se zapíšou až po notifyCashback");
});
