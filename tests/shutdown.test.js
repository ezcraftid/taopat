"use strict";

const test = require("node:test");
const assert = require("node:assert");
const { createShutdownController } = require("../lib/shutdown.js");

test("shutdown runs the teardown exactly once even when called repeatedly", async () => {
    const calls = { save: 0, checkpoint: 0, closeDatabase: 0 };
    const controller = createShutdownController({
        save: () => { calls.save += 1; return true; },
        checkpoint: () => { calls.checkpoint += 1; },
        closeDatabase: () => { calls.closeDatabase += 1; },
        closeServers: (finish) => finish(0)
    });

    const a = controller.run();
    const b = controller.run();
    const c = controller.run();
    assert.strictEqual(a, b, "repeat calls return the same completion promise");

    await Promise.all([a, b, c]);
    assert.strictEqual(calls.save, 1);
    assert.strictEqual(calls.checkpoint, 1);
    assert.strictEqual(calls.closeDatabase, 1);
    assert.strictEqual(controller.phase, "done");
});

test("a failed save skips the checkpoint but still closes the database", async () => {
    let checkpointed = 0;
    let closed = 0;
    const completions = [];
    const controller = createShutdownController({
        save: () => false,
        checkpoint: () => { checkpointed += 1; },
        closeDatabase: () => { closed += 1; },
        closeServers: (finish) => finish(0),
        onComplete: (saved) => completions.push(saved)
    });

    const result = await controller.run();
    assert.deepStrictEqual(result, { saved: false, code: 0 });
    assert.strictEqual(checkpointed, 0);
    assert.strictEqual(closed, 1);
    assert.deepStrictEqual(completions, [false]);
});

test("a throwing save is reported and teardown still proceeds", async () => {
    let errors = 0;
    let closed = 0;
    const controller = createShutdownController({
        save: () => { throw new Error("db boom"); },
        closeDatabase: () => { closed += 1; },
        closeServers: (finish) => finish(0),
        onError: () => { errors += 1; }
    });

    const result = await controller.run();
    assert.strictEqual(result.saved, false);
    assert.strictEqual(errors, 1);
    assert.strictEqual(closed, 1);
});

test("shutdown resolves even if the server close callback never fires", async () => {
    let closed = 0;
    const controller = createShutdownController({
        save: () => true,
        closeDatabase: () => { closed += 1; },
        closeServers: () => { /* never calls finish */ },
        closeTimeoutMs: 25
    });

    const result = await controller.run();
    assert.strictEqual(result.code, 0);
    assert.strictEqual(closed, 1);
});
