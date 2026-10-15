/* Page extractor. Injected into the McMaster tab via chrome.scripting.executeScript
 * (it must be self-contained: no references to anything outside the function).
 *
 * Part page  -> { kind: "part", partNumber, description, url, images[], imageDataUrls[] }
 * Order page -> { kind: "order", po, lines: [{ line, partNumber, description, url,
 *                 qty, unit, images[], imageDataUrls[] }] }
 */
async function extractMcMaster() {
  const PN = /^(\d{1,5}[A-Z]{1,2}\d{1,5}[A-Z]?)$/i;
  const clean = s => (s || "").replace(/\s+/g, " ").trim();
  // Order lines are title-cased ("4\" Od"); restore common abbreviations.
  const fixCase = s => s.replace(/\bOd\b/g, "OD").replace(/\bId\b/g, "ID");
  const partUrl = pn => `https://www.mcmaster.com/${pn}/`;

  // McMaster image URLs carry a size token (…@100p_…); the same image is
  // served at other sizes, so ask for a 300 px one for crisp printing.
  const hires = u => u.replace(/@\d+p(?=[_.])/, "@300p");
  const toDataUrl = async u => {
    try {
      const r = await fetch(u, { credentials: "include" });
      if (!r.ok) return "";
      const blob = await r.blob();
      if (!blob.type.startsWith("image/")) return "";
      return await new Promise(res => {
        const fr = new FileReader();
        fr.onload = () => res(fr.result);
        fr.onerror = () => res("");
        fr.readAsDataURL(blob);
      });
    } catch (_) { return ""; }
  };
  // Returns { src, dataUrl } for the best available size of an image.
  const fetchBest = async u => {
    const big = hires(u);
    if (big !== u) {
      const d = await toDataUrl(big);
      if (d) return { src: big, dataUrl: d };
    }
    return { src: u, dataUrl: await toDataUrl(u) };
  };

  // ---- Order detail page (/order-history/order/<id>) ----
  const rows = [...document.querySelectorAll(".dtl-row")].filter(r => r.querySelector(".dtl-row-specs"));
  if (rows.length) {
    const lines = await Promise.all(rows.map(async (r, i) => {
      const pn = clean(r.querySelector(".dtl-row-specs").textContent).toUpperCase();
      const descEl = r.querySelector(".dtl-row-lnk p:not(.dtl-row-specs)") || r.querySelector(".dtl-row-copy p");
      const img = r.querySelector("img.dtl-img") || r.querySelector("img");
      const src = img ? (img.getAttribute("src") ? new URL(img.getAttribute("src"), location.href).href : "") : "";
      const best = src ? await fetchBest(src) : null;
      return {
        line: clean(r.querySelector(".dtl-row-nbr")?.textContent) || String(i + 1),
        partNumber: pn,
        description: fixCase(clean(descEl?.innerText || descEl?.textContent)),
        url: partUrl(pn),
        qty: clean(r.querySelector(".dtl-row-quantity")?.textContent),
        unit: clean(r.querySelector(".dtl-row-qu .dtl-row-unit")?.textContent),
        images: best ? [best.src] : [],
        imageDataUrls: best ? [best.dataUrl] : []
      };
    }));
    const po = clean(document.querySelector("input.order-dtl-po, #po-check-for-value")?.value);
    return { kind: "order", po, lines };
  }

  // ---- Single part page ----

  // Part number: from the URL path first, then from visible headings.
  let partNumber = "";
  for (const seg of location.pathname.split(/[\/~]/)) {
    if (PN.test(seg)) { partNumber = seg.toUpperCase(); break; }
  }
  if (!partNumber) {
    // Only trust page text if exactly one part number appears (i.e. a single-part view).
    const found = new Set(clean(document.body.innerText).match(/\b\d{3,5}[A-Z]\d{1,5}\b/g) || []);
    if (found.size === 1) partNumber = [...found][0];
  }

  const visible = el => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden";
  };

  // Description: the product heading plus its spec subtitle.
  const h1 = [...document.querySelectorAll("h1")].find(visible);
  let description = "";
  let container = null;
  if (h1) {
    description = clean(h1.innerText);
    // McMaster puts the size/spec line in the heading that follows the title.
    let sib = h1.nextElementSibling;
    for (let i = 0; sib && i < 3; i++, sib = sib.nextElementSibling) {
      const t = clean(sib.innerText);
      if (t && t.length < 160 && /^H[2-4]$|DIV|SPAN|P/.test(sib.tagName) && t !== description) {
        description += ", " + t;
        break;
      }
    }
    container = h1.closest("[class*='detail' i], [class*='Detail'], section, main") || h1.parentElement;
  }
  if (!description) {
    description = clean(document.title.replace(/\s*[|\-–]\s*McMaster-Carr\s*$/i, ""));
    if (/^McMaster-Carr$/i.test(description)) description = "";
  }

  // Image candidates. McMaster shows the product photo/render at the top and
  // dimension drawings / "2-D PDF" tiles further down; prefer the former.
  const DRAWING = /dimension|drawing|dwg|2-?d|pdf|cad|schematic/i;
  const vw = innerWidth, vh = innerHeight;
  const visibleArea = r => {
    const w = Math.max(0, Math.min(r.right, vw) - Math.max(r.left, 0));
    const h = Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0));
    return w * h;
  };
  // Fraction of the image that is "ink" (non-white) and how colourful it is.
  // Line drawings are almost all white; product renders are filled shapes.
  const inkStats = img => {
    try {
      const c = document.createElement("canvas");
      c.width = c.height = 48;
      const g = c.getContext("2d");
      g.drawImage(img, 0, 0, 48, 48);
      const d = g.getImageData(0, 0, 48, 48).data;
      let ink = 0, sat = 0;
      for (let i = 0; i < d.length; i += 4) {
        const mx = Math.max(d[i], d[i + 1], d[i + 2]), mn = Math.min(d[i], d[i + 1], d[i + 2]);
        if (d[i + 3] > 20 && mn < 225) ink++;
        if (mx - mn > 40) sat++;
      }
      return { ink: ink / 2304, sat: sat / 2304 };
    } catch (_) { return null; } // cross-origin: unknown
  };
  const contextText = el => clean((el.closest("a, button, figure, li, div") || el).innerText || "").slice(0, 80);

  const cands = [];
  const seen = new Set();
  [...document.images].forEach((img, order) => {
    const src = img.currentSrc || img.src || "";
    if (!src || seen.has(src) || /logo|sprite|icon|\.svg(\?|$)/i.test(src)) return;
    if (!visible(img)) return;
    const r = img.getBoundingClientRect();
    if (r.width < 40 || r.height < 40) return;
    seen.add(src);
    let s = Math.sqrt(r.width * r.height);              // size, sub-linear
    s *= 0.4 + 0.6 * Math.min(1, visibleArea(r) / (r.width * r.height || 1)); // on screen
    const cy = r.top + r.height / 2;
    s *= cy < vh * 0.55 ? 1.4 : cy < vh ? 1 : 0.6;     // centred near the top of the page
    if (container && container.contains(img)) s *= 1.3;
    if (DRAWING.test(src) || DRAWING.test(img.alt || "") || DRAWING.test(contextText(img))) s *= 0.15;
    const st = img.complete ? inkStats(img) : null;
    if (st) {
      if (st.ink < 0.12) s *= 0.25;                     // mostly white: a drawing
      if (st.sat > 0.08) s *= 1.4;                      // colour render/photo
    }
    if (r.width < 120 && r.height < 120) s *= 0.6;      // thumbnails
    cands.push({ src, s, order });
  });
  cands.sort((a, b) => b.s - a.s || a.order - b.order);

  // Fetched from the page (same origin), so the popup never needs cookies.
  const fetched = await Promise.all(cands.slice(0, 6).map(c => fetchBest(c.src)));

  const url = partNumber ? partUrl(partNumber) : location.href;
  return {
    kind: "part", partNumber, description, url,
    images: fetched.map(f => f.src), imageDataUrls: fetched.map(f => f.dataUrl)
  };
}

if (typeof module !== "undefined" && module.exports) module.exports = { extractMcMaster };
