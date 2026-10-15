# McMaster → DYMO Label

Chrome extension that prints **DYMO LabelWriter 550** labels for McMaster-Carr
parts: part number, description, part picture and a QR code linking back to
`https://www.mcmaster.com/<part number>/`. Works on a single part page, or on
an order in Order History to label everything in that order at once.

![30336 layouts](docs/30336-layouts.png)

## Install
1. `git clone https://github.com/davidnichols/mcmaster2dymo` (or build a zip with `npm run package`).
2. Open `chrome://extensions`, turn on **Developer mode**.
3. **Load unpacked** → select the `extension/` folder.
4. Pin the extension. After pulling changes, click reload on its card.

## Printer setup
The LabelWriter 550 needs **DYMO Connect for Desktop** running; the extension
prints through its local web service. The first time, open
https://127.0.0.1:41951/DYMO/DLS/Printing/StatusConnected in Chrome and accept
the certificate (it should say `true`). Then the popup lists your DYMO printers.

Without DYMO Connect the extension falls back to Chrome's print dialog: pick
the LabelWriter, set the paper size to your label and Margins to None.

## Use
**One part:** on a part page (e.g. `mcmaster.com/9541K43`), click the icon or
press **Alt+Shift+L**. Check the preview, edit the description if needed,
choose label size, layout and printer, and click **Print label**.

**A whole order:** open the order in Order History
(`mcmaster.com/order-history/order/…`) and click the icon. Every line is
listed with a checkbox and a copies box (1 each by default). Untick lines you
don't want, set copies, click a line to preview it or edit its description,
then **Print N labels**. Each label is sent to the 550 in turn.

Settings (size, layout, printer, picture on/off) are remembered.

- **Label sizes:** 30336 (1" × 2-1/8", default), 30252 Address, 30256 Shipping.
- **Layouts:** Classic, Banner, Black bar, Big picture, QR first, Text only.
- **Pictures:** 300 px versions of McMaster's images. On a part page it uses
  the product render at the top of the page and skips dimension drawings; use
  ◀ ▶ under **Picture** to pick another, or untick it.

## Development
```sh
npm install          # canvas, jsqr, playwright-core (dev only)
npm test             # layout/QR tests, extractor tests, and end-to-end popup tests
                     # (extension loaded in headless Chrome, fake McMaster + DYMO)
npm run layouts      # regenerate docs/30336-layouts.png (or: npm run layouts -- 30252)
npm run package      # dist/mcmaster2dymo-<version>.zip
```
The browser tests need Chrome or Chromium; set `CHROME_PATH` if it isn't
found automatically. Set `E2E_SCREENSHOTS=<dir>` to save popup screenshots.

QR codes: [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator)
by Kazuhiko Arase (MIT), vendored at `extension/lib/qrcode.js`.

## License

[MIT](LICENSE) © 2026 David Nichols
