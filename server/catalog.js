#!/usr/bin/env node
// Prints the label sizes and layouts from extension/label.js as JSON, for
// the Mac menu bar app (mac/) to build its pickers from the one source of truth.
//   node server/catalog.js  ->  { "sizes": [{ "id", "name" }], "layouts": [{ "id", "name" }] }
const path = require("path");
const Label = require(path.join(__dirname, "../extension/label.js"));
const entries = o => Object.entries(o).map(([id, v]) => ({ id, name: v.name || id }));
process.stdout.write(JSON.stringify({ sizes: entries(Label.LABEL_SIZES), layouts: entries(Label.LAYOUTS) }) + "\n");
