// Settings for the shop print server, kept in ~/.mcmaster2dymo.json (or
// $MCM2DYMO_CONFIG). Missing keys fall back to the defaults below; the file
// is written on first run so it's easy to find and edit.
const fs = require("fs");
const os = require("os");
const path = require("path");

const DEFAULTS = {
  port: 41952,           // what the iPhone Shortcut posts to
  bind: "0.0.0.0",       // listen on the LAN (set 127.0.0.1 for this Mac only)
  token: "",             // optional shared secret; if set, requests must carry it
  printer: "",           // DYMO printer name; "" = first connected LabelWriter 550
  size: "30336",         // key of McmLabel.LABEL_SIZES
  layout: "classic",     // key of McmLabel.LAYOUTS
  showImage: true,
  copies: 1,             // default copies per label
  printWithoutDetails: true, // if McMaster can't be read, still print part number + QR
  chromePath: "",        // "" = auto-detect Google Chrome / Chromium
  chromeIdleMs: 300000   // close the headless browser after 5 min without jobs
};

const CONFIG_PATH = process.env.MCM2DYMO_CONFIG || path.join(os.homedir(), ".mcmaster2dymo.json");

function load(file = CONFIG_PATH) {
  let saved = {};
  if (fs.existsSync(file)) {
    saved = JSON.parse(fs.readFileSync(file, "utf8"));
  } else {
    fs.writeFileSync(file, JSON.stringify(DEFAULTS, null, 2) + "\n");
  }
  return { ...DEFAULTS, ...saved, _file: file };
}

module.exports = { DEFAULTS, CONFIG_PATH, load };
