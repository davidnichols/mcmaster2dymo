// Renders a label with the extension's label.js (node-canvas) and sends it to
// DYMO Connect with the extension's dymo.js, through a fetch that accepts the
// service's self-signed certificate.
const https = require("https");
const path = require("path");
const { createCanvas, loadImage } = require("canvas");
const Label = require(path.join(__dirname, "../extension/label.js"));
const qrcode = require(path.join(__dirname, "../extension/lib/qrcode.js"));
const { createDymoClient } = require(path.join(__dirname, "../extension/dymo.js"));

// fetch-alike on top of https.request so the local self-signed cert is accepted.
function insecureFetch(url, init = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      method: init.method || "GET", headers: init.headers || {}, rejectUnauthorized: false
    }, res => {
      const chunks = [];
      res.on("data", c => chunks.push(c));
      res.on("end", () => resolve({
        ok: res.statusCode >= 200 && res.statusCode < 300,
        status: res.statusCode,
        text: async () => Buffer.concat(chunks).toString("utf8")
      }));
    });
    req.on("error", reject);
    if (init.signal) init.signal.addEventListener("abort", () => req.destroy(new Error("aborted")));
    if (init.body != null) req.write(String(init.body));
    req.end();
  });
}

function sizeFor(key) {
  return Label.LABEL_SIZES[key] || Label.LABEL_SIZES["30336"];
}

async function firstImage(part) {
  for (const src of [...(part.imageDataUrls || []), ...(part.images || [])]) {
    try { return await loadImage(src); } catch (_) {}
  }
  return null;
}

// Same geometry as the popup's renderForDymo(): sized to the printable area
// declared in the label XML.
async function renderForDymo(part, { size, layout, showImage }) {
  const s = sizeFor(size);
  const b = Label.dymoBounds(s);
  const image = showImage ? await firstImage(part) : null;
  const canvas = Label.renderLabel(
    { partNumber: part.partNumber, description: part.description || "", url: part.url },
    { widthIn: b.w / 1440, heightIn: b.h / 1440, padIn: 0.02, image, layout, makeCanvas: createCanvas, qrcode }
  );
  return { canvas, png: canvas.toBuffer("image/png"), size: s, hasImage: !!image };
}

function createPrinter({ dymo = createDymoClient({ fetch: insecureFetch }) } = {}) {
  async function choosePrinter(preferred) {
    const printers = await dymo.getPrinters();
    if (preferred) {
      const p = printers.find(p => p.name === preferred);
      if (!p) throw new Error(`Printer "${preferred}" not found (have: ${printers.map(p => p.name).join(", ") || "none"})`);
      return p.name;
    }
    const p = printers.find(p => /550/.test(p.name) && p.connected) || printers.find(p => p.connected) || printers[0];
    if (!p) throw new Error("No DYMO printers found");
    return p.name;
  }

  async function print(part, opts) {
    const r = await renderForDymo(part, opts);
    const printer = await choosePrinter(opts.printer);
    try {
      await dymo.printLabel(printer, Label.dymoLabelXml(r.size, r.png.toString("base64")), opts.copies);
    } catch (e) { dymo.reset(); throw e; }
    return { ...r, printer };
  }

  async function status() {
    try { return { ok: true, printers: await dymo.getPrinters() }; }
    catch (e) { dymo.reset(); return { ok: false, error: e.message, printers: [] }; }
  }

  return { print, status, renderForDymo, choosePrinter };
}

module.exports = { createPrinter, renderForDymo, insecureFetch, Label };
