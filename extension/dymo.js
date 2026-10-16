/* Minimal client for the DYMO Connect web service (installed with DYMO
 * Connect for Desktop, which is what the LabelWriter 550 requires).
 *
 * Browser: exposes `window.Dymo` (uses the page's fetch).
 * Node:    `require(...).createDymoClient({ fetch })` — pass a fetch that
 *          accepts the service's self-signed certificate.
 */
(function (root) {
  const HOSTS = ["https://127.0.0.1:41951", "https://localhost:41951"];
  const PATH = "/DYMO/DLS/Printing";

  function parsePrinters(xml) {
    // Some versions return the XML as a JSON string.
    if (xml.startsWith('"')) { try { xml = JSON.parse(xml); } catch (_) {} }
    const tag = (s, t) => (s.match(new RegExp(`<${t}>([^<]*)</${t}>`)) || [])[1] || "";
    return [...xml.matchAll(/<LabelWriterPrinter>([\s\S]*?)<\/LabelWriterPrinter>/g)].map(m => ({
      name: tag(m[1], "Name"),
      model: tag(m[1], "ModelName"),
      connected: /true/i.test(tag(m[1], "IsConnected"))
    })).filter(p => p.name);
  }

  function createDymoClient({ fetch: fetchImpl } = {}) {
    const doFetch = fetchImpl || ((...a) => root.fetch(...a));
    let baseUrl = null;

    async function fetchWithTimeout(url, init = {}, ms = 4000) {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), ms);
      try { return await doFetch(url, { ...init, signal: ctl.signal }); }
      finally { clearTimeout(t); }
    }

    async function findService() {
      if (baseUrl) return baseUrl;
      for (const host of HOSTS) {
        try {
          const r = await fetchWithTimeout(host + PATH + "/StatusConnected", {}, 2500);
          if (r.ok && /true/i.test(await r.text())) { baseUrl = host + PATH; return baseUrl; }
        } catch (_) { /* try next */ }
      }
      const err = new Error("DYMO Connect web service not reachable");
      err.code = "NO_SERVICE";
      throw err;
    }

    async function getPrinters() {
      const base = await findService();
      const r = await fetchWithTimeout(base + "/GetPrinters");
      return parsePrinters(await r.text());
    }

    async function printLabel(printerName, labelXml, copies = 1) {
      const base = await findService();
      const params = `<LabelWriterPrintParams><Copies>${Math.max(1, copies | 0)}</Copies>` +
        `<PrintQuality>BarcodeAndGraphics</PrintQuality></LabelWriterPrintParams>`;
      const body = new URLSearchParams({
        printerName, printParamsXml: params, labelXml, labelSetXml: ""
      }).toString();
      const r = await fetchWithTimeout(base + "/PrintLabel", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body
      }, 20000);
      const text = await r.text();
      if (!r.ok || /false|error|exception/i.test(text)) {
        throw new Error("DYMO print failed: " + (text || r.status).toString().slice(0, 200));
      }
      return true;
    }

    // Forget a cached service URL (e.g. after a failure) so the next call probes again.
    function reset() { baseUrl = null; }

    return { findService, getPrinters, printLabel, reset, statusUrl: HOSTS[0] + PATH + "/StatusConnected" };
  }

  if (typeof module !== "undefined" && module.exports) module.exports = { createDymoClient, parsePrinters };
  else root.Dymo = createDymoClient();
})(typeof window !== "undefined" ? window : globalThis);
