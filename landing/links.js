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

// Share links and deep links (SPEC-deeplink.md §4): the landing page's own implementation of the one
// grammar, run in the edge function and in the browser. A port of zymi-core's `links.rs`
// (zymi-services, crates/zymi-core/src/links.rs, branch l2v c87b2800) on the WHATWG URL parser, so
// the input is normalised exactly as §4.2 rule 1 requires. Every function here must pass every entry of
// fixtures/links/vectors.json (scripts/test-links.mjs). No network, no clock, no storage.

/** The longest input `linkParse` reads whole (§4.2 rule 0). */
export const MAX_LINK_INPUT_BYTES = 4096;
const MAX_MATRIX_ID_BYTES = 255;
const MAX_ZYMI_ID_BYTES = 128;

/** Schemes a config may never claim: the web's, Matrix's own and the dangerous ones. */
const RESERVED_SCHEMES = ["http", "https", "ws", "wss", "ftp", "file", "matrix", "javascript", "data", "blob", "about"];
/** Other products' schemes (§5.3, B1). */
const FOREIGN_SCHEMES = ["zymix", "zymixdemo", "siuper", "unseal"];
const PLATFORMS = ["ios", "macos", "android", "windows"];
const ZYMI_KINDS = ["task", "goal", "agent", "artifact", "circle"];

export class ZymiError extends Error {
    constructor(code, message) {
        super(message);
        this.name = "ZymiError";
        this.code = code;
    }
}

const encoder = new TextEncoder();
const byteLength = text => encoder.encode(text).length;

const isAlnum = c => (c >= 0x30 && c <= 0x39) || (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a);
const isIdByte = c => isAlnum(c) || c === 0x5f || c === 0x2d;
const bytesOf = text => Array.from(encoder.encode(text));

function isOpaque(text) {
    return text.length > 0 && bytesOf(text).every(c => isAlnum(c) || "._~-".includes(String.fromCharCode(c)));
}

/** Unicode format characters (general category Cf, Unicode 15.1), as zymi-core lists them. */
function isFormat(cp) {
    return cp === 0x00ad || (cp >= 0x0600 && cp <= 0x0605) || cp === 0x061c || cp === 0x06dd || cp === 0x070f
        || (cp >= 0x0890 && cp <= 0x0891) || cp === 0x08e2 || cp === 0x180e || (cp >= 0x200b && cp <= 0x200f)
        || (cp >= 0x202a && cp <= 0x202e) || (cp >= 0x2060 && cp <= 0x2064) || (cp >= 0x2066 && cp <= 0x206f)
        || cp === 0xfeff || (cp >= 0xfff9 && cp <= 0xfffb) || cp === 0x110bd || cp === 0x110cd
        || (cp >= 0x13430 && cp <= 0x1343f) || (cp >= 0x1bca0 && cp <= 0x1bca3) || (cp >= 0x1d173 && cp <= 0x1d17a)
        || cp === 0xe0001 || (cp >= 0xe0020 && cp <= 0xe007f);
}

/** Rust's `char::is_control`: general category Cc. */
const isControl = cp => cp <= 0x1f || (cp >= 0x7f && cp <= 0x9f);

/** Rust's `char::is_whitespace`: the White_Space property. */
function isWhitespace(cp) {
    return (cp >= 0x09 && cp <= 0x0d) || cp === 0x20 || cp === 0x85 || cp === 0xa0 || cp === 0x1680
        || (cp >= 0x2000 && cp <= 0x200a) || cp === 0x2028 || cp === 0x2029 || cp === 0x202f || cp === 0x205f
        || cp === 0x3000;
}

const codePoints = text => Array.from(text, ch => ch.codePointAt(0));

/** `hostname`, `IPv4` or `[IPv6]`, with an optional `:port` of 1 to 5 digits. */
function isServerName(server) {
    let port;
    if (server.startsWith("[")) {
        const close = server.indexOf("]");
        if (close < 0) return false;
        const inner = server.slice(1, close);
        if (!inner || !/^[0-9A-Fa-f:.]+$/.test(inner)) return false;
        port = server.slice(close + 1);
    } else {
        const colon = server.indexOf(":");
        const end = colon < 0 ? server.length : colon;
        const host = server.slice(0, end);
        if (!host || !/^[A-Za-z0-9.-]+$/.test(host)) return false;
        port = server.slice(end);
    }
    return port === "" || /^:[0-9]{1,5}$/.test(port);
}

/** `<sigil><localpart>:<server>`, split at the first `:`, the server lower-cased; null when it isn't one. */
function withServer(id, sigil, localpartOk) {
    if (!id.startsWith(sigil)) return null;
    const rest = id.slice(sigil.length);
    const colon = rest.indexOf(":");
    if (colon < 0) return null;
    const localpart = rest.slice(0, colon);
    const server = rest.slice(colon + 1);
    const valid = byteLength(id) <= MAX_MATRIX_ID_BYTES && localpart.length > 0 && localpartOk(localpart) && isServerName(server);
    return valid ? `${sigil}${localpart}:${asciiLower(server)}` : null;
}

const asciiLower = text => text.replace(/[A-Z]/g, c => c.toLowerCase());
const serverPart = id => { const i = id.indexOf(":"); return i < 0 ? "" : id.slice(i + 1); };

/** Matrix and Zymi ids (§4.1 rule 8); each returns the normalised id or null. */
export const ids = {
    user(id) {
        return withServer(id, "@", lp => !lp.startsWith("@") && bytesOf(lp).every(c => c >= 0x21 && c <= 0x7e));
    },
    alias(id) {
        return withServer(id, "#", lp => !lp.startsWith("#")
            && !codePoints(lp).some(cp => isControl(cp) || isWhitespace(cp) || isFormat(cp)));
    },
    room(id) {
        if (!id.startsWith("!")) return null;
        const rest = id.slice(1);
        if (rest.includes(":")) return withServer(id, "!", isOpaque);
        const valid = rest.length > 0 && byteLength(id) <= MAX_MATRIX_ID_BYTES && bytesOf(rest).every(isIdByte);
        return valid ? id : null;
    },
    event(id) {
        if (!id.startsWith("$")) return null;
        const rest = id.slice(1);
        const base64 = rest.length > 0 && bytesOf(rest).every(c => isAlnum(c) || "+/=_-".includes(String.fromCharCode(c)));
        const opaque = () => {
            const colon = rest.indexOf(":");
            return colon >= 0 && isOpaque(rest.slice(0, colon)) && isServerName(rest.slice(colon + 1));
        };
        return byteLength(id) <= MAX_MATRIX_ID_BYTES && (base64 || opaque()) ? id : null;
    },
    zymi(id) {
        const length = byteLength(id);
        return length >= 1 && length <= MAX_ZYMI_ID_BYTES && bytesOf(id).every(isIdByte) ? id : null;
    },
};

// MARK: Config (§5.3)

const CONFIG_KEYS = ["hosts", "server_name", "schemes", "legacy", "other_lanes"];

/** `host[:port]` of a URL, the way hosts are written in a config. */
const authority = url => url.port ? `${url.hostname}:${url.port}` : url.hostname;

function isSerialisedHost(host) {
    let url;
    try { url = new URL(`https://${host}/`); } catch { return false; }
    return !url.username && !url.password && url.pathname === "/" && !url.search && !url.hash && authority(url) === host;
}

const isScheme = scheme => /^[a-z][a-z0-9+.-]*$/.test(scheme);
const ownScheme = scheme => isScheme(scheme) && !RESERVED_SCHEMES.includes(scheme) && !FOREIGN_SCHEMES.includes(scheme);

function configError(message) {
    return new ZymiError("invalidRequest", message);
}

function listedSchemes(schemes) {
    return PLATFORMS.map(p => schemes[p]).filter(s => typeof s === "string");
}

function schemesContain(schemes, scheme) {
    return listedSchemes(schemes).some(listed => listed.toLowerCase() === scheme.toLowerCase());
}

/** Throws `ZymiError(invalidRequest)` for a config §5.3 refuses: the same checks as zymi-core, plus unknown fields. */
export function validateConfig(config) {
    if (!config || typeof config !== "object") throw configError("no config");
    for (const key of Object.keys(config)) {
        if (!CONFIG_KEYS.includes(key)) throw configError(`unknown config field ${JSON.stringify(key)}`);
    }
    const { hosts, server_name: serverName, schemes, legacy, other_lanes: otherLanes } = config;
    if (!Array.isArray(hosts) || !hosts.length) throw configError("no host");
    if (!schemes || typeof schemes !== "object" || Object.keys(schemes).some(k => !PLATFORMS.includes(k))) {
        throw configError("schemes must map platforms");
    }
    if (!legacy || !Array.isArray(legacy.fragment_bases) || Object.keys(legacy).some(k => k !== "fragment_bases")) {
        throw configError("legacy.fragment_bases is required");
    }
    if (!Array.isArray(otherLanes)) throw configError("other_lanes is required");
    const seen = [];
    const lanes = [["this lane", hosts], ...otherLanes.map(lane => [lane && lane.name, lane && lane.hosts])];
    for (const [lane, laneHosts] of lanes) {
        if (!Array.isArray(laneHosts)) throw configError(`${lane}: hosts is required`);
        for (const host of laneHosts) {
            if (typeof host !== "string" || !isSerialisedHost(host)) {
                throw configError(`${lane}: host ${JSON.stringify(host)} is not written as a URL serialises it`);
            }
            if (seen.includes(host)) throw configError(`host ${JSON.stringify(host)} is listed twice or on two lanes`);
            seen.push(host);
        }
    }
    otherLanes.forEach((lane, index) => {
        if (Object.keys(lane).some(k => !["name", "hosts", "schemes"].includes(k))) throw configError("unknown lane field");
        if (typeof lane.name !== "string" || !lane.name || otherLanes.slice(0, index).some(o => o.name === lane.name)) {
            throw configError(`lane name ${JSON.stringify(lane.name)} is empty or listed twice`);
        }
    });
    if (typeof serverName !== "string" || !isServerName(serverName) || serverName !== asciiLower(serverName)) {
        throw configError(`server name ${JSON.stringify(serverName)} is not a lower-case server name`);
    }
    for (const scheme of listedSchemes(schemes)) {
        if (!ownScheme(scheme)) throw configError(`scheme ${JSON.stringify(scheme)} is not a lower-case scheme of the app's own`);
    }
    const laneSchemes = [];
    for (const lane of otherLanes) {
        const list = lane.schemes === undefined ? [] : lane.schemes;
        if (!Array.isArray(list)) throw configError(`${lane.name}: schemes must be a list`);
        for (const scheme of list) {
            if (typeof scheme !== "string" || !ownScheme(scheme) || schemesContain(schemes, scheme) || laneSchemes.includes(scheme)) {
                throw configError(`${lane.name}: scheme ${JSON.stringify(scheme)} is not a lower-case scheme of that lane's own`);
            }
            laneSchemes.push(scheme);
        }
    }
    for (const base of legacy.fragment_bases) {
        let parsed = null;
        try { parsed = new URL(base); } catch { parsed = null; }
        const ok = parsed && parsed.protocol === "https:" && parsed.href === base && !parsed.username && !parsed.password
            && !parsed.search && !parsed.hash && !base.includes("#") && !base.includes("?");
        if (!ok || seen.includes(authority(parsed))) {
            throw configError(`legacy base ${JSON.stringify(base)} is not a serialised https URL off the lanes' hosts`);
        }
    }
}

/** The legacy form every build reads (D3): matrix.to only. */
export function linkLegacyStandard() {
    return { fragment_bases: ["https://matrix.to/"] };
}

// MARK: Parse (§4.2)

const reject = reason => ({ reject: reason });
class Rejected { constructor(reason) { this.reason = reason; } }
const fail = reason => { throw new Rejected(reason); };

/**
 * Classifies `input` for this build. Returns `{link, source}`, `{reject}`, `{other_lane}` or `{not_ours: true}`
 * (the vectors' shapes); throws only for an invalid config.
 */
export function linkParse(input, config) {
    validateConfig(config);
    if (typeof input !== "string") return { not_ours: true };
    const bytes = encoder.encode(input);
    if (bytes.length <= MAX_LINK_INPUT_BYTES) {
        const url = parseURL(input);
        return url ? classifyOrReject(url, config) : { not_ours: true };
    }
    // Too long: only the head is read, cut back to a character boundary.
    let end = MAX_LINK_INPUT_BYTES;
    while (end > 0 && (bytes[end] & 0xc0) === 0x80) end -= 1;
    const head = new TextDecoder().decode(bytes.subarray(0, end));
    const url = parseURL(head);
    if (!url) return { not_ours: true };
    const result = classifyOrReject(url, config);
    return result.link || result.reject ? reject("malformed") : result;
}

function parseURL(text) {
    try { return new URL(text); } catch { return null; }
}

function classifyOrReject(url, config) {
    try {
        return classify(url, config);
    } catch (error) {
        if (error instanceof Rejected) return reject(error.reason);
        throw error;
    }
}

function classify(url, config) {
    const scheme = url.protocol.slice(0, -1);
    const credentials = url.username !== "" || url.password !== "";
    if (scheme === "https") {
        const host = url.hostname;
        if (!host) return { not_ours: true };
        const auth = authority(url);
        const listed = hosts => hosts.some(h => h.toLowerCase() === auth.toLowerCase());
        if (listed(config.hosts)) {
            if (credentials) fail("malformed");
            const segments = pathSegments(url.pathname);
            if (!segments) return { not_ours: true };
            return { link: grammar(segments, config), source: "canonical" };
        }
        const lane = config.other_lanes.find(l => listed(l.hosts));
        if (lane) return { other_lane: lane.name };
        const base = `https://${auth}${url.pathname}`;
        if (config.legacy.fragment_bases.includes(base)) {
            // `url.hash` is "" both for no fragment and for an empty one; neither starts with "#/".
            if (!url.hash.startsWith("#/")) return { not_ours: true };
            if (credentials) fail("malformed");
            return legacyFragment(url.hash.slice(2), config);
        }
        return { not_ours: true };
    }
    if (schemesContain(config.schemes, scheme)) {
        if (!url.hostname || url.hostname.toLowerCase() !== "open") return { not_ours: true };
        if (credentials || url.port !== "") fail("malformed");
        const segments = pathSegments(url.pathname);
        if (!segments) fail("malformed");
        return { link: grammar(segments, config), source: "scheme" };
    }
    const lane = config.other_lanes.find(l => (l.schemes || []).includes(scheme));
    if (lane) return { other_lane: lane.name };
    return { not_ours: true };
}

/** §4.2 rule 3: the path's segments, one trailing slash allowed; null for an empty path or `/`. */
function pathSegments(path) {
    if (path === "" || path === "/") return null;
    let rest = path.startsWith("/") ? path.slice(1) : path;
    if (rest.endsWith("/")) rest = rest.slice(0, -1);
    const segments = rest.split("/");
    if (segments.some(s => s === "")) fail("malformed");
    return segments;
}

/** §4.2 rules 4-8: the kind (literal, before decoding), then each id decoded once and validated. */
function grammar(segments, config) {
    const [kind, ...rest] = segments;
    if (kind === "invite" || kind === "team") fail("reserved");
    if (kind === "u") {
        if (rest.length !== 1) fail("malformed");
        return user(`@${decode(rest[0])}`, config);
    }
    if (kind === "r" || kind === "roomid") {
        let event = null;
        if (rest.length === 3 && rest[1] === "e") event = rest[2];
        else if (rest.length !== 1) fail("malformed");
        const sigil = kind === "r" ? "#" : "!";
        const eventId = event === null ? null : `$${decode(event)}`;
        return room(`${sigil}${decode(rest[0])}`, eventId, config);
    }
    if (ZYMI_KINDS.includes(kind)) {
        if (rest.length !== 1) fail("malformed");
        const id = ids.zymi(decode(rest[0]));
        if (id === null) fail("malformed");
        return { kind, id };
    }
    fail("unknown_kind");
}

function onLane(server, config) {
    return server.toLowerCase() === config.server_name.toLowerCase();
}

function user(id, config) {
    const userId = ids.user(id);
    if (userId === null) fail("malformed");
    if (!onLane(serverPart(userId), config)) fail("foreign_server");
    return { kind: "user", user_id: userId };
}

function room(id, event, config) {
    let eventId;
    if (event !== null) {
        eventId = ids.event(event);
        if (eventId === null) fail("malformed");
    }
    let link;
    let server = null;
    if (id.startsWith("#")) {
        const alias = ids.alias(id);
        if (alias === null) fail("malformed");
        server = serverPart(alias);
        link = { kind: "room", room_alias: alias };
    } else {
        const roomId = ids.room(id);
        if (roomId === null) fail("malformed");
        if (roomId.includes(":")) server = serverPart(roomId);
        link = { kind: "room", room_id: roomId };
    }
    if (eventId !== undefined) link.event_id = eventId;
    if (server !== null && !onLane(server, config)) fail("foreign_server");
    return link;
}

/** §4.2 rule 5: percent-decoded exactly once; a bad escape, non-UTF-8 bytes or a control character is malformed. */
function decode(segment) {
    const raw = encoder.encode(segment);
    const out = [];
    for (let i = 0; i < raw.length;) {
        if (raw[i] === 0x25) {
            const hex = String.fromCharCode(raw[i + 1] ?? 0, raw[i + 2] ?? 0);
            if (i + 2 >= raw.length || !/^[0-9A-Fa-f]{2}$/.test(hex)) fail("malformed");
            out.push(parseInt(hex, 16));
            i += 3;
        } else {
            out.push(raw[i]);
            i += 1;
        }
    }
    let text;
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(out)); } catch { fail("malformed"); }
    if (codePoints(text).some(isControl)) fail("malformed");
    return text;
}

/** The legacy `#/<sigil id>[/<$event>][?…]` fragment on a listed base. `rest` is the fragment after `#/`. */
function legacyFragment(rest, config) {
    const query = rest.indexOf("?");
    if (query >= 0) rest = rest.slice(0, query);
    const parts = rest.split("/");
    const identifier = parts[0] ?? "";
    const event = parts.length > 1 ? parts[1] : null;
    if (identifier === "" || event === "" || parts.length > 2) fail("malformed");
    if (identifier === "user") {
        if (event === null) fail("malformed");
        const userId = decode(event);
        if (!userId.startsWith("@")) fail("malformed");
        return { link: user(userId, config), source: "matrix_to" };
    }
    const id = decode(identifier);
    const eventId = event === null ? null : decode(event);
    let link;
    if (id.startsWith("@") && eventId === null) link = user(id, config);
    else if (id.startsWith("#") || id.startsWith("!")) link = room(id, eventId, config);
    else if (id.startsWith("+")) fail("unknown_kind");
    else fail("malformed");
    return { link, source: "matrix_to" };
}

// MARK: Build (§4.1)

/** §4.1 rule 4: each UTF-8 byte outside `A-Z a-z 0-9 - . _ ~ :` as `%XX`, upper-case hex. Not encodeURIComponent. */
export function encodeId(id) {
    let out = "";
    for (const c of encoder.encode(id)) {
        if (isAlnum(c) || "-._~:".includes(String.fromCharCode(c))) out += String.fromCharCode(c);
        else out += `%${c.toString(16).toUpperCase().padStart(2, "0")}`;
    }
    return out;
}

class BuildError { constructor(code) { this.code = code; } }

function linkPath(link, config) {
    const check = server => { if (!onLane(server, config)) throw new BuildError("foreign_server"); };
    const valid = value => { if (value === null || value === undefined) throw new BuildError("invalid_id"); return value; };
    const eventPart = event => {
        if (event === undefined || event === null) return "";
        return `/e/${encodeId(valid(ids.event(event)).slice(1))}`;
    };
    switch (link && link.kind) {
        case "user": {
            const id = valid(typeof link.user_id === "string" ? ids.user(link.user_id) : null);
            check(serverPart(id));
            return `/u/${encodeId(id.slice(1))}`;
        }
        case "room": {
            if (typeof link.room_alias === "string" && link.room_id === undefined) {
                const alias = valid(ids.alias(link.room_alias));
                check(serverPart(alias));
                return `/r/${encodeId(alias.slice(1))}${eventPart(link.event_id)}`;
            }
            if (typeof link.room_id === "string" && link.room_alias === undefined) {
                const roomId = valid(ids.room(link.room_id));
                if (roomId.includes(":")) check(serverPart(roomId));
                return `/roomid/${encodeId(roomId.slice(1))}${eventPart(link.event_id)}`;
            }
            throw new BuildError("invalid_id");
        }
        default:
            if (link && ZYMI_KINDS.includes(link.kind)) {
                return `/${link.kind}/${valid(typeof link.id === "string" ? ids.zymi(link.id) : null)}`;
            }
            throw new BuildError("invalid_id");
    }
}

function attempt(make) {
    try {
        return { url: make() };
    } catch (error) {
        if (error instanceof BuildError) return { error: error.code };
        throw error;
    }
}

/** `{url}` (the canonical `https://<hosts[0]>/<kind>/<id>[/e/<event>]`) or `{error}`. */
export function linkBuild(link, config) {
    validateConfig(config);
    return attempt(() => `https://${config.hosts[0]}${linkPath(link, config)}`);
}

/** `{url}` (the same path behind `<scheme>://open` for `platform`'s app) or `{error}` (also `no_scheme`). */
export function linkHandoff(link, config, platform) {
    validateConfig(config);
    return attempt(() => {
        const path = linkPath(link, config);
        const scheme = config.schemes[platform];
        if (!scheme) throw new BuildError("no_scheme");
        return `${scheme}://open${path}`;
    });
}

/** What the link points at, for the landing page's type name (§6.5): user, room, message, task… */
export function linkType(link) {
    if (link.kind === "room") return link.event_id ? "message" : "room";
    return link.kind;
}
