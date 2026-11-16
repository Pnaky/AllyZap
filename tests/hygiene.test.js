// Banální chyby, které testy chování nezachytí: syntaxe souborů, které žádný test nespouští, platné JSON, zbytky
// ladění, konflikty sloučení, soukromé údaje v repozitáři, formát verze. Bez závislostí – běží i v pre-commit hooku
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");
// Soubory repozitáře (bez .git a mimo verzování nechaných složek)
function listFiles(dir = "", result = []) {
  for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    if ([".git", "node_modules", "build"].includes(entry.name)) continue;
    const file = path.posix.join(dir, entry.name);
    if (entry.isDirectory()) listFiles(file, result);
    else result.push(file);
  }
  return result;
}
const files = listFiles();
const jsFiles = files.filter((file) => file.endsWith(".js") || file.endsWith(".mjs"));
const textFiles = files.filter((file) => /\.(js|mjs|json|html|css|md|txt|py|sh|swift|plist|yml|yaml)$/.test(file));

test("hygiena: každý JavaScript se dá přeložit (i soubory, které žádný test nespouští)", () => {
  const broken = [];
  for (const file of jsFiles.filter((file) => file.endsWith(".js"))) {
    try {
      new vm.Script(read(file), { filename: file });
    } catch (error) {
      broken.push(`${file}: ${error.message}`);
    }
  }
  assert.deepEqual(broken, []);
});

test("hygiena: manifest a překlady jsou platný JSON, verze ve formátu RRRR.M.D[.N] a ne z budoucnosti", () => {
  const jsonFiles = files.filter((file) => file.endsWith(".json"));
  assert.ok(jsonFiles.includes("manifest.json"));
  for (const file of jsonFiles) assert.doesNotThrow(() => JSON.parse(read(file)), file);
  const { version } = JSON.parse(read("manifest.json"));
  const match = version.match(/^(\d{4})\.(\d{1,2})\.(\d{1,2})(?:\.(\d+))?$/);
  assert.ok(match, `verze ${version}`);
  const [, year, month, day] = match.map(Number);
  const date = new Date(year, month - 1, day);
  assert.equal(date.getMonth(), month - 1, `neexistující datum ve verzi ${version}`);
  assert.ok(date.getTime() <= Date.now() + 86400000, `verze ${version} je z budoucnosti`);
});

test("hygiena: žádné zbytky ladění a konflikty sloučení", () => {
  const problems = [];
  for (const file of textFiles) {
    const lines = read(file).split(/\r?\n/);
    lines.forEach((line, index) => {
      if (/^(<{7}|>{7})( |$)|^={7}$/.test(line)) problems.push(`${file}:${index + 1} konflikt sloučení`);
      if (/\.(js|mjs)$/.test(file) && /^\s*debugger\s*;?\s*$/.test(line)) problems.push(`${file}:${index + 1} debugger`);
    });
  }
  // test.only / describe.only by ostatní testy tiše vypnul (s --test-only), skip / todo vypíná test natrvalo
  for (const file of files.filter((file) => /^tests\/.*\.test\.js$/.test(file) && file !== "tests/hygiene.test.js")) {
    const text = read(file);
    if (/\b(test|it|describe)\.(only|skip|todo)\(/.test(text)) problems.push(`${file}: test.only / skip / todo`);
    if (/\{\s*(only|skip|todo)\s*:/.test(text)) problems.push(`${file}: volba only / skip / todo`);
  }
  assert.deepEqual(problems, []);
});

// Soukromé údaje v textu souboru: e-maily (kromě zjevně vzorových a noreply adres), cesty do domovské složky
// (C:\Users\<jméno>, /Users/<jméno>, /home/<jméno>), IP adresy z privátních rozsahů, tokeny, klíče a čísla účtů z API
const SAMPLE_EMAIL = /@(?:[a-z0-9-]+\.)*(?:example\.(?:com|org|net)|[a-z0-9-]+\.(?:example|test|invalid|localhost))$|^(?:noreply|no-reply)@|@users\.noreply\.github\.com$/i;
const FILE_SUFFIX = /\.(?:png|jpe?g|gif|svg|webp|ico)$/i; // icon@2x.png není e-mail
const SAMPLE_USERS = ["Shared", "Public", "Default", "user", "username", "name", "runner"]; // Obecné složky a zástupná jména
function findPrivateData(text) {
  const found = [];
  // Adresa s přihlašovacími údaji (https://uzivatel:heslo@www.alza.cz v testech) není e-mail
  const withoutUrlLogins = text.replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s/@"'<>]*@/gi, "");
  for (const [email] of withoutUrlLogins.matchAll(/[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}/gi)) {
    if (!SAMPLE_EMAIL.test(email) && !FILE_SUFFIX.test(email)) found.push(`e-mail ${email}`);
  }
  // Jméno za složkou uživatelů; zástupné zápisy (<jméno>, $USER, %USERNAME%, {user}, *) začínají jiným znakem
  for (const [match, user] of text.matchAll(/(?:\b[A-Za-z]:[\\/]+Users[\\/]+|(?<![\w.])\/(?:Users|home)\/)([\p{L}\p{N}][\p{L}\p{N}._-]*)/gu)) {
    if (!SAMPLE_USERS.includes(user)) found.push(`cesta do domovské složky ${match}`);
  }
  for (const [ip] of text.matchAll(/(?<![\d.])(?:10\.\d{1,3}|192\.168|172\.(?:1[6-9]|2\d|3[01]))\.\d{1,3}\.\d{1,3}(?![\d.])/g)) found.push(`privátní IP adresa ${ip}`);
  if (/\b(ghp|gho|github_pat)_[A-Za-z0-9_]{20,}/.test(text)) found.push("token GitHubu");
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(text)) found.push("soukromý klíč");
  // Skutečné číslo účtu v adrese API (testy používají 987654321 a zástupné ${…})
  for (const [, id] of text.matchAll(/\/api\/users\/(\d{5,})\//g)) if (id !== "987654321") found.push(`číslo účtu ${id}`);
  return [...new Set(found)];
}

test("hygiena: v repozitáři nejsou soukromé údaje (e-maily, cesty do domovské složky, privátní IP, tokeny, čísla účtů z API)", () => {
  const problems = [];
  for (const file of textFiles.filter((file) => file !== "tests/hygiene.test.js")) {
    for (const problem of findPrivateData(read(file))) problems.push(`${file}: ${problem}`);
  }
  assert.deepEqual(problems, []);
});

// Vzory samotné (tento soubor se z kontroly výše vynechává, proto tu vzorové případy být smějí)
test("hygiena: vzory soukromých údajů zachytí skutečné a pustí vzorové", () => {
  const caught = [
    "kontakt: jan.novak@gmail.com",
    "napište na autor@seznam.cz nebo jmeno@firma.co.uk",
    "cd C:\\Users\\jannovak\\Documents",
    'path: "C:\\\\Users\\\\jannovak\\\\AppData"',
    "C:/Users/jannovak/projekt",
    "scp soubor /Users/jannovak/Desktop",
    "cesta /home/jannovak/.ssh",
    "ssh uzivatel@192.168.1.10",
    "server 10.0.0.5:8080",
    "brána 172.16.4.1",
    "token ghp_abcdefghijklmnopqrstuvwxyz0123",
    "https://www.alza.cz/api/users/123456789/v1/orders/",
  ];
  caught.forEach((text) => assert.notDeepEqual(findPrivateData(text), [], `nezachyceno: ${text}`));
  const allowed = [
    "user@example.com, jana@firma.example, test@sub.example.org",
    "noreply@github.com a 12345+login@users.noreply.github.com",
    "https://uzivatel:heslo@www.alza.cz/produkt-d1.htm",
    "obrázek icon@2x.png, balíček eslint@10 a web-ext@8.2.0",
    "C:\\Users\\<jméno>\\AppData, /Users/<jméno>, /Users/$USER, /home/{user}, C:\\Users\\%USERNAME%",
    "/Users/Shared a C:\\Users\\Public",
    "Mac OS X 10.15.7, Windows NT 10.0, Chrome/156.0.0.0, verze 2026.11.16.2",
    "veřejná adresa 8.8.8.8 a 172.32.0.1, rozsah 192.169.1.1",
    "https://www.alza.cz/api/users/987654321/v1/orders/ a /api/users/${id}/",
    "https://www.alza.cz/users/prehled a src/home/index.html",
  ];
  allowed.forEach((text) => assert.deepEqual(findPrivateData(text), [], `planý poplach: ${text}`));
});

test("hygiena: changelog obou obchodů začíná sekcí Nevydáno nebo verzí, odrážky nejsou zdvojené", () => {
  for (const file of ["CHANGELOG-chrome.md", "CHANGELOG-firefox.md"]) {
    const text = read(file).replace(/\r\n/g, "\n");
    const first = text.match(/^## (.+)$/m)?.[1];
    assert.ok(first === "Nevydáno" || /^\d{4}\.\d{1,2}\.\d{1,2}$/.test(first), `${file}: první sekce ${first}`);
    // Pod jednou verzí každá odrážka jen jednou (dvakrát vložené řádky z víc session)
    for (const section of text.split(/^## /m).slice(1)) {
      const bullets = section.split("\n").filter((line) => line.startsWith("- "));
      const duplicates = bullets.filter((line, index) => bullets.indexOf(line) !== index);
      assert.deepEqual(duplicates, [], `${file}: zdvojené odrážky v ${section.split("\n")[0]}`);
    }
  }
});
