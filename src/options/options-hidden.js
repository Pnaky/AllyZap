// Stránka nastavení – záložka „Skryté ve výpisech“: značky (storageKeys.hiddenBrands) a produkty (storageKeys.hidden),
// které uživatel skryl ve výpisech kategorií a ve vyhledávání (src/listing-memory.js). Bez přehledu šel skrytý produkt
// vrátit jen přes „Zobrazit skryté“ ve výpisu, kde zrovna je – tady je vidět všechno skryté a jde to vrátit.
// Načítá se za options.js a používá jeho pomocné funkce (t, cell, productLink, smallButton, createSortableTable,
// sortItems, setTabCount, nameFromUrl, showActionError, formatDate)

const HIDDEN_PRODUCTS_KEY = AlzaCore.storageKeys.hidden;
const HIDDEN_BRANDS_KEY = AlzaCore.storageKeys.hiddenBrands;
// Nejnověji skryté nahoře
const hiddenBrandsView = { sort: "at", desc: true };
const hiddenProductsView = { sort: "at", desc: true };

const HIDDEN_BRAND_COLUMNS = [
  { label: "colBrand", key: "name", text: true, value: (row) => row.name.toLowerCase() },
  { label: "colHiddenAt", key: "at", value: (row) => row.at || null },
  { label: "" },
];

const HIDDEN_PRODUCT_COLUMNS = [
  { label: "colProduct", key: "name", text: true, value: (row) => row.name.toLowerCase() },
  { label: "colHiddenDomain", key: "domain", text: true, value: (row) => row.site },
  { label: "colHiddenAt", key: "at", value: (row) => row.at || null },
  { label: "" },
];

// Záznamy uložené mapy jako [klíč, objekt]; cokoli jiného (poškozená data) se přeskočí
const hiddenEntries = (map) => Object.entries(map && typeof map === "object" ? map : {}).filter(([, item]) => item && typeof item === "object");
const hiddenText = (value) => (typeof value === "string" && value.trim() ? value.trim() : null);

// Tlačítko „Znovu ukazovat“: smaže záznam (zápis přes službu na pozadí); tabulku překreslí změna úložiště.
// Název a přístupný název nesou i to, čeho se tlačítko týká – v tabulce jich je tolik, kolik řádků
function hiddenShowButton(storageKey, key, name) {
  const title = t("hiddenShowTitle", name);
  const button = smallButton(t("hiddenShow"), title, () => AlzaStore.run({ type: "patchMap", key: storageKey, remove: [key] }).catch(showActionError));
  button.setAttribute("aria-label", title);
  return AlzaIcons.prepend(button, "visibility");
}

function renderHiddenTable(containerId, columns, view, rows, fillRow) {
  const table = createSortableTable(columns, view, () => renderHidden().catch(showActionError));
  const body = table.createTBody();
  sortItems(rows, columns, view).forEach((item) => fillRow(body.insertRow(), item));
  document.getElementById(containerId).replaceChildren(table);
}

async function renderHidden() {
  const { [HIDDEN_PRODUCTS_KEY]: hidden, [HIDDEN_BRANDS_KEY]: hiddenBrands } = await chrome.storage.local.get([HIDDEN_PRODUCTS_KEY, HIDDEN_BRANDS_KEY]);
  const brands = hiddenEntries(hiddenBrands).map(([key, item]) => ({ key, name: hiddenText(item.name) || key, at: Number(item.at) || 0 }));
  // Produkt skrývá už sám klíč (AlzaCore.isHiddenListing) – ukáže se i záznam bez názvu nebo adresy, ať jde vrátit
  const products = hiddenEntries(hidden).map(([key, item]) => {
    const url = hiddenText(item.url);
    const origin = AlzaCore.domains[item.domain]?.origin;
    return { key, url, name: hiddenText(item.name) || (url ? nameFromUrl(url) : key), site: origin ? origin.replace("https://www.", "") : "–", at: Number(item.at) || 0 };
  });

  setTabCount("countHidden", brands.length + products.length);
  document.getElementById("hiddenEmpty").hidden = brands.length + products.length > 0;
  document.getElementById("hiddenBrands").hidden = brands.length === 0;
  document.getElementById("hiddenProducts").hidden = products.length === 0;
  document.getElementById("hiddenBrandsTitle").textContent = t("hiddenBrandsTitle", brands.length);
  document.getElementById("hiddenProductsTitle").textContent = t("hiddenProductsTitle", products.length);

  renderHiddenTable("hiddenBrandsTable", HIDDEN_BRAND_COLUMNS, hiddenBrandsView, brands, (row, brand) => {
    cell(row, brand.name);
    cell(row, brand.at ? formatDate(brand.at) : "–");
    cell(row, hiddenShowButton(HIDDEN_BRANDS_KEY, brand.key, brand.name));
  });
  renderHiddenTable("hiddenProductsTable", HIDDEN_PRODUCT_COLUMNS, hiddenProductsView, products, (row, product) => {
    cell(row, product.url ? productLink(product.url, product.name) : product.name);
    cell(row, product.site);
    cell(row, product.at ? formatDate(product.at) : "–");
    cell(row, hiddenShowButton(HIDDEN_PRODUCTS_KEY, product.key, product.name));
  });
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && (changes[HIDDEN_PRODUCTS_KEY] || changes[HIDDEN_BRANDS_KEY])) renderHidden().catch(showActionError);
});

renderHidden().catch((error) => console.error("Skryté produkty a značky se nepodařilo načíst:", error));
