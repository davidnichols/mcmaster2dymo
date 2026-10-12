/* global McmLabel, Dymo, chrome, extractMcMaster */
const BROWSER = "__browser__";
const $ = id => document.getElementById(id);

let part = null;       // { partNumber, description, url, images[], imageDataUrls[] }
let partImages = [];   // ImageBitmap[] (best guess first)
let imgIndex = 0;


async function loadImageAt(p, i) {
  const tries = [];
  if (p.images[i]) tries.push(() => fetch(p.images[i], { credentials: "include" }).then(r => r.blob()));
  if (p.imageDataUrls[i]) tries.push(() => fetch(p.imageDataUrls[i]).then(r => r.blob()));
  for (const t of tries) {
    try { return await createImageBitmap(await t()); } catch (_) {}
  }
  return null;
}

// Load every candidate; keep the ones that decode.
async function loadImages(p) {
  const out = await Promise.all(p.images.map((_, i) => loadImageAt(p, i)));
  return out.filter(Boolean);
}

function currentSize() {
  return McmLabel.LABEL_SIZES[$("size").value] || McmLabel.LABEL_SIZES["30252"];
}

function currentPart() {
  return { ...part, description: $("desc").value };
}

function imageIfOn() {
  return $("showImage").checked ? (partImages[imgIndex] || null) : null;
}

// Full-size label (used for the preview and the Chrome print dialog).
function renderFull() {
  const s = currentSize();
  return McmLabel.renderLabel(currentPart(), {
    widthIn: s.width, heightIn: s.height, padIn: 0.06, leftPadIn: 0.1, image: imageIfOn(), layout: $("layout").value
  });
}

// Image sized exactly to the printable area declared in the DYMO label XML.
function renderForDymo() {
  const s = currentSize();
  const b = McmLabel.dymoBounds(s);
  return McmLabel.renderLabel(currentPart(), {
    widthIn: b.w / 1440, heightIn: b.h / 1440, padIn: 0.02, image: imageIfOn(), layout: $("layout").value
  });
}

function refreshPreview() {
  const src = renderFull();
  const pv = $("preview");
  pv.width = src.width; pv.height = src.height;
  pv.getContext("2d").drawImage(src, 0, 0);
}

function setStatus(html, isErr = false) {
  $("status").innerHTML = html;
  $("status").classList.toggle("err", isErr);
}

function saveSettings() {
  chrome.storage.sync.set({
    size: $("size").value,
    layout: $("layout").value,
    printer: $("printer").value,
    copies: +$("copies").value || 1,
    showImage: $("showImage").checked
  });
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
  for (const p of printers) {
    const o = new Option(p.name + (p.connected ? "" : " (offline)"), p.name);
    sel.add(o);
  }
  sel.add(new Option("Chrome print dialog", BROWSER));
  const names = printers.map(p => p.name);
  if (preferred && (names.includes(preferred) || preferred === BROWSER)) sel.value = preferred;
  else {
    const p550 = printers.find(p => /550/.test(p.name) && p.connected) || printers.find(p => p.connected) || printers[0];
    sel.value = p550 ? p550.name : BROWSER;
  }
}

async function printViaBrowser() {
  const s = currentSize();
  const dataUrl = renderFull().toDataURL("image/png");
  await chrome.storage.session.set({
    pendingLabel: { dataUrl, widthIn: s.width, heightIn: s.height, copies: +$("copies").value || 1, title: part.partNumber }
  });
  await chrome.tabs.create({ url: chrome.runtime.getURL("print.html") });
}

async function onPrint() {
  saveSettings();
  const btn = $("print");
  btn.disabled = true;
  const printer = $("printer").value;
  try {
    if (printer && printer !== BROWSER) {
      setStatus("Sending to " + printer + "…");
      const png = renderForDymo().toDataURL("image/png").split(",")[1];
      const xml = McmLabel.dymoLabelXml(currentSize(), png);
      await Dymo.printLabel(printer, xml, +$("copies").value || 1);
      setStatus("Printed ✓");
    } else {
      await printViaBrowser();
    }
  } catch (e) {
    console.error(e);
    setStatus("DYMO print failed (" + e.message + "). Opening Chrome's print dialog instead…", true);
    await printViaBrowser();
  } finally {
    btn.disabled = false;
  }
}

async function init() {
  const sizeSel = $("size");
  for (const [k, v] of Object.entries(McmLabel.LABEL_SIZES)) sizeSel.add(new Option(v.name, k));
  for (const [k, v] of Object.entries(McmLabel.LAYOUTS)) $("layout").add(new Option(v.name, k));

  const settings = await chrome.storage.sync.get({ size: "30336", layout: "classic", printer: "", copies: 1, showImage: true });
  sizeSel.value = settings.size;
  $("layout").value = McmLabel.LAYOUTS[settings.layout] ? settings.layout : "classic";
  $("copies").value = settings.copies;
  $("showImage").checked = settings.showImage;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
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
  part = result;
  if (!part.partNumber && !part.description) {
    $("notPart").hidden = false;
    return;
  }

  $("main").hidden = false;
  $("partNo").textContent = part.partNumber || "";
  $("desc").value = part.description;
  refreshPreview();

  partImages = await loadImages(part);
  if (!partImages.length) { $("showImage").checked = false; $("showImage").disabled = true; }
  const step = d => {
    if (!partImages.length) return;
    imgIndex = (imgIndex + d + partImages.length) % partImages.length;
    $("imgCount").textContent = `${imgIndex + 1}/${partImages.length}`;
    $("showImage").checked = true;
    refreshPreview();
  };
  $("imgPrev").addEventListener("click", () => step(-1));
  $("imgNext").addEventListener("click", () => step(1));
  $("imgNav").hidden = partImages.length < 2;
  $("imgCount").textContent = `1/${partImages.length}`;
  refreshPreview();

  for (const id of ["desc", "size", "layout", "showImage"]) $(id).addEventListener("input", refreshPreview);
  for (const id of ["size", "layout", "printer", "copies", "showImage"]) $(id).addEventListener("change", saveSettings);
  $("print").addEventListener("click", onPrint);

  await loadPrinters(settings.printer);
}

init();
