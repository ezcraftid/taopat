"use strict";

const test = require("node:test");
const assert = require("node:assert");
const core = require("../public/js/tao-core.js");
const b = require("../lib/basepath.js");

// ---------- normalizeBasePath ----------

test("normalizeBasePath treats empty and root as no prefix", () => {
    assert.strictEqual(b.normalizeBasePath(""), "");
    assert.strictEqual(b.normalizeBasePath("   "), "");
    assert.strictEqual(b.normalizeBasePath("/"), "");
    assert.strictEqual(b.normalizeBasePath(null), "");
    assert.strictEqual(b.normalizeBasePath(42), "");
});

test("normalizeBasePath produces one leading slash and no trailing slash", () => {
    assert.strictEqual(b.normalizeBasePath("/TaoPat"), "/TaoPat");
    assert.strictEqual(b.normalizeBasePath("/TaoPat/"), "/TaoPat");
    assert.strictEqual(b.normalizeBasePath("TaoPat"), "/TaoPat");
    assert.strictEqual(b.normalizeBasePath("  /TaoPat/  "), "/TaoPat");
    assert.strictEqual(b.normalizeBasePath("//TaoPat//"), "/TaoPat");
    assert.strictEqual(b.normalizeBasePath("/a/b/"), "/a/b");
});

test("normalizeBasePath rejects traversal, query, fragment and control characters", () => {
    assert.strictEqual(b.normalizeBasePath("/.."), "");
    assert.strictEqual(b.normalizeBasePath("/../etc"), "");
    assert.strictEqual(b.normalizeBasePath("/a/../b"), "");
    assert.strictEqual(b.normalizeBasePath("/a/./b"), "");
    assert.strictEqual(b.normalizeBasePath("/a?b"), "");
    assert.strictEqual(b.normalizeBasePath("/a#b"), "");
    assert.strictEqual(b.normalizeBasePath("/a\\b"), "");
    assert.strictEqual(b.normalizeBasePath("/a\u0000b"), "");
    assert.strictEqual(b.normalizeBasePath('/a"b'), "");
    assert.strictEqual(b.normalizeBasePath("/a<b>"), "");
});

test("the client and server share the same normalization rule", () => {
    for (const value of ["", "/", "TaoPat", "/TaoPat/", "/a/b/", "/../x", "/a?b"]) {
        assert.strictEqual(core.normalizeBasePath(value), b.normalizeBasePath(value));
    }
});

// ---------- withBase ----------

test("withBase joins routes under the configured prefix", () => {
    assert.strictEqual(b.withBase("", "/api/status"), "/api/status");
    assert.strictEqual(b.withBase("/TaoPat", "/api/status"), "/TaoPat/api/status");
    assert.strictEqual(b.withBase("/TaoPat/", "api/status"), "/TaoPat/api/status");
    assert.strictEqual(b.withBase("/TaoPat", "/"), "/TaoPat/");
    assert.strictEqual(b.withBase("", "/"), "/");
    assert.strictEqual(b.withBase("/TaoPat", ""), "/TaoPat");
});

test("withBase never prefixes absolute or protocol-relative URLs", () => {
    assert.strictEqual(b.withBase("/TaoPat", "https://cdn.example.com/a.js"), "https://cdn.example.com/a.js");
    assert.strictEqual(b.withBase("/TaoPat", "//cdn.example.com/a.js"), "//cdn.example.com/a.js");
    assert.strictEqual(b.withBase("/TaoPat", "data:text/plain,x"), "data:text/plain,x");
});

// ---------- stripBase ----------

test("stripBase removes only a whole-segment prefix", () => {
    assert.strictEqual(b.stripBase("", "/api/status"), "/api/status");
    assert.strictEqual(b.stripBase("/TaoPat", "/TaoPat/api/status"), "/api/status");
    assert.strictEqual(b.stripBase("/TaoPat", "/TaoPat/"), "/");
    assert.strictEqual(b.stripBase("/TaoPat", "/TaoPat"), "/");
    assert.strictEqual(b.stripBase("/TaoPat", "/TaoPatx"), null);
    assert.strictEqual(b.stripBase("/TaoPat", "/other"), null);
    assert.strictEqual(b.stripBase("/TaoPat", ""), null);
});

test("stripBase preserves the query string", () => {
    assert.strictEqual(b.stripBase("/TaoPat", "/TaoPat?x=1"), "/?x=1");
    assert.strictEqual(b.stripBase("/TaoPat", "/TaoPat/api?x=1&y=2"), "/api?x=1&y=2");
});

// ---------- forwarded prefix safety ----------

test("safeForwardedPrefix accepts only an exact, allowlisted prefix", () => {
    assert.strictEqual(b.safeForwardedPrefix({}, ["/TaoPat"]), "");
    assert.strictEqual(
        b.safeForwardedPrefix({ "x-forwarded-prefix": "/TaoPat" }, ["/TaoPat"]),
        "/TaoPat"
    );
    assert.strictEqual(
        b.safeForwardedPrefix({ "x-forwarded-prefix": "/TaoPat/" }, ["/TaoPat"]),
        "/TaoPat"
    );
    assert.strictEqual(
        b.safeForwardedPrefix({ "x-forwarded-prefix": "/Other" }, ["/TaoPat"]),
        ""
    );
    assert.strictEqual(
        b.safeForwardedPrefix({ "x-forwarded-prefix": "/TaoPat" }, []),
        ""
    );
});

test("safeForwardedPrefix rejects injection and ambiguous values", () => {
    assert.strictEqual(
        b.safeForwardedPrefix({ "x-forwarded-prefix": "//evil.example.com" }, ["/evil.example.com"]),
        ""
    );
    assert.strictEqual(
        b.safeForwardedPrefix({ "x-forwarded-prefix": "/TaoPat, /Other" }, ["/TaoPat"]),
        ""
    );
    assert.strictEqual(
        b.safeForwardedPrefix({ "x-forwarded-prefix": "/../TaoPat" }, ["/TaoPat"]),
        ""
    );
    assert.strictEqual(
        b.safeForwardedPrefix({ "x-forwarded-prefix": ["/TaoPat"] }, ["/TaoPat"]),
        ""
    );
});

test("renderIndexHtml injects the meta tag and a <base> tag only under a prefix", () => {
    const template = '<head>\n<meta name="app-base-path" content="">\n</head>';

    const root = b.renderIndexHtml(template, "");
    assert.match(root, /name="app-base-path" content=""/);
    assert.doesNotMatch(root, /<base href=/);

    const sub = b.renderIndexHtml(template, "/TaoPat");
    assert.match(sub, /name="app-base-path" content="\/TaoPat"/);
    assert.match(sub, /<base href="\/TaoPat\/">/);
});

test("renderIndexHtml never injects an invalid or unsafe base", () => {
    const template = '<head>\n<meta name="app-base-path" content="">\n</head>';

    for (const value of ['/a"b', "/a<b>", "/../x", "/a?b"]) {
        const out = b.renderIndexHtml(template, value);
        assert.match(out, /name="app-base-path" content=""/);
        assert.doesNotMatch(out, /<base href=/);
    }
});

test("requestBasePath prefers the configured base and requires trust for headers", () => {
    assert.strictEqual(b.requestBasePath("/TaoPat", { "x-forwarded-prefix": "/Other" }, "auto", ["/Other"]), "/TaoPat");
    assert.strictEqual(b.requestBasePath("", { "x-forwarded-prefix": "/TaoPat" }, "off", ["/TaoPat"]), "");
    assert.strictEqual(b.requestBasePath("", { "x-forwarded-prefix": "/TaoPat" }, "auto", ["/TaoPat"]), "/TaoPat");
    assert.strictEqual(b.requestBasePath("", { "x-forwarded-prefix": "/TaoPat" }, "auto", []), "");
});
