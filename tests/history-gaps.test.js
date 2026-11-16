// Díra ve sledování v grafu a tabulce historie: doba, kdy cenu nikdo neviděl (déle než priceGapDays po posledním
// potvrzení), se kreslí jako pás „nesledováno“ a čára přes ni nevede. Kde díry jsou, určuje AlzaCore.getHistoryGaps
// (staví na getEntryEnd); vykreslení (src/content/history-chart.js) se zkouší v prohlížeči.
// Spuštění: node --test "tests/*.test.js"
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { loadCore } = require("./load-core");

const ROOT = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");
const { AlzaCore } = loadCore();
const DAY = 86400e3;
const GAP = AlzaCore.priceGapDays * DAY;
const start = Date.UTC(2026, 3, 1);
const plain = (value) => JSON.parse(JSON.stringify(value));

test("díry ve sledování: od konce známé ceny do dalšího záznamu, navazující záznamy díru nemají", () => {
  const entries = [
    { t: start, s: start + 50 * DAY, p: { original: 100 }, a: "in" },
    { t: start + 50 * DAY, s: start + 88 * DAY, p: { original: 90 }, a: "in" }, // navazuje na první
    { t: start + 170 * DAY, s: start + 190 * DAY, p: { original: 95 }, a: "in" }, // 82 dní nikdo nic neviděl
    { t: start + 191 * DAY, s: start + 200 * DAY, p: { original: 95 }, a: "order" }, // do priceGapDays = bez díry
  ];
  assert.deepEqual(plain(AlzaCore.getHistoryGaps(entries)), [{ index: 1, from: start + 88 * DAY + GAP, to: start + 170 * DAY }]);
  assert.deepEqual(plain(AlzaCore.getHistoryGaps(entries.slice(0, 2))), [], "poslední záznam díru za sebou nemá");
  assert.deepEqual(plain(AlzaCore.getHistoryGaps([])), []);
});

test("díry ve sledování: stejná cena viděná po dlouhé pauze je nový záznam a mezi nimi díra", () => {
  const now = start + 150 * DAY;
  const entries = [{ t: start, s: start, p: { original: 1000 }, a: "in" }];
  AlzaCore.appendHistory(entries, { original: 1000 }, "in", null, { now });
  assert.equal(entries.length, 2);
  assert.deepEqual(plain(AlzaCore.getHistoryGaps(entries)), [{ index: 0, from: start + GAP, to: now }]);
});

test("graf a tabulka historie: díry bere z AlzaCore, čára končí koncem známé ceny", () => {
  const chart = read("src/content/history-chart.js");
  assert.equal(chart.split("AlzaCore.getHistoryGaps(entries)").length - 1, 2, "graf i tabulka");
  assert.doesNotMatch(chart, /next \? next\.t : entry\.s/, "čára už nevede do dalšího záznamu přes díru");
  assert.match(chart, /const end = AlzaCore\.getEntryEnd\(entries, i\);\s+path\.push\(`M\$\{x\(entry\.t\)\},\$\{y\(v\)\}H\$\{x\(end\)\}`\);/);
  ["historyGapLabel", "historyGapTooltip", "historyGapRow"].forEach((key) => assert.ok(chart.includes(`this.translate("${key}"`), key));
  const css = read("css/main.css");
  [...new Set(chart.match(/alza-price-tracker-history-gap[\w-]*/g))].forEach((name) => assert.ok(css.includes(`.${name}`), `styl .${name}`));
});
