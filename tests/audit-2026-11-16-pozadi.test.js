// Regresní testy oprav z auditu 2026-11-16, balík „služba na pozadí, účty, popup“: dva účty Alzy v jednom profilu
// (č. 6), Moje nákupy oddělené po účtech, odhlášení na jedné doméně nezastaví kontrolu ostatních a nízké nálezy
// pozadí (odložené notifikace po startu, nedoručené notifikace, dvojí klik na Zkontrolovat, neúplná synchronizace
// objednávek, jistič u timeoutů, deník běhu, operace úložiště podle odesílatele).
// API Alzy a stránky produktů nahrazují podstrčené funkce – žádný síťový požadavek: node --test "tests/*.test.js"
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("node:vm");
const { loadCore, loadBackground } = require("./load-core");

const ROOT = path.resolve(__dirname, "..");
// Konce řádků sjednotit – pracovní kopie na Windows má CRLF, regexy počítají s LF
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8").replace(/\r\n/g, "\n");
// Objekty z izolovaného kontextu mají jiný prototyp – porovnávat jako prostá data
const plain = (value) => JSON.parse(JSON.stringify(value));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const until = async (condition, label = "podmínka") => {
  for (let i = 0; i < 400; i++) {
    if (await condition()) return;
    await sleep(5);
  }
  assert.fail(`nedočkali jsme se: ${label}`);
};
const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const MINUTE = 60 * 1000;
const iso = (daysAgo) => new Date(Date.now() - daysAgo * DAY).toISOString();
const ORIGINS = { alza_cz: "https://www.alza.cz", alza_sk: "https://www.alza.sk", alza_hu: "https://www.alza.hu" };
const USER_A = "111111111"; // Čísla účtů – nesmí se objevit v úložišti
const USER_B = "222222222";

// === Hlídání po nákupu a Moje nákupy: účty ===

function setupOrders(storage = {}) {
  const { AlzaCore, chrome, context } = loadCore({ storage: { alzaSettings: { watchPurchases: true, ownedItems: true }, ...storage }, files: ["src/shared/store.js", "src/shared/orders.js"] });
  context.AlzaStore.isWriter = true;
  // WebCrypto pro otisk účtu (v prohlížeči je globální)
  context.crypto = require("crypto").webcrypto;
  context.TextEncoder = TextEncoder;
  const AlzaOrders = vm.runInContext("AlzaOrders", context);
  const AlzaOwned = vm.runInContext("AlzaOwned", context);
  AlzaOrders.detailDelayMs = 0;
  AlzaOwned.pageDelayMs = 0;
  const writes = []; // Každý zápis do úložiště: změněné klíče
  chrome.storage.onChanged.addListener((changes) => writes.push(Object.keys(changes)));
  return { AlzaCore, AlzaOrders, AlzaOwned, AlzaStore: context.AlzaStore, chrome, data: chrome.storage.local.data, writes };
}

const order = (domainKey, userId, id, daysAgo) => ({ orderId: String(id), created: iso(daysAgo), state: "Vyřízena", self: { href: `${ORIGINS[domainKey]}/api/users/${userId}/v1/orders/${id}/` } });
const item = (id, price) => ({
  commodityId: id,
  commodityUrl: `/zbozi-d${id}.htm`,
  commodityName: `Zboží ${id}`,
  pricePerItem: price,
  count: 1,
  status: "Vyzvednuto",
  onClaimItemGuideClick: { enabled: true },
  warrantyClaimMessageBanners: [],
});
const detail = (daysAgo, items) => ({ created: iso(daysAgo), parts: [{ created: iso(daysAgo), items }] });

// Účet se svými objednávkami: args(extra) = parametry AlzaOrders.check; calls = dotazy (bez adresy účtu)
function account(domainKey, userId, orders, details, hooks = {}) {
  const base = `${ORIGINS[domainKey]}/api/users/${userId}/v1/orders`;
  const api = { calls: [], userIdCalls: 0 };
  api.args = (extra = {}) => ({
    domainKey,
    origin: ORIGINS[domainKey],
    getUserId: async () => {
      api.userIdCalls++;
      return userId;
    },
    getJson: async (url) => {
      assert.ok(url.startsWith(base), `dotaz mimo objednávky účtu: ${url}`);
      const pathname = url.slice(base.length);
      api.calls.push(pathname);
      if (pathname.startsWith("/active?")) {
        if (hooks.activeFails?.()) throw new Error("HTTP 503");
        return { groups: [{ orders: [] }] };
      }
      if (pathname.startsWith("/archive?")) {
        await hooks.onArchive?.();
        return { value: orders };
      }
      const id = pathname.match(/^\/(\d+)\/$/)?.[1];
      if (!details[id]) throw new Error("HTTP 404");
      return details[id];
    },
    ...extra,
  });
  return api;
}
const accountA =(hooks) => account("alza_cz", USER_A, [order("alza_cz", USER_A, 1001, 2)], { 1001: detail(2, [item(500, "1 000 Kč/ks")]) }, hooks);
const accountB = (hooks) => account("alza_cz", USER_B, [order("alza_cz", USER_B, 2001, 3)], { 2001: detail(3, [item(900, "300 Kč/ks")]) }, hooks);
// Posun času kontroly – další kontrola smí proběhnout
const later = (data, minutes = 11) => {
  data.alzaPurchasesSync["alza_cz:probe"] -= minutes * MINUTE;
};

test("účty – stránka Alzy s jiným účtem (kontejner, anonymní okno) nic nemaže a nebrzdí kontrolu na pozadí", async () => {
  const { AlzaOrders, data } = setupOrders({ alzaPurchases: { alza_sk_444: { url: "https://www.alza.sk/x-d444.htm", domain: "alza_sk", price: 5 } } });
  const A = accountA();
  const B = accountB();
  assert.equal((await AlzaOrders.check(A.args({ background: true }))).status, "synced");
  const tagA = data.alzaPurchasesSync["alza_cz:account"];
  assert.match(tagA, /^[0-9a-f]{4}$/);
  assert.equal(data.alzaPurchasesSync["alza_cz:accountBy"], "bg");
  // Upozornění „zlevnilo po nákupu“ už odešlo a k nákupu je připomínka cashbacku
  data.alzaPurchases.alza_cz_500.notifiedPrice = 900;
  data.alzaCashbackReminders = { alza_cz_500: { url: "https://www.alza.cz/zbozi-d500.htm", domain: "alza_cz", notifiedOpen: true } };
  later(data);
  const probeBefore = data.alzaPurchasesSync["alza_cz:probe"];
  const fullBefore = data.alzaPurchasesSync.alza_cz;

  const result = await AlzaOrders.check(B.args());
  assert.deepEqual(plain(result), { status: "otherAccount", added: [] });
  assert.deepEqual(B.calls, [], "objednávky cizího účtu se nenačítají");
  assert.equal(data.alzaPurchasesSync["alza_cz:account"], tagA, "otisk zůstává");
  assert.equal(data.alzaPurchases.alza_cz_500.notifiedPrice, 900, "nákup i s ohlášenou cenou zůstává");
  assert.deepEqual(Object.keys(data.alzaCashbackReminders), ["alza_cz_500"]);
  assert.ok(data.alzaPurchases.alza_sk_444);
  assert.equal(data.alzaPurchasesSync["alza_cz:probe"], probeBefore, "čas kontroly se vrátil celý");
  assert.equal(data.alzaPurchasesSync.alza_cz, fullBefore);

  // Další stránka téhož kontejneru to hned nezkouší znovu (ani číslo účtu nezjišťuje); stránka „Moje objednávky“ ano
  const userIdCalls = B.userIdCalls;
  assert.equal((await AlzaOrders.check(B.args())).status, "skipped");
  assert.equal(B.userIdCalls, userIdCalls);
  assert.equal((await AlzaOrders.check(B.args({ always: true }))).status, "otherAccount");
  // Kontrola na pozadí běží dál se svým účtem
  assert.equal((await AlzaOrders.check(A.args({ background: true }))).status, "unchanged");
  assert.equal(data.alzaPurchases.alza_cz_500.notifiedPrice, 900);
  assert.ok(!JSON.stringify(data).includes(USER_A) && !JSON.stringify(data).includes(USER_B), "číslo účtu v úložišti");
});

test("účty – kontrola na pozadí účet přepne jedním zápisem; po chybě načtení se objednávky nového účtu načtou hned příště", async () => {
  const { AlzaOrders, chrome, data } = setupOrders({ alzaPurchases: { alza_sk_444: { url: "https://www.alza.sk/x-d444.htm", domain: "alza_sk", price: 5 } } });
  const A = accountA();
  let fail = true;
  const B = accountB({ activeFails: () => fail });
  await AlzaOrders.check(A.args({ background: true }));
  const tagA = data.alzaPurchasesSync["alza_cz:account"];
  data.alzaCashbackReminders = { alza_cz_500: { url: "x", domain: "alza_cz" }, alza_sk_444: { url: "y", domain: "alza_sk" } };
  data.alzaPurchasesSync["alza_cz:fails"] = 2;
  later(data);
  // Po každém zápisu: nový otisk nesmí být uložený zároveň s nákupy starého účtu
  const mixed = [];
  chrome.storage.onChanged.addListener(() => {
    const tag = data.alzaPurchasesSync?.["alza_cz:account"];
    if (tag && tag !== tagA && data.alzaPurchases?.alza_cz_500) mixed.push(tag);
  });

  await assert.rejects(() => AlzaOrders.check(B.args({ background: true })), /objednávky se nepodařilo načíst/);
  assert.deepEqual(mixed, []);
  const tagB = data.alzaPurchasesSync["alza_cz:account"];
  assert.notEqual(tagB, tagA);
  assert.deepEqual(Object.keys(data.alzaPurchases), ["alza_sk_444"], "nákupy starého účtu pryč, jiná Alza zůstává");
  assert.deepEqual(Object.keys(data.alzaCashbackReminders), ["alza_sk_444"]);
  // Čas úplného načtení a otisk aktivních objednávek jsou pryč – „beze změny“ na 6 hodin nehrozí
  assert.equal(data.alzaPurchasesSync.alza_cz, 0);
  assert.ok(Object.hasOwn(data.alzaPurchasesSync, "alza_cz"), "klíč domény zůstává – podle něj kontrola na pozadí ví, kde objednávky načítat");
  assert.equal(data.alzaPurchasesSync["alza_cz:mark"], undefined);
  assert.equal(data.alzaPurchasesSync["alza_cz:fails"], undefined);

  fail = false;
  later(data);
  const result = await AlzaOrders.check(B.args({ background: true }));
  assert.deepEqual(plain(result), { status: "synced", added: ["Zboží 900"] });
  assert.deepEqual(Object.keys(data.alzaPurchases).sort(), ["alza_cz_900", "alza_sk_444"]);
  assert.ok(data.alzaPurchasesSync.alza_cz > 0);
});

test("účty – Alza jen v kontejneru: otisk, který dlouho nikdo nepotvrdil, smí převzít stránka", async () => {
  const { AlzaOrders, data } = setupOrders();
  const A = accountA();
  const B = accountB();
  // Pozadí nikdy přihlášené nebylo – první otisk zapíše stránka
  assert.equal((await AlzaOrders.check(A.args())).status, "synced");
  assert.equal(data.alzaPurchasesSync["alza_cz:accountBy"], "page");
  const tagA = data.alzaPurchasesSync["alza_cz:account"];
  // Jiný kontejner hned poté: účet se nepřepne (jinak by se dva účty přepisovaly při každé návštěvě)
  later(data);
  assert.equal((await AlzaOrders.check(B.args())).status, "otherAccount");
  assert.ok(data.alzaPurchases.alza_cz_500);
  // Otisk naposledy potvrzen před víc než accountTrustHours (uživatel se v kontejneru přihlásil jinam)
  data.alzaPurchasesSync["alza_cz:accountAt"] = Date.now() - (AlzaOrders.accountTrustHours + 1) * HOUR;
  data.alzaPurchasesSync["alza_cz:otherProbe"] = 0;
  later(data);
  const result = await AlzaOrders.check(B.args());
  assert.deepEqual(plain(result), { status: "synced", added: ["Zboží 900"] });
  assert.notEqual(data.alzaPurchasesSync["alza_cz:account"], tagA);
  assert.deepEqual(Object.keys(data.alzaPurchases), ["alza_cz_900"]);
  // Stejný účet potvrzuje otisk nejvýš jednou za accountConfirmMinutes
  const confirmedAt = data.alzaPurchasesSync["alza_cz:accountAt"];
  later(data);
  await AlzaOrders.check(B.args());
  assert.equal(data.alzaPurchasesSync["alza_cz:accountAt"], confirmedAt);
  data.alzaPurchasesSync["alza_cz:accountAt"] = confirmedAt - (AlzaOrders.accountConfirmMinutes + 1) * MINUTE;
  later(data);
  await AlzaOrders.check(B.args());
  assert.ok(data.alzaPurchasesSync["alza_cz:accountAt"] >= confirmedAt, "potvrzení obnoveno");
});

test("účty – účet přepnutý během načítání objednávek: stránka čas úplného načtení nezapíše, pozadí načte svůj účet celý", async () => {
  const { AlzaOrders, AlzaStore, data } = setupOrders();
  const tagB = await AlzaOrders.getAccountTag(USER_B);
  // Stránka (účet A, první otisk) načítá objednávky; kontrola na pozadí mezitím uvidí účet B
  const A = accountA({ onArchive: () => AlzaStore.run({ type: "confirmAccount", domain: "alza_cz", tag: tagB, by: "bg" }) });
  const B = accountB();
  assert.equal((await AlzaOrders.check(A.args())).status, "synced");
  assert.equal(data.alzaPurchasesSync["alza_cz:account"], tagB);
  assert.equal(data.alzaPurchasesSync.alza_cz, 0, "úplné načtení účtu B se nepovažuje za hotové");
  later(data);
  const result = await AlzaOrders.check(B.args({ background: true }));
  assert.equal(result.status, "synced");
  assert.deepEqual(Object.keys(data.alzaPurchases), ["alza_cz_900"], "nákup účtu A zapsaný stránkou je pryč");
});

test("účty – operace confirmAccount a accountSalt: pozadí přepíná vždy, sůl vznikne jen jednou", async () => {
  const { AlzaStore, data } = setupOrders();
  const salt = "0123456789abcdef0123456789abcdef";
  assert.equal(await AlzaStore.run({ type: "accountSalt", salt }), salt);
  assert.equal(await AlzaStore.run({ type: "accountSalt", salt: "ffffffffffffffffffffffffffffffff" }), salt, "druhý návrh se nepoužije");
  assert.equal(await AlzaStore.run({ type: "accountSalt", salt: "krátká" }), salt);
  const now = Date.now();
  const confirm = (tag, by, at = now) => AlzaStore.run({ type: "confirmAccount", domain: "alza_cz", tag, by, trustMs: 26 * HOUR, now: at });
  assert.equal(await confirm("aaaa", "page"), "first");
  assert.equal(await confirm("aaaa", "bg", now + 1), "same");
  assert.deepEqual([data.alzaPurchasesSync["alza_cz:accountBy"], data.alzaPurchasesSync["alza_cz:accountAt"]], ["bg", now + 1]);
  assert.equal(await confirm("bbbb", "page", now + HOUR), "other");
  assert.equal(data.alzaPurchasesSync["alza_cz:account"], "aaaa");
  assert.equal(await confirm("bbbb", "bg", now + HOUR), "switched");
  assert.equal(await confirm("aaaa", "page", now + 2 * HOUR), "other", "i otisk potvrzený pozadím před hodinou stránka nepřepíše");
  assert.equal(await confirm("aaaa", "page", now + 28 * HOUR), "switched");
  // Neplatný otisk ani doména nic nezapíše
  assert.equal(await AlzaStore.run({ type: "confirmAccount", domain: "alza_cz", tag: "123456789", by: "bg" }), "same");
  assert.equal(await AlzaStore.run({ type: "confirmAccount", domain: "jinde", tag: "cccc", by: "bg" }), "same");
  assert.equal(data.alzaPurchasesSync["alza_cz:account"], "aaaa");
  assert.equal(data.alzaPurchasesSync.salt, salt);
});

test("objednávky – neúplné načtení se opakuje po 30 min nejvýš failedSyncMaxRetries×, pak platí na 6 hodin", async () => {
  const { AlzaCore, AlzaOrders, data } = setupOrders();
  // Detail objednávky 1001 se nenačte nikdy (HTTP 404)
  const api = account("alza_cz", USER_A, [order("alza_cz", USER_A, 1001, 2), order("alza_cz", USER_A, 1002, 3)], { 1002: detail(3, [item(600, "100 Kč/ks")]) });
  const fullMs = AlzaCore.purchaseSyncHours * HOUR;
  const dueIn = () => data.alzaPurchasesSync.alza_cz + fullMs - Date.now();
  const expire = () => {
    data.alzaPurchasesSync.alza_cz -= fullMs;
    later(data);
  };
  assert.ok(AlzaOrders.failedSyncMaxRetries >= 2);
  for (let attempt = 1; attempt < AlzaOrders.failedSyncMaxRetries; attempt++) {
    assert.equal((await AlzaOrders.check(api.args({ background: true }))).status, "synced");
    assert.ok(dueIn() <= AlzaOrders.failedSyncRetryMinutes * MINUTE + 1000, `${attempt}. neúplné načtení: další za 30 min`);
    assert.equal(data.alzaPurchasesSync["alza_cz:fails"], attempt);
    expire();
  }
  await AlzaOrders.check(api.args({ background: true }));
  assert.ok(dueIn() > fullMs - 1000, "poslední neúplné načtení platí na celých purchaseSyncHours");
  assert.equal(data.alzaPurchasesSync["alza_cz:fails"], 0, "počítá se znovu");
  // Úplné načtení počítadlo vynuluje
  expire();
  await AlzaOrders.check(api.args({ background: true }));
  assert.equal(data.alzaPurchasesSync["alza_cz:fails"], 1);
  api.calls.length = 0;
  expire();
  const complete = account("alza_cz", USER_A, [order("alza_cz", USER_A, 1002, 3)], { 1002: detail(3, [item(600, "100 Kč/ks")]) });
  await AlzaOrders.check(complete.args({ background: true }));
  assert.equal(data.alzaPurchasesSync["alza_cz:fails"], 0);
  assert.ok(dueIn() > fullMs - 1000);
});

// --- Moje nákupy ---

const ownedItem = (domainKey, id) => ({
  commodityId: id,
  commodityUrl: `/zbozi-d${id}.htm`,
  commodityImageUrl: `https://image.alza.cz/products/X${id}/X${id}.jpg`,
  commodityName: `Zboží ${id}`,
  status: "Vyzvednuto",
  count: 1,
  brand: "Značka",
  categorySegment1: "Audio-Video",
});
const ownedOrder = (domainKey, id, daysAgo) => ({ orderId: String(id), created: iso(daysAgo), state: "Vyřízena", totalPrice: "7 709 Kč", items: [ownedItem(domainKey, id)] });

// Archiv objednávek po účtech: accounts = { číslo účtu: [čísla objednávek] }; userId = kdo je právě přihlášený
function archive(domainKey, accounts) {
  const api = { userId: Object.keys(accounts)[0], offsets: [] };
  api.args = (extra = {}) => ({
    domainKey,
    origin: ORIGINS[domainKey],
    getUserId: async () => api.userId,
    getJson: async (url) => {
      const base = `${ORIGINS[domainKey]}/api/users/${api.userId}/v1/orders`;
      assert.ok(url.startsWith(`${base}/archive?`), `nečekaný dotaz: ${url}`);
      const query = new URL(url).searchParams;
      const offset = Number(query.get("offset"));
      api.offsets.push(offset);
      const orders = accounts[api.userId].map((id, index) => ownedOrder(domainKey, id, index + 1));
      return { paging: { size: orders.length }, value: orders.slice(offset, offset + Number(query.get("limit"))) };
    },
    ...extra,
  });
  return api;
}

test("Moje nákupy – jiný účet: nákupy dosavadního účtu stranou, po návratu zpět bez nového stahování", async () => {
  // Hlídání po nákupu vypnuté – sůl otisku musí vzniknout i tak
  const { AlzaCore, AlzaOwned, data } = setupOrders({
    alzaSettings: { watchPurchases: false, ownedItems: true },
    alzaOwned: { alza_sk_70: { url: "https://www.alza.sk/x-d70.htm", domain: "alza_sk", name: "Slovenské zboží", buys: [{ t: Date.now() - DAY, n: 1, o: "70" }] } },
    alzaOwnedOrders: { alza_sk: { 70: [Date.now() - DAY, 10] } },
    alzaOwnedSync: { alza_sk: { done: true, total: 1, offset: 0, at: Date.now() } },
  });
  AlzaCore.ownedDetailsPerRun = 0; // tady jen archiv
  const api = archive("alza_cz", { [USER_A]: [11, 12], [USER_B]: [21] });
  const keysOf = () => Object.keys(data.alzaOwned).sort();

  assert.deepEqual(plain(await AlzaOwned.sync(api.args())).added, 2);
  assert.match(data.alzaPurchasesSync.salt, /^[0-9a-f]{32}$/);
  const tagA = data.alzaOwnedSync.alza_cz.account;
  assert.match(tagA, /^[0-9a-f]{4}$/);
  assert.deepEqual(keysOf(), ["alza_cz_11", "alza_cz_12", "alza_sk_70"]);
  assert.equal(data.alzaOwnedAccounts, undefined);
  const syncA = plain(data.alzaOwnedSync.alza_cz);

  // Přihlášený účet B: nákupy A stranou pod jeho otiskem, B se načte od začátku
  api.userId = USER_B;
  api.offsets.length = 0;
  const second = await AlzaOwned.sync(api.args({ force: true }));
  assert.deepEqual([second.status, second.added, second.done], ["synced", 1, true]);
  assert.deepEqual(api.offsets, [0]);
  const tagB = data.alzaOwnedSync.alza_cz.account;
  assert.notEqual(tagB, tagA);
  assert.deepEqual(keysOf(), ["alza_cz_21", "alza_sk_70"], "nákupy účtu A v přehledu nejsou, jiná Alza zůstává");
  assert.deepEqual(Object.keys(data.alzaOwnedOrders.alza_cz), ["21"]);
  assert.deepEqual(Object.keys(data.alzaOwnedOrders.alza_sk), ["70"]);
  assert.deepEqual(Object.keys(data.alzaOwnedAccounts), [`alza_cz:${tagA}`]);
  const stash = plain(data.alzaOwnedAccounts[`alza_cz:${tagA}`]);
  assert.deepEqual(Object.keys(stash.owned).sort(), ["alza_cz_11", "alza_cz_12"]);
  assert.deepEqual(Object.keys(stash.orders).sort(), ["11", "12"]);
  assert.deepEqual(stash.sync, syncA);

  // Zpět k účtu A: jeho nákupy se vrátí z odložených, archiv se znovu nestahuje (je načtený čerstvě)
  api.userId = USER_A;
  api.offsets.length = 0;
  const third = await AlzaOwned.sync(api.args({ force: true, skipArchive: true }));
  assert.equal(third.added, 0);
  assert.deepEqual(api.offsets, [], "žádný dotaz do archivu");
  assert.deepEqual(keysOf(), ["alza_cz_11", "alza_cz_12", "alza_sk_70"]);
  assert.deepEqual(Object.keys(data.alzaOwnedOrders.alza_cz).sort(), ["11", "12"]);
  assert.equal(data.alzaOwnedSync.alza_cz.account, tagA);
  assert.equal(data.alzaOwnedSync.alza_cz.done, true);
  assert.deepEqual(Object.keys(data.alzaOwnedAccounts), [`alza_cz:${tagB}`], "teď je stranou účet B");
  // Číslo účtu se nikam neuložilo
  const stored = JSON.stringify(data);
  assert.ok(!stored.includes(USER_A) && !stored.includes(USER_B), "číslo účtu v úložišti");
});

test("Moje nákupy – účet, který už vidělo hlídání po nákupu na pozadí, se ověří hned (ne až s dalším načtením archivu)", async () => {
  const { AlzaCore, AlzaOwned, AlzaOrders, data } = setupOrders();
  AlzaCore.ownedDetailsPerRun = 0;
  const api = archive("alza_cz", { [USER_A]: [11], [USER_B]: [21] });
  await AlzaOwned.sync(api.args());
  // Detaily načtené – fronta detailů je prázdná, archiv čerstvý: další běh se přeskočí
  data.alzaOwned.alza_cz_11.buys[0].at = Date.now();
  data.alzaOwned.alza_cz_11.buys[0].dv = AlzaCore.ownedDetailVersion;
  api.userId = USER_B;
  assert.equal((await AlzaOwned.sync(api.args())).status, "skipped");
  assert.ok(data.alzaOwned.alza_cz_11, "bez podnětu se účet ověří až s načtením archivu");
  // Kontrola objednávek na pozadí potvrdila na doméně otisk účtu B
  const tagB = await AlzaOrders.getAccountTag(USER_B);
  Object.assign(data.alzaPurchasesSync, { "alza_cz:account": tagB, "alza_cz:accountBy": "bg", "alza_cz:accountAt": Date.now() + 1000 });
  const result = await AlzaOwned.sync(api.args());
  assert.deepEqual([result.status, result.added], ["synced", 1]);
  assert.deepEqual(Object.keys(data.alzaOwned), ["alza_cz_21"]);
});

test("Moje nákupy – operace switchOwnedAccount: připomínky konce záruky jen pro aktuální účet, odložených účtů omezeně", async () => {
  const now = Date.now();
  const { AlzaCore, AlzaStore, data } = setupOrders();
  // Záruka končí za 10 dní, detail načtený včera, zboží za 5 000 Kč – připomínka by přišla
  const boughtAt = AlzaCore.addMonths(now, -AlzaCore.warrantyMonths) + 10 * DAY;
  data.alzaOwned = {
    alza_cz_11: { url: "https://www.alza.cz/x-d11.htm", domain: "alza_cz", name: "Televize", buys: [{ t: boughtAt, n: 1, o: "11", p: 5000, claim: true, at: now - DAY }] },
  };
  data.alzaOwnedOrders = { alza_cz: { 11: [boughtAt, 5000] } };
  data.alzaOwnedSync = { alza_cz: { done: true, total: 1, offset: 0, at: now, account: "aaaa" } };
  assert.equal(AlzaCore.getWarrantyReminders(data.alzaOwned, now).length, 1);

  assert.equal(await AlzaStore.run({ type: "switchOwnedAccount", domain: "alza_cz", tag: "aaaa" }), false, "stejný účet");
  assert.equal(await AlzaStore.run({ type: "switchOwnedAccount", domain: "alza_cz", tag: "bbbb" }), true);
  assert.deepEqual(plain(data.alzaOwned), {});
  assert.deepEqual(plain(data.alzaOwnedSync.alza_cz), { account: "bbbb" });
  assert.equal(AlzaCore.getWarrantyReminders(data.alzaOwned, now).length, 0, "záruka zboží jiného účtu se nepřipomíná");
  assert.equal(await AlzaStore.run({ type: "switchOwnedAccount", domain: "alza_cz", tag: "aaaa" }), true);
  assert.equal(AlzaCore.getWarrantyReminders(data.alzaOwned, now).length, 1);
  assert.equal(data.alzaOwned.alza_cz_11.buys[0].p, 5000);

  // Bez dosavadního otisku (nákupy načtené starší verzí) se nic neodkládá – otisk zapíše načtení archivu
  delete data.alzaOwnedSync.alza_cz.account;
  assert.equal(await AlzaStore.run({ type: "switchOwnedAccount", domain: "alza_cz", tag: "cccc" }), false);
  assert.ok(data.alzaOwned.alza_cz_11);

  // Vystřídaných účtů víc: nejdéle odložené se mažou
  data.alzaOwnedAccounts = {};
  data.alzaOwnedSync.alza_cz.account = "0000";
  for (const [index, tag] of ["0001", "0002", "0003", "0004", "0005", "0006"].entries()) {
    assert.equal(await AlzaStore.run({ type: "switchOwnedAccount", domain: "alza_cz", tag, now: now + index }), true);
  }
  assert.deepEqual(Object.keys(data.alzaOwnedAccounts).sort(), ["alza_cz:0002", "alza_cz:0003", "alza_cz:0004", "alza_cz:0005"]);
});

test("Moje nákupy – odložené účty se mažou se „Smazat načtené nákupy“ i se „Smazat všechna data“ a nejsou v záloze", () => {
  const { AlzaCore, context } = loadCore({ files: ["src/options/options-backup.js"] });
  const OptionsData = vm.runInContext("OptionsData", context);
  const key = AlzaCore.storageKeys.ownedAccounts;
  assert.equal(key, "alzaOwnedAccounts");
  assert.ok(OptionsData.WIPE_KEYS.includes(key));
  assert.ok(!OptionsData.BACKUP_KEYS.includes(key));
  assert.ok(Object.hasOwn(OptionsData.NOT_BACKED_UP, key));
  // Tlačítko „Smazat načtené nákupy“ (options-owned.js)
  const remove = read("src/options/options-owned.js").match(/getElementById\("ownedDelete"\)[\s\S]*?type: "remove", keys: \[([^\]]*)\]/);
  assert.ok(remove, "mazání načtených nákupů ve zdrojáku");
  assert.match(remove[1], /AlzaCore\.storageKeys\.ownedAccounts/);
});

// === Kontrola na pozadí ===

const BASE_SETTINGS = { quietHours: false, watchPurchases: false, ownedItems: false };
const QUIET_SETTINGS = { ...BASE_SETTINGS, quietHours: true, quietFrom: "00:00", quietTo: "23:59" };
const product = (domain, id) => ({ url: `${ORIGINS[domain]}/p-d${id}.htm`, name: `P${id}`, domain, image: null });
const watchOf = (...products) => Object.fromEntries(products.map((entry) => [entry.url, entry]));
const okPage = (price, extra = {}) => ({ ok: true, saveProblem: null, vatSignMissing: false, isProduct: true, name: "x", image: null, prices: { original: price }, availability: "Skladem", ...extra });
const pendingChange = (id, name, extra = {}) => ({ name, url: `https://www.alza.cz/x-d${id}.htm`, image: null, listUrl: null, domain: "alza_cz", lang: "cz", lines: [`${name} zlevnil`], ...extra });

// Služba na pozadí se stránkami produktů z fetchPage(url); calls = stažené adresy, alarms = vytvořené alarmy
function startBackground({ storage = {}, fetchPage = () => okPage(100), alarms = {} } = {}) {
  const bg = loadBackground({ storage: { alzaSettings: BASE_SETTINGS, ...storage }, alarms });
  const calls = [];
  bg.context.ProductPages.fetch = async (url) => {
    calls.push(url.replace("https://www.", ""));
    return fetchPage(url);
  };
  Object.assign(bg.get("config"), { delayBetweenProductsMs: 0, fetchRetryDelayMs: 0 });
  const created = [];
  bg.chrome.alarms.create = async (name, options) => void created.push([name, options]);
  return { bg, calls, created, state: () => plain(bg.data.alzaWatchState || {}) };
}
const sendMessage = (bg, message, sender = {}) => new Promise((resolve) => bg.chrome.runtime.onMessage.list[0](message, sender, resolve) || resolve(undefined));

test("běh – odhlášení na jedné doméně přeskočí jen její produkty, ostatní domény se zkontrolují", async () => {
  const watch = watchOf(product("alza_sk", 1), product("alza_cz", 2), product("alza_sk", 3), product("alza_cz", 4));
  const { bg, calls, state } = startBackground({
    storage: { alzaWatchProducts: watch },
    fetchPage: (url) => (url.includes("alza.sk") ? okPage(10, { saveProblem: "notifyProblemNotLogged" }) : okPage(100)),
  });
  await bg.ready;
  await bg.context.runWatch({ force: true, trigger: "manual" });
  assert.deepEqual(calls, ["alza.sk/p-d1.htm", "alza.cz/p-d2.htm", "alza.cz/p-d4.htm"], "druhý slovenský produkt se nestahuje, české ano");
  const { alert, checked, problems } = state();
  assert.deepEqual([alert.reason, alert.domain, alert.others], ["notifyProblemNotLogged", "alza_sk", undefined]);
  assert.equal(alert.message, bg.AlzaCore.translate("sk", "notifyProblemNotLogged"));
  assert.equal(checked, 3);
  assert.equal(problems.length, 1);
  assert.equal(Object.keys(bg.data).filter((key) => key.startsWith("alzaHistory_alza_cz")).length, 2, "historie českých produktů zapsána");
  assert.equal(bg.data.alzaWatchLog[0].aborted, true);
  assert.deepEqual(bg.errors, []);
});

test("běh – dvě odhlášené domény: upozornění pro každou, kontrola po přihlášení pro každou zvlášť", async () => {
  const watch = watchOf(product("alza_sk", 1), product("alza_cz", 2), product("alza_hu", 3), product("alza_sk", 4), product("alza_cz", 5));
  const logged = { sk: false, hu: false };
  const { bg, calls, state } = startBackground({
    storage: { alzaWatchProducts: watch },
    fetchPage: (url) => {
      const out = (url.includes("alza.sk") && !logged.sk) || (url.includes("alza.hu") && !logged.hu);
      return out ? okPage(10, { saveProblem: "notifyProblemNotLogged" }) : okPage(100);
    },
  });
  await bg.ready;
  await bg.context.runWatch({ force: true, trigger: "manual" });
  assert.deepEqual(calls, ["alza.sk/p-d1.htm", "alza.cz/p-d2.htm", "alza.hu/p-d3.htm", "alza.cz/p-d5.htm"]);
  const first = state().alert;
  assert.deepEqual([first.reason, first.domain], ["notifyProblemNotLogged", "alza_sk"]);
  assert.deepEqual(first.others.map(({ reason, domain }) => [reason, domain]), [["notifyProblemNotLogged", "alza_hu"]]);
  assert.ok(first.since > 0 && first.others[0].since === first.since);

  // Další běh se stejným stavem: čas „od kdy“ drží každá doména zvlášť
  bg.data.alzaWatchState.alert.since = 1000;
  bg.data.alzaWatchState.alert.others[0].since = 2000;
  await bg.context.runWatch({ force: true, trigger: "manual" });
  assert.deepEqual([state().alert.since, state().alert.others[0].since], [1000, 2000]);

  // Přihlášení na alza.hu (druhá odhlášená doména): stránka pošle watchLoginSeen → kontrola hned
  const idle = () => !bg.get("running") && !bg.data.alzaWatchState.running;
  const runs = () => bg.data.alzaWatchLog.length;
  logged.hu = true;
  let before = runs();
  await sendMessage(bg, { action: "watchLoginSeen", domain: "alza_hu" }, { tab: { id: 1 } });
  await until(() => runs() === before + 1 && idle(), "kontrola po přihlášení na alza.hu");
  assert.equal(bg.data.alzaWatchLog[0].trigger, "login");
  let alert = state().alert;
  assert.deepEqual([alert.reason, alert.domain, alert.others, alert.since], ["notifyProblemNotLogged", "alza_sk", undefined, 1000]);
  // Česká doména odhlášená není, anonymní okno a kontejner se nepočítají – nic se nespustí
  before = runs();
  await sendMessage(bg, { action: "watchLoginSeen", domain: "alza_cz" }, { tab: { id: 1 } });
  await sendMessage(bg, { action: "watchLoginSeen", domain: "alza_sk" }, { tab: { id: 2, incognito: true } });
  await sendMessage(bg, { action: "watchLoginSeen", domain: "alza_sk" }, { tab: { id: 3, cookieStoreId: "firefox-container-1" } });
  await sleep(50);
  assert.equal(runs(), before);
  // Přihlášení na alza.sk hned poté: vlastní čas opakování, nečeká na 10 min od alza.hu
  logged.sk = true;
  await sendMessage(bg, { action: "watchLoginSeen", domain: "alza_sk" }, { tab: { id: 1 } });
  await until(() => runs() === before + 1 && idle(), "kontrola po přihlášení na alza.sk");
  alert = state().alert;
  assert.equal(alert, null);
  assert.deepEqual(Object.keys(state().loginRetryAt).sort(), ["alza_hu", "alza_sk"]);
  assert.deepEqual(bg.errors, []);
});

test("běh – kontrola po přihlášení: nejvýš jednou za 10 min na doménu, číslo ze starší verze platí dál", async () => {
  const { bg, state } = startBackground({
    storage: { alzaWatchProducts: watchOf(product("alza_cz", 2)) },
    fetchPage: () => okPage(10, { saveProblem: "notifyProblemNotLogged" }),
  });
  await bg.ready;
  await bg.context.runWatch({ force: false, trigger: "alarm" });
  const idle = () => !bg.get("running") && !bg.data.alzaWatchState.running;
  const runs = () => bg.data.alzaWatchLog.length;
  const login = () => sendMessage(bg, { action: "watchLoginSeen", domain: "alza_cz" }, { tab: { id: 1 } });
  await login();
  await until(() => runs() === 2 && idle(), "první kontrola po přihlášení");
  await login();
  await sleep(50);
  assert.equal(runs(), 2, "do 10 minut znovu ne");
  // Stav ze starší verze: loginRetryAt je číslo
  bg.data.alzaWatchState.loginRetryAt = Date.now();
  await login();
  await sleep(50);
  assert.equal(runs(), 2);
  bg.data.alzaWatchState.loginRetryAt = Date.now() - 11 * MINUTE;
  await login();
  await until(() => runs() === 3 && idle(), "kontrola po 11 minutách");
  assert.equal(typeof state().loginRetryAt.alza_cz, "number");
});

test("běh – timeout a chyba sítě se počítají do jističe běhu, 404 ne", async () => {
  const many = watchOf(...Array.from({ length: 10 }, (_, index) => product("alza_cz", 100 + index)));
  {
    const { bg, calls, state } = startBackground({ storage: { alzaWatchProducts: many }, fetchPage: () => ({ ok: false, status: 0, error: "timeout" }) });
    await bg.ready;
    await bg.context.runWatch({ force: true, trigger: "manual" });
    // 3 produkty × 2 pokusy (fetchProduct opakuje přechodnou chybu jednou)
    assert.equal(calls.length, 3 * 2);
    assert.deepEqual([state().alert.reason, state().problems.length, bg.data.alzaWatchLog[0].aborted], ["blocked", 3, true]);
  }
  {
    const { bg, calls, state } = startBackground({ storage: { alzaWatchProducts: many }, fetchPage: () => ({ ok: false, status: 404, error: "HTTP 404" }) });
    await bg.ready;
    await bg.context.runWatch({ force: true, trigger: "manual" });
    assert.equal(calls.length, 10);
    assert.equal(state().alert, null);
  }
  {
    // Přesměrování mimo Alzu (status 0, offsite) není výpadek
    const { bg, calls, state } = startBackground({ storage: { alzaWatchProducts: many }, fetchPage: () => ({ ok: false, status: 0, offsite: true, error: "přesměrováno mimo Alzu" }) });
    await bg.ready;
    await bg.context.runWatch({ force: true, trigger: "manual" });
    assert.equal(calls.length, 10);
    assert.equal(state().alert, null);
  }
});

test("běh – dvojí klik na Zkontrolovat při dojezdu běhu spustí jen jeden další běh", async () => {
  const watch = watchOf(product("alza_cz", 1), product("alza_cz", 2));
  const { bg, calls } = startBackground({ storage: { alzaWatchProducts: watch } });
  await bg.ready;
  // Dojezd běhu (Moje nákupy, připomínky) trvá – drží ho brána
  const gates = [];
  let tails = 0;
  bg.context.syncOwned = () => {
    tails++;
    return new Promise((resolve) => gates.push(resolve));
  };
  // Dokončování běhu (návrh čistky čte celé úložiště) – první klik přijde během něj
  const realCleanup = bg.context.updateCleanup;
  let holdCleanup = null;
  let cleanupReached = null;
  const reached = new Promise((resolve) => (cleanupReached = resolve));
  bg.context.updateCleanup = async () => {
    if (holdCleanup === null) {
      cleanupReached();
      await new Promise((resolve) => (holdCleanup = resolve));
    }
    return realCleanup();
  };
  const click = () => bg.chrome.runtime.onMessage.list[0]({ action: "watchRunNow" }, {}, () => {});
  const runs = () => (bg.data.alzaWatchLog || []).length;

  bg.context.runWatch({ force: false, trigger: "alarm" });
  await reached;
  assert.equal(bg.get("running"), true);
  click(); // 1. klik: služba běh ještě dokončuje – zapamatuje si ho
  assert.equal(bg.get("manualRunRequested"), true);
  holdCleanup();
  await until(() => tails === 1, "dojezd prvního běhu");
  assert.equal(bg.get("running"), false);
  click(); // 2. klik během dojezdu: běh na vyžádání začne hned a první klik tím vyřídí
  await until(() => tails === 2, "dojezd druhého běhu");
  assert.equal(bg.get("manualRunRequested"), false);
  gates.forEach((release) => release());
  await sleep(100);
  await until(() => !bg.get("running"), "konec běhů");
  assert.equal(runs(), 2, "plánovaný běh + jeden na vyžádání");
  assert.deepEqual(bg.data.alzaWatchLog.map((run) => run.trigger), ["manual", "alarm"]);
  assert.equal(tails, 2);
  assert.equal(calls.length, 4);
  assert.deepEqual(bg.errors, []);
});

// --- Odložené a nedoručené notifikace ---

test("start služby – odložené notifikace bez alarmu se odešlou hned, v tichých hodinách se naplánuje jejich konec", async () => {
  const stateOf = (extra = {}) => ({ lastRunEnd: Date.now() - HOUR, pendingNotifications: [pendingChange(1, "A")], ...extra });
  {
    // Mimo tiché hodiny a alarm alzaQuietEnd chybí (Firefox po restartu alarmy nedrží)
    const { bg, state } = startBackground({ storage: { alzaWatchState: stateOf({ quietEndAt: Date.now() - HOUR }) } });
    await bg.ready;
    assert.deepEqual(bg.notifications.created.map(({ options }) => options.title), ["A"]);
    assert.deepEqual(state().pendingNotifications, []);
    assert.equal(state().quietEndAt, undefined, "značka čekání na konec tichých hodin je vyřízená");
  }
  {
    // V tichých hodinách: nic se neposílá, alarm konce tichých hodin se naplánuje znovu
    const bg = loadBackground({ storage: { alzaSettings: QUIET_SETTINGS, alzaWatchState: stateOf() } });
    const created = [];
    bg.chrome.alarms.create = async (name, options) => void created.push([name, options]);
    await bg.ready;
    assert.equal(bg.notifications.created.length, 0);
    assert.equal(bg.data.alzaWatchState.pendingNotifications.length, 1);
    const quietEnd = created.find(([name]) => name === "alzaQuietEnd");
    assert.ok(quietEnd, "alarm alzaQuietEnd");
    assert.equal(bg.data.alzaWatchState.quietEndAt, quietEnd[1].when);
  }
  {
    // Alarm ještě existuje (Chrome je drží, služba se jen probudila) – odešle to on, ne start služby
    const { bg, state } = startBackground({ storage: { alzaWatchState: stateOf() }, alarms: { alzaQuietEnd: { scheduledTime: Date.now() + 1000 } } });
    await bg.ready;
    assert.equal(bg.notifications.created.length, 0);
    assert.equal(state().pendingNotifications.length, 1);
  }
  {
    // Nedoručené notifikace s běžícím alarmem dalšího pokusu se při probuzení služby také nechají být
    const { bg, state } = startBackground({ storage: { alzaWatchState: stateOf({ pendingNotifications: [pendingChange(1, "A", { attempts: 1 })] }) }, alarms: { alzaNotifyRetry: { scheduledTime: Date.now() + 1000 } } });
    await bg.ready;
    assert.equal(bg.notifications.created.length, 0);
    assert.deepEqual(state().pendingNotifications.map(({ attempts }) => attempts), [1]);
  }
});

test("start služby – připomínky, které čekaly na konec tichých hodin, se po startu zpracují i bez fronty notifikací", async () => {
  const now = Date.now();
  // Zboží, kterému končí záruka (připomínka je na řadě) – bez názvu: titulek notifikace je název rozšíření
  const boughtAt = now - 2 * 365 * DAY + 10 * DAY;
  const owned = { alza_cz_11: { url: "https://www.alza.cz/x-d11.htm", domain: "alza_cz", name: "", buys: [{ t: boughtAt, n: 1, o: "11", p: 5000, claim: true, at: now - DAY }] } };
  const settings = { ...BASE_SETTINGS, ownedItems: true, remindWarranty: true };
  {
    const { bg, state } = startBackground({ storage: { alzaSettings: settings, alzaOwned: owned, alzaWatchState: { lastRunEnd: now - HOUR, quietEndAt: now - HOUR } } });
    await bg.ready;
    assert.equal(bg.notifications.created.length, 1);
    assert.equal(bg.notifications.created[0].options.title, "AllyZap", "ne „Alza“ – notifikace není od Alzy");
    assert.equal(bg.data.alzaOwned.alza_cz_11.buys[0].notified, true);
    assert.equal(state().quietEndAt, undefined);
  }
  {
    // Bez značky se připomínky při každém startu služby nezpracovávají (pošle je konec běhu kontroly)
    const { bg } = startBackground({ storage: { alzaSettings: settings, alzaOwned: owned, alzaWatchState: { lastRunEnd: now - HOUR } } });
    await bg.ready;
    assert.equal(bg.notifications.created.length, 0);
  }
  {
    // V tichých hodinách se připomínka odloží: alarm + značka ve stavu
    const { bg, created } = startBackground({ storage: { alzaSettings: { ...settings, ...QUIET_SETTINGS, ownedItems: true }, alzaOwned: owned } });
    await bg.ready;
    await bg.context.processWarrantyReminders();
    assert.equal(bg.notifications.created.length, 0);
    const quietEnd = created.find(([name]) => name === "alzaQuietEnd");
    assert.ok(quietEnd);
    assert.equal(bg.data.alzaWatchState.quietEndAt, quietEnd[1].when);
  }
});

test("start služby – deník přerušeného běhu v tichých hodinách: změny do fronty a alarm jejich konce", async () => {
  const journal = [{ ...product("alza_cz", 2), lang: "cz", textLang: "cz", listUrl: null, listName: null, price: 900, changes: [{ kind: "target", text: "Cílová cena dosažena" }] }];
  const bg = loadBackground({ storage: { alzaSettings: QUIET_SETTINGS, alzaWatchState: { running: true, lastRunStart: Date.now() - MINUTE, journal } } });
  const created = [];
  bg.chrome.alarms.create = async (name) => void created.push(name);
  await bg.ready;
  assert.equal(bg.notifications.created.length, 0);
  assert.equal(bg.data.alzaWatchState.pendingNotifications.length, 1);
  assert.ok(created.includes("alzaQuietEnd"));
  assert.deepEqual(bg.errors, []);
});

test("nedoručené notifikace – další pokus za pár minut (alarm alzaNotifyRetry), počet pokusů se nepřenáší na novou změnu", async () => {
  const { bg, created, state } = startBackground();
  await bg.ready;
  bg.data.alzaWatchState = { ...bg.data.alzaWatchState, pendingNotifications: [pendingChange(1, "A")] };
  bg.notifications.fail = () => true;
  const started = Date.now();
  await bg.context.flushPendingNotifications();
  assert.deepEqual(state().pendingNotifications.map(({ name, attempts }) => [name, attempts]), [["A", 1]]);
  const retry = created.find(([name]) => name === "alzaNotifyRetry");
  assert.ok(retry, "alarm dalšího pokusu");
  const delay = retry[1].when - started;
  assert.ok(delay >= bg.get("config.notifyRetryMs") && delay < bg.get("config.notifyRetryMs") + 5000, `další pokus za ${delay} ms`);
  // Alarm doručí notifikaci, jakmile ji prohlížeč přijme
  bg.notifications.fail = null;
  bg.chrome.alarms.onAlarm.list[0]({ name: "alzaNotifyRetry" });
  await until(() => bg.notifications.created.length === 1, "doručení po alarmu");
  await until(() => state().pendingNotifications.length === 0, "prázdná fronta");

  // Sloučení záznamů téhož produktu: nová změna dostane plný počet pokusů
  const merge = bg.context.mergeNotifications;
  const failed = pendingChange(1, "A", { attempts: 2 });
  const fresh = { ...pendingChange(1, "A"), lines: ["A je skladem"] };
  assert.deepEqual(plain(merge([failed, fresh])).map(({ lines, attempts }) => [lines, attempts]), [[["A zlevnil", "A je skladem"], undefined]]);
  assert.deepEqual(plain(merge([fresh, failed])).map(({ attempts }) => attempts), [undefined]);
  assert.deepEqual(plain(merge([failed, pendingChange(1, "A", { attempts: 1 })])).map(({ attempts }) => attempts), [1]);
  assert.deepEqual(plain(merge([failed, pendingChange(2, "B")])).map(({ name, attempts }) => [name, attempts]), [["A", 2], ["B", undefined]]);
});

test("popup – text pro nedoručené notifikace, upozornění jmenuje doménu a „Zkontrolovat znovu“ posílá zprávu rovnou", () => {
  const source = read("src/popup/popup.js");
  for (const key of ["pendingRetry", "alertSinceDomain"]) {
    const texts = [...source.matchAll(new RegExp(`^    ${key}: "(.*)",$`, "gm"))].map((match) => match[1]);
    assert.equal(texts.length, 4, `${key} ve 4 jazycích`);
    assert.equal(new Set(texts).size, 4, `${key}: každý jazyk vlastní text`);
    texts.forEach((text) => assert.ok(text.includes("{0}") && (key !== "alertSinceDomain" || text.includes("{1}")), `${key}: parametry v „${text}“`));
  }
  // Nedoručené se poznají podle attempts a nepočítají se mezi „odložené do konce tichých hodin“
  assert.match(source, /item\?\.attempts > 0/);
  assert.match(source, /t\("pendingRetry", undelivered\)/);
  assert.match(source, /t\("pending", queued\.length - undelivered\)/);
  // „Zkontrolovat znovu“: zpráva službě na pozadí, ne click() na hlavní tlačítko (to může být vypnuté)
  assert.doesNotMatch(source, /runWatchNowButton\.click\(\)/);
  assert.match(source, /retry\.onclick = \(\) => \{\s*runWatchNowButton\.disabled = true;\s*sendToBackground\(\{ action: "watchRunNow" \}\);/);
  // Další odhlášené domény (alert.others) čte popup i kontrola po přihlášení
  assert.match(source, /alert\.others/);
  assert.match(read("src/login-check.js"), /state\.alert\.others/);
});

// --- Deník běhu ---

test("deník běhu – nese stav cílové ceny a ohlášenou cenu po nákupu; po přerušení se zapíšou a nic se neohlásí dvakrát", async () => {
  const now = Date.now();
  const watched = product("alza_cz", 77);
  const key = "alza_cz_77";
  const probe = loadBackground({});
  await probe.ready;
  const historyKey = probe.AlzaCore.getHistoryKey("alza_cz", watched.url);
  const history = [{ t: now - 3 * DAY, s: now - 2 * HOUR, p: { original: 1200 }, a: "in" }];
  const storage = () => ({
    alzaSettings: { ...BASE_SETTINGS, watchPurchases: true },
    alzaWatchProducts: watchOf(watched),
    alzaTargets: { [key]: { ...watched, price: 1000, below: false } },
    alzaPurchases: { [key]: { ...watched, price: 1200, count: 1, boughtAt: now - 2 * DAY, returnUntil: now + 12 * DAY } },
    [historyKey]: history,
  });

  // 1) Běh, který změny zjistí – deník zachytíme tak, jak ho služba uložila v průběhu běhu
  const first = startBackground({ storage: storage(), fetchPage: () => okPage(900) });
  let journal = null;
  first.bg.chrome.storage.onChanged.addListener((changes) => {
    const saved = changes.alzaWatchState?.newValue?.journal;
    if (saved?.length) journal = plain(saved);
  });
  await first.bg.ready;
  await first.bg.context.runWatch({ force: true, trigger: "manual" });
  assert.ok(journal, "deník uložen během běhu");
  assert.deepEqual(journal[0].changes.map((change) => change.kind).filter((kind) => ["target", "purchase"].includes(kind)), ["target", "purchase"]);
  assert.deepEqual(journal[0].targetState, { price: 1000, below: true });
  assert.equal(journal[0].purchase.notifiedPrice, 900);
  assert.equal(first.bg.notifications.created.length, 1);
  const historyAfter = plain(first.bg.data[historyKey]);

  // 2) Totéž, ale běh se po zjištění změn přerušil (zavřený prohlížeč): stav cíle ani nákupu se neuložil
  const second = startBackground({
    storage: { ...storage(), [historyKey]: historyAfter, alzaWatchState: { running: true, lastRunStart: now - MINUTE, journal } },
    fetchPage: () => okPage(900),
  });
  await second.bg.ready;
  assert.equal(second.bg.notifications.created.length, 1, "změny z deníku ohlášeny po startu");
  assert.equal(second.bg.data.alzaTargets[key].below, true, "stav cílové ceny zapsán z deníku");
  assert.equal(second.bg.data.alzaPurchases[key].notifiedPrice, 900, "ohlášená cena po nákupu zapsána z deníku");
  await second.bg.context.runWatch({ force: true, trigger: "manual" });
  await second.bg.context.runWatch({ force: false, trigger: "alarm" });
  assert.equal(second.bg.notifications.created.length, 1, "další kontroly už nic neohlásí podruhé");
  assert.deepEqual(second.bg.errors, []);

  // 3) Deník zapsaný starší verzí (bez targetState): změna „target“ sama znamená cenu pod cílem
  const old = startBackground({
    storage: { ...storage(), [historyKey]: historyAfter, alzaWatchState: { running: true, lastRunStart: now - MINUTE, journal: journal.map(({ targetState, ...entry }) => entry) } },
    fetchPage: () => okPage(900),
  });
  await old.bg.ready;
  assert.equal(old.bg.data.alzaTargets[key].below, true);
  // Cíl mezitím změněný uživatelem se z deníku nepřepíše
  const changed = startBackground({
    storage: { ...storage(), alzaTargets: { [key]: { ...watched, price: 800, below: false } }, [historyKey]: historyAfter, alzaWatchState: { running: true, lastRunStart: now - MINUTE, journal } },
  });
  await changed.bg.ready;
  assert.equal(changed.bg.data.alzaTargets[key].below, false);
});

// === Úložiště: operace podle odesílatele ===

const CONTENT_SENDER = { tab: { id: 5 }, url: "https://www.alza.cz/televize/18849604.htm", id: "test" };
const EXTENSION_TAB = { tab: { id: 6 }, url: "chrome-extension://test/src/options/options.html", id: "test" };
const POPUP_SENDER = { url: "chrome-extension://test/src/popup/popup.html", id: "test" };

test("úložiště – content script smí jen vyjmenované operace a klíče, stránky rozšíření všechno", async () => {
  const { bg } = startBackground({ storage: { alzaTargets: { alza_cz_1: { price: 5 } } } });
  await bg.ready;
  const run = (op, sender) => sendMessage(bg, { action: "alzaStore", op }, sender);
  const keys = bg.AlzaCore.storageKeys;
  // Povolené: cílová cena, poznámka, úklid starých klíčů
  assert.equal((await run({ type: "patchMap", key: keys.targets, set: { alza_cz_2: { price: 9 } } }, CONTENT_SENDER)).ok, true);
  assert.equal((await run({ type: "patchMap", key: keys.notes, set: { alza_cz_2: { text: "x" } } }, CONTENT_SENDER)).ok, true);
  assert.equal((await run({ type: "remove", keys: ["alzaPrices_alza_cz_changes", "alzaProductInfo"] }, CONTENT_SENDER)).ok, true);
  assert.equal((await run({ type: "assign", key: keys.purchasesSync, values: { "alza_cz:probe": 1 } }, CONTENT_SENDER)).ok, true);
  // Zakázané: nastavení, smazání dat, import, Moje nákupy, stav kontroly
  const denied = [
    { type: "patchMap", key: keys.settings, set: { x: { y: 1 } } },
    { type: "assign", key: keys.settings, values: { watchPurchases: false } },
    { type: "assign", key: keys.watchState, values: { alert: null } },
    { type: "remove", keys: [keys.targets] },
    { type: "remove", keys: ["alzaProductInfo", keys.settings] },
    { type: "remove" },
    { type: "importData", items: { [keys.targets]: {} } },
    { type: "removeProducts", productKeys: ["alza_cz_1"] },
    { type: "removeStaleProducts", productKeys: ["alza_cz_1"] },
    { type: "mergeOwned", domain: "alza_cz", orders: [] },
    { type: "switchOwnedAccount", domain: "alza_cz", tag: "aaaa" },
    { type: "markOwnedNotified", items: [] },
    { type: "neznámá" },
    null,
  ];
  for (const op of denied) {
    const response = await run(op, CONTENT_SENDER);
    assert.equal(response.ok, false, `content script nesmí: ${JSON.stringify(op)}`);
    assert.match(response.error, /není ze stránky Alzy povolená/);
  }
  assert.equal(bg.data.alzaSettings.watchPurchases, false);
  assert.deepEqual(Object.keys(bg.data.alzaTargets).sort(), ["alza_cz_1", "alza_cz_2"]);
  // Odesílatel s adresou Alzy bez údaje o záložce se bere také jako stránka Alzy
  assert.equal((await run({ type: "remove", keys: [keys.targets] }, { url: "https://www.alza.sk/" })).ok, false);
  // Stránka rozšíření v záložce (nastavení, průvodce) i popup: bez omezení
  assert.equal((await run({ type: "assign", key: keys.settings, values: { minDropPercent: 7 } }, EXTENSION_TAB)).ok, true);
  assert.equal(bg.data.alzaSettings.minDropPercent, 7);
  assert.equal((await run({ type: "remove", keys: [keys.targets] }, POPUP_SENDER)).ok, true);
  assert.equal(bg.data.alzaTargets, undefined);
  assert.equal((await run({ type: "patchMap", key: keys.cashbackReminders, merge: {} }, {})).ok, true);
});

test("úložiště – každá operace, kterou content scripty volají, je pro ně povolená", () => {
  const { AlzaCore, context } = loadCore({ files: ["src/shared/store.js"] });
  const AlzaStore = context.AlzaStore;
  const scripts = JSON.parse(read("manifest.json")).content_scripts.flatMap((entry) => entry.js);
  assert.ok(scripts.includes("src/purchases.js") && scripts.includes("src/shared/orders.js") && scripts.includes("src/content.js"));
  const opNames = Object.keys(AlzaStore.ops);
  const found = [];
  for (const file of scripts) {
    let source = read(file);
    // Moje nákupy (AlzaOwned) běží jen ve službě na pozadí, i když je soubor načtený i na stránce Alzy
    if (file === "src/shared/orders.js") source = source.slice(0, source.indexOf("const AlzaOwned = {"));
    // Jména proměnných s klíčem úložiště: const storageKey = AlzaCore.storageKeys.watchLists
    const variables = {};
    for (const [, name, key] of source.matchAll(/(?:const|let)\s+(\w+)\s*=\s*AlzaCore\.storageKeys\.(\w+)/g)) (variables[name] ||= new Set()).add(key);
    // … a z rozkladu: const { purchases: purchasesKey, codes } = AlzaCore.storageKeys
    for (const [, names] of source.matchAll(/(?:const|let)\s+\{([^}]*)\}\s*=\s*AlzaCore\.storageKeys/g)) {
      names.split(",").map((part) => part.trim().split(/\s*:\s*/)).forEach(([key, alias = key]) => key && (variables[alias] ||= new Set()).add(key));
    }
    for (const [, type, expression] of source.matchAll(/\{\s*type:\s*"(\w+)"\s*,?\s*(?:key\b\s*(?::\s*([\w.]+))?)?/g)) {
      if (!opNames.includes(type)) continue;
      const usesKey = ["patchMap", "assign"].includes(type);
      if (!usesKey) {
        found.push({ file, type });
        continue;
      }
      const reference = expression || "key";
      const direct = reference.match(/^AlzaCore\.storageKeys\.(\w+)$/);
      const names = direct ? [direct[1]] : [...(variables[reference] || [])];
      assert.ok(names.length > 0, `${file}: klíč operace ${type} („${reference}“) nejde určit – zapište ho jako AlzaCore.storageKeys.<jméno> nebo proměnnou z něj`);
      names.forEach((name) => found.push({ file, type, key: AlzaCore.storageKeys[name], name }));
    }
  }
  // Sanity: sken našel známá volání ze všech druhů content scriptů
  const seen = (type, name) => found.some((entry) => entry.type === type && (!name || entry.name === name));
  [["mergePrices"], ["appendHistory"], ["recordBrowsing"], ["setWarranty"], ["recordVatCheck"], ["appendErrors"], ["remove"], ["accountSalt"], ["confirmAccount"]].forEach(([type]) =>
    assert.ok(seen(type), `sken našel volání ${type}`)
  );
  [["patchMap", "targets"], ["patchMap", "watchLists"], ["patchMap", "watchProducts"], ["patchMap", "vouchers"], ["patchMap", "notes"], ["patchMap", "hidden"], ["patchMap", "hiddenBrands"], ["patchMap", "energy"], ["patchMap", "purchases"], ["assign", "purchasesSync"]].forEach(
    ([type, name]) => assert.ok(seen(type, name), `sken našel ${type} na ${name}`)
  );
  for (const { file, type, key, name } of found) {
    const op = type === "remove" ? { type, keys: ["alzaProductInfo", "alzaPrices_alza_cz_changes"] } : { type, key };
    assert.ok(AlzaStore.allowsContent(op), `${file}: operace ${type}${name ? ` na ${name}` : ""} není v AlzaStore.contentOps`);
  }
  // A naopak: v seznamu nejsou operace ani klíče, které neexistují
  Object.entries(AlzaStore.contentOps).forEach(([type, rule]) => {
    assert.ok(opNames.includes(type), `contentOps: neznámá operace ${type}`);
    if (Array.isArray(rule)) rule.forEach((name) => assert.ok(AlzaCore.storageKeys[name], `contentOps.${type}: neznámý klíč ${name}`));
  });
  // Odesílatel: stránka Alzy × stránka rozšíření × volání uvnitř služby
  assert.equal(AlzaStore.isContentSender(CONTENT_SENDER), true);
  assert.equal(AlzaStore.isContentSender(EXTENSION_TAB), false);
  assert.equal(AlzaStore.isContentSender(POPUP_SENDER), false);
  assert.equal(AlzaStore.isContentSender(null), false);
  assert.equal(AlzaStore.isContentSender({ tab: { id: 1 } }), true);
});
