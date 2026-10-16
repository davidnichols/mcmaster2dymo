const path = require("path");
const fs = require("fs");
const { createCanvas, loadImage } = require("canvas");
const jsQR = require("jsqr");

const ROOT = path.join(__dirname, "..");
const Label = require(path.join(ROOT, "extension/label.js"));
const qrcode = require(path.join(ROOT, "extension/lib/qrcode.js"));
const fixture = name => path.join(__dirname, "fixtures", name);

function render(part, { size = "30336", layout = "classic", image = null } = {}) {
  const s = Label.LABEL_SIZES[size];
  return Label.renderLabel(part, {
    widthIn: s.width, heightIn: s.height, padIn: 0.06, leftPadIn: 0.1,
    image, layout, makeCanvas: createCanvas, qrcode
  });
}

function decodeQR(canvas) {
  // Add a white quiet zone so the decoder has room.
  const m = 40, c = createCanvas(canvas.width + m * 2, canvas.height + m * 2);
  const g = c.getContext("2d");
  g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height);
  g.drawImage(canvas, m, m);
  const d = g.getImageData(0, 0, c.width, c.height);
  const r = jsQR(d.data, d.width, d.height);
  return r ? r.data : null;
}

// Playwright's downloaded Chromium (`npx playwright-core install chromium`):
// <cache>/chromium-<build>/chrome-<platform>/<binary>. Newest build first.
function playwrightChromium() {
  const home = process.env.HOME || process.env.USERPROFILE || "";
  const cache = process.env.PLAYWRIGHT_BROWSERS_PATH || {
    darwin: path.join(home, "Library/Caches/ms-playwright"),
    linux: path.join(home, ".cache/ms-playwright"),
    win32: path.join(process.env.LOCALAPPDATA || "", "ms-playwright")
  }[process.platform] || "";
  if (!cache || !fs.existsSync(cache)) return [];
  const builds = fs.readdirSync(cache)
    .filter(d => /^chromium-\d+$/.test(d))
    .sort((a, b) => Number(b.slice(9)) - Number(a.slice(9)));
  const mac = "Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
  return builds.flatMap(b => [
    path.join(cache, b, "chrome-mac-arm64", mac),
    path.join(cache, b, "chrome-mac-x64", mac),
    path.join(cache, b, "chrome-mac", "Chromium.app/Contents/MacOS/Chromium"),
    path.join(cache, b, "chrome-linux64", "chrome"),
    path.join(cache, b, "chrome-linux", "chrome"),
    path.join(cache, b, "chrome-win64", "chrome.exe"),
    path.join(cache, b, "chrome-win", "chrome.exe")
  ]);
}

// Find a browser for the browser-backed tests: $CHROME_PATH, Playwright's
// Chromium, the cloud container's Chromium, or a locally installed Chrome.
// Chromium builds come before branded Google Chrome because Chrome 137+
// ignores --load-extension, which popup.e2e.test.js needs; the extractor and
// server tests are happy with either.
function chromeLaunchOptions() {
  const candidates = [
    process.env.CHROME_PATH,
    ...playwrightChromium(),
    "/opt/pw-browsers/chromium",
    "/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"
  ].filter(Boolean);
  const exe = candidates.find(p => fs.existsSync(p));
  return exe ? { executablePath: exe, headless: false, args: ["--headless=new"] } : null;
}

const SAMPLE_PARTS = {
  screw: { partNumber: "91290A115", description: "Black-Oxide Alloy Steel Socket Head Screw, M3 x 0.5 mm Thread, 8 mm Long", url: "https://www.mcmaster.com/91290A115/" },
  collar: { partNumber: "6100K152", description: 'Shaft Collar, Clamp-On, Two-Piece, 1/2" Bore, Black-Oxide 1215 Carbon Steel, 1-1/8" OD, 13/32" Wide, with Set Screw Clearance', url: "https://www.mcmaster.com/6100K152/" },
  bumper: { partNumber: "9541K43", description: 'Threaded-Stud Bumper, Polyurethane, 1/2"-13 Thread, 4" OD, 4" High, Durometer 60A', url: "https://www.mcmaster.com/9541K43/" }
};

module.exports = { ROOT, Label, qrcode, fixture, render, decodeQR, loadImage, createCanvas, chromeLaunchOptions, SAMPLE_PARTS };
