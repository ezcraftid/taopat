// public/js/game.js
// Client-only game layer: combo, personal stats, stamps (achievements), record sheet.
// Nothing here touches the server or the Socket.IO protocol; everything is kept in
// localStorage. fx.js calls TaoGame.onTap(total) once per tap and reacts to the result.
(() => {
    "use strict";

    const STORE_KEY = "taopat-stats-v1";
    const COMBO_GAP_MS = 900;            // max pause between taps to keep a combo alive
    const COMBO_TIERS = [10, 25, 50, 100];   // combo counts where tier 1..4 begin
    const MIN_COMBO_SHOWN = 3;
    const RATE_WINDOW_MS = 1000;
    const MAX_QUEUED_STAMPS = 4;

    // Single source of truth shared with the server: public/js/tao-core.js
    const CORE = window.TaoCore;
    const CATEGORY_LABEL = {
        milestone: "Milestone", combo: "Combo", speed: "Speed",
        session: "Session", dedication: "Dedication"
    };
    const ACHIEVEMENTS = CORE && CORE.ACHIEVEMENTS
        ? CORE.ACHIEVEMENTS.map((a) => Object.assign({ label: CATEGORY_LABEL[a.category] || "Stamp" }, a))
        : [];

    const $ = (id) => document.getElementById(id);
    const els = {
        combo: $("combo"),
        comboCount: $("comboCount"),
        comboBar: $("comboBar"),
        stamp: $("stamp"),
        stampLabel: $("stampLabel"),
        stampTitle: $("stampTitle"),
        recordBtn: $("recordBtn"),
        record: $("record"),
        recordScrim: $("recordScrim"),
        recordClose: $("recordClose"),
        recordStats: $("recordStats"),
        recordStamps: $("recordStamps"),
        stampCount: $("stampCount"),
        userTaps: $("userTaps")
    };

    const REQUIRED = ["combo", "comboCount", "comboBar", "stamp", "stampLabel", "stampTitle",
        "recordBtn", "record", "recordScrim", "recordClose", "recordStats", "recordStamps"];

    if (REQUIRED.some((key) => !els[key])) {
        // Markup missing: stay out of the way, fx.js keeps working without us.
        window.TaoGame = {
            onTap: () => ({ combo: 0, tier: 0, tierUp: false, rate: 0, unlocked: [] })
        };
        return;
    }

    const reduceMotion = !!(window.matchMedia &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches);

    // ------------------------------------------------------
    // PERSISTENT STATE
    // ------------------------------------------------------
    function defaultState() {
        return {
            v: 1,
            firstSeen: Date.now(),
            sessions: 0,
            bestCombo: 0,
            bestRate: 0,
            lastTotal: 0,
            seeded: false,
            unlocked: {}          // id -> unix ms (0 = unlocked before tracking began)
        };
    }

    function load() {
        try {
            const raw = localStorage.getItem(STORE_KEY);
            if (!raw) return defaultState();
            const saved = JSON.parse(raw);
            const state = Object.assign(defaultState(), saved);
            if (!state.unlocked || typeof state.unlocked !== "object") state.unlocked = {};
            return state;
        } catch (_) {
            return defaultState();
        }
    }

    const state = load();
    let saveTimer = null;

    function saveNow() {
        clearTimeout(saveTimer);
        saveTimer = null;
        try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (_) { /* ignore */ }
    }

    function scheduleSave() {
        if (saveTimer) return;
        saveTimer = setTimeout(saveNow, 1500);
    }

    state.sessions += 1;
    saveNow();

    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") saveNow();
    });
    window.addEventListener("pagehide", saveNow);

    // ------------------------------------------------------
    // COMBO
    // ------------------------------------------------------
    let combo = 0;
    let visitTaps = 0;     // taps in this page visit (for session-goal progress)
    let server = null;     // last `user` object received in initialState
    let tier = 0;
    let lastTapAt = -Infinity;
    let breakTimer = null;
    let comboAnim = null;
    const recentTaps = [];

    function setTier(next) {
        tier = next;
        document.body.dataset.tier = String(next);
    }

    function endCombo() {
        combo = 0;
        setTier(0);
        els.combo.hidden = true;
        if (comboAnim) { comboAnim.cancel(); comboAnim = null; }
        if (window.TaoFX && typeof window.TaoFX.onComboEnd === "function") {
            window.TaoFX.onComboEnd();
        }
    }

    function renderCombo() {
        if (combo < MIN_COMBO_SHOWN) return;

        els.combo.hidden = false;
        els.comboCount.textContent = "\u00d7" + combo;

        if (reduceMotion) {
            els.comboBar.style.transform = "scaleX(1)";
            return;
        }

        if (comboAnim) comboAnim.cancel();
        comboAnim = els.comboBar.animate(
            [{ transform: "scaleX(1)" }, { transform: "scaleX(0)" }],
            { duration: COMBO_GAP_MS, easing: "linear", fill: "forwards" }
        );
    }

    // ------------------------------------------------------
    // STAMPS (one at a time, short queue)
    // ------------------------------------------------------
    const stampQueue = [];
    let stampShowing = false;

    function showStamp(label, title) {
        stampQueue.push({ label, title });
        while (stampQueue.length > MAX_QUEUED_STAMPS) stampQueue.shift();
        pumpStamps();
    }

    function pumpStamps() {
        if (stampShowing || !stampQueue.length) return;
        stampShowing = true;

        const { label, title } = stampQueue.shift();
        els.stampLabel.textContent = label;
        els.stampTitle.textContent = title;
        els.stamp.hidden = false;
        if (window.TaoFX && typeof window.TaoFX.onStampShow === "function") {
            window.TaoFX.onStampShow();   // sound is played when the stamp lands, not when it unlocks
        }

        const base = "translate(-50%, -50%) rotate(-6deg)";
        const frames = reduceMotion
            ? [{ opacity: 0, transform: base }, { opacity: 1, transform: base, offset: 0.1 },
               { opacity: 1, transform: base, offset: 0.85 }, { opacity: 0, transform: base }]
            : [{ opacity: 0, transform: "translate(-50%, -50%) rotate(-12deg) scale(1.8)" },
               { opacity: 1, transform: base + " scale(1)", offset: 0.12 },
               { opacity: 1, transform: base + " scale(1)", offset: 0.82 },
               { opacity: 0, transform: base + " translateY(-10px)" }];

        const anim = els.stamp.animate(frames, {
            duration: reduceMotion ? 1400 : 1800,
            easing: "ease-out"
        });

        const done = () => {
            els.stamp.hidden = true;
            stampShowing = false;
            pumpStamps();
        };
        anim.onfinish = done;
        anim.oncancel = done;
    }

    // ------------------------------------------------------
    // TAP (called by fx.js)
    // ------------------------------------------------------
    function onTap(total) {
        const now = performance.now();

        combo = (combo > 0 && now - lastTapAt <= COMBO_GAP_MS) ? combo + 1 : 1;
        lastTapAt = now;
        visitTaps += 1;

        recentTaps.push(now);
        while (recentTaps.length && recentTaps[0] < now - RATE_WINDOW_MS) recentTaps.shift();
        const rate = recentTaps.length;

        const nextTier = COMBO_TIERS.filter((threshold) => combo >= threshold).length;
        const tierUp = nextTier > tier;
        setTier(nextTier);

        clearTimeout(breakTimer);
        breakTimer = setTimeout(endCombo, COMBO_GAP_MS + 40);
        renderCombo();

        // Stats
        state.lastTotal = total;
        if (combo > state.bestCombo) { state.bestCombo = combo; scheduleSave(); }
        if (rate > state.bestRate) { state.bestRate = rate; scheduleSave(); }

        return { combo, tier, tierUp, rate, unlocked: [] };
    }

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

    // ------------------------------------------------------
    // RECORD SHEET
    // ------------------------------------------------------
    function formatDate(ms) {
        try { return new Date(ms).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }); }
        catch (_) { return "-"; }
    }

    function addStat(label, value) {
        const dt = document.createElement("dt");
        dt.textContent = label;
        const dd = document.createElement("dd");
        dd.textContent = value;
        els.recordStats.append(dt, dd);
    }

    function renderRecord() {
        const shown = els.userTaps ? parseInt(els.userTaps.textContent.replace(/\D/g, ""), 10) : NaN;
        const total = Number.isFinite(shown) ? shown : state.lastTotal;
        const earned = ACHIEVEMENTS.filter((a) => state.unlocked[a.id] !== undefined).length;

        els.recordStats.textContent = "";
        addStat("Total pats", total.toLocaleString());
        addStat("Best combo", "\u00d7" + state.bestCombo.toLocaleString());
        addStat("Peak speed", state.bestRate.toLocaleString() + " pats/s");
        addStat("Sessions", state.sessions.toLocaleString());
        addStat("Days played", (server ? Number(server.activeDays) || 0 : 0).toLocaleString());
        addStat("Playing since", formatDate(state.firstSeen));

        els.stampCount.textContent = earned + " / " + ACHIEVEMENTS.length;
        els.recordStamps.textContent = "";

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
    }

    function openRecord() {
        renderRecord();
        els.recordScrim.hidden = false;
        els.record.hidden = false;
        els.recordBtn.setAttribute("aria-expanded", "true");
        els.recordClose.focus();
    }

    function closeRecord() {
        if (els.record.hidden) return;
        els.recordScrim.hidden = true;
        els.record.hidden = true;
        els.recordBtn.setAttribute("aria-expanded", "false");
        els.recordBtn.focus();
    }

    els.recordBtn.addEventListener("click", () => (els.record.hidden ? openRecord() : closeRecord()));
    els.recordClose.addEventListener("click", closeRecord);
    els.recordScrim.addEventListener("click", closeRecord);
    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") closeRecord();
    });

    window.TaoGame = {
        onTap,
        onServerState,
        onServerStamps,
        openRecord,
        closeRecord,
        get combo() { return combo; },
        get tier() { return tier; }
    };
})();