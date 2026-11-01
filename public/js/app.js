// public/js/app.js
//
// Everything lives inside one closure: `socket`, the tap buffer and the counters
// are not reachable from the DevTools console, and pats only count from real
// (isTrusted) user input. This stops casual console tampering, but it is NOT the
// security boundary: a determined cheater can skip this page and talk to the
// socket directly. The real protection is server-side (see server.js/guard.js),
// which treats every number from the client as untrusted.
(() => {
"use strict";

// ======================================================
// CLIENT IDENTITY (pseudonymous, persisted in first-party localStorage)
// ======================================================

const CLIENT_ID_KEY = "tao-client-id-v1";

function getClientId() {
    if (!window.TaoCore) return undefined;

    let id = null;
    try { id = localStorage.getItem(CLIENT_ID_KEY); } catch (_) { /* ignore */ }

    if (!TaoCore.isValidClientId(id)) {
        id = TaoCore.generateClientId();
        try { localStorage.setItem(CLIENT_ID_KEY, id); } catch (_) { /* ignore */ }
    }
    return id;
}

// Only the identity is sent. The old `seedTotal` field is gone: the server no
// longer accepts a client-supplied starting total.
const socket = io({
    auth: {
        clientId: getClientId()
    }
});

// ======================================================
// STATE
// ======================================================

// Batching. Stay below the server's per-player rate (25 taps/s) so an honest
// client is never throttled: 6 taps per 250 ms = 24/s. Anything above that stays
// in the buffer and is sent on the next tick instead of being lost.
const BATCH_INTERVAL_MS = 250;
const MAX_TAPS_PER_BATCH = 6;
const MAX_BUFFERED_TAPS = 300;

let localTapBuffer = 0;
let userTaps = 0;
let userTPS = 0;

let currentRegion = null;
let lastRegionTaps = 0;
let lastRegions = [];
let topCode = null;

let prevGlobalTaps = null;
let prevGlobalAt = 0;
let globalTPS = 0;

const NO_FLAG_CODES = new Set(["XX", "ZZ", "UN"]);
const rowMap = new Map(); // country code -> leaderboard row element

const compactFormat = new Intl.NumberFormat("en", {
    notation: "compact",
    maximumFractionDigits: 1
});

// ======================================================
// ELEMENTS
// ======================================================

const characterElement = document.getElementById("character");
const statusElement = document.querySelector(".status");
const userTapsElement = document.getElementById("userTaps");
const userTPSElement = document.getElementById("userTPS");

const connectionDot = document.getElementById("connectionDot");
const connectionText = document.getElementById("connectionText");

const boardElement = document.getElementById("board");
const boardToggle = document.getElementById("boardToggle");
const topFlagElement = document.getElementById("topFlag");
const topTapsElement = document.getElementById("topTaps");
const myRegionElement = document.getElementById("myRegion");
const myRegionFlagElement = document.getElementById("myRegionFlag");
const regionTapsElement = document.getElementById("regionTaps");
const regionTPSElement = document.getElementById("regionTPS");
const globalTapsElement = document.getElementById("globalTaps");
const globalTPSElement = document.getElementById("globalTPS");
const leaderboardElement = document.getElementById("leaderboard");

// ======================================================
// HELPERS
// ======================================================

const GLOBE = '<svg class="icon"><use href="#i-globe"></use></svg>';

function formatCompact(value) {
    return value < 10000
        ? value.toLocaleString()
        : compactFormat.format(value);
}

function isCountryCode(code) {
    return /^[A-Za-z]{2}$/.test(code || "") &&
        !NO_FLAG_CODES.has(String(code).toUpperCase());
}

// Flag emoji do not render on Windows browsers, so use an image from flagcdn.com.
// If it fails to load, fall back to the emoji from the server (or the code).
function setFlag(element, code, fallbackEmoji) {
    element.replaceChildren();

    if (!isCountryCode(code)) {
        element.innerHTML = GLOBE;
        return;
    }

    const lower = String(code).toLowerCase();
    const img = document.createElement("img");

    img.className = "flag-img";
    img.alt = String(code).toUpperCase();
    img.width = 28;
    img.height = 20;
    img.src = `https://flagcdn.com/w40/${lower}.png`;
    img.srcset = `https://flagcdn.com/w80/${lower}.png 2x`;

    img.addEventListener("error", () => {
        element.textContent = String(code).toUpperCase();
    }, { once: true });

    element.appendChild(img);
}

// ======================================================
// TAP (only clicks/touches ON THE CHARACTER)
// ======================================================

function tap() {
    userTaps++;

    // Bounded, so a long offline stretch cannot queue an unbounded backlog.
    if (localTapBuffer < MAX_BUFFERED_TAPS) {
        localTapBuffer++;
    }

    userTapsElement.textContent = userTaps.toLocaleString();
    document.body.classList.add("has-tapped");

    if (window.TaoFX) {
        TaoFX.onTap(userTaps);
    }
}

// Only presses ON THE CHARACTER count. pointerdown covers mouse, touch and pen,
// and fires once per finger, so multi-touch gives multiple pats.
// `isTrusted` is false for events a script creates with dispatchEvent(), so
// console-injected synthetic clicks are ignored.
characterElement.addEventListener("pointerdown", (event) => {
    if (!event.isTrusted) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    tap();
});

// Keyboard: only when the character itself is focused (it has tabindex="0").
characterElement.addEventListener("keydown", (event) => {
    if (!event.isTrusted || event.repeat) return;
    if (event.key === " " || event.key === "Enter") {
        event.preventDefault();
        tap();
    }
});

// No long-press / right-click menu on the character (mobile long-press, Android image menu).
characterElement.addEventListener("contextmenu", (event) => event.preventDefault());

// ======================================================
// SEND BATCH
// ======================================================

// Nothing is sent while offline: the buffer simply keeps filling (bounded) and
// drains at a safe pace after reconnecting, instead of dumping a burst that the
// server would have to throttle.
setInterval(() => {
    if (localTapBuffer <= 0 || !socket.connected) {
        return;
    }

    const amount = Math.min(localTapBuffer, MAX_TAPS_PER_BATCH);
    localTapBuffer -= amount;

    socket.emit("tapBatch", amount);
}, BATCH_INTERVAL_MS);

// ======================================================
// CONNECTION
// ======================================================

socket.on("connect", () => {
    connectionText.textContent = "Live";
    statusElement.dataset.state = "live";

    if (window.TaoFX) {
        TaoFX.onConnect();
    }
});

socket.on("disconnect", () => {
    connectionText.textContent = "Offline";
    statusElement.dataset.state = "offline";

    if (window.TaoFX) {
        TaoFX.onDisconnect();
    }
});

socket.on("connect_error", (err) => {
    connectionText.textContent = "Offline";
    statusElement.dataset.state = "offline";

    // A temporary block should not be hammered with retries.
    if (err && err.message === "banned") {
        socket.disconnect();
    }
});

// ======================================================
// INITIAL STATE
// ======================================================

socket.on("initialState", (data) => {
    currentRegion = data.region.code;

    myRegionElement.textContent = data.region.name;
    setFlag(myRegionFlagElement, data.region.code, data.region.flag);

    lastRegionTaps = data.region.taps;
    regionTapsElement.textContent = data.region.taps.toLocaleString();
    globalTapsElement.textContent = data.global.taps.toLocaleString();

    // Durable identity: persist a server-generated ID if ours was missing/invalid.
    if (data.user) {
        if (data.user.clientId && window.TaoCore && !data.user.clientIdValid) {
            try { localStorage.setItem(CLIENT_ID_KEY, data.user.clientId); } catch (_) { /* ignore */ }
        }

        userTaps = Math.max(userTaps, Number(data.user.taps) || 0);
        userTapsElement.textContent = userTaps.toLocaleString();

        if (window.TaoGame && typeof window.TaoGame.onServerState === "function") {
            window.TaoGame.onServerState(data.user);
        }
    }
});

// The former `tao:stamps` / `tao:stats` DOM-event bridges were removed: the
// server ignores client stamp/stat claims, so forwarding them only gave any
// script on the page a way to spam the socket.

// ======================================================
// USER STATS
// ======================================================

socket.on("userStats", (data) => {
    userTaps = Math.max(userTaps, data.taps);
    userTPS = data.tapsPerSecond;

    userTapsElement.textContent = userTaps.toLocaleString();
    userTPSElement.textContent = userTPS.toLocaleString();
});

// New stamps are awarded by the server; the UI only displays them.
socket.on("stampsAccepted", (ids) => {
    if (window.TaoGame && typeof window.TaoGame.onServerStamps === "function") {
        window.TaoGame.onServerStamps(ids);
    }
});

// ======================================================
// LEADERBOARD
// ======================================================

socket.on("leaderboard", (data) => {
    lastRegions = data.regions;

    // Worldwide total + estimated worldwide pats/s (from the change between updates)
    const now = performance.now();

    globalTapsElement.textContent = data.global.taps.toLocaleString();

    if (prevGlobalTaps !== null && now > prevGlobalAt) {
        const rate = (data.global.taps - prevGlobalTaps) / ((now - prevGlobalAt) / 1000);
        globalTPS = globalTPS * 0.6 + Math.max(rate, 0) * 0.4; // smoothed
    }

    prevGlobalTaps = data.global.taps;
    prevGlobalAt = now;

    if (globalTPS >= 0.5) {
        globalTPSElement.textContent = `${(Math.round(globalTPS * 10) / 10).toLocaleString()} pats/s`;
        globalTPSElement.hidden = false;
    } else {
        globalTPSElement.hidden = true;
    }

    // #1 region (left side of the collapsed bar)
    const top = data.regions[0];

    if (top) {
        topTapsElement.textContent = formatCompact(top.taps);

        if (topCode !== top.code) {
            topCode = top.code;
            setFlag(topFlagElement, top.code, top.flag);
        }
    }

    // Own region (right side of the collapsed bar)
    const mine = data.regions.find((item) => item.code === currentRegion);

    if (mine) {
        lastRegionTaps = mine.taps;
        regionTapsElement.textContent = mine.taps.toLocaleString();
        regionTPSElement.textContent = mine.tapsPerSecond.toLocaleString();
    }

    if (isBoardOpen()) {
        renderLeaderboard(lastRegions);
    }
});

// ======================================================
// LEADERBOARD ROWS (keyed: rows are reused, so flag images never reload)
// ======================================================

function createRow() {
    const row = document.createElement("div");

    row.className = "lb-row";
    row.innerHTML =
        '<span class="lb-rank"></span>' +
        '<span class="lb-flag"></span>' +
        '<span class="lb-name"></span>' +
        '<span class="lb-pps" hidden></span>' +
        '<strong class="lb-taps"></strong>';

    return row;
}

function updateRow(row, region, index) {
    row.querySelector(".lb-rank").textContent = String(index + 1).padStart(2, "0");
    row.querySelector(".lb-name").textContent = region.name;
    row.querySelector(".lb-taps").textContent = region.taps.toLocaleString();

    const pps = row.querySelector(".lb-pps");

    if (region.tapsPerSecond > 0) {
        pps.textContent = `${region.tapsPerSecond.toLocaleString()} pats/s`;
        pps.hidden = false;
    } else {
        pps.hidden = true;
    }

    row.classList.toggle("is-mine", region.code === currentRegion);
}

function renderLeaderboard(regions) {
    if (!regions.length) {
        rowMap.clear();
        leaderboardElement.innerHTML = '<div class="loading">No data yet.</div>';
        return;
    }

    const fragment = document.createDocumentFragment();
    const seen = new Set();

    regions.forEach((region, index) => {
        let row = rowMap.get(region.code);

        if (!row) {
            row = createRow();
            setFlag(row.querySelector(".lb-flag"), region.code, region.flag);
            rowMap.set(region.code, row);
        }

        updateRow(row, region, index);
        seen.add(region.code);
        fragment.appendChild(row);
    });

    for (const code of [...rowMap.keys()]) {
        if (!seen.has(code)) {
            rowMap.get(code).remove();
            rowMap.delete(code);
        }
    }

    leaderboardElement.replaceChildren(fragment);
}

// ======================================================
// LEADERBOARD BAR OPEN / CLOSE
// ======================================================

function isBoardOpen() {
    return boardElement.dataset.open === "true";
}

function setBoardOpen(open) {
    boardElement.dataset.open = String(open);
    boardToggle.setAttribute("aria-expanded", String(open));

    if (open) {
        renderLeaderboard(lastRegions);
    }
}

boardToggle.addEventListener("click", (event) => {
    setBoardOpen(!isBoardOpen());
    event.currentTarget.blur(); // so Space/Enter keep counting as taps
});

window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && isBoardOpen()) {
        setBoardOpen(false);
    }
});

// Exposed so the consolidated menu (menu.js) can open/close the leaderboard.
// This only toggles a panel; it cannot change any count.
window.TaoBoard = Object.freeze({
    open: () => setBoardOpen(true),
    close: () => setBoardOpen(false),
    toggle: () => setBoardOpen(!isBoardOpen())
});

})();