"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const PUBLIC_DIR = path.join(__dirname, "..", "public");
const INDEX_HTML = path.join(PUBLIC_DIR, "index.html");
const STYLE_CSS = path.join(PUBLIC_DIR, "css", "style.css");

function isLocalRelative(ref) {
    if (!ref) return false;
    if (ref.charAt(0) === "#") return false;              // SVG fragment
    if (ref.charAt(0) === "/") return false;              // root-relative route
    if (ref.slice(0, 2) === "//") return false;           // protocol-relative
    if (/^[a-z][a-z0-9+.-]*:/i.test(ref)) return false;   // scheme (http:, data:, mailto:)
    if (ref.slice(0, 10) === "socket.io/") return false;  // Socket.IO server route
    return true;
}

function clean(ref) {
    return ref.split("?")[0].split("#")[0];
}

test("every document-relative reference in index.html exists", () => {
    const html = fs.readFileSync(INDEX_HTML, "utf8");
    const refs = [...html.matchAll(/(?:src|href)\s*=\s*"([^"]+)"/g)].map((m) => m[1]);
    const local = refs.filter(isLocalRelative);

    assert.ok(local.length > 0, "expected at least one document-relative reference");

    for (const ref of local) {
        const file = path.join(PUBLIC_DIR, clean(ref));
        assert.ok(fs.existsSync(file), `index.html references missing file: ${ref}`);
    }
});

test("index.html loads the Socket.IO client document-relative", () => {
    const html = fs.readFileSync(INDEX_HTML, "utf8");
    assert.match(html, /src="socket\.io\/socket\.io\.js"/);
    assert.doesNotMatch(html, /src="\/socket\.io\/socket\.io\.js"/);
});

test("index.html exposes a server-filled base-path placeholder", () => {
    const html = fs.readFileSync(INDEX_HTML, "utf8");
    assert.match(html, /<meta name="app-base-path" content="">/);
});

test("every relative url() in style.css resolves to a real file", () => {
    // Drop data: URIs first (they can contain nested url(...) fragments).
    const css = fs.readFileSync(STYLE_CSS, "utf8")
        .replace(/url\(\s*"data:[^"]*"\s*\)/g, "")
        .replace(/url\(\s*'data:[^']*'\s*\)/g, "")
        .replace(/url\(\s*data:[^)]*\)/g, "");

    const urls = [
        ...css.matchAll(/url\(\s*"([^"]*)"\s*\)/g),
        ...css.matchAll(/url\(\s*'([^']*)'\s*\)/g),
        ...css.matchAll(/url\(\s*([^"'\s)]+)\s*\)/g)
    ].map((m) => m[1]);
    const local = urls.filter(isLocalRelative);

    assert.ok(local.length > 0, "expected at least one relative url() in the stylesheet");

    const cssDir = path.dirname(STYLE_CSS);
    for (const ref of local) {
        const file = path.join(cssDir, clean(ref));
        assert.ok(fs.existsSync(file), `style.css references missing file: ${ref}`);
    }
});

test("no root-relative asset URLs remain in HTML or CSS", () => {
    const html = fs.readFileSync(INDEX_HTML, "utf8");
    const css = fs.readFileSync(STYLE_CSS, "utf8");

    // /assets, /css, /js are assets and must be document-relative so the app
    // works under a subdirectory. /socket.io is a server route and is allowed.
    assert.doesNotMatch(html, /(?:src|href)\s*=\s*"\/assets\//);
    assert.doesNotMatch(html, /(?:src|href)\s*=\s*"\/css\//);
    assert.doesNotMatch(html, /(?:src|href)\s*=\s*"\/js\//);
    assert.doesNotMatch(css, /url\(\s*["']?\/assets\//);
});

test("the local static assets the app depends on are present", () => {
    const required = [
        "css/style.css",
        "js/tao-core.js",
        "js/fx.js",
        "js/game.js",
        "js/app.js",
        "js/music.js",
        "js/menu.js",
        "assets/img/patpat.png",
        "assets/img/tao-base.png",
        "assets/fonts/ShipporiMinchoB1-ExtraBold.woff2",
        "assets/fonts/IBMPlexMono-Regular.woff2",
        "assets/fonts/IBMPlexMono-SemiBold.woff2"
    ];

    for (const rel of required) {
        assert.ok(
            fs.existsSync(path.join(PUBLIC_DIR, rel)),
            `missing required asset: ${rel}`
        );
    }
});
