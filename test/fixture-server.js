// Serves test/fixtures over HTTP. "/" or any path ending in "/" serves `index`.
const http = require("http");
const fs = require("fs");
const path = require("path");

const FX = path.join(__dirname, "fixtures");
const TYPES = { ".html": "text/html", ".png": "image/png" };

function fixtureResponse(urlPath, index) {
  const rel = decodeURIComponent(urlPath.split("?")[0]);
  const file = rel.endsWith("/") ? path.join(FX, index) : path.join(FX, path.normalize(rel).replace(/^([/\\])+/, ""));
  if (!file.startsWith(FX) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return null;
  return { body: fs.readFileSync(file), type: TYPES[path.extname(file)] || "application/octet-stream" };
}

async function serve(index) {
  const srv = http.createServer((req, res) => {
    // Paths like /order-history/order/abc/order-img/x.png resolve relative to the page.
    const r = fixtureResponse(req.url.replace(/^\/(order-history\/order\/[^/]+|[0-9A-Z]+)\//, "/"), index);
    if (!r) { res.statusCode = 404; return res.end(); }
    res.setHeader("content-type", r.type);
    res.end(r.body);
  });
  await new Promise(r => srv.listen(0, r));
  return { srv, port: srv.address().port };
}

module.exports = { serve, fixtureResponse };
