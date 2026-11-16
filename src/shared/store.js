// Zápisy do chrome.storage.local přes jediného zapisovatele – službu na pozadí. Content scripty (víc záložek),
// popup i nastavení pošlou operaci zprávou a služba na pozadí je provede po jedné (fronta). Dřívější
// read-modify-write z více míst najednou přepisoval cizí změny (cílová cena, hlídaný seznam, nové minimum…).
// Čte se dál přímo (chrome.storage.local.get) odkudkoli.
//
// Operace (ops) dostávají jen data (zprávou nejde poslat funkci) a uvnitř fronty se nesmí znovu volat run –
// čekala by sama na sebe. Služba na pozadí nastaví isWriter = true a předává zprávy do handleMessage.
const AlzaStore = {
  isWriter: false,
  queue: Promise.resolve(),
  messageAction: "alzaStore",

  // Úloha ve frontě zapisovatele (jen služba na pozadí); vrací její výsledek
  exclusive(task) {
    if (!this.isWriter) return Promise.reject(new Error("AlzaStore.exclusive jen ve službě na pozadí"));
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => {});
    return run;
  },

  async run(op) {
    if (this.isWriter) return this.exclusive(() => this.apply(op));
    const response = await chrome.runtime.sendMessage({ action: this.messageAction, op });
    if (!response) throw new Error(`Služba na pozadí neodpověděla (${op.type})`);
    if (!response.ok) throw new Error(response.error);
    return response.result;
  },

  apply(op) {
    const handler = Object.hasOwn(this.ops, op?.type) ? this.ops[op.type] : null;
    if (!handler) throw new Error(`Neznámá operace úložiště: ${op?.type}`);
    return handler.call(this, op);
  },

  // Operace, které smí poslat content script (stránka Alzy) – jen to, co content scripty opravdu volají (hlídá test
  // tests/audit-2026-11-16-pozadi.test.js): true = celá operace, pole = jen tyto klíče z AlzaCore.storageKeys,
  // funkce = vlastní podmínka. Stránky rozšíření (popup, nastavení, průvodce) omezené nejsou. Skript na stránce Alzy,
  // který by se dostal k posílání zpráv, tak nesmaže data, nepřepíše nastavení ani nenaimportuje „zálohu“
  contentOps: {
    mergePrices: true,
    appendHistory: true,
    recordBrowsing: true,
    setWarranty: true,
    setPageMeta: true,
    recordVatCheck: true,
    appendErrors: true,
    accountSalt: true,
    confirmAccount: true,
    // Hlídání (seznamy, produkty, cílové ceny), peněženka poukazů, poznámky, skryté produkty a značky, mezipaměť
    // spotřeby, hlídání po nákupu (AlzaOrders ze stránky Alzy)
    patchMap: ["watchLists", "watchProducts", "targets", "vouchers", "notes", "hidden", "hiddenBrands", "energy", "purchases", "cashbackReminders"],
    assign: ["purchasesSync"],
    // Jen úklid starých klíčů (content.js removeLegacyPriceChanges)
    remove: ({ keys }) =>
      Array.isArray(keys) &&
      keys.every((key) => key === "alzaProductInfo" || Object.keys(AlzaCore.domains).some((domain) => key === `${AlzaCore.storagePrefixes.legacyPrices}${domain}_changes`)),
  },

  // Odesílatel zprávy je content script na stránce Alzy? Stránka rozšíření má adresu rozšíření (i otevřená v záložce,
  // kde má sender.tab stejně jako content script); bez údajů o odesílateli (volání uvnitř služby) omezení neplatí
  isContentSender(sender) {
    if (!sender) return false;
    const url = typeof sender.url === "string" ? sender.url : "";
    if (url.startsWith(chrome.runtime.getURL(""))) return false;
    return Boolean(sender.tab) || url !== "";
  },

  allowsContent(op) {
    const rule = Object.hasOwn(this.contentOps, op?.type) ? this.contentOps[op.type] : null;
    if (rule === true) return true;
    if (Array.isArray(rule)) return rule.some((name) => AlzaCore.storageKeys[name] === op.key);
    return typeof rule === "function" && Boolean(rule(op));
  },

  // Posluchač chrome.runtime.onMessage ve službě na pozadí; true = odpověď přijde asynchronně
  handleMessage(message, sendResponse, sender = null) {
    if (message?.action !== this.messageAction) return false;
    if (this.isContentSender(sender) && !this.allowsContent(message.op)) {
      sendResponse({ ok: false, error: `Operace úložiště není ze stránky Alzy povolená (${message.op?.type})` });
      return true;
    }
    this.run(message.op).then(
      (result) => sendResponse({ ok: true, result }),
      (error) => sendResponse({ ok: false, error: String(error?.message || error) })
    );
    return true;
  },

  // === Čtení (kdekoli) ===

  // Záznamy cen produktů { klíč produktu: záznam } jedním čtením
  async getPriceRecords(domainKey, urls) {
    const keys = [...new Set(urls.map((url) => AlzaCore.getPriceKey(domainKey, url)))];
    if (keys.length === 0) return {};
    const data = await chrome.storage.local.get(keys);
    const prefix = AlzaCore.storagePrefixes.price;
    return Object.fromEntries(Object.entries(data).map(([key, record]) => [key.slice(prefix.length), record]));
  },

  // === Migrace ===
  // Dřívější alzaPrices_<doména> ({ url: záznam }, jeden obrovský objekt přepisovaný při každém produktu)
  // → alzaPrice_<doména>_<id>. Víc adres téhož produktu (parametry v URL): novější záznam, min/max z obou
  legacyToPriceRecords(domainKey, records, existing = {}) {
    const result = {};
    Object.entries(records || {}).forEach(([url, record]) => {
      if (!AlzaCore.isAlzaUrl(url) || !record || typeof record !== "object") return;
      const key = AlzaCore.getPriceKey(domainKey, url);
      result[key] = this.mergeDuplicateRecords(result[key] ?? existing[key], { ...record, url: record.url || url });
    });
    return result;
  },

  mergeDuplicateRecords(a, b) {
    if (!a) return b;
    const [older, newer] = (Number(a.lastUpdated) || 0) <= (Number(b.lastUpdated) || 0) ? [a, b] : [b, a];
    const merged = { ...newer };
    const pick = (key, better) => {
      const values = [older[key], newer[key]].filter((point) => Number.isFinite(point?.value));
      if (values.length > 0) merged[key] = values.reduce((best, point) => (better(point.value, best.value) ? point : best));
    };
    pick("minPrice", (value, best) => value < best);
    pick("maxPrice", (value, best) => value > best);
    pick("maxLowestPrice", (value, best) => value > best);
    return merged;
  },

  // Import zálohy do mapy položek s časem zadání (at – poznámky, skryté produkty a značky): u stejného klíče zůstane
  // novější položka, při shodě času ta stávající
  mergeNewer(existing, imported) {
    const time = (item) => Number(item?.at) || 0;
    const fresh = Object.entries(imported).filter(([key, item]) => !Object.hasOwn(existing, key) || time(item) > time(existing[key]));
    return { ...existing, ...Object.fromEntries(fresh) };
  },

  // Import zálohy do přehledu procházených produktů: údaje z později viděného záznamu, čas nejpozdější z obou
  // a „prohlédnuto“ (openedAt) se zachová – zálohy do 2026.11.12 ho nemají
  mergeBrowsed(existing, imported) {
    const time = (value) => Number(value) || 0;
    const merged = Object.entries(imported).map(([key, item]) => {
      const current = Object.hasOwn(existing, key) ? existing[key] : null;
      if (!current || typeof current !== "object" || !item || typeof item !== "object") return [key, item];
      const [older, newer] = time(item.seenAt) > time(current.seenAt) ? [current, item] : [item, current];
      const openedAt = Math.max(time(older.openedAt), time(newer.openedAt));
      // Název a obrázek jako recordBrowsing: novější, jinak dosavadní (výpis bez názvu ho nesmí smazat)
      return [key, { ...older, ...newer, name: newer.name || older.name || null, image: newer.image || older.image || null, ...(openedAt > 0 && { openedAt }) }];
    });
    return { ...existing, ...Object.fromEntries(merged) };
  },

  async migrate() {
    // Běží při každém startu služby na pozadí – nejdřív jen 3 staré klíče, celé úložiště až když je co převádět
    const prefix = AlzaCore.storagePrefixes.legacyPrices;
    const legacy = await chrome.storage.local.get(Object.keys(AlzaCore.domains).map((domainKey) => prefix + domainKey));
    const legacyKeys = Object.keys(legacy);
    if (legacyKeys.length === 0) return 0;
    const all = await chrome.storage.local.get(null);
    const updates = {};
    legacyKeys.forEach((key) => Object.assign(updates, this.legacyToPriceRecords(key.slice(prefix.length), all[key], { ...all, ...updates })));
    await chrome.storage.local.set(updates);
    await chrome.storage.local.remove(legacyKeys);
    return Object.keys(updates).length;
  },

  // Jednorázové opravy uložených dat (storageKeys.cleanups – co proběhlo, už se nespouští). Vrací počet změn.
  // Každá oprava dostane snímek úložiště (all) a zapisuje do updates; pozdější oprava vidí výsledek dřívější
  cleanups: {
    // Výpis kategorie ukládal do 2026.11.8.10 cenu „od …“ (nejvyšší stupeň množstevní slevy) jako cenu produktu
    "quantityTierListingPrices-2026-11"(all, updates) {
      const pricePrefix = AlzaCore.storagePrefixes.price;
      let removed = 0;
      Object.entries(all).forEach(([storageKey, record]) => {
        if (!storageKey.startsWith(pricePrefix) || !record?.quantityTiers || !record.url) return;
        const productKey = storageKey.slice(pricePrefix.length);
        const domainKey = Object.keys(AlzaCore.domains).find((domain) => productKey.startsWith(`${domain}_`));
        if (!domainKey) return;
        const historyKey = AlzaCore.getHistoryKey(domainKey, record.url);
        if (!Array.isArray(all[historyKey])) return;
        const entries = structuredClone(all[historyKey]);
        const count = AlzaCore.removeQuantityTierEntries(entries, record.quantityTiers);
        if (count > 0) {
          updates[historyKey] = entries;
          removed += count;
        }
      });
      return removed;
    },
    // Historické minimum a šipka změny se do 2026.11.16 počítaly i s cashbackem a výkupem – minimum se jen snižuje,
    // samo by se neopravilo (AlzaCore.repairPayNowRecord: z historie, kde dobu minima pokrývá)
    "payNowMinPrice-2026-11"(all, updates) {
      let repaired = 0;
      Object.entries(all).forEach(([storageKey, stored]) => {
        const parsed = AlzaCore.parseProductStorageKey(storageKey);
        if (parsed?.kind !== "price" || !stored || typeof stored !== "object") return;
        const historyKey = AlzaCore.storagePrefixes.history + parsed.productKey;
        const record = structuredClone(stored);
        if (!AlzaCore.repairPayNowRecord(record, updates[historyKey] ?? all[historyKey])) return;
        updates[storageKey] = record;
        repaired++;
      });
      return repaired;
    },
  },

  async runCleanups() {
    const key = AlzaCore.storageKeys.cleanups;
    const { [key]: done = {} } = await chrome.storage.local.get(key);
    const pending = Object.keys(this.cleanups).filter((name) => !done[name]);
    if (pending.length === 0) return 0;
    const all = await chrome.storage.local.get(null);
    const updates = {};
    let changes = 0;
    pending.forEach((name) => (changes += this.cleanups[name](all, updates)));
    const now = Date.now();
    await chrome.storage.local.set({ ...updates, [key]: { ...done, ...Object.fromEntries(pending.map((name) => [name, now])) } });
    return changes;
  },

  // === Operace ===
  ops: {
    // Sloučí nově načtené ceny do záznamů produktů (AlzaCore.mergePriceRecord). records = { url: ceny + meta }.
    // Vrací { url: { before, record } } – before = záznam před sloučením (šipka změny, první záznam historie)
    async mergePrices({ domain, records, listId = null, now = Date.now() }) {
      const keys = Object.fromEntries(Object.keys(records).map((url) => [url, AlzaCore.getPriceKey(domain, url)]));
      const codesKey = AlzaCore.storageKeys.codes;
      const cashbacksKey = AlzaCore.storageKeys.cashbacks;
      const stored = await chrome.storage.local.get([...Object.values(keys), codesKey, cashbacksKey]);
      const updates = {};
      const result = {};
      const codes = stored[codesKey] && typeof stored[codesKey] === "object" ? stored[codesKey] : {};
      const cashbacks = stored[cashbacksKey] && typeof stored[cashbacksKey] === "object" ? stored[cashbacksKey] : {};
      let codesChanged = false;
      let cashbacksChanged = false;
      Object.entries(records).forEach(([url, incoming]) => {
        const key = keys[url];
        const current = updates[key] || stored[key];
        const before = current ? structuredClone(current) : null;
        const record = AlzaCore.mergePriceRecord(current ? structuredClone(current) : {}, incoming || {}, listId, now);
        record.url = current?.url || url;
        updates[key] = record;
        result[url] = { before, record };
        if (AlzaCore.updateCodeRegistry(codes, AlzaCore.getProductKey(domain, url), record, record.url, domain, now)) codesChanged = true;
        // Cashback s odkazem na podmínky – připomínka registrace po nákupu (background.js updateCashbackReminders)
        if (AlzaCore.updateCashbackRegistry(cashbacks, AlzaCore.getProductKey(domain, url), record, domain, now)) cashbacksChanged = true;
      });
      if (codesChanged) updates[codesKey] = codes;
      if (cashbacksChanged) updates[cashbacksKey] = cashbacks;
      if (Object.keys(updates).length > 0) await chrome.storage.local.set(updates);
      return result;
    },

    // Kontrola do historie produktu (AlzaCore.appendHistory). previousRecord = záznam ceny před sloučením
    // (první záznam historie na něj naváže). Vrací uloženou historii
    async appendHistory({ domain, lang, url, prices, availability = null, previousRecord, name = null, now = Date.now() }) {
      const key = AlzaCore.getHistoryKey(domain, url);
      const { [key]: stored } = await chrome.storage.local.get(key);
      const entries = AlzaCore.normalizeHistory(stored, lang);
      AlzaCore.appendHistory(entries, prices, availability, previousRecord, { now, name });
      await chrome.storage.local.set({ [key]: entries });
      return entries;
    },

    // Produkty viděné při procházení (browsing.js): pozorování z výpisu do historie (jen products s prices)
    // a záznam do přehledu procházených (storageKeys.browsed). products = [{ url, name, image, prices, availability }]
    async recordBrowsing({ domain, lang, products, now = Date.now() }) {
      const browsedKey = AlzaCore.storageKeys.browsed;
      const historyKeys = products.filter((product) => product.prices).map((product) => AlzaCore.getHistoryKey(domain, product.url));
      const data = await chrome.storage.local.get([browsedKey, ...historyKeys]);
      const browsed = data[browsedKey] || {};
      const updates = {};
      products.forEach((product) => {
        if (product.prices) {
          const historyKey = AlzaCore.getHistoryKey(domain, product.url);
          const entries = updates[historyKey] || AlzaCore.normalizeHistory(data[historyKey], lang);
          if (AlzaCore.appendListingObservation(entries, product.prices, product.availability, { now, name: product.name })) updates[historyKey] = entries;
        }
        const key = AlzaCore.getProductKey(domain, product.url);
        const previous = browsed[key] || {};
        browsed[key] = {
          url: previous.url || product.url,
          domain,
          name: product.name || previous.name || null,
          image: product.image || previous.image || null,
          seenAt: now,
          // Otevřený detail (ne jen dlaždice ve výpisu) – značka „prohlédnuto“ ve výpisech (listing-memory.js)
          ...((product.opened || previous.openedAt) && { openedAt: product.opened ? now : previous.openedAt }),
        };
      });
      if (products.length > 0) await chrome.storage.local.set({ ...updates, [browsedKey]: browsed });
    },

    // Úprava objektu { klíč: položka } (cílové ceny, hlídané produkty a seznamy, procházené produkty):
    //   set = nahradit (keep = pole, která zůstanou z dosavadní položky, např. since)
    //   update = nahradit jen existující položku, merge = doplnit pole do položky, remove = smazat
    //   existingOnly = merge jen do existující položky (stav nákupu, „Hotovo“ u připomínky – smazaná položka
    //   nesmí vzniknout znovu jako útržek bez adresy a domény)
    //   sameBy = pole totožnosti položky (u nákupu boughtAt): keep zachová pole jen u téže položky a merge zapíše
    //   jen do ní – upozornění k dřívějšímu nákupu nesmí umlčet nový nákup téhož produktu
    // Vrací výsledný objekt
    async patchMap({ key, set = {}, update = {}, merge = {}, remove = [], keep = [], existingOnly = false, sameBy = null }) {
      // Klíč "__proto__" by místo položky změnil prototyp – položka by se tiše ztratila
      [set, update, merge].forEach((entries) => delete entries.__proto__);
      const { [key]: stored } = await chrome.storage.local.get(key);
      // Pole pod klíčem mapy (poškozená data) není mapa – položka zapsaná do pole jako vlastnost by se při uložení
      // tiše ztratila
      const map = stored && typeof stored === "object" && !Array.isArray(stored) ? stored : {};
      // NaN / undefined = null (v úložišti z NaN je null) – jinak by se položka nikdy neshodovala sama se sebou
      // sameBy = pole, nebo seznam polí (první vyplněné – starší záznam bez nového pole)
      const identity = (item) => {
        const field = [sameBy].flat().find((name) => item?.[name] !== undefined && item?.[name] !== null);
        const value = field ? item[field] : null;
        return typeof value === "number" && !Number.isFinite(value) ? null : value;
      };
      const same = (existing, value) => !sameBy || identity(existing) === identity(value);
      const kept = (existing, value) =>
        same(existing, value) ? Object.fromEntries(keep.filter((field) => existing?.[field] !== undefined).map((field) => [field, existing[field]])) : {};
      Object.entries(set).forEach(([entry, value]) => (map[entry] = { ...value, ...kept(map[entry], value) }));
      Object.entries(update).forEach(([entry, value]) => {
        if (map[entry]) map[entry] = { ...value, ...kept(map[entry], value) };
      });
      Object.entries(merge).forEach(([entry, value]) => {
        if (sameBy && !same(map[entry], value)) return;
        if (!existingOnly || (map[entry] && typeof map[entry] === "object")) map[entry] = { ...map[entry], ...value };
      });
      remove.forEach((entry) => delete map[entry]);
      await chrome.storage.local.set({ [key]: map });
      return map;
    },

    // Doplní pole do objektu pod klíčem (návrh čistky – odložení)
    async assign({ key, values }) {
      const { [key]: stored } = await chrome.storage.local.get(key);
      const value = { ...(stored && typeof stored === "object" ? stored : {}), ...values };
      await chrome.storage.local.set({ [key]: value });
      return value;
    },

    async recordVatCheck({ domain, withVat, now = Date.now() }) {
      const key = AlzaCore.storageKeys.vatCheck;
      const { [key]: checks = {} } = await chrome.storage.local.get(key);
      const next = AlzaCore.nextVatChecks(checks, domain, withVat, now);
      if (next) await chrome.storage.local.set({ [key]: next });
    },

    async appendErrors({ entries }) {
      const key = AlzaCore.storageKeys.errorLog;
      const { [key]: log } = await chrome.storage.local.get(key);
      await chrome.storage.local.set({ [key]: [...(Array.isArray(log) ? log : []), ...entries].slice(-AlzaCore.errorLogMaxEntries) });
    },

    // Data produktů (historie, záznam ceny, přehled procházených, kód v trezoru, viděný cashback, připomínka
    // cashbacku, hlídání po nákupu, načtená spotřeba) – nastavení: úklid a smazání dat produktu. Hlídání a cílové
    // ceny zůstávají; poznámka k produktu a jeho skrytí ve výpisech také – ty zadal uživatel sám.
    // productKeys = ["alza_cz_123", …]
    async removeProducts({ productKeys }) {
      const { history, price } = AlzaCore.storagePrefixes;
      const { browsed, codes, cashbacks, cashbackReminders, purchases, energy } = AlzaCore.storageKeys;
      const mapKeys = [browsed, codes, cashbacks, cashbackReminders, purchases, energy];
      await chrome.storage.local.remove(productKeys.flatMap((key) => [history + key, price + key]));
      const stored = await chrome.storage.local.get(mapKeys);
      const updates = {};
      mapKeys.forEach((mapKey) => {
        const map = stored[mapKey];
        if (!map || typeof map !== "object" || !productKeys.some((key) => Object.hasOwn(map, key))) return;
        productKeys.forEach((key) => delete map[key]);
        updates[mapKey] = map;
      });
      if (Object.keys(updates).length > 0) await chrome.storage.local.set(updates);
    },

    // Úklid starých dat (nastavení): podmínka AlzaCore.findStaleProducts se ověří znovu uvnitř fronty – produkt,
    // který mezitím obnovila kontrola, detail nebo výpis (nová historie, hlídání), se nesmaže. Vrací smazané klíče
    async removeStaleProducts({ productKeys }) {
      const still = new Set(AlzaCore.findStaleProducts(await chrome.storage.local.get(null)).map((product) => product.key));
      const keys = productKeys.filter((key) => still.has(key));
      if (keys.length > 0) await this.ops.removeProducts.call(this, { productKeys: keys });
      return keys;
    },

    async remove({ keys }) {
      await chrome.storage.local.remove(keys);
    },

    // === Účet Alzy (otisk účtu – AlzaOrders.accountTag v shared/orders.js) ===

    // Sůl otisků účtu (storageKeys.purchasesSync → salt) vznikne jen jednou: salt = návrh volajícího, použije se,
    // jen když žádná není (stránka Alzy a služba na pozadí by jinak souběžně založily každá jinou a otisky by
    // neseděly). Vrací platnou sůl, null = není a návrh nemá čekaný tvar
    async accountSalt({ salt = null }) {
      const key = AlzaCore.storageKeys.purchasesSync;
      const { [key]: stored } = await chrome.storage.local.get(key);
      const sync = stored && typeof stored === "object" && !Array.isArray(stored) ? stored : {};
      if (typeof sync.salt === "string" && sync.salt) return sync.salt;
      if (typeof salt !== "string" || !/^[0-9a-f]{32}$/.test(salt)) return null;
      await chrome.storage.local.set({ [key]: { ...sync, salt } });
      return salt;
    },

    // Hlídání po nákupu: otisk účtu domény viděla kontrola objednávek – by: "bg" = kontrola na pozadí, "page" =
    // stránka Alzy (může běžet v kontejneru nebo anonymním okně s jiným účtem, než jaký vidí pozadí). Vrací:
    //   "first"    první otisk domény – není s čím srovnat
    //   "same"     stejný účet (zapíše se, kdo a kdy ho potvrdil)
    //   "switched" jiný účet: nákupy domény a jejich připomínky cashbacku pryč a s nimi čas úplného načtení, otisk
    //              aktivních objednávek a počítadlo neúplných načtení – objednávky nového účtu se načtou celé při
    //              nejbližší kontrole, i kdyby ta právě běžící skončila chybou. Všechno jedním zápisem
    //   "other"    stránka Alzy s jiným účtem, než jaký byl potvrzen před méně než trustMs – nic se nemění.
    // Účet tedy přepíná kontrola na pozadí vždy, stránka jen když otisk dlouho nikdo nepotvrdil (Alza jen v kontejneru)
    async confirmAccount({ domain, tag, by = "page", trustMs = 0, now = Date.now() }) {
      if (!AlzaCore.isKnownDomain(domain) || !/^[0-9a-f]{4}$/.test(String(tag))) return "same";
      const { purchases: purchasesKey, purchasesSync: syncKey, cashbackReminders: remindersKey } = AlzaCore.storageKeys;
      const stored = await chrome.storage.local.get([purchasesKey, syncKey, remindersKey]);
      const isObject = (value) => value && typeof value === "object" && !Array.isArray(value);
      const sync = isObject(stored[syncKey]) ? stored[syncKey] : {};
      const accountKey = `${domain}:account`;
      const previous = typeof sync[accountKey] === "string" && sync[accountKey] ? sync[accountKey] : null;
      const source = by === "bg" ? "bg" : "page";
      const changed = previous !== null && previous !== tag;
      if (changed && source !== "bg" && now - (Number(sync[`${domain}:accountAt`]) || 0) < trustMs) return "other";
      Object.assign(sync, { [accountKey]: tag, [`${domain}:accountAt`]: now, [`${domain}:accountBy`]: source });
      const updates = { [syncKey]: sync };
      if (changed) {
        // Čas úplného načtení na 0, ne pryč – podle klíče domény pozná kontrola na pozadí, kde objednávky načítat
        sync[domain] = 0;
        delete sync[`${domain}:mark`];
        delete sync[`${domain}:fails`];
        const purchases = isObject(stored[purchasesKey]) ? stored[purchasesKey] : {};
        const remove = Object.keys(purchases).filter((key) => purchases[key]?.domain === domain);
        if (remove.length > 0) {
          remove.forEach((key) => delete purchases[key]);
          updates[purchasesKey] = purchases;
          const reminders = stored[remindersKey];
          if (isObject(reminders) && remove.some((key) => Object.hasOwn(reminders, key))) {
            remove.forEach((key) => delete reminders[key]);
            updates[remindersKey] = reminders;
          }
        }
      }
      await chrome.storage.local.set(updates);
      return changed ? "switched" : previous ? "same" : "first";
    },

    // Moje nákupy: na doméně je přihlášený jiný účet (tag = jeho otisk) než ten, kterému načtené nákupy patří
    // (ownedSync → account). Nákupy, objednávky a stav načítání domény se odloží pod otiskem dosavadního účtu
    // (storageKeys.ownedAccounts) a vrátí se dřív odložená data nového účtu – nebo doména začne prázdná a archiv se
    // načte znovu. Jedním zápisem; nákupy dvou účtů se tak v přehledu, výdajích ani připomínkách záruky nemíchají.
    // Odložených účtů nejvýš maxAccounts (nejdéle odložené se mažou). Vrací true = účet přepnut
    async switchOwnedAccount({ domain, tag, now = Date.now() }) {
      const maxAccounts = 4;
      if (!AlzaCore.isKnownDomain(domain) || !/^[0-9a-f]{4}$/.test(String(tag))) return false;
      const { owned: ownedKey, ownedOrders: ordersKey, ownedSync: syncKey, ownedAccounts: accountsKey } = AlzaCore.storageKeys;
      const stored = await chrome.storage.local.get([ownedKey, ordersKey, syncKey, accountsKey]);
      const isObject = (value) => value && typeof value === "object" && !Array.isArray(value);
      const allSync = isObject(stored[syncKey]) ? stored[syncKey] : {};
      const state = isObject(allSync[domain]) ? allSync[domain] : {};
      const previous = typeof state.account === "string" && state.account ? state.account : null;
      // Bez dosavadního otisku není co odkládat (zapíše ho první načtení archivu); stejný otisk = už přepnuto
      if (!previous || previous === tag) return false;
      const allOwned = isObject(stored[ownedKey]) ? stored[ownedKey] : {};
      const allOrders = isObject(stored[ordersKey]) ? stored[ordersKey] : {};
      const accounts = isObject(stored[accountsKey]) ? stored[accountsKey] : {};
      const mine = {};
      const owned = {};
      Object.entries(allOwned).forEach(([key, product]) => ((product?.domain === domain ? mine : owned)[key] = product));
      accounts[`${domain}:${previous}`] = { owned: mine, orders: isObject(allOrders[domain]) ? allOrders[domain] : {}, sync: state, at: now };
      const back = isObject(accounts[`${domain}:${tag}`]) ? accounts[`${domain}:${tag}`] : null;
      delete accounts[`${domain}:${tag}`];
      if (isObject(back?.owned)) Object.assign(owned, back.owned);
      const orders = { ...allOrders };
      if (isObject(back?.orders)) orders[domain] = back.orders;
      else delete orders[domain];
      const kept = Object.entries(accounts)
        .sort(([, a], [, b]) => (Number(b?.at) || 0) - (Number(a?.at) || 0))
        .slice(0, maxAccounts);
      await chrome.storage.local.set({
        [ownedKey]: owned,
        [ordersKey]: orders,
        [syncKey]: { ...allSync, [domain]: { ...(isObject(back?.sync) ? back.sync : {}), account: tag } },
        [accountsKey]: Object.fromEntries(kept),
      });
      return true;
    },

    // === Moje nákupy (AlzaOwned v shared/orders.js, služba na pozadí) ===

    // Objednávky z archivu (AlzaCore.parseArchivePage) do přehledu koupeného zboží a objednávek; sync = stav načítání
    // domény (doplní se do storageKeys.ownedSync). Vrací počet nových nákupů. Přehled zboží a objednávek se zapisuje
    // jen při skutečné změně (nový nákup, přejmenované zboží, zrušená objednávka, jiná částka) – stránka archivu se
    // samými známými objednávkami by jinak pokaždé přepsala celý přehled; stav načítání se zapisuje vždy
    async mergeOwned({ domain, orders = [], sync = null }) {
      const { owned: ownedKey, ownedOrders: ordersKey, ownedSync: syncKey } = AlzaCore.storageKeys;
      const stored = await chrome.storage.local.get([ownedKey, ordersKey, syncKey]);
      const isObject = (value) => value && typeof value === "object" && !Array.isArray(value);
      const owned = isObject(stored[ownedKey]) ? stored[ownedKey] : {};
      const allOrders = isObject(stored[ordersKey]) ? stored[ordersKey] : {};
      const domainOrders = isObject(allOrders[domain]) ? allOrders[domain] : {};
      // mergeOwnedOrders mění oba objekty na místě – změnu pozná srovnání podoby před a po
      const snapshot = () => [JSON.stringify(owned), JSON.stringify(domainOrders)];
      const before = orders.length > 0 ? snapshot() : null;
      const added = AlzaCore.mergeOwnedOrders(owned, domainOrders, orders, domain);
      const updates = {};
      if (before) {
        const after = snapshot();
        if (after[0] !== before[0]) updates[ownedKey] = owned;
        if (after[1] !== before[1]) updates[ordersKey] = { ...allOrders, [domain]: domainOrders };
      }
      if (sync) {
        const allSync = isObject(stored[syncKey]) ? stored[syncKey] : {};
        updates[syncKey] = { ...allSync, [domain]: { ...allSync[domain], ...sync } };
      }
      if (Object.keys(updates).length > 0) await chrome.storage.local.set(updates);
      return added;
    },

    // Údaje z detailů objednávek (cena kusu, reklamace, vrácení) k nákupům: results = [{ order, details }]
    async applyOwnedDetails({ domain, results = [], now = Date.now() }) {
      const key = AlzaCore.storageKeys.owned;
      const { [key]: owned } = await chrome.storage.local.get(key);
      if (!owned || typeof owned !== "object" || results.length === 0) return;
      // Záruka z detailu produktu (setWarranty ji ukládá k záznamu ceny) – nákup si ji vezme s prvním detailem objednávky
      const productKeys = [...new Set(results.flatMap(({ details }) => Object.keys(details || {})))];
      const priceKeys = productKeys.map((productKey) => `${AlzaCore.storagePrefixes.price}${productKey}`);
      const records = priceKeys.length > 0 ? await chrome.storage.local.get(priceKeys) : {};
      const warranties = Object.fromEntries(productKeys.map((productKey, index) => [productKey, records[priceKeys[index]]?.warranty]).filter(([, warranty]) => warranty));
      results.forEach(({ order, details }) => AlzaCore.applyOwnedDetails(owned, String(order), details || {}, domain, now, warranties));
      await chrome.storage.local.set({ [key]: owned });
    },

    // Délka záruky zjištěná z API produktu při načítání Mých nákupů (AlzaOwned.sync): results = [{ key, months | null }]
    // – i nezjištěná se zapíše jako „ptali jsme se“ (wa), ať se dotaz neopakuje při každém běhu
    async applyOwnedWarranties({ domain, results = [], now = Date.now() }) {
      const key = AlzaCore.storageKeys.owned;
      const { [key]: owned } = await chrome.storage.local.get(key);
      if (!owned || typeof owned !== "object" || results.length === 0) return;
      let changed = false;
      results.forEach(({ key: productKey, months }) => {
        if (owned[productKey]?.domain !== domain) return;
        changed = AlzaCore.applyOwnedWarrantyResult(owned, productKey, Number(months) || 0, now) || changed;
      });
      if (changed) await chrome.storage.local.set({ [key]: owned });
    },

    // Záruka z detailu produktu ({ m: měsíce, b: platí „pro firemní nákupy“ } – AlzaCore.getDocumentWarranty):
    // k záznamu ceny (budoucí nákup si ji vezme při načtení detailu objednávky) a ke koupeným kusům v Mých nákupech,
    // které ji ještě nemají. Zapisuje jen při změně; záznam ceny nevytváří (produkt, jehož ceny se neukládají)
    async setWarranty({ domain, url, warranty }) {
      const months = Number(warranty?.m);
      if (!AlzaCore.isKnownDomain(domain) || !Number.isInteger(months) || months <= 0 || months > 240) return;
      const value = { m: months, b: Boolean(warranty.b) };
      const priceKey = AlzaCore.getPriceKey(domain, url);
      const ownedKey = AlzaCore.storageKeys.owned;
      const stored = await chrome.storage.local.get([priceKey, ownedKey]);
      const changes = {};
      const record = stored[priceKey];
      if (record && typeof record === "object" && (record.warranty?.m !== value.m || Boolean(record.warranty?.b) !== value.b)) changes[priceKey] = { ...record, warranty: value };
      const owned = stored[ownedKey];
      const product = owned && typeof owned === "object" ? owned[AlzaCore.getProductKey(domain, url)] : null;
      if (product && AlzaCore.applyOwnedWarranty(product, value)) changes[ownedKey] = owned;
      if (Object.keys(changes).length > 0) await chrome.storage.local.set(changes);
    },

    // Ceny jiných stavů (Nový / Rozbalený / Zánovní) a množstevní slevy z živého detailu produktu k záznamu ceny.
    // Košík a seznam je berou ze záznamu, detail je ukazuje ze stránky – po změně ceny by se jinak lišily až do další
    // kontroly. Záznam ceny nevytváří a čas aktualizace nemění; zapisuje jen při změně. null = produkt je (už) nemá
    async setPageMeta({ domain, url, conditions = null, quantityTiers = null }) {
      if (!AlzaCore.isKnownDomain(domain)) return;
      const priceKey = AlzaCore.getPriceKey(domain, url);
      const { [priceKey]: record } = await chrome.storage.local.get(priceKey);
      if (!record || typeof record !== "object") return;
      const meta = { conditions: AlzaCore.sanitizeConditions(conditions), quantityTiers: AlzaCore.getQuantityTiers({ quantityTiers }) };
      if (Object.entries(meta).every(([key, value]) => JSON.stringify(record[key] ?? null) === JSON.stringify(value))) return;
      const next = { ...record };
      Object.entries(meta).forEach(([key, value]) => {
        if (value === null) delete next[key];
        else next[key] = value;
      });
      await chrome.storage.local.set({ [priceKey]: next });
    },

    // Počítadlo nenačtených detailů objednávek ve stavu načítání domény (storageKeys.ownedSync → { "<doména>":
    // { …, fails: { "<číslo objednávky>": počet } } }) – AlzaOwned.sortQueue podle něj řadí opakovaně selhávající
    // detaily na konec fronty. failed = čísla objednávek, jejichž detail se teď nenačetl (+1), loaded = načtené
    // (záznam se smaže). Volat až po applyOwnedDetails: zůstávají jen objednávky, které na detail ještě čekají,
    // a nejvýš maxFails záznamů (ty s nejvíc selháními). Zapisuje jen při změně
    async countOwnedDetailFails({ domain, failed = [], loaded = [], now = Date.now() }) {
      const maxFails = 200;
      const { owned: ownedKey, ownedSync: syncKey } = AlzaCore.storageKeys;
      const stored = await chrome.storage.local.get([ownedKey, syncKey]);
      const isObject = (value) => value && typeof value === "object" && !Array.isArray(value);
      // Smazané nákupy (nastavení) – stav načítání nesmí vzniknout znovu jako útržek
      if (!isObject(stored[ownedKey])) return;
      const allSync = isObject(stored[syncKey]) ? stored[syncKey] : {};
      const state = isObject(allSync[domain]) ? allSync[domain] : {};
      const previous = isObject(state.fails) ? state.fails : {};
      const waiting = new Set(AlzaCore.getOwnedDetailQueue(stored[ownedKey], domain, now).map(String));
      loaded.forEach((order) => waiting.delete(String(order)));
      const counts = new Map(Object.entries(previous).filter(([order, count]) => waiting.has(order) && count > 0));
      failed.map(String).filter((order) => /^\d{1,20}$/.test(order)).forEach((order) => counts.set(order, (Number(counts.get(order)) || 0) + 1));
      const fails = Object.fromEntries([...counts].sort((a, b) => b[1] - a[1]).slice(0, maxFails));
      const same = Object.keys(fails).length === Object.keys(previous).length && Object.entries(fails).every(([order, count]) => previous[order] === count);
      if (same) return;
      const { fails: dropped, ...rest } = state;
      await chrome.storage.local.set({ [syncKey]: { ...allSync, [domain]: Object.keys(fails).length > 0 ? { ...rest, fails } : rest } });
    },

    // Připomínka konce záruky odeslána: items = [{ key (produkt), order }]
    async markOwnedNotified({ items = [] }) {
      const key = AlzaCore.storageKeys.owned;
      const { [key]: owned } = await chrome.storage.local.get(key);
      if (!owned || typeof owned !== "object") return;
      let changed = false;
      items.forEach(({ key: productKey, order }) => {
        const buy = Object.hasOwn(owned, productKey) ? owned[productKey]?.buys?.find((candidate) => candidate.o === order) : null;
        if (!buy || buy.notified) return;
        buy.notified = true;
        changed = true;
      });
      if (changed) await chrome.storage.local.set({ [key]: owned });
    },

    // Import ověřené zálohy (nastavení): historie se sloučí podle času, objekty po položkách, záznamy cen ze
    // starého formátu (alzaPrices_<doména>) se převedou na klíče po produktech. Nic se nesmaže.
    // Položky s časem zadání (poznámky, skryté produkty a značky – pole at) zůstanou ty novější a u procházených
    // produktů platí pozdější čas (mergeBrowsed) – starší záloha nesmí přepsat, co uživatel mezitím změnil.
    // Minimum v záznamech cen se přepočítá z historie (starší zálohy ho mají i s cashbackem – repairPayNowRecord)
    async importData({ items }) {
      const legacyPrefix = AlzaCore.storagePrefixes.legacyPrices;
      const historyPrefix = AlzaCore.storagePrefixes.history;
      const { notes, hidden, hiddenBrands, browsed } = AlzaCore.storageKeys;
      const converted = {};
      Object.entries(items).forEach(([key, value]) => {
        if (key.startsWith(legacyPrefix)) Object.assign(converted, this.legacyToPriceRecords(key.slice(legacyPrefix.length), value, converted));
        // Stejný produkt ve starém i novém formátu téže zálohy – sloučit, ne přepsat (minimum, maximum)
        else converted[key] = converted[key] && AlzaCore.parseProductStorageKey(key)?.kind === "price" ? this.mergeDuplicateRecords(converted[key], value) : value;
      });
      // Záznamy cen: [klíč záznamu, klíč historie téhož produktu]
      const priceKeys = Object.keys(converted)
        .map((key) => [key, AlzaCore.parseProductStorageKey(key)])
        .filter(([, parsed]) => parsed?.kind === "price")
        .map(([key, parsed]) => [key, historyPrefix + parsed.productKey]);
      const existing = await chrome.storage.local.get([...new Set([...Object.keys(converted), ...priceKeys.map(([, historyKey]) => historyKey)])]);
      const isObject = (value) => value && typeof value === "object" && !Array.isArray(value);
      Object.entries(converted).forEach(([key, value]) => {
        const kind = AlzaCore.parseProductStorageKey(key)?.kind;
        if (kind === "history") converted[key] = AlzaCore.mergeHistories(existing[key], value);
        else if (kind === "price") return; // Až se sloučenou historií – níž
        else if (!isObject(existing[key]) || !isObject(value)) return;
        else if ([notes, hidden, hiddenBrands].includes(key)) converted[key] = this.mergeNewer(existing[key], value);
        else if (key === browsed) converted[key] = this.mergeBrowsed(existing[key], value);
        else converted[key] = { ...existing[key], ...value };
      });
      // Záznam ze zálohy se opraví dřív, než se sloučí se stávajícím – sloučení bere nižší z obou minim a minimum
      // s cashbackem ze starší zálohy by přebilo už opravené
      priceKeys.forEach(([key, historyKey]) => {
        const record = isObject(converted[key]) ? structuredClone(converted[key]) : converted[key];
        if (isObject(record)) AlzaCore.repairPayNowRecord(record, converted[historyKey] ?? existing[historyKey]);
        converted[key] = this.mergeDuplicateRecords(existing[key], record);
      });
      await chrome.storage.local.set(converted);
      return Object.keys(converted).length;
    },
  },
};

globalThis.AlzaStore = AlzaStore;
