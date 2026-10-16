// Reads a McMaster part page with a headless Chrome (playwright-core) and
// runs the extension's own extractor in it, so the server gets exactly what
// the popup would: part number, description and 300 px picture data URLs.
// No login is needed for part pages. The browser is launched on first use and
// closed again after a period without jobs.
const fs = require("fs");
const path = require("path");

const EXTRACT = fs.readFileSync(path.join(__dirname, "../extension/extract.js"), "utf8");

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/opt/pw-browsers/chromium",
  "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"
];

function findChrome(configured) {
  return [configured, ...CHROME_CANDIDATES].filter(Boolean).find(p => fs.existsSync(p)) || null;
}

function createPartFetcher({ chromePath = "", idleMs = 300000, baseUrl = "https://www.mcmaster.com", log = () => {} } = {}) {
  let browser = null, idleTimer = null, launching = null;

  async function getBrowser() {
    if (browser && browser.isConnected()) return browser;
    if (launching) return launching;
    launching = (async () => {
      const exe = findChrome(chromePath);
      if (!exe) throw new Error("No Chrome/Chromium found; set chromePath in the config");
      const { chromium } = require("playwright-core");
      log(`launching ${exe}`);
      browser = await chromium.launch({ executablePath: exe, headless: false, args: ["--headless=new"] });
      browser.on("disconnected", () => { browser = null; });
      return browser;
    })();
    try { return await launching; } finally { launching = null; }
  }

  function touchIdle() {
    clearTimeout(idleTimer);
    if (idleMs > 0) idleTimer = setTimeout(close, idleMs).unref?.();
  }

  async function close() {
    clearTimeout(idleTimer);
    const b = browser; browser = null;
    if (b) { log("closing browser"); await b.close().catch(() => {}); }
  }

  // -> { kind: "part", partNumber, description, url, images[], imageDataUrls[] }
  async function fetchPart(partNumber) {
    const b = await getBrowser();
    const page = await b.newPage({ viewport: { width: 1400, height: 900 } });
    try {
      await page.goto(`${baseUrl}/${partNumber}/`, { waitUntil: "load", timeout: 30000 });
      await page.waitForSelector("h1", { timeout: 10000 }).catch(() => {});
      await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
      let r = await page.evaluate(`(async () => { ${EXTRACT}; return await extractMcMaster(); })()`);
      if (r.kind !== "part" || !r.description) {
        await page.waitForTimeout(2000);
        r = await page.evaluate(`(async () => { ${EXTRACT}; return await extractMcMaster(); })()`);
      }
      if (r.kind !== "part" || !r.partNumber) throw new Error(`${partNumber}: not a part page`);
      return r;
    } finally {
      await page.close().catch(() => {});
      touchIdle();
    }
  }

  return { fetchPart, close, findChrome: () => findChrome(chromePath) };
}

module.exports = { createPartFetcher, findChrome };
