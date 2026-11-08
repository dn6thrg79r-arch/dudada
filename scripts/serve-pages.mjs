// Local static preview only: no API, file uploads, directory listings or external access.
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { resolve, sep, extname } from "node:path";
const root = resolve("out"),
  mount = process.env.PAGES_BASE_PATH ?? "/dudada";
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".wasm": "application/wasm",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
};
const server = createServer(async (req, res) => {
  try {
    const path = decodeURIComponent(
      new URL(req.url, "http://localhost").pathname,
    );
    if (path === "/" && mount) {
      res.writeHead(302, { Location: mount + "/" });
      return res.end();
    }
    if (mount && path === mount) {
      res.writeHead(302, { Location: mount + "/" });
      return res.end();
    }
    if (mount && !path.startsWith(mount + "/")) {
      res.writeHead(404);
      return res.end("Not found");
    }
    let file = resolve(root, "." + path.slice(mount.length));
    if (file !== root && !file.startsWith(root + sep)) {
      res.writeHead(403);
      return res.end();
    }
    if ((await stat(file)).isDirectory()) file = resolve(file, "index.html");
    const data = await readFile(file);
    res.writeHead(200, {
      "Content-Type": types[extname(file)] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    res.end(data);
  } catch {
    res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
    res.end(await readFile(resolve(root, "404.html")).catch(() => "Not found"));
  }
});
server.listen(Number(process.env.E2E_PORT || 3102), "127.0.0.1", () =>
  console.log(
    `Static Pages preview: http://127.0.0.1:${process.env.E2E_PORT || 3102}${mount}/`,
  ),
);
