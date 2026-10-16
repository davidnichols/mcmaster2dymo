// Loads the real extension in Chromium, serves the order fixture as if it were
// www.mcmaster.com, fakes the DYMO Connect web service, and prints.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { ROOT, chromeLaunchOptions } = require("./helpers");
const { fixtureResponse } = require("./fixture-server");

const launch = chromeLaunchOptions();
const EXT = path.join(ROOT, "extension");
const SHOTS = process.env.E2E_SCREENSHOTS; // optional folder for popup screenshots

async function withExtension(fn) {
  const { chromium } = require("playwright-core");
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "mcm2dymo-"));
  const ctx = await chromium.launchPersistentContext(profile, {
    ...launch,
    args: [...(launch.args || []), `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`]
  });
  const printed = [];
  // Fake www.mcmaster.com with the fixtures.
  await ctx.route(/^https:\/\/www\.mcmaster\.com\//, route => {
    const u = new URL(route.request().url());
    const p = u.pathname.replace(/^\/(order-history\/order\/[^/]+|[0-9A-Z]+)\//, "/");
    const index = u.pathname.startsWith("/order-history/") ? "mock-order-page.html" : "mock-part-page.html";
    const r = fixtureResponse(p, index);
    return r ? route.fulfill({ body: r.body, contentType: r.type }) : route.fulfill({ status: 404, body: "" });
  });
  // Fake DYMO Connect.
  await ctx.route(/^https:\/\/(127\.0\.0\.1|localhost):41951\//, async route => {
    const u = route.request().url();
    if (u.endsWith("/StatusConnected")) return route.fulfill({ body: "true" });
    if (u.endsWith("/GetPrinters")) return route.fulfill({ body:
      "<Printers><LabelWriterPrinter><Name>DYMO LabelWriter 550</Name><ModelName>DYMO LabelWriter 550</ModelName>" +
      "<IsConnected>True</IsConnected></LabelWriterPrinter></Printers>" });
    if (u.endsWith("/PrintLabel")) {
      const body = new URLSearchParams(route.request().postData());
      printed.push({
        printer: body.get("printerName"),
        copies: +(body.get("printParamsXml").match(/<Copies>(\d+)/) || [])[1],
        hasImage: /<Image>[A-Za-z0-9+/=]{100,}<\/Image>/.test(body.get("labelXml"))
      });
      return route.fulfill({ body: "true" });
    }
    return route.fulfill({ status: 404, body: "" });
  });
  // Fake shop print server: the popup adopts its label settings and pushes changes back.
  const shopSettings = { size: "30336", layout: "banner", showImage: true };
  const shopPosts = [];
  await ctx.route(/^http:\/\/(localhost|127\.0\.0\.1):41952\//, route => {
    const u = route.request().url();
    if (u.endsWith("/status")) return route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, settings: shopSettings }) });
    if (u.endsWith("/settings")) { shopPosts.push(JSON.parse(route.request().postData() || "{}")); return route.fulfill({ contentType: "application/json", body: '{"ok":true}' }); }
    return route.fulfill({ status: 404, body: "" });
  });
  try {
    const page = await ctx.newPage();
    await page.goto("chrome://extensions");
    const id = await page.evaluate(() => new Promise(r =>
      chrome.management.getAll(l => r(l.find(e => /DYMO/.test(e.name))?.id))));
    // Branded Google Chrome >= 137 ignores --load-extension; use Chromium (CHROME_PATH).
    if (!id) throw new Error(`extension not loaded by ${launch.executablePath}; point CHROME_PATH at a Chromium build`);
    await fn({ ctx, page, id, printed, shopPosts });
  } finally {
    await ctx.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
}

async function openPopupFor(ctx, page, id, url) {
  await page.goto(url);
  await page.waitForLoadState("load");
  // Open an extension page first so we can look up the McMaster tab's id.
  const ext = await ctx.newPage();
  await ext.goto(`chrome-extension://${id}/popup.html`);
  const target = await ext.evaluate(u => new Promise(r => chrome.tabs.query({ url: u }, t => r(t[0].id))), url);
  const errors = [];
  ext.on("pageerror", e => errors.push(e.message));
  await ext.setViewportSize({ width: 380, height: 600 });
  await ext.goto(`chrome-extension://${id}/popup.html?tab=${target}`);
  return { popup: ext, errors };
}

test("order page: lists every line and prints them all via DYMO", { skip: !launch && "no Chrome/Chromium found" }, async () => {
  await withExtension(async ({ ctx, page, id, printed }) => {
    const { popup, errors } = await openPopupFor(ctx, page, id, "https://www.mcmaster.com/order-history/order/test123/");
    await popup.waitForSelector("#lines li");
    await popup.waitForFunction(() => /Print \d+ label/.test(document.getElementById("print").textContent));
    assert.strictEqual(await popup.$$eval("#lines li", l => l.length), 4);
    assert.match(await popup.textContent("#orderTitle"), /TESTPO1 · 4 lines/);
    assert.strictEqual(await popup.$$eval("#lines li .thumb canvas", l => l.length), 4);
    await popup.waitForFunction(() => document.getElementById("printer").value === "DYMO LabelWriter 550");

    // Skip line 3, print 2 copies of line 4.
    await popup.locator("#lines li").nth(2).locator(".sel").uncheck();
    await popup.locator("#lines li").nth(3).locator(".cp").fill("2");
    assert.strictEqual(await popup.textContent("#print"), "Print 4 labels");
    // Clicking a line shows it in the preview/description box.
    await popup.locator("#lines li").nth(1).locator(".info").click();
    assert.match(await popup.inputValue("#desc"), /Socket Head Screw/);
    if (SHOTS) await popup.screenshot({ path: path.join(SHOTS, "popup-order.png") });

    await popup.click("#print");
    await popup.waitForFunction(() => /Printed 3 labels/.test(document.getElementById("status").textContent));
    assert.deepStrictEqual(printed.map(p => p.copies), [1, 1, 2]);
    assert.ok(printed.every(p => p.printer === "DYMO LabelWriter 550" && p.hasImage));
    assert.deepStrictEqual(errors, []);
  });
});

test("part page: still prints a single label", { skip: !launch && "no Chrome/Chromium found" }, async () => {
  await withExtension(async ({ ctx, page, id, printed, shopPosts }) => {
    const { popup, errors } = await openPopupFor(ctx, page, id, "https://www.mcmaster.com/9541K43/");
    await popup.waitForFunction(() => document.getElementById("partNo").textContent === "9541K43");
    assert.ok(!(await popup.isVisible("#orderBox")));
    await popup.waitForFunction(() => document.getElementById("printer").value === "DYMO LabelWriter 550");
    // Layout came from the (fake) shop print server; changing it is pushed back.
    assert.strictEqual(await popup.inputValue("#layout"), "banner");
    await popup.selectOption("#layout", "textonly");
    await popup.waitForFunction(() => /shop print server/.test(document.getElementById("status").textContent));
    assert.deepStrictEqual(shopPosts.at(-1), { size: "30336", layout: "textonly", showImage: true });
    if (SHOTS) await popup.screenshot({ path: path.join(SHOTS, "popup-part.png"), fullPage: true });
    await popup.click("#print");
    await popup.waitForFunction(() => /Printed ✓/.test(document.getElementById("status").textContent));
    assert.strictEqual(printed.length, 1);
    assert.deepStrictEqual(errors, []);
  });
});
