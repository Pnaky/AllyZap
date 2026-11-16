// Audit 2026-11-16, stránka rozšíření a texty: co je v záloze a co smaže „Smazat všechna data“ (č. 5), začernění
// diagnostiky a hlášení chyby (č. 9), novinky chystaného vydání (č. 22), nápověda a šablona chyby (č. 23), bublina
// nápovědy „?“ (č. 25), měsíční rozpočet, překreslení po změně jazyka, pořadí tabulátoru, zbytky starého názvu.
// Spuštění: node --test "tests/*.test.js"
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { loadCore } = require("./load-core");

const ROOT = path.resolve(__dirname, "..");
const LANGUAGES = ["cz", "sk", "hu", "en"];
// Konce řádků sjednotit – pracovní kopie na Windows (core.autocrlf) má CRLF, regexy počítají s LF
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8").replace(/\r\n/g, "\n");
const html = read("src/options/options.html");
const script = read("src/options/options.js");
// Objekty z izolovaného kontextu mají jiný prototyp – porovnávat jako prostá data
const plain = (value) => JSON.parse(JSON.stringify(value));

const textsContext = vm.createContext({});
vm.runInContext(read("src/options/options-texts.js"), textsContext);
vm.runInContext(read("src/welcome/welcome-texts.js"), textsContext);
const OPTIONS = vm.runInContext("OPTIONS_TEXTS", textsContext);
const NEWS = vm.runInContext("RELEASE_NEWS", textsContext);

function loadOptionsData() {
  const { AlzaCore, context } = loadCore({ files: ["src/options/options-backup.js"] });
  return { AlzaCore, data: context.OptionsData };
}

// Tělo funkce nejvyšší úrovně z options.js (končí „}“ na začátku řádku)
const functionBody = (name) => script.match(new RegExp(`(?:async )?function ${name}\\([^)]*\\) \\{([\\s\\S]*?)\\n\\}\\n`))[1];

// === č. 5: texty u zálohy a mazání odpovídají tomu, co se zálohuje a maže ===

// Slova, kterými každý jazyk jmenuje poukazy, poznámky, skryté produkty a značky a výzvu zálohu neposílat
const BACKUP_WORDS = {
  cz: { vouchers: /poukaz/i, notes: /poznámk/i, hidden: /skryté produkty a značky/i, keepPrivate: /nikomu (ji )?neposílejte/i, gift: /dárkový poukaz je jako hotovost/i },
  sk: { vouchers: /poukaz/i, notes: /poznámk/i, hidden: /skryté produkty a značky/i, keepPrivate: /nikomu (ju )?neposielajte/i, gift: /darčekový poukaz je ako hotovosť/i },
  hu: { vouchers: /kupon/i, notes: /megjegyzés/i, hidden: /elrejtett termékeket és márkákat/i, keepPrivate: /ne küldje el senkinek/i, gift: /ajándékutalvány olyan, mint a készpénz/i },
  en: { vouchers: /voucher/i, notes: /notes/i, hidden: /hidden products and brands/i, keepPrivate: /don't send .* to anyone/i, gift: /gift voucher is like cash/i },
};

test("č. 5 – záloha obsahuje poukazy, poznámky a skryté produkty a značky; mazání je maže také", () => {
  const { AlzaCore, data } = loadOptionsData();
  const keys = AlzaCore.storageKeys;
  // Pravda, kterou texty popisují
  [keys.vouchers, keys.notes, keys.hidden, keys.hiddenBrands].forEach((key) => {
    assert.ok(data.BACKUP_KEYS.includes(key), `${key} je v záloze`);
    assert.ok(data.WIPE_KEYS.includes(key), `${key} se smaže`);
  });
  [keys.codes, keys.purchases, keys.owned].forEach((key) => {
    assert.ok(Object.hasOwn(data.NOT_BACKED_UP, key), `${key} v záloze není`);
    assert.ok(data.WIPE_KEYS.includes(key), `${key} se smaže`);
  });
  assert.ok(data.KEPT_ON_WIPE.includes(keys.settings), "nastavení zůstane");
});

test("č. 5 – texty u zálohy a mazání jmenují poukazy s kódy, poznámky a skryté produkty a značky (4 jazyky)", () => {
  LANGUAGES.forEach((lang) => {
    const words = BACKUP_WORDS[lang];
    const { backupNote, wipeNote } = OPTIONS[lang];
    ["vouchers", "notes", "hidden", "keepPrivate", "gift"].forEach((topic) => assert.match(backupNote, words[topic], `${lang}.backupNote – ${topic}`));
    ["vouchers", "notes", "hidden", "keepPrivate"].forEach((topic) => assert.match(wipeNote, words[topic], `${lang}.wipeNote – ${topic}`));
    // Bez tvrdých slov
    [backupNote, wipeNote].forEach((text) => assert.doesNotMatch(text, /falešn|falošn|vymyšlen|vymyslen|fake|hamis|kamu/i, lang));
  });
  // Původní tvrzení „nákupy a slevové kódy ne“ bez upřesnění by znělo, jako by v záloze nebyly žádné kódy
  assert.doesNotMatch(OPTIONS.cz.backupNote, /nákupy a slevové kódy ne \(/);
  assert.match(OPTIONS.cz.backupNote, /slevové kódy u produktů v záloze nejsou/);
  assert.match(OPTIONS.cz.wipeNote, /slevové kódy u produktů v záloze nejsou/);
});

test("č. 5 a 23 – nápověda popisuje zálohu a mazání stejně (4 jazyky)", () => {
  const pages = { cz: "src/help/help.html", sk: "src/help/help-sk.html", hu: "src/help/help-hu.html", en: "src/help/help-en.html" };
  Object.entries(pages).forEach(([lang, file]) => {
    const page = read(file);
    const words = BACKUP_WORDS[lang];
    const backup = page.match(new RegExp(`<li><strong>${OPTIONS[lang].exportJson.replace(/[()]/g, "\\$&")}</strong>[\\s\\S]*?</li>`))?.[0];
    const wipe = page.match(new RegExp(`<li><strong>${OPTIONS[lang].wipeSummary.replace("…", "")}</strong>[\\s\\S]*?</li>`))?.[0];
    assert.ok(backup, `${file}: odstavec o záloze`);
    assert.ok(wipe, `${file}: odstavec o smazání všech dat`);
    ["vouchers", "notes", "hidden", "keepPrivate", "gift"].forEach((topic) => assert.match(backup, words[topic], `${file}: záloha – ${topic}`));
    ["vouchers", "notes", "hidden"].forEach((topic) => assert.match(wipe, words[topic], `${file}: mazání – ${topic}`));
  });
});

// === č. 9: diagnostika a hlášení chyby ===

// Položka deníku běhu u zboží hlídaného a zároveň koupeného – celý produkt z getWatchedProducts i s nákupem
const WATCHED = { name: "Hlídaná kávovar Barista", url: "https://www.alza.cz/kavovar-barista-d5151.htm" };
function boughtJournalEntry(AlzaCore, lang) {
  const line = AlzaCore.translate(lang, "notifyPurchaseDrop", "8 990 Kč", "7 490 Kč", "30. 11.");
  return {
    ...WATCHED,
    image: "https://image.alza.cz/kavovar.jpg",
    domain: "alza_cz",
    lang,
    textLang: lang,
    listUrl: "https://www.alza.cz/muj-ucet/nakupni-seznam.htm?id=5",
    listName: "Vánoce",
    purchase: { ...WATCHED, domain: "alza_cz", image: null, price: 8990, count: 2, boughtAt: 1763000000000, returnUntil: 1764200000000, buys: [{ t: 1763000000000, n: 2, o: "555666777" }] },
    price: 7490,
    changes: [
      { kind: "drop", text: "8 990 Kč → 7 490 Kč (-17 %)" },
      { kind: "purchase", text: line },
    ],
  };
}

test("č. 9 – diagnostika: zboží hlídané a zároveň koupené zůstane jménem, ale bez údajů o nákupu", () => {
  const { AlzaCore, data } = loadOptionsData();
  LANGUAGES.forEach((lang) => {
    const line = AlzaCore.translate(lang, "notifyPurchaseDrop", "8 990 Kč", "7 490 Kč", "30. 11.");
    assert.notEqual(line, "notifyPurchaseDrop", `${lang}: překlad řádku o zlevnění po nákupu`);
    const input = {
      watchLog: [{ start: 1, end: 2, total: 1, items: [{ ...WATCHED, lines: ["8 990 Kč → 7 490 Kč (-17 %)", line], problem: null }] }],
      watchState: {
        running: true,
        journal: [boughtJournalEntry(AlzaCore, lang)],
        recent: [{ key: "alza_cz_5151", at: 2, ...WATCHED, image: null, price: "7 490 Kč", lines: [line] }],
        pendingNotifications: [{ ...WATCHED, domain: "alza_cz", lang, lines: [line] }],
        unseen: ["alza_cz_5151"],
      },
      errors: [],
      sensitive: [],
    };
    const original = JSON.stringify(input);
    const result = plain(data.redactDiagnostics(input));
    assert.equal(JSON.stringify(input), original, "vstup zůstal beze změny");
    const text = JSON.stringify(result);
    // Údaje o nákupu: cena, počet, čas, číslo objednávky, řádek „Koupili jste za…“ ani druh změny
    ["8990", "1763000000000", "1764200000000", "555666777", "boughtAt", "buys", "returnUntil", '"purchase"', line].forEach((secret) =>
      assert.ok(!text.includes(secret), `${lang}: v diagnostice zůstalo „${secret}“`)
    );
    // Hlídaný produkt a jeho běžné změny zůstávají – podle nich se chyba hledá
    assert.ok(text.includes(WATCHED.name) && text.includes("kavovar-barista-d5151"), `${lang}: hlídaný produkt zůstává`);
    const [entry] = result.watchState.journal;
    assert.equal(entry.purchase, undefined, "vnořený záznam nákupu je pryč");
    assert.deepEqual(entry.changes, [
      { kind: "drop", text: "8 990 Kč → 7 490 Kč (-17 %)" },
      { kind: "(skryto)", text: "(skryto)" },
    ]);
    assert.deepEqual(result.watchLog[0].items[0].lines, ["8 990 Kč → 7 490 Kč (-17 %)", "(skryto)"]);
    assert.deepEqual(result.watchState.recent[0].lines, ["(skryto)"]);
    assert.deepEqual(result.watchState.pendingNotifications[0].lines, ["(skryto)"]);
    assert.deepEqual(result.watchState.unseen, ["alza_cz_5151"]);
  });
  // Log drží i běhy ze starší verze – věta tehdy končila jinak („… můžete do 20. 11.“)
  const older = "Koupili jste za 900 Kč, teď stojí 800 Kč. Vrátit a koupit znovu ho můžete do 20. 11.";
  const result = plain(data.redactDiagnostics({ watchLog: [{ start: 1, items: [{ ...WATCHED, lines: [older, "Nově skladem"], problem: null }] }] }));
  assert.deepEqual(result.watchLog[0].items[0].lines, ["(skryto)", "Nově skladem"]);
});

test("č. 9 – diagnostika: u zboží hlídaného jen kvůli nákupu řádek zůstává (položka je beze jména), nákup je pryč i tam", () => {
  const { AlzaCore, data } = loadOptionsData();
  const line = AlzaCore.translate("cz", "notifyPurchaseDrop", "900 Kč", "800 Kč", "20. 11.");
  const secret = { name: "Tajný robot Z9", url: "https://www.alza.cz/tajny-robot-z9-d4242.htm" };
  const journal = { ...secret, domain: "alza_cz", purchaseOnly: true, purchase: { ...secret, price: 900, count: 1, boughtAt: 1763000000000 }, changes: [{ kind: "purchase", text: line }] };
  const result = plain(data.redactDiagnostics({ watchLog: [{ start: 1, items: [{ ...secret, lines: [line], problem: null, purchaseOnly: true }] }], watchState: { journal: [journal] }, errors: [] }));
  const text = JSON.stringify(result);
  ["Tajný", "d4242", "1763000000000", '"purchase":', "boughtAt"].forEach((item) => assert.ok(!text.includes(item), `zůstalo „${item}“`));
  assert.deepEqual(result.watchLog[0].items[0], { name: "(koupené zboží)", url: "(skryto)", lines: [line], problem: null, purchaseOnly: true });
  assert.deepEqual(result.watchState.journal[0].changes, [{ kind: "purchase", text: line }]);
});

test("č. 9 – diagnostika: citlivé texty pryč i z řetězců logu a stavu (ne jen z chyb)", () => {
  const { data } = loadOptionsData();
  const input = {
    watchLog: [
      {
        start: 1,
        items: [{ name: "Robotický vysavač X", url: "https://www.alza.cz/vysavac-d77.htm", lines: ["Robotický vysavač X: koupili jste za 916 Kč, teď stojí 800 Kč"], problem: null }],
        lists: [{ name: "Vánoce", url: "https://www.alza.cz/muj-ucet/nakupni-seznam.htm?id=5", added: ["Robotický  vysavač X", "Hlídaný kabel"], addedCount: 2 }],
      },
    ],
    watchState: {
      alert: { reason: "login", message: "Poukaz gift2000xyz se nepodařilo ověřit" },
      changes: [{ name: "ROBOTICKÝ VYSAVAČ X", url: "https://www.alza.cz/vysavac-d77.htm", lines: ["zlevnění"] }],
      unseen: ["alza_cz_77"],
    },
    errors: [{ t: 1, source: "background", message: "Poznámka: koupit až v lednu\nmáma chce bílou" }],
    // Názvy koupeného zboží, kód poukazu a víceřádková poznámka (getSensitiveTexts)
    sensitive: ["Robotický vysavač X", "GIFT2000XYZ", "koupit až v lednu\nmáma chce bílou"],
  };
  const result = plain(data.redactDiagnostics(input));
  const text = JSON.stringify(result);
  [/robotický\s+vysavač/i, /gift2000xyz/i, /máma chce/].forEach((secret) => assert.doesNotMatch(text, secret));
  assert.deepEqual(result.watchLog[0].items[0], { name: "…", url: "https://www.alza.cz/vysavac-d77.htm", lines: ["…: koupili jste za 916 Kč, teď stojí 800 Kč"], problem: null });
  assert.deepEqual(result.watchLog[0].lists[0].added, ["…", "Hlídaný kabel"]);
  assert.equal(result.watchState.alert.message, "Poukaz … se nepodařilo ověřit");
  assert.equal(result.watchState.changes[0].name, "…");
  assert.equal(result.errors[0].message, "Poznámka: …");
  assert.deepEqual(result.watchState.unseen, ["alza_cz_77"]);
});

test("č. 9 – hlášení chyby: začerní bez ohledu na velikost písmen a na mezery, delší text napřed", () => {
  const { AlzaCore, data } = loadOptionsData();
  const keys = AlzaCore.storageKeys;
  const sensitive = data.getSensitiveTexts({
    [keys.vouchers]: { v: { code: "GIFT2000XYZ", domain: "alza_cz", value: 2000, note: "dárek od  babičky" } },
    [keys.notes]: { n: { text: "koupit až v lednu\nmáma chce bílou" } },
    [keys.owned]: { o: { name: "Masážní\u00a0pistole Deluxe 3000" }, p: { name: "Masážní pistole" } },
    [keys.codes]: { c: { code: "A+B (20 %)" } },
  });
  const redact = (text) => data.redactForReport(text, sensitive);
  assert.equal(redact("poukaz gift2000xyz neplatí"), "poukaz … neplatí", "kód malými písmeny");
  assert.equal(redact("Poukaz Gift2000Xyz (Dárek od babičky)"), "Poukaz … (…)", "poznámka s jednou mezerou a jiným písmem");
  assert.equal(redact("poznámka: koupit až v lednu\nmáma chce bílou;"), "poznámka: …;", "víceřádková poznámka");
  assert.equal(redact("poznámka: koupit až v lednu máma chce bílou;"), "poznámka: …;", "poznámka po sloučení mezer");
  assert.equal(redact("zboží Masážní pistole Deluxe 3000 a MASÁŽNÍ PISTOLE"), "zboží … a …", "delší název napřed, nedělitelná mezera");
  assert.equal(redact("kód A+B (20 %) selhal"), "kód … selhal", "znaky regulárních výrazů v kódu");
  assert.equal(redact("nic citlivého na www.alza.cz/produkt-d1.htm"), "nic citlivého na www.alza.cz");
  // Krátké texty (méně než 3 znaky) se nezačerňují – rozbily by každou zprávu
  assert.equal(data.redactForReport("ab abc", ["ab", " a ", 5, null]), "ab abc");
  // Hodně názvů (Moje nákupy za roky) – výraz se skládá po částech
  const many = Array.from({ length: 450 }, (_, index) => `Produkt číslo ${index} (model ${index}+)`);
  assert.equal(data.redactForReport("chyba u produkt  číslo 449 (MODEL 449+) a Produkt číslo 7 (model 7+)!", many), "chyba u … a …!");
});

test("č. 9 – Nahlásit chybu začerňuje dřív, než zprávu přepíše na jeden řádek", () => {
  const handler = script.slice(script.indexOf('document.getElementById("reportBug")'));
  assert.match(handler, /redactForReport\(entry\.message, sensitive\)\.replace\(\/\\s\+\/g, " "\)\.slice\(0, 300\)/);
  assert.doesNotMatch(handler, /redactForReport\(String\(entry\.message\)\.replace/, "normalizace mezer před začerněním");
});

// === č. 22: novinky chystaného vydání ===

test("č. 22 – nejnovější vydání má odrážky ve 4 jazycích a novou volbu připomínky poukazů", () => {
  const { AlzaCore } = loadCore();
  const [newest, previous] = AlzaCore.releases;
  assert.ok(AlzaCore.compareVersions(newest.version, "2026.11.12") > 0, "záznam pro vydání po 2026.11.12");
  assert.equal(previous.version, "2026.11.12");
  assert.ok(plain(newest.settings).includes("remindVouchers"), "nová volba remindVouchers je v settings");
  assert.equal(AlzaCore.defaultSettings.remindVouchers, true);
  assert.match(read("src/welcome/welcome.html"), /data-setting="remindVouchers"/);
  // Každá volba přidaná od minulého vydání patří do settings některého vydání – jinak ji Co je nového neukáže
  const announced = new Set(AlzaCore.releases.flatMap(({ settings }) => [...settings]));
  ["remindVouchers", "ownedItems", "remindWarranty", "energyCost"].forEach((key) => assert.ok(announced.has(key), key));
  const news = NEWS[newest.version];
  assert.ok(news, `RELEASE_NEWS má vydání ${newest.version}`);
  LANGUAGES.forEach((lang) => {
    assert.ok(news[lang].length >= 6 && news[lang].length <= 7, `${lang}: 6–7 odrážek`);
    news[lang].forEach((text) => {
      assert.ok(text.length <= 220, `${lang}: odrážka je krátká (${text.length} znaků)`);
      assert.doesNotMatch(text, /falešn|falošn|vymyšlen|vymyslen|fake|hamis|kamu/i, `${lang}: bez tvrdých slov`);
    });
    assert.ok(news[lang].some((text) => text.includes("AllyZap")), `${lang}: nový název`);
  });
  // První odrážka uvádí volbu, která je pod novinkami zeleně (peněženka poukazů a připomínka)
  assert.match(news.cz[0], /Peněženka poukazů/);
  assert.match(news.cz[0], /níže/);
});

// === č. 23: nápověda a šablona chyby ===

test("č. 23 – nápověda posílá na Průvodce dole v levém panelu, šablona chyby na verzi tamtéž", () => {
  const pages = {
    "src/help/help.html": [/Průvodce dole v levém panelu/, /Průvodce vpravo nahoře/],
    "src/help/help-sk.html": [/Sprievodca dole v ľavom paneli/, /Sprievodca vpravo hore/],
    "src/help/help-hu.html": [/Beállítási varázsló a bal oldali panel alján/, /Beállítási varázsló jobbra fent/],
    "src/help/help-en.html": [/Setup guide, at the bottom of the left panel/, /Setup guide, top right/],
  };
  Object.entries(pages).forEach(([file, [expected, outdated]]) => {
    const page = read(file);
    assert.match(page, expected, file);
    assert.doesNotMatch(page, outdated, file);
  });
  // Průvodce i verze jsou opravdu dole v levém panelu stránky rozšíření
  const side = html.match(/<aside class="side">([\s\S]*?)<\/aside>/)[1];
  assert.match(side, /<div class="side-foot">[\s\S]*data-i18n="welcomeLink"[\s\S]*id="version"/);
  const template = read(".github/ISSUE_TEMPLATE/bug.yml");
  assert.match(template, /description: Na stránce rozšíření dole v levém panelu/);
  assert.doesNotMatch(template, /nahoře pod názvem/);
});

// === č. 25: bublina nápovědy „?“ ===

const cssRule = (selector) => {
  const rule = html.match(new RegExp(`\\n {6}${selector.replace(/[.:()]/g, "\\$&")} \\{([^}]*)\\}`));
  assert.ok(rule, `pravidlo ${selector}`);
  return rule[1];
};

test("č. 25 – bublina nápovědy mimo najetí a fokus nezabírá místo (display: none), vzhled zůstal", () => {
  const tip = cssRule(".info::after");
  assert.match(tip, /display: none;/);
  assert.doesNotMatch(tip, /visibility:/, "skrytá přes visibility by dál roztahovala stránku");
  assert.match(tip, /left: calc\(-10px \+ var\(--tip-shift, 0px\)\);/, "posun od pravého okraje");
  // Vzhled bubliny beze změny
  ["position: absolute;", "top: calc(100% + 8px);", "z-index: 20;", "width: 310px;", "padding: 11px 13px;", "border-radius: 10px;", "background: #1e2636;", "color: #fff;", "font-size: 12.5px;", "pointer-events: none;"].forEach(
    (declaration) => assert.ok(tip.includes(declaration), declaration)
  );
  const shown = html.match(/\.info:hover::after,\s*\.info:focus::after \{([^}]*)\}/)[1];
  assert.match(shown, /display: block;/);
  assert.match(cssRule(".info.tip-up::after"), /top: auto;\s*bottom: calc\(100% \+ 8px\);/);
  assert.match(html, /@keyframes info-tip-in \{\s*from \{\s*opacity: 0;/, "objeví se plynule jako dřív");
  assert.match(script, /\["mouseover", "focusin"\]\.forEach\(/, "poloha se počítá při najetí i fokusu");
});

test("č. 25 – krátká stránka není vyšší než okno: okraje stránky + boční panel dávají přesně 100vh", () => {
  // Bez bublin zbýval svislý posuvník o 28 px: panel má výšku okna bez 56 px, stránka okraje 28 + 56 px
  const [top, bottom] = html.match(/\n {6}body \{[^}]*\n {8}padding: (\d+)px \d+px (\d+)px;/).slice(1).map(Number);
  const side = cssRule(".side");
  const shorter = Number(side.match(/min-height: calc\(100vh - (\d+)px\);/)[1]);
  const margin = Number(side.match(/margin-bottom: (-\d+)px;/)[1]);
  assert.equal(top + bottom - shorter + margin, 0, "okraj nahoře + dole − zkrácení panelu + záporný okraj panelu");
  assert.equal(Number(side.match(/top: (\d+)px;/)[1]), top, "panel drží při rolování pod horním okrajem stránky");
  // Úzké okno: panel je nahoře nad obsahem – záporný okraj by ho přes obsah přetáhl
  assert.match(html, /@media \(max-width: 760px\) \{[\s\S]*?\n {8}\.side \{\s*position: static;\s*min-height: 0;\s*margin-bottom: 0;\s*\}/);
});

// placeInfoTip z options.js nad náhradou DOM: tip = vypočtený styl bubliny, rect = poloha otazníku v okně
function placeTip({ rect, page = { clientWidth: 1200, clientHeight: 800 }, tipHeight = 120 }) {
  const source = script.match(/const INFO_TIP_EDGE = [\s\S]*?\nfunction placeInfoTip\(info\) \{[\s\S]*?\n\}\n/)[0];
  const classes = new Set(["tip-up"]); // Zbytek z minulého zobrazení se musí smazat
  const style = { "--tip-shift": "-999px" };
  const info = {
    clientLeft: 1,
    clientTop: 1,
    clientHeight: 15,
    classList: { add: (name) => classes.add(name), remove: (name) => classes.delete(name) },
    style: { setProperty: (name, value) => (style[name] = value), removeProperty: (name) => delete style[name] },
    getBoundingClientRect: () => ({ left: rect.left, top: rect.top, right: rect.left + 17, bottom: rect.top + 17, width: 17, height: 17 }),
  };
  const tip = { boxSizing: "content-box", width: "310px", height: `${tipHeight}px`, paddingLeft: "13px", paddingRight: "13px", paddingTop: "11px", paddingBottom: "11px", left: "-10px", top: "23px" };
  const context = vm.createContext({ getComputedStyle: (element, pseudo) => (element === info && pseudo === "::after" ? tip : {}), document: { documentElement: page } });
  vm.runInContext(`${source}\nplaceInfoTip(info);`, Object.assign(context, { info }));
  const shift = Number.parseFloat(style["--tip-shift"] ?? "0");
  const left = rect.left + 1 - 10 + shift;
  return { shift, up: classes.has("tip-up"), left, right: left + 336 };
}

test("č. 25 – bublina u pravého okraje okna se posune doleva jen o přesah, u spodního se dá nad otazník", () => {
  // Levý sloupec: místa je dost – poloha jako dřív
  assert.deepEqual(placeTip({ rect: { left: 400, top: 200 } }), { shift: 0, up: false, left: 391, right: 727 });
  // Pravý sloupec v okně 1 000–1 300 px: bublina by přesáhla okraj okna
  [1000, 1100, 1200, 1300].forEach((clientWidth) => {
    const placed = placeTip({ rect: { left: clientWidth - 120, top: 200 }, page: { clientWidth, clientHeight: 800 } });
    assert.ok(placed.shift < 0, `okno ${clientWidth}: posun doleva`);
    assert.ok(placed.right <= clientWidth - 8, `okno ${clientWidth}: pravý okraj bubliny ${placed.right} je v okně`);
    assert.ok(placed.right > clientWidth - 10, `okno ${clientWidth}: jen o přesah`);
    assert.ok(placed.left >= 8);
  });
  // Úzké okno: doleva jen k levému okraji okna, ne za něj
  const narrow = placeTip({ rect: { left: 200, top: 200 }, page: { clientWidth: 320, clientHeight: 800 } });
  assert.ok(narrow.left >= 8 && narrow.left < 9, `levý okraj ${narrow.left}`);
  // U spodního okraje okna: nad otazník, když se tam vejde; jinak zůstane pod ním
  assert.equal(placeTip({ rect: { left: 400, top: 700 } }).up, true);
  assert.equal(placeTip({ rect: { left: 400, top: 600 }, tipHeight: 120 }).up, false, "pod otazníkem se vejde");
  assert.equal(placeTip({ rect: { left: 400, top: 100 }, page: { clientWidth: 1200, clientHeight: 200 } }).up, false, "nahoře není místo");
  // Výšku bubliny prohlížeč nevrátil (auto) – počítá se jen s okraji, uprostřed okna se nic nepřeklápí
  assert.equal(placeTip({ rect: { left: 400, top: 700 }, tipHeight: Number.NaN }).up, false);
});

// === Nízké: měsíční rozpočet, změna jazyka, pořadí tabulátoru ===

test("měsíční rozpočet: jednotka se obnovuje i po uložení a neplatná hodnota se vrátí na uloženou", () => {
  const load = functionBody("loadSettings");
  const save = functionBody("saveSettings");
  assert.match(functionBody("updateBudgetUnit"), /getElementById\("budgetUnit"\)\.textContent = AlzaCore\.domains\[AlzaCore\.getPrimaryDomain\(settings\)\]\.currency/);
  assert.match(load, /updateBudgetUnit\(settings\)/);
  assert.match(save, /const monthlyBudget = within\(form\.monthlyBudget, "monthlyBudget"\);/);
  assert.match(save, /if \(monthlyBudget === null\) form\.monthlyBudget\.value = settings\.monthlyBudget;/);
  // Až po uložení a po převzetí jazyka – hlavní Alza „automaticky“ se řídí jazykem
  assert.ok(save.indexOf("updateBudgetUnit(settings)") > save.indexOf("applyLanguage(settings)"), "jednotka po změně hlavní Alzy i jazyka");
  // Neplatnou hodnotu odmítne stejná kontrola jako import zálohy
  const { data } = loadOptionsData();
  [-5, 100000001, Number.NaN].forEach((value) => assert.equal(data.sanitizeSettings({ monthlyBudget: value }).monthlyBudget, undefined, String(value)));
  assert.equal(data.sanitizeSettings({ monthlyBudget: 15000 }).monthlyBudget, 15000);
});

test("změna jazyka překreslí i záložku Kódy a poukazy", () => {
  const apply = functionBody("applyLanguage");
  ["renderVouchers", "renderProductCodes"].forEach((name) => {
    assert.match(apply, new RegExp(`if \\(typeof ${name} === "function"\\) ${name}\\(\\)\\.catch\\(logError\\);`), name);
    assert.match(read("src/options/options-vouchers.js"), new RegExp(`\\nasync function ${name}\\(\\) \\{`), `${name} existuje v options-vouchers.js`);
  });
});

test("záložky Mých dat: po otevření rovnou na #s-… je v pořadí tabulátoru jen jedna", () => {
  // showTab se při #s-… nevolá – roving tabindex se proto nastaví ještě před prvním applyHash()
  const init = script.indexOf('document.querySelectorAll(".tab[data-tab]").forEach((button) => (button.tabIndex = button.dataset.tab === currentTab ? 0 : -1));');
  assert.ok(init > 0, "výchozí pořadí tabulátoru záložek dat");
  assert.ok(init < script.lastIndexOf("\napplyHash();"), "před prvním applyHash()");
  assert.ok(init > script.indexOf("let currentTab = TABS[0];"), "za deklarací currentTab");
});

// === Nízké: název a hygiena ===

test("zbytky starého názvu: titulek offscreen dokumentu a předpona v console.error", () => {
  assert.match(read("src/chrome/offscreen/offscreen.html"), /<title>AllyZap<\/title>/);
  const sources = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const file = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(file);
      else if (/\.(js|html)$/.test(entry.name)) sources.push(file);
    }
  };
  walk("src");
  assert.ok(sources.length > 30);
  const outdated = sources.filter((file) => /Alza Price (Tracker|Watch|Insight)/.test(read(file)));
  assert.deepEqual(outdated, []);
  assert.ok(sources.some((file) => /console\.error\("AllyZap – /.test(read(file))), "předpona AllyZap – v chybách");
});

test(".gitignore zná .DS_Store", () => {
  assert.ok(read(".gitignore").split("\n").includes(".DS_Store"));
});

test("maďarština: uvozovky se zavírají znakem ” (ne “) v textech stránky rozšíření a novinek", () => {
  Object.entries(OPTIONS.hu).forEach(([key, text]) => assert.ok(!text.includes("\u201C"), `OPTIONS_TEXTS.hu.${key}`));
  assert.match(OPTIONS.hu.discountFilterTip, /„Kedvezmény legalább X %”, „Csak kuponnal” és „Mennyiségi kedvezménnyel”/);
  Object.entries(NEWS).forEach(([version, texts]) => texts.hu.forEach((text, index) => assert.ok(!text.includes("\u201C"), `RELEASE_NEWS ${version} hu ${index}`)));
});

test("Safari: průvodce posílá na Vyzkoušet notifikace v kroku 4 (jako průvodce v Chromu a Firefoxu)", () => {
  const safari = read("safari/src/safari/welcome-safari.js");
  assert.doesNotMatch(safari, /kroku 3|3\. lépésben|in step 3/);
  assert.equal([...safari.matchAll(/kroku 4\.|4\. lépésben\.|in step 4\./g)].length, 4);
  const guide = read("src/welcome/welcome-texts.js");
  assert.match(guide, /kroku 4/);
  assert.match(guide, /4\. lépés/);
  assert.match(guide, /step 4/);
});
