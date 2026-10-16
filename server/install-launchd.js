// Installs (or removes) the print server as a per-user launchd agent so it
// starts at login on the shop Mac and is restarted if it dies.
//   node server/install-launchd.js            install / reinstall
//   node server/install-launchd.js uninstall
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const LABEL = "com.davidnichols.mcmaster2dymo";
const plistPath = path.join(os.homedir(), "Library/LaunchAgents", `${LABEL}.plist`);
const logPath = path.join(os.homedir(), "Library/Logs/mcmaster2dymo.log");
const root = path.join(__dirname, "..");
const domain = `gui/${process.getuid()}`;

function launchctl(...args) {
  try { execFileSync("launchctl", args, { stdio: "pipe" }); return true; } catch (_) { return false; }
}

if (process.argv[2] === "uninstall") {
  launchctl("bootout", domain, plistPath);
  fs.rmSync(plistPath, { force: true });
  console.log("removed", plistPath);
  process.exit(0);
}

const esc = s => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key><array>
    <string>${esc(process.execPath)}</string>
    <string>${esc(path.join(root, "server/index.js"))}</string>
  </array>
  <key>WorkingDirectory</key><string>${esc(root)}</string>
  <key>EnvironmentVariables</key><dict>
    <key>PATH</key><string>${esc(path.dirname(process.execPath))}:/usr/local/bin:/usr/bin:/bin</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${esc(logPath)}</string>
  <key>StandardErrorPath</key><string>${esc(logPath)}</string>
</dict></plist>
`;
fs.mkdirSync(path.dirname(plistPath), { recursive: true });
launchctl("bootout", domain, plistPath);
fs.writeFileSync(plistPath, plist);
if (!launchctl("bootstrap", domain, plistPath)) {
  console.error("launchctl bootstrap failed; try: launchctl bootstrap", domain, plistPath);
  process.exit(1);
}
console.log(`installed ${plistPath}\nlog: ${logPath}\nstatus page: http://${os.hostname().replace(/\.local$/i, "")}.local:${require("./config").load().port}/`);
