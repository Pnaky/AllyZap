// Content script (část AlzaPriceTracker): Hodnocení cen přímo v košíku – pod názvem každé položky.
// Načítá se po content.js a před content/start.js (manifest) – metody sdílí objekt AlzaPriceTracker
Object.assign(AlzaPriceTracker, {
  // === Košík: hodnocení u položek ===
  // Co umí seznam, ukáže i košík (kde se rozhoduje): ▼▲ proti obvyklé ceně, vyplatí se počkat (rytmus akcí),
  // podezřelá sleva / vymyšlená přeškrtnutá cena, levněji v jiném stavu a blízký stupeň množstevní slevy
  // („Přidejte 1 ks → 489 Kč/ks“). Data ze záznamu ceny a historie (detail, seznam, kontrola na pozadí);
  // podrobnosti v tooltipu (price-card.js). Pod řádkem položky: množstevní sleva pod počtem kusů, zbytek pod cenou.
  basketInsightClass: "alza-price-tracker-basket-insights",

  setupBasketInsights() {
    if (this.state.basketInsightsReady || !this.isBasketPage()) return;
    this.state.basketInsightsReady = true;
    this.state.basketChips = new Map(); // Adresa produktu → poslední spočítané chipy (vrácení bez čekání)
    const refresh = () => this.updateBasketInsights().catch((error) => console.error("AllyZap – hodnocení v košíku:", error));
    refresh();
    // Počet kusů a položky Alza překresluje bez načtení stránky a vložený řádek zmizí. Vrátit ho z paměti
    // v příštím snímku (requestAnimationFrame běží před vykreslením – neproblikne, dávky změn se sloučí),
    // přepočítat až po chvíli
    let timer = null;
    let frame = 0;
    this.observeBasket(() => {
      if (!frame) {
        frame = requestAnimationFrame(() => {
          frame = 0;
          this.paintBasketInsights(this.getBasketRows());
        });
      }
      clearTimeout(timer);
      timer = setTimeout(refresh, 400);
    });
  },

  // Řádek položky košíku podle adresy produktu – Alza řádek při přepočtu vykreslí znovu (starý je odpojený)
  findBasketRow(url) {
    return this.getBasketRows().find((item) => item.url === url)?.row || null;
  },

  getBasketRows() {
    const s = this.basketSelectors;
    return [...document.querySelectorAll(s.item)]
      .map((row) => {
        const links = [...row.querySelectorAll(s.link)];
        const link = links.find((a) => a.textContent.trim()) || links[0];
        const countInput = row.querySelector(s.count);
        if (!link || !countInput) return null;
        const count = parseInt(countInput.value, 10) || 1;
        // Cena za kus z řádku (cena řádku je za všechny kusy) – to, co se teď opravdu platí; null = nejde přečíst
        const { value } = this.getBasketRowPrice(row);
        return { row, link, url: new URL(link.getAttribute("href"), window.location.origin).href, count, unit: value ? Math.round((value / count) * 100) / 100 : null };
      })
      .filter(Boolean);
  },

  async updateBasketInsights() {
    const rows = this.getBasketRows();
    if (rows.length === 0) return;
    const records = await this.getPriceRecords(rows.map(({ url }) => url));
    const histories = await Promise.all(rows.map(({ url }) => (records[url] ? this.getDisplayHistory(url) : [])));
    const bought = await this.getBasketOwned();
    rows.forEach((item, index) => {
      const key = AlzaCore.getProductKey(this.getAlzaDomain(), item.url);
      const chips = this.getBasketInsightChips(records[item.url], histories[index], item.count, item.unit);
      const owned = this.getBasketOwnedChip(AlzaCore.getOwnedSummary(bought.owned[key], bought.purchases[key]));
      this.state.basketChips.set(item.url, owned ? [owned, ...chips] : chips);
    });
    const stats = rows.map((item, index) => this.getBasketRowStats(records[item.url], histories[index], item.count, item.unit));
    this.state.basketSummary = await this.getBasketSummaryLines(AlzaCore.summarizeBasket(stats.filter(Boolean)), bought);
    this.paintBasketInsights(this.getBasketRows());
  },

  // Cena položky pro hodnocení (souhrn i chipy): cena za kus z řádku košíku – to, co se teď opravdu platí. Uložený
  // záznam ceny ji nahradí, jen když cenu řádku nejde přečíst, a jen čerstvý (basketCodeMaxAgeDays – stejný limit jako
  // u kódů): záznam starý 90 dní s akcí 799 Kč by u dnešních 999 Kč hlásil „pod obvyklou cenou“. Ze starého záznamu se
  // nedělají ani tvrzení, která stojí na jeho cenách (podezřelá sleva, jiný stav, množstevní sleva) – priceMap je null.
  // Pojistka proti špatně přečtené ceně řádku (jiné rozvržení košíku, cena za kus místo za všechny kusy): cena pod
  // polovinou nejnižší nebo nad dvojnásobkem nejvyšší ceny záznamu se bere jako nepřečtená.
  // { current, priceMap } nebo null = cenu nevíme
  getBasketItemPrice(record, unit, now) {
    if (!record) return null;
    const fresh = Number(record.lastUpdated) >= (now ?? Date.now()) - this.basketCodeMaxAgeDays * AlzaCore.dayMs;
    const priceMap = fresh ? AlzaCore.toPriceMap(record) : null;
    const known = Object.values(AlzaCore.getPayNowPriceMap(AlzaCore.toPriceMap(record)));
    const ratio = AlzaCore.minPlausibleRatio;
    const readable = unit > 0 && (known.length === 0 || (unit >= Math.min(...known) * ratio && unit <= Math.max(...known) / ratio));
    const current = readable ? unit : priceMap ? AlzaCore.getPlausiblePayNowPrice(priceMap) : null;
    return current > 0 ? { current, priceMap } : null;
  },

  // Hodnocení jedné položky pro souhrn nad košíkem (AlzaCore.summarizeBasket); null = bez ceny. unit = cena za kus
  // z řádku košíku (getBasketRows)
  getBasketRowStats(record, entries, count, unit, now) {
    const price = this.getBasketItemPrice(record, unit, now);
    if (!price || entries.length === 0) return null;
    const { current, priceMap } = price;
    const verdict = AlzaCore.getPriceVerdict(entries, current, now);
    return {
      level: verdict?.level === "lowest" ? "good" : verdict?.level || null, // Historické minimum je také pod obvyklou cenou
      current,
      typical: verdict?.typical || null,
      count,
      wait: Boolean(AlzaCore.getSaleCycle(entries, current, now)?.wait),
      warn: Boolean(priceMap && (AlzaCore.getDiscountWarning(entries, priceMap, now) || AlzaCore.getStrikethroughWarning(entries, priceMap, now))),
    };
  },

  // Řádky souhrnu nad košíkem: [{ tone, icon, text }] – hodnocení cen (jen když je co říct) a měsíční rozpočet
  async getBasketSummaryLines(summary, bought) {
    const parts = [];
    if (summary.high.n > 0) parts.push({ tone: "high", text: `▲ ${this.translate("basketSummaryHigh", summary.high.n, this.formatPrice(summary.high.amount))}` });
    if (summary.good.n > 0) parts.push({ tone: "good", text: `▼ ${this.translate("basketSummaryGood", summary.good.n, this.formatPrice(summary.good.amount))}` });
    if (summary.wait > 0) parts.push({ tone: "wait", icon: "hourglass", text: this.translate("basketSummaryWait", summary.wait) });
    if (summary.warn > 0) parts.push({ tone: "warn", icon: "warning", text: this.translate("basketSummaryWarn", summary.warn) });
    const lines = parts.length > 0 ? [{ parts }] : [];
    const budget = await this.getBasketBudgetLine();
    if (budget) lines.push({ parts: [budget] });
    return lines;
  },

  // Měsíční rozpočet (volba monthlyBudget, jen na hlavní Alze): utraceno tento měsíc (objednávky z Mých nákupů) + košík
  async getBasketBudgetLine() {
    const settings = await AlzaCore.getSettings();
    const domain = this.getAlzaDomain();
    if (!(settings.monthlyBudget > 0) || AlzaCore.getPrimaryDomain(settings) !== domain) return null;
    if (!settings.ownedItems) return { tone: "info", icon: "bag", text: this.translate("basketBudgetNeedsOwned", this.formatPrice(settings.monthlyBudget)) };
    const key = AlzaCore.storageKeys.ownedOrders;
    const { [key]: orders } = await chrome.storage.local.get(key);
    const spent = AlzaCore.getMonthSpending(orders, domain);
    const total = spent + this.getBasketTotal();
    const over = total - settings.monthlyBudget;
    const month = new Date().toLocaleDateString(AlzaCore.textLocales[this.state.uiLanguage || this.state.language || "cz"], { month: "long" });
    const base = this.translate("basketBudget", month, this.formatPrice(spent), this.formatPrice(total), this.formatPrice(settings.monthlyBudget));
    return over > 0
      ? { tone: "high", icon: "warning", text: `${base} – ${this.translate("basketBudgetOver", this.formatPrice(over))}` }
      : { tone: "good", icon: "bag", text: `${base} – ${this.translate("basketBudgetLeft", this.formatPrice(-over))}` };
  },

  // Souhrn nad položkami košíku (state.basketSummary) – před blokem položek; beze změny se nepřepisuje
  paintBasketSummary() {
    const items = document.querySelector(".items");
    const lines = this.state.basketSummary || [];
    const signature = JSON.stringify(lines);
    let box = document.querySelector(".alza-price-tracker-basket-summary");
    if (box && (box.nextElementSibling !== items || box.dataset.signature !== signature)) {
      box.remove();
      box = null;
    }
    if (box || !items || lines.length === 0) return;
    box = this.createEl("div", "alza-price-tracker-basket-summary");
    box.dataset.signature = signature;
    box.appendChild(AlzaCore.createToolbarLogo(document));
    lines.forEach(({ parts }) => {
      const line = this.createEl("div", "alza-price-tracker-basket-summary-line");
      parts.forEach((part) => line.appendChild(this.createBasketChip("", part)));
      box.appendChild(line);
    });
    items.before(box);
  },

  // Koupené zboží: Moje nákupy (jen se zapnutou volbou ownedItems) a nákupy z hlídání po nákupu (posledních 14 dní)
  async getBasketOwned() {
    const { owned: ownedKey, purchases: purchasesKey } = AlzaCore.storageKeys;
    const settings = await AlzaCore.getSettings();
    const data = await chrome.storage.local.get(settings.ownedItems ? [ownedKey, purchasesKey] : [purchasesKey]);
    const map = (value) => (value && typeof value === "object" ? value : {});
    return { owned: map(data[ownedKey]), purchases: map(data[purchasesKey]) };
  },

  // „Už máte · koupeno 3. 4. 2025“ – ať se omylem nekoupí podruhé (podrobnosti v bublině)
  getBasketOwnedChip(summary) {
    if (!summary) return null;
    const lang = this.state.uiLanguage || this.state.language || "cz";
    const date = AlzaCore.formatTextDate(summary.at, lang, true);
    const hint = [
      summary.price ? this.translate("productOwnedPrice", date, this.formatPrice(summary.price)) : this.translate("productOwned", date),
      this.translate("basketOwnedPieces", summary.pieces),
      summary.times > 1 ? this.translate("productOwnedTimes", summary.times) : null,
    ]
      .filter(Boolean)
      .join(" · ");
    return { tone: "owned", icon: "bag", text: this.translate("basketOwned", date), hint };
  },

  // Pod řádkem položky jeden řádek chipů zarovnaný doprava k ceně, nejvýš od názvu (na úzkém okně se zalomí, ale nikdy ne pod název do
  // sloupce). Beze změny se DOM nepřepisuje, jen se dorovná poloha (sloupce Alzy se mění se šířkou okna)
  basketCells: { name: ".c1", price: ".c5" },

  // Pořadí chipů: hodnocení ceny, počkat, výstrahy, už máte, ostatní (jiný stav, množstevní sleva)
  basketChipOrder: { good: 0, high: 0, wait: 1, warn: 2, owned: 3 },

  sortBasketChips(chips) {
    const rank = (chip) => this.basketChipOrder[chip.tone] ?? 4;
    return chips.map((chip, index) => ({ chip, index })).sort((a, b) => rank(a.chip) - rank(b.chip) || a.index - b.index).map(({ chip }) => chip);
  },

  paintBasketInsights(rows) {
    this.paintBasketSummary();
    // Pruh patří řádku před sebou (data-url) – po překreslení košíku (odebraná položka, jiné pořadí) by jinak
    // zůstal pod jinou položkou
    const urls = new Map(rows.map(({ row, url }) => [row, url]));
    document.querySelectorAll(`.${this.basketInsightClass}`).forEach((strip) => {
      if (urls.get(strip.previousElementSibling) !== strip.dataset.url) strip.remove();
    });
    rows.forEach(({ row, url }) => {
      const chips = this.state.basketChips?.get(url) || [];
      const signature = JSON.stringify(chips);
      let strip = row.nextElementSibling?.classList.contains(this.basketInsightClass) ? row.nextElementSibling : null;
      if (strip?.dataset.signature !== signature) {
        strip?.remove();
        strip = null;
        if (chips.length === 0) return;
        strip = this.createEl("div", this.basketInsightClass);
        strip.dataset.signature = signature;
        strip.dataset.url = url;
        const line = this.createEl("div", `${this.basketInsightClass}-chips`);
        this.sortBasketChips(chips).forEach((chip) => line.appendChild(this.createBasketChip(url, chip)));
        strip.appendChild(line);
        row.after(strip);
      }
      if (strip) this.alignBasketInsights(row, strip);
    });
  },

  createBasketChip(url, { tone, icon, text, hint, add, tiers, count, saving }) {
    const className = `alza-price-tracker-basket-chip alza-price-tracker-basket-chip--${tone}`;
    const chip = this.createEl(add ? "button" : "span", className, text);
    if (icon) AlzaIcons.prepend(chip, icon, { tone: true });
    if (hint) chip.title = hint;
    // Tooltip s tabulkou stupňů (price-card.js)
    if (tiers) Object.assign(chip.dataset, { tiers: JSON.stringify(tiers), count: String(count || 1), saving: saving || "" });
    if (add) {
      // „+1 ks → 83 Kč/ks“: kusy přidá Alzino tlačítko + (přepočet košíku i ceny dělá Alza)
      chip.type = "button";
      chip.addEventListener("click", async () => {
        chip.disabled = true;
        for (let i = 0; i < add; i++) {
          // Po každém kliknutí Alza řádek překreslí – tlačítko + hledat v aktuálním řádku produktu
          const plus = this.findBasketRow(url)?.querySelector(this.basketQuantityPlus);
          if (!plus) break;
          plus.click();
          if (i < add - 1) await new Promise((resolve) => setTimeout(resolve, 600));
        }
        // Po přepočtu Alza řádek překreslí a chip se nahradí; kdyby ne, znovu povolit
        setTimeout(() => (chip.disabled = false), 3000);
      });
    }
    return chip;
  },

  basketQuantityPlus: ".countPlus",

  alignBasketInsights(row, strip) {
    const rowRect = row.getBoundingClientRect();
    const name = row.querySelector(this.basketCells.name)?.getBoundingClientRect();
    const price = row.querySelector(this.basketCells.price)?.getBoundingClientRect();
    const line = strip.firstElementChild;
    if (!line) return;
    const set = (element, property, value) => element.style[property] !== value && (element.style[property] = value);
    if (name?.width) set(line, "marginLeft", `${Math.max(0, Math.round(name.left - rowRect.left))}px`);
    if (price?.width) set(line, "marginRight", `${Math.max(0, Math.round(rowRect.right - price.right))}px`);
  },

  // [{ tone: good|high|wait|warn|info, icon, text, hint, slot?: "count", add? }] pro jednu položku košíku.
  // unit = cena za kus z řádku košíku; cena a stáří záznamu viz getBasketItemPrice
  getBasketInsightChips(record, entries, count, unit, now) {
    const price = this.getBasketItemPrice(record, unit, now);
    if (!price) return [];
    const { current, priceMap } = price;
    const chips = [];

    const verdict = entries.length > 0 ? AlzaCore.getPriceVerdict(entries, current, now) : null;
    const cycle = entries.length > 0 ? AlzaCore.getSaleCycle(entries, current, now) : null;
    const cycleText = cycle ? this.getSaleCycleText(cycle, verdict?.days || 0) : null;
    const cycleLines = cycleText ? [cycleText.summary, cycleText.advice].filter(Boolean) : [];
    if (verdict && verdict.level !== "usual") {
      const { label, hint } = this.getVerdictText(verdict, current);
      const high = verdict.level === "high";
      chips.push({
        tone: high ? "high" : "good",
        text: `${high ? "▲" : "▼"} ${label}`,
        hint: [label, `${this.translate("statTypical")}: ${this.formatPrice(verdict.typical)}`, hint, ...cycleLines].join("\n"),
      });
    }
    if (cycle?.wait) chips.push({ tone: "wait", icon: "hourglass", text: this.translate("filterWait"), hint: cycleLines.join("\n") });
    // Loni v nadcházejícím měsíci znatelně levněji – možná se vyplatí počkat (Black Friday, AlzaDny…)
    const lastYear = entries.length > 0 ? AlzaCore.getLastYearOutlook(entries, current, now) : null;
    if (lastYear?.cheaper) {
      const date = AlzaCore.formatTextDate(lastYear.at, this.state.uiLanguage || this.state.language || "cz", true);
      chips.push({ tone: "wait", icon: "event", text: this.translate("basketLastYear", this.formatPrice(lastYear.lowest)), hint: this.translate("productLastYearDrop", this.formatPrice(lastYear.lowest), date) });
    }

    // Podezřelá sleva i vymyšlená přeškrtnutá cena v jednom chipu – podrobnosti v bublině
    const discountWarning = priceMap && entries.length > 0 ? AlzaCore.getDiscountWarning(entries, priceMap, now) : null;
    const strikethrough = priceMap && entries.length > 0 ? AlzaCore.getStrikethroughWarning(entries, priceMap, now) : null;
    const warnings = [discountWarning && this.getDiscountWarningText(discountWarning).hint, strikethrough && this.getStrikethroughText(strikethrough)].filter(Boolean);
    if (warnings.length > 0) chips.push({ tone: "warn", icon: "warning", text: this.translate("filterSuspicious"), hint: warnings.join("\n") });

    // Ceny jiných stavů a stupně množstevní slevy jsou ze záznamu – ze starého se neukazují
    if (!priceMap) return chips;
    const cheaper = AlzaCore.getCheaperConditions(record.conditions, current);
    if (cheaper.length > 0) {
      const best = cheaper[0];
      chips.push({
        tone: "info",
        text: this.translate("basketCheaperCondition", this.translate(`condition${best.condition[0].toUpperCase()}${best.condition.slice(1)}`).toLowerCase(), this.formatPrice(best.price)),
        hint: this.getCheaperConditionsText(cheaper),
      });
    }

    const next = AlzaCore.getNextQuantityTier(AlzaCore.getQuantityTiers(record), AlzaCore.getPayNowPrice(priceMap) ?? current, count);
    if (next) {
      chips.push({
        tone: "info",
        slot: "count",
        add: next.add,
        tiers: AlzaCore.getQuantityTiers(record),
        count,
        saving: this.translate("quantityTierSaving", next.from, this.translate("pieceUnit"), this.formatPrice(next.saving)),
        text: this.translate("basketQuantityHint", next.add, this.formatPrice(next.unit)),
        hint: this.translate("basketQuantityHintDetail", next.from, this.formatPrice(next.unit), this.formatPrice(next.current), this.formatPrice(next.saving)),
      });
    }
    return chips;
  },
});
