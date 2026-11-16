// Invarianty – hlídají celé třídy chyb, ne jeden případ: přesnost peněz (haléře / centy celými čísly), platná data
// v podmínkách akcí, jediný zapisovatel do úložiště, soukromí diagnostiky, texty notifikací v nápovědě, konce
// řádků v testech a registrace operací úložiště. Generované případy jsou pevné (bez náhody) – výsledek je vždy stejný.
// Spuštění: node --test "tests/*.test.js"
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { loadCore } = require("./load-core");

const ROOT = path.resolve(__dirname, "..");
// Konce řádků sjednotit – pracovní kopie na Windows má CRLF, regexy počítají s LF
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8").replace(/\r\n/g, "\n");
const plain = (value) => JSON.parse(JSON.stringify(value));
const { AlzaCore } = loadCore();

// Soubory .js ve složce (rekurzivně), cesty relativně ke kořeni s lomítky
function listJs(dir) {
  return fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
    const file = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return listJs(file);
    return entry.name.endsWith(".js") ? [file] : [];
  });
}

// Prvních pár neshod do zprávy – tisíce assertů by test zbytečně zdržely
function assertNoMismatch(mismatches, what) {
  assert.equal(mismatches.length, 0, `${what}: ${mismatches.length} neshod, např. ${JSON.stringify(mismatches.slice(0, 5))}`);
}

// === 1. Přesnost peněz: procenta slevy ===

test("invariant: getListingDiscount = celočíselný výpočet v centech (EUR) a nikdy víc než skutečná sleva", () => {
  const mismatches = [];
  let cases = 0;
  for (let ref = 1; ref <= 20000; ref += 37) {
    const prices = new Set([1, ref - 1, Math.floor(ref * 0.5), Math.floor(ref * 0.7), Math.floor(ref * 0.8), Math.floor(ref * 0.9), ref - 13, ref - 101]);
    for (const price of prices) {
      if (!(price >= 1 && price < ref)) continue;
      cases++;
      const oracle = Math.floor(((ref - price) * 100) / ref); // Celá čísla – přesně
      const actual = AlzaCore.getListingDiscount({ original: ref / 100, special: price / 100 }).percent;
      if (actual !== oracle || actual * ref > (ref - price) * 100) mismatches.push({ ref, price, oracle, actual });
    }
  }
  assert.ok(cases > 3000);
  assertNoMismatch(mismatches, "EUR");
});

test("invariant: getListingDiscount v celých korunách (CZK) přesně", () => {
  const mismatches = [];
  for (let ref = 2; ref <= 200000; ref += 997) {
    for (const price of new Set([1, ref - 1, Math.floor(ref * 0.75), Math.floor(ref * 0.8), Math.floor(ref / 3)])) {
      if (!(price >= 1 && price < ref)) continue;
      const oracle = Math.floor(((ref - price) * 100) / ref);
      const actual = AlzaCore.getListingDiscount({ original: ref, special: price }).percent;
      if (actual !== oracle) mismatches.push({ ref, price, oracle, actual });
    }
  }
  assertNoMismatch(mismatches, "CZK");
  assert.equal(AlzaCore.getListingDiscount({ original: 500, special: 500 }).percent, 0);
});

// === 2. Přesnost peněz: úspora za množstevní slevu ===

test("invariant: getNextQuantityTier.saving = přesný výpočet v centech, nejvýš 2 desetinná místa", () => {
  const mismatches = [];
  for (let current = 2; current <= 5000; current += 7) {
    for (const unit of new Set([1, current - 1, Math.floor(current * 0.9), Math.floor(current * 0.67)])) {
      if (!(unit >= 1 && unit < current)) continue;
      for (const from of [2, 3, 4, 5]) {
        for (const quantity of [from - 1, from - 2]) {
          if (quantity < 1) continue;
          const tiers = [[1, from - 1, current / 100], [from, 9999, unit / 100]];
          const result = AlzaCore.getNextQuantityTier(tiers, current / 100, quantity);
          const expected = ((current - unit) * from) / 100;
          const saving = result?.saving;
          if (saving !== expected || !/^\d+(?:\.\d{1,2})?$/.test(String(saving))) mismatches.push({ current, unit, from, quantity, saving, expected });
        }
      }
    }
  }
  assertNoMismatch(mismatches, "úspora");
});

// === 3. Data v podmínkách akcí ===

const daysInMonth = (year, month) => [31, year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];

test("invariant: findTermDates vrací jen skutečné datum ze zadaného textu (D. M. YYYY i maďarské YYYY. MM. DD.)", () => {
  const ref = Date.UTC(2026, 10, 10);
  const mismatches = [];
  for (const year of [2026, 2027, 2028]) {
    for (let month = 1; month <= 12; month++) {
      for (let day = 1; day <= 31; day++) {
        const valid = day <= daysInMonth(year, month);
        const pad = (value) => String(value).padStart(2, "0");
        for (const [text, lang] of [[`do ${day}. ${month}. ${year}`, null], [`${year}. ${pad(month)}. ${pad(day)}.`, "hu"]]) {
          const found = plain(AlzaCore.findTermDates(text, ref, lang)).map(({ time }) => {
            const date = new Date(time);
            return [date.getFullYear(), date.getMonth() + 1, date.getDate()];
          });
          const expected = valid ? [[year, month, day]] : [];
          if (JSON.stringify(found) !== JSON.stringify(expected)) mismatches.push({ text, lang, found, expected });
        }
      }
    }
  }
  assertNoMismatch(mismatches, "data");
});

// === 4. Jediný zapisovatel do úložiště ===

// Skripty mimo službu na pozadí: zapisují jen přes AlzaStore.run (zprávou do fronty služby na pozadí)
const NON_WRITER_FILES = [
  ...listJs("src/popup"),
  ...listJs("src/options"),
  ...listJs("src/content"),
  ...listJs("src/welcome"),
  "src/content.js",
  "src/category.js",
  "src/browsing.js",
  "src/listing-memory.js",
  "src/purchases.js",
].filter((file) => fs.existsSync(path.join(ROOT, file)));
// Výjimky (soubor → důvod). Nová výjimka musí přibýt sem vědomě
const DIRECT_WRITE_EXCEPTIONS = {};

test("invariant: popup, nastavení a content scripty nezapisují do chrome.storage.local přímo", () => {
  const offenders = [];
  NON_WRITER_FILES.forEach((file) => {
    const source = read(file);
    const patterns = [
      /\bstorage\.local\.(?:set|remove|clear)\s*\(/g, // přímý zápis
      /=\s*(?:chrome|browser)\.storage\.local\s*[;,)\n]/g, // úložiště do proměnné (obejití kontroly)
      /\{[^{}]*\blocal\b[^{}]*\}\s*=\s*(?:chrome|browser)\.storage\b/g, // const { local } = chrome.storage
      /\bAlzaStore\.(?:ops|apply)\b/g, // operace mimo frontu
    ];
    patterns.forEach((pattern) =>
      [...source.matchAll(pattern)].forEach((match) => {
        const line = source.slice(0, match.index).split("\n").length;
        if (!DIRECT_WRITE_EXCEPTIONS[`${file}:${line}`]) offenders.push(`${file}:${line} ${match[0].trim()}`);
      })
    );
  });
  assert.ok(NON_WRITER_FILES.length > 15, "seznam souborů se načetl");
  assert.deepEqual(offenders, []);
});

// === 5. Soukromí diagnostiky ===

// Zboží hlídané jen kvůli nákupu ve tvaru, v jakém ho zapisuje background.js (přehled změn, odložené notifikace,
// deník běhu = { ...produkt z getWatchedProducts, name, image, price, changes })
const SECRET = { name: "Tajný robot Z9", url: "https://www.alza.cz/tajny-robot-z9-d4242.htm", key: "alza_cz_4242" };
const SECRET_TEXTS = [SECRET.name, SECRET.url, SECRET.key, "d4242", "robot.jpg"];
function journalEntry({ withPurchase }) {
  const { name, url } = SECRET;
  return {
    url,
    name,
    image: "https://image.alza.cz/robot.jpg",
    domain: "alza_cz",
    lang: "cz",
    textLang: "cz",
    listUrl: "https://www.alza.cz/my-account/orders.htm",
    listName: "Objednávky",
    listId: null,
    ...(withPurchase && { purchase: { url, domain: "alza_cz", name, image: "https://image.alza.cz/robot.jpg", price: 900, count: 1, boughtAt: 1, returnUntil: 2 } }),
    purchaseOnly: true,
    price: 800,
    changes: [{ kind: "purchase", text: "Koupili jste za 900 Kč, teď stojí 800 Kč. Vrátit a koupit znovu ho můžete nejméně do 20. 11." }],
  };
}

test("invariant: diagnostika neobsahuje název, adresu ani klíč zboží hlídaného jen kvůli nákupu", () => {
  const { context } = loadCore({ files: ["src/options/options-backup.js"] });
  const { name, url, key } = SECRET;
  const other = { name: "Hlídaný kabel", url: "https://www.alza.cz/kabel-d222.htm", domain: "alza_cz", lines: ["zlevnění"] };
  const flagged = {
    recent: { key, at: 5, name, url, image: "https://image.alza.cz/robot.jpg", lines: [`${name} zlevnil`], purchaseOnly: true },
    pendingNotifications: { name, url, domain: "alza_cz", lang: "cz", lines: [`Koupili jste ${name} za 900 Kč`], purchaseOnly: true },
    journal: journalEntry({ withPurchase: false }),
  };
  const logs = {
    empty: [],
    flagged: [{ start: 1, end: 2, total: 2, items: [{ name, url, lines: [`${name} zlevnil`], problem: null, purchaseOnly: true }, other], lists: [{ name: "Moje objednávky", orders: true, added: [name], addedCount: 1 }] }],
    others: [{ start: 1, end: 2, total: 1, items: [other] }],
  };
  const fields = Object.keys(flagged);
  let cases = 0;
  for (const [logName, watchLog] of Object.entries(logs)) {
    // Každá neprázdná podmnožina polí stavu, ve kterých je položka s příznakem
    for (let mask = 1; mask < 1 << fields.length; mask++) {
      const watchState = { running: false, lastRunEnd: 2, unseen: [key, "alza_cz_222"], changes: [{ name, url: `${url}?x=1`, lines: ["zlevnění"] }, other], problems: [{ name, url, message: `Stránku ${url} se nepodařilo načíst` }] };
      fields.forEach((field, i) => {
        watchState[field] = [...(mask & (1 << i) ? [flagged[field]] : []), other];
      });
      const text = JSON.stringify(plain(context.OptionsData.redactDiagnostics({ watchLog: structuredClone(watchLog), watchState, errors: [] })));
      for (const secret of SECRET_TEXTS) {
        assert.ok(!text.includes(secret), `log ${logName}, pole ${fields.filter((_, i) => mask & (1 << i)).join("+")}: zůstalo „${secret}“`);
      }
      assert.ok(text.includes("Hlídaný kabel"), "ostatní produkty zůstávají");
      cases++;
    }
  }
  assert.equal(cases, 21);
});

// Deník běhu (journal) nese celý produkt z getWatchedProducts včetně vnořeného záznamu nákupu (purchase: { name, url,
// image… }) – redactDiagnostics ho musí vyčistit do hloubky (chyba nalezená tímto testem, opraveno 2026.11.12.16)
test(
  "invariant: diagnostika – vnořený záznam nákupu v deníku běhu (journal[].purchase)",
  () => {
    const { context } = loadCore({ files: ["src/options/options-backup.js"] });
    const watchState = { running: true, journal: [journalEntry({ withPurchase: true })], unseen: [] };
    const text = JSON.stringify(plain(context.OptionsData.redactDiagnostics({ watchLog: [], watchState, errors: [] })));
    for (const secret of SECRET_TEXTS) assert.ok(!text.includes(secret), `zůstalo „${secret}“`);
  }
);

// === 6. Texty notifikací v nápovědě ===

test("invariant: nápověda cituje notifikaci o zlevnění po nákupu přesně (všechny jazyky)", () => {
  const pages = { cz: "src/help/help.html", sk: "src/help/help-sk.html", hu: "src/help/help-hu.html", en: "src/help/help-en.html" };
  const squash = (text) => text.replace(/\s+/g, " ");
  for (const [lang, file] of Object.entries(pages)) {
    const sentence = AlzaCore.translate(lang, "notifyPurchaseDrop", "X", "Y", "D");
    assert.notEqual(sentence, "notifyPurchaseDrop", `${lang}: překlad chybí`);
    assert.ok(squash(read(file)).includes(squash(sentence)), `${file} necituje aktuální text: „${sentence}“`);
  }
});

// === 7. Konce řádků v testech ===

// Regulární výrazy v kódu testu (literály) a řetězce předávané do new RegExp
const regexLiterals = (source) =>
  [...source.matchAll(/(?<=[(,=:[!&|?{};]\s*|^\s*|return\s+)\/((?:[^/\\\n[]|\\.|\[(?:[^\]\\\n]|\\.)*\])+)\/[dgimsuy]*/gm)].map((match) => match[1]);
// Čte soubory a nesjednocuje konce řádků, a přitom hledá \n – na CRLF pracovní kopii selže
function crlfProblems(source) {
  if (!/readFileSync\(/.test(source)) return [];
  if (/\\r\\n|\\r\?\\n|\\r\*\\n/.test(source)) return []; // replace(/\r\n/g, "\n"), split(/\r?\n/)…
  return [
    ...regexLiterals(source).filter((regex) => /(?<!\\r\??)\\n/.test(regex)).map((regex) => `/${regex}/`),
    ...[...source.matchAll(/new RegExp\(([^;]*)/g)].filter((match) => /\\\\n/.test(match[1])).map((match) => `new RegExp(${match[1].slice(0, 40)}…`),
    ...[...source.matchAll(/\.split\(\s*(["'`])\\n\1\s*\)/g)].map((match) => match[0]),
  ];
}

test("invariant: testy, které čtou soubory, sjednocují CRLF, nebo v regexech nehledají \\n", () => {
  // Kontrola sama funguje: chybný vzor najde, sjednocený soubor pustí
  const bad = 'const s = fs.readFileSync(f, "utf8");\nassert.match(s, /a\\n\\}/);\n';
  assert.equal(crlfProblems(bad).length, 1);
  assert.deepEqual(crlfProblems(bad.replace('"utf8")', '"utf8").replace(/\\r\\n/g, "\\n")')), []);
  assert.deepEqual(crlfProblems('fs.readFileSync(f, "utf8");\nassert.match(s, /a\\r?\\nb/);\n'), []);

  const files = fs.readdirSync(__dirname).filter((file) => file.endsWith(".test.js"));
  assert.ok(files.includes("invariants.test.js"));
  const problems = files.flatMap((file) => crlfProblems(fs.readFileSync(path.join(__dirname, file), "utf8").replace(/\r\n/g, "\n")).map((problem) => `${file}: ${problem}`));
  assert.deepEqual(problems, []);
});

// === 8. Operace úložiště ===

test("invariant: každá operace v AlzaStore.run existuje v AlzaStore.ops a každá operace se někde používá", () => {
  const { context } = loadCore({ files: ["src/shared/store.js"] });
  const ops = Object.keys(context.AlzaStore.ops);
  assert.ok(ops.includes("patchMap") && ops.includes("removeStaleProducts"));
  const sources = listJs("src")
    .filter((file) => file !== "src/shared/store.js")
    .map((file) => [file, read(file)]);
  // Volání s literálem (i víceřádkovým) a operace sestavené předem do proměnné ({ type: "patchMap", key: … })
  const called = sources.flatMap(([file, source]) =>
    [...source.matchAll(/(?:globalThis\.)?AlzaStore\.run\(\s*\{\s*type:\s*"(\w+)"/g)].map((match) => ({ file, type: match[1] }))
  );
  assert.ok(called.length > 30, "volání se našla");
  const unknown = called.filter(({ type }) => !ops.includes(type)).map(({ file, type }) => `${file}: ${type}`);
  assert.deepEqual(unknown, [], "neznámá operace by spadla až za běhu");
  const mentioned = new Set(sources.flatMap(([, source]) => [...source.matchAll(/\btype:\s*"(\w+)"/g)].map((match) => match[1])));
  const unused = ops.filter((op) => !mentioned.has(op));
  assert.deepEqual(unused, [], "operace, kterou nikdo nevolá");
});
