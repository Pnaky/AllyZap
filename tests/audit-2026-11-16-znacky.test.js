// Audit 2026-11-16 č. 11, zbytek: značka dlaždice podle seznamu značek, který výpis Alzy nabízí ve filtru „Značka“
// (#producers .parameterValue.producer[title] – čte ho listing-memory.js). Dlaždice sama údaj o výrobci nemá.
// Seznamy značek v testech jsou opsané z živých výpisů alza.cz (2026-11-16).
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadCore } = require("./load-core");

const { AlzaCore, context } = loadCore({ files: ["src/options/options-backup.js"] });
const plain = (value) => JSON.parse(JSON.stringify(value));
const brand = (name, producers) => AlzaCore.getBrandFromName(name, producers)?.key ?? null;

const GLASS = ["AlzaGuard", "Mobile Origin", "Spigen", "PanzerGlass", "Tempered Glass Protector", "3MK", "Apple", "Samsung"];
const TV = ["Samsung", "LG", "TCL", "HISENSE", "Philips", "SONY"];
const NEW = ["L'Oréal Paris", "MAYBELLINE NEW YORK", "New Baby", "New Era", "NEW GEL+"];

test("značka z filtru výpisu: název začínající obecným slovem dostane skutečnou značku", () => {
  assert.equal(brand("Tvrzené sklo AlzaGuard 2.5D pro Apple iPhone 16", GLASS), "alzaguard");
  assert.equal(brand("AlzaGuard 2.5D Case Friendly Glass pro iPhone 13 / 13 Pro", GLASS), "alzaguard");
  // Bez seznamu značek zůstává odhad ze začátku názvu
  assert.equal(brand("Tvrzené sklo AlzaGuard 2.5D pro Apple iPhone 16"), "tvrzené");
});

test("značka z filtru výpisu: víceslovné značky celé, delší shoda má přednost", () => {
  assert.deepEqual(plain(AlzaCore.getBrandFromName("Mobile Origin Screen Guard iPhone 15", GLASS)), { key: "mobile origin", name: "Mobile Origin" });
  assert.equal(brand("Tempered Glass Protector 3D pro Samsung Galaxy S24", GLASS), "tempered glass protector");
  assert.equal(brand("New Baby Polar 2v1 růžová", NEW), "new baby");
  assert.equal(brand("New Era 9FORTY NY Yankees", NEW), "new era");
  assert.equal(brand("MAYBELLINE NEW YORK Lash Sensational", NEW), "maybelline new york");
  assert.equal(brand("New Balance 574", [...NEW, "New", "New Balance"]), "new balance");
});

test("značka z filtru výpisu: značka zařízení za „pro / na / for“ není výrobce", () => {
  assert.equal(brand("Ochranné sklo pro Apple iPhone 15 Spigen Glas.tR", GLASS), "spigen");
  assert.equal(brand("Kryt na Samsung Galaxy S24 3MK Clear Case", GLASS), "3mk");
  assert.equal(brand("Case for Apple iPhone 15 PanzerGlass HardCase", GLASS), "panzerglass");
  // Značka na začátku platí, i když je v názvu ještě jiná
  assert.equal(brand("Apple iPhone 15 Silicone Case", GLASS), "apple");
});

test("značka z filtru výpisu: televize a monitory, velikost písmen podle Alzy", () => {
  assert.equal(brand('65" Samsung QE65S90H', TV), "samsung");
  assert.deepEqual(plain(AlzaCore.getBrandFromName('55" Hisense 55E7Q PRO', TV)), { key: "hisense", name: "HISENSE" });
  assert.equal(brand('77" LG OLED77C64LA', TV), "lg");
});

test("značka z filtru výpisu: jen celé slovo; výpis se značkami a název bez žádné z nich = žádná značka", () => {
  assert.equal(brand("Belgie LGX průvodce", ["LG"]), null);
  assert.equal(brand("Harry Potter Interaktivní sova Hedvika", ["LEGO", "Spin Master"]), null, "první slovo názvu není značka");
  assert.equal(brand("LEGO® Technic 42100", ["LEGO"]), "lego");
  assert.equal(brand("", GLASS), null);
  // Stránka bez filtru značek: odhad ze začátku názvu jako dřív
  assert.equal(brand("Xiaomi Redmi Note 14", []), "xiaomi");
  assert.equal(brand("Xiaomi Redmi Note 14"), "xiaomi");
  // Značka skrytá dřív podle začátku názvu platí i tam, kde ji výpis ve filtru nemá
  assert.equal(AlzaCore.isHiddenListing({}, { harry: { name: "Harry", at: 1 } }, "k", "Harry Potter Interaktivní sova", ["LEGO"]), "brand");
});

test("skrytá značka: podle filtru výpisu skryje i název začínající obecným slovem, cizí značku za „pro“ ne", () => {
  const brands = { alzaguard: { name: "AlzaGuard", at: 1 }, apple: { name: "Apple", at: 1 } };
  const hidden = (name, producers) => AlzaCore.isHiddenListing({}, brands, "alza_cz_1", name, producers);
  assert.equal(hidden("Tvrzené sklo AlzaGuard 2.5D pro Samsung Galaxy S24", GLASS), "brand");
  assert.equal(hidden("Spigen Glas.tR pro Apple iPhone 15", GLASS), null, "Spigen není Apple");
  assert.equal(hidden("Apple iPhone 15 128GB", GLASS), "brand");
  assert.deepEqual(plain(AlzaCore.getHiddenBrand(brands, "Tvrzené sklo AlzaGuard 2.5D", GLASS)), { key: "alzaguard", name: "AlzaGuard" });
  // Stránka bez filtru značek: platí odhad ze začátku názvu
  assert.equal(hidden("AlzaGuard 2.5D Glass pro iPhone 16"), "brand");
});

test("skrytá značka: odhad ze začátku názvu neplatí, když filtr výpisu zná jinou značku; starý klíč platí dál", () => {
  const name = "New Baby Polar 2v1";
  // Uloženo po staru (první slovo) – skrývá dál, co skrývalo
  assert.equal(AlzaCore.isHiddenListing({}, { new: { name: "New", at: 1 } }, "k", name, NEW), "brand");
  // „new baby“ skryje jen New Baby, ne New Era
  const brands = { "new baby": { name: "New Baby", at: 1 } };
  assert.equal(AlzaCore.isHiddenListing({}, brands, "k", name, NEW), "brand");
  assert.equal(AlzaCore.isHiddenListing({}, brands, "k", "New Era 9FORTY", NEW), null);
});

test("import zálohy: skrytá víceslovná značka si klíč zachová", () => {
  const data = context.OptionsData;
  const now = Date.UTC(2026, 10, 16);
  const result = plain(data.sanitizeHiddenBrands({ a: { name: "Mobile  Origin", at: now - 1000 }, b: { name: "New", at: now - 1000 }, c: { name: "12345" }, d: { name: "x".repeat(200) }, e: null }, now));
  assert.deepEqual(Object.keys(result).sort(), ["mobile origin", "new"]);
  assert.equal(result["mobile origin"].name, "Mobile Origin");
});
