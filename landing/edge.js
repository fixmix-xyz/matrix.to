/*
Copyright 2026 Zymi

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

// The landing page's edge function (SPEC-deeplink.md §6.5), written against the Fetch API only, so any
// host that runs one (B5 is pending: Cloudflare Workers, Pages Functions…) can wrap it; scripts/serve-local.js
// runs the same code locally. It never fetches anything: it decides a status code and returns built files.
//
// - `/.well-known/*`: the generated files, application/json, 200, never a redirect.
// - a built file: that file.
// - any other path: the page, 200 for a link of ours or our root, 404 for one the parser rejects (the page tells
//   why, as the app does). §6.5 judges only the canonical prefixes and falls back to the home page elsewhere; this
//   judges every path, so `/U/…`, `//task/…` or a future kind (`/settings/…`) answer 404 with "update the app",
//   the same as the app says, instead of a 200 home page.
// The path is read raw (`%2F` stays encoded): the host must hand the original path to this function.

import { linkParse } from "./links.js";

/** The canonical kinds' first path segments (§6.1's AASA paths, reserved ones included). */
export const CANONICAL_KINDS = ["u", "r", "roomid", "task", "goal", "agent", "artifact", "circle", "invite", "team"];

export const SECURITY_HEADERS = {
    "Content-Security-Policy": "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'none'; "
        + "font-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    "Strict-Transport-Security": "max-age=31536000",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
};

/**
 * Decides the response for a raw path. `site` is `{config, files}`: the lane's config (`config/lanes/<lane>.json`)
 * and the built files, `Map(path → {type, body})`, with the page at `/index.html`.
 * Returns `{status, type, body}`; pure, so it is tested without a server.
 */
export function route(rawPath, site) {
    const path = rawPath.split("?")[0].split("#")[0] || "/";
    const page = site.files.get("/index.html");
    if (path.startsWith("/.well-known/")) {
        const file = site.files.get(path);
        return file ? { status: 200, ...file } : { status: 404, type: "text/plain; charset=utf-8", body: "Not found\n" };
    }
    const file = path !== "/" && site.files.get(path);
    if (file) return { status: 200, ...file };
    const links = site.config.links;
    const verdict = linkParse(`https://${links.hosts[0]}${path}`, links);
    return { status: verdict.reject ? 404 : 200, ...page };
}

/** The Fetch API wrapper: `export default {fetch: request => handleRequest(request, site)}` on a worker. */
export function handleRequest(request, site) {
    if (request.method !== "GET" && request.method !== "HEAD") {
        return new Response("Method not allowed\n", { status: 405, headers: { Allow: "GET, HEAD", ...SECURITY_HEADERS } });
    }
    const url = new URL(request.url);
    const result = route(url.pathname, site);
    const headers = { "Content-Type": result.type, "Cache-Control": "no-cache", ...SECURITY_HEADERS };
    return new Response(request.method === "HEAD" ? null : result.body, { status: result.status, headers });
}
