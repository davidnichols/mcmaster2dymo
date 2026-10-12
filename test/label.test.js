const test = require("node:test");
const assert = require("node:assert");
const { Label, fixture, render, decodeQR, loadImage, SAMPLE_PARTS } = require("./helpers");

test("every layout × size renders at 300 dpi with a scannable QR code", async () => {
  const img = await loadImage(fixture("screw.png"));
  for (const size of Object.keys(Label.LABEL_SIZES)) {
    const s = Label.LABEL_SIZES[size];
    for (const layout of Object.keys(Label.LAYOUTS)) {
      for (const part of Object.values(SAMPLE_PARTS)) {
        const c = render(part, { size, layout, image: img });
        assert.strictEqual(c.width, Math.round(s.width * 300));
        assert.strictEqual(c.height, Math.round(s.height * 300));
        assert.strictEqual(decodeQR(c), part.url, `${size}/${layout}/${part.partNumber}`);
      }
    }
  }
});

test("renders without a picture", () => {
  const c = render(SAMPLE_PARTS.bumper, { image: null });
  assert.strictEqual(decodeQR(c), SAMPLE_PARTS.bumper.url);
});

test("white borders are trimmed so the part fills its box", async () => {
  // render.png is a part surrounded by lots of white; after trimming, the
  // picture area in the classic layout should be substantially inked.
  const img = await loadImage(fixture("render.png"));
  const c = render(SAMPLE_PARTS.bumper, { image: img, layout: "classic" });
  const g = c.getContext("2d");
  const boxW = Math.round(c.width * 0.24);
  const d = g.getImageData(30, 0, boxW, c.height).data;
  let ink = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i] < 200) ink++;
  assert.ok(ink / (d.length / 4) > 0.25, `picture too small: ${(ink / (d.length / 4)).toFixed(2)}`);
});

test("DYMO label XML is well formed and embeds the image", () => {
  for (const s of Object.values(Label.LABEL_SIZES)) {
    const xml = Label.dymoLabelXml(s, "QUJD");
    assert.match(xml, /^<\?xml/);
    assert.match(xml, /<PaperName>.+<\/PaperName>/);
    assert.match(xml, /<Image>QUJD<\/Image>/);
    const b = Label.dymoBounds(s);
    assert.ok(b.w > 0 && b.h > 0);
  }
});
