// Limity obchodů pro název a krátký popis rozšíření (_locales/<jazyk>/messages.json): Safari / App Store bere popis
// nejvýš 112 znaků (export pro App Store Connect jinak selže: „The description field must be … 112 or fewer
// characters“), Chrome Web Store 132, název 75 (Chrome) a 30 (název aplikace v App Store) – platí nejpřísnější
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const LIMITS = { name: 30, description: 112 };

test("název a krátký popis rozšíření se vejdou do limitů všech obchodů (Safari 112 znaků)", () => {
  const locales = fs.readdirSync(path.join(ROOT, "_locales"));
  assert.ok(locales.length >= 4, "čekám aspoň 4 jazyky");
  const problems = [];
  for (const locale of locales) {
    const messages = JSON.parse(fs.readFileSync(path.join(ROOT, "_locales", locale, "messages.json"), "utf8"));
    for (const [key, limit] of Object.entries(LIMITS)) {
      const text = messages[key]?.message;
      if (typeof text !== "string" || !text.trim()) problems.push(`${locale}: chybí ${key}`);
      else if ([...text].length > limit) problems.push(`${locale}: ${key} má ${[...text].length} znaků (limit ${limit})`);
    }
  }
  assert.deepStrictEqual(problems, []);
});
