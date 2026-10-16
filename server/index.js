#!/usr/bin/env node
// McMaster → DYMO shop print server. Run with `npm run server`, or install it
// as a launchd agent with `npm run server:install`.
const config = require("./config").load();
const { createPartFetcher } = require("./mcmaster");
const { createPrinter } = require("./print");
const { createApp } = require("./app");

const log = (...a) => console.log(new Date().toISOString(), ...a);
const fetcher = createPartFetcher({ chromePath: config.chromePath, idleMs: config.chromeIdleMs, log });
const printer = createPrinter();
const app = createApp({ config, fetchPart: fetcher.fetchPart, printer, log });

app.server.listen(config.port, config.bind, () => {
  log(`listening on ${config.bind}:${config.port} — ${app.baseUrl()}  (config: ${config._file})`);
  log(`chrome: ${fetcher.findChrome() || "NOT FOUND — set chromePath"}`);
  printer.status().then(s => log(s.ok
    ? `DYMO Connect: ${s.printers.map(p => p.name + (p.connected ? "" : " (offline)")).join(", ") || "no printers"}`
    : `DYMO Connect: ${s.error}`));
});

// When the menu bar app (mac/) launched us, die with it: an app that crashes
// or is force-quit would otherwise leave this server holding the port.
if (process.env.MCM2DYMO_WATCH_PARENT) {
  setInterval(() => {
    if (process.ppid === 1) { log("parent app gone, exiting"); fetcher.close().finally(() => process.exit(0)); }
  }, 3000).unref();
}

for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, async () => { await fetcher.close(); process.exit(0); });
