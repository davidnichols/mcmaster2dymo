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

// Find a browser for the page-extractor test: $CHROME_PATH, the cloud
// container's Chromium, or a locally installed Chrome.
function chromeLaunchOptions() {
  const candidates = [
    process.env.CHROME_PATH,
    "/opt/pw-browsers/chromium",
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
