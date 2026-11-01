// ======================================================
// TAOPAT SERVER
//
// Threat model: the browser is untrusted. Anyone can open DevTools, write a Node
// script with socket.io-client, or forge any payload. So the server never accepts
// a client-reported number as truth. It grants taps from rate-limited buckets
// and derives combo, speed, session, record stats and stamps by itself.
//
// Environment: all variables are read in config.js and documented in
// .env.example. Copy .env.example to .env to configure the server.
// ======================================================
"use strict";

const express = require("express");
const http = require("http");
const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");
const { Server } = require("socket.io");
const { createShutdownController } = require("./lib/shutdown");
const guardLib = require("./lib/guard");
const config = require("./config");
const core = require("./public/js/tao-core.js");


// ======================================================
// CONFIG
// ======================================================

const PORT = config.PORT;
const HOST = config.HOST;
const TRUST_PROXY = config.TRUST_PROXY;
const ALLOWED_ORIGINS = config.ALLOWED_ORIGINS;

const guard = guardLib.createGuard({ limits: config.LIMIT_OVERRIDES });
const LIMITS = guard.limits;

// A profile that never tapped is not persisted, so it is dropped quickly.
// Players who tapped stay cached longer, which also means "sessions" only grows
// for visits separated by this much idle time (reload-spam cannot farm it).
const PROFILE_IDLE_EMPTY_MS = 30 * 1000;
const PROFILE_IDLE_ACTIVE_MS = 10 * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;


// ======================================================
// APP
// ======================================================

const app = express();
const server = http.createServer(app);

const io = new Server(server, {

    // Real payloads are a few bytes. The default (1 MB) invites memory abuse.
    maxHttpBufferSize: 4 * 1024,

    connectTimeout: 10000,

    // Optional: lock browser sockets to your own site. Non-browser clients can
    // omit Origin entirely, so this is NOT a cheat defense; the buckets are.
    allowRequest: (req, callback) => {

        if (!ALLOWED_ORIGINS.length) {
            return callback(null, true);
        }

        const origin = req.headers.origin;

        callback(null, !origin || ALLOWED_ORIGINS.includes(origin));
    }
});

// CommonJS module directory. All filesystem paths below are resolved from here
// (never from process.cwd()), so the server can be launched from any working
// directory and still find its database, backups and static assets.
const PROJECT_ROOT = __dirname;
const PUBLIC_DIR = path.join(PROJECT_ROOT, "public");


// ======================================================
// DATABASE
// ======================================================

const DATA_DIR = path.join(PROJECT_ROOT, "data");
const DB_PATH = path.join(DATA_DIR, "tapgame.db");

if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, {
        recursive: true
    });
}

const db = new Database(DB_PATH);

// SQLite optimization
db.pragma("journal_mode = WAL");
db.pragma("synchronous = NORMAL");
db.pragma("busy_timeout = 5000");

// Guards used by saveDatabase()/timers so nothing runs after close.
let dbClosed = false;
let shuttingDown = false;


// ======================================================
// DATABASE TABLES
// ======================================================

db.exec(`
    CREATE TABLE IF NOT EXISTS global_stats (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        total_taps INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS regions (
        country_code TEXT PRIMARY KEY,
        country_name TEXT NOT NULL,
        flag TEXT NOT NULL,
        total_taps INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
        user_id TEXT PRIMARY KEY,
        region_code TEXT NOT NULL,
        total_taps INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
    );
`);


// ======================================================
// ADDITIVE MIGRATION
// Adds per-user stats columns without touching existing rows.
//   v2: best_combo, best_rate, sessions, stamps
//   v3: active_days, last_active_day (server-tracked "days played")
// ======================================================

const DB_SCHEMA_VERSION = 3;

function tableHasColumn(table, column) {
    return db
        .prepare(`PRAGMA table_info(${table})`)
        .all()
        .some((c) => c.name === column);
}

function migrateDatabase() {

    const wanted = [
        ["best_combo", "INTEGER NOT NULL DEFAULT 0"],
        ["best_rate", "INTEGER NOT NULL DEFAULT 0"],
        ["sessions", "INTEGER NOT NULL DEFAULT 0"],
        ["stamps", "TEXT NOT NULL DEFAULT '{}'"],
        ["active_days", "INTEGER NOT NULL DEFAULT 0"],
        ["last_active_day", "INTEGER NOT NULL DEFAULT 0"]
    ];

    const columns = wanted
        .filter(([name]) => !tableHasColumn("users", name))
        .map(([name, definition]) => `${name} ${definition}`);

    if (columns.length) {

        // Best-effort backup before altering. Never block startup on it.
        try {
            const backupDir = path.join(DATA_DIR, "backups");
            if (!fs.existsSync(backupDir)) {
                fs.mkdirSync(backupDir, { recursive: true });
            }
            db.pragma("wal_checkpoint(TRUNCATE)");
            fs.copyFileSync(
                DB_PATH,
                path.join(backupDir, `tapgame-${Date.now()}.db`)
            );
            console.log("Database backup written before migration");
        } catch (error) {
            console.warn("Database backup skipped:", error.message);
        }

        const migrate = db.transaction(() => {
            for (const column of columns) {
                db.exec(`ALTER TABLE users ADD COLUMN ${column}`);
            }
        });

        migrate();

        console.log(
            `Database migrated: added ${columns.length} user column(s)`
        );
    }

    db.pragma(`user_version = ${DB_SCHEMA_VERSION}`);
}

migrateDatabase();


// ======================================================
// INITIAL GLOBAL ROW
// ======================================================

const existingGlobal = db
    .prepare(`SELECT id FROM global_stats WHERE id = 1`)
    .get();

if (!existingGlobal) {

    db.prepare(`
        INSERT INTO global_stats (id, total_taps, updated_at)
        VALUES (1, 0, ?)
    `).run(Date.now());
}


// ======================================================
// LOAD GLOBAL STATE
// ======================================================

let globalTaps =
    db
        .prepare(`SELECT total_taps FROM global_stats WHERE id = 1`)
        .get()
        ?.total_taps || 0;

let globalDirty = false;


// ======================================================
// MEMORY STATE
// ======================================================

// clientId -> durable profile (survives reconnect, saved to SQLite).
// A profile owns the set of socket ids currently open for it.
const profiles = new Map();

const regions = new Map();

// ip -> number of open sockets (cap enforced in the connection middleware)
const ipConnections = new Map();


// ======================================================
// LOAD REGIONS FROM DATABASE
// ======================================================

const savedRegions = db
    .prepare(`
        SELECT country_code, country_name, flag, total_taps
        FROM regions
    `)
    .all();

for (const region of savedRegions) {

    regions.set(
        region.country_code,
        {
            code: region.country_code,
            name: region.country_name,
            flag: region.flag,

            taps: region.total_taps,

            currentWindowTaps: 0,
            tapsPerSecond: 0,
            dirty: false
        }
    );
}

console.log(`Loaded ${regions.size} regions`);
console.log(`Global taps: ${globalTaps.toLocaleString()}`);


// ======================================================
// STATIC FILES + RESPONSE HEADERS
// ======================================================

app.disable("x-powered-by");

// Cheap, non-breaking hardening. (A strict script-src CSP is deliberately not
// forced here: it cannot stop DevTools, only XSS, and it needs browser testing.)
app.use((req, res, next) => {

    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("Content-Security-Policy", "object-src 'none'; base-uri 'self'");

    next();
});

// Health check for the tunnel / monitoring. 503 while shutting down.
app.get("/healthz", (req, res) => {

    res.set("Cache-Control", "no-store");

    if (shuttingDown || dbClosed) {
        return res.status(503).type("text/plain").send("stopping");
    }

    res.type("text/plain").send("ok");
});

// Only public/ is exposed. The SQLite database lives in ../data, outside this
// directory, so it can never be served as a static file.
// Code (html/js/css) must revalidate so a deploy is visible immediately;
// heavy media is cached for a week (rename a file to bust its cache).
app.use(
    express.static(PUBLIC_DIR, {
        etag: true,
        setHeaders(res, filePath) {

            if (/\.(png|jpe?g|gif|webp|mp3|ogg|woff2)$/i.test(filePath)) {
                res.setHeader("Cache-Control", "public, max-age=604800");
            } else {
                res.setHeader("Cache-Control", "no-cache");
            }
        }
    })
);


// ======================================================
// STATUS API
// ======================================================

app.get("/api/status", (req, res) => {

    res.set("Cache-Control", "no-store");

    res.json({
        users: [...profiles.values()]
            .filter((profile) => profile.sockets.size > 0)
            .length,

        profiles: profiles.size,

        regions: regions.size,

        globalTaps,

        database: "SQLite"
    });

});


// ======================================================
// FLAG
// ======================================================

function getFlagEmoji(countryCode) {

    if (
        !countryCode ||
        countryCode.length !== 2
    ) {
        return "🌐";
    }

    return countryCode
        .toUpperCase()
        .split("")
        .map(
            char =>
                String.fromCodePoint(
                    127397 +
                    char.charCodeAt(0)
                )
        )
        .join("");
}


// ======================================================
// REGION FROM IP
//   - cached per IP (a country rarely changes; spares the free API quota)
//   - concurrent lookups for one IP share a single request
//   - hard timeout and a global lookup budget, so a slow or rate-limited API
//     can never stall connections or be driven by a flood of fake IPs
// ======================================================

const REGION_LOCAL = Object.freeze({ code: "LOCAL", name: "Local Network", flag: "🌐" });
const REGION_UNKNOWN = Object.freeze({ code: "UNKNOWN", name: "Unknown", flag: "🌐" });

const REGION_TTL_MS = 6 * 60 * 60 * 1000;
const REGION_FAIL_TTL_MS = 60 * 1000;
const REGION_TIMEOUT_MS = 2500;

const regionCache = new Map();      // ip -> { region, expires }
const regionInflight = new Map();   // ip -> Promise<region>

// ~40 lookups/minute sustained (ip-api's free tier allows 45).
const lookupBudget = guardLib.createBucket(20, 40 / 60, guard.now());

async function lookupRegion(ip) {

    if (guardLib.takeTokens(lookupBudget, 1, guard.now()) < 1) {
        return { region: REGION_UNKNOWN, ttl: REGION_FAIL_TTL_MS };
    }

    try {

        const response =
            await fetch(
                `http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,country,countryCode`,
                { signal: AbortSignal.timeout(REGION_TIMEOUT_MS) }
            );

        const data =
            await response.json();

        if (
            data &&
            data.status === "success" &&
            typeof data.countryCode === "string" &&
            /^[A-Z]{2}$/.test(data.countryCode)
        ) {

            return {
                region: {
                    code: data.countryCode,
                    name: String(data.country || data.countryCode).slice(0, 64),
                    flag: getFlagEmoji(data.countryCode)
                },
                ttl: REGION_TTL_MS
            };
        }

    } catch (error) {

        console.error("IP lookup error:", error.message);
    }

    return { region: REGION_UNKNOWN, ttl: REGION_FAIL_TTL_MS };
}

function resolveRegion(ip) {

    if (!ip) {
        return Promise.resolve(REGION_UNKNOWN);
    }

    if (guardLib.isPrivateIP(ip)) {
        return Promise.resolve(REGION_LOCAL);
    }

    const cached = regionCache.get(ip);

    if (cached && cached.expires > Date.now()) {
        return Promise.resolve(cached.region);
    }

    if (regionInflight.has(ip)) {
        return regionInflight.get(ip);
    }

    const task = lookupRegion(ip)
        .then(({ region, ttl }) => {

            regionCache.set(ip, { region, expires: Date.now() + ttl });

            while (regionCache.size > 5000) {
                regionCache.delete(regionCache.keys().next().value);
            }

            return region;
        })
        .finally(() => regionInflight.delete(ip));

    regionInflight.set(ip, task);

    return task;
}

const regionNames = new Intl.DisplayNames(["en"], { type: "region" });

// Cloudflare adds CF-IPCountry. Trusted ONLY in cloudflare mode (origin reachable only via the tunnel).
function regionFromCloudflare(headers) {

    if (TRUST_PROXY !== "cloudflare") {
        return null;
    }

    const raw = headers["cf-ipcountry"];
    const value = Array.isArray(raw) ? raw[raw.length - 1] : raw;

    if (typeof value !== "string" || !/^[A-Za-z]{2}$/.test(value)) {
        return null;
    }

    const code = value.toUpperCase();

    if (code === "XX" || code === "T1") {      // unknown / Tor
        return null;
    }

    let name = code;
    try { name = regionNames.of(code) || code; } catch (_) { /* keep code */ }

    return { code, name, flag: getFlagEmoji(code) };
}


// ======================================================
// GET / CREATE REGION
// ======================================================

function getOrCreateRegion(region) {

    if (!regions.has(region.code)) {

        regions.set(
            region.code,
            {
                code: region.code,
                name: region.name,
                flag: region.flag,

                taps: 0,

                currentWindowTaps: 0,
                tapsPerSecond: 0,
                dirty: true
            }
        );
    }

    return regions.get(
        region.code
    );
}


// ======================================================
// HELPERS
// ======================================================

function safeParseStamps(raw) {

    if (!raw) {
        return {};
    }

    try {

        const parsed =
            JSON.parse(raw);

        if (
            parsed &&
            typeof parsed === "object" &&
            !Array.isArray(parsed)
        ) {
            return parsed;
        }

    } catch (_) {
        /* ignore corrupt value */
    }

    return {};
}

// A profile is only written once it has something worth keeping, so connecting
// with endless fresh IDs cannot bloat the database.
function isPersistable(profile) {
    return profile.taps > 0 || Object.keys(profile.stamps).length > 0;
}

function emitToProfile(profile, event, payload) {

    for (const socketId of profile.sockets) {

        const socket = io.sockets.sockets.get(socketId);

        if (socket) {
            socket.emit(event, payload);
        }
    }
}

function kickProfile(profile) {

    for (const socketId of [...profile.sockets]) {

        const socket = io.sockets.sockets.get(socketId);

        if (socket) {
            socket.disconnect(true);
        }
    }
}

// Applies a penalty and disconnects the player if it crossed the ban threshold.
function penalize(profile, points) {

    if (guard.penalize(profile.id, points)) {

        console.warn(
            `Temporarily blocked client ${profile.id.slice(0, 8)} (abuse score)`
        );

        kickProfile(profile);
    }
}


// ======================================================
// PREPARED STATEMENTS
// ======================================================

const updateGlobal =
    db.prepare(`
        UPDATE global_stats
        SET total_taps = ?, updated_at = ?
        WHERE id = 1
    `);


const updateRegion =
    db.prepare(`
        INSERT INTO regions (
            country_code, country_name, flag, total_taps, updated_at
        )
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(country_code)
        DO UPDATE SET
            country_name = excluded.country_name,
            flag = excluded.flag,
            total_taps = excluded.total_taps,
            updated_at = excluded.updated_at
    `);


const selectUser =
    db.prepare(`
        SELECT
            user_id,
            region_code,
            total_taps,
            created_at,
            best_combo,
            best_rate,
            sessions,
            stamps,
            active_days,
            last_active_day
        FROM users
        WHERE user_id = ?
    `);


const upsertUser =
    db.prepare(`
        INSERT INTO users (
            user_id,
            region_code,
            total_taps,
            created_at,
            updated_at,
            best_combo,
            best_rate,
            sessions,
            stamps,
            active_days,
            last_active_day
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id)
        DO UPDATE SET
            region_code = excluded.region_code,
            total_taps = excluded.total_taps,
            updated_at = excluded.updated_at,
            best_combo = excluded.best_combo,
            best_rate = excluded.best_rate,
            sessions = excluded.sessions,
            stamps = excluded.stamps,
            active_days = excluded.active_days,
            last_active_day = excluded.last_active_day
    `);


// ======================================================
// PROFILE LOAD / CREATE
// Every number here is server-owned. The client cannot seed or overwrite any
// of it (the old "seedTotal" handshake field is ignored: it let anyone mint a
// fresh clientId with up to 1,000,000 pats and every lifetime stamp).
// ======================================================

function loadOrCreateProfile(clientId) {

    const row =
        selectUser.get(clientId);

    const base = {

        id: clientId,

        // Per-visit and transient, never persisted
        visitTaps: 0,
        currentWindowTaps: 0,
        tapsPerSecond: 0,
        sockets: new Set(),
        guard: guard.newPlayerState(),
        dirty: false,
        lastSeen: Date.now()
    };

    if (row) {

        return Object.assign(base, {

            region: row.region_code,

            taps: row.total_taps,

            bestCombo: row.best_combo || 0,

            bestRate: row.best_rate || 0,

            sessions: row.sessions || 0,

            firstSeen: row.created_at,

            stamps: safeParseStamps(row.stamps),

            activeDays: row.active_days || 0,

            lastActiveDay: row.last_active_day || 0
        });
    }

    return Object.assign(base, {

        region: "UNKNOWN",

        taps: 0,

        bestCombo: 0,

        bestRate: 0,

        sessions: 0,

        firstSeen: Date.now(),

        stamps: {},

        activeDays: 0,

        lastActiveDay: 0
    });
}

function acquireProfile(clientId) {

    let profile = profiles.get(clientId);

    if (!profile) {

        profile = loadOrCreateProfile(clientId);

        // One new "session" each time a profile is (re)loaded into memory.
        profile.sessions += 1;
        profile.dirty = true;

        profiles.set(clientId, profile);
    }

    return profile;
}


// ======================================================
// SOCKET IDENTITY + ADMISSION MIDDLEWARE
// Runs before "connection": rejects floods, banned IDs and connection hoarding.
// ======================================================

io.use((socket, next) => {

    const auth =
        socket.handshake.auth || {};

    const rawId =
        auth.clientId;

    const clientId =
        core.sanitizeClientId(rawId);

    const ip =
        guardLib.resolveClientIP(socket.handshake, TRUST_PROXY);

    const existing =
        profiles.get(clientId);

    const reason =
        guard.admit({
            ip,
            clientId,
            ipConnections: ipConnections.get(ip) || 0,
            clientSockets: existing ? existing.sockets.size : 0
        });

    if (reason) {
        return next(new Error(reason));
    }

    socket.data.clientId =
        clientId;

    socket.data.clientWasValid =
        core.isValidClientId(rawId);

    socket.data.ip =
        ip;

    next();
});


// ======================================================
// SOCKET CONNECTION
// All listeners are registered synchronously, so no event can slip through
// while the region lookup is pending.
// ======================================================

// Legacy client->server events. They are accepted on the wire and ignored:
// the server awards stamps and records best combo/rate/sessions itself.
const IGNORED_LEGACY_EVENTS = new Set(["stamps", "stats"]);

io.on(
    "connection",
    (socket) => {

        const clientId =
            socket.data.clientId;

        const ip =
            socket.data.ip;

        const profile =
            acquireProfile(clientId);

        profile.sockets.add(socket.id);
        profile.lastSeen = Date.now();

        ipConnections.set(
            ip,
            (ipConnections.get(ip) || 0) + 1
        );

        socket.data.regionCode = null;
        socket.data.pendingRegionTaps = 0;

        const socketGuard =
            guard.newSocketState();

        console.log(
            `Connected: ${socket.id} | ${ip} | client ${clientId.slice(0, 8)}`
        );

        // Lifetime / dedication stamps already implied by the stored numbers.
        // (Best values were measured by the server, so they are trustworthy.)
        if (guardLib.evaluateStamps(
            profile,
            { combo: profile.bestCombo, rate: profile.bestRate },
            Date.now()
        ).length) {
            profile.dirty = true;
        }


        // ==========================================
        // EVENT GUARD (allowlist + per-socket event rate)
        // ==========================================

        socket.use(
            (packet, next) => {

                const event =
                    packet[0];

                if (event === "tapBatch") {

                    if (!guard.eventAllowed(socketGuard)) {
                        penalize(profile, LIMITS.EVENT_FLOOD_POINTS);
                        return;
                    }

                    return next();
                }

                if (!IGNORED_LEGACY_EVENTS.has(event)) {
                    penalize(profile, LIMITS.UNKNOWN_EVENT_POINTS);
                }

                // Dropped: never reaches a handler.
            }
        );


        // ==========================================
        // TAP BATCH
        // ==========================================

        socket.on(
            "tapBatch",
            amount => {

                if (!guard.isValidBatch(amount)) {
                    penalize(profile, LIMITS.MALFORMED_POINTS);
                    return;
                }

                const result =
                    guard.takeTaps(profile.guard, ip, amount);

                // Only taps the player's OWN bucket refused count against them.
                // IP-level drops (many people behind one IP) are never punished.
                if (result.droppedByPlayer > 0) {
                    penalize(
                        profile,
                        result.droppedByPlayer * LIMITS.DROP_POINTS
                    );
                }

                const granted =
                    result.granted;

                if (granted <= 0) {
                    return;
                }

                const wallNow =
                    Date.now();


                // ==================================
                // USER
                // ==================================

                profile.taps += granted;
                profile.visitTaps += granted;
                profile.currentWindowTaps += granted;
                profile.dirty = true;

                const today =
                    Math.floor(wallNow / DAY_MS);

                if (profile.lastActiveDay !== today) {
                    profile.lastActiveDay = today;
                    profile.activeDays += 1;
                }

                // Combo and speed are measured here, from granted taps only.
                const measure =
                    profile.guard.meter.record(granted, result.now);

                if (measure.combo > profile.bestCombo) {
                    profile.bestCombo = measure.combo;
                }

                if (measure.rate > profile.bestRate) {
                    profile.bestRate = measure.rate;
                }

                const fresh =
                    guardLib.evaluateStamps(profile, measure, wallNow);

                if (fresh.length) {
                    emitToProfile(profile, "stampsAccepted", fresh);
                }


                // ==================================
                // REGION
                // ==================================

                const regionData =
                    socket.data.regionCode
                        ? regions.get(socket.data.regionCode)
                        : null;

                if (regionData) {

                    regionData.taps += granted;
                    regionData.currentWindowTaps += granted;
                    regionData.dirty = true;

                } else {

                    // Region lookup still pending: credited once it resolves.
                    socket.data.pendingRegionTaps += granted;
                }


                // ==================================
                // GLOBAL
                // ==================================

                globalTaps += granted;
                globalDirty = true;
            }
        );


        // ==========================================
        // DISCONNECT
        // ==========================================

        socket.on(
            "disconnect",
            () => {

                console.log(
                    `Disconnected: ${socket.id}`
                );

                profile.sockets.delete(socket.id);
                profile.lastSeen = Date.now();

                // The visit ends when the last tab closes.
                if (!profile.sockets.size) {
                    profile.visitTaps = 0;
                }

                const remaining =
                    (ipConnections.get(ip) || 1) - 1;

                if (remaining > 0) {
                    ipConnections.set(ip, remaining);
                } else {
                    ipConnections.delete(ip);
                }
            }
        );


        // ==========================================
        // REGION (async), then INITIAL STATE
        // ==========================================

        const cfRegion =
            regionFromCloudflare(socket.handshake.headers);

        (cfRegion ? Promise.resolve(cfRegion) : resolveRegion(ip))
            .then(region => {

                const regionData =
                    getOrCreateRegion(region);

                socket.data.regionCode =
                    region.code;

                // Taps that arrived before the lookup finished.
                if (socket.data.pendingRegionTaps > 0) {

                    regionData.taps += socket.data.pendingRegionTaps;
                    regionData.currentWindowTaps += socket.data.pendingRegionTaps;
                    regionData.dirty = true;

                    socket.data.pendingRegionTaps = 0;
                }

                // The IP can change; region follows the current connection.
                if (profile.region !== region.code) {
                    profile.region = region.code;
                    profile.dirty = true;
                }

                if (socket.disconnected) {
                    return;
                }

                socket.emit(
                    "initialState",
                    {

                        user: {

                            clientId:
                                clientId,

                            clientIdValid:
                                socket.data.clientWasValid,

                            taps:
                                profile.taps,

                            tapsPerSecond: 0,

                            bestCombo:
                                profile.bestCombo,

                            bestRate:
                                profile.bestRate,

                            sessions:
                                profile.sessions,

                            activeDays:
                                profile.activeDays,

                            firstSeen:
                                profile.firstSeen,

                            stamps:
                                profile.stamps
                        },

                        region: {

                            code:
                                regionData.code,

                            name:
                                regionData.name,

                            flag:
                                regionData.flag,

                            taps:
                                regionData.taps,

                            tapsPerSecond:
                                0
                        },

                        global: {

                            taps:
                                globalTaps
                        }
                    }
                );
            })
            .catch(error => {

                console.error(
                    "Connection setup error:",
                    error
                );
            });

    }
);


// ======================================================
// SAVE DATABASE
// Writes only what changed (dirty flags), so cost does not grow with the number
// of profiles ever seen.
// ======================================================

function saveDatabase() {

    // Never touch the database after it has been closed.
    if (dbClosed || !db.open) {
        return false;
    }

    const now =
        Date.now();

    const savedRegions = [];
    const savedProfiles = [];

    try {

        const transaction =
            db.transaction(
                () => {

                    // Global
                    if (globalDirty) {
                        updateGlobal.run(
                            globalTaps,
                            now
                        );
                    }


                    // Regions
                    for (
                        const region
                        of regions.values()
                    ) {

                        if (!region.dirty) {
                            continue;
                        }

                        updateRegion.run(
                            region.code,
                            region.name,
                            region.flag,
                            region.taps,
                            now
                        );

                        savedRegions.push(region);
                    }


                    // Profiles
                    for (
                        const profile
                        of profiles.values()
                    ) {

                        if (
                            !profile.dirty ||
                            !isPersistable(profile)
                        ) {
                            continue;
                        }

                        upsertUser.run(
                            profile.id,
                            profile.region,
                            profile.taps,
                            profile.firstSeen,
                            now,
                            profile.bestCombo,
                            profile.bestRate,
                            profile.sessions,
                            JSON.stringify(
                                profile.stamps || {}
                            ),
                            profile.activeDays,
                            profile.lastActiveDay
                        );

                        savedProfiles.push(profile);
                    }
                }
            );


        transaction();

        // Clear flags only after the transaction committed.
        globalDirty = false;

        for (const region of savedRegions) {
            region.dirty = false;
        }

        for (const profile of savedProfiles) {
            profile.dirty = false;
        }

        return true;

    } catch (error) {

        console.error(
            "Database save error:",
            error
        );

        return false;
    }
}

// Drops idle profiles whose data is already safe in SQLite (or never mattered).
function evictIdleProfiles() {

    const now =
        Date.now();

    for (const [clientId, profile] of profiles) {

        if (profile.sockets.size > 0) {
            continue;
        }

        if (profile.dirty && isPersistable(profile)) {
            continue;
        }

        const idleLimit =
            profile.taps > 0
                ? PROFILE_IDLE_ACTIVE_MS
                : PROFILE_IDLE_EMPTY_MS;

        if (now - profile.lastSeen > idleLimit) {
            profiles.delete(clientId);
        }
    }
}


// ======================================================
// PERIODIC JOBS (handles kept so shutdown can clear them)
// ======================================================

function rateTick() {

    if (shuttingDown) {
        return;
    }

    for (const profile of profiles.values()) {

        profile.tapsPerSecond =
            profile.currentWindowTaps;

        profile.currentWindowTaps =
            0;

        if (profile.sockets.size > 0) {

            emitToProfile(
                profile,
                "userStats",
                {

                    taps:
                        profile.taps,

                    tapsPerSecond:
                        profile.tapsPerSecond
                }
            );
        }
    }


    for (
        const region
        of regions.values()
    ) {

        region.tapsPerSecond =
            region.currentWindowTaps;

        region.currentWindowTaps =
            0;
    }
}


function saveTick() {

    if (shuttingDown) {
        return;
    }

    if (saveDatabase()) {
        evictIdleProfiles();
    }
}


function sweepTick() {

    if (shuttingDown) {
        return;
    }

    guard.sweep();
}


function leaderboardTick() {

    if (shuttingDown) {
        return;
    }

    const leaderboard =
        [...regions.values()]
            .sort(
                (a, b) =>
                    b.taps - a.taps
            )
            .slice(0, 20)
            .map(region => ({

                code:
                    region.code,

                name:
                    region.name,

                flag:
                    region.flag,

                taps:
                    region.taps,

                tapsPerSecond:
                    region.tapsPerSecond
            }));


    io.emit(
        "leaderboard",
        {

            global: {

                taps:
                    globalTaps
            },

            regions:
                leaderboard
        }
    );
}


const timers = {

    rate:
        setInterval(rateTick, 1000),

    save:
        setInterval(saveTick, 1000),

    leaderboard:
        setInterval(leaderboardTick, 500),

    sweep:
        setInterval(sweepTick, 60 * 1000)
};


function clearTimers() {

    for (const key of Object.keys(timers)) {

        if (timers[key]) {

            clearInterval(timers[key]);

            timers[key] = null;
        }
    }
}


// ======================================================
// GRACEFUL SHUTDOWN (idempotent)
// ======================================================

const shutdownController =
    createShutdownController({

        save: saveDatabase,

        checkpoint: () =>
            db.pragma("wal_checkpoint(TRUNCATE)"),

        closeDatabase: () => {

            if (dbClosed || !db.open) {
                return;
            }

            db.close();

            dbClosed = true;
        },

        closeServers: (finish) => {

            try {

                io.close(() => {

                    try {

                        server.close(() => finish(0));

                    } catch (_) {

                        finish(0);
                    }
                });

            } catch (_) {

                finish(0);
            }
        },

        closeTimeoutMs: 3000,

        onComplete: (saved) => {

            if (saved) {
                console.log("Database saved.");
            } else {
                console.warn(
                    "Database save did not complete cleanly."
                );
            }
        },

        onError: (error) => {

            console.error(
                "Shutdown error:",
                error
            );
        },

        exit: (code) => process.exit(code)
    });


function shutdown() {

    // A second SIGINT/SIGTERM must not run the close sequence again.
    if (shuttingDown) {
        return;
    }

    shuttingDown = true;

    // Stop every periodic job BEFORE the database is closed so no timer can
    // call saveDatabase() after db.close().
    clearTimers();

    console.log(
        "Saving database..."
    );

    shutdownController.run();
}


process.on(
    "SIGINT",
    shutdown
);

process.on(
    "SIGTERM",
    shutdown
);

// A stray rejected promise must not take the whole game down.
process.on(
    "unhandledRejection",
    (reason) => {

        console.error(
            "Unhandled rejection:",
            reason
        );
    }
);


// ======================================================
// SERVER
// ======================================================

if (TRUST_PROXY === "cloudflare" && HOST !== "127.0.0.1" && HOST !== "::1") {
    console.warn(
        "WARNING: TRUST_PROXY=cloudflare but HOST is not loopback. " +
        "Anyone who can reach this port directly can spoof CF-Connecting-IP. " +
        "Set HOST=127.0.0.1 when using Cloudflare Tunnel."
    );
}

const listenOptions = { port: PORT };
if (HOST) listenOptions.host = HOST;

server.listen(
    listenOptions,
    () => {

        console.log(`
========================================
 TAP CHARACTER SERVER
========================================

Port:
${PORT}

Host:
${HOST || "all interfaces"}

Database:
${DB_PATH}

Schema version:
${DB_SCHEMA_VERSION}

Global taps:
${globalTaps.toLocaleString()}

Loaded regions:
${regions.size}

Proxy trust mode:
${TRUST_PROXY}

========================================
        `);

    }
);