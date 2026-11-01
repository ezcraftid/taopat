"use strict";

const test = require("node:test");
const assert = require("node:assert");
const core = require("../public/js/tao-core.js");

test("pickIndexAvoidingRepeat returns a valid index for every count", () => {
    assert.strictEqual(core.pickIndexAvoidingRepeat(0, -1), -1);
    assert.strictEqual(core.pickIndexAvoidingRepeat(1, 0), 0);

    for (let i = 0; i < 500; i++) {
        const idx = core.pickIndexAvoidingRepeat(3, -1);
        assert.ok(idx >= 0 && idx < 3);
    }
});

test("three tracks are all reachable and never repeat back-to-back", () => {
    const counts = [0, 0, 0];
    let last = -1;
    for (let i = 0; i < 5000; i++) {
        const idx = core.pickIndexAvoidingRepeat(3, last);
        assert.notStrictEqual(idx, last, "must not immediately repeat");
        counts[idx] += 1;
        last = idx;
    }
    for (const c of counts) assert.ok(c > 1000, `track under-selected: ${counts}`);
});

test("with one usable track the same track is returned (no dead loop)", () => {
    let last = -1;
    for (let i = 0; i < 100; i++) {
        last = core.pickIndexAvoidingRepeat(1, last);
        assert.strictEqual(last, 0);
    }
});
