// Testy peněženky poukazů (AlzaCore – parseVoucherText, stav, párování s objednávkou, připomínky): node --test tests/
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadCore } = require("./load-core");

const { AlzaCore } = loadCore();
const plain = (value) => JSON.parse(JSON.stringify(value));
const DAY = 24 * 60 * 60 * 1000;
const endOfDay = (year, month, day) => new Date(year, month - 1, day, 23, 59, 59, 999).getTime();

test("poukaz z textu e-mailu: kód za popiskem, ne číslo objednávky", () => {
  const mail = [
    "Dobrý den,",
    "objednávka 1234567890 dorazila později, než bychom si přáli. Omlouváme se za komplikace a níže posíláme poukaz.",
    "Slevový kód:\tAB12CD34EF",
    "Výše slevy:\t100 Kč",
    "Platnost do:\t21.1.2027",
    "Hodnotu poukazu je nutné vyčerpat najednou.",
  ].join("\n");
  assert.deepEqual(plain(AlzaCore.parseVoucherText(mail)), { code: "AB12CD34EF", kind: "amount", value: 100, domain: "alza_cz", until: endOfDay(2027, 1, 21), minOrder: null });
});

test("poukaz z textu: popisek na samostatném řádku, eura, minimum objednávky, procenta", () => {
  const sk = "Zľavový kód:\nXY-2027\nHodnota: 15 €\nPlatí do 3. 2. 2027\nMinimálna hodnota objednávky 100 €";
  assert.deepEqual(plain(AlzaCore.parseVoucherText(sk)), { code: "XY-2027", kind: "amount", value: 15, domain: "alza_sk", until: endOfDay(2027, 2, 3), minOrder: 100 });
  const percent = AlzaCore.parseVoucherText("Kód: sleva10x\nSleva: 10 %");
  assert.equal(percent.code, "SLEVA10X");
  assert.equal(percent.kind, "percent");
  assert.equal(percent.value, 10);
  assert.equal(AlzaCore.parseVoucherText("2 000 Ft kedvezmény, érvényes: 2027. 03. 15.").until, endOfDay(2027, 3, 15));
  assert.equal(AlzaCore.parseVoucherText("1 000 Ft").value, 1000);
  assert.equal(AlzaCore.parseVoucherText("nic tu není").code, null);
});

test("datum poukazu: neplatné datum se nevezme", () => {
  assert.equal(AlzaCore.parseVoucherDate("31.2.2027"), null);
  assert.equal(AlzaCore.parseVoucherDate("2027-02-28"), endOfDay(2027, 2, 28));
});

test("stav poukazu, aktivní pro doménu a chybějící částka do minima", () => {
  const now = endOfDay(2027, 1, 10) - 12 * 60 * 60 * 1000;
  const vouchers = {
    a: { code: "A1", domain: "alza_cz", kind: "amount", value: 100, until: endOfDay(2027, 1, 21) },
    b: { code: "B1", domain: "alza_cz", kind: "amount", value: 200 },
    c: { code: "C1", domain: "alza_cz", kind: "amount", value: 300, until: endOfDay(2027, 1, 5) },
    d: { code: "D1", domain: "alza_cz", kind: "amount", value: 50, usedAt: now - DAY },
    e: { code: "E1", domain: "alza_sk", kind: "amount", value: 5 },
  };
  assert.deepEqual(plain(AlzaCore.getActiveVouchers(vouchers, "alza_cz", now).map(({ id }) => id)), ["a", "b"]);
  assert.equal(AlzaCore.getVoucherState(vouchers.a, now).daysLeft, 12);
  assert.equal(AlzaCore.getVoucherState(vouchers.c, now).state, "expired");
  assert.equal(AlzaCore.getVoucherState(vouchers.d, now).state, "used");
  assert.equal(AlzaCore.getVoucherShortfall({ minOrder: 1000 }, 660), 340);
  assert.equal(AlzaCore.getVoucherShortfall({ minOrder: 1000 }, 1200), 0);
  assert.equal(AlzaCore.getVoucherShortfall({}, 10), 0);
  assert.equal(AlzaCore.formatVoucherValue({ kind: "percent", value: 7.5 }), "7,5 %");
});

test("použitý poukaz: jen uplatněný v košíku a se slevovým řádkem stejné hodnoty", () => {
  const applied = Date.UTC(2027, 0, 10);
  const vouchers = {
    gift: { code: "G1", domain: "alza_cz", kind: "amount", value: 1000, applied },
    apology: { code: "A1", domain: "alza_cz", kind: "amount", value: 100, applied },
    notApplied: { code: "N1", domain: "alza_cz", kind: "amount", value: 100 },
    old: { code: "O1", domain: "alza_cz", kind: "amount", value: 100, applied: applied - 30 * DAY },
  };
  const detail = {
    parts: [
      {
        items: [
          { commodityName: "Myš", pricePerItem: "500 Kč/ks", price: "500 Kč", count: 1, commodityUrl: "/mys-d1.htm", commodityId: 1 },
          { commodityName: "Voucher Sleva na dopravné - AlzaPlus+", pricePerItem: "-69 Kč/ks", price: "-69 Kč", count: 1 },
          { commodityName: "Sleva na zboží - kód", pricePerItem: "-100 Kč/ks", price: "-100 Kč", count: 1 },
          { commodityName: "- Sleva na zboží - dárkový šek (uplatnění, typ H.A.)", pricePerItem: "-400 Kč/ks", price: "-400 Kč", count: 1 },
        ],
      },
    ],
  };
  const lines = AlzaCore.parseOrderVoucherLines(detail);
  assert.deepEqual(plain(lines.map(({ amount }) => amount)), [100, 400]);
  const uses = AlzaCore.matchVoucherUses(vouchers, "alza_cz", { created: applied + 60 * 60 * 1000, orderNumber: 555, lines });
  assert.deepEqual(plain(uses), [
    { id: "gift", usedAt: applied + 60 * 60 * 1000, usedOrder: "555" },
    { id: "apology", usedAt: applied + 60 * 60 * 1000, usedOrder: "555" },
  ]);
  // Objednávka dlouho po uplatnění – nic
  assert.equal(AlzaCore.matchVoucherUses(vouchers, "alza_cz", { created: applied + 10 * DAY, lines }).length, 0);
});

test("připomínky konce platnosti: týden předem a poslední den, každá jednou", () => {
  const until = endOfDay(2027, 1, 21);
  const voucher = { code: "A1", domain: "alza_cz", kind: "amount", value: 100, until };
  assert.equal(AlzaCore.getVoucherReminders({ a: voucher }, until - 10 * DAY).length, 0);
  assert.equal(AlzaCore.getVoucherReminders({ a: voucher }, until - 5 * DAY)[0].step, "soon");
  assert.equal(AlzaCore.getVoucherReminders({ a: { ...voucher, notifiedSoon: true } }, until - 5 * DAY).length, 0);
  assert.equal(AlzaCore.getVoucherReminders({ a: { ...voucher, notifiedSoon: true } }, until - 2 * 60 * 60 * 1000)[0].step, "last");
  assert.equal(AlzaCore.getVoucherReminders({ a: { ...voucher, notifiedLast: true } }, until - 2 * 60 * 60 * 1000).length, 0);
  assert.equal(AlzaCore.getVoucherReminders({ a: { ...voucher, usedAt: 1 } }, until - DAY).length, 0);
  assert.equal(AlzaCore.getVoucherReminders({ a: { ...voucher, until: undefined } }, until - DAY).length, 0);
});

test("uložitelný poukaz: kontrola polí", () => {
  const now = Date.UTC(2027, 0, 1);
  assert.deepEqual(plain(AlzaCore.sanitizeVoucher({ code: " ab12 cd ", domain: "alza_cz", value: "100", note: " omluva ", until: 5, extra: 1 }, now)), {
    code: "AB12CD",
    domain: "alza_cz",
    kind: "amount",
    value: 100,
    until: 5,
    note: "omluva",
    addedAt: now,
  });
  assert.equal(AlzaCore.sanitizeVoucher({ code: "AB", domain: "alza_cz", value: 1 }), null);
  assert.equal(AlzaCore.sanitizeVoucher({ code: "ABC", domain: "x", value: 1 }), null);
  assert.equal(AlzaCore.sanitizeVoucher({ code: "ABC", domain: "alza_cz", kind: "percent", value: 100 }), null);
  assert.equal(AlzaCore.getVoucherId("alza_cz", "ab 12"), "alza_cz_AB12");
});
