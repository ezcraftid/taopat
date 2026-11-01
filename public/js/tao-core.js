// public/js/tao-core.js
// Shared, dependency-free helpers used by the browser (TaoCore global) and by
// the Node server (module.exports). Keeping one source of truth avoids the
// client and server disagreeing about client IDs or achievement thresholds.
(function (root) {
    "use strict";

    // ------------------------------------------------------
    // CLIENT ID (pseudonymous browser installation identifier)
    //   - crypto.randomUUID() when available, secure fallback otherwise
    //   - validated server-side; never used as authorization
    // ------------------------------------------------------
    const CLIENT_ID_RE =
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

    function isValidClientId(id) {
        return typeof id === "string" && id.length === 36 && CLIENT_ID_RE.test(id);
    }

    function generateClientId() {
        const c = (typeof crypto !== "undefined" && crypto) || null;

        if (c && typeof c.randomUUID === "function") {
            try { return c.randomUUID(); } catch (_) { /* fall through */ }
        }

        // RFC 4122 v4 from getRandomValues (no Math.random entropy for identity).
        if (c && typeof c.getRandomValues === "function") {
            const bytes = new Uint8Array(16);
            c.getRandomValues(bytes);
            bytes[6] = (bytes[6] & 0x0f) | 0x40;   // version 4
            bytes[8] = (bytes[8] & 0x3f) | 0x80;   // variant 10
            const hex = [];
            for (let i = 0; i < 16; i++) {
                hex.push(bytes[i].toString(16).padStart(2, "0"));
            }
            const h = hex.join("");
            return h.slice(0, 8) + "-" + h.slice(8, 12) + "-" + h.slice(12, 16) +
                "-" + h.slice(16, 20) + "-" + h.slice(20);
        }

        // Last-resort fallback (non-secure contexts). Still opaque and validated
        // by the server, but weaker entropy; flagged in the docs.
        const rnd = () => Math.floor(Math.random() * 16).toString(16);
        let s = "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx";
        return s.replace(/[xy]/g, (ch) => {
            const v = ch === "x" ? parseInt(rnd(), 16) : ((parseInt(rnd(), 16) & 0x3) | 0x8);
            return v.toString(16);
        });
    }

    function sanitizeClientId(raw, generate) {
        if (isValidClientId(raw)) return raw;
        return (generate || generateClientId)();
    }

    function parseSeedTotal(raw, cap) {
        const n = typeof raw === "number" ? raw : parseInt(raw, 10);
        if (!Number.isFinite(n) || n <= 0) return 0;
        return Math.min(Math.floor(n), cap || 1000000);
    }

    // ------------------------------------------------------
    // ASSET URLS (single, portable strategy for the browser)
    //   Static assets are resolved relative to the current document
    //   (document.baseURI), so the app works at the site root or under any
    //   subdirectory without hardcoded leading slashes. Absolute URLs
    //   (http:, https:, data:, //host) and intentional root-relative paths
    //   (e.g. the /socket.io server endpoint) are returned unchanged.
    // ------------------------------------------------------
    let ASSET_BASE = null;

    function setAssetBase(base) {
        // Optional override for exotic deployments; keep it absolute-ish.
        ASSET_BASE = (typeof base === "string" && base) ? base : null;
    }

    function resolveAssetUrl(rel, base) {
        if (typeof rel !== "string" || rel === "") return rel;

        // Scheme URLs (http:, data:, ...) and protocol-relative //host stay as-is.
        if (/^[a-z][a-z0-9+.-]*:/i.test(rel) || rel.slice(0, 2) === "//") return rel;

        // A leading slash relative to the origin is treated as intentional
        // (server route/endpoint); leave it untouched.
        if (rel.charAt(0) === "/") return rel;

        const b = base || ASSET_BASE ||
            (typeof document !== "undefined" && document.baseURI) || null;

        if (!b) return rel;

        try {
            return new URL(rel, b).href;
        } catch (_) {
            return rel;
        }
    }

    function assetUrl(rel) {
        return resolveAssetUrl(rel);
    }

    // ------------------------------------------------------
    // ACHIEVEMENTS (single source of truth for client + server)
    //   category: milestone | combo | speed | session | dedication
    //   exactly one threshold key is set per entry
    // ------------------------------------------------------
    const ACHIEVEMENTS = [
        // Lifetime milestones (server-authoritative total)
        { id: "pats-1",      title: "First Pat",       desc: "Pat once",                     category: "milestone",  total: 1 },
        { id: "pats-100",    title: "100 Pats",        desc: "Reach 100 lifetime pats",      category: "milestone",  total: 100 },
        { id: "pats-500",    title: "500 Pats",        desc: "Reach 500 lifetime pats",      category: "milestone",  total: 500 },
        { id: "pats-1000",   title: "1,000 Pats",      desc: "Reach 1,000 lifetime pats",    category: "milestone",  total: 1000 },
        { id: "pats-2500",   title: "2,500 Pats",      desc: "Reach 2,500 lifetime pats",    category: "milestone",  total: 2500 },
        { id: "pats-5000",   title: "5,000 Pats",      desc: "Reach 5,000 lifetime pats",    category: "milestone",  total: 5000 },
        { id: "pats-10000",  title: "10,000 Pats",     desc: "Reach 10,000 lifetime pats",   category: "milestone",  total: 10000 },
        { id: "pats-25000",  title: "25,000 Pats",     desc: "Reach 25,000 lifetime pats",   category: "milestone",  total: 25000 },
        { id: "pats-50000",  title: "50,000 Pats",     desc: "Reach 50,000 lifetime pats",   category: "milestone",  total: 50000 },
        { id: "pats-100000", title: "100,000 Pats",    desc: "Reach 100,000 lifetime pats",  category: "milestone",  total: 100000 },

        // Combo milestones (consecutive taps within the combo window)
        { id: "combo-10",    title: "Combo \u00d710",  desc: "Reach a \u00d710 combo",       category: "combo",      combo: 10 },
        { id: "combo-25",    title: "Combo \u00d725",  desc: "Reach a \u00d725 combo",       category: "combo",      combo: 25 },
        { id: "combo-50",    title: "Combo \u00d750",  desc: "Reach a \u00d750 combo",       category: "combo",      combo: 50 },
        { id: "combo-100",   title: "Combo \u00d7100", desc: "Reach a \u00d7100 combo",      category: "combo",      combo: 100 },
        { id: "combo-200",   title: "Combo \u00d7200", desc: "Reach a \u00d7200 combo",      category: "combo",      combo: 200 },

        // Sustained speed (taps within a rolling 1s window)
        { id: "rate-8",      title: "8 Pats/s",        desc: "Sustain 8 pats/s",             category: "speed",      rate: 8 },
        { id: "rate-12",     title: "12 Pats/s",       desc: "Sustain 12 pats/s",            category: "speed",      rate: 12 },
        { id: "rate-16",     title: "16 Pats/s",       desc: "Sustain 16 pats/s",            category: "speed",      rate: 16 },
        { id: "rate-20",     title: "20 Pats/s",       desc: "Sustain 20 pats/s",            category: "speed",      rate: 20 },

        // Session goals (pats during a single visit)
        { id: "session-100",  title: "Warming Up",     desc: "Pat 100 times in one visit",   category: "session",    session: 100 },
        { id: "session-500",  title: "Hot Streak",     desc: "Pat 500 times in one visit",   category: "session",    session: 500 },
        { id: "session-1000", title: "Marathon",       desc: "Pat 1,000 times in one visit", category: "session",    session: 1000 },

        // Dedication (return play). Tracked client-side, capped server-side.
        { id: "sessions-5",  title: "Regular",         desc: "Play across 5 visits",         category: "dedication", sessions: 5 },
        { id: "sessions-25", title: "Devoted",         desc: "Play across 25 visits",        category: "dedication", sessions: 25 },
        { id: "days-7",      title: "Week of Patting", desc: "Pat on 7 different days",      category: "dedication", days: 7 },
        { id: "days-30",     title: "Month of Patting",desc: "Pat on 30 different days",     category: "dedication", days: 30 }
    ];

    const THRESHOLD_KEYS = ["total", "combo", "rate", "session", "sessions", "days"];

    function thresholdOf(a) {
        for (const key of THRESHOLD_KEYS) {
            if (a[key] !== undefined) return { key: key, value: a[key] };
        }
        return { key: null, value: Infinity };
    }

    function isUnlocked(a, stats) {
        const t = thresholdOf(a);
        if (!t.key) return false;
        const value = Number(stats && stats[t.key]) || 0;
        return value >= t.value;
    }

    function newlyUnlocked(achievements, unlocked, stats) {
        const out = [];
        for (const a of achievements) {
            if (unlocked && Object.prototype.hasOwnProperty.call(unlocked, a.id)) continue;
            if (isUnlocked(a, stats)) out.push(a);
        }
        return out;
    }

    function progressFor(a, stats) {
        const t = thresholdOf(a);
        if (!t.key) return null;
        const value = Math.min(Number(stats && stats[t.key]) || 0, t.value);
        return { key: t.key, value: value, target: t.value };
    }

    function isKnownAchievement(id) {
        return ACHIEVEMENTS.some((a) => a.id === id);
    }

    // ------------------------------------------------------
    // MUSIC TRACK SELECTION (avoid immediate repeat)
    // ------------------------------------------------------
    function pickIndexAvoidingRepeat(count, lastIndex) {
        if (count <= 0) return -1;
        if (count === 1) return 0;
        let idx = Math.floor(Math.random() * count);
        let guard = 0;
        while (idx === lastIndex && guard++ < 20) {
            idx = Math.floor(Math.random() * count);
        }
        return idx;
    }

    const api = {
        CLIENT_ID_RE,
        isValidClientId,
        generateClientId,
        sanitizeClientId,
        parseSeedTotal,
        setAssetBase,
        resolveAssetUrl,
        assetUrl,
        ACHIEVEMENTS,
        thresholdOf,
        isUnlocked,
        newlyUnlocked,
        progressFor,
        isKnownAchievement,
        pickIndexAvoidingRepeat
    };

    root.TaoCore = api;
    if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
