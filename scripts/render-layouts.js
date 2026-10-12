// Renders every layout for a label size into a comparison sheet.
//   npm run layouts               -> docs/30336-layouts.png
//   npm run layouts -- 30252      -> docs/30252-layouts.png
const fs = require("fs");
const path = require("path");
const { Label, fixture, render, loadImage, createCanvas, SAMPLE_PARTS, ROOT } = require("../test/helpers");

(async () => {
  const size = process.argv[2] || "30336";
  const s = Label.LABEL_SIZES[size];
  if (!s) throw new Error("Unknown size " + size + "; one of " + Object.keys(Label.LABEL_SIZES).join(", "));
  const img = await loadImage(fixture("screw.png"));
  const parts = [SAMPLE_PARTS.screw, SAMPLE_PARTS.collar];
  const keys = Object.keys(Label.LAYOUTS);
  const lw = Math.round(s.width * 300), lh = Math.round(s.height * 300), gx = 40, cap = 46;
  const sheet = createCanvas(gx + parts.length * (lw + gx * 2) - gx, 30 + keys.length * (lh + cap + gx));
  const g = sheet.getContext("2d");
  g.fillStyle = "#d8d8d8"; g.fillRect(0, 0, sheet.width, sheet.height);
  keys.forEach((k, i) => {
    const y = 30 + i * (lh + cap + gx);
    g.fillStyle = "#111"; g.font = "bold 30px Arial"; g.textBaseline = "top";
    g.fillText(`${String.fromCharCode(65 + i)}. ${Label.LAYOUTS[k].name}`, gx, y);
    parts.forEach((p, j) => {
      const c = render(p, { size, layout: k, image: img });
      const x = gx + j * (lw + gx * 2);
      g.save(); g.beginPath(); g.roundRect(x, y + cap, lw, lh, 24); g.clip(); g.drawImage(c, x, y + cap); g.restore();
    });
  });
  const out = path.join(ROOT, "docs", `${size}-layouts.png`);
  fs.writeFileSync(out, sheet.toBuffer("image/png"));
  console.log("wrote", path.relative(ROOT, out));
})();
