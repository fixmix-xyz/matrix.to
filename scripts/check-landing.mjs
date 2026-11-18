// P1/P2 check of the landing page (SPEC-deeplink.md §9.2), repeatable, with its evidence in artifacts/landing/<ts>/:
//
//   node scripts/check-landing.mjs [--lane dev] [--chrome "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
//
// 1. Edge status codes for every https parse vector, each on its own lane's config (pure `route`, no server):
//    a link of ours 200, a reject 404 (any path, not only the canonical prefixes), our host's root 200. Vectors that a browser never sends as a request path
//    (credentials, over-long inputs, other hosts, schemes) are listed as skipped with the reason.
// 2. HTTP against the server the dev host runs (scripts/serve.js): status, Content-Type, security headers, the raw
//    `%2F` path, the .well-known files, and request targets that must answer 400 without stopping the server.
// 3. The page in headless Chrome (dump-dom and screenshots at 500 px, headless Chrome's narrowest window; zh and en, iPhone and Mac user agents): what it says,
//    the "open" button's href equals the vector's handoff, no id or path segment echoed, legacy fragments replaced
//    by the canonical path.
// Exit code 1 on any failure.
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { build } from "./build.js";
import { createLandingServer, loadSite } from "./serve.js";
import { route } from "../landing/edge.js";
import { linkHandoff } from "../landing/links.js";

const run = promisify(execFile);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const lane = args.includes("--lane") ? args[args.indexOf("--lane") + 1] : "dev";
const chrome = args.includes("--chrome") ? args[args.indexOf("--chrome") + 1] : "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const out = path.join(root, "artifacts/landing", stamp);
await fs.mkdir(out, { recursive: true });

const vectors = JSON.parse(await fs.readFile(path.join(root, "fixtures/links/vectors.json"), "utf8"));
const results = [];
const check = (group, name, ok, detail = {}) => {
    results.push({ group, name, ok, ...detail });
    if (!ok) console.log(`FAIL ${group} ${name} ${JSON.stringify(detail)}`);
};

function laneLinks(name) {
    const value = vectors.lanes[name];
    return {
        hosts: value.hosts, server_name: value.server_name, schemes: value.schemes, legacy: vectors.legacy,
        other_lanes: Object.entries(vectors.lanes).filter(([o]) => o !== name)
            .map(([o, v]) => ({ name: o, hosts: v.hosts, schemes: [...new Set(Object.values(v.schemes))] })),
    };
}

// 1. Edge status codes, per vector lane.
const page = { type: "text/html; charset=utf-8", body: "page" };
const skipped = [];
for (const vector of vectors.parse) {
    let url = null;
    try { url = new URL(vector.input); } catch { url = null; }
    const links = laneLinks(vector.lane);
    const why = !url || url.protocol !== "https:" ? "not an https request"
        : !links.hosts.includes(url.host) ? "not this lane's host (another lane's or nobody's page)"
        : url.username || url.password ? "credentials never reach the server (the browser strips them)"
        : vector.input.length > 4096 ? "over-long: the server sees the path, not the whole input"
        : null;
    if (why) { skipped.push({ id: vector.id, why }); continue; }
    const result = route(url.pathname, { config: { links }, files: new Map([["/index.html", page]]) });
    const expected = vector.expect.reject ? 404 : 200;
    check("edge-status", vector.id, result.status === expected, { path: url.pathname, status: result.status, expected });
}

// 2. HTTP against the local server.
await build(lane, path.join(root, "build", lane));
const site = await loadSite(lane);
const server = createLandingServer(site);
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;

function get(rawPath) {
    return new Promise((resolve, reject) => {
        // http.request sends the path byte for byte: nothing normalised or decoded on the way.
        const req = http.request(`${origin}/`, { path: rawPath, method: "GET" }, res => {
            const chunks = [];
            res.on("data", c => chunks.push(c));
            res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") }));
        });
        req.on("error", reject);
        req.end();
    });
}

// The lane's own Matrix server name: user IDs and aliases on it are this lane's (config/lanes/<lane>.json).
const S = site.config.links.server_name;
const httpCases = [
    ["/task/deck", 200], ["/task/a%2Fb", 404], [`/r/a%2Fb:${S}`, 200], ["/invite/ABC123", 404], [`/U/x:${S}`, 404],
    ["/u/x:evil.example", 404], ["/roomid/owtPMO14G1v6Yl9KlRjjDmlKdVC5NbSUPqbiF2Fru30/e/Lh9m3k_ZqXo", 200], ["/", 200],
    ["/settings/%E5%AE%98%E6%96%B9%E5%AE%A2%E6%9C%8D", 404], ["/anything/else", 404], ["//task/deck", 404],
];
for (const [rawPath, expected] of httpCases) {
    const response = await get(rawPath);
    const headers = response.headers;
    const csp = headers["content-security-policy"] ?? "";
    check("http", rawPath, response.status === expected && headers["content-type"].startsWith("text/html")
        && csp.includes("script-src 'self'") && csp.includes("connect-src 'none'") && csp.includes("frame-ancestors 'none'")
        && headers["referrer-policy"] === "no-referrer" && /max-age=\d+/.test(headers["strict-transport-security"] ?? ""),
    { status: response.status, expected });
}
for (const file of ["/.well-known/apple-app-site-association", "/.well-known/assetlinks.json"]) {
    const response = await get(file);
    let parsed = null;
    try { parsed = JSON.parse(response.body); } catch { parsed = null; }
    check("well-known", file, response.status === 200 && response.headers["content-type"] === "application/json" && parsed !== null,
        { status: response.status, type: response.headers["content-type"] });
    await fs.writeFile(path.join(out, path.basename(file)), response.body);
}
const aasa = JSON.parse((await get("/.well-known/apple-app-site-association")).body);
const paths = aasa.applinks.details[0].components.map(c => c["/"]);
check("well-known", "aasa paths are §6.1's ten", JSON.stringify(paths) === JSON.stringify(
    ["/u/*", "/r/*", "/roomid/*", "/task/*", "/goal/*", "/agent/*", "/artifact/*", "/circle/*", "/invite/*", "/team/*"]), { paths });
check("well-known", "aasa app id from config", JSON.stringify(aasa.applinks.details[0].appIDs) === JSON.stringify(site.config.apple.app_ids),
    { appIDs: aasa.applinks.details[0].appIDs });

// Request targets that are not a path, and methods the Fetch API refuses: each answers 400 and the server keeps
// serving (one `OPTIONS *` used to stop it).
function rawStatus(requestLine) {
    return new Promise((resolve, reject) => {
        const socket = net.connect(server.address().port, "127.0.0.1");
        let data = "";
        socket.on("data", chunk => { data += chunk; });
        socket.on("end", () => resolve(/^HTTP\/1\.1 (\d{3})/.exec(data)?.[1] ?? null));
        socket.on("error", reject);
        socket.write(`${requestLine}\r\nHost: landing\r\nConnection: close\r\n\r\n`);
    });
}
for (const requestLine of ["OPTIONS * HTTP/1.1", "GET http://evil.example/task/deck HTTP/1.1", "TRACE / HTTP/1.1"]) {
    const status = await rawStatus(requestLine);
    check("http", requestLine, status === "400", { status });
}
check("http", "still serving after the 400s", (await get("/")).status === 200, {});

// 3. The page in Chrome.
const UA = {
    iphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
    mac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
};
const profile = await fs.mkdtemp(path.join(os.tmpdir(), "landing-chrome-"));
async function chromeRun(extra, url) {
    const base = ["--headless=new", "--disable-gpu", "--no-first-run", `--user-data-dir=${profile}`, "--virtual-time-budget=3000"];
    const { stdout } = await run(chrome, [...base, ...extra, url], { maxBuffer: 1 << 24 });
    return stdout;
}
const devLinks = site.config.links;
const pageCases = [
    // [name, path, ua, lang, expected status, expected heading, link for the handoff check]
    ["task-zh-iphone", "/task/deck", "iphone", "zh-CN", "link", "这是一个 Zymi 的任务链接", { kind: "task", id: "deck" }],
    ["task-en-iphone", "/task/deck", "iphone", "en-US", "link", "This is a Zymi task link", { kind: "task", id: "deck" }],
    ["room-zh-mac", "/roomid/owtPMO14G1v6Yl9KlRjjDmlKdVC5NbSUPqbiF2Fru30", "mac", "zh-CN", "link", "这是一个 Zymi 的聊天室链接", { kind: "room", room_id: "!owtPMO14G1v6Yl9KlRjjDmlKdVC5NbSUPqbiF2Fru30" }],
    ["message-en-iphone", `/r/team-alpha:${S}/e/Lh9m3k_ZqXo-2vT8pQ1rW5yA7cE0dF4gH6jK9lM2nB4`, "iphone", "en-US", "link", "This is a Zymi message link",
        { kind: "room", room_alias: `#team-alpha:${S}`, event_id: "$Lh9m3k_ZqXo-2vT8pQ1rW5yA7cE0dF4gH6jK9lM2nB4" }],
    ["user-zh-iphone", `/u/0b1f0c3e-9a52-4b6e-8f1d-2c3b4a5d6e70:${S}`, "iphone", "zh-CN", "link", "这是一个 Zymi 的用户链接",
        { kind: "user", user_id: `@0b1f0c3e-9a52-4b6e-8f1d-2c3b4a5d6e70:${S}` }],
    ["goal-en-mac", "/goal/g_7Kx2", "mac", "en-US", "link", "This is a Zymi goal link", { kind: "goal", id: "g_7Kx2" }],
    ["invalid-zh", "/task/a%2Fb", "iphone", "zh-CN", "malformed", "链接无效", null],
    ["foreign-en", "/u/x:evil.example", "iphone", "en-US", "foreign_server", "This link isn't valid", null],
    ["unknown-kind-zh", `/U/x:${S}`, "iphone", "zh-CN", "unknown_kind", "打不开这个链接，可能需要更新 App", null],
    ["reserved-en", "/invite/ABC123", "iphone", "en-US", "reserved", "Please update the app", null],
    ["no-echo-settings-zh", "/settings/%E5%AE%98%E6%96%B9%E5%AE%A2%E6%9C%8D", "iphone", "zh-CN", "unknown_kind", "打不开这个链接，可能需要更新 App", null],
    ["home-zh", "/", "iphone", "zh-CN", "home", "这里是 Zymi 的分享链接。打开别人发给你的链接，会在 Zymi App 里接着打开。", null],
];
for (const [name, rawPath, ua, lang, status, heading, link] of pageCases) {
    const extra = [`--user-agent=${UA[ua]}`, `--accept-lang=${lang}`, `--lang=${lang}`];
    const dom = await chromeRun([...extra, "--dump-dom"], `${origin}${rawPath}`);
    await fs.writeFile(path.join(out, `${name}.html`), dom);
    await chromeRun([...extra, "--window-size=500,860", `--screenshot=${path.join(out, `${name}.png`)}`], `${origin}${rawPath}`);
    const domStatus = /data-status="([^"]+)"/.exec(dom)?.[1];
    const h1 = /<h1>([^<]*)<\/h1>/.exec(dom)?.[1]?.replace(/&amp;/g, "&").replace(/&#39;/g, "'");
    const hrefs = [...dom.matchAll(/class="button" href="([^"]+)"/g)].map(m => m[1]);
    const platform = ua === "iphone" ? "ios" : "macos";
    const expectedHref = link ? linkHandoff(link, devLinks, platform).url : null;
    const echoed = /官方客服|0b1f0c3e|owtPMO14|g_7Kx2|team-alpha|evil\.example|ABC123/.test(dom.replace(/<a class="button"[^>]*>/g, ""));
    check("page", name, domStatus === status && h1 === heading && (link ? hrefs.length === 1 && hrefs[0] === expectedHref : hrefs.length === 0) && !echoed,
        { status: domStatus, heading: h1, hrefs, expectedHref, echoed });
}
// A legacy fragment is replaced by the canonical path rebuilt from the parse result.
const legacy = await chromeRun([`--user-agent=${UA.iphone}`, "--dump-dom"], `${origin}/#/%23team-alpha%3A${S}`);
check("page", "legacy-fragment-replaced", /data-status="link"/.test(legacy) && legacy.includes(`href="zymi-dev://open/r/team-alpha:${S}"`), {});
const evil = await chromeRun([`--user-agent=${UA.iphone}`, "--dump-dom"], `${origin}/#//evil.example/`);
check("page", "legacy-protocol-relative-rejected", /data-status="malformed"/.test(evil), {});
server.close();

const failed = results.filter(r => !r.ok);
const summary = {
    lane, stamp, checks: results.length, failed: failed.length, skipped, results,
    note: "Screenshots and DOM dumps beside this file; the .well-known files as served.",
};
await fs.writeFile(path.join(out, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
console.log(`${results.length} checks, ${failed.length} failed, ${skipped.length} vectors skipped; evidence in ${path.relative(root, out)}`);
process.exit(failed.length ? 1 : 0);
