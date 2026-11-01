# TASK D6 (OPTIONAL) - Code fixes found during review

Run only after D5 passes (or on a separate branch). Work in `SRC_DIR`, then redeploy: rsync to `/opt/taopat`, then `sudo systemctl restart taopat`.
Context needed: this file only. Read just the files named in each part.

## Findings

1. **Stamps are not actually server-authoritative in the UI (incomplete integration).**
   - `server.js` evaluates stamps itself, stores them, sends them in `initialState.user.stamps`, and emits `stampsAccepted` with new ids.
   - `public/js/app.js` calls `TaoGame.onServerState(...)`, but `public/js/game.js` never defines it, and nobody listens to `stampsAccepted`.
   - `game.js` still uses its own old 13-item list and awards stamps locally from `localStorage`; the 26-item catalog in `tao-core.js` (`ACHIEVEMENTS`, with `desc` and `progressFor`) is unused by the UI.
2. **Server gap:** at connect time `evaluateStamps` is called with zero combo/rate, so a combo/speed stamp whose requirement was already met (stored `best_combo`/`best_rate`) can never be re-derived.
3. **Optional improvement:** behind Cloudflare, the `CF-IPCountry` header gives the visitor country for free, so the third-party `ip-api.com` lookup (rate-limited, plain HTTP) can be skipped.

Parts A and B fix 1 and 2. Part C is fix 3. Each part is independent; do A+B together.

---

## Part A - Server tweaks (`server.js`)

A1. In the `io.on("connection", ...)` handler find:

```js
        if (guardLib.evaluateStamps(profile, ZERO_MEASURE, Date.now()).length) {
            profile.dirty = true;
        }
```

Replace with (best values were measured by the server, so they are trustworthy):

```js
        if (guardLib.evaluateStamps(
            profile,
            { combo: profile.bestCombo, rate: profile.bestRate },
            Date.now()
        ).length) {
            profile.dirty = true;
        }
```

If `ZERO_MEASURE` is now unused (`grep -n ZERO_MEASURE server.js`), delete its `const` line.

A2. In the `initialState` payload's `user: { ... }` object, after `sessions: profile.sessions,` add:

```js
                            activeDays:
                                profile.activeDays,
```

## Part B - Client (`fx.js`, `game.js`, `app.js`)

### B1. `public/js/fx.js`

Add this function just above `// game.js calls this when the combo times out.`:

```js
    // game.js calls this when the server confirms a new stamp.
    function onGift() {
        playVoice("gift", { interrupt: true });
    }
```

In the final `window.TaoFX = { ... }` object add `onGift,` after `onComboEnd,`.
In the early-return stub at the top (`window.TaoFX = { onTap() {}, ... }`) add `onGift() {},`.

### B2. `public/js/game.js`

1. Replace the whole inline `const ACHIEVEMENTS = [ ... ];` block (13 entries) with:

```js
    // Single source of truth shared with the server: public/js/tao-core.js
    const CORE = window.TaoCore;
    const CATEGORY_LABEL = {
        milestone: "Milestone", combo: "Combo", speed: "Speed",
        session: "Session", dedication: "Dedication"
    };
    const ACHIEVEMENTS = CORE && CORE.ACHIEVEMENTS
        ? CORE.ACHIEVEMENTS.map((a) => Object.assign({ label: CATEGORY_LABEL[a.category] || "Stamp" }, a))
        : [];
```

2. Add two variables next to `let combo = 0;`:

```js
    let visitTaps = 0;     // taps in this page visit (for session-goal progress)
    let server = null;     // last `user` object received in initialState
```

3. In `onTap`, add `visitTaps += 1;` right after `lastTapAt = now;`.
4. In `onTap`, DELETE everything from the comment `// First call: silently credit total-based stamps` through the end of the `if (unlocked.length) { ... }` block (the seeding, the `ACHIEVEMENTS.forEach` award loop, `showStamp` call). Local awarding is removed on purpose: the server is the only authority.
   Change the return line to: `return { combo, tier, tierUp, rate, unlocked: [] };`
5. Add these functions above `// RECORD SHEET`:

```js
    // ------------------------------------------------------
    // SERVER-AUTHORITATIVE STAMPS
    // ------------------------------------------------------
    function onServerState(user) {
        server = user || null;
        if (!server) return;

        // Server wins for everything it owns. No popups for stamps earned earlier.
        state.unlocked = Object.assign({}, server.stamps || {});
        if (Number(server.bestCombo) > state.bestCombo) state.bestCombo = Number(server.bestCombo);
        if (Number(server.bestRate) > state.bestRate) state.bestRate = Number(server.bestRate);
        if (Number(server.sessions) > 0) state.sessions = Number(server.sessions);
        if (Number(server.firstSeen) > 0) state.firstSeen = Number(server.firstSeen);
        saveNow();
        if (!els.record.hidden) renderRecord();
    }

    function onServerStamps(ids) {
        const now = Date.now();
        let fresh = 0;

        (Array.isArray(ids) ? ids : []).forEach((id) => {
            const a = ACHIEVEMENTS.find((item) => item.id === id);
            if (!a || state.unlocked[id] !== undefined) return;
            state.unlocked[id] = now;
            fresh += 1;
            showStamp(a.label, a.title);
        });

        if (fresh) {
            saveNow();
            if (window.TaoFX && typeof window.TaoFX.onGift === "function") window.TaoFX.onGift();
            if (!els.record.hidden) renderRecord();
        }
    }
```

6. In `renderRecord`, add a stat line after `addStat("Sessions", ...)`:

```js
        addStat("Days played", (server ? Number(server.activeDays) || 0 : 0).toLocaleString());
```

   and replace the `ACHIEVEMENTS.forEach((a) => { ... });` loop that builds the stamp list with:

```js
        const stats = {
            total: total,
            combo: state.bestCombo,
            rate: state.bestRate,
            session: visitTaps,
            sessions: state.sessions,
            days: server ? Number(server.activeDays) || 0 : 0
        };

        ACHIEVEMENTS.forEach((a) => {
            const at = state.unlocked[a.id];
            const li = document.createElement("li");
            li.className = "record-stamp" + (at !== undefined ? " is-earned" : "");

            const title = document.createElement("span");
            title.className = "record-stamp-title";
            title.textContent = a.title;

            const desc = document.createElement("span");
            desc.className = "record-stamp-desc";
            desc.textContent = a.desc || "";

            const meta = document.createElement("span");
            meta.className = "record-stamp-meta";

            if (at !== undefined) {
                meta.textContent = at === 0 ? "Earlier" : formatDate(at);
            } else {
                const p = CORE && CORE.progressFor ? CORE.progressFor(a, stats) : null;
                meta.textContent = p
                    ? p.value.toLocaleString() + " / " + p.target.toLocaleString()
                    : "Not yet";
            }

            li.append(title, desc, meta);
            els.recordStamps.append(li);
        });
```

7. In the final `window.TaoGame = { ... }` add `onServerState, onServerStamps,` after `onTap,`.
8. In the early-return stub object for missing markup, also guard `if (!CORE ...)`: simplest is to leave as is; the empty `ACHIEVEMENTS` array just renders an empty list.

### B3. `public/js/app.js`

After the `socket.on("userStats", ...)` block add:

```js
// New stamps are awarded by the server; the UI only displays them.
socket.on("stampsAccepted", (ids) => {
    if (window.TaoGame && typeof window.TaoGame.onServerStamps === "function") {
        window.TaoGame.onServerStamps(ids);
    }
});
```

## Part C - Use `CF-IPCountry` for the region (only when `TRUST_PROXY=cloudflare`)

In `server.js`, after the `resolveRegion` function add:

```js
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
```

In the connection handler change `resolveRegion(ip)` (the one followed by `.then(region => {`) to:

```js
        const cfRegion =
            regionFromCloudflare(socket.handshake.headers);

        (cfRegion ? Promise.resolve(cfRegion) : resolveRegion(ip))
```

keeping the existing `.then(...)`/`.catch(...)` chain attached. Existing regions already in SQLite keep their stored names (`getOrCreateRegion` does not rename).

## Verify

```bash
node --check server.js public/js/game.js public/js/app.js public/js/fx.js
node _check_ids.js
npm test
```

Then redeploy and in the browser: pat once -> "First pat" stamp appears (from the server, after ~250 ms); reload -> no popup for it, and "Your record" shows it as earned, plus progress like `37 / 100` on locked stamps and a description on each stamp. Re-run the D5 smoke script; region should be a real country code.

Append to `DEPLOY_FACTS.md`: `D6: done (parts applied: <A,B,C>)`.
