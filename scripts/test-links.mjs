// Runs every entry of fixtures/links/vectors.json against landing/links.js (SPEC-deeplink.md §4.5, §10):
// parse vectors byte for byte, build vectors (url and every handoff), and the round trip (each built url and
// handoff parses back to the same link). Exit code 1 on any failure.
//
//   node scripts/test-links.mjs                      # the real parser
//   node scripts/test-links.mjs --mutate empty-segment   # mutation control: must FAIL (lx-protocol-relative…)
//   node scripts/test-links.mjs --mutate no-kind-check   # mutation control: must FAIL (x-zymi-encoded-slash…)
//   node scripts/test-links.mjs --json out.json      # also write a per-vector report
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const mutation = args.includes("--mutate") ? args[args.indexOf("--mutate") + 1] : null;
const jsonOut = args.includes("--json") ? args[args.indexOf("--json") + 1] : null;

// Mutations rewrite a copy of the module; the real file is never touched.
const MUTATIONS = {
    "empty-segment": ['if (segments.some(s => s === "")) fail("malformed");', ""],
    "no-kind-check": ["const id = ids.zymi(decode(rest[0]));", "const id = decode(rest[0]);"],
};

async function loadLinks() {
    const source = path.join(root, "landing/links.js");
    if (!mutation) return import(pathToFileURL(source).href);
    const [from, to] = MUTATIONS[mutation] ?? [];
    if (from === undefined) throw new Error(`unknown mutation ${mutation}`);
    const text = await fs.readFile(source, "utf8");
    if (!text.includes(from)) throw new Error(`mutation ${mutation} no longer applies`);
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "links-mutant-"));
    const copy = path.join(dir, "links.js");
    await fs.writeFile(copy, text.replace(from, to));
    return import(pathToFileURL(copy).href);
}

const links = await loadLinks();
const vectors = JSON.parse(await fs.readFile(path.join(root, "fixtures/links/vectors.json"), "utf8"));

/** A build's config for one lane of the file (vectors' `about.other_lanes`). */
function laneConfig(name) {
    const lane = vectors.lanes[name];
    return {
        hosts: lane.hosts,
        server_name: lane.server_name,
        schemes: lane.schemes,
        legacy: vectors.legacy,
        other_lanes: Object.entries(vectors.lanes).filter(([other]) => other !== name).map(([other, value]) => ({
            name: other, hosts: value.hosts, schemes: [...new Set(Object.values(value.schemes))],
        })),
    };
}

const same = (a, b) => JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));
function sortKeys(value) {
    if (Array.isArray(value)) return value.map(sortKeys);
    if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(k => [k, sortKeys(value[k])]));
    return value;
}

const report = [];
let failures = 0;
function record(kind, vector, ok, got, detail = "") {
    report.push({ kind, id: vector.id, ok, got, detail });
    if (!ok) {
        failures += 1;
        console.log(`FAIL ${kind} ${vector.id}${detail ? ` (${detail})` : ""}\n  expect ${JSON.stringify(vector.expect)}\n  got    ${JSON.stringify(got)}`);
    }
}

for (const vector of vectors.parse) {
    const got = links.linkParse(vector.input, laneConfig(vector.lane));
    record("parse", vector, same(got, vector.expect), got);
}

for (const vector of vectors.build) {
    const config = laneConfig(vector.lane);
    const built = links.linkBuild(vector.link, config);
    if (vector.expect.error) {
        record("build", vector, built.error === vector.expect.error, built);
        continue;
    }
    const handoff = {};
    for (const platform of ["ios", "macos", "android", "windows"]) {
        const result = links.linkHandoff(vector.link, config, platform);
        if (result.url) handoff[platform] = result.url;
        else if (result.error !== "no_scheme") handoff[platform] = result;
    }
    const got = { url: built.url, handoff };
    record("build", vector, same(got, { url: vector.expect.url, handoff: vector.expect.handoff ?? {} }), got);
    // Round trip: every built form parses back to the same link.
    for (const [form, url] of [["url", built.url], ...Object.entries(handoff).map(([p, u]) => [`handoff.${p}`, u])]) {
        const back = links.linkParse(url, config);
        record("roundtrip", vector, same(back.link, vector.link), back, form);
    }
}

const counts = { parse: vectors.parse.length, build: vectors.build.length, total: vectors.parse.length + vectors.build.length };
const summary = { mutation, counts, checks: report.length, failures, failed: report.filter(r => !r.ok).map(r => `${r.kind} ${r.id} ${r.detail}`.trim()) };
if (jsonOut) await fs.writeFile(jsonOut, JSON.stringify({ summary, report }, null, 2) + "\n");
console.log(`${counts.total} vectors (${counts.parse} parse, ${counts.build} build), ${report.length} checks, ${failures} failed${mutation ? ` [mutation ${mutation}]` : ""}`);
process.exit(failures ? 1 : 0);
