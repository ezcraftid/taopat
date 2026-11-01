"use strict";

// ======================================================
// CONFIG: the ONLY file allowed to read process.env.
// Every other file imports values from here.
// Variables are documented in .env.example.
// Real environment variables always win over values in .env.
// ======================================================

const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env"), quiet: true });

const guardLib = require("./lib/guard");

function str(name, fallback) {
    const raw = process.env[name];
    if (raw === undefined || raw.trim() === "") return fallback;
    return raw.trim();
}

function port(name, fallback) {
    const value = Number(str(name, ""));
    return Number.isInteger(value) && value > 0 && value <= 65535 ? value : fallback;
}

function list(name) {
    return str(name, "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
}

// LIMIT_<KEY> overrides one number from LIMITS in lib/guard.js.
// Blank, non-numeric, or <= 0 values are ignored.
function limitOverrides() {
    const overrides = {};
    for (const key of Object.keys(guardLib.LIMITS)) {
        const raw = process.env["LIMIT_" + key];
        const value = Number(raw);
        if (raw !== undefined && Number.isFinite(value) && value > 0) {
            overrides[key] = value;
        }
    }
    return overrides;
}

module.exports = Object.freeze({
    // Port the HTTP/Socket.IO server listens on.
    PORT: port("PORT", 3000),

    // Network interface to bind to. Empty = Node default (all interfaces),
    // which is exactly the old behavior. Use 127.0.0.1 to accept local
    // connections only (e.g. when behind Cloudflare Tunnel / a reverse proxy).
    HOST: str("HOST", ""),

    // How client IPs are resolved: auto | off | on | cloudflare (see lib/guard.js).
    TRUST_PROXY: str("TRUST_PROXY", "auto").toLowerCase(),

    // Allowed browser Origins for sockets. Empty array = allow any origin.
    ALLOWED_ORIGINS: list("ALLOWED_ORIGINS"),

    // Overrides for LIMITS in lib/guard.js, built from LIMIT_<KEY> variables.
    LIMIT_OVERRIDES: limitOverrides()
});
