const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { ROOT, chromeLaunchOptions } = require("./helpers");
const { serve } = require("./fixture-server");

const launch = chromeLaunchOptions();
const skip = !launch && "no Chrome/Chromium found (set CHROME_PATH)";
const EXTRACT = fs.readFileSync(path.join(ROOT, "extension/extract.js"), "utf8");

async function extractFrom(index, urlPath) {
  const { chromium } = require("playwright-core");
  const { srv, port } = await serve(index);
  const browser = await chromium.launch(launch);
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await page.goto(`http://localhost:${port}${urlPath}`);
    await page.waitForLoadState("load");
    return await page.evaluate(`(async () => { ${EXTRACT}; return await extractMcMaster(); })()`);
  } finally {
    await browser.close();
    srv.close();
  }
}

test("part page: picks the product render, not the dimension drawing", { skip }, async () => {
  const r = await extractFrom("mock-part-page.html", "/9541K43/");
  assert.strictEqual(r.kind, "part");
  assert.strictEqual(r.partNumber, "9541K43");
  assert.strictEqual(r.description, 'Threaded-Stud Bumper, Polyurethane, 1/2"-13 Thread, 4" OD, 4" High, Durometer 60A');
  assert.strictEqual(r.url, "https://www.mcmaster.com/9541K43/");
  assert.strictEqual(path.basename(r.images[0]), "render.png");
  assert.ok(r.images.some(u => u.endsWith("drawing.png")), "drawing still offered as an alternative");
});

test("order page: one entry per order line, ignoring the background lists", { skip }, async () => {
  const r = await extractFrom("mock-order-page.html", "/order-history/order/test123/");
  assert.strictEqual(r.kind, "order");
  assert.strictEqual(r.po, "TESTPO1");
  assert.deepStrictEqual(r.lines.map(l => l.partNumber), ["9541K43", "91290A115", "98434A117", "90876A175"]);
  const [bumper, , , wing] = r.lines;
  assert.strictEqual(bumper.description, 'Threaded-Stud Bumper, Polyurethane, 1/2"-13 Thread, 4" OD, 4" High, Durometer 60A');
  assert.strictEqual(bumper.url, "https://www.mcmaster.com/9541K43/");
  assert.strictEqual(bumper.line, "1");
  assert.deepStrictEqual([wing.qty, wing.unit], ["2", "Packs of 1"]);
  for (const l of r.lines) {
    assert.match(l.images[0], /@300p_/, `${l.partNumber} should use the 300 px image`);
    assert.match(l.imageDataUrls[0], /^data:image\/png;base64,/);
  }
});
