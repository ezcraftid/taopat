const socket = io();

// ======================================================
// STATE
// ======================================================

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
    localTapBuffer++;

    userTapsElement.textContent = userTaps.toLocaleString();
    document.body.classList.add("has-tapped");

    if (window.TaoFX) {
        TaoFX.onTap(userTaps);
    }
}

// Only presses ON THE CHARACTER count. pointerdown covers mouse, touch and pen,
// and fires once per finger, so multi-touch gives multiple pats.
characterElement.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    tap();
});

// Keyboard: only when the character itself is focused (it has tabindex="0").
characterElement.addEventListener("keydown", (event) => {
    if (event.repeat) return;
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

// Send every 250ms
setInterval(() => {
    if (localTapBuffer <= 0) {
        return;
    }

    const amount = localTapBuffer;
    localTapBuffer = 0;

    socket.emit("tapBatch", amount);
}, 250);

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
});

// ======================================================
// USER STATS
// ======================================================

socket.on("userStats", (data) => {
    userTaps = Math.max(userTaps, data.taps);
    userTPS = data.tapsPerSecond;

    userTapsElement.textContent = userTaps.toLocaleString();
    userTPSElement.textContent = userTPS.toLocaleString();
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
