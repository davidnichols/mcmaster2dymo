# CLAUDE.md

Two front ends that print McMaster-Carr part labels (part number, description,
picture, QR link) on a DYMO LabelWriter 550:
- `extension/` — Chrome MV3 extension for a part page or an order detail page
  in Order History. No build step; loaded unpacked as-is. Plain browser JS.
- `server/` — Node "shop print server" for the Mac next to the printer. The
  McMaster iPhone app shares a part link to it (via an iOS Shortcut) and it
  prints with no Chrome window open. Shares `extension/label.js`,
  `extension/extract.js` and `extension/dymo.js`; nothing else is coupled.
- `mac/` — SwiftUI menu bar app that runs the server as a child process and
  edits its settings file. Optional alternative to the launchd agent.

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
  (`/DYMO/DLS/Printing/StatusConnected|GetPrinters|PrintLabel`). UMD:
  browser gets `window.Dymo`; Node gets `createDymoClient({ fetch })` (printer
  XML is parsed with regexes so no DOMParser is needed).
- `extension/popup.*` — UI; settings in `chrome.storage.sync`. Works on a
  list of `items` (1 on a part page, one per line on an order page); order
  mode adds `body.order-mode` with a line list (checkbox + copies each).
  `popup.html?tab=<id>` targets a given tab (used by the e2e test). Chrome
  caps popups at 600 px tall, so the print button is `position: sticky`.
  On open it GETs `<shopServer>/status` (default `http://localhost:41952`,
  1.5 s timeout; manifest has host permissions for it) and, if the shop print
  server answers, its size/layout/showImage override the stored ones;
  `saveSettings()` also POSTs them to `/settings` as JSON. Not reachable →
  silently standalone.
- `extension/print.*` — fallback: Chrome print dialog with `@page` sized to the
  label; reads `{ labels: [{ dataUrl, copies }], widthIn, heightIn }` from
  `chrome.storage.session`.
- `extension/lib/qrcode.js` — vendored qrcode-generator 1.4.4 (MIT). Don't edit.

## Shop print server (`server/`)
- `index.js` — entry (`npm run server`); wires config, fetcher, printer, app.
- `config.js` — `load()`/`save()` of `~/.mcmaster2dymo.json` (or
  `$MCM2DYMO_CONFIG`), written with defaults on first run: port 41952, bind 0.0.0.0, token, printer, size,
  layout, showImage, copies, printWithoutDetails, chromePath, chromeIdleMs.
- `share.js` — `partNumbersFrom(...texts)`: part numbers from mcmaster.com URL
  paths first, else any `\d+[A-Z]{1,2}\d+[A-Z]?` token. Pure, unit-tested.
- `mcmaster.js` — `createPartFetcher({ chromePath, idleMs, baseUrl })`:
  headless Chrome via playwright-core, runs `extract.js` on
  `<baseUrl>/<pn>/` (part pages need no login; verified live). Browser is
  lazy-launched and closed after `idleMs`. `baseUrl` lets tests point it at the
  fixture server.
- `print.js` — `createPrinter({ dymo })`: `renderForDymo()` mirrors the
  popup's (dymoBounds-sized, padIn 0.02, node-canvas, first picture), then
  `dymo.printLabel`. `insecureFetch` is an https.request fetch-alike that
  accepts DYMO's self-signed cert. Printer choice: configured name, else first
  connected 550.
- `app.js` — `createApp({ config, fetchPart, printer, log })`, plain
  `http`. Every response carries permissive CORS headers (the extension popup
  calls `/status` and `/settings` cross-origin; OPTIONS → 204). `POST /print` (JSON / form / text) and `GET /print?pn=` run one job
  at a time and answer `{ ok, message, labels }` (400 no part number, 401 bad
  token, 502 print/fetch failure); `?ui=1` redirects to `/`. `GET /` status
  page: template picker (one card per `LAYOUTS` entry with a preview from
  `GET /preview/<layout>.png`, rendered via `renderPreview()` from the last
  fetched part or `SAMPLE_PART` + `server/sample.png`, cached in memory;
  clicking auto-submits `POST /settings` with layout/size/showImage, which
  updates `config` and `config.save()`s it), print form, recent jobs (label
  PNGs at `/jobs/<id>/<pn>.png`). `GET /shortcut` iPhone Shortcut
  instructions, `GET /status` JSON.
- `install-launchd.js` — writes `~/Library/LaunchAgents/com.davidnichols.mcmaster2dymo.plist`
  (KeepAlive, RunAtLoad, log in `~/Library/Logs/mcmaster2dymo.log`) and
  bootstraps it; `uninstall` arg removes it.
- `catalog.js` — prints `{ sizes: [{id,name}], layouts: [{id,name}] }` from
  label.js; the Mac app builds its pickers from it.
- `index.js` exits by itself when `MCM2DYMO_WATCH_PARENT` is set and its
  parent dies (ppid becomes 1), so a crashed Mac app never orphans the server.
- iPhone side is a stock Shortcut (Share Sheet → Get Contents of URL, POST
  form `text` = Shortcut Input → Show Notification of `message`); there is no
  app to build. The `/shortcut` page documents it with the real URL.

## Menu bar app (`mac/`)
- `Sources/McMaster2DYMO/`: `App.swift` (`MenuBarExtra` menu + `Settings`
  scene), `ServerController.swift` (`@MainActor ObservableObject`: spawns
  `node server/index.js` with stdout/err appended to
  `~/Library/Logs/mcmaster2dymo.log`, polls `GET /status` every 4 s and
  adopts the `settings` it reports (so the menu follows the status web page
  and the extension popup); menu changes to size/layout/showImage go through
  `POST /settings` on the running server (no restart; falls back to
  save + restart if that fails), other keys write the config and restart;
  `SMAppService` launch-at-login,
  removes the old launchd agent on request), `Config.swift` (`ServerConfig`:
  the JSON file as `[String: Any]`, unknown keys preserved; `Catalog`: sizes
  and layouts via `node server/catalog.js`, hardcoded fallback),
  `SettingsView.swift` (draft + Save & restart).
- `build.sh` (`npm run app`) compiles with plain `swiftc` into
  `dist/McMaster2DYMO.app` (`LSUIElement`, ad-hoc signed) and bakes the repo
  path and `node` path into Info.plist as `MCM2DYMORepo` / `MCM2DYMONode`.
  It does **not** use `swift build`: on this Mac a stray
  `/usr/local/include/block.h` (cloog, 2015) shadows the SDK's `Block.h` and
  breaks every Foundation import, so the script passes a clang VFS overlay
  mapping that path to the SDK header. `Package.swift` exists for editors.
- Verifying it: `MCM2DYMO_CONFIG=<scratch.json> dist/McMaster2DYMO.app/Contents/MacOS/McMaster2DYMO &`
  then `curl 127.0.0.1:<port>/status`. The menu can't be driven from scripts
  without Accessibility access; check it by eye.

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
    UI changes. **Needs a Chromium build**: branded Google Chrome 137+
    silently ignores `--load-extension`, and the test then fails fast with
    "extension not loaded". Get one with `npx playwright-core install chromium`
    (no full `playwright` dependency needed); `chromeLaunchOptions()` in
    `test/helpers.js` looks in `$CHROME_PATH`, then Playwright's cache
    (`~/Library/Caches/ms-playwright/chromium-<build>/…`, newest first),
    then `/opt/pw-browsers`, `/Applications` (Chrome for Testing, Chromium,
    then branded Chrome), then Linux paths. Chromium candidates deliberately
    come before branded Chrome.
  - `server.test.js`: `partNumbersFrom`; the HTTP app with a fake part fetcher
    and fake DYMO client (full label + QR decode, form/GET/text bodies,
    printWithoutDetails, DYMO down, token, serial queue, template picker +
    `/settings` persistence); and the headless
    fetcher against `mock-part-page.html` (skipped without Chrome).
- `npm run server` / `server:install` / `server:uninstall` — see above.
  **Careful: on a Mac with DYMO Connect and a printer attached, `/print`
  really prints.** Use `MCM2DYMO_CONFIG=<file>` to run with a scratch config.
- `npm run layouts [-- <size>]` — writes `docs/<size>-layouts.png`. Look at it
  after any layout change.
- `npm run package` — zips `extension/` into `dist/`.
- `npm run app` — builds the menu bar app into `dist/McMaster2DYMO.app`.

## Conventions
- Default label is 30336 (1" × 2-1/8"); that's the one the user prints.
- After changing layouts, run `npm run layouts` and view the PNG; QR codes
  must still decode (tests enforce this).
- When adding a layout, add it to `LAYOUTS` in label.js; the popup menu and
  tests pick it up automatically.
- Bump `version` in both `extension/manifest.json` and `package.json`.
- Order pages need the user's login; part pages don't (the server relies on
  this). Real pages can't be fetched from tests;
  if the extractor misbehaves on a real page, inspect it (e.g. via Claude in
  Chrome) and reproduce the structure in a fixture under `test/fixtures/`,
  with personal/order details replaced by placeholders.
