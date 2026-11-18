// Serves a built lane through the same edge function a host would run (landing/edge.js), so status codes, headers
// and the raw path (`%2F` kept) behave as deployed. The laptop and the dev host's container (deploy/ec2) run this
// same file:
//
//   node scripts/build.js --lane dev && node scripts/serve.js [--lane dev] [--host 127.0.0.1] [--port 5000]
//
// The lane defaults to $LANDING_LANE, then dev. It logs method and status only: link paths carry user, room and
// object IDs, and the page itself never shows them (§8.3).
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { handleRequest, SECURITY_HEADERS } from "../landing/edge.js";

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

/**
 * An http.Server answering every request through `handleRequest`. A request target that is not an origin-form path
 * (`OPTIONS *`, `GET http://other/`) or a method the Fetch API refuses (TRACE, CONNECT) gets a 400, never a crash.
 */
export function createLandingServer(site, { log = () => {} } = {}) {
    const server = http.createServer(async (req, res) => {
        let response;
        try {
            // req.url is the raw request target: nothing decoded, as §6.5 requires of the host.
            if (!req.url.startsWith("/")) throw new TypeError("not an origin-form request target");
            response = handleRequest(new Request(`http://landing${req.url}`, { method: req.method }), site);
        } catch {
            response = new Response("Bad request\n", { status: 400, headers: { "Content-Type": "text/plain; charset=utf-8", ...SECURITY_HEADERS } });
        }
        res.writeHead(response.status, Object.fromEntries(response.headers));
        res.end(Buffer.from(await response.arrayBuffer()));
        log(`${req.method} ${response.status}`);
    });
    // Longer than the load balancer's 60 s idle timeout, so the server never closes a connection the ALB is reusing.
    server.keepAliveTimeout = 65_000;
    server.headersTimeout = 66_000;
    return server;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const args = process.argv.slice(2);
    const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
    const lane = option("--lane", process.env.LANDING_LANE || "dev");
    const host = option("--host", "127.0.0.1");
    const port = Number(option("--port", "5000"));
    const server = createLandingServer(await loadSite(lane), { log: console.log });
    // The container runs node as PID 1, which gets no default signal handling: stop at once, nothing is in flight
    // that matters.
    for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => process.exit(0));
    server.listen(port, host, () => console.log(`serving the ${lane} landing page on http://${host}:${port}`));
}
