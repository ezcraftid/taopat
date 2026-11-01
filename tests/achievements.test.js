"use strict";

const test = require("node:test");
const assert = require("node:assert");
const core = require("../public/js/tao-core.js");

const VALID_CATEGORIES = new Set(["milestone", "combo", "speed", "session", "dedication"]);
const THRESHOLD_KEYS = ["total", "combo", "rate", "session", "sessions", "days"];

test("catalog has unique ids and exactly one valid threshold each", () => {
    const ids = new Set();
    for (const a of core.ACHIEVEMENTS) {
        assert.ok(a.id, "achievement needs an id");
        assert.ok(!ids.has(a.id), `duplicate id: ${a.id}`);
        ids.add(a.id);

        assert.ok(VALID_CATEGORIES.has(a.category), `bad category: ${a.category}`);
        assert.ok(typeof a.title === "string" && a.title.length, `missing title: ${a.id}`);
        assert.ok(typeof a.desc === "string" && a.desc.length, `missing desc: ${a.id}`);

        const present = THRESHOLD_KEYS.filter((k) => a[k] !== undefined);
        assert.strictEqual(present.length, 1, `id ${a.id} must have one threshold`);
        assert.ok(Number(a[present[0]]) > 0, `threshold must be positive: ${a.id}`);
    }
});

test("original stamp ids remain (no earned stamps lost on upgrade)", () => {
    const original = [
        "pats-1", "pats-100", "pats-500", "pats-1000", "pats-2500",
        "pats-5000", "pats-10000", "combo-10", "combo-25", "combo-50",
        "combo-100", "rate-8", "rate-12"
    ];
    for (const id of original) {
        assert.ok(core.isKnownAchievement(id), `missing legacy stamp: ${id}`);
    }
});

test("isUnlocked respects each threshold type", () => {
    const byId = Object.fromEntries(core.ACHIEVEMENTS.map((a) => [a.id, a]));
    const stats = { total: 1000, combo: 50, rate: 12, session: 120, sessions: 5, days: 7 };

    assert.strictEqual(core.isUnlocked(byId["pats-500"], stats), true);
    assert.strictEqual(core.isUnlocked(byId["pats-2500"], stats), false);
    assert.strictEqual(core.isUnlocked(byId["combo-50"], stats), true);
    assert.strictEqual(core.isUnlocked(byId["combo-100"], stats), false);
    assert.strictEqual(core.isUnlocked(byId["rate-12"], stats), true);
    assert.strictEqual(core.isUnlocked(byId["rate-16"], stats), false);
    assert.strictEqual(core.isUnlocked(byId["session-100"], stats), true);
    assert.strictEqual(core.isUnlocked(byId["session-500"], stats), false);
    assert.strictEqual(core.isUnlocked(byId["sessions-5"], stats), true);
    assert.strictEqual(core.isUnlocked(byId["days-30"], stats), false);
});

test("newlyUnlocked skips already-unlocked and awards each id once", () => {
    const stats = { total: 100, combo: 10, rate: 0, session: 0, sessions: 0, days: 0 };
    const first = core.newlyUnlocked(core.ACHIEVEMENTS, {}, stats);
    assert.ok(first.some((a) => a.id === "pats-1"));
    assert.ok(first.some((a) => a.id === "pats-100"));
    assert.ok(first.some((a) => a.id === "combo-10"));
    assert.ok(!first.some((a) => a.id === "pats-500"));

    // Mark what we just earned and re-evaluate: nothing should re-award.
    const unlocked = {};
    first.forEach((a) => { unlocked[a.id] = 1; });
    const second = core.newlyUnlocked(core.ACHIEVEMENTS, unlocked, stats);
    assert.strictEqual(second.length, 0);
});

test("a single point of progress never awards two-tap milestones at once", () => {
    // Boundary: total 1 must unlock pats-1 but not pats-100.
    const unlocked = core.newlyUnlocked(core.ACHIEVEMENTS, {}, { total: 1, combo: 1, rate: 1, session: 1, sessions: 1, days: 1 });
    const ids = unlocked.map((a) => a.id);
    assert.deepStrictEqual(ids, ["pats-1"]);
});

test("progressFor caps value at target and reports the goal", () => {
    const byId = Object.fromEntries(core.ACHIEVEMENTS.map((a) => [a.id, a]));
    const p = core.progressFor(byId["pats-500"], { total: 250 });
    assert.deepStrictEqual(p, { key: "total", value: 250, target: 500 });

    const capped = core.progressFor(byId["pats-500"], { total: 9000 });
    assert.strictEqual(capped.value, 500);
});
