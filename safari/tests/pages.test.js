// Stránky rozšíření v Safari (WebKit): nastavení (každá záložka), popup, nápověda ve 4 jazycích a Co je nového.
// Každá stránka se načte zvlášť (tests/run.sh, kotva v adrese vybírá záložku) s napodobeným API Safari a prázdnými
// daty. Hlídá chyby JavaScriptu, nepřeložené texty, odkazy na kotvy, obrázky a rady, které v Safari neplatí.
(async () => {
  const { check, finish, fail, mock } = window.__test;
  const file = location.pathname.split("/").pop().replace("-pages-test.html", "");
  const name = `${file}${location.hash}`;
  const visibleText = () => document.body.innerText || "";
  const isVisible = (element) => element.getClientRects().length > 0 && !element.closest("[hidden]");

  try {
    // Stránka se vykreslí asynchronně (úložiště, texty, ikony)
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await mock.settle(10);

    check(`${name}: bez chyb JavaScriptu`, mock.errors.length === 0, mock.errors.join("\n    "));
    // Popup bez dat má jen hlavičku, tlačítka a „Zatím neproběhla žádná kontrola“
    const minimum = file === "popup" ? 40 : 80;
    check(`${name}: stránka má obsah`, visibleText().trim().length > minimum, `${visibleText().trim().length} znaků`);

    // Prvky s textem z překladu nesmí zůstat prázdné (chybějící klíč v některém jazyce)
    const empty = [...document.querySelectorAll("[data-i18n], [data-w]")]
      .filter((element) => isVisible(element) && !element.textContent.trim())
      .map((element) => element.dataset.i18n || element.dataset.w);
    check(`${name}: všechny viditelné texty přeložené`, empty.length === 0, empty.join(", "));
    // Klíč překladu (camelCase) místo textu; jednotky kWh, mAh jsou v pořádku
    const keys = visibleText().match(/\b[a-z]+[A-Z][a-z][A-Za-z]*\b/g)?.filter((word) => !/^(iPhone|iPad|macOS|kWh|mAh)$/.test(word)) || [];
    check(`${name}: žádné klíče překladu místo textu`, keys.length === 0, [...new Set(keys)].join(", "));

    // Prvek s atributem hidden, který je přesto vidět (CSS display ho přebije – např. prázdný řádek se šipkou)
    const shown = [...document.querySelectorAll("[hidden]")].filter((element) => element.getClientRects().length > 0);
    check(`${name}: skryté prvky nejsou vidět`, shown.length === 0, shown.map((element) => `${element.tagName.toLowerCase()}#${element.id}.${element.className}`).join(", "));

    // Odkazy na místo ve stránce (obsah nápovědy, odkazy mezi oddíly)
    const anchors = [...document.querySelectorAll('a[href^="#"]')].map((a) => a.getAttribute("href")).filter((href) => href.length > 1);
    const broken = anchors.filter((href) => !document.getElementById(decodeURIComponent(href.slice(1))));
    check(`${name}: odkazy na kotvy vedou na existující místo (${anchors.length})`, broken.length === 0, broken.join(", "));

    // Obrázky a ikony z rozšíření
    const images = [...document.images].filter((img) => img.src && !img.src.startsWith("http") && img.complete && img.naturalWidth === 0);
    check(`${name}: obrázky se načetly`, images.length === 0, images.map((img) => img.src).join(", "));
    const icons = [...document.querySelectorAll("[data-icon]")].filter((element) => isVisible(element) && !element.innerHTML.trim());
    check(`${name}: ikony doplněné`, icons.length === 0, icons.map((element) => element.dataset.icon).join(", "));

    if (file.startsWith("help")) {
      // Nápověda je společná pro všechny prohlížeče – musí ale radit i pro Safari
      const tip = [...document.querySelectorAll("p.tip")].find((p) => p.textContent.includes("Chrome Helper"));
      check(`${name}: rada k notifikacím zmiňuje Safari a aplikaci AllyZap`, tip && /Safari/.test(tip.textContent) && tip.textContent.includes("AllyZap"), tip?.textContent);
    } else {
      // Mimo nápovědu se ukazují jen rady pro tento prohlížeč
      const chromeOnly = ["Chrome Helper", "skládačk", "puzzle", "chrome://", "about:addons", "Google Chrome"].filter((text) => visibleText().includes(text));
      check(`${name}: žádné rady jen pro Chrome / Firefox`, chromeOnly.length === 0, chromeOnly.join(", "));
    }

    if (file === "options" && location.hash === "#s-notifications") {
      check(`${name}: rada k notifikacím pro Safari`, visibleText().includes("V Safari notifikace posílá aplikace AllyZap"), visibleText().slice(0, 300));
      const open = document.querySelector("#testNotificationsResult .notify-settings-open");
      check(`${name}: tlačítko Otevřít nastavení oznámení`, open && isVisible(open) && open.textContent === "Otevřít nastavení oznámení", open?.outerHTML);
      open?.click();
      await mock.settle(5);
      check(`${name}: tlačítko požádá aplikaci o Nastavení oznámení`, mock.native.some((message) => message.type === "openNotificationSettings"), JSON.stringify(mock.native));
    }
    if (file === "popup") {
      check(`${name}: hlavička AllyZap`, document.querySelector("h1, .app-title")?.textContent.includes("AllyZap"));
    }
    if (file === "welcome" && location.hash === "#news") {
      check(`${name}: stránka Co je nového`, document.title.startsWith("Co je nového"), document.title);
    }

    // Tlačítka a odkazy, které by v Safari nic neudělaly (prázdný odkaz bez obsluhy)
    const deadLinks = [...document.querySelectorAll("a")].filter((a) => isVisible(a) && !a.getAttribute("href") && !a.onclick && !a.id && !a.dataset.go);
    check(`${name}: viditelné odkazy mají cíl`, deadLinks.length === 0, deadLinks.map((a) => a.outerHTML.slice(0, 80)).join("\n    "));

    await mock.settle(10);
    check(`${name}: žádné chyby během testu`, mock.errors.length === 0, mock.errors.join("\n    "));
    finish();
  } catch (error) {
    fail(error);
  }
})();
