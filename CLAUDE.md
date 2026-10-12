# CLAUDE.md

Chrome MV3 extension: on a McMaster-Carr part page, renders a label (part
number, description, picture, QR link) and prints it on a DYMO LabelWriter 550.
No build step — `extension/` is loaded unpacked as-is. Plain browser JS, no
framework, no bundler.

## Layout
- `extension/manifest.json` — MV3; permissions activeTab, scripting, storage;
  hosts mcmaster.com and the DYMO web service (127.0.0.1/localhost:41951).
- `extension/extract.js` — `extractMcMaster()`, injected into the tab with
  `chrome.scripting.executeScript({ func })`. **Must stay self-contained** (no
  closures over outer variables, no imports). Returns
  `{ partNumber, description, url, images[], imageDataUrls[] }`.
  - Part number from the URL path (pattern like `9541K43`, `91290A115`).
  - Description = visible `<h1>` + the following spec line.
  - Images are scored: size, on-screen position (centre near top wins),
    near the heading, colour/ink coverage (line drawings are mostly white),
    and penalties for drawing/2-D/PDF/CAD hints. Top 6 returned, best first.
- `extension/label.js` — pure canvas rendering, works in browser and Node
  (`module.exports`). `LABEL_SIZES` (inches, plus DYMO paper ids),
  `LAYOUTS` (each `{ name, draw(ctx) }`), `renderLabel(part, opts)`,
  `dymoLabelXml(size, pngBase64)`, `dymoBounds(size)`. 300 dpi.
  Pictures are trimmed of white borders and converted to high-contrast gray.
- `extension/dymo.js` — DYMO Connect web service client
  (`/DYMO/DLS/Printing/StatusConnected|GetPrinters|PrintLabel`).
- `extension/popup.*` — UI; settings in `chrome.storage.sync`.
- `extension/print.*` — fallback: Chrome print dialog with `@page` sized to the label.
- `extension/lib/qrcode.js` — vendored qrcode-generator 1.4.4 (MIT). Don't edit.

## Printing path
Popup renders the label image at the size of `dymoBounds()` and wraps it in a
classic `DieCutLabel` XML as a single `ImageObject`, POSTed to `PrintLabel`.
If DYMO Connect is unreachable or errors, it falls back to `print.html`.

## Commands
- `npm test` — node:test. Renders every size × layout × sample part and
  decodes the QR with jsQR; checks image trimming and XML; runs
  `extractMcMaster` in headless Chrome against `test/fixtures/mock-part-page.html`.
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
- Real McMaster pages can't be fetched from CI; if the extractor misbehaves
  on a real page, reproduce it in a fixture page under `test/fixtures/`.
