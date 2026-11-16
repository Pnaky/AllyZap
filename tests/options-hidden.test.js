// Záložka „Skryté ve výpisech“ (src/options/options-hidden.js): přehled skrytých značek a produktů s tlačítkem
// Znovu ukazovat. Skript běží nad náhradou stránky – prvky jsou prosté objekty, tabulka si pamatuje řádky a buňky,
// AlzaStore.run zapisuje do úložiště v paměti (jeho změna tabulku překreslí jako v prohlížeči). sortItems a
// nameFromUrl jsou skutečné funkce z options.js.
// Spuštění: node --test "tests/*.test.js"
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { loadCore } = require("./load-core");

const ROOT = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8").replace(/\r\n/g, "\n");
const DAY = 86400e3;
const now = Date.UTC(2026, 10, 16, 12);
const day = (daysAgo) => new Date(now - daysAgo * DAY).toISOString().slice(0, 10);

async function loadHiddenPage(storage = {}) {
  const { chrome, context } = loadCore({ storage });
  const elements = {};
  const element = (id) =>
    (elements[id] ??= {
      id,
      hidden: false,
      textContent: "",
      table: null,
      replaceChildren(table) {
        this.table = table;
      },
    });
  const page = { elements, errors: [], counts: {}, runs: [], data: chrome.storage.local.data };
  const options = read("src/options/options.js");
  const source = (name) => options.match(new RegExp(`\\nfunction ${name}\\([\\s\\S]*?\\n\\}\\n`))[0];
  Object.assign(context, {
    document: { getElementById: element },
    ui: { lang: "cz", locale: "cs-CZ" },
    t: (key, ...params) => [key, ...params].join("|"),
    formatDate: (time) => new Date(time).toISOString().slice(0, 10),
    setTabCount: (id, count) => (page.counts[id] = count),
    showActionError: (error) => page.errors.push(error),
    cell: (row, content) => row.cells.push(content),
    productLink: (url, name) => ({ link: url, name }),
    smallButton: (text, title, onClick) => ({
      text,
      title,
      onClick,
      attributes: {},
      setAttribute(name, value) {
        this.attributes[name] = value;
      },
    }),
    createSortableTable: (columns, view) => {
      const table = { columns, view, rows: [] };
      table.createTBody = () => ({
        insertRow: () => {
          const row = { cells: [] };
          table.rows.push(row);
          return row;
        },
      });
      return table;
    },
    AlzaIcons: { prepend: (node, icon) => Object.assign(node, { icon }) },
    AlzaStore: {
      run: async ({ type, key, remove }) => {
        page.runs.push({ type, key, remove: [...remove] });
        const map = { ...page.data[key] };
        remove.forEach((id) => delete map[id]);
        await chrome.storage.local.set({ [key]: map });
      },
    },
  });
  vm.runInContext(`${source("sortItems")}${source("nameFromUrl")}`, context, { filename: "src/options/options.js" });
  vm.runInContext(read("src/options/options-hidden.js"), context, { filename: "src/options/options-hidden.js" });
  page.tick = () => new Promise((resolve) => setTimeout(resolve, 0));
  await page.tick();
  page.rows = (id) => elements[id].table.rows.map((row) => row.cells);
  return page;
}

const STORED = {
  alzaHidden: {
    alza_sk_13: { url: "https://www.alza.sk/xiaomi-redmi-note-14-d13.htm", domain: "alza_sk", name: null, at: now - 20 * DAY },
    alza_cz_11: { url: "https://www.alza.cz/hisense-65e7q-d11.htm", domain: "alza_cz", name: '65" Hisense 65E7Q PRO', at: now - 2 * DAY },
    alza_cz_12: { at: now - 9 * DAY }, // bez adresy a názvu – skrývá už sám klíč, proto se ukáže a jde vrátit
    broken: "x",
  },
  alzaHiddenBrands: { tcl: { name: "TCL", at: now - 15 * DAY }, "new baby": { name: "New Baby", at: now - 3 * DAY }, bad: null },
};

test("skryté ve výpisech: značky a produkty s počty, nejnověji skryté nahoře", async () => {
  const page = await loadHiddenPage(STORED);
  assert.deepEqual(page.errors, []);
  assert.equal(page.counts.countHidden, 5);
  assert.equal(page.elements.hiddenEmpty.hidden, true);
  assert.equal(page.elements.hiddenBrands.hidden, false);
  assert.equal(page.elements.hiddenProducts.hidden, false);
  assert.equal(page.elements.hiddenBrandsTitle.textContent, "hiddenBrandsTitle|2");
  assert.equal(page.elements.hiddenProductsTitle.textContent, "hiddenProductsTitle|3");

  const brands = page.rows("hiddenBrandsTable");
  assert.deepEqual(brands.map(([name, date]) => [name, date]), [["New Baby", day(3)], ["TCL", day(15)]]);
  const button = brands[0][2];
  assert.equal(button.text, "hiddenShow");
  assert.equal(button.title, "hiddenShowTitle|New Baby");
  assert.equal(button.attributes["aria-label"], "hiddenShowTitle|New Baby", "přístupný název říká, čeho se tlačítko týká");
  assert.equal(button.icon, "visibility");

  const products = page.rows("hiddenProductsTable");
  assert.deepEqual(products.map(([name, site, date]) => [name, site, date]), [
    [{ link: "https://www.alza.cz/hisense-65e7q-d11.htm", name: '65" Hisense 65E7Q PRO' }, "alza.cz", day(2)],
    ["alza_cz_12", "–", day(9)],
    [{ link: "https://www.alza.sk/xiaomi-redmi-note-14-d13.htm", name: "Xiaomi redmi note 14" }, "alza.sk", day(20)],
  ]);
});

test("skryté ve výpisech: Znovu ukazovat smaže jen ten záznam a tabulka se překreslí", async () => {
  const page = await loadHiddenPage(STORED);
  await page.rows("hiddenBrandsTable")[0][2].onClick();
  await page.tick();
  await page.rows("hiddenProductsTable")[0][3].onClick();
  await page.tick();
  assert.deepEqual(page.runs, [
    { type: "patchMap", key: "alzaHiddenBrands", remove: ["new baby"] },
    { type: "patchMap", key: "alzaHidden", remove: ["alza_cz_11"] },
  ]);
  assert.deepEqual(page.errors, []);
  assert.equal(page.counts.countHidden, 3);
  assert.deepEqual(page.rows("hiddenBrandsTable").map(([name]) => name), ["TCL"]);
  assert.equal(page.rows("hiddenProductsTable").length, 2);
  assert.equal(page.elements.hiddenProductsTitle.textContent, "hiddenProductsTitle|2");
});

test("skryté ve výpisech: nic skrytého = jen vysvětlení; prázdná skupina se schová", async () => {
  const empty = await loadHiddenPage();
  assert.equal(empty.counts.countHidden, 0);
  assert.equal(empty.elements.hiddenEmpty.hidden, false);
  assert.equal(empty.elements.hiddenBrands.hidden, true);
  assert.equal(empty.elements.hiddenProducts.hidden, true);

  const onlyBrand = await loadHiddenPage({ alzaHiddenBrands: { tcl: { name: "TCL", at: now } } });
  assert.equal(onlyBrand.counts.countHidden, 1);
  assert.equal(onlyBrand.elements.hiddenEmpty.hidden, true);
  assert.equal(onlyBrand.elements.hiddenBrands.hidden, false);
  assert.equal(onlyBrand.elements.hiddenProducts.hidden, true);
});

test("skryté ve výpisech: záložka je na stránce, skript se načítá za options.js a jazyk ji překreslí", () => {
  const html = read("src/options/options.html");
  const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map(([, src]) => src);
  assert.ok(scripts.indexOf("options-hidden.js") > scripts.indexOf("options.js"), "za options.js");
  ["countHidden", "hiddenEmpty", "hiddenBrands", "hiddenBrandsTitle", "hiddenBrandsTable", "hiddenProducts", "hiddenProductsTitle", "hiddenProductsTable"].forEach((id) =>
    assert.ok(html.includes(`id="${id}"`), `#${id}`)
  );
  assert.match(read("src/options/options.js"), /if \(typeof renderHidden === "function"\) renderHidden\(\)\.catch\(logError\);/);
});
