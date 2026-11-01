"use strict";

const test = require("node:test");
const assert = require("node:assert");
const core = require("../public/js/tao-core.js");

test("generateClientId produces a valid v4 UUID", () => {
    for (let i = 0; i < 200; i++) {
        const id = core.generateClientId();
        assert.ok(core.isValidClientId(id), `invalid id: ${id}`);
        assert.strictEqual(id[14], "4", "version nibble must be 4");
        assert.ok("89ab".includes(id[19]), "variant nibble must be 8/9/a/b");
    }
});

test("generateClientId is unique across many calls", () => {
    const seen = new Set();
    for (let i = 0; i < 1000; i++) seen.add(core.generateClientId());
    assert.strictEqual(seen.size, 1000);
});

test("isValidClientId rejects malformed and non-string input", () => {
    const bad = [
        "", "nope", null, undefined, 42,
        "549044be-31b7-4617-a2e4-aa0b62170a0b ", // trailing space
        "549044be31b74617a2e4aa0b62170a0b",       // no dashes
        "549044be-31b7-1617-a2e4-aa0b62170a0b",   // version 1, not 4
        "549044be-31b7-4617-72e4-aa0b62170a0b",   // bad variant
        "../../etc/passwd"
    ];
    for (const value of bad) {
        assert.strictEqual(core.isValidClientId(value), false, `should reject: ${value}`);
    }
});

test("sanitizeClientId keeps valid ids and replaces invalid ones", () => {
    const valid = core.generateClientId();
    assert.strictEqual(core.sanitizeClientId(valid), valid);

    const replaced = core.sanitizeClientId("not-a-uuid");
    assert.ok(core.isValidClientId(replaced));
    assert.notStrictEqual(replaced, "not-a-uuid");

    let generated = 0;
    const injected = core.sanitizeClientId(undefined, () => {
        generated += 1;
        return "11111111-1111-4111-8111-111111111111";
    });
    assert.strictEqual(generated, 1);
    assert.strictEqual(injected, "11111111-1111-4111-8111-111111111111");
});

test("parseSeedTotal clamps and ignores junk", () => {
    assert.strictEqual(core.parseSeedTotal(123, 1000), 123);
    assert.strictEqual(core.parseSeedTotal("250", 1000), 250);
    assert.strictEqual(core.parseSeedTotal(5000, 1000), 1000);   // capped
    assert.strictEqual(core.parseSeedTotal(-5, 1000), 0);
    assert.strictEqual(core.parseSeedTotal("abc", 1000), 0);
    assert.strictEqual(core.parseSeedTotal(null, 1000), 0);
    assert.strictEqual(core.parseSeedTotal(12.9, 1000), 12);     // floored
});
