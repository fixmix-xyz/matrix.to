// Serves a built lane locally through the same edge function a host would run (landing/edge.js), so status codes,
// headers and the raw path (`%2F` kept) behave as deployed:
//
//   node scripts/build.js --lane dev && node scripts/serve-local.js [--lane dev] [--port 5000]
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { handleRequest } from "../landing/edge.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json" };

/** The built files as the edge function's `site`. */
export async function loadSite(lane) {
    const dir = path.join(root, "build", lane);
    const config = JSON.parse(await fs.readFile(path.join(root, "config/lanes", `${lane}.json`), "utf8"));
    const files = new Map();
    async function walk(sub) {
        for (const entry of await fs.readdir(path.join(dir, sub), { withFileTypes: true })) {
            const rel = sub ? `${sub}/${entry.name}` : entry.name;
            if (entry.isDirectory()) { await walk(rel); continue; }
            const type = rel.startsWith(".well-known/") ? "application/json" : TYPES[path.extname(rel)] ?? "application/octet-stream";
            files.set(`/${rel}`, { type, body: await fs.readFile(path.join(dir, rel)) });
        }
    }
    await walk("");
    return { config, files };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const args = process.argv.slice(2);
    const lane = args.includes("--lane") ? args[args.indexOf("--lane") + 1] : "dev";
    const port = Number(args.includes("--port") ? args[args.indexOf("--port") + 1] : 5000);
    const site = await loadSite(lane);
    const server = http.createServer(async (req, res) => {
        // req.url is the raw request target: nothing decoded, as §6.5 requires of the host.
        const request = new Request(`http://localhost:${port}${req.url}`, { method: req.method });
        const response = handleRequest(request, site);
        res.writeHead(response.status, Object.fromEntries(response.headers));
        res.end(Buffer.from(await response.arrayBuffer()));
        console.log(req.method, req.url, response.status);
    });
    server.listen(port, "127.0.0.1", () => console.log(`serving the ${lane} landing page on http://127.0.0.1:${port}`));
}
