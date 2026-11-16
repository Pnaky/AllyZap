// Content script (část AlzaPriceTracker): Peněženka poukazů v košíku – bublina u odkazu „Využít slevový / dárkový
// poukaz“ (vpravo od něj, kde je na stránce volno; když se nevejde, pod ním), ať nepřekáží: poukazy z peněženky
// (storageKeys.vouchers) k vložení jedním klikem, kolik chybí do minimální hodnoty objednávky a nabídka uložit poukaz
// vložený v košíku, který v peněžence není. Poukaz, který je v tabulce uplatněných poukazů košíku, si zapamatuje čas
// (applied) – podle něj se pak v objednávce pozná, že byl použitý (AlzaOrders.markVouchersUsed). Kliknutí na „Vložit“
// uplatnění neznamená (Alza poukaz může odmítnout); když poukaz z tabulky zmizí, applied se smaže.
// Kódy poukazů z peněženky se do stránky Alzy nevypisují celé (jen konec kódu) – celý kód jde do pole Alzy až po
// kliknutí na „Vložit“.
// Načítá se po content.js a basket-codes.js, před content/start.js (manifest) – metody sdílí objekt AlzaPriceTracker
Object.assign(AlzaPriceTracker, {
  basketVoucherClass: "alza-price-tracker-vouchers",
  basketVoucherClosedKey: "alzaPriceTrackerVouchersClosed", // sessionStorage: zavřená bublina (do zavření karty)
  basketVoucherSkippedKey: "alzaPriceTrackerVouchersSkipped", // sessionStorage: kódy z košíku, které uživatel nechce uložit
  basketVoucherGap: 16, // Odstup bubliny od odkazu
  basketVoucherGoneMs: 4000, // Poukaz musí v tabulce košíku chybět aspoň tak dlouho, než se smaže jeho applied

  setupBasketVouchers() {
    if (this.state.basketVouchersReady || !this.isBasketPage()) return;
    this.state.basketVouchersReady = true;
    this.state.basketVouchers = {};
    const key = AlzaCore.storageKeys.vouchers;
    const load = async () => {
      const { [key]: stored } = await chrome.storage.local.get(key);
      this.state.basketVouchers = stored && typeof stored === "object" ? stored : {};
      this.renderBasketVouchers();
    };
    load().catch((error) => console.error("AllyZap – poukazy v košíku:", error));
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local" || !changes[key]) return;
      this.state.basketVouchers = changes[key].newValue && typeof changes[key].newValue === "object" ? changes[key].newValue : {};
      this.renderBasketVouchers();
    });
    let timer = null;
    this.observeBasket(() => {
      clearTimeout(timer);
      timer = setTimeout(() => this.renderBasketVouchers(), 300);
    });
    window.addEventListener("resize", () => this.positionBasketVouchers(), { passive: true });
    // Obsah nad odkazem se posune i bez změny DOM, kterou observer hlásí (vlastní souhrn nad položkami, dočtené
    // obrázky) – výška stránky se ale změní
    let frame = 0;
    new ResizeObserver(() => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        this.positionBasketVouchers();
      });
    }).observe(document.body);
  },

  readSessionList(key) {
    try {
      const list = JSON.parse(sessionStorage.getItem(key) || "[]");
      return Array.isArray(list) ? list : [];
    } catch {
      return [];
    }
  },

  writeSessionList(key, list) {
    try {
      sessionStorage.setItem(key, JSON.stringify(list));
    } catch {
      // Jen se nezapamatuje
    }
  },

  // Poukazy uplatněné v košíku (tabulka pod polem kódu): [{ code, amount (text), validity (text), condition (text) }]
  getAppliedBasketVouchers() {
    return [...document.querySelectorAll(this.basketSelectors.voucherRow)]
      .map((row) => [...row.querySelectorAll("td")].map((cell) => cell.textContent.replace(/\s+/g, " ").trim()))
      .filter((cells) => cells.length >= 2 && AlzaCore.normalizeVoucherCode(cells[0]).length >= 3)
      .map(([code, amount, validity = "", condition = ""]) => ({ code: AlzaCore.normalizeVoucherCode(code), amount, validity, condition }));
  },

  // Součet cen řádků košíku (cena v řádku je za všechny kusy) – minimální hodnota objednávky poukazu
  getBasketTotal() {
    return this.getBasketRows().reduce((sum, { row }) => sum + (this.getBasketRowPrice(row).value || 0), 0);
  },

  removeBasketVouchers() {
    this.state.basketVoucherBox?.remove();
    this.state.basketVoucherBox = null;
    this.state.basketVoucherSignature = null;
  },

  // Čas uplatnění (applied) poukazů z peněženky podle tabulky uplatněných poukazů košíku – i při zavřené bublině.
  // V tabulce je → applied (nejvýš jednou za voucherAppliedRefreshMs; karta na pozadí starý čas neposouvá – objednávka
  // mohla mezitím odejít z jiné karty). V tabulce není a applied má → smazat, ale jen v košíku se zbožím a blokem
  // poukazů (prázdný košík po odeslání objednávky ani jiná stránka nic nemažou) a až když chybí i při dalším
  // vykreslení po basketVoucherGoneMs (Alza tabulku při přepočtu košíku na chvíli vyjme)
  syncBasketVoucherApplied(domain, appliedCodes, ready) {
    const now = Date.now();
    const vouchers = this.state.basketVouchers || {};
    const { seen, gone } = AlzaCore.getBasketVoucherChanges(vouchers, domain, appliedCodes, now);
    const missing = this.state.basketVoucherMissing || (this.state.basketVoucherMissing = {});
    // Mimo košík se zbožím se odpočet ruší – po návratu začíná znovu
    Object.keys(missing).forEach((id) => {
      if (!ready || !gone.includes(id)) delete missing[id];
    });
    const merge = {};
    seen.filter((id) => !(vouchers[id]?.applied > 0) || document.visibilityState !== "hidden").forEach((id) => (merge[id] = { applied: now }));
    if (ready) {
      gone.forEach((id) => {
        if (!missing[id]) missing[id] = now;
        else if (now - missing[id] >= this.basketVoucherGoneMs) {
          merge[id] = { applied: null };
          delete missing[id];
        }
      });
      if (Object.keys(missing).length > 0 && !this.state.basketVoucherGoneTimer) {
        this.state.basketVoucherGoneTimer = setTimeout(() => {
          this.state.basketVoucherGoneTimer = null;
          this.renderBasketVouchers();
        }, this.basketVoucherGoneMs + 200);
      }
    }
    if (Object.keys(merge).length > 0) AlzaStore.run({ type: "patchMap", key: AlzaCore.storageKeys.vouchers, merge, existingOnly: true }).catch(() => {});
  },

  renderBasketVouchers() {
    const domain = AlzaCore.getDomainKey(window.location.hostname);
    const anchor = document.querySelector(this.basketSelectors.codeToggle);
    const hasItems = this.getBasketRows().length > 0;
    const applied = this.getAppliedBasketVouchers();
    const appliedCodes = new Set(applied.map(({ code }) => code));
    if (domain) this.syncBasketVoucherApplied(domain, appliedCodes, Boolean(anchor) && hasItems);
    if (!domain || !anchor || !hasItems || this.readSessionList(this.basketVoucherClosedKey).includes(domain)) {
      this.removeBasketVouchers();
      return;
    }
    const now = Date.now();
    const vouchers = this.state.basketVouchers || {};
    const active = AlzaCore.getActiveVouchers(vouchers, domain, now);

    const total = this.getBasketTotal();
    const known = new Set(Object.values(vouchers).map((voucher) => voucher?.code));
    const skipped = this.readSessionList(this.basketVoucherSkippedKey);
    const offers = active.map((entry) => ({ ...entry, inCart: appliedCodes.has(entry.voucher.code), shortfall: AlzaCore.getVoucherShortfall(entry.voucher, total) }));
    const unsaved = applied.filter(({ code }) => !known.has(code) && !skipped.includes(code));
    if (offers.length === 0 && unsaved.length === 0) {
      this.removeBasketVouchers();
      return;
    }
    const signature = JSON.stringify([offers.map(({ id, inCart, shortfall, daysLeft, voucher }) => [id, inCart, shortfall, daysLeft, voucher.value, voucher.note]), unsaved]);
    if (signature !== this.state.basketVoucherSignature || !this.state.basketVoucherBox?.isConnected) {
      this.state.basketVoucherBox?.remove();
      this.state.basketVoucherBox = this.createBasketVoucherBox(domain, offers, unsaved);
      this.state.basketVoucherSignature = signature;
      document.body.appendChild(this.state.basketVoucherBox);
    }
    this.positionBasketVouchers();
  },

  createBasketVoucherBox(domain, offers, unsaved) {
    const c = this.basketVoucherClass;
    const box = this.createEl("div", c);
    box.setAttribute("role", "region");
    box.setAttribute("aria-label", this.translate("basketVouchersTitle"));
    box.appendChild(this.createEl("span", `${c}-arrow`));

    const header = this.createEl("div", `${c}-header`);
    const close = AlzaIcons.prepend(this.createEl("button", `${c}-x`), "close");
    close.type = "button";
    close.title = this.translate("basketVouchersClose");
    close.setAttribute("aria-label", close.title);
    close.addEventListener("click", () => {
      this.writeSessionList(this.basketVoucherClosedKey, [...this.readSessionList(this.basketVoucherClosedKey), domain]);
      this.removeBasketVouchers();
    });
    const available = offers.filter(({ inCart }) => !inCart).length;
    header.append(
      AlzaIcons.prepend(this.createEl("span", `${c}-icon`), "tag", { tone: true }),
      this.createEl("span", `${c}-title`, available > 0 ? this.translate("basketVouchersTitleCount", available) : this.translate("basketVouchersTitle")),
      AlzaCore.createToolbarLogo(document),
      close
    );
    box.appendChild(header);

    const list = this.createEl("ul", `${c}-list`);
    offers.forEach(({ voucher, daysLeft, inCart, shortfall }) => {
      const item = this.createEl("li", `${c}-item${inCart ? ` ${c}-item--done` : ""}`);
      const top = this.createEl("div", `${c}-line`);
      // Do stránky Alzy jen konec kódu („••••KFPE“) – celý kód zůstává v paměti rozšíření (ne v textu, title ani
      // atributech) a do pole Alzy jde až po kliknutí
      const value = AlzaCore.formatVoucherValue(voucher);
      const masked = AlzaCore.maskVoucherCode(voucher.code);
      top.append(this.createEl("strong", `${c}-value`, value), this.createEl("code", `${c}-code`, masked));
      if (inCart) top.appendChild(AlzaIcons.prepend(this.createEl("span", `${c}-state`, this.translate("basketVoucherInCart")), "check-circle", { tone: true }));
      else {
        const insert = this.createEl("button", `${c}-insert`, this.translate("basketVoucherInsert"));
        insert.type = "button";
        // Víc poukazů = víc tlačítek „Vložit“ – čtečka je rozliší podle hodnoty a konce kódu
        insert.setAttribute("aria-label", this.translate("basketVoucherInsertLabel", value, masked));
        insert.addEventListener("click", () => {
          insert.disabled = true;
          // applied se tu nezapisuje – Alza poukaz může odmítnout; zapíše se, až bude v tabulce uplatněných poukazů
          this.insertBasketCode(voucher.code);
          setTimeout(() => (insert.disabled = false), 3000);
        });
        top.appendChild(insert);
      }
      item.appendChild(top);
      const details = [];
      if (voucher.until) {
        const lang = this.state.uiLanguage || this.state.language || "cz";
        const date = AlzaCore.formatTextDate(voucher.until, lang, true);
        details.push(daysLeft <= 1 ? this.translate("basketVoucherLastDay", date) : this.translate("basketVoucherUntil", date, AlzaCore.formatDays(lang, daysLeft)));
      }
      if (voucher.note) details.push(voucher.note);
      if (details.length > 0) item.appendChild(this.createEl("div", `${c}-detail${voucher.until && daysLeft <= AlzaCore.voucherSoonDays ? ` ${c}-detail--soon` : ""}`, details.join(" · ")));
      if (shortfall > 0 && !inCart) item.appendChild(this.createEl("div", `${c}-detail ${c}-detail--warn`, this.translate("basketVoucherShortfall", this.formatPrice(voucher.minOrder), this.formatPrice(shortfall))));
      list.appendChild(item);
    });
    // Poukaz vložený v košíku, který v peněžence není – uložit (s platností a minimem z Alzina řádku poukazu).
    // Hodnota jen z buňky částky, z textu podmínky jen minimum objednávky. Kód tu je celý – na stránku ho vypsala Alza
    unsaved.forEach(({ code, amount, validity, condition }) => {
      const parsed = AlzaCore.parseBasketVoucherRow(amount, condition);
      const item = this.createEl("li", `${c}-item ${c}-item--new`);
      const top = this.createEl("div", `${c}-line`);
      top.append(this.createEl("strong", `${c}-value`, amount), this.createEl("code", `${c}-code`, code));
      item.appendChild(top);
      item.appendChild(this.createEl("div", `${c}-detail`, this.translate("basketVoucherSaveHint")));
      const actions = this.createEl("div", `${c}-actions`);
      const save = this.createEl("button", `${c}-insert`, this.translate("basketVoucherSave"));
      const skip = this.createEl("button", `${c}-skip`, this.translate("basketVoucherSkip"));
      save.type = skip.type = "button";
      save.addEventListener("click", () => {
        const voucher = AlzaCore.sanitizeVoucher({
          code,
          domain,
          kind: parsed.kind,
          value: parsed.value,
          until: AlzaCore.parseVoucherDate(validity),
          minOrder: parsed.minOrder,
          applied: Date.now(),
        });
        if (!voucher) {
          // Částka nejde přečíst – doplní se v nastavení
          chrome.runtime.sendMessage({ action: "openOptions", hash: "#codes" }).catch(() => {});
          return;
        }
        save.disabled = true;
        AlzaStore.run({ type: "patchMap", key: AlzaCore.storageKeys.vouchers, set: { [AlzaCore.getVoucherId(domain, code)]: voucher } }).catch((error) => {
          save.disabled = false;
          console.error("AllyZap – uložení poukazu:", error);
        });
      });
      skip.addEventListener("click", () => {
        this.writeSessionList(this.basketVoucherSkippedKey, [...this.readSessionList(this.basketVoucherSkippedKey), code]);
        this.renderBasketVouchers();
      });
      actions.append(save, skip);
      item.appendChild(actions);
      list.appendChild(item);
    });
    box.appendChild(list);

    const manage = this.createEl("button", `${c}-manage`, this.translate("basketVouchersManage"));
    manage.type = "button";
    manage.addEventListener("click", () => chrome.runtime.sendMessage({ action: "openOptions", hash: "#codes" }).catch(() => {}));
    box.appendChild(manage);
    return box;
  },

  // Vpravo od odkazu (a od pole kódu, když je otevřené), šipka doleva; když se vpravo nevejde, pod blok poukazů se
  // šipkou nahoru. Souřadnice stránky – bublina se posouvá s ní
  positionBasketVouchers() {
    const box = this.state.basketVoucherBox;
    const anchor = document.querySelector(this.basketSelectors.codeToggle);
    if (!box || !anchor) return;
    const container = anchor.closest("#discountContainerDiscountCode") || anchor.parentElement;
    // Odkaz je blok přes celou šířku – měří se jeho text; stejně tak obsah pole kódu a tabulka vložených poukazů
    const title = (anchor.querySelector("span") || anchor).getBoundingClientRect();
    if (!title.width) {
      box.hidden = true; // Košík bez bloku poukazů (např. přepnutý seznam)
      return;
    }
    box.hidden = false;
    const occupied = [...container.querySelectorAll(".insertItemInput > *, table")].filter((element) => element.offsetParent).map((element) => element.getBoundingClientRect());
    const right = Math.max(title.right, ...occupied.filter((rect) => rect.width > 0).map((rect) => rect.right));
    const width = box.offsetWidth;
    const gap = this.basketVoucherGap;
    const origin = getComputedStyle(document.body).position === "static" ? { left: -window.scrollX, top: -window.scrollY } : document.body.getBoundingClientRect();
    const arrow = box.querySelector(`.${this.basketVoucherClass}-arrow`);
    // Vpravo jen když se vejde a nezakryje tlačítko Pokračovat (bývá vpravo dole vedle poukazů)
    const sideRect = { left: right + gap, right: right + gap + width, top: title.top - 14, bottom: title.top - 14 + box.offsetHeight };
    const blocks = [...document.querySelectorAll(this.basketSelectors.continueButton)]
      .map((element) => element.getBoundingClientRect())
      .some((rect) => rect.width > 0 && rect.left < sideRect.right && rect.right > sideRect.left && rect.top < sideRect.bottom && rect.bottom > sideRect.top);
    const side = !blocks && sideRect.right <= document.documentElement.clientWidth - 8;
    box.classList.toggle(`${this.basketVoucherClass}--right`, side);
    box.classList.toggle(`${this.basketVoucherClass}--below`, !side);
    if (side) {
      const top = title.top - 14;
      box.style.left = `${right + gap - origin.left}px`;
      box.style.top = `${top - origin.top}px`;
      arrow.style.left = "";
      arrow.style.top = `${Math.max(12, title.top + title.height / 2 - top - 6)}px`;
    } else {
      const block = container.getBoundingClientRect();
      const left = Math.max(8, Math.min(title.left - 8, document.documentElement.clientWidth - width - 8));
      box.style.left = `${left - origin.left}px`;
      box.style.top = `${block.bottom + gap - origin.top}px`;
      arrow.style.top = "";
      arrow.style.left = `${Math.max(12, Math.min(title.left + 16 - left, width - 24))}px`;
    }
  },
});
