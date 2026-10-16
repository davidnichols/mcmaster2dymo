// Turns whatever the iPhone share sheet (or a browser form) sends into a list
// of McMaster part numbers. Accepts a part URL, a page of text containing
// part numbers, or a bare part number.
const PN = /\b(\d{1,5}[A-Z]{1,2}\d{1,5}[A-Z]?)\b/i;
const PN_ALL = new RegExp(PN.source, "gi");

function partNumbersFrom(...inputs) {
  const text = inputs.filter(Boolean).map(String).join("\n");
  const found = [];
  const add = pn => { pn = pn.toUpperCase(); if (!found.includes(pn)) found.push(pn); };

  // Part numbers in mcmaster.com URL paths win: /9541K43/ or /9541K43
  for (const m of text.matchAll(/https?:\/\/(?:[a-z0-9-]+\.)*mcmaster\.com\/([^\s/?#]+)/gi)) {
    const seg = decodeURIComponent(m[1]);
    const p = PN.exec(seg);
    if (p && p[0].length === seg.length) add(p[0]);
  }
  if (found.length) return found;

  // Otherwise anything that looks like a part number, in order of appearance.
  for (const m of text.matchAll(PN_ALL)) add(m[1]);
  return found;
}

module.exports = { partNumbersFrom, PN };
