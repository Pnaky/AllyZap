<p align="center">
  <img src="docs/images/hero-cs.png" alt="AllyZap – historie cen, kontrola podezřelých slev a skutečná cena za kus přímo na Alze" width="100%">
</p>

<p align="center">
  <a href="https://chromewebstore.google.com/detail/allyzap/ndaheikijjhppooeiioljekolkekfgie"><img src="https://img.shields.io/badge/Chrome-Nainstalovat_zdarma-4285F4?style=for-the-badge&logo=googlechrome&logoColor=white" alt="Nainstalovat do Chrome"></a>
  &nbsp;
  <a href="https://addons.mozilla.org/firefox/addon/allyzap/"><img src="https://img.shields.io/badge/Firefox-Nainstalovat_zdarma-FF7139?style=for-the-badge&logo=firefoxbrowser&logoColor=white" alt="Nainstalovat do Firefoxu"></a>
</p>

<p align="center">
  <a href="https://chromewebstore.google.com/detail/allyzap/ndaheikijjhppooeiioljekolkekfgie"><img src="https://img.shields.io/chrome-web-store/v/ndaheikijjhppooeiioljekolkekfgie?label=verze" alt="Verze v Chrome Web Store"></a>
  <img src="https://img.shields.io/badge/alza-.cz_·_.sk_·_.hu-2c3e50" alt="alza.cz, alza.sk, alza.hu">
  <img src="https://img.shields.io/badge/jazyky-CZ_·_SK_·_HU_·_EN-2c3e50" alt="Čeština, slovenština, maďarština, angličtina">
  <a href="LICENSE"><img src="https://img.shields.io/badge/licence-GPL--3.0-blue" alt="Licence GPL-3.0"></a>
  <a href="#jak-projekt-vzniká"><img src="https://img.shields.io/badge/vyvíjeno_s-Claude_Code-D97757?logo=claude&logoColor=white" alt="Vyvíjeno s Claude Code"></a>
  <a href="#jak-projekt-vzniká"><img src="https://img.shields.io/badge/code_review-Gemini-8E75B2?logo=googlegemini&logoColor=white" alt="Code review: Gemini"></a>
</p>

**AllyZap** je rozšíření pro Chrome a Firefox (experimentálně i Safari na Macu), které vám na Alze řekne, jestli je cena opravdu výhodná. Ukazuje historii cen, hlídá vaše nákupní seznamy na pozadí, upozorní na podezřelé slevy a spočítá skutečnou cenu za kus. Funguje na alza.cz, alza.sk a alza.hu.

> **Neoficiální projekt.** Rozšíření nemá žádnou vazbu na Alza.cz a.s. Název „Alza“ je ochranná známka svého vlastníka a je zde použit jen k označení webu, se kterým rozšíření pracuje.

**Obsah:** [Co umí](#co-umí) · [Jak to vypadá](#jak-to-vypadá) · [Jak začít](#jak-začít) · [Nastavení](#nastavení) · [Časté otázky](#časté-otázky) · [Soukromí](#soukromí) · [English](#english) · [Pro vývojáře](#pro-vývojáře)

## Co umí

- 📈 **Historie cen** v nákupních seznamech a na detailu produktu, včetně grafu s typy cen, dostupností a minimem/maximem.
- 🔔 **Hlídání seznamů na pozadí** s notifikacemi při změně ceny. Počet změn se zobrazuje na ikoně rozšíření. Obsah hlídaného seznamu se před každou kontrolou načte z Alzy, takže se hlídají i položky přidané třeba v mobilní aplikaci a odebrané se přestanou kontrolovat. Když se kontrola přeruší (nejste na Alze přihlášeni, ceny bez DPH, Alza blokuje), na ikoně svítí oranžový „!“ a po přihlášení se kontrola spustí hned.
- 🎯 **Cílová cena** u hlídaných produktů, a to i cílová cena za kus.
- ⚠️ **Podezřelé slevy:** porovnání přeškrtnuté ceny s obvyklou cenou a hodnocení, jestli je aktuální cena opravdu výhodná.
- ⏳ **Vyplatí se počkat?** Rytmus akcí: jak často a o kolik produkt obvykle zlevňuje.
- 📅 **Loni touhle dobou:** u produktu s historií delší než rok uvidíte na detailu i v košíku, jestli loni v následujícím měsíci zlevnil (třeba před Black Friday).
- 🗣️ **Recenze naruby** na detailu produktu: co lidem vadí (slova, která se opakují v záporech recenzí), jak se hodnocení vyvíjí a nejkritičtější recenze z ověřených nákupů.
- 📦 **Stejný produkt levněji:** upozornění na rozbalený nebo zánovní kus.
- 🧾 **Lišta nákupního seznamu** se souhrnem, filtry a řazením.
- 🧮 **Skutečná cena za kus** v kategoriích, v nákupním seznamu i na detailu produktu (i se slevou AlzaPlus+) a řazení celé kategorie podle ní.
- 📏 **Cena za parametr** ve výpisech kategorií, kde Alza cenu za jednotku neuvádí: Kč/TB u disků, Kč/GB u pamětí, flash disků a paměťových karet, Kč/1000 mAh u powerbank a Kč/Wh u nabíjecích stanic. Řadí podle ní záložka „Za jednotku“.
- ⚡ **Cena provozu spotřebičů:** odhad ceny elektřiny u lednic, mrazáků, praček a sušiček ve výpisech kategorií, na detailu produktu i u televizí, monitorů a myček. Počítá ze spotřeby a z ceny elektřiny, kterou zadáte v nastavení; záložka „S provozem“ seřadí výpis podle pořizovací ceny a provozu dohromady. Ve výpisech televizí a monitorů ji doplní tlačítko **Spočítat provoz** – spotřebu načte ze stránek produktů (nejvýš 48 na jedno kliknutí).
- 🏷️ **Filtr slev v kategoriích:** „Sleva aspoň X %“, „Jen s kupónem“ a „S množstevní slevou“ v levém panelu filtrů – i se slevovým kódem a AlzaPlus+, proti obvyklé ceně z historie. Velký výpis se sám nenačítá celý: filtr projde načtené produkty a další přidá tlačítko „Načíst dalších 480“.
- 👁️ **Paměť prohlížení** ve výpisech: „prohlédnuto“ u produktů, jejichž detail jste už otevřeli, vlastní poznámka k produktu a skrytí produktu nebo celé značky.
- 🎟️ **Slevové kódy u produktů:** kódy z produktů, které jste viděli, s cenou po slevě a tlačítkem Kopírovat – v záložce **Kódy a poukazy** na stránce rozšíření; v popupu je jejich počet.
- 🎁 **Peněženka poukazů:** vlastní slevové kódy a dárkové poukazy (stačí vložit text e-mailu, kód, částka a platnost se vyplní samy). V košíku je rozšíření nabídne k vložení a ukáže, kolik chybí do minimální objednávky, před koncem platnosti je připomene a použitý poukaz pozná z objednávky.
- 🛒 **Košík:** hodnocení ceny u každé položky, souhrn nad položkami (kolik je nad a pod obvyklou cenou, kde se vyplatí počkat, podezřelé slevy), „Už máte“ u zboží, které jste už koupili, tip „+1 ks → nižší cena za kus“ u množstevní slevy a upozornění, když chybí slevový kód. Ze seznamu jde zboží do košíku i s kódem. Volitelný **měsíční rozpočet** ukáže, kolik jste tento měsíc utratili, kolik to bude s košíkem a kolik zbývá.
- ↩️ **Hlídání po nákupu:** když koupené zboží do 14 dní zlevní, dozvíte se, že ho můžete vrátit a koupit levněji. Nové objednávky se načtou při návštěvě Alzy i při kontrole na pozadí; v přehledu změn je u koupeného zboží odkaz „Objednávky“.
- 💸 **Připomínka cashbacku:** termíny akce už před nákupem a upozornění, až jde nákup zaregistrovat u výrobce.
- 🛍️ **Moje nákupy** (volitelné, zapnete v nastavení): přehled všeho, co jste na Alze koupili – datum, cena, stav záruky, vrácené a reklamované zboží, odkaz na objednávku, faktura (PDF) jedním klikem a graf výdajů po letech a měsících i podle kategorií. Připomínka měsíc před koncem záruky u dražšího zboží a „Koupili jste…“ na detailu produktu, který už máte. **Vyplatí se AlzaPlus+?** odhadne, kolik vám členství za poslední rok ušetřilo nebo by ušetřilo, a **Dochází vám?** u opakovaně kupovaného zboží napoví, kdy ho budete kupovat znovu.
- 🔍 **Srovnávače cen** na detailu produktu: Heureka, Zboží.cz, Árukereső jedním klikem. **Kopírovat nabídku** pošle název, ceny i s kódem a odkaz do chatu.
- 💾 **Záloha dat:** export do JSON (i s peněženkou poukazů, poznámkami a skrytými produkty), export historie do CSV, obnova ze zálohy a úklid starých dat.

Rozhraní je v češtině, slovenštině, maďarštině a angličtině.

## Jak to vypadá

<table>
  <tr>
    <td width="50%"><img src="docs/images/1-historie.png" alt="Historie cen"><br><sub><b>Historie cen</b> a upozornění na podezřelé slevy</sub></td>
    <td width="50%"><img src="docs/images/2-seznam.png" alt="Nákupní seznam se změnami cen"><br><sub><b>Nákupní seznam</b> na jeden pohled: souhrn, filtry a řazení</sub></td>
  </tr>
  <tr>
    <td><img src="docs/images/3-detail.png" alt="Detail produktu"><br><sub><b>Cílová cena</b> přímo na detailu produktu, klidně za kus</sub></td>
    <td><img src="docs/images/4-cena-za-kus.png" alt="Skutečná cena za kus v kategorii"><br><sub><b>Skutečná cena za kus</b> v kategorii a řazení podle ní</sub></td>
  </tr>
  <tr>
    <td><img src="docs/images/5-hlidani.png" alt="Hlídání cen na pozadí"><br><sub><b>Hlídání na pozadí</b> s notifikacemi a přehledem změn</sub></td>
    <td><img src="docs/images/6-kody-cashback.png" alt="Trezor slevových kódů a připomínka cashbacku"><br><sub><b>Cashback k registraci</b> a počet slevových kódů v okně rozšíření, upozornění na zlevnění po nákupu</sub></td>
  </tr>
  <tr>
    <td><img src="docs/images/7-kosik.png" alt="Košík se souhrnem a hodnocením cen"><br><sub><b>Košík</b> se souhrnem, hodnocením cen, „Už máte“, rozpočtem a množstevní slevou</sub></td>
    <td><img src="docs/images/8-filtr-slev.png" alt="Filtr slev v kategorii"><br><sub><b>Filtr slev</b> v panelu filtrů a řazení „Za jednotku“</sub></td>
  </tr>
  <tr>
    <td><img src="docs/images/9-moje-nakupy.png" alt="Moje nákupy"><br><sub><b>Moje nákupy</b> se stavem záruky a grafem výdajů</sub></td>
    <td><img src="docs/images/10-cena-provozu.png" alt="Cena provozu lednic v kategorii"><br><sub><b>Cena provozu</b> spotřebičů a řazení „S provozem“</sub></td>
  </tr>
  <tr>
    <td><img src="docs/images/11-cena-za-tb.png" alt="Cena za TB u SSD disků"><br><sub><b>Cena za TB</b> u disků, za GB, 1000 mAh a Wh</sub></td>
    <td><img src="docs/images/12-penezenka-poukazu.png" alt="Peněženka poukazů"><br><sub><b>Peněženka poukazů</b>: vlastní slevové kódy a dárkové poukazy s platností</sub></td>
  </tr>
  <tr>
    <td colspan="2" valign="middle" align="center">
      <b>Zdarma a bez reklam.</b><br><br>
      <a href="https://chromewebstore.google.com/detail/allyzap/ndaheikijjhppooeiioljekolkekfgie">Chrome Web Store</a> ·
      <a href="https://addons.mozilla.org/firefox/addon/allyzap/">Firefox Add-ons</a>
    </td>
  </tr>
</table>

## Jak začít

### 1. Nainstalujte rozšíření

| Prohlížeč | Kde | Požadavky |
|---|---|---|
| **Chrome** | [Chrome Web Store](https://chromewebstore.google.com/detail/allyzap/ndaheikijjhppooeiioljekolkekfgie) | Chrome 121 nebo novější |
| **Firefox** pro počítač | [Firefox Add-ons](https://addons.mozilla.org/firefox/addon/allyzap/) | Firefox 140 nebo novější (ne Android) |
| **Safari** na Macu (experimentálně) | [sestavení na vlastním Macu](safari/README.md) | macOS 13 a Safari 18 nebo novější, Command Line Tools |

Verze pro Safari v App Storu není – sestavíte si ji sami jedním příkazem v Terminálu podle [návodu](safari/README.md). Hodí se pro ty, kdo se Terminálu nebojí.

Potřebujete jen účet na Alze. Registrace je zdarma a rozšíření s ním pracuje stejně jako vy v prohlížeči.

### 2. Projděte průvodce nastavením

Po instalaci se sám otevře průvodce. Zabere asi minutu a později ho kdykoli spustíte znovu odkazem **Průvodce** dole v levém panelu stránky rozšíření.

<p align="center"><img src="docs/images/welcome-1-uvod.png" alt="Úvod průvodce nastavením" width="80%"></p>

Úvod shrnuje, co je dobré vědět předem: historie začíná instalací, ceny se ukládají jen přihlášenému s cenami s DPH a všechna data zůstávají ve vašem prohlížeči. Pak následují čtyři kroky:

<table>
  <tr>
    <td width="50%" valign="top">
      <img src="docs/images/welcome-2-overeni.png" alt="Krok 1: ověření">
      <p><b>Krok 1 – Ověření.</b> Vyberte svou Alzu a klikněte na <b>🔍 Ověřit</b>. Rozšíření na pozadí zkontroluje, že jste přihlášeni, vidíte ceny s DPH, prohlížeč povoluje notifikace a ikona je připnutá na liště. Co chybí, je červeně i s návodem. Po přihlášení na Alze se stačí vrátit do záložky průvodce a ověření proběhne znovu samo.</p>
    </td>
    <td width="50%" valign="top">
      <img src="docs/images/welcome-3-hlidani.png" alt="Krok 2: co a jak často hlídat">
      <p><b>Krok 2 – Hlídání.</b> Jak často kontrolovat hlídané produkty (každou hodinu až jednou denně ve zvolený čas), jestli ukládat ceny i z procházení Alzy, hlídat cenu po nákupu, připomínat registraci cashbacku a jestli zapnout Moje nákupy s připomínkou konce záruky. Každá změna se hned uloží.</p>
    </td>
  </tr>
  <tr>
    <td valign="top">
      <img src="docs/images/welcome-4-kategorie.png" alt="Krok 3: výpisy kategorií">
      <p><b>Krok 3 – Kategorie.</b> Co ukázat ve výpisech kategorií a ve vyhledávání: skutečnou cenu za jednotku, filtr slev a cenu provozu spotřebičů s vaší cenou elektřiny.</p>
    </td>
    <td valign="top">
      <img src="docs/images/welcome-5-notifikace.png" alt="Krok 4: notifikace">
      <p><b>Krok 4 – Notifikace.</b> Kdy se ozvat: zlevnění (třeba až od 5 %), nová cena (akce, slevový kód, cashback), změna dostupnosti a tiché hodiny. Tlačítkem <b>🔔 Vyzkoušet notifikace</b> ověříte, že je Windows nebo prohlížeč nezahazuje.</p>
    </td>
  </tr>
  <tr>
    <td valign="top">
      <img src="docs/images/welcome-6-hotovo.png" alt="Hotovo">
      <p><b>Hotovo.</b> Otevřete svůj nákupní seznam na Alze. Rozšíření u položek načte všechny ceny a začne si vést historii. Průvodce ukáže, kolik seznamů a produktů už hlídáte.</p>
    </td>
    <td valign="top">
      <p><b>Po aktualizaci</b> s novou volbou se sama otevře stránka <b>Co je nového</b>, kde nové volby hned zapnete nebo vypnete. U ostatních aktualizací svítí v popupu zelená značka <b>Novinky</b>.</p>
    </td>
  </tr>
</table>

### 3. Řekněte rozšíření, co hlídat

Rozšíření kontroluje ceny i se zavřenou Alzou. Stačí mu říct co:

- 📋 **Celý nákupní seznam:** otevřete ho na Alze a klikněte na zvoneček 🔔 v záložce seznamu, nebo na **🔔 Hlídat seznam** v popupu rozšíření.
- 🛍️ **Jeden produkt:** na detailu produktu klikněte na **🔔 Hlídat na pozadí** v kartě rozšíření pod fotkami.
- 🎯 **Cílová cena:** na detailu produktu klikněte na **🎯 Cílová cena** a zadejte cenu, za kterou chcete koupit. Rozšíření se ozve, jakmile ji Alza nabídne. Jde zadat i cena za kus.

### 4. Sledujte změny

Změny cen přijdou jako notifikace a jejich počet svítí na ikoně rozšíření. Po kliknutí na ikonu je v popupu přehled změn od minula, hlídané seznamy a tlačítko **▶️ Zkontrolovat** pro okamžitou kontrolu. Viz snímek *Hlídání na pozadí* [výše](#jak-to-vypadá).

## Nastavení

Stránku rozšíření otevřete z popupu tlačítkem **Moje data** nebo ozubeným kolečkem ⚙️ (rovnou nastavení), případně pravým tlačítkem na ikonu rozšíření → *Možnosti*. Vlevo je boční panel se dvěma skupinami záložek: **Moje data** (Hlídané seznamy, Hlídané produkty, Moje nákupy, Kódy a poukazy, Uložená data) a **Nastavení** (Sledování cen, Notifikace, Výpisy kategorií, Obecné a Logy běhů). Dole v panelu jsou odkazy **Co je nového**, **Průvodce** a **Nápověda**. V nastavení najdete volby z průvodce a další, které v průvodci nejsou; každá změna se hned uloží.

<p align="center"><img src="docs/images/nastaveni-1-sledovani.png" alt="Nastavení: záložka Sledování cen" width="90%"></p>

- **Sledování cen:** jak často kontrolovat hlídané produkty, **Ukládat ceny z procházení**, **Hlídat cenu po nákupu**, **Připomínat registraci cashbacku**, **Moje nákupy – koupené zboží a záruky** (ve výchozím stavu vypnuté), **Připomínat konec záruky** a **Měsíční rozpočet** (0 = bez rozpočtu; potřebuje Moje nákupy).
- **Notifikace:** zlevnění od zvoleného procenta, nové ceny, dostupnost, tiché hodiny, **Připomínat konec platnosti poukazů** a **Vyzkoušet notifikace**.
- **Výpisy kategorií:** **Skutečná cena za jednotku** na oranžovém štítku, **Filtr slev** v levém panelu filtrů a **Cena provozu spotřebičů** – cena elektřiny, počet let, praní týdně a kolik hodin denně běží televize a monitor.
- **Obecné:**
  - **Jazyk:** jazyk rozšíření a hlavní Alza (cz, sk, hu).
  - **Záloha dat:** **Záloha (JSON)** stáhne historii cen, hlídané seznamy a produkty, cílové ceny, připomínky cashbacku, peněženku poukazů včetně kódů (u použitého poukazu i číslo objednávky), poznámky, skryté produkty a značky a nastavení. Nákupy a slevové kódy u produktů v ní nejsou – znovu se načtou z Alzy. Soubor zálohy proto nedávejte nikomu, komu byste nedali své poukazy. **Obnovit ze zálohy…** data vrátí. **Historie (CSV)** se otevře v Excelu, **Uklidit stará data…** smaže to, co už nepotřebujete.
  - **Diagnostika:** **🐞 Nahlásit chybu** otevře na GitHubu nové hlášení s předvyplněnou verzí, prohlížečem a posledními chybami (údaje dostane GitHub v adrese stránky už při otevření, veřejné bude až po odeslání). **Stáhnout diagnostiku** uloží soubor pro autora. Názvy koupeného zboží ani čísla objednávek v hlášení ani v souboru nejsou.
  - **Smazat všechna data…** smaže vše kromě nastavení a logu chyb – i nákupy, slevové kódy, peněženku poukazů, poznámky a skryté produkty a značky; předtím se stáhne záloha.

Na záložku nastavení jde odkázat přímo – adresa stránky nastavení končí `#s-tracking`, `#s-notifications`, `#s-categories` nebo `#s-general`.

Ve skupině **Moje data** je to, co rozšíření hlídá a ukládá:

<p align="center"><img src="docs/images/nastaveni-2-seznamy.png" alt="Nastavení: hlídané nákupní seznamy" width="90%"></p>
<p align="center"><img src="docs/images/nastaveni-3-produkty.png" alt="Nastavení: hlídané produkty a cílové ceny" width="90%"></p>
<p align="center"><img src="docs/images/nastaveni-4-moje-nakupy.png" alt="Nastavení: Moje nákupy s grafem výdajů" width="90%"></p>

- **Hlídané seznamy:** kolik mají produktů, od kdy se hlídají. Kliknutím na řádek uvidíte produkty seznamu.
- **Hlídané produkty:** jednotlivé produkty a cílové ceny, včetně aktuální ceny.
- **Moje nákupy:** koupené zboží s datem, cenou, stavem záruky a odkazem na objednávku, hledání, filtry podle záruky, roku a měsíce a graf výdajů. U nákupu je ikona faktury (PDF), nad tabulkou odhad **Vyplatí se AlzaPlus+?**, **Dochází vám?** a výdaje podle kategorií s úsporou proti běžné ceně. Se zapnutou volbou tu je tlačítko **Načíst nové nákupy**, s vypnutou **Smazat načtené nákupy**.
- **Kódy a poukazy:** peněženka poukazů (přidání vložením textu e-mailu nebo ručně, filtr k použití / použité a prošlé, úprava a smazání) a slevové kódy u produktů, které jste viděli.
- **Uložená data:** všechny produkty s historií cen.
- **Logy běhů** (ve skupině Nastavení): kdy a s jakým výsledkem proběhla kontrola na pozadí, včetně nových a odebraných položek seznamů a nových nákupů.

## Časté otázky

<details>
<summary><b>Proč se mi neukládají ceny?</b></summary>

Ceny se ukládají, jen když jste na Alze přihlášeni a vidíte je s DPH. Nepřihlášený nebo firemní účet vidí jiné ceny, historie by pak nesouhlasila. Spusťte průvodce (odkaz **Průvodce** dole v levém panelu stránky rozšíření), krok 1 ukáže, co chybí. Důvod napíše i karta rozšíření na detailu produktu a při přerušené kontrole svítí na ikoně oranžový „!“.
</details>

<details>
<summary><b>Proč u produktu nevidím hodnocení ceny?</b></summary>

Historie začíná instalací rozšíření a hodnocení potřebuje aspoň 14 dní záznamů. Do té doby uvidíte jen ceny, které už rozšíření zná.
</details>

<details>
<summary><b>Nechodí mi notifikace.</b></summary>

V průvodci nebo v nastavení klikněte na **🔔 Vyzkoušet notifikace**. Když nic nepřijde, povolte notifikace prohlížeče v systému (Windows: Nastavení → Systém → Oznámení) a vypněte režim Nerušit. Zkontrolujte i tiché hodiny v nastavení.
</details>

<details>
<summary><b>Musí být Alza otevřená?</b></summary>

Nemusí. Hlídané seznamy a produkty se kontrolují na pozadí, stačí mít spuštěný prohlížeč. Když je při kontrole jednou denně prohlížeč zavřený, proběhne pár minut po jeho spuštění.
</details>

<details>
<summary><b>Jak přenesu data na jiný počítač nebo do jiného prohlížeče?</b></summary>

V nastavení klikněte na **Záloha (JSON)** a soubor si uložte. V novém prohlížeči nainstalujte rozšíření a v nastavení použijte **Obnovit ze zálohy…**. Záloha obsahuje historii cen, hlídané seznamy a produkty, cílové ceny, připomínky cashbacku, peněženku poukazů včetně kódů, poznámky, skryté produkty a značky i nastavení; nákupy a slevové kódy u produktů se znovu načtou z Alzy. Protože jsou v ní kódy vašich poukazů, neposílejte ji nikomu cizímu. Při odinstalaci rozšíření prohlížeč jeho data smaže, proto si zálohu udělejte vždy předem.
</details>

<details>
<summary><b>Funguje to v telefonu?</b></summary>

Ne. Chrome pro Android rozšíření nepodporuje a Firefox pro Android nemá notifikace, které hlídání potřebuje.
</details>

## Soukromí

Všechna data (ceny, historie, nákupy, poukazy, poznámky, nastavení) se ukládají jen lokálně ve vašem prohlížeči. Rozšíření komunikuje výhradně s weby Alzy (`www.alza.*`, obrázky z `image.alza.*`, recenze z `webapi.alza.*`, faktura z `pdf.alza.*`) a nikam jinam nic neodesílá. Jedinou výjimkou jsou ikony srovnávačů cen (Heureka, Zboží.cz, Árukereső) na detailu produktu: načítají se přímo z jejich webů, takže ty vidí vaši IP adresu – nic dalšího se jim neposílá, ani jaký produkt si prohlížíte. Tlačítko Nahlásit chybu otevře stránku GitHubu, až když na něj kliknete. Rozšíření nemá žádnou analytiku ani sledování, což si můžete ověřit přímo ve zdrojovém kódu v tomto repozitáři.

Z vašeho účtu na Alze rozšíření čte (s vaším přihlášením, stejně jako stránky Alzy, které si otevřete sami):

- **Obsah hlídaných nákupních seznamů** – před každou kontrolou na pozadí.
- **Objednávky za posledních 14 dní** pro hlídání ceny po nákupu – na stránkách Alzy i při kontrole na pozadí. Ukládá se koupené zboží (adresa, název, obrázek, cena, počet kusů, datum, konec lhůty pro vrácení), čas načtení a otisk seznamu rozpracovaných objednávek, podle kterého se pozná změna. Ze stejných objednávek se čtou slevové řádky – jen aby se poukaz z peněženky, který jste v košíku uplatnili, označil jako použitý. Vypnete volbou **Hlídat cenu po nákupu**.
- **Celý archiv objednávek** – jen když zapnete volbu **Moje nákupy – koupené zboží a záruky** (ve výchozím stavu je vypnutá). Ukládá se zboží (adresa, název, obrázek, značka, kategorie), u každého nákupu datum, počet kusů, cena, číslo objednávky (kvůli odkazu na ni), délka záruky a příznaky (jde reklamovat, vráceno, reklamováno, firemní nákup), a přehled objednávek (číslo, datum, částka). **Faktura (PDF)** si po kliknutí přečte tu jednu objednávku a doklad otevře v nové kartě; odkaz na něj se neukládá.

Až po vašem kliknutí se z Alzy čtou také **recenze** produktu (Recenze naruby, až 300 nejnovějších, nic se neukládá) a **stránky produktů** ve výpisu televizí a monitorů (Spočítat provoz, nejvýš 48 na kliknutí, ukládá se jen spotřeba).

Co si rozšíření ukládá od vás:

- **Peněženka poukazů** – kód, hodnota, platnost, minimální objednávka a vaše poznámka, u použitého poukazu čas použití a číslo objednávky. Text e-mailu, ze kterého poukaz vyplníte, se neukládá. V košíku na Alze se kód ukazuje jen zkráceně (poslední 4 znaky), stejně jako v upozornění na konec platnosti; celý se do pole Alzy vloží až po kliknutí na **Vložit**.
- **Poznámky k produktům**, **skryté produkty a značky** a u procházených produktů čas, kdy jste otevřeli jejich detail (štítek „prohlédnuto“).
- **Nastavení** včetně měsíčního rozpočtu.

Číslo vašeho účtu na Alze, jméno, adresa, platební údaje ani IČO se neukládají. Aby rozšíření poznalo, že se v prohlížeči přihlásil jiný účet, ukládá jen jeho otisk o čtyřech znacích a náhodnou sůl – číslo účtu z něj zjistit nejde. Po přihlášení jiného účtu se Moje nákupy toho předchozího odloží (zůstanou v prohlížeči) a vrátí se, až se k němu přihlásíte znovu; nákupy dvou účtů se nemíchají.

Záloha (JSON) obsahuje historii cen, hlídané seznamy a produkty, cílové ceny, procházené produkty, připomínky cashbacku, peněženku poukazů včetně kódů, poznámky, skryté produkty a značky a nastavení. Nákupy v záloze nejsou a názvy koupeného zboží ani čísla objednávek se nedostanou do hlášení chyby ani do souboru diagnostiky. Vypnutím volby Moje nákupy se načítání zastaví, data zůstanou – smažete je tlačítkem **Smazat načtené nákupy** v záložce Moje nákupy, nebo se vším ostatním přes **Smazat všechna data…**.

Zásady ochrany soukromí (pro obchody, česky i anglicky): [PRIVACY.md](PRIVACY.md).

## English

**AllyZap** tells you whether a price on Alza (CZ, SK, HU) is really a deal: price history, suspicious-discount alerts, background watching of your wishlists with notifications, target prices, the real price per piece, price per parameter (e.g. per TB) and appliance running costs in category listings, a discount filter in categories, a browsing memory in listings (viewed products, your notes, hidden products and brands), discount codes seen on products, a voucher wallet for your own codes and gift vouchers, cart checks (price ratings and a summary, volume discounts, missing codes, goods you already own, an optional monthly budget), "this time last year" and "reviews inside out" on the product page, price watching after purchase, cashback reminders and an optional overview of your purchases with warranty reminders, invoices, an AlzaPlus+ savings estimate and a "running out?" list. Free, no ads, no tracking, all data stays in your browser – including the vouchers and notes you save and the orders it reads from your Alza account (the last 14 days for price watching after purchase; the whole order archive only if you turn on My purchases). The backup file contains your voucher codes, so keep it to yourself. Privacy policy: [PRIVACY.md](PRIVACY.md). The extension speaks English too – switch the language in the setup guide or in the settings.

Install it from the [Chrome Web Store](https://chromewebstore.google.com/detail/allyzap/ndaheikijjhppooeiioljekolkekfgie) or [Firefox Add-ons](https://addons.mozilla.org/firefox/addon/allyzap/). Safari on macOS is experimental: you build it yourself on your Mac with one Terminal command, see [safari/README.md](safari/README.md) (in Czech). A setup guide opens right after installation. You need to be logged in to Alza and see prices including VAT for prices to be saved. Unofficial project, not affiliated with Alza.cz a.s. It is not just one person's work: I develop it together with [Claude Code](https://claude.com/claude-code), Anthropic's AI coding assistant, and code reviews are done with Google's Gemini.

## Chyby a návrhy

Chyby a nápady hlaste přes [Issues](https://github.com/Pnaky/AllyZap/issues). Nejrychleji to jde z rozšíření: **Nastavení → Obecné → Diagnostika → 🐞 Nahlásit chybu** předvyplní verzi, prohlížeč i poslední chyby. Když Alza změní vzhled webu a něco přestane fungovat, pomůže odkaz na stránku a snímek obrazovky. Projekt vzniká ve volném čase, pull requesty přijímám podle uvážení, viz [CONTRIBUTING.md](CONTRIBUTING.md).

Bezpečnostní chyby prosím hlaste neveřejně přes **Security → Report a vulnerability**, viz [SECURITY.md](SECURITY.md).

## Jak projekt vzniká

Rozšíření není jen moje práce. Vyvíjím ho společně s [Claude Code](https://claude.com/claude-code), AI asistentem pro programování od společnosti Anthropic. Já rozhoduji, co má rozšíření umět a jak má vypadat, zkouším ho na Alze v Chrome i Firefoxu a schvaluji každou verzi. Claude Code se podílí na návrhu, kódu, testech, nápovědě, textech i obrázcích do obchodů.

Code review dělá [Gemini](https://gemini.google.com) od Googlu. Změny tak kromě mě kontroluje ještě model od jiné firmy než ten, který je napsal (princip čtyř očí).

## Pro vývojáře

### Ruční instalace (vývojová verze)

Stáhněte repozitář (**Code → Download ZIP**) a rozbalte ho, nebo ho naklonujte. Stejná složka funguje v obou prohlížečích, bez buildu.

**Chrome** (121 nebo novější)

1. Otevřete `chrome://extensions`.
2. Zapněte **Režim pro vývojáře** vpravo nahoře.
3. Klikněte na **Načíst rozbalené** a vyberte složku s `manifest.json`.

**Firefox** (140 nebo novější)

1. Otevřete `about:debugging#/runtime/this-firefox`.
2. Klikněte na **Načíst dočasný doplněk** a vyberte `manifest.json`. Dočasný doplněk vydrží do zavření Firefoxu.

Rozbalená vývojová verze má v Chrome jiné ID než verze z obchodu, takže má i vlastní data. Při přesunu složky nebo odebrání rozšíření data zmizí, předem si udělejte zálohu (JSON).

### Struktura

| Složka | Co v ní je |
|---|---|
| `src/` | skript na stránkách Alzy (`content.js` a moduly v `content/`), výpisy kategorií (`category.js`), služba na pozadí (`background.js`), popup, nastavení, průvodce (`welcome/`), nápověda (`help/`) |
| `src/shared/` | jádro sdílené všemi částmi (`core.js`) a jediný zapisovatel do úložiště (`store.js`) |
| `src/chrome/`, `src/firefox/` | kód jen pro jeden prohlížeč |
| `safari/` | experimentální verze pro Safari: sestavení macOS aplikace s rozšířením ze stejných souborů, notifikace přes aplikaci (návod v [safari/README.md](safari/README.md)); do balíčků pro Chrome a Firefox nejde |
| `_locales/` | název a popis rozšíření v obchodech |
| `tests/` | testy jádra, úložiště, překladů, nápovědy a průvodce |

### Testy

Bez závislostí, stačí Node.js:

```
node --test "tests/*.test.js"
```

## Licence

Copyright (c) 2025–2026 Jan Pňakovič

[GNU GPL v3.0](LICENSE). Kód můžete používat, upravovat a šířit, ale upravené verze musí zůstat pod stejnou licencí a se zdrojovým kódem.
