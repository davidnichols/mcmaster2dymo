// Shop print server: share-sheet parsing, the HTTP app with a fake part
// fetcher and fake DYMO service, and (when Chrome is available) the headless
// part fetcher against the mock part page.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { fixture, decodeQR, createCanvas, loadImage, chromeLaunchOptions } = require("./helpers");
const { partNumbersFrom } = require("../server/share");
const { createApp } = require("../server/app");
const { createPrinter, Label } = require("../server/print");
const { createPartFetcher } = require("../server/mcmaster");
const { serve } = require("./fixture-server");

test("partNumbersFrom: URLs, text, bare numbers", () => {
  assert.deepStrictEqual(partNumbersFrom("https://www.mcmaster.com/9541K43/"), ["9541K43"]);
  assert.deepStrictEqual(partNumbersFrom("https://www.mcmaster.com/91290a115"), ["91290A115"]);
  assert.deepStrictEqual(partNumbersFrom("Check out https://www.mcmaster.com/9541K43/ on McMaster-Carr"), ["9541K43"]);
  assert.deepStrictEqual(partNumbersFrom("9541K43"), ["9541K43"]);
  assert.deepStrictEqual(partNumbersFrom('Bumper 1/2"-13 Thread 4" OD, M3 x 0.5 mm, 10mm long: 9541K43, 9541K43 and 6100K152'),
    ["9541K43", "6100K152"]);
  assert.deepStrictEqual(partNumbersFrom("https://www.mcmaster.com/products/screws/", "9541K43"), ["9541K43"]);
  assert.deepStrictEqual(partNumbersFrom("nothing here 12 ab 34"), []);
  assert.deepStrictEqual(partNumbersFrom(""), []);
});

// Fake DYMO client with the same surface as extension/dymo.js.
function fakeDymo({ printers = [{ name: "DYMO LabelWriter 550", model: "LW550", connected: true }], fail = false } = {}) {
  const printed = [];
  return {
    printed,
    async getPrinters() { if (fail) throw new Error("DYMO Connect web service not reachable"); return printers; },
    async printLabel(printer, xml, copies) {
      printed.push({ printer, copies, hasImage: /<Image>[A-Za-z0-9+/=]{100,}<\/Image>/.test(xml), xml });
      return true;
    },
    reset() {}
  };
}

const SCREW = { partNumber: "91290A115", description: "Black-Oxide Alloy Steel Socket Head Screw, M3 x 0.5 mm Thread, 8 mm Long",
  url: "https://www.mcmaster.com/91290A115/" };
const screwDataUrl = "data:image/png;base64," + fs.readFileSync(fixture("screw.png")).toString("base64");

function makeApp(overrides = {}) {
  const dymo = fakeDymo(overrides.dymo);
  const fetched = [];
  const config = { port: 0, token: "", printer: "", size: "30336", layout: "classic", showImage: true, copies: 1,
    printWithoutDetails: true, _file: "/tmp/x.json", ...overrides.config };
  const fetchPart = overrides.fetchPart || (async pn => {
    fetched.push(pn);
    if (pn === "91290A115") return { kind: "part", ...SCREW, images: [], imageDataUrls: [screwDataUrl] };
    throw new Error("not a part page");
  });
  const app = createApp({ config, fetchPart, printer: createPrinter({ dymo }), log: () => {} });
  return { app, dymo, fetched, config };
}

async function listen(app) {
  await new Promise(r => app.server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  return { base, close: () => new Promise(r => app.server.close(r)) };
}

test("POST /print with a shared URL prints a full label", async () => {
  const { app, dymo, fetched } = makeApp();
  const { base, close } = await listen(app);
  try {
    const r = await fetch(base + "/print", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "https://www.mcmaster.com/91290A115/", copies: 2 }) });
    const j = await r.json();
    assert.strictEqual(r.status, 200, JSON.stringify(j));
    assert.strictEqual(j.ok, true);
    assert.match(j.message, /Printed 91290A115/);
    assert.deepStrictEqual(fetched, ["91290A115"]);
    assert.strictEqual(dymo.printed.length, 1);
    assert.deepStrictEqual([dymo.printed[0].printer, dymo.printed[0].copies, dymo.printed[0].hasImage], ["DYMO LabelWriter 550", 2, true]);
    assert.strictEqual(j.labels[0].description, SCREW.description);

    // The rendered label is served for the status page and its QR decodes.
    const png = await fetch(`${base}/jobs/${j.id}/91290A115.png`);
    assert.strictEqual(png.status, 200);
    const img = await loadImage(Buffer.from(await png.arrayBuffer()));
    const c = createCanvas(img.width, img.height); c.getContext("2d").drawImage(img, 0, 0);
    assert.strictEqual(decodeQR(c), SCREW.url);

    const page = await (await fetch(base + "/")).text();
    assert.match(page, /91290A115/);
    assert.match(page, /DYMO LabelWriter 550/);
  } finally { await close(); }
});

test("form post (iOS Shortcut style) and GET ?pn= both work; bad input is a 400", async () => {
  const { app, dymo } = makeApp();
  const { base, close } = await listen(app);
  try {
    let r = await fetch(base + "/print", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ text: "Socket Head Screw https://www.mcmaster.com/91290A115/" }) });
    assert.strictEqual(r.status, 200);
    r = await fetch(base + "/print?pn=91290A115&copies=3");
    assert.strictEqual((await r.json()).labels[0].copies, 3);
    r = await fetch(base + "/print", { method: "POST", headers: { "content-type": "text/plain" }, body: "91290A115" });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(dymo.printed.length, 3);
    r = await fetch(base + "/print", { method: "POST", headers: { "content-type": "text/plain" }, body: "hello" });
    assert.strictEqual(r.status, 400);
    assert.match((await r.json()).message, /No McMaster part number/);
    r = await fetch(base + "/print", { method: "POST", body: "" });
    assert.strictEqual(r.status, 400);
  } finally { await close(); }
});

test("unreadable part still prints number + QR when printWithoutDetails is on, and fails otherwise", async () => {
  let { app, dymo } = makeApp();
  let { base, close } = await listen(app);
  try {
    const r = await fetch(base + "/print?pn=9541K43");
    const j = await r.json();
    assert.strictEqual(r.status, 200);
    assert.strictEqual(j.labels[0].note, "printed without description/picture");
    assert.strictEqual(dymo.printed.length, 1);
  } finally { await close(); }

  ({ app, dymo } = makeApp({ config: { printWithoutDetails: false } }));
  ({ base, close } = await listen(app));
  try {
    const r = await fetch(base + "/print?pn=9541K43");
    assert.strictEqual(r.status, 502);
    assert.match((await r.json()).message, /Couldn't read McMaster/);
    assert.strictEqual(dymo.printed.length, 0);
  } finally { await close(); }
});

test("DYMO down -> 502 with the reason; token enforced when configured", async () => {
  let { app } = makeApp({ dymo: { fail: true } });
  let { base, close } = await listen(app);
  try {
    const r = await fetch(base + "/print?pn=91290A115");
    assert.strictEqual(r.status, 502);
    assert.match((await r.json()).message, /not reachable/);
    assert.match(await (await fetch(base + "/")).text(), /not reachable/);
  } finally { await close(); }

  ({ app } = makeApp({ config: { token: "s3cret" } }));
  ({ base, close } = await listen(app));
  try {
    assert.strictEqual((await fetch(base + "/print?pn=91290A115")).status, 401);
    assert.strictEqual((await fetch(base + "/print?pn=91290A115&token=s3cret")).status, 200);
    assert.strictEqual((await fetch(base + "/print?pn=91290A115", { headers: { authorization: "Bearer s3cret" } })).status, 200);
    assert.match(await (await fetch(base + "/shortcut")).text(), /token=s3cret/);
  } finally { await close(); }
});

test("jobs run one at a time, in order", async () => {
  let active = 0, maxActive = 0;
  const { app } = makeApp({ fetchPart: async pn => {
    active++; maxActive = Math.max(maxActive, active);
    await new Promise(r => setTimeout(r, 20));
    active--;
    return { kind: "part", partNumber: pn, description: "d", url: `https://www.mcmaster.com/${pn}/`, images: [], imageDataUrls: [] };
  } });
  const results = await Promise.all(["9541K43", "6100K152", "91290A115"].map(pn => app.enqueue(pn, 1)));
  assert.strictEqual(maxActive, 1);
  assert.deepStrictEqual(results.map(j => j.labels[0].partNumber), ["9541K43", "6100K152", "91290A115"]);
});

test("status page offers every layout with a preview; choosing one is saved to the config file", async () => {
  const os = require("os");
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "mcm2dymo-cfg-")), "config.json");
  const { app, config, dymo } = makeApp({ config: { _file: file, layout: "classic" } });
  const { base, close } = await listen(app);
  try {
    const page = await (await fetch(base + "/")).text();
    for (const [k, v] of Object.entries(Label.LAYOUTS)) {
      assert.match(page, new RegExp(`/preview/${k}\\.png`));
      assert.ok(page.includes(v.name), v.name);
    }
    assert.match(page, /class="tpl on">\s*<input type="radio" name="layout" value="classic"/);

    // Sample-part previews render, decode, and differ per layout.
    const png = async k => Buffer.from(await (await fetch(`${base}/preview/${k}.png`)).arrayBuffer());
    const a = await png("classic"), b = await png("textonly");
    assert.ok(a.length > 1000 && !a.equals(b));
    const img = await loadImage(a);
    const c = createCanvas(img.width, img.height); c.getContext("2d").drawImage(img, 0, 0);
    assert.strictEqual(decodeQR(c), "https://www.mcmaster.com/91290A115/");
    assert.strictEqual((await fetch(`${base}/preview/nope.png`)).status, 404);

    // Pick a template (form post, as the page does) -> persisted and used for the next print.
    let r = await fetch(base + "/settings", { method: "POST", redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ _form: "1", layout: "textonly", size: "30252" }) });
    assert.strictEqual(r.status, 303);
    assert.deepStrictEqual([config.layout, config.size, config.showImage], ["textonly", "30252", false]);
    const saved = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.deepStrictEqual([saved.layout, saved.size, saved.showImage, saved._file], ["textonly", "30252", false, undefined]);
    await fetch(base + "/print?pn=91290A115");
    assert.match(dymo.printed[0].xml, /30252 Address/);
    assert.strictEqual(dymo.printed[0].hasImage, true, "label image is always embedded");

    // The extension popup syncs via a cross-origin JSON POST: preflight must pass.
    r = await fetch(base + "/settings", { method: "OPTIONS", headers: { origin: "chrome-extension://abc",
      "access-control-request-method": "POST", "access-control-request-headers": "content-type" } });
    assert.strictEqual(r.status, 204);
    assert.strictEqual(r.headers.get("access-control-allow-origin"), "*");
    assert.match(r.headers.get("access-control-allow-headers"), /content-type/);

    // JSON works too and ignores unknown layouts.
    r = await fetch(base + "/settings", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ layout: "bogus", showImage: true }) });
    assert.deepStrictEqual((await r.json()).settings.layout, "textonly");
    assert.strictEqual(config.showImage, true);
    assert.match(await (await fetch(base + "/")).text(), /class="tpl on">\s*<input type="radio" name="layout" value="textonly"/);
  } finally { await close(); }
});

const launch = chromeLaunchOptions();
test("headless fetcher runs the extractor on a part page", { skip: !launch && "no Chrome/Chromium found (set CHROME_PATH)" }, async () => {
  const { srv, port } = await serve("mock-part-page.html");
  const f = createPartFetcher({ chromePath: launch.executablePath, baseUrl: `http://localhost:${port}`, idleMs: 0 });
  try {
    const r = await f.fetchPart("9541K43");
    assert.strictEqual(r.partNumber, "9541K43");
    assert.match(r.description, /Threaded-Stud Bumper/);
    assert.strictEqual(path.basename(r.images[0]), "render.png");
  } finally { await f.close(); srv.close(); }
});
