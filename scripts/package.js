// Zips extension/ into dist/mcmaster-dymo-label-<version>.zip
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
const { version } = JSON.parse(fs.readFileSync(path.join(root, "extension/manifest.json"), "utf8"));
fs.mkdirSync(path.join(root, "dist"), { recursive: true });
const out = path.join("dist", `mcmaster2dymo-${version}.zip`);
fs.rmSync(path.join(root, out), { force: true });
execFileSync("zip", ["-rq", out, "extension", "-x", "*.DS_Store"], { cwd: root, stdio: "inherit" });
console.log("wrote", out);
