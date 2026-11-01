// lib/guard.js
// Server-side anti-abuse primitives for TaoPat. Pure and dependency-free (apart
// from tao-core), so every rule here is unit-tested without a running server.
//
// Core principle: the browser is untrusted. Nothing the client reports (taps/s,
// combo, session size, stamps, "best" stats, seed totals) is believed. The server
// only counts taps it grants from a token bucket, and derives every statistic and
// stamp itself from those granted taps.
"use strict";

const net = require("node:net");
const core = require("../public/js/tao-core.js");

// ------------------------------------------------------
// LIMITS (override any key with env LIMIT_<KEY>, see server.js)
// ------------------------------------------------------
const LIMITS = Object.freeze({
    // tapBatch payload: anything above this is malformed, not just "too fast".
    MAX_BATCH: 100,

    // Per-player tap budget, shared by all tabs of one clientId.
    // The honest client sends at most 6 taps per 250 ms (24/s), below USER_TPS.
    USER_BURST: 15,
    USER_TPS: 25,

    // Per-IP tap budget. Many people can share one IP (NAT, campus, cafe), so it
    // is generous; it exists so that N fake clientIds cannot multiply the budget.
    IP_BURST: 80,
    IP_TPS: 150,

    // Incoming socket events per socket (honest client: ~4 events/s).
    EVENT_BURST: 30,
    EVENT_PER_SEC: 15,

    // Connections
    CONNECT_BURST: 10,
    CONNECT_PER_SEC: 1,
    IP_MAX_CONNECTIONS: 20,
    CLIENT_MAX_SOCKETS: 4,

    // Server-side measurement. Taps arrive in ~250 ms batches, so the combo gap is
    // the client's 900 ms plus batching slack.
    COMBO_GAP_MS: 1200,
    RATE_WINDOW_MS: 1000,

    // Violation score: points accumulate, decay over time, and a ban is issued at
    // BAN_SCORE. A ban blocks the clientId from connecting for BAN_MS.
    DROP_POINTS: 0.2,        // per tap dropped by the player's own bucket
    MALFORMED_POINTS: 5,
    UNKNOWN_EVENT_POINTS: 2,
    EVENT_FLOOD_POINTS: 0.5,
    BAN_SCORE: 30,
    SCORE_DECAY_PER_SEC: 0.5,
    BAN_MS: 10 * 60 * 1000,

    MAX_TRACKED_KEYS: 20000
});

function monotonicNow() {
    return Number(process.hrtime.bigint() / 1000000n);
}

// Map keeps insertion order, so the first key is the oldest.
function trimOldest(map, max) {
    while (map.size > max) {
        map.delete(map.keys().next().value);
    }
}

// ------------------------------------------------------
// TOKEN BUCKET
// ------------------------------------------------------
function createBucket(capacity, refillPerSec, now) {
    return { tokens: capacity, capacity, refillPerSec, last: now };
}

// Returns how many of `want` tokens were granted (whole numbers only).
function takeTokens(bucket, want, now) {
    const elapsed = Math.max(0, now - bucket.last);
    bucket.last = now;
    bucket.tokens = Math.min(
        bucket.capacity,
        bucket.tokens + (elapsed * bucket.refillPerSec) / 1000
    );
    const granted = Math.min(want, Math.floor(bucket.tokens));
    bucket.tokens -= granted;
    return granted;
}

function refundTokens(bucket, amount) {
    if (amount > 0) {
        bucket.tokens = Math.min(bucket.capacity, bucket.tokens + amount);
    }
}

function createKeyedBuckets(capacity, refillPerSec, maxKeys) {
    const map = new Map();

    return {
        take(key, want, now) {
            let bucket = map.get(key);
            if (!bucket) {
                bucket = createBucket(capacity, refillPerSec, now);
                map.set(key, bucket);
                trimOldest(map, maxKeys);
            }
            return takeTokens(bucket, want, now);
        },
        // An idle bucket has long since refilled, so dropping it loses nothing.
        sweep(now, idleMs) {
            for (const [key, bucket] of map) {
                if (now - bucket.last > idleMs) map.delete(key);
            }
        },
        get size() { return map.size; }
    };
}

// ------------------------------------------------------
// VIOLATION SCORE / TEMPORARY BAN
// ------------------------------------------------------
function createViolationTracker(limits) {
    const map = new Map();

    function currentScore(entry, now) {
        const seconds = Math.max(0, now - entry.last) / 1000;
        return Math.max(0, entry.score - seconds * limits.SCORE_DECAY_PER_SEC);
    }

    return {
        // Returns true when this call turned the key into a banned one.
        add(key, points, now) {
            let entry = map.get(key);
            if (!entry) {
                entry = { score: 0, last: now, bannedUntil: 0 };
                map.set(key, entry);
                trimOldest(map, limits.MAX_TRACKED_KEYS);
            }

            entry.score = currentScore(entry, now) + points;
            entry.last = now;

            if (entry.score >= limits.BAN_SCORE && entry.bannedUntil <= now) {
                entry.bannedUntil = now + limits.BAN_MS;
                entry.score = 0;
                return true;
            }
            return false;
        },
        isBanned(key, now) {
            const entry = map.get(key);
            return !!entry && entry.bannedUntil > now;
        },
        sweep(now) {
            for (const [key, entry] of map) {
                if (entry.bannedUntil <= now && currentScore(entry, now) <= 0) {
                    map.delete(key);
                }
            }
        },
        get size() { return map.size; }
    };
}

// ------------------------------------------------------
// SERVER-SIDE METER: combo + rolling taps/s from GRANTED taps only
// ------------------------------------------------------
function createMeter(limits) {
    const window = [];     // [time, count] pairs inside RATE_WINDOW_MS
    let windowSum = 0;
    let combo = 0;
    let lastAt = -Infinity;

    return {
        record(count, now) {
            combo = (now - lastAt <= limits.COMBO_GAP_MS) ? combo + count : count;
            lastAt = now;

            window.push([now, count]);
            windowSum += count;
            while (window.length && window[0][0] <= now - limits.RATE_WINDOW_MS) {
                windowSum -= window.shift()[1];
            }

            return { combo, rate: windowSum };
        }
    };
}

// ------------------------------------------------------
// STAMPS: awarded only from server-held numbers, never from client claims
// ------------------------------------------------------
function evaluateStamps(profile, measure, nowWall) {
    const stats = {
        total: profile.taps,
        combo: measure.combo,
        rate: measure.rate,
        session: profile.visitTaps,
        sessions: profile.sessions,
        days: profile.activeDays
    };

    const fresh = core.newlyUnlocked(core.ACHIEVEMENTS, profile.stamps, stats);

    for (const achievement of fresh) {
        profile.stamps[achievement.id] = nowWall;
    }

    return fresh.map((achievement) => achievement.id);
}

// ------------------------------------------------------
// CLIENT IP
//   Forwarding headers are client-controlled unless a proxy you run sets them,
//   so they are honoured only according to TRUST_PROXY:
//     auto       (default) only when the direct peer is loopback/private,
//                i.e. a reverse proxy on this host or LAN. Uses the RIGHTMOST
//                X-Forwarded-For entry (the one your proxy appended).
//     off        never; always the socket address
//     on         always rightmost X-Forwarded-For
//     cloudflare always CF-Connecting-IP (only if the origin is reachable
//                exclusively through Cloudflare)
// ------------------------------------------------------
function normalizeIP(raw) {
    if (typeof raw !== "string") return null;
    let ip = raw.trim();
    if (ip.startsWith("::ffff:")) ip = ip.slice(7);
    return net.isIP(ip) ? ip : null;
}

function isPrivateIP(ip) {
    const family = net.isIP(ip);

    if (family === 4) {
        const [a, b] = ip.split(".").map(Number);
        return a === 0 || a === 10 || a === 127 ||
            (a === 100 && b >= 64 && b <= 127) ||     // CGNAT / Tailscale
            (a === 169 && b === 254) ||
            (a === 172 && b >= 16 && b <= 31) ||
            (a === 192 && b === 168);
    }

    if (family === 6) {
        const lower = ip.toLowerCase();
        return lower === "::1" || lower === "::" ||
            lower.startsWith("fc") || lower.startsWith("fd") ||
            /^fe[89ab]/.test(lower);
    }

    return false;
}

function headerValue(value) {
    return Array.isArray(value) ? value[value.length - 1] : value;
}

function rightmostForwarded(headers) {
    const raw = headerValue(headers["x-forwarded-for"]);
    if (typeof raw !== "string") return null;
    const parts = raw.split(",").map((part) => part.trim()).filter(Boolean);
    return normalizeIP(parts[parts.length - 1]);
}

function resolveClientIP(handshake, trustMode) {
    const headers = (handshake && handshake.headers) || {};
    const peer = normalizeIP(handshake && handshake.address);
    const mode = trustMode || "auto";

    let forwarded = null;

    if (mode === "cloudflare") {
        forwarded = normalizeIP(headerValue(headers["cf-connecting-ip"]));
    } else if (mode === "on" || (mode === "auto" && peer && isPrivateIP(peer))) {
        forwarded = rightmostForwarded(headers);
    }

    return forwarded || peer;
}

// ------------------------------------------------------
// GUARD FACTORY (holds the shared, per-process limiter state)
// ------------------------------------------------------
function createGuard(options = {}) {
    const limits = Object.freeze(Object.assign({}, LIMITS, options.limits || {}));
    const clock = options.now || monotonicNow;

    const connectBuckets = createKeyedBuckets(
        limits.CONNECT_BURST, limits.CONNECT_PER_SEC, limits.MAX_TRACKED_KEYS
    );
    const ipTapBuckets = createKeyedBuckets(
        limits.IP_BURST, limits.IP_TPS, limits.MAX_TRACKED_KEYS
    );
    const violations = createViolationTracker(limits);

    return {
        limits,
        now: clock,

        // Returns null when the connection may proceed, else a short reason.
        admit({ ip, clientId, ipConnections, clientSockets }) {
            const now = clock();
            const key = ip || "unknown";

            if (connectBuckets.take(key, 1, now) < 1) return "rate_limited";
            if (violations.isBanned(clientId, now)) return "banned";
            if (ipConnections >= limits.IP_MAX_CONNECTIONS) return "too_many_connections";
            if (clientSockets >= limits.CLIENT_MAX_SOCKETS) return "too_many_connections";
            return null;
        },

        newPlayerState() {
            return {
                bucket: createBucket(limits.USER_BURST, limits.USER_TPS, clock()),
                meter: createMeter(limits)
            };
        },

        newSocketState() {
            return {
                events: createBucket(limits.EVENT_BURST, limits.EVENT_PER_SEC, clock())
            };
        },

        eventAllowed(socketState) {
            return takeTokens(socketState.events, 1, clock()) >= 1;
        },

        isValidBatch(amount) {
            return Number.isSafeInteger(amount) && amount > 0 && amount <= limits.MAX_BATCH;
        },

        // Player bucket first, then the shared IP bucket (unused player tokens are
        // refunded, so IP saturation by others never costs this player).
        takeTaps(player, ip, amount) {
            const now = clock();
            const byPlayer = takeTokens(player.bucket, amount, now);
            let granted = byPlayer;

            if (byPlayer > 0) {
                granted = ipTapBuckets.take(ip || "unknown", byPlayer, now);
                refundTokens(player.bucket, byPlayer - granted);
            }

            return {
                granted,
                droppedByPlayer: amount - byPlayer,
                droppedByIp: byPlayer - granted,
                now
            };
        },

        // Returns true when this call just banned the clientId.
        penalize(clientId, points) {
            return violations.add(clientId, points, clock());
        },

        sweep() {
            const now = clock();
            connectBuckets.sweep(now, 120000);
            ipTapBuckets.sweep(now, 120000);
            violations.sweep(now);
        },

        stats() {
            return {
                connectBuckets: connectBuckets.size,
                ipTapBuckets: ipTapBuckets.size,
                violations: violations.size
            };
        }
    };
}

module.exports = {
    LIMITS,
    monotonicNow,
    createBucket,
    takeTokens,
    createMeter,
    createViolationTracker,
    createKeyedBuckets,
    evaluateStamps,
    normalizeIP,
    isPrivateIP,
    resolveClientIP,
    createGuard
};
