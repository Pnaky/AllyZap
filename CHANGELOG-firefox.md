# Changelog – Firefox Add-ons

## 2026.11.16

- Popup: tlačítko Co je nového jen do přečtení novinek a bez prázdného řádku se šipkou, když nejsou žádné kódy ani poukazy
- Košík a seznam: cena jiného stavu (Levněji rozbalený) a množstevní slevy se obnoví i při kontrole na pozadí a po otevření detailu – dřív mohly zůstat staré
- Košík: u zlevněné položky se hodnotí cena k zaplacení, ne přeškrtnutá původní (mylné „nad obvyklou cenou“); platí i pro součet košíku u rozpočtu a poukazů
- Graf a tabulka historie: doba, kdy cena nebyla sledovaná, je vyznačená šedým pásem „nesledováno“ – čára přes ni nevede
- Moje data: nová záložka Skryté ve výpisech – přehled skrytých produktů a značek, odkud je jde vrátit
- Opravy z auditu 2026-11-16: hodnocení ceny, podezřelá sleva, přeškrtnutá cena a Loni touhle dobou počítají jen dobu, kdy byla cena opravdu sledovaná – delší pauza mezi návštěvami se nebere jako známá cena (produkty viděné jen při procházení dostanou hodnocení později)
- Peněženka poukazů: poukaz se označí jako použitý, jen když byl opravdu vložený v košíku; kód je v bublině košíku a v notifikaci skrytý až na poslední znaky; úpravu poukazu jde zrušit; přesnější čtení e-mailu (1.500 Kč, 100,- Kč), nejisté údaje zůstanou prázdné
- Dárkový šek je platba – nesnižuje cenu koupeného zboží (úspora v Mých nákupech, zlevnění po nákupu)
- Moje nákupy se při přihlášení jiného účtu oddělí a po návratu vrátí; druhý účet v kontejneru nebo anonymním okně už nemaže nákupy ani připomínky
- Odhlášení na jedné Alze nezastaví kontrolu ostatních; upozornění jmenuje doménu
- Skrytí značky i u televizí a monitorů; značka se bere z Alzina filtru Značka (víceslovné značky, názvy začínající obecným slovem); skryté produkty se nepočítají do filtru, řazení ani Spočítat provoz
- Spočítat provoz jen u televizí a monitorů; při chybách Alzy se zastaví a po odmítnutí pár minut počká
- Košík: souhrn a štítky podle ceny v košíku; Recenze naruby bez vět typu „nic jsem nenašel“, příklad výtky kliknutím, srozumitelné chyby; poznámka se při chybě uložení neztratí
- Vyplatí se AlzaPlus+? počítá jen nákupy za cenu AlzaPlus+; Dochází vám? počítá s kusy; faktura neotevře dobropis
- Historické minimum bez cashbacku i u dřív uložených cen; návrh čistky nemaže historii zboží koupeného za poslední rok
- Záloha: text říká, že obsahuje poukazy s kódy, poznámky a skryté produkty; import nepřepíše novější poznámku; diagnostika skryje i údaje o nákupu u hlídaného zboží
- Stránka rozšíření bez posuvníku v nastavení, bublina nápovědy celá v okně; Co je nového pro toto vydání
- Odložené notifikace přijdou po startu prohlížeče hned, nedoručené se zkusí znovu za 5 minut; cílová cena se po přerušené kontrole neohlásí dvakrát
- Cashback a výkup (šrotovné) se nepočítají do aktuální, obvyklé, nejnižší za 30 dní, nejvyšší prodejní ceny ani historického minima – platí jen za podmínek; podezřelá sleva srovnává jen cenu k zaplacení
- Cílová cena se ohlásí i s cashbackem / výkupem, s poznámkou „s cashbackem“
- Detail produktu: výstrahy v jednom boxu, doplňující informace jako přehledný seznam (Zobrazit rozbalený kus, Objednávka), Poznámka, Recenze naruby a Kopírovat nabídku jako ikony
- Košík: štítky v jednom řádku u ceny, podezřelá sleva a přeškrtnutá cena v jednom štítku
- Graf historie: přiblížení (tažení myší, Ctrl + kolečko, 24 h / 7 dní / 30 dní), poslední kontrola v záhlaví
- Nový název AllyZap (dřív Alza Price Insight); data, nastavení i aktualizace zůstávají
- Přerušená kontrola (nejste na Alze přihlášeni, ceny bez DPH, Alza blokuje): oranžový „!“ na ikoně a upozornění nahoře v popupu s tlačítky Přihlásit se na Alze a Zkontrolovat znovu; po přihlášení na Alze se kontrola spustí hned; přerušení se ohlásí i u zboží hlídaného jen kvůli nákupu
- Vyzkoušet notifikace: pod tlačítkem rada podle systému (Windows / macOS) a výsledek zkoušky (macOS: povolit Firefox v Oznámeních, Soustředění, notifikace při sdílení obrazovky)
- Stránka rozšíření s bočním panelem: Moje data (seznamy, produkty, nákupy, kódy, uložená data) a Nastavení (volby a Logy běhů); Co je nového, Průvodce a Nápověda dole v panelu
- Popup: tlačítko Moje data a ozubené kolo rovnou do nastavení; Novinky jen dokud nejsou přečtené, bez odkazu na Alzu
- Detail produktu: Poznámka a Recenze naruby se dalším kliknutím zavřou (poznámka i klávesou Esc) a po překreslení karty zůstanou otevřené
- Hlídání po nákupu: víc nákupů téhož zboží se hlídá každý zvlášť (cena i lhůta z téže objednávky); po přihlášení jiného účtu se nákupy předchozího zapomenou
- Hodnocení ceny a kontrola přeškrtnuté ceny počítají jen dny se známou cenou; vyprázdněný hlídaný seznam se po otevření vyprázdní i v rozšíření
- Opravy z auditu (issue #4): nepovedená notifikace se zkusí znovu, nový nákup téhož zboží dostane vlastní upozornění, nenačtená objednávka se načte znovu za 30 minut
- Opravy z auditu: přesná procenta slevy ve filtru (30 % už není 29 %), úspora za kusy v centech, neexistující datum akce se nepoužije, balení „2 × 3 × 4 ks“ a „2 balení po 60 ks“
- Opravy z auditu: smazání dat stáhne novou zálohu, když se data mezitím změnila; úklid starých dat nesmaže mezitím obnovený produkt; diagnostika skryje koupené zboží i po čase
- Lhůta pro vrácení v upozornění „nejméně do“ (počítá se opatrně od objednávky); přesnější popis tlačítka Nahlásit chybu
- Peněženka poukazů: vlastní slevové kódy a dárkové poukazy (vložte text e-mailu, vyplní se samy), v košíku bublina s nabídkou k vložení a kolik chybí do minima, uložení poukazu z košíku, použitý poukaz se pozná z objednávky
- Připomínka poukazu týden před koncem platnosti a poslední den
- Slevové kódy u produktů přesunuty z popupu do záložky Kódy a poukazy v nastavení
- Košík: „Už máte“ u zboží, které jste už koupili
- Košík: souhrn nad položkami – kolik je nad / pod obvyklou cenou, kde počkat, podezřelé slevy
- Měsíční rozpočet (volitelný): v košíku kolik jste tento měsíc utratili, s košíkem a kolik zbývá
- Moje nákupy: odhad, kolik ušetří AlzaPlus+ za poslední rok
- Moje nákupy: faktura (PDF) k nákupu jedním klikem
- Loni touhle dobou: na detailu i v košíku, jestli produkt loni v následujícím měsíci zlevnil (Black Friday)
- Moje nákupy: Dochází vám? – opakovaně kupované zboží, které brzy dojde, s dnešní cenou
- Moje nákupy: výdaje podle kategorií a úspora proti běžné ceně v den nákupu
- Výpisy: „prohlédnuto“ u otevřených produktů, vaše poznámky, skrytí produktu nebo značky; poznámka k produktu na detailu
- Cena provozu i u televizí a monitorů ve výpisech (tlačítko Spočítat provoz, spotřeba i z otevřeného detailu)
- Detail produktu: Recenze naruby – co lidem vadí, vývoj hodnocení, nejkritičtější ověřené recenze

## 2026.11.12

- Moje nákupy (volitelné): všechno koupené na Alze – datum a cena nákupu, stav a délka záruky, vrácené a reklamované zboží, odkaz na objednávku, graf výdajů po letech a měsících se srovnáním, filtr podle roku a měsíce se součtem
- Připomínka konce záruky měsíc předem u dražšího zboží; na detailu produktu „Koupili jste…“
- Cena provozu: v kategoriích u lednic, mrazáků, praček a sušiček s řazením „S provozem“, na detailu produktu i u televizí, monitorů a myček; cena elektřiny, počet let, praní týdně a hodiny televize v nastavení
- Cena za parametr v kategoriích a vyhledávání: Kč/TB a Kč/GB u disků a pamětí, za 1000 mAh u powerbanek, za Wh u nabíjecích stanic; řazení „Za jednotku“ i podle ní
- Co je nového: po aktualizaci stránka s novinkami (sama jen u nové volby), značka Novinky v popupu
- Nastavení po záložkách (Sledování cen, Notifikace, Výpisy kategorií, Obecné), ovladatelné i šipkami a čtečkou obrazovky; průvodce má krok Kategorie, Moje nákupy a připomínku konce záruky
- Hlídané seznamy se před každou kontrolou aktualizují z Alzy – i položky přidané v mobilní aplikaci
- Hlídání po nákupu: nová objednávka se načte už při kontrole na pozadí; zlevnění hned po nákupu se ohlásí; zboží mimo hlídané seznamy hlásí jen zlevnění pod nákupní cenu; vrácené a zrušené zboží se přestane hlídat
- Filtr slev u velkých výpisů filtruje načtené produkty a další dávku přidá „Načíst dalších 480“; správně počítá ceny člena AlzaPlus+
- Běžná cena se přeškrtne, jen když jde opravdu zaplatit míň – ne u samotného cashbacku nebo výkupu
- Šetrněji k Alze: prodlevy mezi dotazy na objednávky, přerušení po odmítnutí
- Zlevnění zjištěné těsně před zavřením prohlížeče se ohlásí po dalším spuštění
- Nahlásit chybu: název napíšete sami; hlášení i diagnostika bez adres, kódů, názvů koupeného zboží a čísel objednávek
- Záloha obsahuje i připomínky cashbacku; Smazat všechna data smaže i nákupy, kódy a připomínky
- Firefox: kontrola na pozadí se neuspí při načítání seznamů a objednávek; po aktualizaci se uklidí stará cenová karta a výpis nezůstane seřazený
- Opravy: sleva k položce v objednávce s víc zbožím, zdánlivé zlevnění po nákupu s kódem, připomínky cashbacku (tiché hodiny, maďarská data, eura), slevový kód z textu, košík po překreslení, Přidat s kódem bez dvojího přidání, cenová karta po překreslení stránky, ceny při načítání seznamu, jedno upozornění pro produkt pod dvěma adresami, texty chyb v jazyce rozhraní

## 2026.11.9

- Popup: trezor slevových kódů (kód, cena s kódem, Kopírovat), sbalený na jeden řádek; upozornění na nový kód hlídaného produktu obsahuje kód
- Hlídání po nákupu: zboží z „Moje objednávky“ (14 dní) – když zlevní, upozornění, že jde vrátit a koupit znovu
- Připomínka cashbacku: lhůta registrace ze stránky akce, upozornění, až jde nákup zaregistrovat, a týden před koncem; „Cashback k registraci“ v popupu
- Cashback: termíny akce v tooltipu ceny a na detailu, varování po konci nákupního období
- Košík: hodnocení ceny u položek, „+1 ks → cena za kus“ u množstevní slevy, upozornění na chybějící slevový kód před „Pokračovat“
- Seznam: „Přidat s kódem“ vloží zboží do košíku i se slevovým kódem
- Seznam: zeleně cena za kus podle stupně množstevní slevy; cena s kódem červeně s ikonou kupónu
- Detail: bublina množstevních slev hned, „Kopírovat nabídku“, ikony srovnávačů (Heureka, Zboží.cz, Árukereső); karta řekne, proč se ceny neukládají
- Kategorie a vyhledávání: filtr slev v panelu filtrů (sleva aspoň X %, jen s kupónem, s množstevní slevou), řazení za jednotku jako záložka „Za jednotku“
- Hezčí a přehlednější vzhled: tooltipy jako na Alze (název ceny, rozdíl proti dražším cenám, stupně množstevní slevy, kód ke zkopírování), lišta seznamu s logem jako nastavení, ovládání v kategoriích přímo v záložkách a filtrech Alzy
- Popup: název produktu s chybou kontroly je odkaz
- Oprava: slevový kód výrobce („Koupit s kódem …“) se nepočítal
- Oprava: cena za jednotku v kategoriích u ceny s AlzaPlus+
- Oprava: ceny zboží bez DPH (knihy) se znovu ukládají; jeden takový produkt nezastaví kontrolu seznamu
- Oprava: cena „od …“ u množstevní slevy kazila historii a minimum (staré záznamy se odstraní)

## 2026.11.7

- Po instalaci průvodce nastavením: hlavní Alza, ověření přihlášení a cen s DPH jedním kliknutím (co je hotové a co udělat), hlídání a notifikace ve 3 krocích
- Nastavení: 🧭 Průvodce v záhlaví, volba Hlavní Alza
- Nový vzhled nastavení, nápovědy a popupu (jako průvodce); záhlaví na všech stránkách na stejném místě
- Nastavení: 🐞 Nahlásit chybu – předvyplněné hlášení na GitHubu (verze, prohlížeč, poslední chyby)
- Oprava: nastavení po otevření samo odskočilo dolů
- Popup: odkaz na Alzu vede na doménu otevřené záložky (na alza.sk na alza.sk)
- Popup: když hlídáte víc Alz, seznamy, změny cen i hlídané produkty mají štítek CZ / SK / HU
- Popup: cena v přehledu změn už nezatéká pod posuvník
- Číslo na ikoně počítá i zdražení; barva: zelená = něco zlevnilo, červená = jen zdražení, šedá = jen konec prodeje
- Popup: podbarvené jsou i nové zdražení a změny z kontroly spuštěné při otevřeném popupu
- Oprava: seřazený nákupní seznam znovu obnoví ceny, které Alza přepíše (AlzaPlus+, kód, součet za kusy)
- Odložené notifikace z tichých hodin přijdou hned po jejich konci, ne až s další kontrolou
- Kontrola bez připojení k internetu se zopakuje za 15 minut a nepočítá se jako proběhlá
- Oprava: číslo na ikoně mohlo po otevření popupu zůstat; počítá jen změny, které popup ukáže
- Oprava: na alza.sk a alza.hu se běžné zlevnění mohlo vyhodnotit jako „ceny bez DPH“ a ukládání se zastavilo
- Průvodce: zeleně „vše připraveno“ jen s ověřenými cenami s DPH; mezi hlídanými počítá i cílové ceny
- Nastavení: změny z průvodce už nepřepíše otevřená stránka nastavení
- Import zálohy: kontrola adres, obrázků a časů; hlásí i vynechané položky
- Nahlásit chybu: z veřejného hlášení zmizí adresy produktů
- Malé zlevnění v procentech s desetinnými místy místo „-0 %“
- Popup: odkaz na Alzu vede na hlavní Alzu z nastavení, když není otevřená záložka Alzy
- Po aktualizaci rozšíření se na otevřené stránce Alzy nezdvojí lišta seznamu ani řazení podle ceny za kus

## 2026.11.6

- Oprava: seznam bez přihlášení (nebo s cenami bez DPH) se donekonečna načítal místo upozornění, že se ceny neukládají
- Seznam: sloupec „ks celkem“ se už nepřekrývá se šipkami ▼ ▲ a ikonou změny ceny
- Oprava: při přepnutí záložky seznamu se hlídaný seznam mohl přepsat položkami předchozího seznamu (Alza mění adresu dřív, než vykreslí položky)
- Spolehlivější ukládání: změny z více záložek, popupu a kontroly na pozadí se už navzájem nepřepisují; uložené ceny po produktech (převod proběhne sám)
- Rychlejší seznam: stránky produktů se stahují a čtou na pozadí, s časovým limitem a bez zbytečného opakování
- Smazání všech dat až po potvrzení, že se záloha uložila
- Zkracování textu dostupnosti funguje i s jiným jazykem rozšíření než Alzy
- Šipka změny ceny nezávislá na ikonách Alzy; malé změny v procentech s desetinným místem
- Po aktualizaci rozšíření otevřená stránka Alzy nepohlcuje kliknutí ani nehází chyby
- Chyby akcí v nastavení a popupu se zobrazí (dřív se nic nestalo)
- Nastavení → Uložená data: velikost úložiště odhadem (Firefox ji nehlásí)
- Nastavení: u každé volby ikona „?“ s nápovědou (ukáže se hned po najetí myší)
- Kontrola na pozadí: v nastavení frekvence – každou hodinu, 3 / 6 / 12 hodin nebo jednou denně ve zvolený čas (zmeškaná proběhne po spuštění prohlížeče); popup ukazuje čas další kontroly
- Nastavení: „?“ s nápovědou i u Zálohy dat a Diagnostiky
- Nastavení: přehlednější členění – Sledování cen (kontrola hlídaných produktů, ukládání z procházení), Notifikace, Výpisy kategorií; jazyk v pravém sloupci u zálohy a diagnostiky
- Popup širší (400 px): řádky změn cen se vejdou na jeden řádek, název rozšíření se nezalamuje
- Popup: v záhlaví jen název, ikona Alzy a ⚙️ (nápověda je v nastavení); změny barevně – zlevnění zeleně, zdražení červeně, nedostupnost / konec prodeje šedě (nové podbarvené, viděné jen barvou textu); v přehledu i zdražení (bez notifikace)
- Popup: u hlídaných seznamů místo křížku shrnutí, kolik produktů za 7 dní zlevnilo ▼ / zdražilo ▲; oprava zdvojeného řádku „Další kontrola“
- Rytmus akcí: jak často a jak hluboko bývá produkt ve slevě, kdy se čeká další; „⏳ vyplatí se počkat“ v seznamu, filtr, na detailu
- Stejný produkt v jiném stavu (rozbalený, zánovní) levněji než vaše nejnižší cena (i s AlzaPlus+ a benefitem): na detailu, v tooltipu ceny, filtr
- Ukládání cen z procházení: výpisy kategorií, vyhledávání, detail, karusely na detailu (zakoupeno společně, alternativy, naposledy navštívené) i homepage tiše do historie (volba v nastavení)
- Čistka navrhne produkty z procházení až po roce
- Nastavení: 📈 u produktu otevře historii cen s grafem a cílovou cenou
- Seznam při více kusech: ceny zůstávají za kus (dřív zmizely), vlevo od nich sloupec „3 ks celkem“ se součtem i s množstevní slevou; řádek se neposune
- Upozornění před vložením do košíku ze seznamu, když nejnižší cena platí jen za podmínky (slevový kód, AlzaPlus+, cashback, výkup)
- Výběr délky: cena za metr; detail produktu i s adresou „…?dq=“ (skupiny variant, např. kabely)
- Výběr velikosti balení: cena za kus u každé velikosti ve sloupci vpravo, nejvýhodnější zeleně, nejdražší červeně; hned i v zavřeném výběru; i velikosti s názvem („Sparkle 120 ks“) a násobkem („2× 60 ks“)
- Množstevní slevy „Kup víc, zaplať míň“: stupně u ceny, filtr, součet podle počtu kusů
- Souhrn seznamu: cashback a výkup zvlášť od částky k zaplacení

## 2026.11.5

- První vydání pro Firefox
