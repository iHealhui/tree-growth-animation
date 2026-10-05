// Tiny standalone HTTP server (NOT part of the Vite dev server) that accepts
// base64 PNG frame data over POST and writes each to disk, so a browser page
// can push out hundreds of rendered canvas frames synchronously (fetch calls
// aren't subject to the background-tab setTimeout/rAF throttling that broke
// the earlier real-time approach) for later ffmpeg encoding into a video.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const PORT = 3032;
const OUT_DIR = process.argv[2];
if (!OUT_DIR) {
  console.error("Usage: node frame-server.mjs <output-dir>");
  process.exit(1);
}
fs.mkdirSync(OUT_DIR, { recursive: true });

let received = 0;

const server = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  if (req.method === "POST" && req.url.startsWith("/frame/")) {
    const name = req.url.slice("/frame/".length);
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      const b64 = body.replace(/^data:image\/png;base64,/, "");
      // name may include a subfolder (e.g. "tree-01-healthy/frame-0000.png") so
      // one server run can collect several stages' frames side by side
      const dest = path.join(OUT_DIR, name);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, Buffer.from(b64, "base64"));
      received++;
      res.writeHead(200);
      res.end("ok");
    });
    return;
  }

  if (req.method === "GET" && req.url === "/status") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ received, outDir: OUT_DIR }));
    return;
  }

  res.writeHead(404);
  res.end();
});

server.listen(PORT, () => {
  console.log("Frame server listening on http://localhost:" + PORT + ", writing to", OUT_DIR);
});
