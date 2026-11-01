"use strict";

const test = require("node:test");
const assert = require("node:assert");
const core = require("../public/js/tao-core.js");
const g = require("../lib/guard.js");

// Deterministic clock so every rate rule is testable without sleeping.
function fakeClock(start = 1000000) {
    let t = start;
    const clock = () => t;
    clock.advance = (ms) => { t += ms; };
    return clock;
}

function freshProfile(overrides = {}) {
    return Object.assign({
        taps: 0, visitTaps: 0, sessions: 1, activeDays: 1, stamps: {}
    }, overrides);
}

// ---------- token bucket ----------

test("bucket grants up to capacity, then only what has refilled", () => {
    const b = g.createBucket(10, 5, 0);
    assert.strictEqual(g.takeTokens(b, 100, 0), 10);
    assert.strictEqual(g.takeTokens(b, 100, 0), 0);
    assert.strictEqual(g.takeTokens(b, 100, 1000), 5);      // 5 tokens/s
    assert.strictEqual(g.takeTokens(b, 100, 1000), 0);
});

test("bucket never exceeds capacity and tolerates a clock that goes backwards", () => {
    const b = g.createBucket(10, 5, 5000);
    assert.strictEqual(g.takeTokens(b, 3, 5000), 3);
    assert.strictEqual(g.takeTokens(b, 100, 999999), 10);
    assert.strictEqual(g.takeTokens(b, 1, 0), 0);            // time went backwards: no free tokens
});

// ---------- batch validation ----------

test("isValidBatch rejects everything except sane positive integers", () => {
    const guard = g.createGuard({ now: fakeClock() });
    for (const bad of [0, -1, 1.5, NaN, Infinity, "5", null, undefined, {}, [], 101, 1e9, 2 ** 53]) {
        assert.strictEqual(guard.isValidBatch(bad), false, String(bad));
    }
    for (const good of [1, 6, 100]) {
        assert.strictEqual(guard.isValidBatch(good), true, String(good));
    }
});

// ---------- flood: the headline exploit ----------

test("flooding tapBatch(100) as fast as possible is capped near the human limit", () => {
    const clock = fakeClock();
    const guard = g.createGuard({ now: clock });
    const player = guard.newPlayerState();

    let total = 0;
    // 10 seconds, 1000 events per second, 100 taps each = 1,000,000 claimed taps/s
    for (let ms = 0; ms < 10000; ms++) {
        clock.advance(1);
        total += guard.takeTaps(player, "1.2.3.4", 100).granted;
    }

    const ceiling = guard.limits.USER_BURST + guard.limits.USER_TPS * 10;
    assert.ok(total <= ceiling, `granted ${total}, ceiling ${ceiling}`);
    assert.ok(total >= guard.limits.USER_TPS * 9, "still serves a full-speed legit rate");
});

test("an honest client (6 taps / 250 ms) is never throttled", () => {
    const clock = fakeClock();
    const guard = g.createGuard({ now: clock });
    const player = guard.newPlayerState();

    for (let i = 0; i < 400; i++) {                 // 100 s of non-stop max-speed tapping
        clock.advance(250);
        const r = guard.takeTaps(player, "1.2.3.4", 6);
        assert.strictEqual(r.granted, 6);
        assert.strictEqual(r.droppedByPlayer, 0);
    }
});

test("many fake clientIds from ONE ip cannot multiply the budget", () => {
    const clock = fakeClock();
    const guard = g.createGuard({ now: clock });
    const players = Array.from({ length: 200 }, () => guard.newPlayerState());

    let total = 0;
    for (let ms = 0; ms < 5000; ms += 10) {
        clock.advance(10);
        for (const p of players) total += guard.takeTaps(p, "9.9.9.9", 100).granted;
    }

    const ceiling = guard.limits.IP_BURST + guard.limits.IP_TPS * 5 + 1;
    assert.ok(total <= ceiling, `granted ${total}, ceiling ${ceiling}`);
});

test("IP-level saturation refunds the player and never counts as the player's fault", () => {
    const clock = fakeClock();
    const guard = g.createGuard({ now: clock, limits: { IP_BURST: 5, IP_TPS: 1 } });
    const a = guard.newPlayerState();
    const b = guard.newPlayerState();

    guard.takeTaps(a, "7.7.7.7", 5);                         // drains the shared IP bucket
    const r = guard.takeTaps(b, "7.7.7.7", 5);
    assert.strictEqual(r.granted, 0);
    assert.strictEqual(r.droppedByPlayer, 0);                // not b's fault
    assert.strictEqual(r.droppedByIp, 5);
});

// ---------- violations / ban ----------

test("a flooding client reaches a ban quickly; a polite one never does", () => {
    const clock = fakeClock();
    const guard = g.createGuard({ now: clock });
    const player = guard.newPlayerState();

    let banned = false;
    for (let i = 0; i < 50 && !banned; i++) {
        clock.advance(10);
        const r = guard.takeTaps(player, "1.1.1.1", 100);
        banned = guard.penalize("flooder", r.droppedByPlayer * guard.limits.DROP_POINTS);
    }
    assert.strictEqual(banned, true);
    assert.strictEqual(
        guard.admit({ ip: "1.1.1.1", clientId: "flooder", ipConnections: 0, clientSockets: 0 }),
        "banned"
    );

    // Polite: one malformed event every 30 s decays away and never bans.
    for (let i = 0; i < 100; i++) {
        clock.advance(30000);
        assert.strictEqual(guard.penalize("polite", guard.limits.MALFORMED_POINTS), false);
    }
});

test("a ban expires", () => {
    const clock = fakeClock();
    const guard = g.createGuard({ now: clock });
    assert.strictEqual(guard.penalize("x", 1000), true);
    const args = { ip: "1.1.1.1", clientId: "x", ipConnections: 0, clientSockets: 0 };
    assert.strictEqual(guard.admit(args), "banned");
    clock.advance(guard.limits.BAN_MS + 1);
    clock.advance(5000);                                     // let the connect bucket refill
    assert.strictEqual(guard.admit(args), null);
});

// ---------- connection admission ----------

test("admit enforces connect rate, per-IP and per-client socket caps", () => {
    const clock = fakeClock();
    const guard = g.createGuard({ now: clock });
    const base = { ip: "5.5.5.5", clientId: "c", ipConnections: 0, clientSockets: 0 };

    assert.strictEqual(guard.admit({ ...base, ipConnections: guard.limits.IP_MAX_CONNECTIONS }), "too_many_connections");
    clock.advance(5000);
    assert.strictEqual(guard.admit({ ...base, clientSockets: guard.limits.CLIENT_MAX_SOCKETS }), "too_many_connections");
    clock.advance(5000);

    // connection-rate flood from one IP with fresh IDs
    let rejected = 0;
    for (let i = 0; i < 100; i++) {
        if (guard.admit({ ...base, clientId: "id" + i }) === "rate_limited") rejected++;
    }
    assert.ok(rejected >= 85, `rejected ${rejected}/100`);
});

test("event bucket throttles a socket that spams events", () => {
    const clock = fakeClock();
    const guard = g.createGuard({ now: clock });
    const sock = guard.newSocketState();
    let allowed = 0;
    for (let i = 0; i < 1000; i++) if (guard.eventAllowed(sock)) allowed++;
    assert.strictEqual(allowed, guard.limits.EVENT_BURST);
});

test("sweep forgets idle keys so memory stays bounded", () => {
    const clock = fakeClock();
    const guard = g.createGuard({ now: clock });
    for (let i = 0; i < 500; i++) {
        guard.admit({ ip: "10.0.0." + (i % 250) + "." + i, clientId: "k" + i, ipConnections: 0, clientSockets: 0 });
        guard.penalize("k" + i, 1);
    }
    assert.ok(guard.stats().connectBuckets > 0 && guard.stats().violations > 0);
    clock.advance(10 * 60 * 1000);
    guard.sweep();
    assert.deepStrictEqual(guard.stats(), { connectBuckets: 0, ipTapBuckets: 0, violations: 0 });
});

// ---------- server-side measurement ----------

test("meter: combo continues inside the gap and resets after it", () => {
    const meter = g.createMeter(g.LIMITS);
    assert.strictEqual(meter.record(5, 0).combo, 5);
    assert.strictEqual(meter.record(5, 250).combo, 10);
    assert.strictEqual(meter.record(5, 250 + g.LIMITS.COMBO_GAP_MS).combo, 15);    // exactly at the gap
    assert.strictEqual(meter.record(3, 250 + g.LIMITS.COMBO_GAP_MS * 3).combo, 3); // pause: reset
});

test("meter: rate is a rolling 1 s window and goes stale when tapping stops", () => {
    const meter = g.createMeter(g.LIMITS);
    meter.record(5, 0);
    meter.record(5, 250);
    meter.record(5, 500);
    assert.strictEqual(meter.record(5, 750).rate, 20);
    assert.strictEqual(meter.record(5, 1000).rate, 20);       // the t=0 batch just left the window
    assert.strictEqual(meter.record(1, 5000).rate, 1);        // stale rate does not carry over
});

// ---------- stamps: only server numbers count ----------

test("stamps are awarded from server stats, exactly once", () => {
    const profile = freshProfile({ taps: 100, visitTaps: 100 });
    const first = g.evaluateStamps(profile, { combo: 0, rate: 0 }, 111);
    assert.ok(first.includes("pats-1") && first.includes("pats-100"));
    assert.ok(!first.includes("pats-500"));
    assert.strictEqual(profile.stamps["pats-100"], 111);

    assert.deepStrictEqual(g.evaluateStamps(profile, { combo: 0, rate: 0 }, 222), []);
    assert.strictEqual(profile.stamps["pats-100"], 111);       // timestamp never rewritten
});

test("combo / speed / session / dedication stamps unlock only at their thresholds", () => {
    const profile = freshProfile({ taps: 10, visitTaps: 10, sessions: 5, activeDays: 7 });
    let ids = g.evaluateStamps(profile, { combo: 25, rate: 12 }, 1);
    for (const id of ["combo-10", "combo-25", "rate-8", "rate-12", "sessions-5", "days-7"]) {
        assert.ok(ids.includes(id), id);
    }
    for (const id of ["combo-50", "rate-16", "rate-20", "session-100", "sessions-25", "days-30"]) {
        assert.ok(!ids.includes(id), id);
    }

    profile.visitTaps = 1000;
    ids = g.evaluateStamps(profile, { combo: 200, rate: 20 }, 2);
    for (const id of ["session-100", "session-500", "session-1000", "combo-200", "rate-20"]) {
        assert.ok(ids.includes(id), id);
    }
});

test("every catalog entry is reachable by the server evaluator", () => {
    const profile = freshProfile({
        taps: 1e6, visitTaps: 1e6, sessions: 1e3, activeDays: 1e3
    });
    g.evaluateStamps(profile, { combo: 1e6, rate: 1e3 }, 1);
    for (const a of core.ACHIEVEMENTS) {
        assert.ok(a.id in profile.stamps, a.id);
    }
});

// ---------- client IP / proxy trust ----------

test("isPrivateIP covers real private ranges and not look-alikes", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "192.168.1.5", "172.16.0.1", "172.31.255.255",
        "169.254.1.1", "100.64.0.1", "::1", "fd00::1", "fe80::1"]) {
        assert.strictEqual(g.isPrivateIP(ip), true, ip);
    }
    for (const ip of ["8.8.8.8", "172.15.0.1", "172.32.0.1", "172.217.0.1", "100.128.0.1",
        "2001:4860:4860::8888", "garbage", ""]) {
        assert.strictEqual(g.isPrivateIP(ip), false, ip);
    }
});

test("resolveClientIP: spoofed headers are ignored when the peer is public", () => {
    const hs = { address: "203.0.113.7", headers: { "x-forwarded-for": "8.8.8.8", "cf-connecting-ip": "1.1.1.1" } };
    assert.strictEqual(g.resolveClientIP(hs, "auto"), "203.0.113.7");
    assert.strictEqual(g.resolveClientIP(hs, "off"), "203.0.113.7");
});

test("resolveClientIP: behind a local proxy, the RIGHTMOST hop wins (not the spoofable first)", () => {
    const hs = {
        address: "::ffff:127.0.0.1",
        headers: { "x-forwarded-for": "6.6.6.6, 198.51.100.9" }   // client forged the first entry
    };
    assert.strictEqual(g.resolveClientIP(hs, "auto"), "198.51.100.9");
});

test("resolveClientIP: cloudflare mode uses CF-Connecting-IP; garbage falls back to the peer", () => {
    assert.strictEqual(
        g.resolveClientIP({ address: "127.0.0.1", headers: { "cf-connecting-ip": "198.51.100.20" } }, "cloudflare"),
        "198.51.100.20"
    );
    assert.strictEqual(
        g.resolveClientIP({ address: "127.0.0.1", headers: { "x-forwarded-for": "not-an-ip" } }, "auto"),
        "127.0.0.1"
    );
    assert.strictEqual(g.resolveClientIP({ address: undefined, headers: {} }, "auto"), null);
});
