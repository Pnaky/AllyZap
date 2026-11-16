// Stránka nastavení – záložka „Kódy a poukazy“: peněženka poukazů (storageKeys.vouchers – vlastní slevové kódy a dárkové
// poukazy; přidání vložením textu e-mailu, úprava, ruční „použito“, smazání) a pod ní slevové kódy u produktů
// (storageKeys.codes – dřív trezor v popupu). Načítá se za options.js a používá jeho pomocné funkce (t, cell,
// productLink, smallButton, createSortableTable, sortItems, setTabCount, nameFromUrl, showActionError, formatDate)

const VOUCHERS_KEY = AlzaCore.storageKeys.vouchers;
const PRODUCT_CODES_KEY = AlzaCore.storageKeys.codes;
const voucherForm = document.getElementById("voucherForm");
const voucherPaste = document.getElementById("voucherPaste");
const voucherInfo = document.getElementById("voucherInfo");
const voucherFilter = document.getElementById("voucherFilter");
const vouchersView = { sort: "until", desc: false };
const productCodesView = { sort: "seen", desc: true };
const voucherSubmit = document.getElementById("voucherAdd");
const voucherCancel = document.getElementById("voucherCancel");
// Id upravovaného poukazu. Uložení pod stejným kódem a Alzou ho upraví (stav „použitý“, číslo objednávky a připomínky
// zůstanou); s jiným kódem vznikne nový poukaz a původní zůstane beze změny – smazat ho jde jen tlačítkem v tabulce
let editingVoucher = null;
let voucherInfoTimer = null;

const VOUCHER_COLUMNS = [
  { label: "colCode", key: "code", text: true, value: ({ voucher }) => voucher.code },
  { label: "colVoucherValue", key: "value", value: ({ voucher }) => (voucher.kind === "percent" ? -voucher.value : voucher.value) },
  { label: "colVoucherUntil", key: "until", value: ({ voucher }) => voucher.until || null },
  { label: "colVoucherNote", key: "note", text: true, value: ({ voucher }) => (voucher.note || "").toLowerCase() || null },
  { label: "colVoucherState", key: "state", text: true, value: ({ state }) => state.state },
  { label: "" },
];

const PRODUCT_CODE_COLUMNS = [
  { label: "colProduct", key: "name", text: true, value: (row) => row.name.toLowerCase() },
  { label: "colCode", key: "code", text: true, value: (row) => row.entry.code },
  { label: "colCodePrice", key: "price", value: (row) => (Number.isFinite(row.entry.price) ? row.entry.price : null) },
  { label: "colCodeSeen", key: "seen", value: (row) => row.entry.seenAt || 0 },
];

// Kód s tlačítkem Kopírovat (po zkopírování na chvíli „Zkopírováno“)
function codeWithCopy(code) {
  const wrap = document.createElement("span");
  wrap.className = "code-cell";
  const value = Object.assign(document.createElement("code"), { textContent: code });
  const copy = smallButton(t("codeCopy"), t("codeCopy"), async () => {
    try {
      await navigator.clipboard.writeText(code);
      copy.textContent = t("codeCopied");
      setTimeout(() => (copy.textContent = t("codeCopy")), 1500);
    } catch {
      const range = document.createRange();
      range.selectNodeContents(value);
      getSelection().removeAllRanges();
      getSelection().addRange(range);
    }
  });
  wrap.append(value, copy);
  return wrap;
}

// Datum z políčka typu date („2027-01-21“) → konec dne v místním čase a zpět
const dateToInput = (time) => {
  const date = new Date(time);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

function updateVoucherUnit() {
  const percent = voucherForm.unit.value === "percent";
  voucherForm.querySelector("[data-percent-domain]").hidden = !percent;
}

function fillVoucherForm(voucher) {
  voucherForm.code.value = voucher.code || "";
  voucherForm.value.value = voucher.value ?? "";
  voucherForm.unit.value = voucher.kind === "percent" ? "percent" : voucher.domain || voucherForm.unit.value;
  if (voucher.domain) voucherForm.domain.value = voucher.domain;
  voucherForm.until.value = voucher.until ? dateToInput(voucher.until) : "";
  voucherForm.minOrder.value = voucher.minOrder ?? "";
  voucherForm.note.value = voucher.note || "";
  updateVoucherUnit();
}

// Zpráva u formuláře; seconds = po kolika sekundách zmizí (0 = zůstane do další zprávy)
function showVoucherInfo(seconds, key, ...params) {
  clearTimeout(voucherInfoTimer);
  if (key) setText(voucherInfo, key, ...params);
  else voucherInfo.textContent = "";
  if (key && seconds > 0) voucherInfoTimer = setTimeout(() => (voucherInfo.textContent = ""), seconds * 1000);
}

// Tlačítka formuláře podle toho, jestli se upravuje poukaz: „Uložit změny“ a Zrušit úpravu, jinak „Přidat poukaz“.
// Klíč textu se zapisuje i do data-i18n – po změně jazyka ho applyStaticTexts (options.js) vypíše znovu správně
function setVoucherEditing(id) {
  editingVoucher = id;
  voucherSubmit.dataset.i18n = id ? "voucherSave" : "voucherAdd";
  setText(voucherSubmit, voucherSubmit.dataset.i18n);
  voucherCancel.hidden = !id;
}

// Platnost v minulosti (konec zadaného dne už uplynul) – poukaz by po uložení zmizel z výchozího filtru „k použití“
const isPastVoucherDate = (until) => Number.isFinite(until) && until < Date.now();

function resetVoucherForm() {
  setVoucherEditing(null);
  voucherForm.reset();
  voucherPaste.value = "";
  // Výchozí doména = hlavní Alza z nastavení
  AlzaCore.getSettings()
    .then((settings) => {
      const domain = AlzaCore.getPrimaryDomain(settings);
      voucherForm.unit.value = domain;
      voucherForm.domain.value = domain;
      updateVoucherUnit();
    })
    .catch(() => {});
}

async function loadVouchers() {
  const { [VOUCHERS_KEY]: stored } = await chrome.storage.local.get(VOUCHERS_KEY);
  return stored && typeof stored === "object" ? stored : {};
}

async function renderVouchers() {
  const container = document.getElementById("vouchersTable");
  const vouchers = await loadVouchers();
  const now = Date.now();
  const rows = Object.entries(vouchers)
    .filter(([, voucher]) => voucher?.code && isKnownDomain(voucher.domain))
    .map(([id, voucher]) => ({ id, voucher, state: AlzaCore.getVoucherState(voucher, now) }));
  setTabCount("countCodes", rows.filter(({ state }) => state.state === "active").length);
  const filter = voucherFilter.value;
  const shown = rows.filter(({ state }) => filter === "all" || (filter === "active" ? state.state === "active" : state.state !== "active"));
  if (shown.length === 0) {
    container.replaceChildren(Object.assign(document.createElement("p"), { className: "empty", textContent: rows.length === 0 ? t("vouchersEmpty") : t("noneYet") }));
    return;
  }
  const table = createSortableTable(VOUCHER_COLUMNS, vouchersView, () => renderVouchers().catch(showActionError));
  table.classList.add("vouchers-table");
  const body = table.createTBody();
  // Doména jen když jsou v peněžence poukazy z víc Alz – jinak by jen zabírala místo
  const manyDomains = new Set(rows.map(({ voucher }) => voucher.domain)).size > 1;
  sortItems(shown, VOUCHER_COLUMNS, vouchersView).forEach(({ id, voucher, state }) => {
    const row = body.insertRow();
    if (state.state !== "active") row.className = "muted-row";
    cell(row, codeWithCopy(voucher.code));
    const value = [AlzaCore.formatVoucherValue(voucher), voucher.minOrder ? t("voucherMinOrderShort", AlzaCore.formatPrice(voucher.minOrder, voucher.domain)) : null]
      .filter(Boolean)
      .join(" · ");
    cell(row, manyDomains ? `${value} · ${AlzaCore.domains[voucher.domain].origin.replace("https://www.", "")}` : value);
    const until = voucher.until ? formatDate(voucher.until) : t("voucherNoDate");
    const soon = state.state === "active" && state.daysLeft !== null && state.daysLeft <= AlzaCore.voucherSoonDays;
    cell(
      row,
      state.state !== "active" || state.daysLeft === null ? until : state.daysLeft <= 1 ? t("voucherLastDay", until) : t("voucherDaysLeft", until, AlzaCore.formatDays(ui.lang, state.daysLeft)),
      soon ? "voucher-soon" : null
    );
    cell(row, voucher.note || "–", "voucher-note-cell").title = voucher.note || "";
    const stateCell = cell(row, state.state === "used" ? t("voucherStateUsed", formatDate(voucher.usedAt)) : t(state.state === "expired" ? "voucherStateExpired" : "voucherStateActive"));
    const orderUrl = voucher.usedOrder ? AlzaCore.getOrderUrl(voucher.domain, voucher.usedOrder) : null;
    if (orderUrl) {
      stateCell.append(" ");
      stateCell.appendChild(productLink(orderUrl, t("voucherOrder")));
    }

    const actions = document.createElement("span");
    actions.className = "row-actions";
    const patch = (merge) => AlzaStore.run({ type: "patchMap", key: VOUCHERS_KEY, merge: { [id]: merge }, existingOnly: true }).catch(showActionError);
    if (state.state === "used") actions.appendChild(smallButton(t("voucherMarkUnused"), t("voucherMarkUnused"), () => patch({ usedAt: null, usedOrder: null, applied: null })));
    else actions.appendChild(smallButton(t("voucherMarkUsed"), t("voucherMarkUsed"), () => patch({ usedAt: Date.now() })));
    actions.appendChild(
      smallButton(t("voucherEdit"), t("voucherEdit"), () => {
        setVoucherEditing(id);
        voucherPaste.value = "";
        fillVoucherForm(voucher);
        showVoucherInfo(0, isPastVoucherDate(voucher.until) ? "voucherPastDate" : null);
        voucherForm.scrollIntoView({ block: "nearest" });
        voucherForm.code.focus();
      })
    );
    actions.appendChild(
      smallButton(t("voucherDelete"), t("voucherDelete"), () => {
        if (confirm(t("voucherDeleteConfirm", voucher.code))) AlzaStore.run({ type: "patchMap", key: VOUCHERS_KEY, remove: [id] }).catch(showActionError);
      })
    );
    cell(row, actions);
  });
  container.replaceChildren(table);
}

// Slevové kódy u produktů (dřív trezor v popupu): kódy viděné za posledních codeSeenDays dní, nejnovější nahoře
async function renderProductCodes() {
  const container = document.getElementById("productCodesTable");
  const { [PRODUCT_CODES_KEY]: registry = {}, [AlzaCore.storageKeys.browsed]: browsed = {}, [AlzaCore.storageKeys.watchProducts]: watched = {} } =
    await chrome.storage.local.get([PRODUCT_CODES_KEY, AlzaCore.storageKeys.browsed, AlzaCore.storageKeys.watchProducts]);
  const now = Date.now();
  const rows = Object.entries(registry && typeof registry === "object" ? registry : {})
    .filter(([, entry]) => entry?.code && AlzaCore.isAlzaUrl(entry.url) && now - (entry.seenAt || 0) < AlzaCore.codeSeenDays * AlzaCore.dayMs)
    .map(([key, entry]) => ({ key, entry, name: browsed[key]?.name || watched[key]?.name || nameFromUrl(entry.url) }));
  if (rows.length === 0) {
    container.replaceChildren(Object.assign(document.createElement("p"), { className: "empty", textContent: t("productCodesEmpty") }));
    return;
  }
  const table = createSortableTable(PRODUCT_CODE_COLUMNS, productCodesView, () => renderProductCodes().catch(showActionError));
  const body = table.createTBody();
  sortItems(rows, PRODUCT_CODE_COLUMNS, productCodesView).forEach(({ entry, name }) => {
    const row = body.insertRow();
    cell(row, productLink(entry.url, name));
    cell(row, codeWithCopy(entry.code));
    cell(row, Number.isFinite(entry.price) ? AlzaCore.formatPrice(entry.price, entry.domain) : "–");
    cell(row, entry.seenAt ? formatDate(entry.seenAt) : "–");
  });
  container.replaceChildren(table);
}

// Vložený text e-mailu → políčka formuláře (uloží se až tlačítkem). Co rozbor nenašel nebo si jím není jistý, zůstane
// prázdné – kód ani částka se nemíchají s tím, co ve formuláři zbylo z předchozího textu
voucherPaste.addEventListener("input", () => {
  const text = voucherPaste.value.trim();
  if (!text) return;
  const parsed = AlzaCore.parseVoucherText(text);
  if (!parsed.code && !parsed.value) {
    showVoucherInfo(0, "voucherParseNothing");
    return;
  }
  fillVoucherForm({
    code: parsed.code || "",
    value: parsed.value ?? "",
    kind: parsed.kind,
    domain: parsed.domain || (voucherForm.unit.value === "percent" ? voucherForm.domain.value : voucherForm.unit.value),
    until: parsed.until,
    minOrder: parsed.minOrder,
    note: voucherForm.note.value,
  });
  showVoucherInfo(0, isPastVoucherDate(parsed.until) ? "voucherPastDate" : parsed.moreCodes ? "voucherParsedMore" : "voucherParsed");
});

voucherForm.unit.addEventListener("change", updateVoucherUnit);

// Ručně zadaná platnost v minulosti – upozornit hned, ne až po uložení
voucherForm.until.addEventListener("change", () => {
  const until = voucherForm.until.value ? AlzaCore.parseVoucherDate(voucherForm.until.value) : null;
  showVoucherInfo(0, isPastVoucherDate(until) ? "voucherPastDate" : null);
});

voucherCancel.addEventListener("click", () => {
  resetVoucherForm();
  showVoucherInfo(0, null);
});

voucherForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const percent = voucherForm.unit.value === "percent";
  const domain = percent ? voucherForm.domain.value : voucherForm.unit.value;
  const until = voucherForm.until.value ? AlzaCore.parseVoucherDate(voucherForm.until.value) : null;
  const id = AlzaCore.getVoucherId(domain, voucherForm.code.value);
  const vouchers = await loadVouchers();
  // Stav (použitý, číslo objednávky, uplatnění v košíku, odeslané připomínky) patří kódu: dědí se jen při úpravě
  // téhož poukazu. Po změně kódu nebo Alzy je to nový poukaz – a původní se nemaže
  const edited = editingVoucher && Object.hasOwn(vouchers, editingVoucher) ? vouchers[editingVoucher] : null;
  const previous = edited && editingVoucher === id ? edited : null;
  const voucher = AlzaCore.sanitizeVoucher({
    ...(previous || {}),
    code: voucherForm.code.value,
    domain,
    kind: percent ? "percent" : "amount",
    value: voucherForm.value.value,
    until,
    minOrder: voucherForm.minOrder.value,
    note: voucherForm.note.value,
    // Jiná platnost = připomínky znovu
    ...(previous && previous.until !== until && { notifiedSoon: false, notifiedLast: false }),
  });
  if (!voucher) {
    showVoucherInfo(0, "voucherInvalid");
    return;
  }
  try {
    await AlzaStore.run({ type: "patchMap", key: VOUCHERS_KEY, set: { [id]: voucher } });
    resetVoucherForm();
    if (edited && !previous) showVoucherInfo(15, "voucherSavedAsNew", edited.code);
    else if (isPastVoucherDate(voucher.until)) showVoucherInfo(15, "voucherAddedPast", t("voucherFilterDone"));
    else showVoucherInfo(2, "voucherAdded");
  } catch (error) {
    showActionError(error);
  }
});

voucherFilter.addEventListener("change", () => renderVouchers().catch(showActionError));

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes[VOUCHERS_KEY]) renderVouchers().catch(showActionError);
  if (changes[PRODUCT_CODES_KEY]) renderProductCodes().catch(showActionError);
});

resetVoucherForm();
renderVouchers().catch((error) => console.error("Poukazy se nepodařilo načíst:", error));
renderProductCodes().catch((error) => console.error("Slevové kódy se nepodařilo načíst:", error));
