// Audit 2026-11-16 č. 1, zbytek: stejná cena viděná po díře ve sledování (déle než priceGapDays) se nezapisuje jako
// pokračování záznamu – jeden záznam by jinak tvrdil souvislé sledování přes měsíce, kdy cenu nikdo neviděl
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadCore } = require("./load-core.js");

const { AlzaCore } = loadCore();
const DAY = 86400e3;
const now = Date.UTC(2026, 10, 16, 12);
const plain = (value) => JSON.parse(JSON.stringify(value));

test("historie: stejná cena po díře ve sledování založí nový záznam (detail i kontrola)", () => {
  const entries = [{ t: now - 150 * DAY, s: now - 150 * DAY, p: { original: 1000 }, a: "in" }];
  AlzaCore.appendHistory(entries, { original: 1000 }, "in", null, { now });
  assert.equal(entries.length, 2);
  assert.deepEqual(plain(entries[1]), { t: now, s: now, p: { original: 1000 }, a: "in" });
  assert.equal(entries[0].s, now - 150 * DAY, "starý záznam se neprodlouží");
});

test("historie: stejná cena potvrzená do priceGapDays záznam jen prodlouží", () => {
  const entries = [{ t: now - 10 * DAY, s: now - DAY, p: { original: 1000 }, a: "in" }];
  AlzaCore.appendHistory(entries, { original: 1000 }, "in", null, { now });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].s, now);
});

test("historie: pozorování z výpisu po díře založí nový záznam se všemi cenami posledního", () => {
  const entries = [{ t: now - 90 * DAY, s: now - 90 * DAY, p: { original: 1000, cashback: 900 }, a: "in" }];
  assert.equal(AlzaCore.appendListingObservation(entries, { original: 1000 }, null, { now }), true);
  assert.equal(entries.length, 2);
  assert.deepEqual(plain(entries[1]), { t: now, s: now, p: { original: 1000, cashback: 900 }, a: "in" });
  // Další pozorování hned potom už jen prodlouží nový záznam
  AlzaCore.appendListingObservation(entries, { original: 1000 }, null, { now: now + 3600e3 });
  assert.equal(entries.length, 2);
  assert.equal(entries[1].s, now + 3600e3);
});

test("historie: slučování shodných záznamů (normalizeHistory, getPriceChangeHistory) díru nepřemostí", () => {
  const history = () => [
    { t: now - 150 * DAY, s: now - 150 * DAY, p: { original: 1000 }, a: "in" },
    { t: now - DAY, s: now, p: { original: 1000 }, a: "in" },
  ];
  assert.equal(AlzaCore.normalizeHistory(history(), "cz").length, 2);
  assert.equal(AlzaCore.getPriceChangeHistory(history()).length, 2);
  // Bez díry se shodné sousední záznamy slučují jako dřív
  const close = [
    { t: now - 3 * DAY, s: now - 2 * DAY, p: { original: 1000 }, a: "in" },
    { t: now - DAY, s: now, p: { original: 1000 }, a: "in" },
  ];
  assert.equal(AlzaCore.normalizeHistory(plain(close), "cz").length, 1);
  assert.equal(AlzaCore.getPriceChangeHistory(plain(close)).length, 1);
});

test("historie: produkt viděný před 150 dny a dnes za stejnou cenu nemá 150 dní známé ceny", () => {
  const entries = [{ t: now - 150 * DAY, s: now - 150 * DAY, p: { original: 1000 }, a: "in" }];
  AlzaCore.appendHistory(entries, { original: 1500, special: 1000 }, "in", null, { now: now - 60e3 });
  AlzaCore.appendHistory(entries, { original: 1500, special: 1000 }, "in", null, { now });
  assert.ok(AlzaCore.getCoveredDays(AlzaCore.getPriceSegments(entries, Infinity, now)) < 3);
  assert.equal(AlzaCore.getPriceVerdict(entries, 1000, now), null, "hodnocení potřebuje 14 dní známé ceny");
  assert.equal(AlzaCore.getStrikethroughWarning(entries, { original: 1500, special: 1000 }, now), null);
});

test("historie: změna ceny se pozná stejně jako dřív, díra na to nemá vliv", () => {
  const entries = [{ t: now - 150 * DAY, s: now - 150 * DAY, p: { original: 1000 }, a: "in" }];
  AlzaCore.appendHistory(entries, { original: 900 }, "in", null, { now });
  assert.equal(entries.length, 2);
  assert.deepEqual(plain(entries[1].p), { original: 900 });
});
