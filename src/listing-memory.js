// Content script: paměť prohlížení ve výpisech kategorií a vyhledávání (dlaždice .browsingitem):
//  - „prohlédnuto 3. 11.“ u produktu, jehož detail jste otevřeli (storageKeys.browsed → openedAt, ukládá browsing.js),
//  - vaše poznámka k produktu (storageKeys.notes – píše se na kartě na detailu),
//  - skrytí produktu nebo celé značky (storageKeys.hidden / hiddenBrands): tlačítko na dlaždici, nad výpisem
//    „Skryto N · Zobrazit“; zobrazené skryté dlaždice jsou průhledné a jdou vrátit. Skrývá se jen ve výpisu (#boxes).
// Štítek je nad názvem produktu (ne přes roh dlaždice – tam je Alzino „Sponzorováno“). Do Alziny dlaždice se vkládá jen náš štítek (třída alza-price-tracker-…) a atribut data-alza-price-tracker-…;
// skrývá se přes CSS, DOM Alzy zůstává. Nákupní seznam (Order1.htm) a detail produktu nechává být
const AlzaListingMemory = {
  selectors: {
    item: ".browsingitem",
    name: "a.name",
    container: "#boxes",
    // Hodnoty filtru „Značka“ ve výpisu Alzy: <div id="producer-1299" class="parameterValue producer" title="Samsung">
    producer: "#producers .parameterValue.producer[title]",
  },
  hiddenAttribute: "data-alza-price-tracker-memory-hidden", // Skrytá dlaždice (main.css; čte ho i category.js)
  showAttribute: "data-alza-price-tracker-memory-show", // Na <html>: skryté dlaždice ukázat průhledně
  badgeClass: "alza-price-tracker-memory",
  barClass: "alza-price-tracker-memory-bar",
  listPagePattern: /\/Order1\.htm/i,

  // loaded / loading = data paměti (load); version = číslo stavu dat – po změně se popis dlaždic počítá znovu (describe);
  // items = dlaždice → { href, text, product, version, view } (readItem, describe)
  state: {
    domainKey: null,
    lang: "cz",
    browsed: {},
    notes: {},
    hidden: {},
    brands: {},
    producers: [], // Značky z filtru výpisu (readProducers) – podle nich se určuje značka dlaždice
    producersSignature: "",
    showHidden: false,
    scanTimeout: null,
    loaded: false,
    loading: false,
    version: 0,
    items: new WeakMap(),
  },

  async init() {
    this.cleanUp();
    this.state.domainKey = AlzaCore.getDomainKey(window.location.hostname);
    if (!this.state.domainKey || this.listPagePattern.test(window.location.pathname)) return;
    this.scan();
    // Další produkty, filtry a řazení Alza dokreslí bez načtení stránky
    AlzaCore.createObserver(() => this.scheduleScan(), { ignoreOwn: true }).observe(document.body, { childList: true, subtree: true });
  },

  // Pozůstatky staré instance skriptu (Firefox ho po aktualizaci rozšíření vloží do otevřené stránky znovu): štítky
  // a lišta mají tlačítka staré instance (už nic neudělají) a podpis, podle kterého by je nová nepřekreslila. Skrytí
  // dlaždic si nová instance nastaví znovu podle úložiště, „Zobrazit skryté“ začíná vypnuté
  cleanUp() {
    document.querySelectorAll(`.${this.badgeClass}, .${this.barClass}`).forEach((element) => element.remove());
    document.querySelectorAll(`[${this.hiddenAttribute}]`).forEach((item) => item.removeAttribute(this.hiddenAttribute));
    document.documentElement.removeAttribute(this.showAttribute);
  },

  // Data paměti (nastavení a čtyři klíče úložiště) až s první dlaždicí – většina stránek Alzy žádný výpis nemá
  async load() {
    if (this.state.loading) return;
    this.state.loading = true;
    const { browsed, notes, hidden, hiddenBrands } = AlzaCore.storageKeys;
    const keys = [browsed, notes, hidden, hiddenBrands];
    const map = (value) => (value && typeof value === "object" ? value : {});
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local" || !keys.some((key) => changes[key])) return;
      if (changes[browsed]) this.state.browsed = map(changes[browsed].newValue);
      if (changes[notes]) this.state.notes = map(changes[notes].newValue);
      if (changes[hidden]) this.state.hidden = map(changes[hidden].newValue);
      if (changes[hiddenBrands]) this.state.brands = map(changes[hiddenBrands].newValue);
      this.state.version++;
      this.scan();
    });
    // Jazyk textů: volba v nastavení, jinak jazyk domény (AlzaPriceTracker ho na výpisech nenastavuje)
    this.state.lang = AlzaCore.getDisplayLanguage(await AlzaCore.getSettings(), AlzaCore.domains[this.state.domainKey].lang);
    const data = await chrome.storage.local.get(keys);
    Object.assign(this.state, { browsed: map(data[browsed]), notes: map(data[notes]), hidden: map(data[hidden]), brands: map(data[hiddenBrands]) });
    this.state.version++;
    this.state.loaded = true;
    this.scan();
  },

  translate(key, ...params) {
    return AlzaCore.translateFrom(AlzaPriceTrackerTexts, this.state.lang, key, params);
  },

  scheduleScan() {
    if (this.state.scanTimeout) return;
    this.state.scanTimeout = setTimeout(() => {
      this.state.scanTimeout = null;
      this.scan();
    }, 300);
  },

  // Produkt dlaždice: záznam { href, text, product: { key, url, name }, … } nebo null (reklama, dlaždice bez odkazu).
  // Odkaz se rozebírá jednou (new URL, regulární výrazy) – znovu až když Alza dlaždici přepíše jiným produktem;
  // průchod běží při každé dávce změn DOM a výpis může mít tisíce dlaždic
  readItem(item) {
    const link = item.querySelector(this.selectors.name);
    const href = link?.getAttribute("href");
    if (!href) return null;
    const text = link.textContent;
    let known = this.state.items.get(item);
    if (known?.href !== href || known.text !== text) {
      known = { href, text, product: this.readProduct(href, text), version: -1, view: null };
      this.state.items.set(item, known);
    }
    return known.product ? known : null;
  },

  readProduct(href, text) {
    const url = new URL(href, window.location.origin);
    const variant = url.searchParams.get("dq");
    url.search = variant ? `?dq=${variant}` : "";
    url.hash = "";
    if (!AlzaCore.isAlzaUrl(url.href) || !AlzaCore.getProductId(url.pathname + url.search)) return null;
    return { key: AlzaCore.getProductKey(this.state.domainKey, url.href), url: url.href, name: text.replace(/\s+/g, " ").trim() };
  },

  // Značky, které výpis Alzy nabízí ve filtru „Značka“ – dlaždice sama údaj o výrobci nemá. Filtr se mění s výpisem
  // (jiná kategorie, dokreslení) – po změně se popis dlaždic počítá znovu. Bez filtru (jiný vzhled stránky) zůstane
  // seznam prázdný a značka se odhadne ze začátku názvu
  readProducers() {
    const producers = [...document.querySelectorAll(this.selectors.producer)].map((element) => (element.getAttribute("title") || "").trim()).filter(Boolean);
    const signature = producers.join("\n");
    if (signature === this.state.producersSignature) return;
    Object.assign(this.state, { producers, producersSignature: signature });
    this.state.version++;
  },

  // Co se o dlaždici ukáže: { listed, opened, note, hidden, brand, hiddenBrand, signature }. Počítá se jen po změně dat
  // paměti (state.version), produktu v dlaždici (readItem) nebo jejího umístění
  describe(item, known) {
    // Skrývá se jen ve výpisu (#boxes): jen nad ním je lišta „Skryto N · Zobrazit skryté“, kterou jde skrytí vrátit
    const listed = Boolean(item.closest(this.selectors.container));
    if (known.view && known.version === this.state.version && known.view.listed === listed) return known.view;
    const { product } = known;
    const opened = this.state.browsed[product.key]?.openedAt || null;
    const note = this.state.notes[product.key]?.text || null;
    const { producers } = this.state;
    const hidden = listed ? AlzaCore.isHiddenListing(this.state.hidden, this.state.brands, product.key, product.name, producers) : null;
    // Značka pro „Skrýt značku X“; u skryté značky ta uložená (může být uložená starším klíčem – getHiddenBrand)
    const brand = listed && !hidden ? AlzaCore.getBrandFromName(product.name, producers) : null;
    const hiddenBrand = hidden === "brand" ? AlzaCore.getHiddenBrand(this.state.brands, product.name, producers) : null;
    // Klíč produktu v podpisu: dlaždice přepsaná jiným produktem musí dostat nová tlačítka (jinak by „Skrýt“ skrylo původní)
    const signature = JSON.stringify([product.key, opened, note, hidden, brand?.key, hiddenBrand?.key, listed, this.state.lang]);
    known.version = this.state.version;
    known.view = { listed, opened, note, hidden, brand, hiddenBrand, signature };
    return known.view;
  },

  scan() {
    const items = document.querySelectorAll(this.selectors.item);
    if (!this.state.loaded) {
      if (items.length > 0) this.load().catch((error) => console.error("AllyZap – paměť prohlížení:", error));
      return;
    }
    this.readProducers();
    let hiddenCount = 0;
    let changed = false;
    items.forEach((item) => {
      const known = this.readItem(item);
      const view = known ? this.describe(item, known) : null;
      const hidden = view?.hidden || null;
      if (hidden) hiddenCount++;
      if (hidden && item.getAttribute(this.hiddenAttribute) !== hidden) {
        item.setAttribute(this.hiddenAttribute, hidden);
        changed = true;
      } else if (!hidden && item.hasAttribute(this.hiddenAttribute)) {
        item.removeAttribute(this.hiddenAttribute);
        changed = true;
      }
      if (view) this.paintBadge(item, known.product, view);
      else item.querySelector(`.${this.badgeClass}`)?.remove(); // Dlaždice přepsaná reklamou
    });
    this.paintBar(hiddenCount);
    // Počty filtru slev, „Seřazeno N“ a kandidáti „Spočítat provoz“ (category.js) skryté produkty vynechávají –
    // změnu atributu samy nezachytí (sledují jen přidané a odebrané prvky)
    if (changed && typeof AlzaUnitPrice !== "undefined") AlzaUnitPrice.scheduleUpdate();
  },

  // Štítek nad názvem produktu: prohlédnuto / poznámka / skrýt (nebo vrátit). Beze změny se nepřekresluje
  paintBadge(item, product, view) {
    const { listed, opened, note, hidden, brand, hiddenBrand, signature } = view;
    let badge = item.querySelector(`.${this.badgeClass}`);
    // Mimo výpis jsou jen „prohlédnuto“ a poznámka – bez nich není co ukázat
    if (!listed && !opened && !note) {
      badge?.remove();
      return;
    }
    if (badge?.dataset.signature === signature) return;
    badge?.remove();
    badge = AlzaPriceTracker.createEl("div", this.badgeClass);
    badge.dataset.signature = signature;
    if (opened) {
      const seen = AlzaPriceTracker.createEl("span", `${this.badgeClass}-seen`, this.translate("memorySeen", AlzaCore.formatTextDate(opened, this.state.lang)));
      badge.appendChild(AlzaIcons.prepend(seen, "visibility", { tone: true }));
    }
    if (note) {
      const noteChip = AlzaPriceTracker.createEl("span", `${this.badgeClass}-note`, note);
      noteChip.title = note;
      badge.appendChild(AlzaIcons.prepend(noteChip, "flag", { tone: true }));
    }
    if (listed) {
      const menu = AlzaPriceTracker.createEl("span", `${this.badgeClass}-actions`);
      if (hidden === "brand" && hiddenBrand) {
        menu.appendChild(
          this.createAction(this.translate("memoryShowBrand", hiddenBrand.name), () => AlzaStore.run({ type: "patchMap", key: AlzaCore.storageKeys.hiddenBrands, remove: [hiddenBrand.key] }))
        );
      } else if (hidden) {
        menu.appendChild(
          this.createAction(
            this.translate("memoryShowProduct"),
            () => AlzaStore.run({ type: "patchMap", key: AlzaCore.storageKeys.hidden, remove: [product.key] }),
            this.translate("memoryShowProductLabel", product.name)
          )
        );
      } else {
        // Přístupný název nese i název produktu – tlačítek „Skrýt“ je ve výpisu tolik, kolik dlaždic
        menu.appendChild(
          this.createAction(
            this.translate("memoryHideProduct"),
            () => AlzaStore.run({ type: "patchMap", key: AlzaCore.storageKeys.hidden, set: { [product.key]: { url: product.url, domain: this.state.domainKey, name: product.name, at: Date.now() } } }),
            this.translate("memoryHideProductLabel", product.name)
          )
        );
        if (brand) {
          menu.appendChild(
            this.createAction(this.translate("memoryHideBrand", brand.name), () =>
              AlzaStore.run({ type: "patchMap", key: AlzaCore.storageKeys.hiddenBrands, set: { [brand.key]: { name: brand.name, at: Date.now() } } })
            )
          );
        }
      }
      badge.appendChild(menu);
    }
    // Nad název produktu (v toku dlaždice) – roh dlaždice patří Alze (štítek „Sponzorováno“, energetická třída)
    const link = item.querySelector(this.selectors.name);
    if (link) link.before(badge);
    else item.appendChild(badge);
  },

  // label = přístupný název (aria-label), když samotný text tlačítka neříká, čeho se týká
  createAction(text, onClick, label = null) {
    const button = AlzaPriceTracker.createEl("button", `${this.badgeClass}-action`, text);
    button.type = "button";
    if (label) button.setAttribute("aria-label", label);
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation(); // Klik nesmí otevřít produkt
      button.disabled = true;
      onClick().catch((error) => {
        button.disabled = false;
        console.error("AllyZap – skrytí ve výpisu:", error);
      });
    });
    return button;
  },

  // Nad výpisem: „Skryto N · Zobrazit / Schovat“ – jen když je ve výpisu něco skrytého
  paintBar(count) {
    let bar = document.querySelector(`.${this.barClass}`);
    const container = document.querySelector(this.selectors.container);
    if (count === 0 || !container) {
      bar?.remove();
      if (count === 0) {
        // Nic skrytého: přepínač „Zobrazit skryté“ se vrací do výchozího stavu – jinak by další skrytý produkt
        // zmizel a lišta nabízela „Skrýt je znovu“
        this.state.showHidden = false;
        document.documentElement.removeAttribute(this.showAttribute);
      }
      return;
    }
    const signature = `${count}|${this.state.showHidden}`;
    const next = bar?.nextElementSibling;
    if (bar?.dataset.signature === signature && (next === container || next?.classList.contains("alza-price-tracker-listing-bar"))) return;
    bar?.remove();
    bar = AlzaPriceTracker.createEl("div", `${this.barClass} alza-price-tracker-listing-bar`);
    bar.dataset.signature = signature;
    bar.appendChild(AlzaCore.createToolbarLogo(document));
    bar.appendChild(AlzaIcons.prepend(AlzaPriceTracker.createEl("span", `${this.barClass}-text`, this.translate("memoryHiddenCount", count)), "visibility", { tone: true }));
    const toggle = AlzaPriceTracker.createEl("button", `${this.badgeClass}-action`, this.translate(this.state.showHidden ? "memoryHideAgain" : "memoryShowHidden"));
    toggle.type = "button";
    toggle.addEventListener("click", () => {
      this.state.showHidden = !this.state.showHidden;
      if (this.state.showHidden) document.documentElement.setAttribute(this.showAttribute, "");
      else document.documentElement.removeAttribute(this.showAttribute);
      this.scan();
    });
    bar.appendChild(toggle);
    container.before(bar);
  },
};

AlzaListingMemory.init().catch((error) => console.error("AllyZap – paměť prohlížení:", error));
