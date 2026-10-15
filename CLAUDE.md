# CLAUDE.md

Chrome MV3 extension: on a McMaster-Carr part page, or an order detail page in
Order History, renders labels (part number, description, picture, QR link) and
prints them on a DYMO LabelWriter 550.
No build step — `extension/` is loaded unpacked as-is. Plain browser JS, no
framework, no bundler.

## Layout
- `extension/manifest.json` — MV3; permissions activeTab, scripting, storage;
  hosts mcmaster.com and the DYMO web service (127.0.0.1/localhost:41951).
- `extension/extract.js` — `extractMcMaster()`, injected into the tab with
  `chrome.scripting.executeScript({ func })`. **Must stay self-contained** (no
  closures over outer variables, no imports). Returns either
  `{ kind: "part", partNumber, description, url, images[], imageDataUrls[] }` or
  `{ kind: "order", po, lines: [{ line, partNumber, description, url, qty, unit, images[], imageDataUrls[] }] }`.
  - Order page (`/order-history/order/<id>`): one `div.dtl-row` per line with
    `.dtl-row-nbr`, `img.dtl-img`, `.dtl-row-lnk p` (description),
    `p.dtl-row-specs` (part number), `.dtl-row-quantity`, `.dtl-row-qu .dtl-row-unit`;
    PO in `input.order-dtl-po`. The page also contains a background
    order-history table (`._product-number_*`) and a hidden current-order
    `<main>` — ignore both. Order descriptions are title-cased ("Od" → "OD" fixed).
  - Part page: part number from the URL path (pattern like `9541K43`,
    `91290A115`); description = visible `<h1>` + the following spec line.
    Images are scored: size, on-screen position (centre near top wins), near
    the heading, colour/ink coverage (line drawings are mostly white), and
    penalties for drawing/2-D/PDF/CAD hints. Top 6 returned, best first.
  - McMaster image URLs contain a size token (`…@100p_…`); `@300p` serves the
    same image at 300 px. The extractor fetches that (falls back to the
    original) and returns data URLs so the popup never needs cookies.
- `extension/label.js` — pure canvas rendering, works in browser and Node
  (`module.exports`). `LABEL_SIZES` (inches, plus DYMO paper ids),
  `LAYOUTS` (each `{ name, draw(ctx) }`), `renderLabel(part, opts)`,
  `dymoLabelXml(size, pngBase64)`, `dymoBounds(size)`. 300 dpi.
  Pictures are trimmed of white borders and converted to high-contrast gray.
- `extension/dymo.js` — DYMO Connect web service client
  (`/DYMO/DLS/Printing/StatusConnected|GetPrinters|PrintLabel`).
- `extension/popup.*` — UI; settings in `chrome.storage.sync`. Works on a
  list of `items` (1 on a part page, one per line on an order page); order
  mode adds `body.order-mode` with a line list (checkbox + copies each).
  `popup.html?tab=<id>` targets a given tab (used by the e2e test). Chrome
  caps popups at 600 px tall, so the print button is `position: sticky`.
- `extension/print.*` — fallback: Chrome print dialog with `@page` sized to the
  label; reads `{ labels: [{ dataUrl, copies }], widthIn, heightIn }` from
  `chrome.storage.session`.
- `extension/lib/qrcode.js` — vendored qrcode-generator 1.4.4 (MIT). Don't edit.

## Printing path
Popup renders each label image at the size of `dymoBounds()` and wraps it in a
classic `DieCutLabel` XML as a single `ImageObject`, POSTed to `PrintLabel`
(one request per label, with that label's copies). If DYMO Connect is
unreachable or a print fails, the remaining labels go to `print.html`.

## Commands
- `npm test` — node:test, run serially:
  - `label.test.js`: every size × layout × sample part renders and the QR
    decodes (jsQR); image trimming; XML.
  - `extract.test.js`: `extractMcMaster` in headless Chrome against
    `test/fixtures/mock-part-page.html` and `mock-order-page.html`.
  - `popup.e2e.test.js`: loads the real extension, routes `www.mcmaster.com`
    to the fixtures and the DYMO service (`:41951`) to a fake that records
    `PrintLabel` calls; drives the popup on both page types. Set
    `E2E_SCREENSHOTS=<dir>` to save popup screenshots and look at them after
    UI changes.
- `npm run layouts [-- <size>]` — writes `docs/<size>-layouts.png`. Look at it
  after any layout change.
- `npm run package` — zips `extension/` into `dist/`.

## Conventions
- Default label is 30336 (1" × 2-1/8"); that's the one the user prints.
- After changing layouts, run `npm run layouts` and view the PNG; QR codes
  must still decode (tests enforce this).
- When adding a layout, add it to `LAYOUTS` in label.js; the popup menu and
  tests pick it up automatically.
- Bump `version` in both `extension/manifest.json` and `package.json`.
- Real McMaster pages need the user's login and can't be fetched from tests;
  if the extractor misbehaves on a real page, inspect it (e.g. via Claude in
  Chrome) and reproduce the structure in a fixture under `test/fixtures/`,
  with personal/order details replaced by placeholders.
