"use strict";

const test = require("node:test");
const assert = require("node:assert");
const core = require("../public/js/tao-core.js");

test("resolveAssetUrl leaves scheme and protocol-relative URLs untouched", () => {
    assert.strictEqual(
        core.resolveAssetUrl("https://cdn.example.com/a.png", "http://h/"),
        "https://cdn.example.com/a.png"
    );
    assert.strictEqual(
        core.resolveAssetUrl("data:image/gif;base64,AAAA", "http://h/"),
        "data:image/gif;base64,AAAA"
    );
    assert.strictEqual(
        core.resolveAssetUrl("//cdn.example.com/a.png", "http://h/"),
        "//cdn.example.com/a.png"
    );
});

test("resolveAssetUrl treats a leading slash as an intentional server route", () => {
    assert.strictEqual(
        core.resolveAssetUrl("/socket.io/socket.io.js", "http://h/tao/"),
        "/socket.io/socket.io.js"
    );
    assert.strictEqual(
        core.resolveAssetUrl("/api/status", "http://h/"),
        "/api/status"
    );
});

test("resolveAssetUrl resolves document-relative paths at the site root", () => {
    assert.strictEqual(
        core.resolveAssetUrl("assets/img/tao-base.png", "http://h/"),
        "http://h/assets/img/tao-base.png"
    );
    assert.strictEqual(
        core.resolveAssetUrl("js/app.js", "http://h/"),
        "http://h/js/app.js"
    );
});

test("resolveAssetUrl keeps assets under a subdirectory deployment", () => {
    assert.strictEqual(
        core.resolveAssetUrl("assets/img/tao-base.png", "http://h/tao/"),
        "http://h/tao/assets/img/tao-base.png"
    );
    assert.strictEqual(
        core.resolveAssetUrl("js/app.js", "http://h/tao/game/"),
        "http://h/tao/game/js/app.js"
    );
});

test("stylesheet-relative font URLs resolve next to the CSS file", () => {
    // CSS resolves url() against the stylesheet location; verify the same
    // outcome the browser would produce for css/style.css -> ../assets/...
    assert.strictEqual(
        core.resolveAssetUrl("../assets/fonts/IBMPlexMono-Regular.woff2", "http://h/css/style.css"),
        "http://h/assets/fonts/IBMPlexMono-Regular.woff2"
    );
    assert.strictEqual(
        core.resolveAssetUrl("../assets/fonts/IBMPlexMono-Regular.woff2", "http://h/tao/css/style.css"),
        "http://h/tao/assets/fonts/IBMPlexMono-Regular.woff2"
    );
});

test("setAssetBase overrides the document base and can be cleared", () => {
    core.setAssetBase("http://h/tao/");
    assert.strictEqual(
        core.assetUrl("assets/audio/music-01.mp3"),
        "http://h/tao/assets/audio/music-01.mp3"
    );
    core.setAssetBase(null);
});

test("assetUrl returns the input unchanged when no base is available", () => {
    // In Node there is no document/base; a relative reference must not throw.
    assert.strictEqual(core.assetUrl("assets/img/x.png"), "assets/img/x.png");
});

test("resolveAssetUrl preserves URL encoding for non-ASCII / spaced paths", () => {
    // Already-encoded input is preserved verbatim.
    assert.strictEqual(
        core.resolveAssetUrl("assets/img/ta%20o.png", "http://h/"),
        "http://h/assets/img/ta%20o.png"
    );
    // Raw spaces are percent-encoded by URL, which is correct for browsers.
    assert.strictEqual(
        core.resolveAssetUrl("assets/img/ta o.png", "http://h/"),
        "http://h/assets/img/ta%20o.png"
    );
});
