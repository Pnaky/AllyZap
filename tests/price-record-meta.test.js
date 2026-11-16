// Metaúdaje záznamu ceny ze stránky produktu – cena jiného stavu (Nový / Rozbalený / Zánovní) a množstevní slevy.
// Košík a seznam je berou ze záznamu ceny. Dřív je zapisovalo jen stahování ze seznamu: kontrola na pozadí obnovila
// ceny a čas záznamu, ale cenu jiného stavu nechala starou (živě 2026-11-16: nový kus 71 241 → 74 990 Kč, rozbalený
// 69 056 → 72 690 Kč; košík dál hlásil „Levněji rozbalený: 69 056 Kč“). Teď je zapisuje i kontrola na pozadí
// (AlzaCore.getPageRecordInput) a otevřený detail produktu (AlzaStore setPageMeta).
// Spuštění: node --test "tests/*.test.js"
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { loadCore, loadBackground } = require("./load-core");

const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");
const plain = (value) => JSON.parse(JSON.stringify(value));
const URL_TV = "https://www.alza.cz/77-samsung-qe77s95h-d13360942.htm";
const KEY_TV = "alzaPrice_alza_cz_13360942";
const OLD = { current: "new", prices: { new: 71241, unpacked: 69056 } };
const NEW = { current: "new", prices: { new: 74990, unpacked: 72690 } };
const TIERS = [[1, 1, 100], [2, 100000, 90]];

test("záznam ceny: ze stránky produktu se berou ceny i metaúdaje, chybějící se mažou", () => {
  const { AlzaCore } = loadCore();
  const page = { prices: { original: 74990 }, packCount: null, quantityTiers: undefined, conditions: NEW, name: "x", availability: "Skladem" };
  assert.deepEqual(plain(AlzaCore.getPageRecordInput(page)), { original: 74990, quantityTiers: null, conditions: NEW });
  assert.deepEqual(plain(AlzaCore.getPageRecordInput({ prices: { original: 10 }, packCount: 6, quantityTiers: TIERS, conditions: null })), { original: 10, packCount: 6, quantityTiers: TIERS, conditions: null });
  // Sloučení: nové ceny jiných stavů přepíšou staré, null je smaže, počet kusů bez nové hodnoty zůstane
  const record = AlzaCore.mergePriceRecord({ original: 71241, packCount: 4, quantityTiers: TIERS, conditions: OLD, lastUpdated: 1 }, AlzaCore.getPageRecordInput(page), null, 1000);
  assert.deepEqual(plain(record.conditions), NEW);
  assert.equal(record.quantityTiers, undefined);
  assert.equal(record.packCount, 4);
  assert.equal(record.lastUpdated, 1000);
});

test("ceny jiných stavů: do záznamu jen známé stavy s kladnou cenou včetně aktuálního", () => {
  const { AlzaCore } = loadCore();
  assert.deepEqual(plain(AlzaCore.sanitizeConditions({ current: "new", prices: { new: 100, unpacked: 90, used: "80", evil: 1 }, extra: "<script>" })), { current: "new", prices: { new: 100, unpacked: 90 } });
  [null, "x", { current: "new" }, { current: "other", prices: { new: 1, unpacked: 2 } }, { current: "new", prices: { unpacked: 90 } }, { current: "new", prices: { new: 100 } }, { current: "new", prices: { new: -1, unpacked: 90 } }].forEach((value) =>
    assert.equal(AlzaCore.sanitizeConditions(value), null, JSON.stringify(value))
  );
});

test("store: setPageMeta přepíše cenu jiného stavu v existujícím záznamu, čas ani ceny nemění, zapisuje jen při změně", async () => {
  const { AlzaCore, chrome, context } = loadCore({ storage: { [KEY_TV]: { original: 74990, lastUpdated: 5, packCount: 2, conditions: OLD } }, files: ["src/shared/store.js"] });
  const AlzaStore = context.AlzaStore;
  AlzaStore.isWriter = true;
  const data = chrome.storage.local.data;
  let writes = 0;
  chrome.storage.onChanged.addListener(() => writes++);

  await AlzaStore.run({ type: "setPageMeta", domain: "alza_cz", url: URL_TV, conditions: NEW, quantityTiers: TIERS });
  assert.deepEqual(plain(data[KEY_TV]), { original: 74990, lastUpdated: 5, packCount: 2, conditions: NEW, quantityTiers: TIERS });
  assert.equal(writes, 1);
  // Stejné údaje podruhé – žádný zápis
  await AlzaStore.run({ type: "setPageMeta", domain: "alza_cz", url: URL_TV, conditions: NEW, quantityTiers: TIERS });
  assert.equal(writes, 1);
  // Detail už přepínač stavů ani množstevní slevy nemá → smazat; neplatný tvar se bere jako „nemá“
  await AlzaStore.run({ type: "setPageMeta", domain: "alza_cz", url: URL_TV, conditions: { current: "evil", prices: {} }, quantityTiers: [[1, 2]] });
  assert.deepEqual(plain(data[KEY_TV]), { original: 74990, lastUpdated: 5, packCount: 2 });
  // Produkt bez záznamu ceny (ceny se neukládají) a neznámá doména nic nevytvoří
  await AlzaStore.run({ type: "setPageMeta", domain: "alza_cz", url: "https://www.alza.cz/jiny-d99.htm", conditions: NEW });
  await AlzaStore.run({ type: "setPageMeta", domain: "evil", url: URL_TV, conditions: NEW });
  assert.equal("alzaPrice_alza_cz_99" in data, false);
  assert.equal(data[KEY_TV].conditions, undefined);
  // Volá ji content script na detailu produktu
  assert.equal(AlzaStore.allowsContent({ type: "setPageMeta" }), true);
  assert.equal(AlzaCore.metaKeys.includes("conditions") && AlzaCore.metaKeys.includes("quantityTiers"), true);
  assert.match(read("src/content/product-panel.js"), /type: "setPageMeta",\s+domain: this\.getAlzaDomain\(\),\s+url,\s+conditions: AlzaCore\.getDocumentConditions\(document, window\.location\.href\),\s+quantityTiers: AlzaCore\.getDocumentQuantityTiers\(document\),/);
});

test("kontrola na pozadí: s cenou přepíše v záznamu i cenu jiného stavu – košík pak neukáže starou", async () => {
  const watched = { [URL_TV]: { url: URL_TV, name: "TV", domain: "alza_cz", image: null } };
  const bg = loadBackground({
    storage: {
      alzaSettings: { quietHours: false, watchPurchases: false, ownedItems: false },
      alzaWatchProducts: watched,
      [KEY_TV]: { original: 93320, special: 71241, lastUpdated: 1, packCount: 4, quantityTiers: TIERS, conditions: OLD },
    },
  });
  let page = { ok: true, saveProblem: null, vatSignMissing: false, isProduct: true, name: "TV", image: null, prices: { original: 93320, special: 74990 }, availability: "Skladem", packCount: null, quantityTiers: null, conditions: NEW };
  bg.context.ProductPages.fetch = async () => page;
  Object.assign(bg.get("config"), { delayBetweenProductsMs: 0, fetchRetryDelayMs: 0 });
  bg.chrome.alarms.create = async () => {};
  await bg.ready;

  await bg.context.runWatch({ force: true, trigger: "manual" });
  const record = plain(bg.data[KEY_TV]);
  assert.equal(record.special, 74990);
  assert.deepEqual(record.conditions, NEW, "cena rozbaleného z dnešní stránky, ne 69 056 Kč z dřívějška");
  assert.equal(record.quantityTiers, undefined, "množstevní slevy, které stránka už nemá, zmizí");
  assert.equal(record.packCount, 4, "počet kusů bez nové hodnoty zůstává");
  assert.ok(record.lastUpdated > 1);
  // Košík z takového záznamu: rozbalený za 72 690 Kč, tedy o 2 300 Kč levněji než placených 74 990 Kč
  assert.deepEqual(plain(bg.AlzaCore.getCheaperConditions(record.conditions, 74990)), [{ condition: "unpacked", price: 72690, diff: 2300, percent: 3 }]);

  // Rozbalený kus se prodal – přepínač stavů ze stránky zmizel a ze záznamu také
  page = { ...page, conditions: null };
  await bg.context.runWatch({ force: true, trigger: "manual" });
  assert.equal(bg.data[KEY_TV].conditions, undefined);
  assert.deepEqual(bg.errors, []);
});
