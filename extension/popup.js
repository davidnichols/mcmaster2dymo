/* global McmLabel, Dymo, chrome, extractMcMaster */
const BROWSER = "__browser__";
const $ = id => document.getElementById(id);

// One entry per label to print. On a part page there is one item; on an
// order page there is one per order line.
//   { part: {partNumber, description, url, images[], imageDataUrls[]},
//     description, bitmaps: ImageBitmap[], imgIndex, copies, selected, meta }
let items = [];
let cur = 0;          // item shown in the preview
let mode = "part";    // "part" | "order"

// Shop print server (server/) on this Mac, if it's running: label size,
// layout and picture on/off are shared with it so both print the same label.
const SHOP_DEFAULT = "http://localhost:41952";
let shop = null;      // base URL once reached

async function shopSettings(base) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 1500);
  try {
    const r = await fetch(base + "/status", { signal: ctl.signal });
    const j = await r.json();
    if (j?.settings) { shop = base; return j.settings; }
  } catch (_) { /* not running */ }
  finally { clearTimeout(t); }
  return null;
}

function pushShopSettings(s) {
  if (!shop) return;
  fetch(shop + "/settings", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ size: s.size, layout: s.layout, showImage: s.showImage })
  }).catch(() => {});
}

async function loadBitmap(p, i) {
  const tries = [];
  if (p.imageDataUrls?.[i]) tries.push(() => fetch(p.imageDataUrls[i]).then(r => r.blob()));
  if (p.images?.[i]) tries.push(() => fetch(p.images[i], { credentials: "include" }).then(r => r.blob()));
  for (const t of tries) {
    try { return await createImageBitmap(await t()); } catch (_) {}
  }
  return null;
}

async function loadBitmaps(p) {
  const out = await Promise.all((p.images || []).map((_, i) => loadBitmap(p, i)));
  return out.filter(Boolean);
}

function currentSize() {
  return McmLabel.LABEL_SIZES[$("size").value] || McmLabel.LABEL_SIZES["30336"];
}

function itemImage(it) {
  return $("showImage").checked ? (it.bitmaps[it.imgIndex] || null) : null;
}

function labelPart(it) {
  return { partNumber: it.part.partNumber, description: it.description, url: it.part.url };
}

// Full-size label (preview and Chrome print dialog).
function renderFull(it) {
  const s = currentSize();
  return McmLabel.renderLabel(labelPart(it), {
    widthIn: s.width, heightIn: s.height, padIn: 0.06, leftPadIn: 0.1,
    image: itemImage(it), layout: $("layout").value
  });
}

// Sized exactly to the printable area declared in the DYMO label XML.
function renderForDymo(it) {
  const b = McmLabel.dymoBounds(currentSize());
  return McmLabel.renderLabel(labelPart(it), {
    widthIn: b.w / 1440, heightIn: b.h / 1440, padIn: 0.02,
    image: itemImage(it), layout: $("layout").value
  });
}

function refreshPreview() {
  const it = items[cur];
  if (!it) return;
  const src = renderFull(it);
  const pv = $("preview");
  pv.width = src.width; pv.height = src.height;
  pv.getContext("2d").drawImage(src, 0, 0);
}

function selectedItems() {
  return items.filter(it => it.selected);
}

function updatePrintButton() {
  if (mode !== "order") { $("print").textContent = "Print label"; return; }
  const sel = selectedItems();
  const n = sel.reduce((a, it) => a + it.copies, 0);
  $("print").textContent = n ? `Print ${n} label${n === 1 ? "" : "s"}` : "Select labels to print";
  $("print").disabled = !n;
  $("selAll").checked = sel.length === items.length;
  $("selAll").indeterminate = sel.length > 0 && sel.length < items.length;
}

// Show item i in the preview / description box.
function showItem(i) {
  cur = i;
  const it = items[i];
  $("desc").value = it.description;
  $("partNo").textContent = it.part.partNumber || "";
  const many = it.bitmaps.length > 1;
  $("imgNav").hidden = !many;
  $("imgCount").textContent = `${it.imgIndex + 1}/${it.bitmaps.length}`;
  document.querySelectorAll("#lines li").forEach((li, j) => li.classList.toggle("current", j === i));
  refreshPreview();
}

function setStatus(html, isErr = false) {
  $("status").innerHTML = html;
  $("status").classList.toggle("err", isErr);
}

function saveSettings() {
  const s = {
    size: $("size").value,
    layout: $("layout").value,
    printer: $("printer").value,
    showImage: $("showImage").checked
  };
  if (mode === "part") s.copies = +$("copies").value || 1;
  chrome.storage.sync.set(s);
  pushShopSettings(s);
}

async function loadPrinters(preferred) {
  const sel = $("printer");
  sel.innerHTML = "";
  let printers = [];
  try {
    printers = await Dymo.getPrinters();
  } catch (e) {
    setStatus(`DYMO Connect not found — will use Chrome's print dialog. ` +
      `If DYMO Connect is running, <a href="${Dymo.statusUrl}" target="_blank">open this link</a> once to trust its certificate, then reopen this popup.`);
  }
  for (const p of printers) sel.add(new Option(p.name + (p.connected ? "" : " (offline)"), p.name));
  sel.add(new Option("Chrome print dialog", BROWSER));
  const names = printers.map(p => p.name);
  if (preferred && (names.includes(preferred) || preferred === BROWSER)) sel.value = preferred;
  else {
    const p550 = printers.find(p => /550/.test(p.name) && p.connected) || printers.find(p => p.connected) || printers[0];
    sel.value = p550 ? p550.name : BROWSER;
  }
}

async function printViaBrowser(list) {
  const s = currentSize();
  const labels = list.map(it => ({ dataUrl: renderFull(it).toDataURL("image/png"), copies: it.copies }));
  const title = mode === "order" ? (orderPo || "order") : list[0].part.partNumber;
  await chrome.storage.session.set({ pendingLabel: { labels, widthIn: s.width, heightIn: s.height, title } });
  await chrome.tabs.create({ url: chrome.runtime.getURL("print.html") });
}

async function onPrint() {
  saveSettings();
  if (mode === "part") items[0].copies = Math.max(1, +$("copies").value || 1);
  const list = selectedItems();
  if (!list.length) return;
  const btn = $("print");
  btn.disabled = true;
  const printer = $("printer").value;
  let done = 0;
  try {
    if (printer && printer !== BROWSER) {
      for (const it of list) {
        setStatus(list.length > 1
          ? `Printing ${done + 1} of ${list.length}: ${it.part.partNumber}…`
          : `Sending to ${printer}…`);
        const png = renderForDymo(it).toDataURL("image/png").split(",")[1];
        await Dymo.printLabel(printer, McmLabel.dymoLabelXml(currentSize(), png), it.copies);
        done++;
      }
      setStatus(list.length > 1 ? `Printed ${done} labels ✓` : "Printed ✓");
    } else {
      await printViaBrowser(list);
    }
  } catch (e) {
    console.error(e);
    const rest = list.slice(done);
    setStatus(`DYMO print failed${done ? ` after ${done} label${done === 1 ? "" : "s"}` : ""} (${e.message}). ` +
      `Opening Chrome's print dialog for the remaining ${rest.length}…`, true);
    await printViaBrowser(rest);
  } finally {
    btn.disabled = false;
    updatePrintButton();
  }
}

let orderPo = "";

function buildOrderList() {
  const ul = $("lines");
  ul.innerHTML = "";
  items.forEach((it, i) => {
    const li = document.createElement("li");
    li.innerHTML = `
      <input type="checkbox" class="sel" ${it.selected ? "checked" : ""} title="Include this label">
      <div class="thumb"></div>
      <div class="info">
        <div class="pn"></div>
        <div class="d"></div>
      </div>
      <input type="number" class="cp" min="0" max="99" title="Copies">`;
    li.querySelector(".pn").textContent = it.part.partNumber;
    li.querySelector(".d").textContent = it.description;
    li.querySelector(".d").title = `${it.meta.qty} ${it.meta.unit}`.trim();
    li.querySelector(".cp").value = it.copies;
    if (it.bitmaps[0]) {
      const c = document.createElement("canvas");
      const k = 34 / Math.max(it.bitmaps[0].width, it.bitmaps[0].height);
      c.width = Math.round(it.bitmaps[0].width * k); c.height = Math.round(it.bitmaps[0].height * k);
      c.getContext("2d").drawImage(it.bitmaps[0], 0, 0, c.width, c.height);
      li.querySelector(".thumb").appendChild(c);
    }
    li.querySelector(".sel").addEventListener("change", e => {
      it.selected = e.target.checked;
      if (it.selected && !it.copies) { it.copies = 1; li.querySelector(".cp").value = 1; }
      updatePrintButton();
    });
    li.querySelector(".cp").addEventListener("input", e => {
      it.copies = Math.max(0, Math.min(99, +e.target.value || 0));
      it.selected = it.copies > 0;
      li.querySelector(".sel").checked = it.selected;
      updatePrintButton();
    });
    li.addEventListener("click", e => { if (!e.target.matches("input")) showItem(i); });
    ul.appendChild(li);
  });
}

async function init() {
  for (const [k, v] of Object.entries(McmLabel.LABEL_SIZES)) $("size").add(new Option(v.name, k));
  for (const [k, v] of Object.entries(McmLabel.LAYOUTS)) $("layout").add(new Option(v.name, k));

  const settings = await chrome.storage.sync.get({ size: "30336", layout: "classic", printer: "", copies: 1, showImage: true, shopServer: SHOP_DEFAULT });
  // The shop print server's choices win when it's running on this Mac.
  const remote = await shopSettings(settings.shopServer);
  if (remote) Object.assign(settings, { size: remote.size, layout: remote.layout, showImage: !!remote.showImage });
  $("size").value = McmLabel.LABEL_SIZES[settings.size] ? settings.size : "30336";
  $("layout").value = McmLabel.LAYOUTS[settings.layout] ? settings.layout : "classic";
  $("copies").value = settings.copies;
  $("showImage").checked = settings.showImage;

  // ?tab=<id> targets a specific tab (used by the end-to-end test).
  const forced = +new URLSearchParams(location.search).get("tab");
  const tab = forced ? await chrome.tabs.get(forced)
    : (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  if (!tab || !/^https:\/\/([a-z0-9-]+\.)*mcmaster\.com\//i.test(tab.url || "")) {
    $("notPart").hidden = false;
    return;
  }

  let result;
  try {
    [{ result }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: extractMcMaster });
  } catch (e) {
    $("notPart").hidden = false;
    $("notPart").textContent = "Couldn't read this page: " + e.message;
    return;
  }

  if (result.kind === "order") {
    mode = "order";
    orderPo = result.po;
    items = result.lines.map(l => ({
      part: l, description: l.description, bitmaps: [], imgIndex: 0, copies: 1, selected: true,
      meta: { qty: l.qty, unit: l.unit, line: l.line }
    }));
  } else {
    if (!result.partNumber && !result.description) { $("notPart").hidden = false; return; }
    items = [{ part: result, description: result.description, bitmaps: [], imgIndex: 0,
      copies: settings.copies, selected: true, meta: {} }];
  }
  if (!items.length) { $("notPart").hidden = false; return; }

  document.body.classList.toggle("order-mode", mode === "order");
  $("main").hidden = false;
  if (mode === "order") {
    $("orderTitle").textContent = `${orderPo ? "Order " + orderPo + " · " : ""}${items.length} line${items.length === 1 ? "" : "s"}`;
    $("partNo").textContent = "";
  }

  await Promise.all(items.map(async it => { it.bitmaps = await loadBitmaps(it.part); }));
  if (!items.some(it => it.bitmaps.length)) { $("showImage").checked = false; $("showImage").disabled = true; }
  if (mode === "order") buildOrderList();
  showItem(0);
  updatePrintButton();

  const step = d => {
    const it = items[cur];
    if (!it.bitmaps.length) return;
    it.imgIndex = (it.imgIndex + d + it.bitmaps.length) % it.bitmaps.length;
    $("imgCount").textContent = `${it.imgIndex + 1}/${it.bitmaps.length}`;
    $("showImage").checked = true;
    refreshPreview();
  };
  $("imgPrev").addEventListener("click", () => step(-1));
  $("imgNext").addEventListener("click", () => step(1));
  $("desc").addEventListener("input", () => {
    items[cur].description = $("desc").value;
    const d = document.querySelectorAll("#lines li .d")[cur];
    if (d) d.textContent = items[cur].description;
    refreshPreview();
  });
  $("selAll").addEventListener("change", e => {
    items.forEach(it => { it.selected = e.target.checked; if (it.selected && !it.copies) it.copies = 1; });
    buildOrderList();
    showItem(cur);
    updatePrintButton();
  });
  for (const id of ["size", "layout", "showImage"]) $(id).addEventListener("input", refreshPreview);
  for (const id of ["size", "layout", "printer", "copies", "showImage"]) $(id).addEventListener("change", saveSettings);
  $("print").addEventListener("click", onPrint);

  await loadPrinters(settings.printer);
  if (shop && !$("status").textContent) setStatus(`Label settings shared with the <a href="${shop}/" target="_blank">shop print server</a>.`);
}

init();
