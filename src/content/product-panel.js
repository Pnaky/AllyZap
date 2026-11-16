// Content script (část AlzaPriceTracker): Detail produktu: panel pod cenou (historie, shrnutí, hlídání na pozadí).
// Načítá se po content.js a před content/start.js (manifest) – metody sdílí objekt AlzaPriceTracker
Object.assign(AlzaPriceTracker, {
  // === Detail produktu ===
  // Panel pod cenou: historie cen (dialog i s cílovou cenou), shrnutí a hlídání na pozadí. Cenový box je
  // klasické HTML (ne React) – panel se vkládá mezi box s cenou a řádek "Hlídat cenu / Přidat do seznamu".
  // Návštěva detailu se zapíše do historie, když se produkt už sleduje, nebo je zapnuté ukládání cen
  // z procházení (pak se produkt přidá i do přehledu procházených – browsing.js).

  getProductPageInfo() {
    const id = AlzaCore.getProductId(window.location.pathname + window.location.search);
    const canonical = document.querySelector('link[rel="canonical"]')?.href;
    const useCanonical = canonical && AlzaCore.isAlzaUrl(canonical) && AlzaCore.getProductId(canonical) === id;
    return {
      url: useCanonical ? canonical : `${window.location.origin}${window.location.pathname}${AlzaCore.getProductId(window.location.pathname) ? "" : `?dq=${id}`}`,
      name: AlzaCore.getProductName(document) || document.title,
      image: document.querySelector('meta[property="og:image"]')?.content || null,
    };
  },

  async setupProductPage() {
    const product = this.getProductPageInfo();
    this.state.product = product;

    // Záznam ceny (uložené min/max) – klíčem je číslo produktu, adresa ze seznamu může být jiná
    this.state.productData = await this.getPriceRecord(product.url);

    await this.recordProductPageVisit(false).catch((error) => console.error("Error recording product page:", error));
    await this.renderProductPanel().catch((error) => console.error("Error rendering product panel:", error));
    this.setupVariantUnitPrices();
    this.setupQuantityTiers();
    this.setupCashbackTerms();

    const keys = [AlzaCore.storageKeys.watchProducts, AlzaCore.storageKeys.watchLists, AlzaCore.storageKeys.targets];
    // Moje nákupy: záznam o koupi tohoto produktu – po načtení objednávek nebo přepnutí volby znovu.
    // Poznámka k produktu se ukládá z karty (i z jiné záložky) – karta se překreslí
    const ownedKeys = [AlzaCore.storageKeys.owned, AlzaCore.storageKeys.settings, AlzaCore.storageKeys.notes];
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      // Klíč historie podle produktu, který je na stránce teď (syncProductPage ho po změně adresy vymění)
      const historyKey = this.getHistoryKey(this.state.product.url);
      if (ownedKeys.some((key) => changes[key])) {
        this.loadOwnedProduct()
          .then(() => this.scheduleProductPanel())
          .catch((error) => console.error("Error loading owned product:", error));
      } else if (changes[historyKey] || keys.some((key) => changes[key])) this.scheduleProductPanel();
    });
    await this.loadOwnedProduct().catch((error) => console.error("Error loading owned product:", error));
    if (this.state.ownedProduct) this.scheduleProductPanel();
    this.setupWarranty().catch((error) => console.error("Error saving warranty:", error));
  },

  // Moje nákupy: záruka z detailu produktu (AlzaCore.getDocumentWarranty) k záznamu ceny a ke koupeným kusům –
  // konec záruky se pak nepočítá z pevných 24 měsíců. Firemnímu účtu ji Alza dokreslí až po načtení stránky
  // („Pro firemní nákupy: Záruka 24 měsíců“), proto pár pokusů
  async setupWarranty() {
    if (!(await AlzaCore.getSettings()).ownedItems) return;
    // Produkt, pro který se záruka čte – po změně adresy bez načtení stránky (syncProductPage) už stránka může patřit
    // jinému zboží a záruka by se zapsala k nesprávnému
    const { url } = this.state.product;
    const id = AlzaCore.getProductId(url);
    for (const delay of [0, 2000, 4000, 8000]) {
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
      if (!AlzaCore.isContextAlive()) return;
      if (this.state.product.url !== url || AlzaCore.getProductId(window.location.pathname + window.location.search) !== id) return;
      const warranty = AlzaCore.getDocumentWarranty(document);
      if (!warranty) continue;
      await AlzaStore.run({ type: "setWarranty", domain: this.getAlzaDomain(), url, warranty });
      return;
    }
  },

  // Nákupy tohoto produktu z přehledu Moje nákupy (jen se zapnutou volbou ownedItems); null = nekoupeno / vypnuto.
  // Spolu s nimi poznámka k produktu (storageKeys.notes)
  async loadOwnedProduct() {
    const notesKey = AlzaCore.storageKeys.notes;
    const { [notesKey]: notes } = await chrome.storage.local.get(notesKey);
    const noteKey = AlzaCore.getProductKey(this.getAlzaDomain(), this.state.product.url);
    this.state.productNote = notes && typeof notes === "object" && Object.hasOwn(notes, noteKey) ? notes[noteKey] : null;
    const key = AlzaCore.storageKeys.owned;
    const settings = await AlzaCore.getSettings();
    const owned = settings.ownedItems ? (await chrome.storage.local.get(key))[key] : null;
    const productKey = this.getProductKey(this.state.product.url);
    const product = owned && typeof owned === "object" && Object.hasOwn(owned, productKey) ? owned[productKey] : null;
    this.state.ownedProduct = product && Array.isArray(product.buys) ? product : null;
  },

  // „Provoz 10 let: 8 400 Kč · s pořizovací cenou 16 790 Kč“ (volba energyCost) – výpočet v bublině; null = stránka
  // spotřebu neuvádí nebo je volba vypnutá. price = cena k zaplacení (null = produkt se neprodává)
  async createEnergyNote(price) {
    const energy = AlzaCore.getDocumentEnergy(document);
    if (!energy) return null;
    const domainKey = this.getAlzaDomain();
    this.rememberEnergy(energy).catch((error) => console.error("AllyZap – spotřeba do mezipaměti:", error));
    const settings = AlzaCore.getEnergySettings(await AlzaCore.getSettings(), domainKey);
    if (!settings.enabled) return null;
    const { yearlyKwh, yearly, cost } = AlzaCore.getEnergyCost(energy, settings);
    const { locale, currency } = AlzaCore.domains[domainKey];
    const number = (value, digits = 0) => value.toLocaleString(locale, { maximumFractionDigits: digits });
    const plural = settings.years === 1 ? "One" : settings.years <= 4 ? "Few" : "Many";
    const parts = [this.translate(`productEnergy${plural}`, settings.years, this.formatPrice(cost))];
    if (price > 0) parts.push(this.translate("productEnergyTotal", this.formatPrice(price + cost)));
    const usage = {
      year: () => this.translate("productEnergyUseYear", number(energy.kwh, 1)),
      cycles: () => this.translate("productEnergyUseCycles", number(energy.kwh, 1), settings.cyclesPerWeek, number(yearlyKwh)),
      hours: () => this.translate("productEnergyUseHours", number(energy.kwh, 1), number(settings.hoursPerDay, 1), number(yearlyKwh)),
    }[energy.per]();
    const note = this.createProductFact("bolt", parts.join(" · "));
    note.title = `${usage} × ${number(settings.price, 2)} ${currency}/kWh × ${settings.years} = ${this.formatPrice(cost)}\n${this.translate("productEnergyHint", this.formatPrice(yearly))}`;
    return note;
  },

  // Spotřeba televize / monitoru do mezipaměti pro výpisy (storageKeys.energy) – jen když chybí nebo se změnila
  async rememberEnergy(energy) {
    if (energy.per !== "hours" || this.state.energyRemembered) return;
    this.state.energyRemembered = true;
    const key = AlzaCore.getProductKey(this.getAlzaDomain(), this.state.product.url);
    const cacheKey = AlzaCore.storageKeys.energy;
    const { [cacheKey]: cache } = await chrome.storage.local.get(cacheKey);
    const cached = AlzaCore.getCachedEnergy(cache, key);
    if (cached && cached.kwh === energy.kwh && cached.per === energy.per) return;
    await AlzaStore.run({ type: "patchMap", key: cacheKey, set: { [key]: { kwh: energy.kwh, per: energy.per, at: Date.now() } } });
  },

  // Řádek seznamu informací pod upozorněním: ikona, text a odkaz vpravo. tone = barva textu (wait, reached, user),
  // iconTone = ikona v barvě textu
  createProductFact(icon, text, { tone = null, link = null, iconTone = false } = {}) {
    const className = ["alza-price-tracker-product-note", "alza-price-tracker-product-fact", tone && `alza-price-tracker-product-note--${tone}`];
    const fact = this.createEl("div", className.filter(Boolean).join(" "));
    fact.appendChild(this.createEl("span", "alza-price-tracker-product-fact-text", text));
    if (link) fact.appendChild(link);
    return AlzaIcons.prepend(fact, icon, { tone: iconTone });
  },

  // Odkaz vpravo v řádku informací („Objednávka ›“, „Zobrazit ›“) – <a> s adresou nebo <button>
  createProductFactLink(tag, label) {
    const link = this.createEl(tag, "alza-price-tracker-product-fact-link", label);
    if (tag === "button") link.type = "button";
    link.appendChild(AlzaIcons.create(document, "chevron", { tone: true }));
    return link;
  },

  // Výstrahy v jednom boxu: nadpis (podezřelá sleva, jen podezřelé ceny → podezřelá cena) a odrážky.
  // alerts = [{ text, hint?, price? }] – price = podezřelá cena (možná chyba čtení), ne sleva
  createProductAlert(alerts) {
    const box = this.createEl("div", "alza-price-tracker-product-alert");
    box.setAttribute("role", "note");
    const body = this.createEl("div", "alza-price-tracker-product-alert-body");
    const discount = alerts.some((alert) => !alert.price);
    body.appendChild(this.createEl("div", "alza-price-tracker-product-alert-title", this.translate(discount ? "filterSuspicious" : "productAlertPrice")));
    const list = this.createEl("ul", "alza-price-tracker-product-alert-list");
    alerts.forEach(({ text, hint }) => {
      const item = this.createEl("li", "alza-price-tracker-product-alert-item", text);
      if (hint) item.title = hint;
      list.appendChild(item);
    });
    body.appendChild(list);
    box.append(AlzaIcons.create(document, "warning", { tone: true }), body);
    return box;
  },

  // Tlačítko jen s ikonou: ikona a popisek v bublině i pro čtečky (Kopírovat nabídku ho po kliknutí dočasně změní)
  setProductIconButton(button, icon, label) {
    button.title = label;
    button.setAttribute("aria-label", label);
    return AlzaIcons.prepend(button, icon);
  },

  // Tlačítko stavu (nový / rozbalený / zánovní) v přepínači na stránce – „Zobrazit“ u levnějšího stavu ho stiskne
  findConditionButton(condition) {
    const pattern = AlzaCore.conditionPatterns[condition];
    if (!pattern) return null;
    const buttons = [...document.querySelectorAll('[data-testid="component-detailVariants"] button')];
    return buttons.find((button) => pattern.test(button.querySelector("div[aria-label]")?.firstChild?.textContent.trim() || "")) || null;
  },

  // „Koupili jste 12. 3. 2025 za 5 990 Kč · celkem 3× · záruka asi do 12. 3. 2027 · Objednávka“ – poslední nevrácený
  // nákup; null = produkt koupený není
  createOwnedNote() {
    const buys = (this.state.ownedProduct?.buys || []).filter((buy) => Number.isFinite(buy?.t) && !buy.ret);
    const last = buys.at(-1);
    if (!last) return null;
    const lang = this.state.uiLanguage || this.state.language || "cz";
    const date = (time) => AlzaCore.formatTextDate(time, lang, true);
    const parts = [last.p > 0 ? this.translate("productOwnedPrice", date(last.t), this.formatPrice(last.p)) : this.translate("productOwned", date(last.t))];
    if (buys.length > 1) parts.push(this.translate("productOwnedTimes", buys.length));
    const warranty = AlzaCore.getWarrantyState(last);
    if (warranty.state === "active" || warranty.state === "ending") parts.push(this.translate("productOwnedWarranty", date(warranty.until)));
    if (warranty.state === "extended") parts.push(this.translate("productOwnedClaimable"));
    // Opakovaný nákup: rytmus a odhad dalšího (Dochází vám?). Odhad dávno v minulosti se neukazuje – stejné pravidlo
    // jako seznam v Mých nákupech (getRestockDays); u jinak velkého nákupu než obvykle i počet kusů
    const rhythm = AlzaCore.getRestockRhythm(this.state.ownedProduct);
    if (rhythm && AlzaCore.getRestockDays(rhythm) !== null) {
      const key = AlzaCore.isRestockUnusual(rhythm) ? "productOwnedRhythmPieces" : "productOwnedRhythm";
      parts.push(this.translate(key, AlzaCore.formatDays(lang, rhythm.interval), date(rhythm.next), rhythm.pieces));
    }
    const orderUrl = AlzaCore.getOrderUrl(this.getAlzaDomain(), last.o);
    let link = null;
    if (orderUrl) {
      link = this.createProductFactLink("a", this.translate("productOwnedOrder"));
      Object.assign(link, { href: orderUrl, target: "_blank", rel: "noopener" });
    }
    return this.createProductFact("bag", parts.join(" · "), { link });
  },

  // Cashback: pod Alzin řádek „Cena s CashBack“ (do jeho rámečku) termíny akce – konec nákupu a lhůta registrace
  // u výrobce. Název řádku už na stránku akce odkazuje, odkaz se neopakuje
  setupCashbackTerms() {
    const row = document.querySelector('.promo-action-prices__row[data-type="cashback"]');
    if (!row || row.querySelector(".alza-price-tracker-cashback-detail")) return;
    const promo = AlzaCore.getCashbackPromo(row);
    const url = AlzaCore.resolveCashbackTerms(promo.terms, this.getAlzaDomain());
    if (!url) return;
    this.requestCashbackTerms(url, promo.title).then((terms) => {
      const lines = this.getCashbackTermsLines(terms);
      if (lines.length === 0 || !row.isConnected || row.querySelector(".alza-price-tracker-cashback-detail")) return;
      const line = this.createEl("div", "alza-price-tracker-cashback-detail");
      lines.forEach(({ text, warn }, index) => {
        if (index > 0) line.append(" · ");
        line.appendChild(this.createEl("span", warn ? "alza-price-tracker-cashback-terms-line--warn" : null, text));
      });
      // Zarovnat pod název akce (za ikonou)
      const name = row.querySelector(".promo-action-prices__name");
      if (name) line.style.paddingLeft = `${Math.max(0, name.getBoundingClientRect().left - row.getBoundingClientRect().left - parseFloat(getComputedStyle(row).paddingLeft || 0))}px`;
      row.setAttribute("data-alza-price-tracker-cashback", "");
      row.appendChild(line);
    });
  },

  // Množstevní slevy: Alza tabulku stupňů ukáže až se zbožím v košíku – bublina nad tlačítkem košíku. Bez zboží
  // v košíku stejná bublina od nás, 1:1 (místo, rozměry, texty z Alziny skryté tabulky .quantityRepeater), ať se nic
  // neposune; banner „Kup víc, zaplať míň“ zůstává pod ní. Když Alza ukáže svou, naše zmizí
  setupQuantityTiers() {
    const selectors = this.quantityTiersSelectors;
    const rows = [...document.querySelectorAll(selectors.alzaRows)]
      .map((row) => ({
        label: row.querySelector(".colLabel")?.textContent.replace(/\s+/g, " ").trim(),
        value: row.querySelector(".colValue")?.textContent.replace(/\s+/g, " ").trim(),
        current: row.classList.contains("sel"),
      }))
      .filter(({ label, value }) => label && value);
    if (rows.length < 2 || !document.querySelector(selectors.anchor)) return;
    const saving = document.querySelector(selectors.alzaSaving)?.textContent.replace(/\s+/g, " ").trim() || null;

    let bubble = null;
    const build = () => {
      const box = this.createEl("div", "alza-price-tracker-tiers-bubble");
      box.setAttribute("role", "tooltip");
      rows.forEach(({ label, value, current }) => {
        const row = this.createEl("div", `alza-price-tracker-tiers-bubble-row${current ? " alza-price-tracker-tiers-bubble-row--current" : ""}`);
        row.append(this.createEl("span", null, label), this.createEl("span", null, value));
        box.appendChild(row);
      });
      if (saving) {
        const row = this.createEl("div", "alza-price-tracker-tiers-bubble-row alza-price-tracker-tiers-bubble-row--saving");
        row.append(this.createEl("span", null, this.translate("quantityTierTotalSaving")), this.createEl("span", null, saving));
        box.appendChild(row);
      }
      box.appendChild(this.createEl("span", "alza-price-tracker-tiers-bubble-arrow"));
      return box;
    };
    const sync = () => {
      const anchor = document.querySelector(selectors.anchor);
      const alzaShows = [...document.querySelectorAll(selectors.alzaPopup)].some((popup) => popup.getBoundingClientRect().width > 0);
      const banner = document.querySelector(selectors.banner);
      if (!anchor || alzaShows) {
        bubble?.remove();
        bubble = null;
        banner?.removeAttribute(this.quantityTiersAttribute);
        return;
      }
      // Text banneru pod bublinou jako u Alzy schovaný (místo zůstane – nic se neposune), ikona „Kup víc“ zůstává
      if (banner && !banner.hasAttribute(this.quantityTiersAttribute)) banner.setAttribute(this.quantityTiersAttribute, "");
      // V bloku ceny (posouvá se s ním, i když se stránka nad ním dočte), nad tlačítkem košíku, stejně široká
      const scope = document.querySelector(selectors.scope);
      if (!scope) return;
      if (getComputedStyle(scope).position === "static" && !scope.hasAttribute(this.quantityTiersScopeAttribute)) scope.setAttribute(this.quantityTiersScopeAttribute, "");
      if (!bubble) bubble = build();
      if (bubble.parentElement !== scope) scope.appendChild(bubble);
      const rect = anchor.getBoundingClientRect();
      const base = scope.getBoundingClientRect();
      const left = `${Math.round(rect.left - base.left) + this.quantityTiersOffsetX}px`;
      const width = `${Math.round(rect.width)}px`;
      const top = `${Math.round(rect.top - base.top - this.quantityTiersGap - bubble.offsetHeight)}px`;
      if (bubble.style.left !== left) bubble.style.left = left;
      if (bubble.style.width !== width) bubble.style.width = width;
      if (bubble.style.top !== top) bubble.style.top = top;
    };
    sync();
    let frame = 0;
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        sync();
      });
    };
    // Bublina Alzy se objeví v React části (tlačítka košíku); poloha se mění se šířkou okna
    new MutationObserver(schedule).observe(document.querySelector(selectors.scope) || document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["style", "class"],
    });
    window.addEventListener("resize", schedule, { passive: true });
  },

  quantityTiersSelectors: {
    scope: ".price-detail", // Cena, banner i tlačítka košíku
    anchor: ".price-detail__buy-actions .buy-button-placeholder", // Tlačítko košíku – bublina nad ním
    alzaRows: ".quantityRepeater .row[data-cntfrom]", // Alzina skrytá tabulka: „1 balení | 89,-/balení“
    alzaSaving: ".quantityRepeater .discountAmount",
    banner: ".quantityDiscountPromoCont", // „Kup víc, zaplať míň – Množstevní slevy – Sleva už od 2 balení“
    alzaPopup: ".price-detail__buy-actions .MuiTooltip-popper", // Alzina bublina se zbožím v košíku
  },
  quantityTiersAttribute: "data-alza-price-tracker-tiers", // Banner pod naší bublinou (main.css)
  quantityTiersScopeAttribute: "data-alza-price-tracker-tiers-scope", // Blok ceny jako základ polohy bubliny (main.css)
  quantityTiersGap: 14, // Mezera pro šipku mezi bublinou a tlačítkem (jako u Alzy)
  quantityTiersOffsetX: 1, // Alzina bublina je o 1 px vpravo od tlačítka

  scheduleProductPanel() {
    clearTimeout(this.state.productPanelTimeout);
    this.state.productPanelTimeout = setTimeout(
      () => this.renderProductPanel().catch((error) => console.error("Error rendering product panel:", error)),
      50
    );
  },

  // Rozepsaná poznámka: překreslení by kartu vyměnilo a pole by přišlo o fokus (i o kurzor a rozepsané slovo).
  // Dokud je fokus v editoru, překreslení se odloží (state.productPanelPending) a doběhne, až ho editor ztratí
  isNoteEditorFocused() {
    const active = document.activeElement;
    return Boolean(active && typeof active.closest === "function" && active.closest(".alza-price-tracker-note-editor"));
  },

  flushProductPanel() {
    if (!this.state.productPanelPending) return;
    this.state.productPanelPending = false;
    this.scheduleProductPanel();
  },

  // Alza může detail vyměnit bez načtení stránky (jiná adresa, týž dokument) – stav karty by dál patřil původnímu
  // produktu. Při vykreslení se proto porovná číslo produktu v adrese a při rozdílu se stav založí znovu (produkt,
  // záznam ceny, nákupy a poznámka; otevřená poznámka / recenze začnou zavřené – getProductExtras). Jen čtení: ceny
  // se tu do historie nezapisují, stránka může ještě chvíli ukazovat původní produkt
  async syncProductPage() {
    const id = AlzaCore.getProductId(window.location.pathname + window.location.search);
    if (!id || !this.state.product || String(id) === String(AlzaCore.getProductId(this.state.product.url))) return false;
    const product = this.getProductPageInfo();
    this.state.product = product;
    this.state.productData = await this.getPriceRecord(product.url);
    this.state.productSaveProblem = null;
    await this.loadOwnedProduct();
    return true;
  },

  // Hlídá se produkt? watched = interní seznam "Hlídané produkty", lists = názvy hlídaných seznamů s produktem
  async getProductWatchInfo() {
    const { watchProducts, watchLists } = AlzaCore.storageKeys;
    const data = await this.getStorageData([watchProducts, watchLists]);
    const { url } = this.state.product;
    const id = AlzaCore.getProductId(url);
    const domain = this.getAlzaDomain();
    return {
      watched: Boolean(data[watchProducts]?.[this.getProductKey(url)]),
      lists: Object.values(data[watchLists] || {})
        .filter((list) => list.domain === domain && Object.keys(list.products || {}).some((productUrl) => AlzaCore.getProductId(productUrl) === id))
        .map((list) => list.name),
    };
  },

  getProductPagePrices() {
    return AlzaCore.extractPricesFromDocument(document);
  },

  // force = právě zapnuté hlídání (první záznam historie)
  async recordProductPageVisit(force) {
    const { url } = this.state.product;
    if (!force) {
      const [entries, watch] = await Promise.all([this.getPriceHistory(url), this.getProductWatchInfo()]);
      const tracked = entries.length > 0 || watch.watched || watch.lists.length > 0 || this.state.targets[this.getProductKey(url)];
      if (!tracked && !this.state.saveBrowsing) return;
    }
    if (this.state.saveBrowsing && typeof AlzaBrowsing !== "undefined") AlzaBrowsing.rememberProduct(this.state.product);

    const prices = this.getProductPagePrices();
    // Nepřihlášen / ceny bez DPH – nic neukládat; důvod ukáže karta místo „Zatím bez historie“
    const problem = await AlzaCore.resolveSaveProblem(AlzaCore.getSaveProblem(document, prices), AlzaCore.isVatSignMissing(document), prices, this.getAlzaDomain(), url);
    if (problem !== this.state.productSaveProblem) {
      this.state.productSaveProblem = problem;
      this.scheduleProductPanel?.();
    }
    if (problem) return;
    // Ceny jiných stavů a množstevní slevy do záznamu ceny – košík a seznam je berou odtud, ne ze stránky. Jen dokud
    // stránka patří tomuto produktu (po změně adresy bez načtení už může ukazovat jiný)
    if (AlzaCore.getProductId(window.location.pathname + window.location.search) === AlzaCore.getProductId(url)) {
      await AlzaStore.run({
        type: "setPageMeta",
        domain: this.getAlzaDomain(),
        url,
        conditions: AlzaCore.getDocumentConditions(document, window.location.href),
        quantityTiers: AlzaCore.getDocumentQuantityTiers(document),
      }).catch((error) => console.error("AllyZap – metaúdaje záznamu ceny:", error));
    }
    const availability = this.classifyAvailability(AlzaCore.extractAvailabilityFromDocument(document));
    if (AlzaCore.getPriceEntries(prices).length === 0 && availability === null) return;

    // Bez názvu – nadpis živé stránky se může lišit od staženého HTML (seznam, služba na pozadí)
    // a název by se v historii střídal; název dodá seznam a kontrola na pozadí
    await this.recordPriceHistory(url, prices, availability, this.state.productData);
  },

  // Důvod, proč se ceny neukládají – text kontroly na pozadí bez dovětku „kontrola přerušena“ (na detailu nic neběží).
  // Text je ve slovníku jádra (AlzaCore.texts), jazyk rozhraní jako ostatní texty karty
  getSaveProblemNote(key) {
    return AlzaCore.translate(this.state.uiLanguage || this.state.language || "cz", key).replace(/,\s*(kontrola přerušena|kontrola prerušená|ellenőrzés megszakítva|check stopped)$/, "");
  },

  async setProductWatched(enabled) {
    const { url, name, image } = this.state.product;
    const key = this.getProductKey(url);
    await AlzaStore.run({
      type: "patchMap",
      key: AlzaCore.storageKeys.watchProducts,
      ...(enabled ? { set: { [key]: { url, domain: this.getAlzaDomain(), name, image, since: Date.now() } }, keep: ["since"] } : { remove: [key] }),
    });
    if (enabled) await this.recordProductPageVisit(true);
  },

  // Karta v levém sloupci pod fotkami (je tam volné místo a je víc vidět než pod cenou):
  // záhlaví s hlídáním, dlaždice, malý graf nejnižší ceny, upozornění a tlačítka do dialogu historie
  async renderProductPanel() {
    if (this.isNoteEditorFocused()) {
      this.state.productPanelPending = true;
      return;
    }
    await this.syncProductPage();
    const product = this.state.product;
    const productData = this.state.productData;
    const [entries, watch] = await Promise.all([this.getDisplayHistory(product.url), this.getProductWatchInfo()]);
    const format = (price) => this.formatPrice(price);
    const openDialog = (focusTarget) => this.openHistoryDialog(product, productData, { focusTarget });

    // Aktuální ceny ze stránky – čerstvější než poslední záznam historie
    const priceMap = AlzaCore.toPriceMap(this.getProductPagePrices());
    const lowestNow = AlzaCore.getLowestPrice(priceMap);
    // Cena k zaplacení – cashback a výkup platí jen za podmínek (ukážou se v tooltipu „Aktuálně“)
    const payNow = AlzaCore.getPayNowPrice(priceMap) ?? lowestNow;
    // Hodnocení ceny bez nesmyslně nízké ceny; ta se ukáže jako aktuální, ale s výstrahou
    const plausibleNow = AlzaCore.getPlausiblePayNowPrice(priceMap); // Bez cashbacku a výkupu – platí jen za podmínek
    const suspicious = AlzaCore.getSuspiciousPrices(entries, priceMap);
    const hasHistory = entries.some((entry) => Object.keys(entry.p).length > 0);
    const target = this.state.targets[this.getProductKey(product.url)];

    const card = this.createEl("div", "alza-price-tracker-product");

    const head = this.createEl("div", "alza-price-tracker-product-head");
    // Štítek na hraně karty stejný jako u lišt („AllyZap“), co karta ukazuje říká bublina
    const title = this.createEl("span", "alza-price-tracker-product-title", "AllyZap");
    title.title = this.translate("productHistory");
    head.appendChild(title);
    const watchButton = this.createEl("button", "alza-price-tracker-product-button alza-price-tracker-product-watch");
    watchButton.type = "button";
    if (watch.lists.length > 0) {
      watchButton.textContent = this.translate("productWatchedInList", watch.lists.join(", "));
      AlzaIcons.prepend(watchButton, "bell");
      watchButton.disabled = true;
    } else {
      watchButton.textContent = this.translate(watch.watched ? "productUnwatch" : "productWatch");
      AlzaIcons.prepend(watchButton, watch.watched ? "bell-off" : "bell");
      watchButton.title = this.translate("productWatchHint");
      watchButton.addEventListener("click", () => {
        watchButton.disabled = true;
        // Při chybě tlačítko znovu povolit (panel se jinak překreslí po změně ve storage)
        this.setProductWatched(!watch.watched).catch((error) => {
          console.error("Error toggling product watch:", error);
          watchButton.disabled = false;
        });
      });
    }
    head.append(this.createComparatorLinks(product.name), watchButton);
    card.appendChild(head);

    const stats = this.createEl("div", "alza-price-tracker-product-stats");
    const addStat = (label, value, sub, color, subColor) => this.appendStat(stats, "product", label, value, sub, color, subColor);
    const verdict = hasHistory ? AlzaCore.getPriceVerdict(entries, plausibleNow) : null;
    if (lowestNow !== null) {
      // Pod aktuální cenou hodnocení vůči obvyklé ceně (zeleně / červeně); podezřelá cena oranžově s ikonou výstrahy
      // Hodnocení se týká věrohodné ceny – pod nesmyslně nízkou by mátlo (zůstává v dlaždici Obvyklá cena)
      const lowestSuspicious = suspicious.find(({ price }) => price === payNow);
      const verdictText = verdict && lowestSuspicious?.reason !== "gap" && this.getVerdictText(verdict, plausibleNow);
      const stat = addStat(
        this.translate("productCurrent"),
        format(payNow),
        verdictText?.label,
        lowestSuspicious ? this.config.historyMilestoneColors.target : null,
        verdictText?.color
      );
      if (lowestSuspicious) AlzaIcons.prepend(stat.querySelector(".alza-price-tracker-product-stat-value"), "warning", { tone: true });
      if (verdictText) stat.title = verdictText.hint;
      if (lowestSuspicious) stat.title = [this.getSuspiciousText(lowestSuspicious), stat.title].filter(Boolean).join("\n");
      if (lowestNow < payNow) this.appendTitle(stat, this.translate(`priceWith_${AlzaCore.getLaterRefundType(priceMap)}`, format(lowestNow)));
    }

    // Skutečná cena za kus i bez historie – Alza ji na stránce počítá jen z ceny pro všechny
    const packCount = this.getProductPackCount(product, productData);
    if (packCount && lowestNow !== null) {
      const unit = (price) => `${this.formatUnitPrice(price / packCount)}/${this.translate("pieceUnit")}`;
      const stat = addStat(this.translate("statUnit"), unit(payNow), this.translate("statUnitSub", packCount));
      const perType = AlzaCore.getPriceEntries(priceMap).map(({ type, price }) => `${this.translate(`type_${type}`)}: ${unit(price)}`);
      stat.title = [this.translate("statUnitHint"), ...(perType.length > 1 ? ["", ...perType] : [])].join("\n");
    }

    // Výstrahy (podezřelá sleva, vymyšlená přeškrtnutá cena, podezřelá cena) v jednom boxu, doplňující informace
    // (loni, rytmus akcí, jiný stav, cena provozu, nákup, cíl, poznámka) jako tichý seznam s ikonou a odkazem vpravo
    const alerts = [];
    const facts = [];
    if (hasHistory) {
      const warning = AlzaCore.getDiscountWarning(entries, priceMap);
      const strikethrough = AlzaCore.getStrikethroughWarning(entries, priceMap);
      const lowest30 = AlzaCore.getLowestInWindow(entries);
      const min = this.getHistoricExtreme(entries, productData?.minPrice, "min");
      if (verdict) addStat(this.translate("statTypical"), format(verdict.typical)).title = this.getVerdictText(verdict, plausibleNow).hint;
      if (lowest30) addStat(this.translate("statLowest30"), format(lowest30.value), this.formatDate(lowest30.at), warning ? this.config.historyMilestoneColors.target : null);
      if (min) addStat(this.translate("statMin"), format(min.value), this.formatDate(min.timestamp), this.config.historyMilestoneColors.min);
      card.appendChild(stats);

      const chart = this.createProductSparkline(entries, min, target);
      chart.title = this.translate("historyHint");
      chart.addEventListener("click", () => openDialog(false));
      card.appendChild(chart);

      if (warning) {
        const partial = warning.complete ? "" : ` · ${this.translate("discountPartial", this.formatDays(Math.max(1, warning.days)))}`;
        alerts.push({ text: `${this.translate("productAlertDiscount", format(warning.value), this.formatDate(warning.at))}${partial}`, hint: this.getDiscountWarningText(warning).hint });
      }
      if (strikethrough) alerts.push({ text: this.getStrikethroughText(strikethrough) });
      // Loni v nadcházejícím měsíci (Black Friday, AlzaDny…) – jen s historií starší než rok. Bylo-li loni levněji
      // jen proto, že produkt od té doby trvale zdražil (lower bez cheaper), není co říct: akce to nebyla
      // a „nebyl levnější než teď“ by nebyla pravda
      const lastYear = AlzaCore.getLastYearOutlook(entries, plausibleNow);
      if (lastYear && (lastYear.cheaper || !lastYear.lower)) {
        const lang = this.state.uiLanguage || this.state.language || "cz";
        const date = AlzaCore.formatTextDate(lastYear.at, lang, true);
        const text = lastYear.cheaper ? this.translate("productLastYearDrop", this.formatPrice(lastYear.lowest), date) : this.translate("productLastYearNone", this.formatPrice(lastYear.lowest));
        facts.push(this.createProductFact("event", text, { tone: lastYear.cheaper ? "wait" : null }));
      }
      const saleCycle = AlzaCore.getSaleCycle(entries, plausibleNow);
      if (saleCycle && verdict) {
        const { summary, advice } = this.getSaleCycleText(saleCycle, verdict.days);
        facts.push(this.createProductFact("hourglass", advice ? `${summary}. ${advice}` : summary, { tone: saleCycle.wait ? "wait" : null }));
      }
    } else {
      // Bez historie jen aktuální cena a cena za kus – samotná aktuální cena by jen opakovala stránku
      if (packCount && lowestNow !== null) card.appendChild(stats);
      const text = this.getNoPriceNote(entries) || (this.state.productSaveProblem ? this.getSaveProblemNote(this.state.productSaveProblem) : this.translate("productNoHistory"));
      facts.push(this.createProductFact("info", text));
    }

    // Podezřelá cena i bez historie (pod polovinou další ceny se pozná z jediného načtení)
    suspicious.forEach((item) => alerts.push({ text: this.getSuspiciousText(item), price: true }));
    if (alerts.length > 0) card.appendChild(this.createProductAlert(alerts));

    // Stejný produkt levněji rozbalený / zánovní (přepínač stavu na stránce) – „Zobrazit“ přepne stav na stránce
    const cheaperConditions = AlzaCore.getCheaperConditions(AlzaCore.getDocumentConditions(document, window.location.href), plausibleNow);
    if (cheaperConditions.length > 0) {
      const text = cheaperConditions
        .map(({ condition, price, diff }) => this.translate("cheaperConditionItem", this.translate(`condition${condition[0].toUpperCase()}${condition.slice(1)}`), this.formatPrice(price), this.formatPrice(diff)))
        .join(" · ");
      const variant = this.findConditionButton(cheaperConditions[0].condition);
      const link = variant ? this.createProductFactLink("button", this.translate("productShowCondition")) : null;
      link?.addEventListener("click", () => variant.click());
      facts.push(this.createProductFact("inventory", text, { link }));
    }

    // Cena provozu (lednice, pračky, sušičky, televize, monitory): spotřeba ze stránky × cena elektřiny z nastavení
    const energyNote = await this.createEnergyNote(AlzaCore.getPayNowPrice(priceMap));
    if (energyNote) facts.push(energyNote);

    // Moje nákupy: tento produkt už máte – kdy a za kolik, záruka, odkaz na objednávku
    const ownedNote = this.createOwnedNote();
    if (ownedNote) facts.push(ownedNote);

    if (target) {
      const status = this.getTargetStatus(target, lowestNow, priceMap);
      const reached = lowestNow !== null && lowestNow <= target.price;
      facts.push(this.createProductFact("target", this.translate("productTarget", this.formatTargetValue(target.price, target), status), { tone: reached ? "reached" : null, iconTone: reached }));
    }
    if (this.state.productNote) facts.push(this.createProductFact("flag", this.state.productNote.text, { tone: "user", iconTone: true }));
    if (facts.length > 0) {
      const list = this.createEl("div", "alza-price-tracker-product-facts");
      list.append(...facts);
      card.appendChild(list);
    }

    // Celá historie a Cílová cena jako tlačítka, Poznámka / Recenze naruby / Kopírovat nabídku jen jako ikony vpravo (popisek v bublině)
    const foot = this.createEl("div", "alza-price-tracker-product-foot");
    const historyButton = this.createEl("button", "alza-price-tracker-product-button", this.translate("productShowHistory"));
    AlzaIcons.prepend(historyButton, "chart");
    historyButton.type = "button";
    historyButton.addEventListener("click", () => openDialog(false));
    const targetButton = this.createEl("button", "alza-price-tracker-product-button", this.translate("targetLabel"));
    AlzaIcons.prepend(targetButton, "target");
    targetButton.type = "button";
    targetButton.addEventListener("click", () => openDialog(true));
    const iconButton = (icon, label) => {
      const button = this.createEl("button", "alza-price-tracker-product-button alza-price-tracker-product-button--icon");
      button.type = "button";
      this.setProductIconButton(button, icon, label);
      return button;
    };
    // Kopírovat nabídku – text pro chat / sociální sítě (název, ceny, kód, obvyklá cena, odkaz)
    const offerButton = iconButton("copy", this.translate("offerCopy"));
    offerButton.addEventListener("click", async () => {
      const verdictNow = hasHistory ? AlzaCore.getPriceVerdict(entries, plausibleNow) : null;
      const lowest30Now = hasHistory ? AlzaCore.getLowestInWindow(entries) : null;
      const copied = await this.copyText(this.buildOfferText(product, this.getProductPagePrices(), verdictNow, lowest30Now));
      this.setProductIconButton(offerButton, copied ? "check-circle" : "error", this.translate(copied ? "offerCopied" : "codeCopyFailed"));
      setTimeout(() => this.setProductIconButton(offerButton, "copy", this.translate("offerCopy")), 1800);
    });
    // Poznámka k produktu (zobrazí se tady i na dlaždici ve výpisech – listing-memory.js) a Recenze naruby (načte se až
    // po kliknutí). Tlačítka otevírají i zavírají (aria-expanded); co je otevřené, zůstane i po překreslení karty
    // (změna ve storage) – stav, rozepsaný text a načtené recenze drží state.productExtras
    const extras = this.getProductExtras(product);
    const noteButton = iconButton("edit", this.translate(this.state.productNote ? "noteEdit" : "noteAdd"));
    const reviewsButton = iconButton("reviews", this.translate("reviewsOpen"));
    // extras.repaint se na novou kartu přepne až těsně před její výměnou (níž) – odložené překreslení kartu zahodí
    const repaint = (focusNote = false) => this.paintProductExtras(card, foot, product, extras, { noteButton, reviewsButton, focusNote });
    noteButton.addEventListener("click", () => {
      extras.note = !extras.note;
      if (!extras.note) extras.draft = extras.noteProblem = null;
      extras.repaint(extras.note);
      if (!extras.note) this.flushProductPanel();
    });
    reviewsButton.addEventListener("click", () => {
      extras.reviews = !extras.reviews;
      if (extras.reviews && !extras.analysis && !extras.loading) this.startReviews(product, extras);
      extras.repaint();
    });
    const tools = this.createEl("div", "alza-price-tracker-product-tools");
    tools.append(noteButton, reviewsButton, offerButton);
    foot.append(historyButton, targetButton, tools);
    card.appendChild(foot);

    // Karta se stavěla asynchronně – mezitím mohl fokus přijít do poznámky; výměna karty počká (viz isNoteEditorFocused)
    if (this.isNoteEditorFocused()) {
      this.state.productPanelPending = true;
      return;
    }
    extras.repaint = repaint;
    repaint();

    const existing = document.querySelector(".alza-price-tracker-product");
    if (existing) {
      existing.replaceWith(card);
      return;
    }
    // Levý sloupec je klasické HTML: galerie, promo doručení a dárky – karta na konec pod ně (do galerie
    // ani do React komponent se nevkládá); jiné rozvržení → pod cenu, jinak plovoucí
    const leftColumn = document.querySelector("#detailItem > .left-cnt");
    const priceDetail = document.querySelector(".price-detail");
    if (leftColumn) {
      leftColumn.appendChild(card);
    } else if (priceDetail) {
      priceDetail.after(card);
    } else {
      card.classList.add("alza-price-tracker-product--floating");
      document.body.appendChild(card);
    }
  },

  // Otevřená poznámka / recenze patří produktu – na jiném produktu (změna adresy bez načtení stránky, syncProductPage)
  // začíná vše zavřené. example = slovo výtky s rozbaleným příkladem, error = { kind, status } (getReviewsErrorText)
  getProductExtras(product) {
    if (this.state.productExtras?.url !== product.url) {
      this.state.productExtras = { url: product.url, note: false, reviews: false, draft: null, noteProblem: null, analysis: null, loading: false, error: null, example: null, repaint: null };
    }
    return this.state.productExtras;
  },

  // Editor poznámky a panel recenzí nad tlačítky karty podle stavu; tlačítka hlásí, co je otevřené
  paintProductExtras(card, foot, product, extras, { noteButton, reviewsButton, focusNote }) {
    noteButton.setAttribute("aria-expanded", String(extras.note));
    reviewsButton.setAttribute("aria-expanded", String(extras.reviews));
    const editor = card.querySelector(".alza-price-tracker-note-editor");
    if (!extras.note) editor?.remove();
    else if (!editor) card.insertBefore(this.createNoteEditor(product, extras, focusNote), foot);
    let panel = card.querySelector(".alza-price-tracker-reviews");
    if (!extras.reviews) {
      panel?.remove();
      return;
    }
    // Panel v kartě zůstává a mění se jen jeho obsah – první řádek je živá oblast, čtečka tak ohlásí načítání i výsledek
    if (!panel) {
      panel = this.createReviewsPanel();
      card.insertBefore(panel, card.querySelector(".alza-price-tracker-note-editor") || foot);
    }
    this.fillReviewsPanel(panel, extras);
  },

  // Načte recenze na pozadí; výsledek (i chybu) ukáže karta, která je zrovna na stránce. Po chybě další otevření zkusí
  // znovu – po HTTP 403 / 429 až za chvíli (state.reviewsBlockedUntil), další pokus hned by Alza odmítla také
  startReviews(product, extras) {
    extras.error = null;
    if (Date.now() < (this.state.reviewsBlockedUntil || 0)) {
      extras.error = { kind: "blocked", status: null };
      return;
    }
    extras.loading = true;
    this.loadReviews(product)
      .then((analysis) => (extras.analysis = analysis))
      .catch((error) => {
        // Chyba bez druhu je chyba kódu, ne sítě – do konzole; uživatel dostane přeloženou obecnou hlášku
        if (!error?.kind) console.error("AllyZap – recenze:", error);
        extras.error = { kind: error?.kind || "network", status: error?.status || null };
      })
      .finally(() => {
        extras.loading = false;
        extras.repaint?.();
      });
  },

  // Chyba načtení recenzí s druhem pro přeloženou hlášku: timeout | blocked (HTTP 403 / 429) | http | format | network
  createReviewsError(kind, status = null) {
    return Object.assign(new Error(`reviews: ${kind}${status ? ` ${status}` : ""}`), { kind, status });
  },

  getReviewsErrorText(error) {
    const key = { timeout: "reviewsErrorTimeout", blocked: "reviewsErrorBlocked", http: "reviewsErrorHttp", format: "reviewsErrorFormat" }[error?.kind] || "reviewsErrorNetwork";
    return this.translate(key, error?.status ? `HTTP ${error.status}` : "");
  },

  // Jedna stránka recenzí: { reviews, more }, jinak chyba s druhem (createReviewsError). Ve Firefoxu přes content.fetch
  // (požadavek jako ze stránky – API povoluje jen původ Alzy), v Chromu se content script ptá s původem stránky sám.
  // Časový limit hlídá odpočet (funguje v obou prohlížečích); požadavek sám se ruší jen u obyčejného fetch – signál
  // vytvořený v content scriptu nemusí content.fetch stránky přijmout
  async fetchReviewsPage(url) {
    const viaPage = typeof content !== "undefined" && typeof content?.fetch === "function";
    const pageFetch = viaPage ? content.fetch.bind(content) : fetch;
    const controller = viaPage || typeof AbortController === "undefined" ? null : new AbortController();
    let timer = null;
    const timeout = new Promise((resolve, reject) => {
      timer = setTimeout(() => {
        controller?.abort();
        reject(this.createReviewsError("timeout"));
      }, AlzaCore.reviewTimeoutMs);
    });
    const load = async () => {
      let response;
      try {
        response = await pageFetch(url, { credentials: "include", headers: { Accept: "application/json" }, ...(controller && { signal: controller.signal }) });
      } catch {
        throw this.createReviewsError("network");
      }
      if (response.status === 403 || response.status === 429) throw this.createReviewsError("blocked", response.status);
      if (!response.ok) throw this.createReviewsError("http", response.status);
      // Odpověď, která není JSON (stránka ověření, HTML chyby), nebo JSON bez pole value = nečekaný tvar
      const data = await response.json().catch(() => null);
      const page = AlzaCore.parseReviewsPage(data);
      if (!page) throw this.createReviewsError("format");
      return page;
    };
    try {
      return await Promise.race([load(), timeout]);
    } finally {
      clearTimeout(timer);
    }
  },

  // Recenze produktu z API Alzy – nejvýš reviewMaxPages stránek v pořadí, v jakém je Alza vrací. Chyba na další
  // stránce nezahodí, co už je načtené (rozbor se udělá z toho); chyba hned na první se ohlásí
  async loadReviews(product) {
    const address = new URL(product.url);
    const id = AlzaCore.getProductId(address.pathname + address.search);
    const domain = this.getAlzaDomain();
    if (!AlzaCore.getReviewsApiUrl(domain, id)) throw this.createReviewsError("format");
    const reviews = [];
    for (let page = 0; page < AlzaCore.reviewMaxPages; page++) {
      let result;
      try {
        result = await this.fetchReviewsPage(AlzaCore.getReviewsApiUrl(domain, id, page * AlzaCore.reviewPageSize));
      } catch (error) {
        if (error?.kind === "blocked") this.state.reviewsBlockedUntil = Date.now() + AlzaCore.reviewRetryAfterMs;
        if (reviews.length === 0) throw error;
        break;
      }
      reviews.push(...result.reviews);
      if (!result.more) break;
    }
    const analysis = AlzaCore.analyzeReviews(reviews);
    // Recenze přišly, ale žádná nemá hodnocení 1–5 ★ – položky mají jiný tvar; to není „produkt nemá recenze“
    if (reviews.length > 0 && analysis.count === 0) throw this.createReviewsError("format");
    return analysis;
  },

  // Skrytí prvku karty: atribut hidden (čtečky) i display v prvku samém – styl stránky by samotné [hidden] mohl přebít
  setHidden(element, hidden) {
    element.hidden = hidden;
    element.style.display = hidden ? "none" : "";
  },

  // Prázdný panel recenzí: první řádek je stav (načítání, chyba, bez recenzí, „Z N načtených recenzí“) jako živá oblast
  createReviewsPanel() {
    const panel = this.createEl("div", "alza-price-tracker-reviews");
    const status = this.createEl("div");
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    panel.appendChild(status);
    return panel;
  },

  fillReviewsPanel(panel, extras) {
    const { analysis } = extras;
    const status = panel.firstElementChild;
    while (status.nextSibling) status.nextSibling.remove();
    const setStatus = (text, className = "") => {
      // Stejný text se nepřepisuje – čtečka by ho při každém překreslení četla znovu
      if (status.className !== className) status.className = className;
      if (status.textContent !== text) status.textContent = text;
    };
    if (!analysis) {
      setStatus(extras.error ? this.translate("reviewsFailed", this.getReviewsErrorText(extras.error)) : this.translate("reviewsLoading"));
      return;
    }
    if (analysis.count === 0) {
      setStatus(this.translate("reviewsNone"));
      return;
    }
    const lang = this.state.uiLanguage || this.state.language || "cz";
    const number = (value) => String(value).replace(".", lang === "en" ? "." : ",");
    setStatus(this.translate("reviewsTitle", analysis.count, analysis.verified), "alza-price-tracker-reviews-title");
    // Vývoj hodnocení: poslední 3 měsíce proti dřívějšku (jen s dost recenzemi v obou obdobích)
    const { recent, older } = analysis;
    if (recent.count >= 5 && older.count >= 5) {
      const drop = older.average - recent.average;
      const trend = this.createEl("div", "alza-price-tracker-reviews-trend", this.translate("reviewsTrend", number(recent.average), recent.count, number(older.average), older.count));
      if (drop >= 0.3) trend.classList.add("alza-price-tracker-reviews-trend--worse");
      panel.appendChild(trend);
    }
    if (analysis.complaints.length > 0) {
      panel.appendChild(this.createEl("div", "alza-price-tracker-reviews-label", this.translate("reviewsComplaints")));
      const list = this.createEl("div", "alza-price-tracker-reviews-complaints");
      // Příklad věty k výtce: v bublině (myš) a po kliknutí / Enter / mezerníku na slově i jako řádek pod výtkami –
      // slovo jde vybrat klávesnicí (tabindex) a čtečka ho hlásí jako tlačítko s příkladem
      const exampleLine = this.createEl("div", "alza-price-tracker-reviews-text");
      exampleLine.setAttribute("aria-live", "polite");
      const chips = analysis.complaints.map(({ word, count, example }) => {
        const chip = this.createEl("span", "alza-price-tracker-reviews-chip", `${word} ×${count}`);
        chip.title = example;
        chip.tabIndex = 0;
        chip.setAttribute("role", "button");
        const toggle = () => {
          extras.example = extras.example === word ? null : word;
          showExample();
        };
        chip.addEventListener("click", toggle);
        chip.addEventListener("keydown", (event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          toggle();
        });
        list.appendChild(chip);
        return { chip, word, example };
      });
      const showExample = () => {
        const open = chips.find(({ word }) => word === extras.example) || null;
        chips.forEach((item) => item.chip.setAttribute("aria-expanded", String(item === open)));
        this.setHidden(exampleLine, !open);
        exampleLine.textContent = open ? `${open.word}: ${open.example}` : "";
      };
      showExample();
      panel.append(list, exampleLine);
    } else panel.appendChild(this.createEl("div", "alza-price-tracker-reviews-label", this.translate("reviewsNoComplaints")));
    if (analysis.worst.length > 0) {
      panel.appendChild(this.createEl("div", "alza-price-tracker-reviews-label", this.translate("reviewsWorst")));
      analysis.worst.forEach(({ rating, date, text }) => {
        const stars = Math.min(5, Math.max(0, Math.round(rating)));
        const item = this.createEl("div", "alza-price-tracker-reviews-item");
        item.append(
          this.createEl("span", "alza-price-tracker-reviews-stars", `${"★".repeat(stars)}${"☆".repeat(5 - stars)}`),
          this.createEl("span", "alza-price-tracker-reviews-date", date ? AlzaCore.formatTextDate(date, lang, true) : ""),
          this.createEl("div", "alza-price-tracker-reviews-text", text)
        );
        panel.appendChild(item);
      });
    }
  },

  // Úprava poznámky: textové pole, Uložit a Smazat, Esc zavře bez uložení. Prázdný text = smazat. Editor se zavře až
  // po úspěšném zápisu – při chybě zůstane otevřený s textem a hláškou. Rozepsaný text zůstane v extras.draft i po
  // překreslení karty; dokud je v editoru fokus, karta se nepřekresluje (isNoteEditorFocused)
  createNoteEditor(product, extras, focus) {
    const box = this.createEl("div", "alza-price-tracker-note-editor");
    const field = this.createEl("textarea", "alza-price-tracker-note-field");
    field.maxLength = AlzaCore.noteMaxLength;
    field.rows = 3;
    field.placeholder = this.translate("notePlaceholder");
    field.setAttribute("aria-label", this.translate("noteFieldLabel"));
    field.value = extras.draft ?? (this.state.productNote?.text || "");
    field.addEventListener("input", () => (extras.draft = field.value));
    const key = AlzaCore.getProductKey(this.getAlzaDomain(), product.url);
    const notesKey = AlzaCore.storageKeys.notes;
    const close = () => {
      extras.note = false;
      extras.draft = null;
      extras.noteProblem = null;
      extras.repaint?.();
      this.flushProductPanel();
    };
    const save = this.createEl("button", "alza-price-tracker-product-button", this.translate("noteSave"));
    const remove = this.createEl("button", "alza-price-tracker-product-button", this.translate("noteDelete"));
    save.type = remove.type = "button";
    // Hláška o nepovedeném zápisu (extras.noteProblem = klíč textu) – přežije i překreslení karty
    const problem = this.createEl("div", "alza-price-tracker-product-note");
    problem.setAttribute("role", "alert");
    const showProblem = () => {
      problem.textContent = extras.noteProblem ? this.translate(extras.noteProblem) : "";
      this.setHidden(problem, !extras.noteProblem);
    };
    showProblem();
    // Zápis jen přes AlzaStore. Tlačítka se během něj nevypínají (vypnuté tlačítko by přišlo o fokus a karta by se
    // překreslila pod rukama) – druhý klik jen nic neudělá
    let busy = false;
    const store = async (op, failedKey) => {
      if (busy) return;
      busy = true;
      extras.draft = field.value;
      extras.noteProblem = null;
      showProblem();
      box.setAttribute("aria-busy", "true");
      try {
        await AlzaStore.run(op);
      } catch (error) {
        console.error("AllyZap – poznámka:", error);
        extras.noteProblem = failedKey;
        showProblem();
        return;
      } finally {
        busy = false;
        box.removeAttribute("aria-busy");
      }
      close();
    };
    save.addEventListener("click", () => {
      const text = field.value.trim().slice(0, AlzaCore.noteMaxLength);
      store(
        text
          ? { type: "patchMap", key: notesKey, set: { [key]: { text, url: product.url, domain: this.getAlzaDomain(), name: product.name || null, at: Date.now() } } }
          : { type: "patchMap", key: notesKey, remove: [key] },
        text ? "noteSaveFailed" : "noteDeleteFailed"
      );
    });
    remove.addEventListener("click", () => store({ type: "patchMap", key: notesKey, remove: [key] }, "noteDeleteFailed"));
    field.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      close();
    });
    // Fokus opustil editor (klik jinam, Tab ven) – odložené překreslení karty může doběhnout
    box.addEventListener("focusout", (event) => {
      if (!event.relatedTarget || !box.contains(event.relatedTarget)) setTimeout(() => this.flushProductPanel(), 0);
    });
    const actions = this.createEl("div", "alza-price-tracker-note-actions");
    actions.append(save, remove);
    box.append(field, actions, problem);
    if (focus) setTimeout(() => field.focus(), 0);
    return box;
  },

  // Ikony srovnávačů v záhlaví karty – vyhledání produktu podle názvu v nové záložce
  createComparatorLinks(productName) {
    const wrap = this.createEl("span", "alza-price-tracker-product-compare");
    AlzaCore.getComparatorLinks(this.getAlzaDomain(), productName).forEach(({ id, name, url, icon }) => {
      const link = this.createEl("a", `alza-price-tracker-product-compare-link alza-price-tracker-product-compare-link--${id}`);
      link.href = url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.title = this.translate("compareOn", name);
      // Favicona živě ze srovnávače (do rozšíření se nebalí – práva k logům); když se nenačte, zůstane název
      const label = this.createEl("span", "alza-price-tracker-product-compare-label", name);
      // Výsledek načtení si panel pamatuje – při překreslení (změna ve storage) by ikona jinak problikla textem
      const loaded = (this.state.comparatorIcons ||= {});
      link.appendChild(label);
      if (loaded[icon] !== false) {
        const img = document.createElement("img");
        img.className = "alza-price-tracker-product-compare-icon";
        img.alt = "";
        img.referrerPolicy = "no-referrer";
        const showIcon = () => link.classList.add("alza-price-tracker-product-compare-link--icon");
        if (loaded[icon]) showIcon();
        img.addEventListener("load", () => ((loaded[icon] = true), showIcon()), { once: true });
        img.addEventListener("error", () => ((loaded[icon] = false), img.remove(), link.classList.remove("alza-price-tracker-product-compare-link--icon")), { once: true });
        img.src = icon;
        link.prepend(img);
      }
      wrap.appendChild(link);
    });
    return wrap;
  },

  // Text nabídky ke sdílení: název, cena bez podmínek, ceny s kódem / AlzaPlus+ / cashbackem, obvyklá cena
  // a nejnižší za 30 dní (z historie), odkaz na produkt
  buildOfferText(product, prices, verdict, lowest30) {
    const entries = AlzaCore.getPriceEntries(prices || {});
    const conditional = this.conditionalPriceTypes; // list-toolbar.js
    const regular = entries.filter(({ type }) => !conditional.includes(type));
    const lines = [product.name];
    if (regular.length > 0) lines.push(this.translate("offerPrice", this.formatPrice(regular[0].price)));
    entries
      .filter(({ type }) => conditional.includes(type))
      .forEach(({ type, price, code }) => {
        lines.push(code ? this.translate("offerWithCode", code, this.formatPrice(price)) : `${this.translate(`type_${type}`)}: ${this.formatPrice(price)}`);
      });
    if (verdict) lines.push(this.translate("offerTypical", this.formatPrice(verdict.typical)));
    if (lowest30) lines.push(this.translate("offerLowest30", this.formatPrice(lowest30.value)));
    lines.push(product.url);
    return lines.join("\n");
  },

  // Malý schodový graf nejnižší ceny k zaplacení (bez cashbacku a výkupu) s minimem a cílem – jen orientační, detail je v dialogu
  createProductSparkline(entries, min, target) {
    const W = 560;
    const H = 110;
    const m = { l: 4, r: 4, t: 18, b: 18 };
    const points = entries
      .map((entry, index) => ({ t: entry.t, end: entries[index + 1]?.t ?? entry.s, v: AlzaCore.getPlausiblePayNowPrice(entry.p) }))
      .filter((point) => point.v !== null);
    // Žádný záznam s cenou (poškozená data) – prázdný graf, ne pád celého panelu
    if (points.length === 0) return document.createElement("div");

    let t0 = points[0].t;
    let t1 = points[points.length - 1].end;
    if (t1 - t0 < 60 * 60 * 1000) {
      t0 -= 12 * 60 * 60 * 1000;
      t1 += 12 * 60 * 60 * 1000;
    }
    // Minimum může být starší než historie (uložené ze seznamu) – i tak musí být v rozsahu grafu
    const values = [...points.map((point) => point.v), ...(target ? [target.price] : []), ...(min ? [min.value] : [])];
    const vMin = Math.min(...values);
    const vMax = Math.max(...values);
    const pad = (vMax - vMin) * 0.1 || vMax * 0.05 || 1;
    const x = (t) => m.l + ((t - t0) / (t1 - t0)) * (W - m.l - m.r);
    const y = (v) => m.t + ((vMax + pad - v) / (vMax - vMin + 2 * pad)) * (H - m.t - m.b);

    const svg = this.createSvgEl("svg", { viewBox: `0 0 ${W} ${H}`, role: "img" });
    const line = points.map((point, index) => `${index === 0 ? "M" : "L"}${x(point.t)},${y(point.v)}H${x(point.end)}`).join("");
    const first = points[0];
    const last = points[points.length - 1];
    svg.appendChild(
      this.createSvgEl("path", {
        d: `${line}V${H - m.b}H${x(first.t)}Z`,
        class: "alza-price-tracker-product-spark-area",
      })
    );
    svg.appendChild(this.createSvgEl("path", { d: line, class: "alza-price-tracker-product-spark-line" }));

    const addLevel = (value, color, label, anchorEnd) => {
      svg.appendChild(this.createSvgEl("line", { x1: m.l, x2: W - m.r, y1: y(value), y2: y(value), stroke: color, class: "alza-price-tracker-history-milestone" }));
      const text = this.createSvgEl("text", { x: anchorEnd ? W - m.r : m.l, y: y(value) - 4, "text-anchor": anchorEnd ? "end" : "start", class: "alza-price-tracker-history-milestone-label" });
      text.style.fill = color;
      text.textContent = label;
      svg.appendChild(text);
    };
    if (min) addLevel(min.value, this.config.historyMilestoneColors.min, `Min ${this.formatPrice(min.value)}`, false);
    if (target) addLevel(target.price, this.config.historyMilestoneColors.target, `${this.translate("milestoneTarget")} ${this.formatPrice(target.price)}`, true);

    [first.t, last.end].forEach((t, index) => {
      const label = this.createSvgEl("text", { x: index === 0 ? m.l : W - m.r, y: H - 4, "text-anchor": index === 0 ? "start" : "end" });
      label.textContent = this.formatDate(t);
      svg.appendChild(label);
    });

    const wrap = this.createEl("div", "alza-price-tracker-product-spark");
    wrap.appendChild(svg);
    return wrap;
  },
});
