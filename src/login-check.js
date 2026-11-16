// Content script: kontrola hned po přihlášení. Poslední kontrola na pozadí skončila „nejste přihlášeni“ (oranžový
// „!“) a tahle stránka Alzy ukazuje přihlášeného uživatele → služba na pozadí kontrolu zopakuje hned, ne až
// v dalším plánovaném běhu. Jen zpráva – stav, okno (anonymní / kontejner) i omezení opakování ověřuje služba
// na pozadí (background.js retryAfterLogin)
const AlzaLoginCheck = {
  // Záhlaví s přihlášením kreslí Alza až po načtení stránky – přihlášení se zkusí poznat víckrát
  delaysMs: [0, 2000, 5000],

  async init() {
    if (!AlzaCore.isContextAlive()) return;
    const domain = AlzaCore.getDomainKey(window.location.hostname);
    const key = AlzaCore.storageKeys.watchState;
    const { [key]: state } = await chrome.storage.local.get(key);
    // Na běžné stránce (bez přerušené kontroly na této doméně) nic dalšího – jedno čtení storage. Odhlášených domén
    // může být víc: první upozornění a za ním další (alert.others)
    const alerts = state?.alert ? [state.alert, ...(Array.isArray(state.alert.others) ? state.alert.others : [])] : [];
    if (!alerts.some((alert) => alert?.reason === "notifyProblemNotLogged" && alert.domain === domain)) return;
    for (const delay of this.delaysMs) {
      await new Promise((resolve) => setTimeout(resolve, delay));
      if (!AlzaCore.isContextAlive()) return;
      if (AlzaCore.getLoginState(document) !== true) continue;
      await chrome.runtime.sendMessage({ action: "watchLoginSeen", domain });
      return;
    }
  },
};

AlzaLoginCheck.init().catch((error) => console.error("AllyZap – kontrola po přihlášení:", error));
