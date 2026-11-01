// lib/basepath.js
// Server-side helpers for deployments under a URL prefix (e.g. /TaoPat).
// Pure and dependency-free (apart from tao-core), so every rule here is
// unit-tested without a running server.
//
// The configured BASE_PATH is authoritative. Forwarding headers are untrusted:
// X-Forwarded-Prefix is only accepted when it normalizes to an explicit
// allowlist entry, never reflected verbatim into generated URLs.
"use strict";

const core = require("../public/js/tao-core.js");

const normalizeBasePath = core.normalizeBasePath;
const withBase = core.withBase;
const stripBase = core.stripBase;

// Returns a validated prefix from X-Forwarded-Prefix, or "".
// Multiple header values are rejected (a proxy that appends cannot be trusted
// to describe a single prefix), and anything outside the allowlist is ignored.
function safeForwardedPrefix(headers, allowlist) {
    if (!headers) return "";

    const raw = headers["x-forwarded-prefix"];
    if (typeof raw !== "string" || raw === "") return "";
    if (raw.indexOf(",") !== -1) return "";
    if (raw.slice(0, 2) === "//") return "";

    const normalized = normalizeBasePath(raw);
    if (!normalized) return "";

    const allowed = (allowlist || []).map(normalizeBasePath).filter(Boolean);
    return allowed.indexOf(normalized) !== -1 ? normalized : "";
}

// The base path a request should generate URLs with. The configured value wins;
// a forwarded prefix is considered only when no base is configured, proxy trust
// is enabled, and the value matches the allowlist.
function requestBasePath(configuredBase, headers, trustMode, allowlist) {
    const configured = normalizeBasePath(configuredBase);
    if (configured) return configured;

    const mode = typeof trustMode === "string" ? trustMode.toLowerCase() : "";
    if (!mode || mode === "off" || mode === "none") return "";

    return safeForwardedPrefix(headers, allowlist);
}

// Injects the deployment prefix into the page: a meta tag for appUrl() and an
// optional <base> tag so document-relative assets work without a trailing slash.
// normalizeBasePath already rejects quotes and angle brackets, so the values are
// safe inside attributes.
function renderIndexHtml(html, basePath) {
    const base = normalizeBasePath(basePath);

    let out = String(html).replace(
        'name="app-base-path" content=""',
        `name="app-base-path" content="${base}"`
    );

    if (base) {
        out = out.replace("<head>", `<head>\n    <base href="${base}/">`);
    }

    return out;
}

module.exports = {
    normalizeBasePath,
    withBase,
    stripBase,
    safeForwardedPrefix,
    requestBasePath,
    renderIndexHtml
};
