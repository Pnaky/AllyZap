// Testy košíku: už koupené zboží, souhrn hodnocení položek a výdaje za měsíc pro rozpočet: node --test tests/
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadCore } = require("./load-core");

const { AlzaCore } = loadCore();
const plain = (value) => JSON.parse(JSON.stringify(value));
const DAY = 24 * 60 * 60 * 1000;

test("už koupené: poslední nevrácený nákup z Mých nákupů i z hlídání po nákupu", () => {
  const product = {
    buys: [
      { t: 1000 * DAY, n: 2, o: "111", p: 250 },
      { t: 1200 * DAY, n: 1, o: "222", p: 240, ret: true },
    ],
  };
  assert.deepEqual(plain(AlzaCore.getOwnedSummary(product, null)), { at: 1000 * DAY, pieces: 2, price: 250, order: "111", times: 1 });
  // Novější nákup jen v hlídání po nákupu (Moje nákupy vypnuté nebo ještě nenačtené)
  assert.deepEqual(plain(AlzaCore.getOwnedSummary(product, { boughtAt: 1300 * DAY, count: 3, price: 230 })), { at: 1300 * DAY, pieces: 3, price: 230, order: null, times: 2 });
  // Týž nákup v obou zdrojích se nepočítá dvakrát
  assert.equal(AlzaCore.getOwnedSummary(product, { boughtAt: 1000 * DAY + 3600000, count: 2 }).times, 1);
  assert.equal(AlzaCore.getOwnedSummary(null, null), null);
  assert.equal(AlzaCore.getOwnedSummary({ buys: [{ t: 5, ret: true }] }, null), null);
});

test("souhrn košíku: nad a pod obvyklou cenou za všechny kusy, počkat, podezřelé", () => {
  const summary = AlzaCore.summarizeBasket([
    { level: "high", current: 1200, typical: 1000, count: 2, wait: true },
    { level: "good", current: 900, typical: 1000, count: 1, warn: true },
    { level: "usual", current: 500, typical: 500, count: 1 },
    { level: null, current: 100, typical: null, count: 1 },
  ]);
  assert.deepEqual(plain(summary), { high: { n: 1, amount: 400 }, good: { n: 1, amount: 100 }, wait: 1, warn: 1 });
});

test("výdaje za měsíc: jen objednávky domény z kalendářního měsíce", () => {
  const now = new Date(2026, 10, 12, 12).getTime();
  const orders = {
    alza_cz: { 1: [new Date(2026, 10, 1, 0, 5).getTime(), 1000], 2: [new Date(2026, 10, 11).getTime(), 499.9], 3: [new Date(2026, 9, 31, 23).getTime(), 5000] },
    alza_sk: { 4: [new Date(2026, 10, 2).getTime(), 30] },
  };
  assert.equal(AlzaCore.getMonthSpending(orders, "alza_cz", now), 1499.9);
  assert.equal(AlzaCore.getMonthSpending(orders, "alza_hu", now), 0);
  assert.equal(AlzaCore.getMonthSpending(null, "alza_cz", now), 0);
});

test("počet dní: české a slovenské tvary", () => {
  assert.equal(AlzaCore.formatDays("cz", 1), "1 den");
  assert.equal(AlzaCore.formatDays("cz", 3), "3 dny");
  assert.equal(AlzaCore.formatDays("cz", 5), "5 dní");
  assert.equal(AlzaCore.formatDays("sk", 2), "2 dni");
  assert.equal(AlzaCore.formatDays("hu", 2), "2 nap");
  assert.equal(AlzaCore.formatDays("en", 1), "1 day");
});

test("AlzaPlus+: rozdíl cen z historie v den nákupu, členství podle zaplacených cen", () => {
  const now = Date.UTC(2026, 10, 12);
  const at = (days) => now - days * DAY;
  const owned = {
    alza_cz_1: { domain: "alza_cz", buys: [{ t: at(30), n: 2, p: 900 }] },
    alza_cz_2: { domain: "alza_cz", buys: [{ t: at(60), n: 1, p: 500 }] },
    alza_cz_3: { domain: "alza_cz", buys: [{ t: at(500), n: 1, p: 100 }] }, // starší než rok
    alza_cz_4: { domain: "alza_cz", buys: [{ t: at(10), n: 1, p: 300, ret: true }] }, // vráceno
    alza_cz_5: { domain: "alza_cz", buys: [{ t: at(20), n: 1, p: 200 }] }, // bez historie
  };
  const histories = {
    alza_cz_1: [{ t: at(40), s: at(25), p: { original: 1000, applus: 900 } }],
    alza_cz_2: [{ t: at(70), s: at(55), p: { original: 500, special: 480, applus: 490 } }], // AlzaPlus+ nebyla nižší než akce
    alza_cz_3: [{ t: at(600), s: at(400), p: { original: 200, applus: 100 } }],
  };
  assert.deepEqual(plain(AlzaCore.estimateAlzaPlus(owned, histories, now)), { buys: 3, known: 2, cheaper: 1, saving: { alza_cz: 200 }, missed: {}, member: true });
  // Historie, která v době nákupu neplatila (poslední kontrola dávno před ním), se nepočítá
  assert.equal(AlzaCore.getPricesAt([{ t: at(100), s: at(90), p: { original: 10 } }], at(30)), null);
});

test("faktura k nákupu: PDF z části s produktem, jen pdf.alza.*", () => {
  const goods = (id) => ({ commodityId: id, commodityUrl: `/zbozi-d${id}.htm`, onClaimItemGuideClick: { enabled: true }, pricePerItem: "100 Kč" });
  const detail = {
    parts: [
      { items: [goods(5)], documents: [{ self: { href: "https://pdf.alza.cz/Apps/pdfdoc.asp?d=1&x=a" }, name: "Faktura 1" }] },
      {
        items: [goods(6)],
        documents: [
          { self: { href: "https://evil.example/faktura.pdf" }, name: "Faktura 2" },
          { self: { href: "http://pdf.alza.cz/Apps/pdfdoc.asp?d=2" }, name: "Faktura 2" },
          { self: { href: "https://pdf.alza.cz/Apps/pdfdoc.asp?d=3" }, name: "Příloha" },
        ],
      },
    ],
  };
  assert.equal(AlzaCore.pickOrderInvoice(detail, "alza_cz", "alza_cz_6"), "https://pdf.alza.cz/Apps/pdfdoc.asp?d=3");
  assert.equal(AlzaCore.pickOrderInvoice(detail, "alza_cz", "alza_cz_5"), "https://pdf.alza.cz/Apps/pdfdoc.asp?d=1&x=a");
  assert.equal(AlzaCore.pickOrderInvoice(detail, "alza_cz", "alza_cz_9"), "https://pdf.alza.cz/Apps/pdfdoc.asp?d=1&x=a");
  assert.equal(AlzaCore.pickOrderInvoice({ parts: [] }, "alza_cz"), null);
});

test("loni touhle dobou: nejnižší cena v nadcházejícím měsíci před rokem", () => {
  const now = Date.UTC(2026, 10, 12);
  const ago = (days) => now - days * DAY;
  const entries = [
    { t: ago(400), s: ago(356), p: { original: 2500 } }, // potvrzovaná až do akce – jinak cenu přesně před rokem neznáme
    { t: ago(355), s: ago(345), p: { original: 2500, blackfriday: 1990 } }, // Black Friday loni
    { t: ago(344), s: ago(10), p: { original: 2500 } },
    { t: ago(9), s: now, p: { original: 2400 } },
  ];
  assert.deepEqual(plain(AlzaCore.getLastYearOutlook(entries, 2400, now)), { lowest: 1990, at: ago(355), then: 2500, lower: true, cheaper: true });
  assert.equal(AlzaCore.getLastYearOutlook(entries, 2000, now).cheaper, false);
  // Historie mladší než rok – nic
  assert.equal(AlzaCore.getLastYearOutlook(entries.slice(2), 2400, now), null);
});

test("dochází vám: rytmus opakovaných nákupů a seznam brzy potřebných", () => {
  const now = Date.UTC(2026, 10, 12);
  const ago = (days) => now - days * DAY;
  const coffee = { domain: "alza_cz", buys: [{ t: ago(130) }, { t: ago(85) }, { t: ago(84) }, { t: ago(40), n: 2 }] }; // 84 a 85 = jeden nákup
  const rhythm = AlzaCore.getRestockRhythm(coffee);
  assert.equal(rhythm.interval, 45);
  assert.equal(rhythm.buys, 3);
  // Odhad počítá s kusy (audit 2026-11-16): 1 ks vydržel 45 dní, 2 ks (84 + 85) také 45 → medián 33,75 dne na kus,
  // poslední nákup 2 ks vystačí na 68 dní
  assert.equal(rhythm.next, ago(40) + 68 * DAY);
  // Nepravidelné nákupy – bez rytmu
  assert.equal(AlzaCore.getRestockRhythm({ buys: [{ t: ago(300) }, { t: ago(290) }, { t: ago(20) }] }), null);
  // Dva nákupy nestačí, vrácené se nepočítají
  assert.equal(AlzaCore.getRestockRhythm({ buys: [{ t: ago(90) }, { t: ago(45) }, { t: ago(1), ret: true }] }), null);
  const owned = { alza_cz_1: coffee, alza_cz_2: { domain: "alza_cz", buys: [{ t: ago(400) }, { t: ago(370) }, { t: ago(340) }] } };
  // Dnes je další nákup za 28 dní (mimo seznam „do 21 dní“), za 10 dní už v seznamu bude
  assert.deepEqual(plain(AlzaCore.getRestockList(owned, now)), []);
  const list = AlzaCore.getRestockList(owned, now + 10 * DAY);
  assert.deepEqual(plain(list.map(({ key, days }) => [key, days])), [["alza_cz_1", 18]]);
});

test("úspora nákupu proti běžné ceně v den nákupu", () => {
  const t = Date.UTC(2026, 5, 1);
  const entries = [{ t: t - 30 * DAY, s: t + DAY, p: { original: 1000, special: 800 } }];
  assert.equal(AlzaCore.getOwnedSaving({ t, p: 800, n: 2 }, entries, "alza_cz"), 400);
  assert.equal(AlzaCore.getOwnedSaving({ t, p: 1000, n: 1 }, entries, "alza_cz"), 0);
  assert.equal(AlzaCore.getOwnedSaving({ t, n: 1 }, entries, "alza_cz"), null);
  assert.equal(AlzaCore.getOwnedSaving({ t, p: 800, ret: true }, entries, "alza_cz"), null);
  assert.equal(AlzaCore.getOwnedSaving({ t: t + 60 * DAY, p: 800 }, entries, "alza_cz"), null);
});

test("paměť prohlížení: značka z názvu a skryté produkty / značky", () => {
  assert.deepEqual(plain(AlzaCore.getBrandFromName("LEGO® Technic 42100")), { key: "lego", name: "LEGO" });
  assert.deepEqual(plain(AlzaCore.getBrandFromName("Samsung Galaxy S26")), { key: "samsung", name: "Samsung" });
  assert.equal(AlzaCore.getBrandFromName("2× baterie"), null);
  assert.equal(AlzaCore.getBrandFromName(""), null);
  const hidden = { alza_cz_1: { url: "https://www.alza.cz/x-d1.htm" } };
  const brands = { samsung: { name: "Samsung" } };
  assert.equal(AlzaCore.isHiddenListing(hidden, brands, "alza_cz_1", "Xiaomi"), "product");
  assert.equal(AlzaCore.isHiddenListing(hidden, brands, "alza_cz_2", "SAMSUNG Galaxy A57"), "brand");
  assert.equal(AlzaCore.isHiddenListing(hidden, brands, "alza_cz_3", "Apple iPhone"), null);
  assert.equal(AlzaCore.isHiddenListing(null, null, "alza_cz_3", "Apple iPhone"), null);
});

test("provoz televizí: kandidáti a mezipaměť spotřeby", () => {
  assert.equal(AlzaCore.isEnergyCandidate('55" LG OLED55B65LA', "Televize SMART OLED, 139cm, 4K"), true);
  // Audit 2026-11-16 č. 12: rozhoduje druh zboží na začátku popisku, ne slovo v názvu – bez popisku raději ne
  assert.equal(AlzaCore.isEnergyCandidate("Monitor Dell P2425", ""), false);
  assert.equal(AlzaCore.isEnergyCandidate("Myš Logitech", "bezdrátová"), false);
  const now = Date.UTC(2026, 10, 12);
  const cache = { a: { kwh: 70, per: "hours", at: now - DAY }, b: { none: true, at: now - DAY }, c: { kwh: 70, per: "hours", at: now - 90 * DAY }, d: { kwh: 1, per: "hours", at: now } };
  assert.deepEqual(plain(AlzaCore.getCachedEnergy(cache, "a", now)), { kwh: 70, per: "hours" });
  assert.deepEqual(plain(AlzaCore.getCachedEnergy(cache, "b", now)), { none: true });
  assert.equal(AlzaCore.getCachedEnergy(cache, "c", now), null); // starý záznam
  assert.equal(AlzaCore.getCachedEnergy(cache, "d", now), null); // mimo rozsah
  assert.equal(AlzaCore.getCachedEnergy(cache, "x", now), null);
});

test("recenze naruby: opakované výtky, vývoj hodnocení a nejhorší ověřené recenze", () => {
  const now = Date.UTC(2026, 10, 12);
  const iso = (days) => new Date(now - days * DAY).toISOString();
  const verified = { label: "Ověřený nákup" };
  const reviews = [
    { rating: 5, reviewDate: iso(10), negatives: ["zatím nic"], verifiedPurchaseTag: verified },
    { rating: 2, reviewDate: iso(20), negatives: ["Zahřívání při hraní"], description: "Telefon se hřeje.", verifiedPurchaseTag: verified },
    { rating: 3, reviewDate: iso(30), negatives: ["zahřívání", "váha"], verifiedPurchaseTag: verified },
    { rating: 1, reviewDate: iso(40), negatives: ["nefunguje NFC"], verifiedPurchaseTag: null },
    { rating: 5, reviewDate: iso(200), negatives: ["váha je vyšší"], verifiedPurchaseTag: verified },
    { rating: 0, reviewDate: iso(1), negatives: ["neplatné"] },
  ];
  const analysis = AlzaCore.analyzeReviews(reviews, now);
  assert.equal(analysis.count, 5);
  assert.equal(analysis.verified, 4);
  assert.equal(analysis.average, 3.2);
  assert.deepEqual(plain(analysis.recent), { average: 2.8, count: 4 });
  assert.deepEqual(plain(analysis.older), { average: 5, count: 1 });
  // Výtka z recenzí do 3 ★ váží dvojnásob (audit 2026-11-16): zahřívání 2★ + 3★ je před váhou 3★ + 5★
  assert.deepEqual(plain(analysis.complaints.map(({ word, count }) => [word, count])), [["zahřívání", 2], ["váha", 2]]);
  assert.deepEqual(plain(analysis.worst.map(({ rating }) => rating)), [2, 3]); // jen ověřené, 1★ bez ověření ne
  assert.match(analysis.worst[0].text, /Zahřívání při hraní – Telefon se hřeje\./);
  assert.equal(AlzaCore.getReviewsApiUrl("alza_sk", "123", 100), "https://webapi.alza.sk/api/catalog/v2/commodities/123/reviews?country=SK&ucik=null&offset=100&limit=100");
  assert.equal(AlzaCore.getReviewsApiUrl("alza_cz", "x"), null);
});
