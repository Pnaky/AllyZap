// Stránka nastavení – co se zálohuje a co smaže „Smazat všechna data“, kontrola importu zálohy (i rozsahy číselných
// nastavení), začernění veřejného hlášení chyby a souboru diagnostiky a čtení odpovědi na načtení Mých nákupů.
// Bez DOM, ať to jde testovat v Node (tests/options-i18n.test.js, tests/audit-2026-11-12-options.test.js). Načítá se
// za core.js, před options.js; vše je v jednom objektu (OptionsData), ať se názvy nepotkají s options.js
const OptionsData = (() => {
  const keys = AlzaCore.storageKeys;
  const { history: HISTORY_PREFIX, price: PRICE_PREFIX, legacyPrices: LEGACY_PRICES_PREFIX } = AlzaCore.storagePrefixes;
  const DOMAIN_KEYS = Object.keys(AlzaCore.domains).join("|"); // alza_cz|alza_sk|alza_hu

  // === Co se zálohuje a maže ===
  // Každý klíč AlzaCore.storageKeys je buď v záloze, nebo v NOT_BACKED_UP (hlídá test) – nový klíč se tak nezapomene

  // Klíče storageKeys v záloze (JSON). Připomínky cashbacku ano – lhůtu registrace už z Alzy znovu nezjistíme,
  // když akce skončí
  // Peněženka poukazů ano – poukazy zadal uživatel sám, z Alzy je znovu nezjistíme
  // Poznámky a skryté produkty ano – zadal je uživatel
  const BACKUP_KEYS = [keys.watchLists, keys.watchProducts, keys.targets, keys.browsed, keys.settings, keys.cashbackReminders, keys.vouchers, keys.notes, keys.hidden, keys.hiddenBrands];

  // Klíče mimo zálohu a proč
  const NOT_BACKED_UP = {
    [keys.purchases]: "nákupy – po obnově se znovu načtou z „Moje objednávky“ na Alze",
    [keys.purchasesSync]: "čas načtení objednávek – bez něj se objednávky načtou znovu",
    [keys.codes]: "slevové kódy – platí jen pár dní, doplní je další procházení",
    [keys.cashbacks]: "cashbacky viděné na detailu – doplní je další procházení",
    [keys.cashbackTerms]: "mezipaměť termínů akcí – načte se znovu",
    [keys.cleanups]: "jednorázové opravy dat, které už proběhly – patří k tomuto prohlížeči",
    [keys.cleanup]: "návrh čistky – přepočítá ho služba na pozadí",
    [keys.watchState]: "stav posledního běhu kontroly",
    [keys.watchLog]: "log běhů kontroly",
    [keys.errorLog]: "log chyb (diagnostika)",
    [keys.vatCheck]: "poslední ověření DPH – ověří se znovu",
    [keys.owned]: "Moje nákupy – koupené zboží se znovu načte z archivu objednávek na Alze",
    [keys.ownedOrders]: "Moje nákupy – přehled objednávek se znovu načte z Alzy",
    [keys.ownedSync]: "Moje nákupy – stav načítání archivu; bez něj se archiv načte znovu",
    [keys.ownedAccounts]: "Moje nákupy jiných účtů Alzy v tomto profilu – znovu se načtou z archivu objednávek na Alze",
    [keys.news]: "viděné novinky – patří k tomuto prohlížeči",
    [keys.energy]: "mezipaměť spotřeby televizí a monitorů – načte se znovu ze stránek produktů",
  };

  // „Smazat všechna data“ nechá nastavení, log chyb (diagnostika, když se něco pokazí), záznam jednorázových
  // oprav (jinak by se spustily znovu na nová data) a viděné novinky. Všechno ostatní ze storageKeys se smaže
  const KEPT_ON_WIPE = [keys.settings, keys.errorLog, keys.cleanups, keys.news];
  const WIPE_KEYS = Object.values(keys).filter((key) => !KEPT_ON_WIPE.includes(key));

  // Záznam ceny po produktech (alzaPrice_<doména>_<id>); starý formát alzaPrices_<doména> jen z importu starších záloh
  const PRICE_KEY_PATTERN = new RegExp(`^${PRICE_PREFIX}(${DOMAIN_KEYS})_(.+)$`);
  const LEGACY_PRICES_KEY_PATTERN = new RegExp(`^${LEGACY_PRICES_PREFIX}(${DOMAIN_KEYS})$`);
  const HISTORY_KEY_PATTERN = new RegExp(`^${HISTORY_PREFIX}(${DOMAIN_KEYS})_(.+)$`);
  const BACKUP_KEY_PATTERN = new RegExp(
    `^(${LEGACY_PRICES_PREFIX}(${DOMAIN_KEYS})|${PRICE_PREFIX}(${DOMAIN_KEYS})_.+|${HISTORY_PREFIX}(${DOMAIN_KEYS})_.+|${BACKUP_KEYS.join("|")})$`
  );

  // Klíče ke smazání: produkty ze stažené zálohy (co mezitím přibylo, zůstane) a všechny klíče storageKeys kromě KEPT_ON_WIPE
  function getWipeKeys(backupData) {
    const products = Object.keys(backupData || {}).filter((key) => !Object.values(keys).includes(key));
    return [...new Set([...products, ...WIPE_KEYS])];
  }

  // === Kontrola importu ===

  const isPlainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
  const isOptionalString = (value) => value === undefined || value === null || typeof value === "string";
  const isKnownDomain = (domain) => AlzaCore.isKnownDomain(domain);
  // Čas ze zálohy: kladný a ne v budoucnosti (posunuté hodiny, ruční úprava) – jinak teď
  const isImportTime = (time, now = Date.now()) => Number.isFinite(time) && time > 0 && time <= now + AlzaCore.dayMs;
  const toImportTime = (time, now = Date.now()) => (isImportTime(time, now) ? time : now);
  // Obrázek produktu jen z Alzy – cizí adresa by se načetla v dialogu historie (sledovací pixel)
  const toImportImage = (image) => (AlzaCore.isAlzaImageUrl(image) ? image : null);
  // Adresa produktu na Alze, ke které patří doména záznamu (jinak špatná měna, kontrola na pozadí by spadla)
  const isProductOf = (item) =>
    isPlainObject(item) && AlzaCore.isAlzaUrl(item.url) && isKnownDomain(item.domain) && AlzaCore.getDomainKey(new URL(item.url).hostname) === item.domain;

  // Hlídané produkty, cílové ceny a procházené produkty: jen položky s adresou Alzy a doménou, která k adrese patří.
  // Klíč se složí znovu z domény a adresy – jinak by byl produkt hlídaný dvakrát (a "__proto__" by se tvářil jako položka)
  function sanitizeProductMap(value, requirePrice) {
    return Object.fromEntries(
      Object.values(value)
        .filter((item) => isProductOf(item) && isOptionalString(item.name) && isOptionalString(item.image) && (!requirePrice || Number.isFinite(item.price)))
        .map((item) => {
          const clean = { ...item, image: toImportImage(item.image) };
          ["since", "seenAt"].forEach((field) => {
            if (field in clean) clean[field] = toImportTime(clean[field]);
          });
          // „Prohlédnuto“ jen s platným časem – jinak by se produkt označil jako prohlédnutý právě teď
          if ("openedAt" in clean && !isImportTime(clean.openedAt)) delete clean.openedAt;
          return [AlzaCore.getProductKey(item.domain, item.url), clean];
        })
    );
  }

  // Připomínky registrace cashbacku (storageKeys.cashbackReminders, tvar z AlzaCore.createCashbackReminder): jen známá
  // pole ve správném typu. Adresa produktu a obrázek z Alzy, podmínky akce jen stránka na Alze (otevírá se z popupu
  // a stahuje s cookies), nákup v minulosti; lhůty registrace bývají v budoucnosti – rozumně daleko
  const REMINDER_FLAGS = ["termsRead", "notifiedOpen", "notifiedSoon", "done", "outsidePromo"];
  const REMINDER_MAX_AHEAD_MS = 2 * 365 * AlzaCore.dayMs;
  function sanitizeCashbackReminders(value, now = Date.now()) {
    const toDeadline = (time) => (Number.isFinite(time) && time > 0 && time <= now + REMINDER_MAX_AHEAD_MS ? time : null);
    const toText = (text) => (typeof text === "string" && text.trim() ? text.slice(0, 500) : null);
    return Object.fromEntries(
      Object.values(value)
        .filter((item) => isProductOf(item) && isImportTime(item.boughtAt, now))
        .map((item) => {
          const clean = {
            url: item.url,
            domain: item.domain,
            name: toText(item.name),
            image: toImportImage(item.image),
            terms: AlzaCore.resolveCashbackTerms(item.terms, item.domain),
            title: toText(item.title),
            refund: Number.isFinite(item.refund) && item.refund > 0 ? item.refund : null,
            boughtAt: item.boughtAt,
            registerFrom: toDeadline(item.registerFrom),
            registerUntil: toDeadline(item.registerUntil),
            termsTries: Number.isInteger(item.termsTries) ? Math.min(Math.max(item.termsTries, 0), AlzaCore.cashbackTermsTries) : 0,
          };
          REMINDER_FLAGS.forEach((flag) => (clean[flag] = item[flag] === true));
          return [AlzaCore.getProductKey(item.domain, item.url), clean];
        })
    );
  }

  // Peněženka poukazů (storageKeys.vouchers): jen poukazy, které projdou AlzaCore.sanitizeVoucher; klíč se složí znovu
  // z domény a kódu (stejný poukaz dvakrát = jeden řádek). Časy v rozumných mezích (ručně upravená záloha, „until:
  // 1e18“ = „Invalid Date“ v peněžence): platnost nejvýš VOUCHER_MAX_AHEAD_MS dopředu – jinak poukaz zůstane bez data
  // konce (peníze se nezahazují); použití a vložení do košíku ne v budoucnosti (použitý zůstane použitý – čas teď,
  // vložení se zahodí)
  const VOUCHER_MAX_AHEAD_MS = 5 * 365 * AlzaCore.dayMs;
  function sanitizeVouchers(value, now = Date.now()) {
    return Object.fromEntries(
      Object.values(value)
        .map((item) => AlzaCore.sanitizeVoucher(item, now))
        .filter(Boolean)
        .map((voucher) => {
          const clean = { ...voucher };
          if ("until" in clean && !(clean.until <= now + VOUCHER_MAX_AHEAD_MS)) delete clean.until;
          if ("usedAt" in clean) clean.usedAt = toImportTime(clean.usedAt, now);
          if ("applied" in clean && !isImportTime(clean.applied, now)) delete clean.applied;
          return [AlzaCore.getVoucherId(clean.domain, clean.code), clean];
        })
    );
  }

  // Poznámky k produktům: produkt Alzy s doménou, text do noteMaxLength
  function sanitizeNotes(value, now = Date.now()) {
    return Object.fromEntries(
      Object.values(value)
        .filter((item) => isProductOf(item) && typeof item.text === "string" && item.text.trim() && isOptionalString(item.name))
        .map((item) => [
          AlzaCore.getProductKey(item.domain, item.url),
          { text: item.text.trim().slice(0, AlzaCore.noteMaxLength), url: item.url, domain: item.domain, name: item.name || null, at: toImportTime(item.at, now) },
        ])
    );
  }

  // Skryté produkty ve výpisech (storageKeys.hidden, tvar z listing-memory.js): produkt Alzy s doménou, záznam jen ze
  // známých polí (nic dalšího ze zálohy se nepřevezme), název nejvýš HIDDEN_NAME_MAX_LENGTH znaků
  const HIDDEN_NAME_MAX_LENGTH = 500;
  function sanitizeHidden(value, now = Date.now()) {
    return Object.fromEntries(
      Object.values(value)
        .filter((item) => isProductOf(item) && isOptionalString(item.name))
        .map((item) => [
          AlzaCore.getProductKey(item.domain, item.url),
          { url: item.url, domain: item.domain, name: item.name ? item.name.slice(0, HIDDEN_NAME_MAX_LENGTH) : null, at: toImportTime(item.at, now) },
        ])
    );
  }

  // Skryté značky ve výpisech: klíč se složí znovu z uloženého názvu značky (AlzaCore.getBrandKey) – název je celá
  // značka, i víceslovná („Mobile Origin“); bez písmene nebo příliš dlouhý se zahodí
  const HIDDEN_BRAND_MAX_LENGTH = 80;
  function sanitizeHiddenBrands(value, now = Date.now()) {
    return Object.fromEntries(
      Object.values(value)
        .filter((item) => item && typeof item.name === "string")
        .map((item) => ({ name: item.name.replace(/\s+/g, " ").trim(), at: item.at }))
        .filter(({ name }) => name.length >= 2 && name.length <= HIDDEN_BRAND_MAX_LENGTH && /\p{L}/u.test(name))
        .map(({ name, at }) => [AlzaCore.getBrandKey(name), { name, at: toImportTime(at, now) }])
    );
  }

  // Číselná nastavení: stejné rozsahy jako políčka formuláře (min / max v options.html – hlídá test); integer = celé
  // číslo (formulář zaokrouhluje). Cena elektřiny má jedno políčko pro tři nastavení (podle měny hlavní Alzy)
  const SETTING_RANGES = {
    minDropPercent: { min: 0, max: 99, integer: true },
    ...Object.fromEntries(Object.values(AlzaCore.energyPriceKeys).map((key) => [key, { min: 0.01, max: 99999 }])),
    energyYears: { min: 1, max: 30, integer: true },
    energyCyclesPerWeek: { min: 1, max: 21, integer: true },
    energyHoursPerDay: { min: 0.5, max: 24 },
    monthlyBudget: { min: 0, max: 100000000, integer: true },
  };

  // Hodnota jedné volby z importu / formuláře, nebo undefined (neznámá volba, špatný typ, mimo rozsah)
  function toSetting(key, setting) {
    const defaults = AlzaCore.defaultSettings;
    if (!Object.hasOwn(defaults, key) || typeof setting !== typeof defaults[key]) return undefined;
    const keep = (ok) => (ok ? setting : undefined);
    if (key === "notifyAvailability") return keep(["all", "inStock", "off"].includes(setting));
    if (key === "uiLanguage") return keep(["auto", ...AlzaCore.uiLanguages].includes(setting));
    if (key === "primaryDomain") return keep(setting === "auto" || Object.hasOwn(AlzaCore.domains, setting));
    if (key === "quietFrom" || key === "quietTo" || key === "checkTime") return keep(AlzaCore.timePattern.test(setting));
    if (key === "checkSchedule") return keep(Object.hasOwn(AlzaCore.checkSchedules, setting));
    if (typeof setting === "number") {
      if (!Number.isFinite(setting)) return undefined;
      const range = SETTING_RANGES[key];
      if (!range) return keep(setting >= 0);
      const number = range.integer ? Math.round(setting) : setting;
      return number >= range.min && number <= range.max ? number : undefined;
    }
    return setting;
  }

  // Z importovaného nastavení jen známé volby se správným typem a v rozsahu formuláře (zbytek zůstane podle
  // stávajícího / výchozího) – např. „energyYears: 500“ z ručně upravené zálohy se nepřevezme
  function sanitizeSettings(value) {
    return Object.fromEntries(
      Object.entries(value)
        .map(([key, setting]) => [key, toSetting(key, setting)])
        .filter(([, setting]) => setting !== undefined)
    );
  }

  // === Hlášení chyby ===
  // Hlášení je veřejné – z chyb pryč adresy (zůstane jen doména, i u adres bez https:// – zdroj chyby z content scriptu
  // je „www.alza.cz/<adresa produktu>“), identifikátor instalace ve Firefoxu a v Safari a citlivé texty (slevové kódy,
  // názvy koupeného zboží – sensitive)
  function redactForReport(text, sensitive = []) {
    const result = String(text)
      .replace(/\b(moz|safari-web)-extension:\/\/[0-9a-f-]+/gi, "$1-extension://…")
      .replace(/^[0-9a-f]{8}-[0-9a-f-]{27}(?=\/)/i, "extension")
      .replace(/https?:\/\/[^\s)"']+/g, (match) => {
        try {
          return new URL(match).hostname;
        } catch {
          return "…";
        }
      })
      .replace(/\b((?:[\w-]+\.)*alza\.(?:cz|sk|hu))(?::\d+)?[/?#][^\s)"']*/gi, "$1");
    return createTextHider(sensitive)(result);
  }

  // Funkce, která z textu odstraní citlivé texty (aspoň 3 znaky) – bez ohledu na velikost písmen a na druh a počet
  // mezer (kód poukazu malými písmeny, víceřádková poznámka v chybě přepsané na jeden řádek, nedělitelná mezera
  // v názvu). Delší napřed – kratší text uvnitř delšího by ho rozbil.
  // corpus = všechen text, ve kterém se bude hledat (diagnostika: celý log a stav) – vzory se omezí na ty, které
  // v něm jsou, ať se stovky názvů z Mých nákupů nezkouší na každém řetězci zvlášť
  const HIDER_CHUNK = 100; // Kolik textů v jednom regulárním výrazu
  const escapeRegExp = (text) => text.replace(/[\\^$.*+?()[\]{}|/]/g, "\\$&");
  function createTextHider(sensitive, corpus = null) {
    const squash = (text) => text.replace(/\s+/g, " ").trim();
    const fold = (text) => squash(text).toLowerCase();
    let texts = [...new Set((Array.isArray(sensitive) ? sensitive : []).filter((item) => typeof item === "string").map(squash))].filter((item) => item.length >= 3);
    if (typeof corpus === "string") {
      const haystack = fold(corpus);
      texts = texts.filter((item) => haystack.includes(fold(item)));
    }
    texts.sort((a, b) => b.length - a.length);
    const patterns = [];
    for (let index = 0; index < texts.length; index += HIDER_CHUNK) {
      const words = texts.slice(index, index + HIDER_CHUNK).map((item) => item.split(" ").map(escapeRegExp).join("\\s+"));
      patterns.push(new RegExp(words.join("|"), "giu"));
    }
    return (text) => patterns.reduce((result, pattern) => result.replace(pattern, "…"), String(text));
  }

  // Citlivé texty z úložiště pro redactForReport: slevové kódy a názvy koupeného zboží (hlídání po nákupu, připomínky
  // cashbacku, Moje nákupy). SENSITIVE_KEYS = klíče, které si volající musí z úložiště načíst
  const SENSITIVE_KEYS = [keys.codes, keys.purchases, keys.cashbackReminders, keys.owned, keys.vouchers, keys.notes];
  function getSensitiveTexts(all) {
    const values = (key) => (isPlainObject(all?.[key]) ? Object.values(all[key]).filter(isPlainObject) : []);
    return [
      ...values(keys.codes).map((entry) => entry.code),
      ...values(keys.vouchers).flatMap((entry) => [entry.code, entry.note]),
      ...values(keys.notes).map((entry) => entry.text),
      ...values(keys.purchases).map((entry) => entry.name),
      ...values(keys.cashbackReminders).flatMap((entry) => [entry.name, entry.title]),
      ...values(keys.owned).map((entry) => entry.name),
    ].filter((text) => typeof text === "string");
  }

  // === Diagnostika ===
  // Soubor pro autora (uživatel ho posílá sám). Co kdo koupil, v něm není jménem:
  //  - nové nákupy z objednávek (lists[] s orders: true) – zůstane jen počet,
  //  - produkt hlídaný jen kvůli nákupu (items[] s purchaseOnly: true) – název a adresa se nahradí zástupným textem;
  //    stav posledního běhu (changes, problems, recent…) příznak nenese, proto se v něm skryje stejný produkt
  //    (podle klíče produktu z adresy),
  //  - zboží hlídané a zároveň koupené zůstává (uživatel ho hlídá sám), ale bez údajů o nákupu: vnořený záznam nákupu
  //    (purchase) se zahodí u každé položky logu i stavu a řádek „Koupili jste za…“ se u něj skryje,
  //  - z logu, stavu i chyb pryč citlivé texty (sensitive – slevové kódy, poukazy, poznámky a názvy koupeného zboží
  //    z getSensitiveTexts), z chyb i číslo objednávky (zdroj chyby ze stránky detailu objednávky); adresy v chybách
  //    zůstávají, podle nich se chyba hledá.
  // Vrací { watchLog (celý, od nejnovějšího), watchState, errors }
  const PURCHASED_NAME = "(koupené zboží)";
  const HIDDEN_TEXT = "(skryto)";

  function redactDiagnostics({ watchLog, watchState, errors, sensitive } = {}) {
    const list = (value) => (Array.isArray(value) ? value : []);
    const isText = (value) => typeof value === "string" && value.length >= 3;
    const toKey = (url) => {
      try {
        return AlzaCore.getProductKey(AlzaCore.getDomainKey(new URL(url).hostname), url);
      } catch {
        return null;
      }
    };
    const runs = list(watchLog).filter(isPlainObject);
    const isPurchaseOnly = (item) => isPlainObject(item) && item.purchaseOnly === true;
    // Klíče zboží hlídaného jen kvůli nákupu z logu i ze stavu (poslední změny, odložené notifikace, deník) –
    // stav drží položky déle než log (posledních N běhů), skrytí nesmí záviset na tom, jestli běh v logu ještě je
    const stateItems = isPlainObject(watchState) ? Object.values(watchState).filter(Array.isArray).flat() : [];
    const hiddenKeys = new Set(
      [...runs.flatMap((run) => list(run.items)), ...stateItems]
        .filter(isPurchaseOnly)
        .map((item) => (isText(item.key) ? item.key : toKey(item.url)))
        .filter(Boolean)
    );
    const isHidden = (item) => isPurchaseOnly(item) || (isPlainObject(item) && (hiddenKeys.has(item.key) || (isText(item.url) && hiddenKeys.has(toKey(item.url)))));

    // Název a adresa pryč i z textů položky (řádky změn, problém)
    // Do hloubky: položka deníku běhu je celý produkt i s vnořeným purchase { name, url, image } – název, adresa,
    // klíč a obrázek pryč na každé úrovni, jejich text i z ostatních řetězců
    const identityFields = ["name", "url", "key", "listUrl", "image"];
    const collectSecrets = (value, found = []) => {
      if (Array.isArray(value)) value.forEach((entry) => collectSecrets(entry, found));
      else if (isPlainObject(value)) {
        identityFields.forEach((field) => isText(value[field]) && found.push(value[field]));
        Object.values(value).forEach((entry) => typeof entry === "object" && collectSecrets(entry, found));
      }
      return found;
    };
    const hideItem = (item) => {
      const secrets = [...new Set(collectSecrets(item))].sort((a, b) => b.length - a.length);
      const clean = (value, nested = false) => {
        if (Array.isArray(value)) return value.map((entry) => clean(entry, true));
        if (isPlainObject(value)) {
          return Object.fromEntries(
            Object.entries(value).map(([field, entry]) => [field, nested && identityFields.includes(field) ? (field === "image" ? null : HIDDEN_TEXT) : clean(entry, true)])
          );
        }
        return typeof value === "string" ? secrets.reduce((text, secret) => text.split(secret).join("…"), value) : value;
      };
      const result = clean(item);
      Object.assign(result, { name: PURCHASED_NAME, url: HIDDEN_TEXT });
      if ("key" in result) result.key = HIDDEN_TEXT;
      if ("image" in result) result.image = null;
      return result;
    };
    // Zboží hlídané a zároveň koupené zůstává jménem – řádek „Koupili jste za X, teď stojí Y. Vrátit… do D.“
    // (notifyPurchaseDrop, všechny jazyky textů) u něj proto skrýt celý i s druhem změny v deníku běhu
    // ({ kind: "purchase", text }). U zboží hlídaného jen kvůli nákupu řádek zůstává – položka je beze jména.
    // Pozná se podle začátku věty po druhou částku („Koupili jste za X, teď stojí “) – konec věty se mezi verzemi
    // měnil („do“ → „nejméně do“) a log drží i starší běhy
    const purchaseLines = ["cz", "sk", "hu", "en"].map((lang) => {
      const parts = AlzaCore.translate(lang, "notifyPurchaseDrop", "\u0001", "\u0001", "\u0001").split("\u0001");
      return new RegExp(parts.slice(0, 2).map(escapeRegExp).join(".+?"));
    });
    const hidePurchaseLines = (value) => {
      if (typeof value === "string") return purchaseLines.some((pattern) => pattern.test(value)) ? HIDDEN_TEXT : value;
      if (Array.isArray(value)) return value.map(hidePurchaseLines);
      if (!isPlainObject(value)) return value;
      return Object.fromEntries(Object.entries(value).map(([field, entry]) => [field, field === "kind" && entry === "purchase" ? HIDDEN_TEXT : hidePurchaseLines(entry)]));
    };
    const hideItems = (items) => items.map((item) => (isHidden(item) ? hideItem(item) : hidePurchaseLines(item)));
    // Nové nákupy: jen počty (added / removed jsou názvy)
    const hideOrders = (entry) => {
      if (!isPlainObject(entry) || entry.orders !== true) return entry;
      return Object.fromEntries(Object.entries(entry).filter(([field]) => field !== "added" && field !== "removed"));
    };

    const state = isPlainObject(watchState)
      ? Object.fromEntries(
          Object.entries(watchState).map(([field, value]) => {
            if (!Array.isArray(value)) return [field, value];
            // unseen = klíče produktů, ostatní pole = položky s názvem a adresou
            return [field, value.map((item) => (typeof item === "string" ? (hiddenKeys.has(item) ? HIDDEN_TEXT : item) : isHidden(item) ? hideItem(item) : hidePurchaseLines(item)))];
          })
        )
      : null;

    // Citlivé texty (názvy koupeného zboží, kódy, poznámky) pryč ze všech řetězců logu i stavu, nejen z chyb –
    // i u zboží, které uživatel hlídá a zároveň koupil (řádek „Název: koupili jste za…“, název v seznamu změn)
    const collectTexts = (value, found = []) => {
      if (typeof value === "string") found.push(value);
      else if (Array.isArray(value)) value.forEach((entry) => collectTexts(entry, found));
      else if (isPlainObject(value)) Object.values(value).forEach((entry) => collectTexts(entry, found));
      return found;
    };
    const hideSensitive = createTextHider(sensitive, collectTexts([runs, watchState, errors]).join("\n"));
    // Vnořený záznam nákupu (deník běhu nese celý produkt i s purchase { name, price, count, boughtAt, buys… }) pryč
    // u každé položky a na každé úrovni – příznak purchaseOnly nenese zboží hlídané i jinak
    const scrub = (value) => {
      if (typeof value === "string") return hideSensitive(value);
      if (Array.isArray(value)) return value.map(scrub);
      if (!isPlainObject(value)) return value;
      return Object.fromEntries(
        Object.entries(value)
          .filter(([field, entry]) => !(field === "purchase" && entry !== null && typeof entry === "object"))
          .map(([field, entry]) => [field, scrub(entry)])
      );
    };
    const hideOrderNumber = (text) => (typeof text === "string" ? hideSensitive(text.replace(/(order-details-)\d+/gi, "$1…")) : text);
    return {
      watchLog: runs.map((run) =>
        scrub({
          ...run,
          ...(Array.isArray(run.items) ? { items: hideItems(run.items) } : {}),
          ...(Array.isArray(run.lists) ? { lists: run.lists.map(hideOrders) } : {}),
        })
      ),
      watchState: scrub(state),
      errors: list(errors).map((entry) => (isPlainObject(entry) ? { ...entry, source: hideOrderNumber(entry.source), message: hideOrderNumber(entry.message) } : entry)),
    };
  }

  // === Moje nákupy: odpověď služby na pozadí na „Načíst nové nákupy“ (zpráva ownedSync) ===
  // result = { status: "off" | "done" | "error", error?, domains: { "<doména>": { status: "synced" (+ blocked: true,
  // když Alza načítání odmítla a dávka skončila dřív) | "skipped" (nic k načtení) | "off" (volba vypnutá / nákupy
  // smazané během načítání) | "noLogin" | "error" (+ error), … } } }, nebo nic (služba na pozadí neodpověděla).
  // Vrací, co stránce říct:
  //   noReply – žádná odpověď, off – volba je vypnutá, error – načtení se nepovedlo ({ domain, error }),
  //   noLogin – nikde nic načteného ani přeskočeného a aspoň jedna Alza bez přihlášení, retry – odpověď bez domén,
  //   synced – načteno, nebo nebylo co načítat ({ synced: [výsledky načtených domén – u samých „skipped“ prázdné],
  //     failure: { domain, error } | null – část se nepovedla, blocked: doména, kde Alza načítání odmítla | null })
  function readOwnedSync(result) {
    if (!isPlainObject(result)) return { state: "noReply" };
    if (result.status === "off") return { state: "off" };
    if (result.status === "error") return { state: "error", domain: null, error: String(result.error || "") };
    const domains = Object.entries(isPlainObject(result.domains) ? result.domains : {}).filter(([, domain]) => isPlainObject(domain));
    const withStatus = (status) => domains.filter(([, domain]) => domain.status === status);
    if (withStatus("off").length > 0) return { state: "off" };
    const synced = withStatus("synced");
    const failed = withStatus("error")[0];
    const failure = failed ? { domain: failed[0], error: String(failed[1].error || "") } : null;
    if (synced.length + withStatus("skipped").length > 0) {
      const blocked = synced.find(([, domain]) => domain.blocked === true)?.[0] ?? null;
      return { state: "synced", synced: synced.map(([, domain]) => domain), failure, blocked };
    }
    if (failure) return { state: "error", ...failure };
    return { state: withStatus("noLogin").length > 0 ? "noLogin" : "retry" };
  }

  return {
    BACKUP_KEYS,
    NOT_BACKED_UP,
    KEPT_ON_WIPE,
    WIPE_KEYS,
    PRICE_KEY_PATTERN,
    LEGACY_PRICES_KEY_PATTERN,
    HISTORY_KEY_PATTERN,
    BACKUP_KEY_PATTERN,
    getWipeKeys,
    isPlainObject,
    isOptionalString,
    isKnownDomain,
    toImportTime,
    toImportImage,
    sanitizeProductMap,
    sanitizeCashbackReminders,
    sanitizeVouchers,
    sanitizeNotes,
    sanitizeHidden,
    sanitizeHiddenBrands,
    SETTING_RANGES,
    sanitizeSettings,
    redactForReport,
    SENSITIVE_KEYS,
    getSensitiveTexts,
    redactDiagnostics,
    readOwnedSync,
  };
})();

globalThis.OptionsData = OptionsData;
