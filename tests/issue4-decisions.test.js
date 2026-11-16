// Rozhodnutí k otevřeným bodům auditu (GitHub issue #4, 2026-11-12): víc nákupů téhož zboží, cena z doby nákupu
// při pozdní historii, hodnocení jen ze dnů se známou cenou, cena v boxu bez nadpisu, opravdu prázdný seznam
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { loadCore } = require("./load-core.js");

const { AlzaCore } = loadCore();
const DAY = AlzaCore.dayMs;
const NOW = Date.UTC(2026, 10, 12, 12);
const plain = (value) => JSON.parse(JSON.stringify(value));
const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8").replace(/\r\n/g, "\n");

// === Víc nákupů téhož zboží: každý zvlášť ===

test("getPurchaseDrop: víc nákupů – platí nákup, který jde ještě vrátit a ušetří nejvíc (cena i lhůta z téže objednávky)", () => {
  const buys = [
    { price: 400, boughtAt: NOW - 13 * DAY, returnUntil: NOW + 1 * DAY, count: 1 },
    { price: 1000, boughtAt: NOW - 1 * DAY, returnUntil: NOW + 13 * DAY, count: 1 },
  ];
  const purchase = { price: 400, boughtAt: buys[0].boughtAt, returnUntil: buys[1].returnUntil, domain: "alza_cz", buys };
  // Za 450: levnější nákup nic, dražší ušetří 550 – lhůta je ta jeho
  const drop = plain(AlzaCore.getPurchaseDrop(purchase, { original: 450 }, NOW));
  assert.deepEqual(drop, { lowest: 450, saving: 550, reference: 1000, returnUntil: buys[1].returnUntil });
  // Levnější nákup už nejde vrátit – za 300 se srovnává jen s dražším
  const later = plain(AlzaCore.getPurchaseDrop(purchase, { original: 300 }, NOW + 2 * DAY));
  assert.equal(later.reference, 1000);
  // Žádný nákup už nejde vrátit
  assert.equal(AlzaCore.getPurchaseDrop(purchase, { original: 300 }, NOW + 20 * DAY), null);
  // Jeden nákup v buys – jako dřív (bez returnUntil ve výsledku)
  const single = { ...purchase, price: 1000, boughtAt: buys[1].boughtAt, buys: [buys[1]] };
  assert.deepEqual(plain(AlzaCore.getPurchaseDrop(single, { original: 450 }, NOW)), { lowest: 450, saving: 550, reference: 1000 });
});

// === Cena z doby nákupu: pozdní historie ===

test("getPurchaseReferencePrice: historie začínající víc než purchaseReferenceLateDays po nákupu cenu z doby nákupu neurčuje", () => {
  const boughtAt = NOW - 6 * DAY;
  const purchase = { price: 1000, boughtAt, returnUntil: boughtAt + 14 * DAY, domain: "alza_cz" };
  const late = [{ t: boughtAt + 4 * DAY, s: NOW, p: { original: 450 }, a: "in" }];
  assert.equal(AlzaCore.getPurchaseReferencePrice(late, boughtAt), Infinity);
  // Srovnává se s cenou z objednávky – zlevnění mezi nákupem a první kontrolou se neschová
  assert.deepEqual(plain(AlzaCore.getPurchaseDrop(purchase, { original: 450 }, NOW, late)), { lowest: 450, saving: 550, reference: 1000 });
  // Do purchaseReferenceLateDays první známá cena platí (kupón viditelný až po nákupu není zlevnění)
  const soon = [{ t: boughtAt + AlzaCore.purchaseReferenceLateDays * DAY, s: NOW, p: { original: 450 }, a: "in" }];
  assert.equal(AlzaCore.getPurchaseReferencePrice(soon, boughtAt), 450);
  assert.equal(AlzaCore.getPurchaseDrop(purchase, { original: 450 }, NOW, soon), null);
  // Prázdná historie – cenu neznáme vůbec (první kontrola), nic
  assert.equal(AlzaCore.getPurchaseDrop(purchase, { original: 450 }, NOW, []), null);
});

// === Hodnocení ceny jen ze dnů se známou cenou ===

test("getPriceVerdict: dny = doba se známou cenou, ne rozpětí historie; dlouhý výpadek prodeje hodnocení nepodpírá", () => {
  const start = NOW - 180 * DAY;
  const gap = [
    { t: start, s: start + DAY, p: { original: 100 }, a: "in" },
    { t: start + DAY, s: NOW - DAY, p: {}, a: "out" },
    { t: NOW - DAY, s: NOW, p: { original: 100 }, a: "in" },
  ];
  assert.equal(AlzaCore.getPriceVerdict(gap, 100, NOW), null);
  // Souvislá historie: dny i úplnost jako dřív
  const full = [{ t: start, s: NOW, p: { original: 100 }, a: "in" }];
  const verdict = AlzaCore.getPriceVerdict(full, 100, NOW);
  assert.equal(verdict.days, 180);
  assert.equal(verdict.complete, true);
  // Kontrola přeškrtnuté ceny stojí taky jen na dnech se známou cenou
  assert.equal(AlzaCore.getStrikethroughWarning(gap, { original: 200, special: 100 }, NOW), null);
});

// === Cena v boxu bez nadpisu akce ===

// Falešný DOM: prvek s třídami, textem a potomky; querySelector hledá podle poslední třídy každé části selektoru
function el(classes = "", text = "", children = []) {
  const names = classes.split(/\s+/).filter(Boolean);
  const node = {
    classList: { contains: (name) => names.includes(name), [Symbol.iterator]: () => names[Symbol.iterator]() },
    textContent: text,
    children,
    getAttribute: () => null,
    closest: () => null,
    querySelectorAll(selector) {
      const wanted = selector
        .split(",")
        .map((part) => part.trim().split(/\s+/).pop().replace(/:not\([^)]*\)/g, "").replace(/\[.*\]$/, ""))
        .filter((part) => part.startsWith("."))
        .map((part) => part.slice(1));
      const found = [];
      const walk = (current) =>
        current.children.forEach((child) => {
          if (wanted.some((name) => child.classList.contains(name))) found.push(child);
          walk(child);
        });
      walk(node);
      return found;
    },
    querySelector(selector) {
      return node.querySelectorAll(selector)[0] || null;
    },
  };
  return node;
}

test("ceny bez nadpisu akce: hlavní cena pod přeškrtnutou je aktuální cena (detail i výpis stejně)", () => {
  const box = (withCompare) =>
    el("ads-pb ads-pb--discount", "", [el("ads-pb__price-value", "1 000,-"), ...(withCompare ? [el("js-compare-price", "1 200,-")] : [])]);
  // Výpis
  assert.deepEqual(plain(AlzaCore.extractPricesFromListingItem(el("item", "", [box(true)]))), { original: 1200, special: 1000 });
  // Detail
  const doc = (withCompare) => el("", "", [el("js-price-detail__main-price-box-wrapper", "", [box(withCompare)])]);
  assert.deepEqual(plain(AlzaCore.extractPricesFromDocument(doc(true))), { original: 1200, special: 1000 });
  // Běžný box bez přeškrtnuté ceny – hlavní cena je původní (beze změny)
  const normal = el("", "", [el("js-price-detail__main-price-box-wrapper", "", [el("ads-pb", "", [el("ads-pb__price-value", "1 000,-")])])]);
  assert.deepEqual(plain(AlzaCore.extractPricesFromDocument(normal)), { original: 1000 });
});

// === Opravdu prázdný hlídaný seznam ===

test("hlídaný seznam: prázdný DOM nic nepřepíše, kromě potvrzené nuly v záložce po ustálení stránky", () => {
  const watch = read("src/content/watch.js");
  assert.match(watch, /async syncWatchedList\(listId, \{ allowEmpty = false \} = \{\}\)/);
  assert.match(watch, /length === 0 && !\(allowEmpty && this\.getSelectedListCount\(\) === 0\)\) return;/);
  const content = read("src/content.js");
  const branch = content.slice(content.indexOf("async reloadPrices("), content.indexOf("processItems(items, listId, syncWatched = true) {"));
  assert.match(branch, /clearTimeout\(this\.state\.emptyListTimer\)/);
  assert.match(branch, /this\.state\.itemsObserver !== observer/);
  assert.match(branch, /this\.getSelectedListCount\(\) !== 0\) return;/);
  assert.match(branch, /syncWatchedList\(listId, \{ allowEmpty: true \}\)/);
  assert.ok(AlzaCore.emptyListSettleMs >= 2000, "stránka musí mít čas dokreslit položky");
});
