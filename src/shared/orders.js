// Hlídání po nákupu: koupené zboží z „Moje objednávky“ (posledních 14 dní, bez zrušených) do
// AlzaCore.storageKeys.purchases. Kontrola na pozadí ho pak hlídá do konce lhůty pro vrácení a při zlevnění
// upozorní („Koupili jste za X, teď stojí Y. Vrátit a koupit znovu ho můžete nejméně do D.“ – background.js checkPurchase).
// Objednávky se čtou stejným API jako stránka „Moje objednávky“ s přihlášením uživatele – ze stránky Alzy
// (purchases.js) i při kontrole na pozadí (background.js syncOrders). Číslo účtu se nikam neukládá, volající ho
// pokaždé zjistí ze stránky Alzy (getUserId).
// Úplné načtení nejvýš jednou za AlzaCore.purchaseSyncHours; mezitím nejvýš jednou za purchaseProbeMinutes jen seznam
// aktivních objednávek – změna (nová, zrušená, doručená objednávka) = hned úplné načtení.
const AlzaOrders = {
  maxOrders: 20,
  detailDelayMs: 300, // Rozestup dotazů na detaily objednávek, ať Alza nedostane dávku najednou
  retryMinutes: 3, // Po nepovedené kontrole (chyba, nepřihlášený) se další zkusí nejdřív za tuto dobu
  failedSyncRetryMinutes: 30, // Úplné načtení s nenačteným archivem / detailem se zopakuje za tuto dobu (ne za 6 h)
  failedSyncMaxRetries: 3, // Tolikáté neúplné načtení za sebou už platí na celých purchaseSyncHours (detail, který se nenačte nikdy)
  accountTrustHours: 26, // Otisk účtu potvrzený před kratší dobou stránka Alzy s jiným účtem nepřepíše (operace confirmAccount)
  accountConfirmMinutes: 60, // Potvrzení téhož otisku (kdo a kdy) se zapisuje nejvýš jednou za tuto dobu
  breakerErrors: 3, // Tolik nenačtených detailů za sebou ukončí dávku (createBreaker)

  // Jistič dávky dotazů na detaily objednávek (i pro AlzaOwned): po odpovědi HTTP 403 / 429 (Alza nebo její ochrana
  // dotazy odmítá) hned, jinak po breakerErrors chybách za sebou je open = true – volající dávku ukončí a zbytek
  // nechá na příště. Chyba z getJson má zprávu „HTTP <stav>“ (background.js fetchAlzaJson, purchases.js getJson)
  createBreaker() {
    const limit = this.breakerErrors;
    let errors = 0;
    const breaker = {
      open: false,
      ok() {
        errors = 0;
      },
      // error = výjimka z getJson (bez ní: odpověď přišla, ale nemá čekaný tvar). Vrací true u odmítnutí (403 / 429)
      // – to není chyba té jedné objednávky
      fail(error = null) {
        const refused = /^HTTP (?:403|429)\b/.test(String(error?.message || ""));
        errors++;
        if (refused || errors >= limit) breaker.open = true;
        return refused;
      },
    };
    return breaker;
  },

  // { domainKey, origin, getJson(url), getUserId(), always (bez omezení purchaseProbeMinutes), waitMs (před zjištěním
  // čísla účtu), background (true = kontrola na pozadí; jinak stránka Alzy – ta může běžet v kontejneru nebo
  // anonymním okně s jiným účtem, než jaký vidí pozadí) } → { status: "skipped" | "noLogin" | "otherAccount" |
  // "unchanged" | "synced", added: [názvy nově koupeného zboží], blocked (jen u "synced": true = dávka detailů
  // skončila předčasně – jistič; načtení se nepočítá jako úplné a zkusí se znovu při další kontrole) }.
  // "otherAccount" = stránka Alzy s jiným účtem, než jaký hlídání po nákupu sleduje (checkAccount): nic se nenačte
  // ani nesmaže – účet přepíná kontrola na pozadí, stránka až když otisk accountTrustHours nikdo nepotvrdil.
  // Chyba načtení objednávek se vyhodí. Po chybě i u nepřihlášeného se čas kontroly vrátí jen zčásti – další pokus
  // nejdřív za retryMinutes (ne při každém načtení stránky Alzy); always tu brzdu ignoruje
  async check({ domainKey, origin, getJson, getUserId, always = false, waitMs = 0, background = false }) {
    // Uložený stav: AlzaCore.storageKeys.purchasesSync
    const syncKey = AlzaCore.storageKeys.purchasesSync;
    const probeKey = `${domainKey}:probe`;
    const markKey = `${domainKey}:mark`;
    const failsKey = `${domainKey}:fails`;
    const otherKey = `${domainKey}:otherProbe`;
    const probeMs = AlzaCore.purchaseProbeMinutes * 60 * 1000;
    const readSync = () => this.readSync();
    const stored = await readSync();
    const previousProbe = Number(stored[probeKey]) || 0;
    if (!always && Date.now() - previousProbe < probeMs) return { status: "skipped", added: [] };
    // Stránka Alzy tu nedávno ukázala jiný účet (kontejner, anonymní okno): další stránky to chvíli nezkouší – každá
    // by čas kontroly zabrala a zase vrátila (dva zápisy na načtení stránky). Kontroly na pozadí se to netýká
    if (!always && !background && Date.now() - (Number(stored[otherKey]) || 0) < probeMs) return { status: "skipped", added: [] };

    // Zabrat čas kontroly hned – druhá záložka (nebo kontrola na pozadí) mezitím objednávky znovu nenačte. Kdo
    // zapsal poslední, kontroluje; ostatní skončí
    const claim = Date.now();
    const assign = (values) => AlzaStore.run({ type: "assign", key: syncKey, values });
    await assign({ [probeKey]: claim });
    // Nepovedená kontrola čas uvolní (jen dokud je zabraný námi), ale s brzdou: čas kontroly se posune tak, aby
    // další pokus přišel nejdřív za retryMinutes od tohoto. Úplné vrácení by znamenalo dotaz (u nepřihlášeného dva
    // zápisy do úložiště) při každém načtení stránky Alzy. Novější z obou časů – kontrola s always nesmí zkrátit
    // čekání, které už běželo
    const release = async () => {
      if ((await readSync())[probeKey] !== claim) return;
      const brake = claim - Math.max(0, probeMs - this.retryMinutes * 60 * 1000);
      await assign({ [probeKey]: Math.max(previousProbe, brake) });
    };
    try {
      if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
      // Stav znovu, ne ten ze začátku: během čekání mohla jiná kontrola zabrat čas kontroly nebo přepnout účet
      const fresh = await readSync();
      if (fresh[probeKey] !== claim) return { status: "skipped", added: [] };
      const userId = await getUserId(); // Jednou za kontrolu; číslo účtu jen v této proměnné a v adresách dotazů
      if (!userId) {
        await release(); // Nepřihlášený uživatel – zkusí se za chvíli
        return { status: "noLogin", added: [] };
      }
      // Jiný účet než minule (odhlášení a přihlášení jinam ve stejném profilu): nákupy předchozího účtu pryč a
      // úplné načtení hned – jinak by se k cizímu nákupu hlásilo zlevnění až do dalšího úplného načtení
      const tag = await this.getAccountTag(userId, fresh);
      const account = await this.checkAccount(domainKey, tag, fresh, background);
      if (account === "other") {
        // Čas kontroly vrátit celý (jen dokud je zabraný námi) – cizí účet nesmí brzdit kontrolu na pozadí
        const current = await readSync();
        await assign({ ...(current[probeKey] === claim && { [probeKey]: previousProbe }), [otherKey]: claim });
        return { status: "otherAccount", added: [] };
      }
      const accountChanged = account === "switched";
      const base = `${origin}/api/users/${userId}/v1/orders`;
      const active = await getJson(`${base}/active?productFilterType=0`).catch(() => null);
      const mark = this.mark(active);
      if (mark === null) throw new Error("objednávky se nepodařilo načíst");
      const fullDue = accountChanged || Date.now() - (Number(fresh[domainKey]) || 0) >= AlzaCore.purchaseSyncHours * 60 * 60 * 1000;
      if (!fullDue && mark === fresh[markKey]) return { status: "unchanged", added: [] };
      const { added, blocked, failed } = await this.sync({ domainKey, origin, base, getJson, active });
      // Účet během načítání přepnula jiná kontrola (pozadí × stránka Alzy v kontejneru): čas úplného načtení se
      // nezapíše – nejbližší kontrola hlídaného účtu načte objednávky celé a nákupy, které k němu nepatří, odstraní
      if (tag && (await readSync())[`${domainKey}:account`] !== tag) return { status: "synced", added };
      // Dávka ukončená jističem: čas úplného načtení ani otisk se nezapíšou – zbylé objednávky se načtou při další
      // kontrole (čas kontroly zůstává zabraný, tedy nejdřív za purchaseProbeMinutes)
      if (blocked) return { status: "synced", added, blocked: true };
      // Archiv nebo detail některé objednávky se nenačetl: úplné načtení se nepočítá na purchaseSyncHours, ale
      // zopakuje se už za failedSyncRetryMinutes (jinak by chybějící nákup čekal až 6 hodin)
      // Nejvýš failedSyncMaxRetries neúplných načtení za sebou: detail, který se nenačte nikdy (smazaná objednávka,
      // jiný tvar odpovědi), by jinak znamenal úplné načtení každou půlhodinu bez konce. Poslední z nich platí na
      // celých purchaseSyncHours a počítá se znovu
      const fullMs = AlzaCore.purchaseSyncHours * 60 * 60 * 1000;
      const failsBefore = accountChanged ? 0 : Number(fresh[failsKey]) || 0;
      const retry = failed && failsBefore + 1 < this.failedSyncMaxRetries;
      const syncedAt = retry ? Date.now() - fullMs + this.failedSyncRetryMinutes * 60 * 1000 : Date.now();
      const fails = retry ? failsBefore + 1 : 0;
      await assign({ [domainKey]: syncedAt, [markKey]: mark, ...((fails > 0 || failsBefore > 0) && { [failsKey]: fails }) });
      return { status: "synced", added };
    } catch (error) {
      await release().catch(() => {});
      throw error;
    }
  },

  // Otisk účtu: 4 hex znaky SHA-256 ze soli instalace a čísla účtu. Číslo účtu se neukládá a z otisku ho zpětně
  // určit nejde (na jeden otisk připadá ~15 000 devítimístných čísel) – stačí ale poznat, že se účet změnil
  // (shoda dvou různých účtů 1 : 65 536). Bez WebCrypto (nemělo by nastat) null = kontrola účtu se vynechá
  async accountTag(userId, salt) {
    if (!globalThis.crypto?.subtle || typeof TextEncoder !== "function") return null;
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${salt}:${userId}`));
    return [...new Uint8Array(digest).slice(0, 2)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  },

  // Uložený stav načítání objednávek (AlzaCore.storageKeys.purchasesSync)
  async readSync() {
    const syncKey = AlzaCore.storageKeys.purchasesSync;
    const { [syncKey]: sync } = await chrome.storage.local.get(syncKey);
    return sync && typeof sync === "object" && !Array.isArray(sync) ? sync : {};
  },

  // Otisk přihlášeného účtu (accountTag) se solí instalace. Sůl vznikne při prvním použití operací accountSalt –
  // jen jednou, i když ji souběžně chce stránka Alzy a služba na pozadí; potřebuje ji hlídání po nákupu i Moje
  // nákupy, vzniká proto i s vypnutým hlídáním po nákupu. stored = už načtený stav (purchasesSync). null = otisk
  // nejde spočítat (bez WebCrypto)
  async getAccountTag(userId, stored = null) {
    if (!globalThis.crypto?.subtle || !globalThis.crypto.getRandomValues) return null;
    const sync = stored || (await this.readSync());
    let salt = typeof sync.salt === "string" && sync.salt ? sync.salt : null;
    if (!salt) {
      const fresh = [...crypto.getRandomValues(new Uint8Array(16))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
      salt = await AlzaStore.run({ type: "accountSalt", salt: fresh });
    }
    return salt ? this.accountTag(String(userId), salt) : null;
  },

  // Je přihlášený stejný účet jako minule? tag = otisk přihlášeného účtu (getAccountTag; null = nejde určit, kontrola
  // se vynechá), stored = uložený stav. Vrací výsledek operace confirmAccount (store.js): "first" | "same" |
  // "switched" (jiný účet – nákupy domény, jejich připomínky cashbacku i čas úplného načtení jsou pryč, jedním
  // zápisem) | "other" (stránka Alzy s jiným účtem, než jaký byl nedávno potvrzen – nic se nezměnilo a nic se nemá
  // načítat). background = kontrola na pozadí: přepíná účet vždy. Stejný otisk se znovu potvrzuje (kdo a kdy)
  // nejvýš jednou za accountConfirmMinutes
  async checkAccount(domainKey, tag, stored, background = false) {
    if (!tag) return "same";
    const confirmedAt = Number(stored[`${domainKey}:accountAt`]) || 0;
    if (stored[`${domainKey}:account`] === tag && Date.now() - confirmedAt < this.accountConfirmMinutes * 60 * 1000) return "same";
    return AlzaStore.run({
      type: "confirmAccount",
      domain: domainKey,
      tag,
      by: background ? "bg" : "page",
      trustMs: this.accountTrustHours * 60 * 60 * 1000,
    });
  },

  // Poukazy z peněženky uplatněné v košíku, které se objevily ve slevovém řádku objednávky → použité (číslo objednávky
  // u poukazu = odkaz na ni v nastavení). orders = [{ created, orderNumber, lines }]
  async markVouchersUsed(domainKey, orders) {
    if (!orders.some((order) => order.lines.length > 0)) return;
    const key = AlzaCore.storageKeys.vouchers;
    const { [key]: stored } = await chrome.storage.local.get(key);
    const vouchers = stored && typeof stored === "object" ? structuredClone(stored) : {};
    const merge = {};
    orders.forEach((order) => {
      AlzaCore.matchVoucherUses(vouchers, domainKey, order).forEach(({ id, usedAt, usedOrder }) => {
        merge[id] = { usedAt, ...(usedOrder && { usedOrder }) };
        vouchers[id].usedAt = usedAt; // Další objednávka ho už nevezme
      });
    });
    if (Object.keys(merge).length > 0) await AlzaStore.run({ type: "patchMap", key, merge, existingOnly: true });
  },

  // Otisk aktivních objednávek (adresa + stav) – změní se s novou, zrušenou i doručenou objednávkou. Jen číslo
  // (hash), čísla objednávek se neukládají. null = odpověď nesedí
  mark(active) {
    if (!active || typeof active !== "object" || !Array.isArray(active.groups)) return null;
    const text = active.groups
      .flatMap((group) => (Array.isArray(group?.orders) ? group.orders : []))
      .map((order) => `${order?.self?.href || ""}|${order?.state || ""}`)
      .sort()
      .join("\n");
    let hash = 5381;
    for (let i = 0; i < text.length; i++) hash = ((hash * 33) ^ text.charCodeAt(i)) >>> 0;
    return hash.toString(36);
  },

  // Úplné načtení: aktivní (už načtené) + archiv, detail každé objednávky ve lhůtě (s rozestupem detailDelayMs).
  // Vrací { added: [názvy nově přidaného zboží], complete (úplný přehled objednávek za lhůtu – jen pak se mažou
  // nákupy, které v objednávkách už nejsou), blocked (dávku detailů ukončil jistič, zbylé objednávky se nenačetly) }
  async sync({ domainKey, origin, base, getJson, active }) {
    const since = Date.now() - AlzaCore.purchaseReturnDays * AlzaCore.dayMs;
    const archive = await getJson(`${base}/archive?productFilterType=0&offset=0&limit=${this.maxOrders}`).catch(() => null);
    const archived = Array.isArray(archive?.value) ? archive.value : [];
    // Načtení selhalo (síť, chyba serveru) – na rozdíl od complete: false u velkého počtu objednávek má smysl ho brzy zopakovat
    let failed = !Array.isArray(archive?.value);
    // Úplný přehled objednávek za lhůtu: obě načtení prošla a archiv nekončí uprostřed lhůty (víc než maxOrders)
    let complete =
      active !== null && typeof active === "object" && Array.isArray(archive?.value) &&
      (archived.length < this.maxOrders || archived.some((order) => Date.parse(order?.created) < since));
    const orders = [...archived, ...(Array.isArray(active?.groups) ? active.groups.flatMap((group) => group?.orders || []) : [])]
      // Archiv: value[]; aktivní objednávky: groups[].orders[]
      .filter((order) => Date.parse(order?.created) >= since && !AlzaCore.isCancelledOrder(order?.state) && typeof order?.self?.href === "string");

    const purchases = {};
    const voucherOrders = []; // Slevové řádky objednávek – použité poukazy z peněženky (markVouchersUsed)
    const breaker = this.createBreaker();
    let asked = 0;
    for (const order of orders) {
      let href = null;
      try {
        href = new URL(order.self.href, origin);
      } catch {
        // Poškozená adresa detailu – objednávka se přeskočí jako nenačtená
      }
      if (href?.origin !== origin) {
        complete = false;
        continue;
      }
      if (asked++ > 0) await new Promise((resolve) => setTimeout(resolve, this.detailDelayMs));
      let detail = null;
      let error = null;
      try {
        detail = await getJson(href.href);
      } catch (caught) {
        error = caught;
      }
      // Bez detailu objednávky by její zboží vypadalo jako zrušené. Totéž detail, který přišel, ale nemá parts
      // (změna API) – parseOrderPurchases by z něj nevrátil nic a všechny nákupy ve lhůtě by se smazaly jako stažené
      if (!detail || !Array.isArray(detail.parts)) {
        complete = false;
        failed = true;
        breaker.fail(error);
        if (breaker.open) break; // 403 / 429 nebo chyby za sebou – zbylé objednávky až příště
        continue;
      }
      breaker.ok();
      voucherOrders.push({ created: Date.parse(detail.created || order.created), orderNumber: detail.orderId ?? order.orderId ?? null, lines: AlzaCore.parseOrderVoucherLines(detail) });
      // Stejný produkt ve víc objednávkách: hlídá se nejnižší zaplacená cena a nejpozdější lhůta pro vrácení ze
      // všech jeho nákupů (i když je pozdější nákup dražší nebo stejně drahý – vrátit jde ještě ten). Čas nákupu
      // (boughtAt), název a kusy jdou s vybranou cenou: podle boughtAt se v historii hledá cena z doby nákupu
      // (AlzaCore.getPurchaseDrop), musí tedy patřit k nákupu, jehož cena se hlídá. Při stejné ceně pozdější nákup –
      // cena, čas nákupu i lhůta pak patří téže objednávce a výsledek nezávisí na pořadí objednávek v odpovědi
      // Každý nákup zvlášť v buys ({ price, boughtAt, returnUntil, count }) – AlzaCore.getPurchaseDrop vybere nákup,
      // který jde ještě vrátit a vrácení ušetří nejvíc (cena, čas i lhůta z téže objednávky). lastBoughtAt = nejnovější
      // nákup – totožnost záznamu pro notifiedPrice (nový nákup téhož zboží začíná bez upozornění)
      AlzaCore.parseOrderPurchases(detail, domainKey).forEach(({ key, ...purchase }) => {
        const previous = purchases[key];
        const cheaper = !previous || purchase.price < previous.price || (purchase.price === previous.price && purchase.boughtAt > previous.boughtAt);
        const buys = [...(previous?.buys || []), { price: purchase.price, boughtAt: purchase.boughtAt, returnUntil: purchase.returnUntil, count: purchase.count }].sort(
          (a, b) => (a.boughtAt || 0) - (b.boughtAt || 0)
        );
        purchases[key] = {
          ...(cheaper ? purchase : previous),
          domain: domainKey,
          returnUntil: Math.max(purchase.returnUntil, previous?.returnUntil || 0),
          buys,
          lastBoughtAt: Math.max(...buys.map((buy) => buy.boughtAt).filter(Number.isFinite), 0) || purchase.boughtAt,
        };
      });
    }
    const blocked = breaker.open;
    if (blocked) complete = false;
    await this.markVouchersUsed(domainKey, voucherOrders).catch((error) => console.error("Použité poukazy se nepodařilo označit:", error));

    // Prošlé lhůty této domény pryč; po úplném načtení i nákupy, které v objednávkách už nejsou (zrušená objednávka,
    // vrácené zboží po první synchronizaci). U stávajících zůstane, o jaké ceně už přišlo upozornění
    const key = AlzaCore.storageKeys.purchases;
    const { [key]: stored = {} } = await chrome.storage.local.get(key);
    const known = stored && typeof stored === "object" ? stored : {};
    const now = Date.now();
    const remove = [];
    const withdrawn = [];
    Object.entries(known).forEach(([entry, value]) => {
      if (value?.domain !== domainKey || purchases[entry]) return;
      if (!(value?.returnUntil > now)) remove.push(entry);
      else if (complete) {
        remove.push(entry);
        withdrawn.push(entry);
      }
    });
    if (Object.keys(purchases).length > 0 || remove.length > 0) {
      // notifiedPrice jen u téhož nákupu (stejný čas nákupu) – nový nákup téhož produktu začíná bez upozornění
      await AlzaStore.run({ type: "patchMap", key, set: purchases, remove, keep: ["notifiedPrice"], sameBy: ["lastBoughtAt", "boughtAt"] });
    }
    // Připomínka cashbacku ke zrušenému / vrácenému nákupu už neplatí
    if (withdrawn.length > 0) await AlzaStore.run({ type: "patchMap", key: AlzaCore.storageKeys.cashbackReminders, remove: withdrawn });
    const added = Object.entries(purchases).filter(([entry]) => !known[entry]).map(([, purchase]) => purchase.name || purchase.url);
    return { added, complete, blocked, failed };
  },
};

// Moje nákupy (volba ownedItems): všechno koupené z archivu „Moje objednávky“ do AlzaCore.storageKeys.owned – přehled
// koupeného zboží v nastavení, štítek „Koupili jste…“ na detailu a připomínka konce záruky. Běží jen ve službě na
// pozadí (background.js syncOwned). Číslo účtu se neukládá; u nákupu zůstává jen číslo objednávky (odkaz na ni).
//   1) archiv po stránkách od nejnovější: první načtení projde celou historii (po částech – ownedMaxPages na běh,
//      pokračuje od uloženého offsetu), další už jen nové objednávky (dokud stránka přináší něco nového)
//   2) detaily objednávek (cena kusu, „lze reklamovat“, vráceno) jen u nedávných nákupů a po dávkách
// Stav načítání domény (AlzaCore.storageKeys.ownedSync): { offset, done, total, at, fails: { "<číslo objednávky>":
// kolikrát se její detail nenačetl } } – fails zapisuje operace countOwnedDetailFails (store.js)
const AlzaOwned = {
  pageDelayMs: 300, // Rozestup dotazů, ať Alza nedostane dávku najednou
  detailFailLimit: 3, // Detail, který se tolikrát nenačetl, jde na konec fronty (sortQueue)

  // Fronta detailů (AlzaCore.getOwnedDetailQueue) s ohledem na počítadlo selhání: objednávky, jejichž detail se už
  // detailFailLimit-krát nenačetl, až za všechny ostatní – jinak by trvale selhávající detaily držely čelo fronty
  // a zbytek by se nenačetl nikdy. Nezahazují se: zkusí se znovu, až na ně dojde řada
  sortQueue(queue, fails) {
    const failing = (order) => Number(fails?.[order]) >= this.detailFailLimit;
    return [...queue.filter((order) => !failing(order)), ...queue.filter(failing)];
  },

  // { domainKey, origin, getJson(url), getUserId(), force (kliknutí v nastavení: hned a s větší dávkou detailů),
  //   skipArchive (další kolo téhož kliknutí: archiv, který je už načtený celý, se kvůli force znovu nestahuje – jen
  //   detaily; nedokončené první načtení archivu a pravidelné hledání nových objednávek po ownedSyncHours běží dál) }
  // → { status: "skipped" | "noLogin" | "synced" | "off", added (nové nákupy), details (načtené detaily), pending
  //   (detaily na příště), done (archiv načten celý), total (objednávek v archivu), blocked (jen u "synced": true =
  //   dávku detailů ukončil jistič – HTTP 403 / 429 nebo chyby za sebou; volající nemá hned pokračovat dalším kolem) }.
  //   "off" = uživatel během načítání vypnul volbu ownedItems nebo smazal načtené nákupy – skončilo se bez dalšího
  //   zápisu. Chyba načtení archivu se vyhodí
  async sync({ domainKey, origin, getJson, getUserId, force = false, skipArchive = false }) {
    const keys = AlzaCore.storageKeys;
    const read = async () => {
      const data = await chrome.storage.local.get([keys.owned, keys.ownedSync]);
      const isObject = (value) => value && typeof value === "object" && !Array.isArray(value);
      const state = isObject(data[keys.ownedSync]) && isObject(data[keys.ownedSync][domainKey]) ? data[keys.ownedSync][domainKey] : {};
      return { owned: isObject(data[keys.owned]) ? data[keys.owned] : {}, state };
    };
    const wait = () => new Promise((resolve) => setTimeout(resolve, this.pageDelayMs));
    let before = await read();
    const now = Date.now();
    const isArchiveDue = (state) => !state.done || (force && !skipArchive) || now - (state.at || 0) >= AlzaCore.ownedSyncHours * 60 * 60 * 1000;
    const skipped = (state) => ({ status: "skipped", added: 0, details: 0, pending: 0, done: true, total: state.total ?? null });
    let archiveDue = isArchiveDue(before.state);
    // Hlídání po nákupu (kontrola na pozadí) na doméně od posledního načtení archivu vidělo jiný účet, než jakému
    // načtené nákupy patří – účet se ověří hned, ne až s dalším načtením archivu za ownedSyncHours
    const purchasesSync = await AlzaOrders.readSync();
    const seenByBackground = purchasesSync[`${domainKey}:accountBy`] === "bg" && Number(purchasesSync[`${domainKey}:accountAt`]) > (before.state.at || 0);
    const seenAccount = seenByBackground ? purchasesSync[`${domainKey}:account`] : null;
    const accountDue = Boolean(seenAccount && before.state.account && seenAccount !== before.state.account);
    if (!archiveDue && !accountDue && AlzaCore.getOwnedDetailQueue(before.owned, domainKey, now).length === 0) return skipped(before.state);
    let added = 0;
    let { done = false, total = null } = before.state;
    // Uživatel načítání mezitím zastavil (kontrola před každým dotazem): vypnul volbu ownedItems, nebo smazal načtené
    // nákupy – nastavení maže i stav načítání, a pokračování od rozpracovaného offsetu by do prázdného přehledu
    // zapsalo jen zbytek archivu. Pak se končí hned a bez dalšího zápisu (i rozpracovaná dávka detailů se zahodí)
    let hasState = Boolean(before.state.at); // Stav načítání domény je uložený (at zapisuje každá stránka archivu)
    const stopped = async () => {
      if (!(await AlzaCore.getSettings()).ownedItems) return true;
      if (!hasState) return false;
      const { [keys.ownedSync]: sync } = await chrome.storage.local.get(keys.ownedSync);
      return !sync?.[domainKey]?.at;
    };
    const off = () => ({ status: "off", added, details: 0, pending: 0, done: Boolean(done), total: total ?? null });
    if (await stopped()) return off();
    const userId = await getUserId(); // Jednou za načtení; číslo účtu jen v této proměnné a v adresách dotazů
    if (!userId) return { status: "noLogin", added: 0, details: 0, pending: 0, done: Boolean(before.state.done), total: before.state.total ?? null };
    const base = `${origin}/api/users/${userId}/v1/orders`;

    // Jiný účet než ten, kterému načtené nákupy domény patří: nákupy dosavadního účtu stranou a dřív odložené
    // nákupy přihlášeného účtu zpět (operace switchOwnedAccount) – přehled, výdaje ani připomínky konce záruky dva
    // účty nemíchají. Otisk účtu se k nákupům zapisuje s každou stránkou archivu (nákupy načtené starší verzí ho
    // dostanou při nejbližším načtení archivu)
    const account = await AlzaOrders.getAccountTag(userId, purchasesSync);
    if (account && before.state.account && before.state.account !== account && (await AlzaStore.run({ type: "switchOwnedAccount", domain: domainKey, tag: account }))) {
      before = await read();
      ({ done = false, total = null } = before.state);
      hasState = Boolean(before.state.at);
      archiveDue = isArchiveDue(before.state);
    }
    if (!archiveDue && AlzaCore.getOwnedDetailQueue(before.owned, domainKey, now).length === 0) return skipped(before.state);

    if (archiveDue) {
      // První načtení pokračuje tam, kde minule skončilo; po něm vždy od nejnovějších
      let offset = done ? 0 : Number(before.state.offset) || 0;
      for (let page = 0; page < AlzaCore.ownedMaxPages; page++) {
        if (page > 0) await wait();
        if (await stopped()) return off();
        const parsed = AlzaCore.parseArchivePage(await getJson(`${base}/archive?productFilterType=0&offset=${offset}&limit=${AlzaCore.ownedPageSize}`), domainKey);
        if (!parsed) throw new Error("archiv objednávek má neznámý tvar");
        total = parsed.total ?? total;
        offset += parsed.count;
        const last = parsed.count < AlzaCore.ownedPageSize || (total !== null && offset >= total);
        const wasDone = done;
        if (last) done = true;
        // Stav po každé stránce – přerušené první načtení (zavřený prohlížeč) naváže, kde skončilo
        const pageAdded = await AlzaStore.run({ type: "mergeOwned", domain: domainKey, orders: parsed.orders, sync: { offset: done ? 0 : offset, done, total, at: Date.now(), ...(account && { account }) } });
        added += pageAdded;
        hasState = true;
        // Už načtený archiv: stránka bez nového nákupu = dál jsou jen známé objednávky
        if (last || (wasDone && pageAdded === 0)) break;
      }
    }

    // Detaily: po kliknutí v nastavení větší dávka, na pozadí po troškách
    const { owned, state } = await read();
    const queue = this.sortQueue(AlzaCore.getOwnedDetailQueue(owned, domainKey), state.fails);
    const batch = queue.slice(0, AlzaCore.ownedDetailsPerRun * (force ? 3 : 1));
    const results = [];
    const failed = []; // Nenačtené detaily – zůstanou ve frontě na příště a zvýší se jim počítadlo selhání
    const breaker = AlzaOrders.createBreaker();
    for (const order of batch) {
      await wait();
      if (await stopped()) return off();
      let detail = null;
      let error = null;
      try {
        detail = await getJson(`${base}/${encodeURIComponent(order)}/`);
      } catch (caught) {
        error = caught;
      }
      if (detail && Array.isArray(detail.parts)) {
        breaker.ok();
        results.push({ order, details: AlzaCore.parseOwnedDetails(detail, domainKey) });
        continue;
      }
      // Odmítnutí (403 / 429) není chyba této objednávky – do počítadla selhání nejde
      if (!breaker.fail(error)) failed.push(order);
      if (breaker.open) break; // Zbytek dávky až příště
    }
    if (batch.length > 0 && (await stopped())) return off();
    if (results.length > 0) await AlzaStore.run({ type: "applyOwnedDetails", domain: domainKey, results });
    // Počítadlo selhání: +1 nenačteným, po úspěchu záznam pryč (jen když je co měnit)
    const counted = Object.keys(state.fails && typeof state.fails === "object" ? state.fails : {}).length > 0;
    if (failed.length > 0 || (results.length > 0 && counted)) {
      await AlzaStore.run({ type: "countOwnedDetailFails", domain: domainKey, failed, loaded: results.map(({ order }) => order) });
    }
    return { status: "synced", added, details: results.length, pending: queue.length - results.length, done, total, ...(breaker.open && { blocked: true }) };
  },

  // Délka záruky koupeného zboží z API detailu produktu (AlzaCore.getProductApiUrl → data.warranty) – u produktů,
  // které ji ještě nemají (getOwnedWarrantyQueue). Volá se po sync (background.js runOwnedSync) u přihlášené domény:
  // po kliknutí v nastavení větší dávka, na pozadí po troškách. Produkt, který už neexistuje nebo záruku neuvádí,
  // se zapíše jako „ptali jsme se“. { count (zjištěno / zapsáno), pending (zbývá), blocked? }
  async syncWarranties({ domainKey, getJson, force = false }) {
    const key = AlzaCore.storageKeys.owned;
    const readOwned = async () => {
      const { [key]: owned } = await chrome.storage.local.get(key);
      return owned && typeof owned === "object" ? owned : null;
    };
    // Uživatel mezitím vypnul volbu nebo smazal načtené nákupy
    const stopped = async () => !(await AlzaCore.getSettings()).ownedItems || !(await readOwned());
    const wait = () => new Promise((resolve) => setTimeout(resolve, this.pageDelayMs));
    const breaker = AlzaOrders.createBreaker();
    if (await stopped()) return { count: 0, pending: 0 };
    const queue = AlzaCore.getOwnedWarrantyQueue(await readOwned(), domainKey);
    const results = [];
    for (const { key, id } of queue.slice(0, AlzaCore.ownedWarrantiesPerRun * (force ? 3 : 1))) {
      if (results.length > 0) await wait();
      if (await stopped()) return { count: 0, pending: 0 };
      let json = null;
      let error = null;
      try {
        json = await getJson(AlzaCore.getProductApiUrl(domainKey, id));
      } catch (caught) {
        error = caught;
      }
      if (json && typeof json === "object") {
        breaker.ok();
        results.push({ key, months: AlzaCore.parseProductWarranty(json) });
        continue;
      }
      // Odmítnutí (403 / 429) = zkusit příště; jiná chyba (produkt už neexistuje) = neptat se pořád dokola
      if (!breaker.fail(error)) results.push({ key, months: null });
      if (breaker.open) break;
    }
    if (results.length > 0) await AlzaStore.run({ type: "applyOwnedWarranties", domain: domainKey, results });
    return { count: results.length, pending: queue.length - results.length, ...(breaker.open && { blocked: true }) };
  },
};
