// lib/shutdown.js
// Small, dependency-free, idempotent shutdown controller.
//
// The original server could run its SIGINT/SIGTERM handler more than once and
// left periodic timers alive after the SQLite connection closed, which produced
// "TypeError: The database connection is not open" when a save fired late.
// This controller guarantees the teardown sequence runs at most once, records
// whether the save succeeded, and resolves even if a server close callback
// never fires.
"use strict";

function createShutdownController(options) {
    const opts = options || {};

    function report(error) {
        if (typeof opts.onError === "function") {
            try { opts.onError(error); } catch (_) { /* never throw from error path */ }
        }
    }

    function attempt(fn) {
        if (typeof fn !== "function") return undefined;
        try { return fn(); } catch (error) { report(error); return undefined; }
    }

    let phase = "idle";       // idle -> saving -> closing -> done
    let settle = null;
    const done = new Promise((resolve) => { settle = resolve; });

    function run() {
        if (phase !== "idle") return done;
        phase = "saving";

        // 1. Final save. A failed or throwing save must not prevent closing.
        let saved = false;
        if (typeof opts.save === "function") {
            try {
                saved = opts.save() !== false;
            } catch (error) {
                report(error);
                saved = false;
            }
        }

        // 2. Checkpoint only if the save succeeded (WAL truncate after a bad
        //    save is pointless and can throw).
        if (saved) attempt(opts.checkpoint);

        // 3. Close the database exactly once.
        attempt(opts.closeDatabase);

        phase = "closing";
        let finished = false;

        function finish(code) {
            if (finished) return;
            finished = true;
            if (timer) { clearTimeout(timer); timer = null; }
            phase = "done";
            attempt(() => opts.onComplete && opts.onComplete(saved));
            if (typeof opts.exit === "function") attempt(() => opts.exit(code));
            settle({ saved, code });
        }

        let timer = null;
        if (opts.closeTimeoutMs && typeof setTimeout === "function") {
            timer = setTimeout(() => finish(0), opts.closeTimeoutMs);
            if (timer && typeof timer.unref === "function") timer.unref();
        }

        if (typeof opts.closeServers === "function") {
            attempt(() => opts.closeServers(finish));
        } else {
            finish(0);
        }

        return done;
    }

    return {
        run,
        get phase() { return phase; },
        done
    };
}

module.exports = { createShutdownController };
