// HTTP front of the shop print server. One endpoint matters:
//   POST /print   body: JSON {text|url, copies}, a form, or plain text
//   GET  /print?pn=9541K43[&copies=2]
// Both answer JSON { ok, message, labels: [...] }. Jobs run one at a time.
// GET / is a status page with a print form and recent jobs; GET /shortcut
// walks through setting up the iPhone Shortcut.
const http = require("http");
const os = require("os");
const { partNumbersFrom } = require("./share");
const { Label, SAMPLE_PART } = require("./print");
const configStore = require("./config");

const MAX_JOBS = 30;

function esc(s) {
  return String(s ?? "").replace(/[<>&"]/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", c => { chunks.push(c); if (chunks.reduce((a, b) => a + b.length, 0) > 1e6) req.destroy(); });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

// Pull { text, copies, token } out of whatever the client sent.
function parseRequest(req, url, body) {
  const out = { text: "", copies: undefined, token: url.searchParams.get("token") || "" };
  const auth = req.headers.authorization || "";
  if (/^bearer /i.test(auth)) out.token = auth.slice(7).trim();
  const q = ["pn", "text", "url"].map(k => url.searchParams.get(k)).filter(Boolean).join("\n");
  if (q) out.text = q;
  if (url.searchParams.get("copies")) out.copies = +url.searchParams.get("copies");

  const type = (req.headers["content-type"] || "").toLowerCase();
  if (!body) return out;
  let fields = null;
  if (type.includes("json")) {
    try { fields = JSON.parse(body); } catch (_) { fields = null; }
  } else if (type.includes("x-www-form-urlencoded")) {
    fields = Object.fromEntries(new URLSearchParams(body));
  }
  if (fields && typeof fields === "object") {
    const t = ["pn", "text", "url", "input"].map(k => fields[k]).filter(Boolean).join("\n");
    if (t) out.text = [out.text, t].filter(Boolean).join("\n");
    if (fields.copies != null && fields.copies !== "") out.copies = +fields.copies;
    if (fields.token) out.token = String(fields.token);
  } else {
    out.text = [out.text, body].filter(Boolean).join("\n");
  }
  return out;
}

function createApp({ config, fetchPart, printer, log = console.log }) {
  const jobs = [];       // newest first
  let nextId = 1;
  let queue = Promise.resolve();
  let lastPart = null;   // most recently fetched part, used for template previews
  const previews = new Map(); // "layout|size|showImage|pn" -> png

  function settings() {
    return { size: config.size, layout: config.layout, showImage: config.showImage, printer: config.printer };
  }

  async function runJob(input, copies) {
    const pns = partNumbersFrom(input);
    const job = { id: nextId++, time: new Date().toISOString(), input: String(input).slice(0, 300), labels: [] };
    jobs.unshift(job);
    if (jobs.length > MAX_JOBS) jobs.length = MAX_JOBS;
    if (!pns.length) { job.error = "No McMaster part number found"; return job; }

    for (const pn of pns) {
      const label = { partNumber: pn, description: "", copies, ok: false };
      job.labels.push(label);
      let part;
      try {
        part = await fetchPart(pn);
        label.description = part.description || "";
        if (part.description && part.imageDataUrls?.length && lastPart?.partNumber !== pn) { lastPart = part; previews.clear(); }
      } catch (e) {
        log(`fetch ${pn}: ${e.message}`);
        if (!config.printWithoutDetails) { label.error = `Couldn't read McMaster: ${e.message}`; continue; }
        label.note = "printed without description/picture";
        part = { partNumber: pn, description: "", url: `https://www.mcmaster.com/${pn}/` };
      }
      try {
        const r = await printer.print(part, { ...settings(), copies });
        label.ok = true; label.png = r.png; label.printer = r.printer;
        log(`printed ${pn} ×${copies} on ${r.printer}`);
      } catch (e) {
        log(`print ${pn}: ${e.message}`);
        label.error = e.message;
      }
    }
    return job;
  }

  function enqueue(input, copies) {
    const p = queue.then(() => runJob(input, copies));
    queue = p.catch(() => {});
    return p;
  }

  function summarize(job) {
    const ok = job.labels.filter(l => l.ok), bad = job.labels.filter(l => !l.ok);
    let message;
    if (job.error) message = job.error;
    else if (!bad.length) message = `Printed ${ok.map(l => l.partNumber).join(", ")} ✓`;
    else message = (ok.length ? `Printed ${ok.map(l => l.partNumber).join(", ")}. ` : "") +
      `Failed: ${bad.map(l => `${l.partNumber} (${l.error})`).join("; ")}`;
    return {
      ok: !job.error && !bad.length, message, id: job.id,
      labels: job.labels.map(({ png, ...l }) => l)
    };
  }

  function baseUrl() {
    return `http://${os.hostname().replace(/\.local$/i, "")}.local:${config.port}`;
  }

  async function previewPng(layout) {
    const part = lastPart || SAMPLE_PART;
    const key = [layout, config.size, config.showImage, part.partNumber].join("|");
    if (!previews.has(key)) previews.set(key, await printer.renderPreview(part, { size: config.size, layout, showImage: config.showImage }));
    return previews.get(key);
  }

  // Apply size / layout / showImage from a settings form and persist them.
  function applySettings(fields) {
    if (fields.layout && Label.LAYOUTS[fields.layout]) config.layout = fields.layout;
    if (fields.size && Label.LABEL_SIZES[fields.size]) config.size = fields.size;
    if ("showImage" in fields || fields._form) config.showImage = ["1", "on", "true"].includes(String(fields.showImage));
    if (config._file) configStore.save(config);
  }

  function templatePicker() {
    const s = Label.LABEL_SIZES[config.size] || Label.LABEL_SIZES["30336"];
    const stamp = `${config.size}-${config.showImage ? 1 : 0}-${lastPart?.partNumber || "sample"}`;
    const cards = Object.entries(Label.LAYOUTS).map(([k, v]) => `
      <label class="tpl${k === config.layout ? " on" : ""}">
        <input type="radio" name="layout" value="${esc(k)}"${k === config.layout ? " checked" : ""}>
        <img src="/preview/${esc(k)}.png?v=${esc(stamp)}" alt="${esc(v.name)}" style="aspect-ratio:${s.width}/${s.height}">
        <span>${esc(v.name)}</span>
      </label>`).join("");
    const sizes = Object.entries(Label.LABEL_SIZES).map(([k, v]) =>
      `<option value="${esc(k)}"${k === config.size ? " selected" : ""}>${esc(v.name)}</option>`).join("");
    return `
<form method="post" action="/settings" id="settings">
  <input type="hidden" name="_form" value="1">
  <div class="row">
    <select name="size">${sizes}</select>
    <label><input type="checkbox" name="showImage" value="1"${config.showImage ? " checked" : ""}> Picture</label>
    <button class="save">Save</button>
  </div>
  <div class="tpls">${cards}</div>
  <small>Previews use ${lastPart ? "the last part printed (" + esc(lastPart.partNumber) + ")" : "a sample part"}. Click a template to use it for every label.</small>
</form>
<script>
  const f = document.getElementById("settings");
  f.querySelector(".save").hidden = true;
  f.addEventListener("change", () => f.submit());
</script>`;
  }

  function statusPage(printers) {
    const rows = jobs.map(j => `
      <li class="job ${j.error ? "bad" : j.labels.every(l => l.ok) ? "" : "bad"}">
        <time>${esc(new Date(j.time).toLocaleString())}</time>
        ${j.error ? `<b>${esc(j.error)}</b> <small>${esc(j.input)}</small>` : j.labels.map(l => `
          <div class="label">
            ${l.png ? `<img src="/jobs/${j.id}/${esc(l.partNumber)}.png" alt="">` : ""}
            <div><b>${esc(l.partNumber)}</b> ×${l.copies} ${l.ok ? "✓" : "✗ " + esc(l.error)}<br>
            <small>${esc(l.description)}${l.note ? " — " + esc(l.note) : ""}</small></div>
          </div>`).join("")}
      </li>`).join("");
    const plist = printers.ok
      ? (printers.printers.map(p => `${esc(p.name)}${p.connected ? "" : " (offline)"}`).join(", ") || "none found")
      : `<span class="bad">not reachable (${esc(printers.error)})</span>`;
    return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>McMaster → DYMO</title>
<style>
 body{font:15px -apple-system,Helvetica,Arial,sans-serif;margin:0 auto;max-width:640px;padding:16px;color:#222}
 h1{font-size:20px;margin:0 0 4px} h2{font-size:15px;margin:20px 0 6px;color:#555}
 code{background:#eee;padding:1px 5px;border-radius:4px}
 form.print{display:flex;gap:8px} input[type=text]{flex:1;font-size:16px;padding:8px}
 input[type=number]{width:60px;font-size:16px;padding:8px} button{font-size:16px;padding:8px 14px}
 ul{list-style:none;padding:0;margin:0} .job{border-top:1px solid #ddd;padding:8px 0}
 time{font-size:12px;color:#777} .label{display:flex;gap:10px;align-items:center;margin-top:4px}
 .label img{width:120px;border:1px solid #ccc;border-radius:3px} .bad{color:#b00}
 small{color:#666}
 .row{display:flex;gap:12px;align-items:center;margin-bottom:10px} .row select{font-size:15px;padding:6px}
 .tpls{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px}
 .tpl{display:block;border:2px solid #ddd;border-radius:8px;padding:6px;cursor:pointer;text-align:center}
 .tpl:hover{border-color:#999} .tpl.on{border-color:#0a7aff;background:#eef5ff}
 .tpl input{position:absolute;opacity:0;width:0;height:0} .tpl img{width:100%;border:1px solid #ccc;border-radius:3px;background:#fff}
 .tpl span{display:block;font-size:12px;margin-top:4px;color:#333}
</style>
<h1>McMaster → DYMO</h1>
<div>Reach this Mac at <code>${esc(baseUrl())}</code> · <a href="/shortcut">iPhone Shortcut setup</a></div>
<h2>Printer</h2>
<div>DYMO Connect: ${plist}<br><small>${config.printer ? "Printer " + esc(config.printer) + "; other" : "Other"} settings in <code>${esc(config._file)}</code>.</small></div>
<h2>Label template</h2>
${templatePicker()}
<h2>Print a label</h2>
<form class="print" method="post" action="/print?ui=1">
  <input type="text" name="text" placeholder="Part number or McMaster link" autofocus>
  <input type="number" name="copies" value="${config.copies}" min="1" max="99">
  <button>Print</button>
</form>
<h2>Recent</h2>
<ul>${rows || "<li><small>Nothing printed yet.</small></li>"}</ul>`;
  }

  function shortcutPage() {
    const url = `${baseUrl()}/print${config.token ? "?token=" + encodeURIComponent(config.token) : ""}`;
    return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>iPhone Shortcut setup</title>
<style>body{font:16px -apple-system,Helvetica,Arial,sans-serif;margin:0 auto;max-width:640px;padding:16px;color:#222;line-height:1.45}
code{background:#eee;padding:1px 5px;border-radius:4px} li{margin:8px 0}</style>
<h1>Print from the McMaster app</h1>
<p>Open this page on your iPhone, on the shop Wi-Fi, and build the Shortcut once:</p>
<ol>
 <li>Open <b>Shortcuts</b> → <b>+</b> (new shortcut). Name it <b>Print McMaster label</b>.</li>
 <li>Tap the <b>ⓘ</b> info button → turn on <b>Show in Share Sheet</b>. Under <b>Share Sheet Types</b> keep <b>URLs</b> and <b>Text</b>.</li>
 <li>Add action <b>Get Contents of URL</b>. URL: <code>${esc(url)}</code></li>
 <li>Expand it: Method <b>POST</b>, Request Body <b>Form</b>, add field <b>text</b> = <b>Shortcut Input</b> (pick the variable). Optional field <b>copies</b> = a number.</li>
 <li>Add action <b>Get Dictionary Value</b>: key <code>message</code> from <b>Contents of URL</b>.</li>
 <li>Add action <b>Show Notification</b> with the <b>Dictionary Value</b>.</li>
</ol>
<p>Then in the McMaster app open a part, tap <b>Share</b>, and choose <b>Print McMaster label</b>. Test from here first:</p>
<form method="post" action="/print?ui=1"><input type="hidden" name="text" value="9541K43"><button>Print a test label (9541K43)</button></form>`;
  }

  const CORS = {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type, authorization"
  };

  function send(res, status, body, type = "application/json; charset=utf-8") {
    res.writeHead(status, { "content-type": type, ...CORS });
    res.end(type.startsWith("application/json") ? JSON.stringify(body) : body);
  }

  async function handle(req, res) {
    const url = new URL(req.url, "http://x");
    try {
      if (req.method === "OPTIONS") return send(res, 204, "", "text/plain");

      if (url.pathname === "/" && req.method === "GET") {
        return send(res, 200, statusPage(await printer.status()), "text/html; charset=utf-8");
      }
      if (url.pathname === "/shortcut" && req.method === "GET") {
        return send(res, 200, shortcutPage(), "text/html; charset=utf-8");
      }
      if (url.pathname === "/status" && req.method === "GET") {
        return send(res, 200, { ok: true, printer: await printer.status(), settings: settings(), jobs: jobs.slice(0, 10).map(summarize) });
      }
      const pv = url.pathname.match(/^\/preview\/([a-z0-9_-]+)\.png$/i);
      if (pv && req.method === "GET") {
        if (!Label.LAYOUTS[pv[1]]) return send(res, 404, "unknown layout", "text/plain");
        res.writeHead(200, { "content-type": "image/png", "cache-control": "no-cache" });
        return res.end(await previewPng(pv[1]));
      }
      if (url.pathname === "/settings" && req.method === "POST") {
        const body = await readBody(req);
        const type = (req.headers["content-type"] || "").toLowerCase();
        const fields = type.includes("json") ? JSON.parse(body || "{}") : Object.fromEntries(new URLSearchParams(body));
        if (config.token && (fields.token || url.searchParams.get("token")) !== config.token) return send(res, 401, { ok: false, message: "Bad token" });
        applySettings(fields);
        if (type.includes("json")) return send(res, 200, { ok: true, settings: settings() });
        res.writeHead(303, { location: "/" }); return res.end();
      }
      const m = url.pathname.match(/^\/jobs\/(\d+)\/([^/]+)\.png$/);
      if (m && req.method === "GET") {
        const l = jobs.find(j => j.id === +m[1])?.labels.find(l => l.partNumber === decodeURIComponent(m[2]).toUpperCase());
        if (!l?.png) return send(res, 404, "not found", "text/plain");
        return send(res, 200, l.png, "image/png");
      }

      if (url.pathname === "/print" && (req.method === "POST" || req.method === "GET")) {
        const body = req.method === "POST" ? await readBody(req) : "";
        const r = parseRequest(req, url, body);
        if (config.token && r.token !== config.token) return send(res, 401, { ok: false, message: "Bad token" });
        if (!r.text.trim()) return send(res, 400, { ok: false, message: "Send a part number or McMaster link" });
        const copies = Math.max(1, Math.min(99, r.copies || config.copies || 1));
        const job = await enqueue(r.text, copies);
        const out = summarize(job);
        if (url.searchParams.get("ui")) {
          res.writeHead(303, { location: "/" }); return res.end();
        }
        return send(res, out.ok ? 200 : (job.error ? 400 : 502), out);
      }
      send(res, 404, { ok: false, message: "Not found" });
    } catch (e) {
      log("request failed: " + (e.stack || e.message));
      send(res, 500, { ok: false, message: e.message });
    }
  }

  const server = http.createServer(handle);
  return { server, handle, enqueue, jobs, baseUrl, parseRequest };
}

module.exports = { createApp, parseRequest };
