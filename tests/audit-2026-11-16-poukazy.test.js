// Audit 2026-11-16, peněženka poukazů (dárkový poukaz je hotovost – chyba stojí uživatele peníze):
// č. 2 poukaz „použitý“, i když použitý nebyl (applied jen z tabulky košíku, párování s objednávkou),
// č. 7 úprava poukazu v nastavení (Zrušit úpravu, jiný kód = nový poukaz, text tlačítka podle úpravy),
// č. 8 rozbor vloženého textu (částky, kód, platnost, minimum objednávky, řádek poukazu v košíku),
// č. 10 kód v DOM stránky Alzy a v notifikaci, a drobnosti (úklid bubliny ve Firefoxu, název tlačítka Vložit).
// Spuštění: node --test "tests/*.test.js"
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { loadCore, loadBackground } = require("./load-core");

const ROOT = path.resolve(__dirname, "..");
// Konce řádků sjednotit – pracovní kopie na Windows (core.autocrlf) má CRLF
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8").replace(/\r\n/g, "\n");
const { AlzaCore } = loadCore();
const plain = (value) => JSON.parse(JSON.stringify(value));
const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const endOfDay = (year, month, day) => new Date(year, month - 1, day, 23, 59, 59, 999).getTime();
const NOW = new Date(2026, 10, 16, 12).getTime(); // 16. 11. 2026 v poledne místního času
const parse = (text) => plain(AlzaCore.parseVoucherText(text, NOW));

// === č. 8: částky ===

test("č. 8 částka: tečka před trojicí číslic jsou tisíce, „,-“, měna před částkou, nejasný zápis nic", () => {
  const amount = (text) => plain(AlzaCore.parseVoucherAmount(text));
  assert.deepEqual(amount("1.500 Kč"), { kind: "amount", value: 1500, domain: "alza_cz" });
  assert.deepEqual(amount("100,- Kč"), { kind: "amount", value: 100, domain: "alza_cz" });
  assert.deepEqual(amount("1 500,- Kč"), { kind: "amount", value: 1500, domain: "alza_cz" });
  assert.deepEqual(amount("5.000 Ft"), { kind: "amount", value: 5000, domain: "alza_hu" });
  assert.deepEqual(amount("10.000 Ft"), { kind: "amount", value: 10000, domain: "alza_hu" });
  assert.deepEqual(amount("€ 10"), { kind: "amount", value: 10, domain: "alza_sk" });
  assert.deepEqual(amount("12.50 EUR"), { kind: "amount", value: 12.5, domain: "alza_sk" });
  assert.deepEqual(amount("1.500,50 Kč"), { kind: "amount", value: 1500.5, domain: "alza_cz" });
  assert.deepEqual(amount("1\u00a0500 Kč"), { kind: "amount", value: 1500, domain: "alza_cz" });
  assert.deepEqual(amount("500,-"), { kind: "amount", value: 500 }, "částka bez měny – doména se nepozná");
  assert.deepEqual(amount("sleva 7,5 %"), { kind: "percent", value: 7.5 });
  // Dřív: „1.500 Kč“ → 500, „2,000 Ft“ → nic nebo úlomek čísla
  ["2,000 Ft", "1.5000 Kč", "100 %", "0 Kč", "objednávka 1234567890", "21.1.2027", ""].forEach((text) => assert.equal(AlzaCore.parseVoucherAmount(text), null, text));
});

// === č. 8: text e-mailu ===

test("č. 8 hodnota se nebere z minima objednávky, z částky objednávky, ze stropu slevy ani z DPH", () => {
  assert.deepEqual(parse("Slevový kód:\tAB12CD34EF\nVýše slevy:\t500,- Kč\nPlatnost do:\t21.1.2027\nMinimální hodnota objednávky 2 000 Kč"), {
    code: "AB12CD34EF",
    kind: "amount",
    value: 500,
    domain: "alza_cz",
    until: endOfDay(2027, 1, 21),
    minOrder: 2000,
  });
  // Minimum dřív v textu než sleva
  const first = parse("Při nákupu nad 1 500 Kč získáte slevu 200 Kč. Kód: SLEVA200X");
  assert.deepEqual([first.value, first.minOrder, first.code], [200, 1500, "SLEVA200X"]);
  // Částka objednávky dřív než hodnota poukazu
  const order = parse("Objednávka v hodnotě 5 990 Kč dorazila pozdě. Jako omluvu posíláme poukaz v hodnotě 100 Kč.\nKód poukazu: AB12CD34EF\nPlatí do 31. 12. 2026");
  assert.deepEqual([order.value, order.code, order.until], [100, "AB12CD34EF", endOfDay(2026, 12, 31)]);
  assert.equal(parse("Hodnota objednávky: 5 990 Kč\nSleva: 100 Kč").value, 100);
  assert.equal(parse("Sleva na příští objednávku: 100 Kč").value, 100, "sleva na objednávku je hodnota poukazu");
  // Jen částka objednávky – hodnota se nevyplní (dřív 500)
  assert.deepEqual(parse("Objednávka 1234567890 za 500 Kč"), { code: null, kind: null, value: null, domain: null, until: null, minOrder: null });
  const tax = parse("Cena včetně DPH 21 %.\nKód: AB12CD34EF\nSleva 10 % na vše");
  assert.deepEqual([tax.kind, tax.value], ["percent", 10]);
  const cap = parse("Kód: AB12CD34EF\nSleva: 10 %, max. 500 Kč");
  assert.deepEqual([cap.kind, cap.value], ["percent", 10]);
  // Minimum zůstane minimem, i když za ním stojí slovo o slevě
  const minimum = parse("Kód: AB12CD34EF\nMinimální hodnota objednávky pro uplatnění slevy je 1 000 Kč");
  assert.deepEqual([minimum.value, minimum.minOrder], [null, 1000]);
  // Dvě různé částky bez popisu – nejednoznačné, pole zůstane prázdné
  assert.equal(parse("Posíláme 100 Kč a k tomu 300 Kč").value, null);
  assert.equal(parse("1 000 Ft").value, 1000);
});

test("č. 8 hodnota ve všech jazycích: tisíce s tečkou, euro před částkou, maďarské minimum", () => {
  assert.deepEqual(parse("Kuponkód: HU2027ABC\nKedvezmény: 5.000 Ft\nÉrvényes: 2027. 03. 15."), {
    code: "HU2027ABC",
    kind: "amount",
    value: 5000,
    domain: "alza_hu",
    until: endOfDay(2027, 3, 15),
    minOrder: null,
  });
  const sk = parse("Kód: AB12CD34EF\nZľava: € 10\nMinimálna hodnota objednávky: 50 €");
  assert.deepEqual([sk.value, sk.domain, sk.minOrder], [10, "alza_sk", 50]);
  const hu = parse("Kód: HU12AB34\nKedvezmény: 2 000 Ft\nMinimális rendelési érték: 10 000 Ft");
  assert.deepEqual([hu.value, hu.minOrder], [2000, 10000]);
  assert.equal(parse("Kód: AB12CD34EF\nHodnota: 1.000 Kč").value, 1000);
  const en = parse("Code: AB12CD34EF\nDiscount: 10 EUR\nValid until 31/12/2026\nMinimum order value: 50 EUR");
  assert.deepEqual([en.value, en.until, en.minOrder], [10, endOfDay(2026, 12, 31), 50]);
});

test("č. 8 kód: celé slovo z velkých písmen a číslic s písmenem i číslicí, na kterémkoli řádku s popiskem", () => {
  // Dřív „2026“ z data na prvním řádku s popiskem
  assert.equal(parse("Váš slevový kód je platný do: 31.12.2026\nKód: 9NZW83KFPE\nHodnota: 200 Kč").code, "9NZW83KFPE");
  assert.equal(parse("Kód slevy platí do: 31.12.2026\nAB12CD34EF\n100 Kč").code, "AB12CD34EF");
  // Dřív „IJTE“ – úlomek slova „použijte“ za písmenem s diakritikou
  assert.equal(parse("Dobrý den, váš slevový kód na příští nákup: použijte ho v košíku.\n9NZW83KFPE\nSleva 200 Kč").code, "9NZW83KFPE");
  assert.equal(parse("Slevový kód: použijte v košíku kód AB12CD34EF\nSleva: 100 Kč").code, "AB12CD34EF");
  // Dřív „PRO256“ a „RTX4070“ z názvu zboží
  assert.equal(parse("Děkujeme za nákup iPhone 15 PRO256 – jako omluvu posíláme poukaz 100 Kč, kód najdete níže\nX7K9-22PL").code, "X7K9-22PL");
  assert.equal(parse("Za zpožděnou RTX4070 se omlouváme, poukaz AB12CD34EF na 100 Kč").code, "AB12CD34EF");
  assert.equal(parse("Objednávka č. 123456789 ze dne 3. 11. 2026\nposíláme dárkový poukaz v hodnotě 500 Kč, kód ABCD-1234-EFGH. Platí do 31. 1. 2027.").code, "ABCD-1234-EFGH");
  // Za popiskem jediné slovo i malými písmeny; popisek na samostatném řádku
  assert.equal(parse("váš kód: abcd1234").code, "ABCD1234");
  assert.equal(parse("kód 9nzw83kfpe").code, "9NZW83KFPE");
  assert.equal(parse("Zľavový kód:\nxy-2027").code, "XY-2027");
  // Bez písmene nebo bez číslice kódem není (pole zůstane prázdné), částka také ne
  ["Kód: VANOCE", "Kód: 12345678", "Kód: 2026", "Sleva 10EUR, kód přijde zvlášť", "Kód: použijte\nIphone15"].forEach((text) => assert.equal(parse(text).code, null, text));
  // Bez popisku jen když je kandidát v textu jediný (a aspoň 6 znaků) – název zboží kódem není
  assert.equal(parse("Posíláme vám 9NZW83KFPE jako omluvu").code, "9NZW83KFPE");
  assert.equal(parse("Za iPhone 15 PRO256 posíláme 9NZW83KFPE").code, null, "dva kandidáti bez popisku");
  assert.equal(parse("Televize QE55 je na cestě").code, null);
  // Adresa ani e-mail se neprohledávají
  assert.equal(parse("Více na https://www.alza.cz/akce?utm=AB12CD34 nebo info-AB12CD34@example.com").code, null);
});

test("č. 8 víc kódů v textu: vezme se první a rozbor to oznámí", () => {
  const two = parse("Kód: AAAA1111\nHodnota: 100 Kč\nKód: BBBB2222\nHodnota: 200 Kč");
  assert.deepEqual([two.code, two.value, two.moreCodes], ["AAAA1111", 100, true]);
  // Jeden kód (i zopakovaný) příznak nemá – tvar výsledku zůstává
  assert.equal(Object.hasOwn(parse("Kód: AAAA1111\nVáš kód AAAA1111 platí do 31.12.2026"), "moreCodes"), false);
  const options = read("src/options/options-vouchers.js");
  assert.match(options, /parsed\.moreCodes \? "voucherParsedMore"/, "nastavení na víc kódů upozorní");
});

test("č. 8 platnost: jen z řádku o platnosti, ne datum objednávky; datum bez roku", () => {
  // Dřív 5. 11. 2026 (datum objednávky) – a po uložení poukaz zmizel jako prošlý
  const mail = "Dobrý den,\nvaše objednávka ze dne 5. 11. 2026 se zpozdila.\nSlevový kód: AB12CD34EF\nVýše slevy: 100 Kč\nPlatnost do 30. 11.";
  assert.equal(parse(mail).until, endOfDay(2026, 11, 30));
  assert.equal(parse("Kód: AB12CD34EF\nKód je platný na celý sortiment.\nObjednáno 1. 11. 2026\nPlatnost do: 31. 12. 2026\nSleva: 100 Kč").until, endOfDay(2026, 12, 31));
  assert.equal(parse("Kód: AB12CD34EF\nSleva: 100 Kč\nObjednávka ze dne 5. 11. 2026").until, null, "bez řádku o platnosti nic");
  assert.equal(parse("Kód: AB12CD34EF\nPoukaz platí na vše. Objednáno 1. 11. 2026").until, null, "datum v další větě");
  assert.equal(parse("Kód: AB12CD34EF\nPlatnost do:\n21.1.2027").until, endOfDay(2027, 1, 21));
  assert.equal(parse("Kód: AB12CD34EF\nPlatnost od 1. 11. 2026 do 30. 11. 2026").until, endOfDay(2026, 11, 30));
  // Měsíc slovem a dvouciferný rok se nečtou – raději nevyplnit
  assert.equal(parse("Kód: AB12CD34EF\nPlatnost do 31. prosince 2026").until, null);
  assert.equal(AlzaCore.parseVoucherDate("do 1.1.27", NOW), null);

  const date = (text, now = NOW) => AlzaCore.parseVoucherDate(text, now);
  assert.equal(date("21.1.2027"), endOfDay(2027, 1, 21));
  assert.equal(date("2027. 01. 21."), endOfDay(2027, 1, 21));
  assert.equal(date("2027-01-21"), endOfDay(2027, 1, 21));
  assert.equal(date("21/1/2027"), endOfDay(2027, 1, 21));
  assert.equal(date("31.2.2027"), null);
  // Bez roku: nejbližší takový den; přes přelom roku další rok; prošlé před pár dny zůstane prošlé
  assert.equal(date("do 30. 11."), endOfDay(2026, 11, 30));
  assert.equal(date("do 15. 1."), endOfDay(2027, 1, 15));
  assert.equal(date("do 16. 11. 23:59"), endOfDay(2026, 11, 16), "dnešek ještě platí, čas za datem nevadí");
  assert.equal(date("do 10. 11."), endOfDay(2026, 11, 10), "prošlý před týdnem – nastavení upozorní");
  assert.equal(date("do 30. 12.", new Date(2027, 0, 5, 12).getTime()), endOfDay(2026, 12, 30));
  assert.equal(date("do 1. 9."), endOfDay(2027, 9, 1), "prošlý před víc než měsícem = příští rok");
});

test("č. 8 dlouhé řady pomlček, číslic a teček rozbor nezdrží (dřív 60 000 znaků = 1,5 až 10 s)", () => {
  const n = 60000;
  const texts = [
    `Dobrý den,\n${"-".repeat(n)}\nposíláme poukaz 100 Kč`,
    `Sledovací číslo ${"1".repeat(n)} poukaz`,
    `Kód ${"A-".repeat(n / 2)} poukaz`,
    `Kód: ${".".repeat(n)}x\n${".".repeat(n)}x`,
    `Platnost do ${"1.".repeat(n / 2)} x`,
    `${"1 000 ".repeat(n / 6)}Kč`,
    "kód ".repeat(n / 4),
    "platí sleva: ".repeat(n / 13),
    `Kód:${" ".repeat(n)}x\nminimální ${" ".repeat(n)} 5`,
  ];
  texts.forEach((text, index) => {
    const start = process.hrtime.bigint();
    AlzaCore.parseVoucherText(text, NOW);
    const ms = Number((process.hrtime.bigint() - start) / 1000000n);
    assert.ok(ms < 400, `text ${index}: ${ms} ms`);
  });
  assert.equal(parse(texts[0]).value, 100);
});

test("č. 8 košík: hodnota jen z buňky částky, z textu podmínky jen minimum objednávky", () => {
  const row = (amount, condition) => plain(AlzaCore.parseBasketVoucherRow(amount, condition));
  // Dřív hodnota 2 000 (z podmínky) místo 100
  assert.deepEqual(row("100 Kč", "Minimální hodnota objednávky: 2 000 Kč"), { kind: "amount", value: 100, minOrder: 2000 });
  assert.deepEqual(row("100 Kč", "Platí při nákupu nad 1 000 Kč"), { kind: "amount", value: 100, minOrder: 1000 });
  assert.deepEqual(row("-100,-", "Hodnota objednávky musí být alespoň 500 Kč"), { kind: "amount", value: 100, minOrder: 500 });
  assert.deepEqual(row("−1 500 Kč", ""), { kind: "amount", value: 1500, minOrder: null });
  // Dřív „5 %“ + „Sleva: max. 500 Kč“ → poukaz na 500 Kč
  assert.deepEqual(row("5%", "Sleva: max. 500 Kč"), { kind: "percent", value: 5, minOrder: null });
  assert.deepEqual(row("5 %", "Platí na zboží v hodnotě: od 1 000 Kč"), { kind: "percent", value: 5, minOrder: 1000 });
  assert.deepEqual(row("10 €", "Minimálna hodnota objednávky: 50 €"), { kind: "amount", value: 10, minOrder: 50 });
  assert.deepEqual(row("2 000 Ft", "Minimális rendelési érték: 10 000 Ft"), { kind: "amount", value: 2000, minOrder: 10000 });
  // Buňka, které nerozumíme – hodnota se nevymýšlí (uložení otevře nastavení)
  assert.deepEqual(row("", "Sleva 100 Kč"), { kind: null, value: null, minOrder: null });
  assert.deepEqual(row("100 Kč 80 Kč", ""), { kind: null, value: null, minOrder: null });
  const basket = read("src/content/basket-vouchers.js");
  assert.match(basket, /AlzaCore\.parseBasketVoucherRow\(amount, condition\)/);
  assert.doesNotMatch(basket, /parseVoucherText/, "košík nepoužívá rozbor e-mailu");
});

// === č. 2: označení „použitý“ ===

test("č. 2 párování s objednávkou: jen objednávka po uplatnění, ne den předem", () => {
  const applied = Date.UTC(2026, 10, 16, 10);
  const vouchers = { a: { code: "A1", domain: "alza_cz", kind: "amount", value: 100, applied } };
  const lines = [{ amount: 100, percent: null, name: "Sleva na zboží - kód" }];
  const match = (created) => plain(AlzaCore.matchVoucherUses(vouchers, "alza_cz", { created, orderNumber: 1, lines }));
  assert.deepEqual(match(applied - 20 * HOUR), [], "objednávka den před uplatněním");
  assert.deepEqual(match(applied - HOUR), []);
  assert.equal(match(applied - 5 * 60 * 1000).length, 1, "pár minut rozdílu hodin počítače a Alzy");
  assert.equal(match(applied + 2 * DAY).length, 1);
  assert.deepEqual(match(applied + 4 * DAY), [], "dlouho po uplatnění");
});

test("č. 2 párování: procentní poukaz ne se slevou „k položce“, částka ne s procentní slevou k položce", () => {
  const applied = Date.UTC(2026, 10, 16, 10);
  const order = (lines) => ({ created: applied + HOUR, orderNumber: 7, lines });
  const percent = { p: { code: "P1", domain: "alza_cz", kind: "percent", value: 30, applied } };
  const plus = AlzaCore.parseOrderVoucherLines({ parts: [{ items: [{ commodityName: "Sleva 30% k položce CIS1415", pricePerItem: "-150 Kč/ks", price: "-150 Kč", count: 1 }] }] });
  assert.equal(plus[0].percent, 30);
  assert.deepEqual(plain(AlzaCore.matchVoucherUses(percent, "alza_cz", order(plus))), [], "AlzaPlus+ není poukaz z peněženky");
  assert.equal(AlzaCore.matchVoucherUses(percent, "alza_cz", order([{ amount: 150, percent: 30, name: "Sleva 30 % na zboží - kód" }])).length, 1);
  const amount = { a: { code: "A1", domain: "alza_cz", kind: "amount", value: 150, applied } };
  assert.deepEqual(plain(AlzaCore.matchVoucherUses(amount, "alza_cz", order(plus))), []);
  assert.equal(AlzaCore.matchVoucherUses(amount, "alza_cz", order([{ amount: 150, percent: null, name: "Sleva na zboží - kód" }])).length, 1);
});

test("č. 2 párování: dárkový poukaz vyšší než šek až po shodné částce a jen jako jediný kandidát", () => {
  const applied = Date.UTC(2026, 10, 16, 10);
  const gift = (id, value, at = applied) => [id, { code: id.toUpperCase(), domain: "alza_cz", kind: "amount", value, applied: at }];
  const order = (lines) => ({ created: applied + HOUR, orderNumber: 888, lines });
  const cheque = (amount) => ({ amount, percent: null, name: "Sleva na zboží – dárkový šek" });
  const ids = (vouchers, lines) => plain(AlzaCore.matchVoucherUses(Object.fromEntries(vouchers), "alza_cz", order(lines))).map(({ id }) => id);
  // Poukaz na 300 Kč má shodu – vyšší poukaz 2 000 Kč zůstane aktivní (dřív „použitý“ byl ten vyšší)
  assert.deepEqual(ids([gift("g2000", 2000), gift("g300", 300)], [cheque(300)]), ["g300"]);
  assert.deepEqual(ids([gift("g2000", 2000)], [cheque(300)]), ["g2000"], "objednávka levnější než poukaz");
  assert.deepEqual(ids([gift("g2000", 2000), gift("g1000", 1000)], [cheque(300)]), [], "dva vyšší kandidáti – nejde rozhodnout");
  assert.deepEqual(ids([gift("g2000", 2000)], [{ amount: 300, percent: null, name: "Sleva na zboží - kód" }]), [], "řádek není dárkový šek");
  // Dva poukazy stejné hodnoty a jeden řádek: přednost má později uplatněný; výsledek v pořadí poukazů
  assert.deepEqual(ids([gift("first", 100, applied - HOUR), gift("second", 100)], [cheque(100)]), ["second"]);
  assert.deepEqual(ids([gift("first", 100, applied - HOUR), gift("second", 100)], [cheque(100), cheque(100)]), ["first", "second"]);
});

test("č. 2 applied jen podle tabulky poukazů košíku: zapsat, obnovit, smazat", () => {
  const now = NOW;
  const vouchers = {
    rejected: { code: "AAAA1111", domain: "alza_cz", kind: "amount", value: 100, minOrder: 2000, applied: now - 10 * 60 * 1000 }, // kliknuto ve staré verzi, Alza odmítla
    inCart: { code: "BBBB2222", domain: "alza_cz", kind: "amount", value: 100 },
    fresh: { code: "CCCC3333", domain: "alza_cz", kind: "amount", value: 50, applied: now - 10 * 60 * 1000 },
    stale: { code: "DDDD4444", domain: "alza_cz", kind: "amount", value: 50, applied: now - 2 * HOUR },
    used: { code: "EEEE5555", domain: "alza_cz", kind: "amount", value: 50, applied: now - DAY, usedAt: now - DAY },
    other: { code: "FFFF6666", domain: "alza_sk", kind: "amount", value: 5, applied: now - HOUR },
    idle: { code: "GGGG7777", domain: "alza_cz", kind: "amount", value: 10 },
  };
  const table = ["BBBB2222", "CCCC3333", "DDDD4444", "EEEE5555", "ZZZZ9999"];
  assert.deepEqual(plain(AlzaCore.getBasketVoucherChanges(vouchers, "alza_cz", table, now)), { seen: ["inCart", "stale"], gone: ["rejected"] });
  assert.deepEqual(plain(AlzaCore.getBasketVoucherChanges(vouchers, "alza_cz", new Set(), now)), { seen: [], gone: ["rejected", "fresh", "stale"] });
  assert.deepEqual(plain(AlzaCore.getBasketVoucherChanges(null, "alza_cz", table, now)), { seen: [], gone: [] });

  // Scénář z auditu: A odmítnutý (jen kliknutý), B skutečně v košíku → po vyřízení tabulky je „použitý“ B, ne A
  const after = structuredClone(vouchers);
  after.rejected.applied = null;
  after.inCart.applied = now;
  const uses = AlzaCore.matchVoucherUses(after, "alza_cz", { created: now + HOUR, orderNumber: "555", lines: [{ amount: 100, percent: null, name: "Sleva na zboží" }] });
  assert.deepEqual(plain(uses), [{ id: "inCart", usedAt: now + HOUR, usedOrder: "555" }]);
});

// Bublina poukazů (src/content/basket-vouchers.js) nad náhradou stránky: prvky jsou prosté objekty, zápisy do úložiště
// a vložení kódu se jen zaznamenávají. now jde posouvat (basket.now)
function loadBasket({ vouchers = {}, now = NOW } = {}) {
  const { AlzaCore: core, context } = loadCore();
  const element = (tag, className = "", text = "") => ({
    tag,
    className,
    textContent: text,
    attributes: {},
    children: [],
    listeners: {},
    isConnected: true,
    remove() {},
    setAttribute(name, value) {
      this.attributes[name] = String(value);
    },
    append(...nodes) {
      this.children.push(...nodes);
    },
    appendChild(node) {
      this.children.push(node);
      return node;
    },
    addEventListener(name, listener) {
      this.listeners[name] = listener;
    },
  });
  const basket = { now, runs: [], inserted: [], timers: [], rows: 1, anchor: true, table: [], visibility: "visible" };
  Object.assign(context, {
    AlzaStore: {
      run: async (operation) => {
        basket.runs.push(structuredClone(operation));
      },
    },
    AlzaIcons: { prepend: (node) => node },
    document: {
      get visibilityState() {
        return basket.visibility;
      },
      body: element("body"),
      createElement: (tag) => element(tag),
      querySelector: (selector) => (selector === "#toggle" && basket.anchor ? element("a") : null),
      querySelectorAll: () => [],
    },
    window: { location: { hostname: "www.alza.cz" } },
    sessionStorage: { getItem: () => null, setItem: () => {} },
    setTimeout: (callback) => basket.timers.push(callback),
    clearTimeout: () => {},
    AlzaPriceTracker: {
      state: { basketVouchers: structuredClone(vouchers), uiLanguage: "cz" },
      basketSelectors: { codeToggle: "#toggle" },
      createEl: element,
      translate: (key, ...params) => [key, ...params].join("|"),
      formatPrice: (price) => core.formatPrice(price, "alza_cz"),
      getBasketRows: () => Array.from({ length: basket.rows }, () => ({})),
      insertBasketCode: (code) => basket.inserted.push(code),
    },
  });
  vm.runInContext("Date.now = () => globalThis.__now();", context);
  context.__now = () => basket.now;
  vm.runInContext(fs.readFileSync(path.join(ROOT, "src/content/basket-vouchers.js"), "utf8"), context, { filename: "src/content/basket-vouchers.js" });
  basket.tracker = context.AlzaPriceTracker;
  // Tabulka uplatněných poukazů a umístění bubliny bez DOM
  basket.tracker.getAppliedBasketVouchers = () => basket.table.map((code) => ({ code, amount: "100 Kč", validity: "", condition: "" }));
  basket.tracker.positionBasketVouchers = () => {};
  basket.tracker.getBasketTotal = () => 500;
  basket.merges = () => basket.runs.map(({ merge }) => plain(merge));
  return basket;
}
const allNodes = (node) => [node, ...node.children.flatMap(allNodes)];

test("č. 2 košík: klik na Vložit applied nezapíše, zapíše ho až řádek v tabulce – i při zavřené bublině", () => {
  const voucher = { code: "9NZW83KFPE", domain: "alza_cz", kind: "amount", value: 100, minOrder: 2000 };
  const basket = loadBasket({ vouchers: { alza_cz_9NZW83KFPE: voucher } });
  basket.tracker.renderBasketVouchers();
  const box = basket.tracker.state.basketVoucherBox;
  const insert = allNodes(box).find((node) => node.tag === "button" && /-insert$/.test(node.className));
  // Tlačítko je aktivní i pod minimem objednávky – Alza poukaz odmítne; „použitý“ z toho být nesmí
  insert.listeners.click();
  assert.deepEqual(basket.inserted, ["9NZW83KFPE"], "celý kód jde do pole Alzy");
  assert.deepEqual(basket.runs, [], "klik do úložiště nic nezapíše");
  basket.tracker.renderBasketVouchers();
  assert.deepEqual(basket.runs, [], "poukaz v tabulce není");

  // Alza poukaz přijala – je v tabulce
  basket.table = ["9NZW83KFPE"];
  basket.tracker.renderBasketVouchers();
  assert.deepEqual(basket.merges(), [{ alza_cz_9NZW83KFPE: { applied: NOW } }]);
  assert.equal(basket.runs[0].existingOnly, true);

  // Zavřená bublina (sessionStorage) zápis nepřeskočí
  const closed = loadBasket({ vouchers: { alza_cz_9NZW83KFPE: voucher } });
  closed.tracker.readSessionList = (key) => (key === closed.tracker.basketVoucherClosedKey ? ["alza_cz"] : []);
  closed.table = ["9NZW83KFPE"];
  closed.tracker.renderBasketVouchers();
  assert.equal(closed.tracker.state.basketVoucherBox ?? null, null, "bublina se nevykreslí");
  assert.deepEqual(closed.merges(), [{ alza_cz_9NZW83KFPE: { applied: NOW } }]);
});

test("č. 2 košík: applied se smaže, až když poukaz v tabulce chybí i po chvíli – ne v prázdném košíku", () => {
  const vouchers = { alza_cz_AAAA1111: { code: "AAAA1111", domain: "alza_cz", kind: "amount", value: 100, applied: NOW - 30 * 60 * 1000 } };
  const basket = loadBasket({ vouchers });
  const wait = basket.tracker.basketVoucherGoneMs;
  // Poprvé chybí (Alza tabulku možná jen překresluje) – nic se nemaže, naplánuje se nové vykreslení
  basket.tracker.renderBasketVouchers();
  assert.deepEqual(basket.runs, []);
  assert.equal(basket.timers.length, 1, "kontrola po chvíli");
  // Tabulka se mezitím vrátila – odpočet se ruší
  basket.now += 1000;
  basket.table = ["AAAA1111"];
  basket.tracker.renderBasketVouchers();
  basket.table = [];
  basket.now += wait + 1000;
  basket.tracker.renderBasketVouchers();
  assert.deepEqual(basket.runs, [], "chybí znovu poprvé");
  // Chybí i po chvíli → smazat
  basket.now += wait;
  basket.tracker.renderBasketVouchers();
  assert.deepEqual(basket.merges(), [{ alza_cz_AAAA1111: { applied: null } }]);

  // Prázdný košík (po odeslání objednávky) ani stránka bez bloku poukazů nic nemažou – objednávku teprve načteme
  for (const change of [{ rows: 0 }, { anchor: false }]) {
    const empty = Object.assign(loadBasket({ vouchers }), change);
    empty.tracker.renderBasketVouchers();
    empty.now += 10 * wait;
    empty.tracker.renderBasketVouchers();
    assert.deepEqual(empty.runs, [], JSON.stringify(change));
    // Po návratu do košíku se zbožím začíná odpočet znovu
    Object.assign(empty, { rows: 1, anchor: true });
    empty.tracker.renderBasketVouchers();
    assert.deepEqual(empty.runs, []);
  }
});

test("č. 2 košík: starý čas uplatnění se obnoví jen ve viditelné kartě", () => {
  const vouchers = { alza_cz_AAAA1111: { code: "AAAA1111", domain: "alza_cz", kind: "amount", value: 100, applied: NOW - 2 * HOUR } };
  const hidden = Object.assign(loadBasket({ vouchers }), { table: ["AAAA1111"], visibility: "hidden" });
  hidden.tracker.renderBasketVouchers();
  assert.deepEqual(hidden.runs, [], "karta na pozadí čas neposouvá (objednávka mohla odejít z jiné karty)");
  hidden.visibility = "visible";
  hidden.tracker.renderBasketVouchers();
  assert.deepEqual(hidden.merges(), [{ alza_cz_AAAA1111: { applied: NOW } }]);
});

// === č. 10: kód v DOM a v notifikaci ===

test("č. 10 maskování kódu: jen konec, krátký kód ukáže méně", () => {
  assert.equal(AlzaCore.maskVoucherCode("9NZW83KFPE"), "••••KFPE");
  assert.equal(AlzaCore.maskVoucherCode("ab12 cd34"), "••••CD34");
  assert.equal(AlzaCore.maskVoucherCode("XY-2027"), "••••27");
  assert.equal(AlzaCore.maskVoucherCode("ABC1"), "••••1");
  assert.equal(AlzaCore.maskVoucherCode(""), "••••");
  assert.equal(AlzaCore.getVoucherLabel({ code: "9NZW83KFPE" }), "••••KFPE");
  assert.equal(AlzaCore.getVoucherLabel({ code: "9NZW83KFPE", note: " omluva za\nzpoždění " }), "omluva za zpoždění");
  assert.equal(AlzaCore.getVoucherLabel({ code: "9NZW83KFPE", note: "x".repeat(200) }).length, 40);
});

test("č. 10 košík: v bublině je kód poukazu z peněženky jen maskovaný – v textu, atributech ani title celý není", () => {
  const vouchers = {
    alza_cz_9NZW83KFPE: { code: "9NZW83KFPE", domain: "alza_cz", kind: "amount", value: 100, note: "omluva", until: NOW + 3 * DAY },
    alza_cz_GIFT2000XY: { code: "GIFT2000XY", domain: "alza_cz", kind: "amount", value: 2000 },
    alza_cz_INCART1234: { code: "INCART1234", domain: "alza_cz", kind: "percent", value: 5 },
  };
  const basket = loadBasket({ vouchers });
  basket.table = ["INCART1234"];
  basket.tracker.renderBasketVouchers();
  const nodes = allNodes(basket.tracker.state.basketVoucherBox);
  const dump = JSON.stringify(nodes.map(({ tag, className, textContent, attributes, title, id, value }) => ({ tag, className, textContent, attributes, title, id, value })));
  ["9NZW83KFPE", "GIFT2000XY", "INCART1234"].forEach((code) => assert.ok(!dump.includes(code), `celý kód ${code} v bublině`));
  ["••••KFPE", "••••00XY", "••••1234"].forEach((masked) => assert.ok(dump.includes(masked), masked));
  // Tlačítka „Vložit“ mají název s hodnotou poukazu a koncem kódu – dvě tlačítka se od sebe liší
  const labels = nodes.filter((node) => /-insert$/.test(node.className)).map((node) => node.attributes["aria-label"]);
  assert.deepEqual(labels, [`basketVoucherInsertLabel|${AlzaCore.formatPrice(100, "alza_cz")}|••••KFPE`, `basketVoucherInsertLabel|${AlzaCore.formatPrice(2000, "alza_cz")}|••••00XY`]);
  // Celý kód až po kliknutí
  nodes.filter((node) => /-insert$/.test(node.className))[1].listeners.click();
  assert.deepEqual(basket.inserted, ["GIFT2000XY"]);
});

test("č. 10 notifikace o konci platnosti: hodnota a poznámka nebo konec kódu, nikdy celý kód", async () => {
  const until = NOW + 3 * DAY;
  const bg = loadBackground({
    now: NOW,
    storage: {
      alzaSettings: { remindVouchers: true, quietHours: false },
      alzaVouchers: {
        alza_cz_9NZW83KFPE: { code: "9NZW83KFPE", domain: "alza_cz", kind: "amount", value: 100, until },
        alza_sk_NOTE123456: { code: "NOTE123456", domain: "alza_sk", kind: "percent", value: 10, until: until + 1, note: "omluva za zpoždění" },
      },
    },
  });
  await bg.ready;
  await bg.context.processVoucherReminders();
  const sent = bg.notifications.created.map(({ options }) => options);
  assert.equal(sent.length, 2);
  assert.deepEqual(sent.map(({ title }) => title), ["Poukaz 100 Kč (••••KFPE)", "Poukaz 10 % (omluva za zpoždění)"]);
  const text = JSON.stringify(sent);
  ["9NZW83KFPE", "NOTE123456"].forEach((code) => assert.ok(!text.includes(code), `celý kód ${code} v notifikaci`));
  assert.equal(bg.data.alzaVouchers.alza_cz_9NZW83KFPE.notifiedSoon, true);
});

// === č. 7: úprava poukazu v nastavení ===

// Záložka Kódy a poukazy (src/options/options-vouchers.js) nad náhradou stránky: formulář jsou prosté objekty,
// AlzaStore.run zapisuje patchMap rovnou do úložiště v paměti (bez překreslení tabulky)
async function loadVoucherOptions(storage = {}) {
  const { AlzaCore: core, chrome, context } = loadCore({ storage });
  const elements = {};
  const element = (id) =>
    (elements[id] ??= {
      id,
      value: "",
      textContent: "",
      hidden: false,
      dataset: {},
      listeners: {},
      classList: { add() {} },
      addEventListener(name, listener) {
        this.listeners[name] = listener;
      },
      replaceChildren() {},
      scrollIntoView() {},
      focus() {},
      querySelector: () => ({ hidden: false }),
    });
  const form = element("voucherForm");
  ["code", "value", "unit", "domain", "until", "minOrder", "note"].forEach((name) => (form[name] = element(`field-${name}`)));
  form.reset = () => ["code", "value", "until", "minOrder", "note"].forEach((name) => (form[name].value = ""));
  element("voucherFilter").value = "active";
  element("voucherAdd").dataset.i18n = "voucherAdd";
  element("voucherCancel").hidden = true;
  const page = { form, elements, errors: [], data: chrome.storage.local.data };
  Object.assign(context, {
    document: { getElementById: element, createElement: () => element(`new-${Object.keys(elements).length}`) },
    ui: { lang: "cz", locale: "cs-CZ" },
    t: (key, ...params) => [key, ...params].join("|"),
    setText: (node, key, ...params) => Object.assign(node, { textContent: [key, ...params].join("|") }),
    setTabCount: () => {},
    isKnownDomain: (domain) => core.isKnownDomain(domain),
    showActionError: (error) => page.errors.push(error),
    setTimeout: () => 0,
    clearTimeout: () => {},
    AlzaStore: {
      run: async ({ type, key, set = {}, merge = {}, remove = [] }) => {
        assert.equal(type, "patchMap");
        const map = (page.data[key] ??= {});
        Object.assign(map, structuredClone(set));
        Object.entries(merge).forEach(([id, value]) => map[id] && Object.assign(map[id], value));
        remove.forEach((id) => delete map[id]);
      },
    },
  });
  vm.runInContext(fs.readFileSync(path.join(ROOT, "src/options/options-vouchers.js"), "utf8"), context, { filename: "src/options/options-vouchers.js" });
  const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
  await tick(); // Výchozí doména formuláře (resetVoucherForm čte nastavení)
  page.get = (name) => vm.runInContext(name, context);
  page.edit = (id) => {
    context.setVoucherEditing(id);
    context.fillVoucherForm(page.data.alzaVouchers[id]);
  };
  page.submit = async () => {
    await form.listeners.submit({ preventDefault() {} });
    await tick();
  };
  page.info = () => elements.voucherInfo.textContent;
  return page;
}

const usedVoucher = () => ({
  code: "AAAA1111",
  domain: "alza_cz",
  kind: "amount",
  value: 100,
  note: "omluva A",
  until: endOfDay(2027, 12, 31),
  addedAt: 1,
  applied: 1699999999999,
  usedAt: 1700000000000,
  usedOrder: "555",
  notifiedSoon: true,
  notifiedLast: true,
});

test("č. 7 úprava: uložení jiného kódu původní poukaz nesmaže a nový nezdědí stav", async () => {
  const page = await loadVoucherOptions({ alzaVouchers: { alza_cz_AAAA1111: usedVoucher() } });
  page.edit("alza_cz_AAAA1111");
  assert.equal(page.elements.voucherAdd.dataset.i18n, "voucherSave");
  assert.equal(page.elements.voucherCancel.hidden, false);
  // Uživatel místo úpravy vloží nový poukaz B
  Object.assign(page.form.code, { value: "bbbb2222" });
  Object.assign(page.form.value, { value: "2000" });
  await page.submit();
  const stored = plain(page.data.alzaVouchers);
  assert.deepEqual(stored.alza_cz_AAAA1111, usedVoucher(), "původní poukaz zůstal beze změny");
  const added = stored.alza_cz_BBBB2222;
  assert.deepEqual([added.code, added.value, added.note], ["BBBB2222", 2000, "omluva A"]);
  ["usedAt", "usedOrder", "applied", "notifiedSoon", "notifiedLast"].forEach((field) => assert.equal(Object.hasOwn(added, field), false, `nový poukaz zdědil ${field}`));
  assert.equal(AlzaCore.getVoucherState(added, NOW).state, "active");
  assert.equal(page.info(), "voucherSavedAsNew|AAAA1111", "uživatel se dozví, že původní zůstal");
  assert.equal(page.get("editingVoucher"), null);
  assert.equal(page.elements.voucherAdd.dataset.i18n, "voucherAdd");
  assert.equal(page.elements.voucherCancel.hidden, true);
});

test("č. 7 úprava: stejný kód stav zachová, jiná platnost vrátí připomínky; jiná Alza je nový poukaz", async () => {
  const page = await loadVoucherOptions({ alzaVouchers: { alza_cz_AAAA1111: usedVoucher() } });
  page.edit("alza_cz_AAAA1111");
  Object.assign(page.form.note, { value: "nová poznámka" });
  await page.submit();
  assert.deepEqual(plain(page.data.alzaVouchers), { alza_cz_AAAA1111: { ...usedVoucher(), note: "nová poznámka" } });
  assert.equal(page.info(), "voucherAdded");

  page.edit("alza_cz_AAAA1111");
  Object.assign(page.form.until, { value: "2099-01-21" });
  await page.submit();
  const changed = plain(page.data.alzaVouchers.alza_cz_AAAA1111);
  assert.equal(changed.until, endOfDay(2099, 1, 21));
  assert.deepEqual([changed.usedAt, changed.usedOrder, changed.notifiedSoon, changed.notifiedLast], [1700000000000, "555", undefined, undefined]);

  page.edit("alza_cz_AAAA1111");
  Object.assign(page.form.unit, { value: "alza_sk" });
  await page.submit();
  assert.deepEqual(Object.keys(page.data.alzaVouchers).sort(), ["alza_cz_AAAA1111", "alza_sk_AAAA1111"]);
  assert.equal(page.data.alzaVouchers.alza_sk_AAAA1111.usedAt, undefined);
  assert.deepEqual(page.errors, []);
});

test("č. 7 úprava jde zrušit a text tlačítka přežije změnu jazyka", async () => {
  const page = await loadVoucherOptions({ alzaVouchers: { alza_cz_AAAA1111: usedVoucher() } });
  page.edit("alza_cz_AAAA1111");
  assert.equal(page.form.code.value, "AAAA1111");
  assert.equal(page.elements.voucherAdd.textContent, "voucherSave");
  page.elements.voucherCancel.listeners.click();
  assert.equal(page.get("editingVoucher"), null);
  assert.deepEqual([page.form.code.value, page.form.note.value, page.elements.voucherAdd.textContent, page.elements.voucherCancel.hidden], ["", "", "voucherAdd", true]);
  assert.deepEqual(plain(page.data.alzaVouchers), { alza_cz_AAAA1111: usedVoucher() }, "zrušení nic neuloží");

  // Změna jazyka: applyStaticTexts (options.js) přepíše každý prvek s data-i18n podle jeho klíče – klíč tlačítka
  // proto sleduje úpravu; tabulku překreslí renderVouchers (globální funkce pro applyLanguage)
  const html = read("src/options/options.html");
  assert.match(html, /<button type="submit" id="voucherAdd" data-i18n="voucherAdd">/);
  assert.match(html, /<button type="button" id="voucherCancel" data-i18n="voucherCancel" hidden>/);
  assert.match(read("src/options/options.js"), /querySelectorAll\("\[data-i18n\]"\)\.forEach\(\(element\) => setText\(element, element\.dataset\.i18n\)\)/);
  assert.equal(typeof page.get("renderVouchers"), "function");
  // Formulář poukaz nikdy nemaže – jen tlačítko Smazat v tabulce s potvrzením
  const script = read("src/options/options-vouchers.js");
  assert.equal([...script.matchAll(/remove: \[/g)].length, 1);
  assert.match(script, /if \(confirm\(t\("voucherDeleteConfirm", voucher\.code\)\)\) AlzaStore\.run\(\{ type: "patchMap", key: VOUCHERS_KEY, remove: \[id\] \}\)/);
});

test("č. 8 nastavení: platnost v minulosti – upozornění při vložení textu, změně data i po uložení", async () => {
  const page = await loadVoucherOptions();
  // Vložený e-mail s prošlou platností
  page.elements.voucherPaste.value = "Kód: AB12CD34EF\nSleva: 100 Kč\nPlatnost do: 1. 1. 2020";
  page.elements.voucherPaste.listeners.input();
  assert.equal(page.form.code.value, "AB12CD34EF");
  assert.equal(page.info(), "voucherPastDate");
  await page.submit();
  assert.equal(page.data.alzaVouchers.alza_cz_AB12CD34EF.until, endOfDay(2020, 1, 1));
  assert.equal(page.info(), "voucherAddedPast|voucherFilterDone", "řekne, pod kterým filtrem poukaz je");
  // Ručně zadané datum
  page.form.until.value = "2020-05-05";
  page.form.until.listeners.change();
  assert.equal(page.info(), "voucherPastDate");
  page.form.until.value = "2099-05-05";
  page.form.until.listeners.change();
  assert.equal(page.info(), "");
  // Nový text nenechá ve formuláři kód z předchozího (částka bez kódu)
  page.form.code.value = "STARY123";
  page.elements.voucherPaste.value = "Posíláme vám poukaz v hodnotě 300 Kč.";
  page.elements.voucherPaste.listeners.input();
  assert.deepEqual([page.form.code.value, page.form.value.value, page.info()], ["", 300, "voucherParsed"]);
});

// === Drobnosti a texty ===

test("Firefox po aktualizaci: úklid starých plovoucích prvků zná i bublinu poukazů", () => {
  const content = read("src/content.js");
  const cleanup = content.match(/\.querySelectorAll\("(\.alza-price-tracker-price-card[^"]*)"\)/)[1];
  assert.ok(cleanup.split(", ").includes(".alza-price-tracker-vouchers"), cleanup);
  assert.match(read("src/content/basket-vouchers.js"), /basketVoucherClass: "alza-price-tracker-vouchers"/);
});

test("nové texty poukazů: košík i nastavení ve 4 jazycích se stejnými parametry", () => {
  const texts = vm.runInNewContext(`${read("src/content/texts.js")}; AlzaPriceTrackerTexts`, { AlzaCore });
  const options = vm.runInNewContext(`${read("src/options/options-texts.js")}; OPTIONS_TEXTS`, { navigator: { userAgent: "" } });
  const placeholders = (text) => [...new Set(text.match(/\{\d+\}/g) || [])].sort();
  ["cz", "sk", "hu", "en"].forEach((lang) => {
    assert.deepEqual(placeholders(texts[lang].basketVoucherInsertLabel), ["{0}", "{1}"], lang);
    assert.deepEqual(placeholders(options[lang].voucherSavedAsNew), ["{0}"], lang);
    assert.deepEqual(placeholders(options[lang].voucherAddedPast), ["{0}"], lang);
    ["voucherCancel", "voucherParsedMore", "voucherPastDate"].forEach((key) => assert.ok(options[lang][key].trim().length > 0, `${lang}.${key}`));
    // Titulek notifikace: hodnota a popis – pořadí parametrů ve všech jazycích stejné
    assert.match(AlzaCore.translate(lang, "notifyVoucherTitle", "100 Kč", "••••KFPE"), /100 Kč \(••••KFPE\)/, lang);
  });
});
