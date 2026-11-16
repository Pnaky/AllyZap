// === Překlady ===
// Jazyk popupu podle jazyka prohlížeče (popup nepatří k žádné doméně Alzy); jiné jazyky → angličtina.
// Texty změn a problémů z kontroly na pozadí jsou už uložené v jazyce domény produktu.
const POPUP_TEXTS = {
  cz: {
    title: "AllyZap",
    showProducts: "Zobrazit produkty",
    noProducts: "Žádné produkty",
    cleanupText: "{0} produktů už přes 3 měsíce nehlídáte ani neotevíráte – navrhujeme je smazat.",
    cleanupHint: "Produkty, které nejsou v žádném hlídaném seznamu, nehlídáte z detailu, nemají cílovou cenu a přes 3 měsíce se nekontrolovaly ani neotevřely (uložené při procházení přes rok). Smaže se jejich historie cen a uložené ceny – v nastavení si je nejdřív prohlédnete a smazání potvrdíte.",
    cleanupReview: "Prohlédnout a smazat",
    cleanupSnooze: "Připomenout za měsíc",
    openOptionsTitle: "Nastavení – sledování, notifikace, výpisy kategorií, záloha",
    openData: "Moje data",
    openDataTitle: "Hlídané seznamy a produkty, Moje nákupy, kódy a poukazy, uložená data",
    newsTitle: "Co je nového",
    newsBadge: "Novinky",
    changes: "Změny cen",
    changesNew: "Nové změny cen ({0})",
    changesRecent: "Poslední změny cen",
    codesLink: "Slevové kódy u produktů: {0}",
    codesLinkVouchers: "Poukazy k použití: {0} · kódy u produktů: {1}",
    cashbackTitle: "Cashback k registraci ({0})",
    cashbackRefund: "až {0} zpět",
    cashbackUntil: "registrace do {0}",
    cashbackFrom: "registrace od {0}",
    cashbackRange: "registrace {0} – {1}",
    cashbackNoDate: "lhůta v podmínkách akce",
    cashbackTerms: "Podmínky akce",
    cashbackDone: "Hotovo",
    cashbackDoneTitle: "Nákup mám zaregistrovaný – už nepřipomínat",
    watchList: "Hlídat seznam",
    unwatchList: "Nehlídat seznam ({0})",
    openListHint: "Otevřete nákupní seznam na Alze",
    runNow: "Zkontrolovat",
    runNowTitle: "Zkontrolovat hlídané produkty teď",
    listSynced: "Synchronizováno {0}",
    listSummary: "Za posledních 7 dní: zlevnilo {0}, zdražilo {1} (nejnižší cena)",
    listNoChanges: "beze změn",
    actionFailed: "Nepovedlo se: {0}",
    watchedProducts: "Hlídané produkty ({0})",
    running: "Probíhá kontrola (od {0})",
    lastRun: "Kontrola {0} · {1} produktů · změn {2}",
    noRunYet: "Zatím neproběhla žádná kontrola",
    nextRun: "Další kontrola {0}",
    pending: "Odloženo do konce tichých hodin: {0}",
    pendingRetry: "Nedoručené notifikace: {0} – za pár minut to zkusíme znovu",
    alertSince: "Ceny se nekontrolují od {0}.",
    alertSinceDomain: "Ceny na {0} se nekontrolují od {1}.",
    alertLogin: "Přihlásit se na Alze",
    alertRetry: "Zkontrolovat znovu",
  },
  sk: {
    title: "AllyZap",
    showProducts: "Zobraziť produkty",
    noProducts: "Žiadne produkty",
    cleanupText: "{0} produktov už viac ako 3 mesiace nesledujete ani neotvárate – navrhujeme ich zmazať.",
    cleanupHint: "Produkty, ktoré nie sú v žiadnom sledovanom zozname, nesledujete z detailu, nemajú cieľovú cenu a viac ako 3 mesiace sa nekontrolovali ani neotvorili (uložené pri prehliadaní viac ako rok). Zmaže sa ich história cien a uložené ceny – v nastaveniach si ich najprv pozriete a zmazanie potvrdíte.",
    cleanupReview: "Pozrieť a zmazať",
    cleanupSnooze: "Pripomenúť o mesiac",
    openOptionsTitle: "Nastavenia – sledovanie, notifikácie, výpisy kategórií, záloha",
    openData: "Moje dáta",
    openDataTitle: "Sledované zoznamy a produkty, Moje nákupy, kódy a poukazy, uložené dáta",
    newsTitle: "Čo je nové",
    newsBadge: "Novinky",
    changes: "Zmeny cien",
    changesNew: "Nové zmeny cien ({0})",
    changesRecent: "Posledné zmeny cien",
    codesLink: "Zľavové kódy pri produktoch: {0}",
    codesLinkVouchers: "Poukazy na použitie: {0} · kódy pri produktoch: {1}",
    cashbackTitle: "Cashback na registráciu ({0})",
    cashbackRefund: "až {0} späť",
    cashbackUntil: "registrácia do {0}",
    cashbackFrom: "registrácia od {0}",
    cashbackRange: "registrácia {0} – {1}",
    cashbackNoDate: "lehota v podmienkach akcie",
    cashbackTerms: "Podmienky akcie",
    cashbackDone: "Hotovo",
    cashbackDoneTitle: "Nákup mám zaregistrovaný – už nepripomínať",
    watchList: "Sledovať zoznam",
    unwatchList: "Nesledovať zoznam ({0})",
    openListHint: "Otvorte nákupný zoznam na Alze",
    runNow: "Skontrolovať",
    runNowTitle: "Skontrolovať sledované produkty teraz",
    listSynced: "Synchronizované {0}",
    listSummary: "Za posledných 7 dní: zlacnelo {0}, zdraželo {1} (najnižšia cena)",
    listNoChanges: "bez zmien",
    actionFailed: "Nepodarilo sa: {0}",
    watchedProducts: "Sledované produkty ({0})",
    running: "Prebieha kontrola (od {0})",
    lastRun: "Kontrola {0} · {1} produktov · zmien {2}",
    noRunYet: "Zatiaľ neprebehla žiadna kontrola",
    nextRun: "Ďalšia kontrola {0}",
    pending: "Odložené do konca tichých hodín: {0}",
    pendingRetry: "Nedoručené notifikácie: {0} – o pár minút to skúsime znova",
    alertSince: "Ceny sa nekontrolujú od {0}.",
    alertSinceDomain: "Ceny na {0} sa nekontrolujú od {1}.",
    alertLogin: "Prihlásiť sa na Alze",
    alertRetry: "Skontrolovať znova",
  },
  hu: {
    title: "AllyZap",
    showProducts: "Termékek megjelenítése",
    noProducts: "Nincsenek termékek",
    cleanupText: "{0} terméket több mint 3 hónapja nem figyel és nem nyitott meg – javasoljuk a törlésüket.",
    cleanupHint: "Olyan termékek, amelyek nincsenek figyelt listán, nem figyeli őket a termékoldalról, nincs célár, és több mint 3 hónapja nem ellenőrizték vagy nyitották meg őket (a böngészés közben mentetteket több mint egy éve). Az árelőzményeik és mentett áraik törlődnek – a beállításokban előbb megtekinti, majd megerősíti a törlést.",
    cleanupReview: "Megtekintés és törlés",
    cleanupSnooze: "Emlékeztessen egy hónap múlva",
    openOptionsTitle: "Beállítások – figyelés, értesítések, kategórialisták, biztonsági mentés",
    openData: "Saját adatok",
    openDataTitle: "Figyelt listák és termékek, Vásárlásaim, kódok és kuponok, mentett adatok",
    newsTitle: "Újdonságok",
    newsBadge: "Újdonságok",
    changes: "Árváltozások",
    changesNew: "Új árváltozások ({0})",
    changesRecent: "Legutóbbi árváltozások",
    codesLink: "Kuponkódok a termékeknél: {0}",
    codesLinkVouchers: "Felhasználható kuponok: {0} · kódok a termékeknél: {1}",
    cashbackTitle: "Regisztrálandó cashback ({0})",
    cashbackRefund: "akár {0} vissza",
    cashbackUntil: "regisztrációs határidő: {0}",
    cashbackFrom: "regisztráció kezdete: {0}",
    cashbackRange: "regisztráció: {0} – {1}",
    cashbackNoDate: "határidő az akció feltételeiben",
    cashbackTerms: "Akciós feltételek",
    cashbackDone: "Kész",
    cashbackDoneTitle: "A vásárlást regisztráltam – ne emlékeztessen",
    watchList: "Lista figyelése",
    unwatchList: "Figyelés leállítása ({0})",
    openListHint: "Nyisson meg egy bevásárlólistát az Alzán",
    runNow: "Ellenőrzés",
    runNowTitle: "Figyelt termékek ellenőrzése most",
    listSynced: "Szinkronizálva: {0}",
    listSummary: "Az elmúlt 7 napban: {0} olcsóbb lett, {1} drágább (legalacsonyabb ár)",
    listNoChanges: "nincs változás",
    actionFailed: "Nem sikerült: {0}",
    watchedProducts: "Figyelt termékek ({0})",
    running: "Ellenőrzés folyamatban ({0} óta)",
    lastRun: "Ellenőrzés {0} · {1} termék · {2} változás",
    noRunYet: "Még nem volt ellenőrzés",
    nextRun: "Következő ellenőrzés: {0}",
    pending: "A csendes órák végéig elhalasztva: {0}",
    pendingRetry: "Nem kézbesített értesítések: {0} – néhány perc múlva újra megpróbáljuk",
    alertSince: "Az árak ellenőrzése {0} óta szünetel.",
    alertSinceDomain: "Az {0} árainak ellenőrzése {1} óta szünetel.",
    alertLogin: "Bejelentkezés az Alzára",
    alertRetry: "Ellenőrzés újra",
  },
  en: {
    title: "AllyZap",
    showProducts: "Show products",
    noProducts: "No products",
    cleanupText: "{0} products haven't been watched or opened for over 3 months – we suggest deleting them.",
    cleanupHint: "Products that aren't in any watched list, aren't watched from the product page, have no target price and haven't been checked or opened for over 3 months (products saved while browsing: over a year). Their price history and stored prices will be deleted – you review them in settings first and confirm the deletion.",
    cleanupReview: "Review and delete",
    cleanupSnooze: "Remind me in a month",
    openOptionsTitle: "Settings – tracking, notifications, category listings, backup",
    openData: "My data",
    openDataTitle: "Watched lists and products, My purchases, codes and vouchers, stored data",
    newsTitle: "What's new",
    newsBadge: "What's new",
    changes: "Price changes",
    changesNew: "New price changes ({0})",
    changesRecent: "Recent price changes",
    codesLink: "Discount codes on products: {0}",
    codesLinkVouchers: "Vouchers to use: {0} · codes on products: {1}",
    cashbackTitle: "Cashback to register ({0})",
    cashbackRefund: "up to {0} back",
    cashbackUntil: "register by {0}",
    cashbackFrom: "register from {0}",
    cashbackRange: "register {0} – {1}",
    cashbackNoDate: "deadline in the promotion terms",
    cashbackTerms: "Promotion terms",
    cashbackDone: "Done",
    cashbackDoneTitle: "I've registered the purchase – stop reminding me",
    watchList: "Watch list",
    unwatchList: "Stop watching list ({0})",
    openListHint: "Open a shopping list on Alza",
    runNow: "Check now",
    runNowTitle: "Check watched products now",
    listSynced: "Synced {0}",
    listSummary: "Last 7 days: {0} cheaper, {1} more expensive (lowest price)",
    listNoChanges: "no changes",
    actionFailed: "Failed: {0}",
    watchedProducts: "Watched products ({0})",
    running: "Check in progress (since {0})",
    lastRun: "Checked {0} · {1} products · {2} changes",
    noRunYet: "No check has run yet",
    nextRun: "Next check {0}",
    pending: "Postponed until quiet hours end: {0}",
    pendingRetry: "Undelivered notifications: {0} – we'll try again in a few minutes",
    alertSince: "Prices have not been checked since {0}.",
    alertSinceDomain: "Prices on {0} have not been checked since {1}.",
    alertLogin: "Log in to Alza",
    alertRetry: "Check again",
  },
};

// Jiný jazyk prohlížeče než cs/sk/hu → angličtina
const UI_LANGUAGES = {
  cs: { lang: "cz", locale: "cs-CZ" },
  sk: { lang: "sk", locale: "sk-SK" },
  hu: { lang: "hu", locale: "hu-HU" },
  en: { lang: "en", locale: "en-GB" },
};
// Zatím podle prohlížeče – volbu z nastavení (storage je jen asynchronní) doplní init na konci souboru
let uiLanguage = AlzaCore.getUiLanguage();
let ui = UI_LANGUAGES[uiLanguage];

function t(key, ...params) {
  return AlzaCore.translateFrom(POPUP_TEXTS, ui.lang, key, params);
}

// Ikony před texty (src/shared/icons.js) – emoji v textech nejsou, ikonu přidá setText podle klíče textu
const POPUP_ICONS = {
  openData: "storage",
  cleanupText: "cleaning",
  cleanupReview: "cleaning",
  watchList: "bell",
  unwatchList: "bell-off",
  runNow: "refresh",
  actionFailed: "warning",
  running: "hourglass",
  nextRun: "schedule",
  pending: "moon",
  pendingRetry: "bell-off",
};

function setText(element, key, ...params) {
  element.textContent = t(key, ...params);
  if (POPUP_ICONS[key]) AlzaIcons.prepend(element, POPUP_ICONS[key], { tone: key === "actionFailed" });
  return element;
}

function applyStaticTexts() {
  document.documentElement.lang = ui.locale.split("-")[0];
  document.querySelectorAll("[data-i18n]").forEach((element) => setText(element, element.dataset.i18n));
  AlzaIcons.decorate(document);
  document.querySelectorAll("[data-i18n-title]").forEach((element) => (element.title = t(element.dataset.i18nTitle)));
}
applyStaticTexts();

// Služba na pozadí na tyto zprávy neodpovídá – zavřený port není chyba
function sendToBackground(message) {
  chrome.runtime.sendMessage(message).catch(() => {});
}

// Moje data = stránka rozšíření (výchozí pohled dat; otevřenou jen přepne), ozubené kolo = rovnou pohled nastavení
document.getElementById("openData").addEventListener("click", () => chrome.runtime.openOptionsPage());
document.getElementById("openOptions").addEventListener("click", () => chrome.tabs.create({ url: chrome.runtime.getURL("src/options/options.html#s-") }));
document.getElementById("codesLink").addEventListener("click", () => chrome.tabs.create({ url: chrome.runtime.getURL("src/options/options.html#codes") }));

// === Novinky po aktualizaci ===
// Zelená značka Novinky v záhlaví otevře novinky v průvodci (#news) – jen dokud uživatel neviděl novinky nainstalované
// verze, jinak je schovaná (vždy jsou v nastavení: Co je nového; background.js otevře novinky sám jen u vydání s novou volbou)
const NEWS_KEY = AlzaCore.storageKeys.news;

async function renderNews() {
  const button = document.getElementById("openNews");
  const { [NEWS_KEY]: news } = await chrome.storage.local.get(NEWS_KEY);
  const unseen = AlzaCore.getReleaseNews(news?.seen, chrome.runtime.getManifest().version).length > 0;
  button.hidden = !unseen;
  button.classList.toggle("unseen", unseen);
  button.querySelector(".news-label")?.remove();
  if (unseen) button.append(Object.assign(document.createElement("span"), { className: "news-label", textContent: t("newsBadge") }));
}

document.getElementById("openNews").addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("src/welcome/welcome.html#news") });
  window.close();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes[NEWS_KEY]) renderNews().catch(showError);
});

// === Domény Alzy ===
// Data jsou oddělená po doménách, popup ukazuje všechny dohromady. Doména otevřené záložky (null = jiná
// stránka než Alza) určuje odkaz na Alzu; štítek domény se ukáže, jen když hlídáte víc domén
let activeDomain = null;

async function getActiveTabDomain() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    // Adresu záložky prohlížeč popupu prozradí jen u stránek Alzy (host_permissions)
    return tab?.url && AlzaCore.isAlzaUrl(tab.url) ? AlzaCore.getDomainKey(new URL(tab.url).hostname) : null;
  } catch {
    return null;
  }
}

function getUrlDomain(url) {
  return AlzaCore.isAlzaUrl(url) ? AlzaCore.getDomainKey(new URL(url).hostname) : null;
}

function getHost(domain) {
  return new URL(AlzaCore.domains[domain].origin).hostname.replace(/^www\./, "");
}

// Štítek „CZ“ / „SK“ / „HU“ (null = jedna doména, štítek není potřeba)
function createDomainBadge(domain, show) {
  if (!show || !AlzaCore.isKnownDomain(domain)) return null;
  const badge = document.createElement("span");
  badge.className = "domain-badge";
  badge.textContent = AlzaCore.domains[domain].lang.toUpperCase();
  badge.title = getHost(domain);
  return badge;
}

// === Hlídání cen na pozadí ===
const WATCH_LISTS_KEY = AlzaCore.storageKeys.watchLists;
const TARGETS_KEY = AlzaCore.storageKeys.targets;
const WATCH_PRODUCTS_KEY = AlzaCore.storageKeys.watchProducts;
const CLEANUP_KEY = AlzaCore.storageKeys.cleanup;
const WATCH_STATE_KEY = AlzaCore.storageKeys.watchState;
const CODES_KEY = AlzaCore.storageKeys.codes;
const VOUCHERS_KEY = AlzaCore.storageKeys.vouchers;
const CASHBACK_REMINDERS_KEY = AlzaCore.storageKeys.cashbackReminders;
const PURCHASES_KEY = AlzaCore.storageKeys.purchases;
const SETTINGS_KEY = AlzaCore.storageKeys.settings;

const toggleWatchButton = document.getElementById("toggleWatch");
const runWatchNowButton = document.getElementById("runWatchNow");
let watchState = null;
let newChangeKeys = new Set(); // Produkty z čísla na ikoně při otevření popupu a z kontrol doběhlých, dokud je otevřený

function formatTime(timestamp) {
  return timestamp ? new Date(timestamp).toLocaleString(ui.locale, { dateStyle: "short", timeStyle: "short" }) : "–";
}

// Odpověď content scriptu otevřené záložky; null = jiná stránka než seznam (content script neběží)
async function sendToActiveTab(message) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab ? ((await chrome.tabs.sendMessage(tab.id, message)) ?? null) : null;
  } catch {
    return null;
  }
}

// Chyba akce v popupu – uživatel ji uvidí místo „nic se nestalo“ (zapíše se i do logu chyb)
function showError(error) {
  console.error("Popup:", error);
  const status = document.getElementById("watchStatus");
  setText(status, "actionFailed", error?.message || error);
  status.classList.add("error");
}

function renderToggle() {
  toggleWatchButton.disabled = !watchState?.listId;
  toggleWatchButton.title = "";
  if (!watchState?.listId) {
    setText(toggleWatchButton, "watchList");
    toggleWatchButton.title = t("openListHint");
  } else if (watchState.watched) {
    setText(toggleWatchButton, "unwatchList", watchState.count);
  } else {
    setText(toggleWatchButton, "watchList");
  }
}

async function renderWatch() {
  const data = await chrome.storage.local.get([WATCH_LISTS_KEY, WATCH_STATE_KEY, TARGETS_KEY, WATCH_PRODUCTS_KEY, CLEANUP_KEY, PURCHASES_KEY]);
  const settings = await AlzaCore.getSettings();
  const lists = data[WATCH_LISTS_KEY] || {};
  const targetCount = Object.keys(data[TARGETS_KEY] || {}).length;
  const productCount = Object.keys(data[WATCH_PRODUCTS_KEY] || {}).length;
  const state = data[WATCH_STATE_KEY] || {};
  const nextAlarm = await chrome.alarms.get("alzaWatchRun").catch(() => null);

  const watchedProducts = Object.values(data[WATCH_PRODUCTS_KEY] || {}).filter(Boolean);
  // Poškozený záznam (null) nesmí shodit popup
  const validLists = Object.entries(lists).filter(([, list]) => list);
  const domains = new Set(
    [
      ...validLists.map(([, list]) => list.domain),
      ...watchedProducts.map((product) => product.domain),
      ...Object.values(data[TARGETS_KEY] || {}).map((target) => target?.domain),
      ...(state.recent || []).map((item) => getUrlDomain(item.url)),
    ].filter((domain) => AlzaCore.isKnownDomain(domain))
  );
  const showDomains = domains.size > 1;

  const listElement = document.getElementById("watchLists");
  listElement.replaceChildren(
    ...validLists.map(([key, list]) => {
      const link = document.createElement("a");
      if (AlzaCore.isAlzaUrl(list.url)) link.href = list.url;
      link.target = "_blank";
      link.textContent = `${list.name || list.listId || "–"} (${Object.keys(list.products || {}).length})`;
      link.title = t("listSynced", formatTime(list.syncedAt));

      const products = Object.entries(list.products || {}).map(([url, info]) => ({ url, domain: list.domain, name: info?.name, image: info?.image }));
      return createWatchGroup(`list:${key}`, link, products, { badge: createDomainBadge(list.domain, showDomains) }, createWatchSummary(products));
    })
  );

  // Produkty hlídané z detailu – název jen rozbalí seznam (správa je na stránce nastavení). Můžou být z více
  // domén – štítek pak má každý produkt
  if (productCount > 0) {
    const link = document.createElement("a");
    link.href = "#";
    link.textContent = t("watchedProducts", productCount);
    const item = createWatchGroup("products", link, watchedProducts, { productBadges: showDomains }, createWatchSummary(watchedProducts));
    link.addEventListener("click", (event) => {
      event.preventDefault();
      item.querySelector(".expand").click();
    });
    listElement.appendChild(item);
  }

  const status = document.getElementById("watchStatus");
  status.replaceChildren();
  status.classList.remove("error");
  const addLine = (text, className, icon) => {
    const line = document.createElement("div");
    line.textContent = text;
    if (className) line.className = className;
    if (icon) AlzaIcons.prepend(line, icon, { tone: icon === "warning" });
    status.appendChild(line);
    return line;
  };

  if (state.running) {
    addLine(t("running", formatTime(state.lastRunStart)), null, POPUP_ICONS.running);
  } else if (state.lastRunEnd) {
    const line = addLine(t("lastRun", formatTime(state.lastRunEnd), state.checked || 0, state.changes?.length || 0));
    // Počet cílových cen za ikonou terče
    if (targetCount) line.append(" · ", AlzaIcons.create(document, "target"), String(targetCount));
  } else {
    addLine(t("noRunYet"));
  }
  // Kdy proběhne další kontrola na pozadí (frekvence podle nastavení) – jen když je co hlídat (i jen koupené
  // zboží ve lhůtě pro vrácení – background.js getWatchedProducts)
  const now = Date.now();
  const watchingPurchases = Boolean(settings.watchPurchases) && Object.values(data[PURCHASES_KEY] || {}).some((purchase) => purchase?.returnUntil > now);
  const watching = Object.keys(lists).length > 0 || targetCount > 0 || productCount > 0 || watchingPurchases;
  if (!state.running && watching && nextAlarm?.scheduledTime) addLine(t("nextRun", formatTime(nextAlarm.scheduledTime)), null, POPUP_ICONS.nextRun);
  // Fronta notifikací: odložené v tichých hodinách a ty, které prohlížeč nepřijal (attempts = počet nepovedených
  // doručení – background.js requeueNotifications; další pokus přijde za pár minut, ne až po tichých hodinách)
  const queued = Array.isArray(state.pendingNotifications) ? state.pendingNotifications : [];
  const undelivered = queued.filter((item) => item?.attempts > 0).length;
  if (queued.length > undelivered) addLine(t("pending", queued.length - undelivered), null, POPUP_ICONS.pending);
  if (undelivered > 0) addLine(t("pendingRetry", undelivered), null, POPUP_ICONS.pendingRetry);
  const alerts = state.running ? [] : listAlerts(state.alert);
  renderAlert(alerts);
  // Název produktu s problémem je odkaz – rychle se na produkt podívat. Důvod přerušení je v upozornění nahoře
  (state.problems || []).forEach((problem) => {
    if (alerts.some((alert) => alert.message === problem.message)) return;
    if (!problem.url || !AlzaCore.isAlzaUrl(problem.url)) {
      addLine(`${problem.name}: ${problem.message}`, "watch-problem", "warning");
      return;
    }
    const line = addLine("", "watch-problem", "warning");
    const link = document.createElement("a");
    link.href = problem.url;
    link.target = "_blank";
    link.rel = "noopener";
    link.textContent = problem.name;
    line.append(link, `: ${problem.message}`);
  });
  runWatchNowButton.disabled = Boolean(state.running) || !watching;
  renderChanges(state.recent || [], showDomains);
  renderCleanup(data[CLEANUP_KEY] || {});
}

// === Přerušená kontrola ===
// Oranžový „!“ na ikoně: běh se přerušil (nepřihlášen, ceny bez DPH, Alza blokuje) a ceny se nesbírají. Nahoře,
// ať je vidět bez posouvání; po odhlášení odkaz rovnou na přihlášení (stejný jako „Přihlásit se“ v záhlaví Alzy).
// Odhlášení a ceny bez DPH se týkají jen jedné domény (ostatní se kontrolují dál) – text ji jmenuje. Víc důvodů
// najednou (dvě odhlášené domény): první ve stavu jako alert, další v alert.others – každý má svůj box (kopie prvního)
function listAlerts(alert) {
  return alert ? [alert, ...(Array.isArray(alert.others) ? alert.others : [])].filter((item) => item?.message) : [];
}

function renderAlert(alerts) {
  const notice = document.getElementById("watchAlert");
  document.querySelectorAll(".watch-alert--more").forEach((element) => element.remove());
  notice.hidden = alerts.length === 0;
  let last = notice;
  alerts.forEach((alert, index) => {
    const box = index === 0 ? notice : notice.cloneNode(true);
    // Části boxu podle id; kopie id mít nesmí (v dokumentu by byla dvakrát)
    const [text, since, login, retry] = ["Text", "Since", "Login", "Retry"].map((name) => box.querySelector(`#watchAlert${name}`));
    if (index > 0) {
      [box, text, since, login, retry].forEach((element) => element.removeAttribute("id"));
      box.classList.add("watch-alert--more");
      last.after(box);
      last = box;
    }
    text.textContent = alert.message;
    AlzaIcons.prepend(text, "warning", { tone: true });
    const perDomain = alert.reason !== "blocked" && AlzaCore.isKnownDomain(alert.domain);
    if (perDomain) setText(since, "alertSinceDomain", getHost(alert.domain), formatTime(alert.since));
    else setText(since, "alertSince", formatTime(alert.since));
    const origin = AlzaCore.domains[alert.domain]?.origin;
    login.hidden = alert.reason !== "notifyProblemNotLogged" || !origin;
    login.onclick = () => origin && chrome.tabs.create({ url: `${origin}/external/login?inherit=false&state=${crypto.randomUUID()}` });
    // Zprávu rovnou službě na pozadí – hlavní tlačítko Zkontrolovat může být zrovna vypnuté a jeho click() by neudělal nic
    retry.onclick = () => {
      runWatchNowButton.disabled = true;
      sendToBackground({ action: "watchRunNow" });
    };
  });
}

// === Návrh čistky ===
// Modré číslo na ikoně: nehlídané produkty bez kontroly přes 3 měsíce (počítá služba na pozadí).
// Mazání jen v nastavení po prohlédnutí a potvrzení, odložení skryje číslo i upozornění na měsíc
function renderCleanup(cleanup) {
  const notice = document.getElementById("cleanupNotice");
  notice.hidden = !(cleanup.count > 0) || cleanup.snoozedUntil > Date.now();
  if (notice.hidden) return;
  setText(document.getElementById("cleanupText"), "cleanupText", cleanup.count);
  notice.title = t("cleanupHint");
}

document.getElementById("cleanupReview").addEventListener("click", () =>
  chrome.tabs.create({ url: chrome.runtime.getURL("src/options/options.html#cleanup") })
);

document.getElementById("cleanupSnooze").addEventListener("click", async () => {
  try {
    await AlzaStore.run({ type: "assign", key: CLEANUP_KEY, values: { snoozedUntil: Date.now() + AlzaCore.cleanupSnoozeDays * AlzaCore.dayMs } });
    sendToBackground({ action: "cleanupRefresh" });
  } catch (error) {
    showError(error);
  }
});

// === Rozbalené seznamy ===
// Řádek seznamu / hlídaných produktů se šipkou; rozbalení ukáže produkty s cenou z poslední kontroly.
// Rozbalené zůstávají i po překreslení (kontrola na pozadí mění stav a seznamy)
const expandedGroups = new Set();

// badge = štítek domény celé skupiny (před názvem), productBadges = štítek u každého produktu
function createWatchGroup(groupKey, link, products, { badge = null, productBadges = false } = {}, ...actions) {
  const item = document.createElement("li");
  const expand = document.createElement("button");
  expand.className = "expand";
  expand.title = t("showProducts");
  item.append(...[expand, badge, link, ...actions].filter(Boolean));

  const update = () => {
    const open = expandedGroups.has(groupKey);
    expand.textContent = open ? "▼" : "▶";
    expand.setAttribute("aria-expanded", String(open));
    item.querySelector(".watch-products")?.remove();
    if (open) item.appendChild(createProductPanel(products, productBadges));
  };
  expand.addEventListener("click", () => {
    if (!expandedGroups.delete(groupKey)) expandedGroups.add(groupKey);
    update();
  });
  update();
  return item;
}

// Kolik produktů skupiny za posledních 7 dní zlevnilo / zdražilo (nejnižší cena teď proti ceně před týdnem;
// produkty s historií kratší než týden se nepočítají). Doplní se po načtení historií
const SUMMARY_DAYS = 7;

function createWatchSummary(products) {
  const summary = document.createElement("span");
  summary.className = "watch-summary";
  const valid = products.filter((product) => AlzaCore.isKnownDomain(product.domain) && AlzaCore.isAlzaUrl(product.url));
  if (valid.length === 0) return summary;

  const historyKeys = valid.map((product) => AlzaCore.getHistoryKey(product.domain, product.url));
  chrome.storage.local.get(historyKeys).then((histories) => {
    const cutoff = Date.now() - SUMMARY_DAYS * AlzaCore.dayMs;
    let down = 0;
    let up = 0;
    historyKeys.forEach((key) => {
      const history = Array.isArray(histories[key]) ? histories[key] : [];
      const before = history.filter((entry) => entry?.t <= cutoff).at(-1);
      const now = AlzaCore.getLowestPrice(history.at(-1)?.p);
      const then = AlzaCore.getLowestPrice(before?.p);
      if (now === null || then === null || now === then) return;
      if (now < then) down++;
      else up++;
    });
    summary.title = t("listSummary", down, up);
    if (down === 0 && up === 0) {
      summary.textContent = t("listNoChanges");
      return;
    }
    const part = (className, text) => {
      const element = document.createElement("span");
      element.className = className;
      element.textContent = text;
      return element;
    };
    const parts = [down > 0 && part("down", `▼ ${down}`), up > 0 && part("up", `▲ ${up}`)].filter(Boolean);
    summary.replaceChildren(...parts.flatMap((element, index) => (index ? [" ", element] : [element])));
  }).catch(showError);
  return summary;
}

function createProductPanel(products, showDomains = false) {
  const panel = document.createElement("div");
  panel.className = "watch-products";
  const valid = products.filter((product) => AlzaCore.isKnownDomain(product.domain) && AlzaCore.isAlzaUrl(product.url));
  if (valid.length === 0) {
    panel.textContent = t("noProducts");
    return panel;
  }

  const historyKeys = valid.map((product) => AlzaCore.getHistoryKey(product.domain, product.url));
  chrome.storage.local.get(historyKeys).then((histories) => {
    panel.replaceChildren(
      ...valid.map((product, index) => {
        const history = Array.isArray(histories[historyKeys[index]]) ? histories[historyKeys[index]] : [];
        const row = document.createElement("div");
        row.className = "watch-product";

        const imageUrl = AlzaCore.getProductImageUrl(product.image, 48);
        if (imageUrl) {
          const image = document.createElement("img");
          image.src = imageUrl;
          image.alt = "";
          row.appendChild(image);
        }

        const badge = createDomainBadge(product.domain, showDomains);
        if (badge) row.appendChild(badge);

        const name = AlzaCore.getLatestName(history) || product.name || product.url;
        const link = document.createElement("a");
        link.href = product.url;
        link.target = "_blank";
        link.textContent = name;
        link.title = name;
        row.appendChild(link);

        const lowest = AlzaCore.getLowestPrice(history[history.length - 1]?.p);
        const price = document.createElement("span");
        price.className = "watch-product-price";
        price.textContent = lowest === null ? "–" : AlzaCore.formatPrice(lowest, product.domain);
        row.appendChild(price);
        return row;
      })
    );
  }).catch(showError);
  return panel;
}

// Kódy a poukazy: jeden řádek s počtem poukazů z peněženky k použití (všechny Alzy) a slevových kódů u produktů
// viděných za posledních codeSeenDays dní – klik otevře záložku Kódy a poukazy v nastavení. Bez obojího se schová
async function renderCodes() {
  const { [CODES_KEY]: registry = {}, [VOUCHERS_KEY]: vouchers = {} } = await chrome.storage.local.get([CODES_KEY, VOUCHERS_KEY]);
  const now = Date.now();
  const codes = Object.values(registry && typeof registry === "object" ? registry : {}).filter(
    (entry) => entry?.code && AlzaCore.isAlzaUrl(entry.url) && now - (entry.seenAt || 0) < AlzaCore.codeSeenDays * AlzaCore.dayMs
  ).length;
  const active = Object.keys(AlzaCore.domains).reduce((sum, domain) => sum + AlzaCore.getActiveVouchers(vouchers, domain, now).length, 0);
  const link = document.getElementById("codesLink");
  link.hidden = codes === 0 && active === 0;
  if (link.hidden) return;
  link.replaceChildren();
  AlzaIcons.prepend(link, "tag");
  link.append(active > 0 ? t("codesLinkVouchers", active, codes) : t("codesLink", codes));
}

// Cashback k registraci (AlzaCore.storageKeys.cashbackReminders): koupené zboží s cashbackem, lhůta registrace,
// odkaz na podmínky akce a Hotovo (už nepřipomínat) – nejbližší lhůta nahoře
async function renderCashbacks() {
  const { [CASHBACK_REMINDERS_KEY]: reminders = {} } = await chrome.storage.local.get(CASHBACK_REMINDERS_KEY);
  // Vypnuté připomínky cashbacku v nastavení – sekce se neukazuje
  const enabled = (await AlzaCore.getSettings()).remindCashback;
  const now = Date.now();
  // Bez lhůty registrace na konec (Infinity − Infinity by dalo NaN a řazení by bylo náhodné)
  const deadline = (reminder) => (reminder.registerUntil > 0 ? reminder.registerUntil : Number.MAX_SAFE_INTEGER);
  const items = !enabled
    ? []
    : Object.entries(reminders && typeof reminders === "object" ? reminders : {})
        .filter(([, reminder]) => reminder && !reminder.done && AlzaCore.isAlzaUrl(reminder.url) && AlzaCore.getCashbackReminderStep(reminder, now) !== "expired")
        .sort(([, a], [, b]) => deadline(a) - deadline(b));
  const section = document.getElementById("cashbacks");
  section.hidden = items.length === 0;
  if (items.length === 0) return;
  document.getElementById("cashbacksTitle").textContent = t("cashbackTitle", items.length);
  const date = (time) => new Date(time).toLocaleDateString(ui.locale, { day: "numeric", month: "numeric", year: "numeric" });

  document.getElementById("cashbacksList").replaceChildren(
    ...items.map(([key, reminder]) => {
      const row = document.createElement("div");
      row.className = "change";
      const body = document.createElement("div");
      body.className = "change-body";
      const title = document.createElement("div");
      title.className = "change-title";
      const name = document.createElement("a");
      name.textContent = reminder.name || reminder.title || reminder.url;
      name.title = name.textContent;
      name.href = reminder.url;
      name.target = "_blank";
      title.appendChild(name);

      const line = document.createElement("div");
      line.className = "code-line";
      const info = document.createElement("span");
      info.className = "code-price";
      const opensLater = reminder.registerFrom > now;
      const when =
        opensLater && reminder.registerUntil
          ? t("cashbackRange", date(reminder.registerFrom), date(reminder.registerUntil))
          : opensLater
            ? t("cashbackFrom", date(reminder.registerFrom))
            : reminder.registerUntil
              ? t("cashbackUntil", date(reminder.registerUntil))
              : t("cashbackNoDate");
      info.textContent = [reminder.refund > 0 ? t("cashbackRefund", AlzaCore.formatPrice(reminder.refund, reminder.domain)) : null, when].filter(Boolean).join(" · ");
      line.appendChild(info);
      if (AlzaCore.isAlzaUrl(reminder.terms)) {
        const terms = document.createElement("a");
        terms.className = "cashback-terms";
        terms.textContent = t("cashbackTerms");
        terms.href = reminder.terms;
        terms.target = "_blank";
        line.appendChild(terms);
      }
      const done = document.createElement("button");
      done.type = "button";
      done.className = "code-copy";
      done.textContent = t("cashbackDone");
      done.title = t("cashbackDoneTitle");
      done.addEventListener("click", () => {
        done.disabled = true;
        // existingOnly: připomínku mezitím smazanou službou na pozadí (lhůta prošla) nevytvoří znovu
        AlzaStore.run({ type: "patchMap", key: CASHBACK_REMINDERS_KEY, merge: { [key]: { done: true } }, existingOnly: true }).catch((error) => {
          // Zápis selhal – připomínka zůstává, tlačítko musí jít použít znovu
          done.disabled = false;
          showError(error);
        });
      });
      line.appendChild(done);
      body.append(title, line);
      row.appendChild(body);
      return row;
    })
  );
}

function renderChanges(recent, showDomains = false) {
  const section = document.getElementById("changes");
  section.hidden = recent.length === 0;
  if (recent.length === 0) return;

  const newCount = recent.filter((item) => newChangeKeys.has(item.key)).length;
  document.getElementById("changesTitle").textContent = newCount > 0 ? t("changesNew", newCount) : t("changesRecent");

  const link = (url, text) => {
    const element = document.createElement("a");
    element.textContent = text;
    if (AlzaCore.isAlzaUrl(url)) {
      element.href = url;
      element.target = "_blank";
    }
    return element;
  };

  document.getElementById("changesList").replaceChildren(
    ...recent.map((item) => {
      const row = document.createElement("div");
      const lines = item.lines.map((text) => AlzaCore.upgradePriceDropText(text, item.url));
      // Druh změny: core.js getChangeTone (stejný určuje barvu čísla na ikoně)
      const tones = lines.map((text) => AlzaCore.getChangeTone(text));
      // Nová změna (číslo na ikoně) má řádek podbarvený podle první změny ceny / dostupnosti (výstraha ho
      // neurčuje); viděné zůstávají bílé a druh změny ukazuje jen barva textu
      const tone = newChangeKeys.has(item.key) && tones.find((value) => value && value !== "warning");
      row.className = tone ? `change change--${tone}` : "change";

      const imageUrl = AlzaCore.getProductImageUrl(item.image, 80);
      if (imageUrl) {
        const image = document.createElement("img");
        image.src = imageUrl;
        image.alt = "";
        row.appendChild(image);
      }

      const body = document.createElement("div");
      body.className = "change-body";
      const title = document.createElement("div");
      title.className = "change-title";
      const name = link(item.url, item.name);
      name.title = item.name;
      title.appendChild(name);
      if (item.price) {
        const price = document.createElement("span");
        price.className = "change-price";
        price.textContent = item.price;
        title.appendChild(price);
      }
      body.appendChild(title);

      lines.forEach((text, index) => {
        const line = document.createElement("div");
        line.className = tones[index] ? `change-line change-line--${tones[index]}` : "change-line";
        // Výstraha / cílová cena s ikonou (starší uložené řádky mají místo ní emoji na začátku textu)
        line.textContent = AlzaCore.stripChangeEmoji(text);
        const icon = AlzaCore.getChangeIcon(text);
        if (icon) AlzaIcons.prepend(line, icon, { tone: true });
        body.appendChild(line);
      });

      const meta = document.createElement("div");
      meta.className = "change-meta";
      const badge = createDomainBadge(getUrlDomain(item.url), showDomains);
      if (badge) meta.append(badge, " ");
      meta.append(formatTime(item.at));
      if (item.listName) meta.append(" · ", link(item.listUrl, item.listName));
      body.appendChild(meta);

      row.appendChild(body);
      return row;
    })
  );
}

toggleWatchButton.addEventListener("click", async () => {
  if (!watchState?.listId) return;
  toggleWatchButton.disabled = true;
  const next = await sendToActiveTab({ action: "setWatch", enabled: !watchState.watched });
  if (!next) showError(t("watchList"));
  watchState = next || watchState;
  renderToggle();
});

runWatchNowButton.addEventListener("click", () => {
  runWatchNowButton.disabled = true;
  sendToBackground({ action: "watchRunNow" });
});

chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area === "local" && (changes[CODES_KEY] || changes[VOUCHERS_KEY])) renderCodes().catch(showError);
  if (area === "local" && (changes[CASHBACK_REMINDERS_KEY] || changes[SETTINGS_KEY])) renderCashbacks().catch(showError);
  if (area !== "local" || ![WATCH_LISTS_KEY, WATCH_STATE_KEY, TARGETS_KEY, WATCH_PRODUCTS_KEY, CLEANUP_KEY, PURCHASES_KEY, SETTINGS_KEY].some((key) => changes[key])) return;
  // Změny z kontroly doběhlé při otevřeném popupu (např. tlačítko Zkontrolovat) – zvýraznit a hned označit viděné
  const unseen = changes[WATCH_STATE_KEY]?.newValue?.unseen || [];
  // I znovu změněný, už zvýrazněný produkt – jinak by po zavření zůstalo číslo na ikoně (markSeen zapíše [] → bez smyčky)
  if (unseen.length > 0) {
    unseen.forEach((key) => newChangeKeys.add(key));
    sendToBackground({ action: "watchSeen" });
  }
  renderWatch().catch(showError);
  if (changes[WATCH_LISTS_KEY]) {
    watchState = (await sendToActiveTab({ action: "getWatchState" })) || watchState;
    renderToggle();
  }
});

(async () => {
  // Jazyk zvolený v nastavení – před prvním vykreslením
  const settings = await AlzaCore.getSettings();
  uiLanguage = AlzaCore.getUiLanguage(settings);
  ui = UI_LANGUAGES[uiLanguage];
  applyStaticTexts();
  renderNews().catch(showError);

  // Otevřený popup = změny viděny – vynulovat číslo na ikoně, ale v přehledu je nechat zvýrazněné
  const { [WATCH_STATE_KEY]: initialState = {} } = await chrome.storage.local.get(WATCH_STATE_KEY);
  newChangeKeys = new Set([...newChangeKeys, ...(initialState.unseen || [])]);
  sendToBackground({ action: "watchSeen" });
  activeDomain = await getActiveTabDomain();
  watchState = await sendToActiveTab({ action: "getWatchState" });
  renderToggle();
  // Každá sekce zvlášť – chyba jedné (stav kontroly, trezor kódů, cashbacky) nesmí schovat ostatní
  await Promise.all([renderWatch().catch(showError), renderCodes().catch(showError), renderCashbacks().catch(showError)]);
})().catch(showError);
