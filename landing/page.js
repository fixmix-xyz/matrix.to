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

// The landing page in the browser (SPEC-deeplink.md §6.5): it reads its own address with the same parser the
// edge function uses, shows only the link's type (never an id, never a path segment: §8.3), and offers the
// handoff `<scheme>://open/…` built from the parse result. A legacy matrix.to fragment is parsed here (the
// server never sees fragments) and replaced by the canonical path rebuilt from the result. No requests.

import site from "/config.js";
import { linkBuild, linkHandoff, linkParse, linkType } from "/links.js";

const TEXT = {
    zh: {
        title: "Zymi",
        home: "这里是 Zymi 的分享链接。打开别人发给你的链接，会在 Zymi App 里接着打开。",
        intro: type => `这是一个 Zymi 的${type}链接`,
        types: { user: "用户", room: "聊天室", message: "消息", task: "任务", goal: "目标", agent: "智能体", artifact: "作品", circle: "圈子" },
        tagline: "你的 AI 伙伴，一起聊天、一起做事",
        open: "在 Zymi 中打开",
        openOn: { ios: "在 iPhone 或 iPad 上的 Zymi 中打开", macos: "在 Mac 上的 Zymi 中打开" },
        ownerOnly: "只有创建它的账号能打开。",
        signIn: "如果 App 还没登录，登录后会接着打开这个链接（有时间限制）。",
        update: "如果 App 没反应，请更新到最新版本。",
        noApp: "还没有安装 Zymi？装好以后再点一次这个链接。",
        download: { ios: "在 App Store 下载", macos: "在 Mac App Store 下载" },
        noHandoff: "这台设备上还没有 Zymi App，请在 iPhone、iPad 或 Mac 上打开这个链接。",
        invalid: "链接无效",
        unknownKind: "打不开这个链接，可能需要更新 App",
        reserved: "请更新 App",
        invalidHint: "链接可能不完整，请让对方重新分享一次。",
        updateHint: "把 Zymi 更新到最新版本，再打开这个链接试试。",
        language: "English",
    },
    en: {
        title: "Zymi",
        home: "This is where Zymi's share links live. A link someone sends you opens in the Zymi app.",
        intro: type => `This is a Zymi ${type} link`,
        types: { user: "user", room: "chat room", message: "message", task: "task", goal: "goal", agent: "agent", artifact: "artifact", circle: "circle" },
        tagline: "Your AI companion, to chat and get things done",
        open: "Open in Zymi",
        openOn: { ios: "Open in Zymi on iPhone or iPad", macos: "Open in Zymi on Mac" },
        ownerOnly: "Only the account that created it can open it.",
        signIn: "If the app isn't signed in yet, it opens this link after you sign in (for a limited time).",
        update: "If nothing happens, update the app to the latest version.",
        noApp: "Don't have Zymi yet? Install it, then tap this link again.",
        download: { ios: "Download on the App Store", macos: "Download on the Mac App Store" },
        noHandoff: "There's no Zymi app for this device yet. Open this link on an iPhone, iPad or Mac.",
        invalid: "This link isn't valid",
        unknownKind: "This link can't be opened. You may need to update the app.",
        reserved: "Please update the app",
        invalidHint: "The link may be incomplete. Ask whoever shared it to send it again.",
        updateHint: "Update Zymi to the latest version, then open this link again.",
        language: "中文",
    },
};

const ZYMI_KINDS = ["task", "goal", "agent", "artifact", "circle"];

/** Which apps to offer: iPadOS Safari reports itself as a Mac, so a touch Mac gets both (§5.3). */
function platforms() {
    const agent = navigator.userAgent;
    if (/iPhone|iPad|iPod/.test(agent)) return ["ios"];
    if (/Macintosh/.test(agent)) return navigator.maxTouchPoints > 1 ? ["ios", "macos"] : ["macos"];
    if (/Android/.test(agent)) return ["android"];
    if (/Windows/.test(agent)) return ["windows"];
    return ["ios", "macos", "android", "windows"];
}

function pickLanguage() {
    const languages = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || "en"];
    return /^zh\b/i.test(languages[0]) ? "zh" : "en";
}

/** What this address is: `{verdict}` from the parser, or `{redirect}` for a legacy fragment of ours. */
function read() {
    const links = site.links;
    if (location.pathname === "/" && location.hash.startsWith("#/")) {
        const verdict = linkParse(`${links.legacy.fragment_bases[0]}${location.hash}`, links);
        if (verdict.link) {
            const built = linkBuild(verdict.link, links);
            // Only ever an address rebuilt from the parse result (vector lx-protocol-relative), on this origin.
            if (built.url) return { redirect: new URL(built.url).pathname };
        }
        return { verdict };
    }
    return { verdict: linkParse(`https://${links.hosts[0]}${location.pathname}`, links) };
}

function element(tag, attributes = {}, text) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
    if (text !== undefined) node.textContent = text;
    return node;
}

/** Zymi the cloud (index.html's template), once: its face follows body[data-mood] (landing.css). */
function mascot() {
    const hero = element("div", { class: "hero" });
    hero.append(element("div", { class: "halo" }));
    const template = document.getElementById("zymi-mascot");
    if (template) hero.append(template.content.cloneNode(true));
    return hero;
}

/** The face for what the page says: glad for a link, curious at home, surprised when it can't open. */
const MOOD = { home: "neutral", link: "familiar" };

function render(state, language, again = false) {
    const t = TEXT[language];
    document.documentElement.lang = language === "zh" ? "zh-Hans" : "en";
    const main = document.querySelector("main");
    main.replaceChildren();
    // Switching language redraws in place: the entrance plays once, on arrival.
    if (again) document.body.dataset.settled = "";
    const top = element("header", { class: "top" });
    top.append(element("p", { class: "wordmark" }, "zymi"));
    const toggle = element("button", { type: "button", class: "language" }, t.language);
    toggle.addEventListener("click", () => render(state, language === "zh" ? "en" : "zh", true));
    top.append(toggle);
    main.append(top, mascot());
    const { verdict } = state;
    let status = "home";
    if (verdict.link) {
        status = "link";
        const type = linkType(verdict.link);
        main.append(element("h1", {}, t.intro(t.types[type])));
        if (ZYMI_KINDS.includes(verdict.link.kind) && site.owner_only_notice) main.append(element("p", { class: "lead" }, t.ownerOnly));
        const offers = [];
        for (const platform of platforms()) {
            const handoff = linkHandoff(verdict.link, site.links, platform);
            if (handoff.url && !offers.some(o => o.url === handoff.url)) offers.push({ platform, url: handoff.url });
        }
        if (offers.length) {
            const actions = element("div", { class: "actions" });
            for (const offer of offers) {
                const label = offers.length > 1 ? t.openOn[offer.platform] : t.open;
                actions.append(element("a", { class: "button", href: offer.url, "data-platform": offer.platform }, label));
            }
            main.append(actions);
        } else {
            main.append(element("p", { class: "lead" }, t.noHandoff));
        }
        const notes = element("div", { class: "notes" });
        if (offers.length) notes.append(element("p", { class: "note" }, t.signIn), element("p", { class: "note" }, t.update));
        notes.append(element("p", { class: "note" }, t.noApp));
        const stores = Object.entries(site.stores || {}).filter(([platform, url]) => url && platforms().includes(platform));
        for (const [platform, url] of stores) {
            notes.append(element("a", { class: "store", href: url, "data-store": platform }, t.download[platform]));
        }
        main.append(notes);
    } else if (verdict.reject) {
        status = verdict.reject;
        const message = verdict.reject === "unknown_kind" ? t.unknownKind : verdict.reject === "reserved" ? t.reserved : t.invalid;
        main.append(element("h1", {}, message));
        main.append(element("p", { class: "lead" }, message === t.invalid ? t.invalidHint : t.updateHint));
    } else {
        main.append(element("h1", {}, t.home));
        main.append(element("p", { class: "lead" }, t.tagline));
    }
    document.body.dataset.status = status;
    document.body.dataset.mood = MOOD[status] ?? "adventurous";
}

// iOS Safari gives :active (the mascot's squash, the button's press) only to a page that listens for touches.
document.addEventListener("touchstart", () => {}, { passive: true });

const state = read();
if (state.redirect) {
    location.replace(state.redirect);
} else {
    render(state, pickLanguage());
}
