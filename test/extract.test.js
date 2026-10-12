const test = require("node:test");
const assert = require("node:assert");
const http = require("http");
const fs = require("fs");
const path = require("path");
const { ROOT, chromeLaunchOptions } = require("./helpers");

const launch = chromeLaunchOptions();

test("extractor picks the product render, not the dimension drawing", { skip: !launch && "no Chrome/Chromium found (set CHROME_PATH)" }, async () => {
  const { chromium } = require("playwright-core");
  const fx = path.join(__dirname, "fixtures");
  const srv = http.createServer((req, res) => {
    const u = req.url.split("?")[0];
    const f = path.join(fx, u.endsWith("/") ? "mock-part-page.html" : path.basename(u));
    if (fs.existsSync(f)) res.end(fs.readFileSync(f)); else { res.statusCode = 404; res.end(); }
  });
  await new Promise(r => srv.listen(0, r));
  const port = srv.address().port;
  const browser = await chromium.launch(launch);
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await page.goto(`http://localhost:${port}/9541K43/`);
    await page.waitForLoadState("load");
    const src = fs.readFileSync(path.join(ROOT, "extension/extract.js"), "utf8");
    const result = await page.evaluate(`(async () => { ${src}; return await extractMcMaster(); })()`);
    assert.strictEqual(result.partNumber, "9541K43");
    assert.strictEqual(result.description, 'Threaded-Stud Bumper, Polyurethane, 1/2"-13 Thread, 4" OD, 4" High, Durometer 60A');
    assert.strictEqual(result.url, "https://www.mcmaster.com/9541K43/");
    assert.strictEqual(path.basename(result.images[0]), "render.png");
    assert.ok(result.images.some(u => u.endsWith("drawing.png")), "drawing still offered as an alternative");
  } finally {
    await browser.close();
    srv.close();
  }
});
