# TaoPat: implementation brief

You are working inside an existing Node.js project called **TaoPat** (previously "TaoTap"). It is a realtime "tap the character" web game. Read this whole brief first, then implement it end to end without asking questions. If something is ambiguous, pick the most reasonable option, note it in your final report, and keep going.

---

## 1. Project context

Stack: Node >= 20, Express 5, Socket.IO 4, better-sqlite3. The frontend is plain HTML/CSS/vanilla JS served from `public/`. There is no build step and there must not be one.

```
data/tapgame.db                  (SQLite, DO NOT touch or rename)
public/
  index.html
  css/style.css
  js/app.js                      (socket + counters + leaderboard)
  js/fx.js                       (pat animation + audio)
  assets/
    audio/  lowhp-01.mp3  milestone-01.mp3  milestone-02.mp3  milestone-03.mp3
            pat.ogg  pat1.ogg  pat2.ogg
    img/    patpat.png  tao-base.png
server.js                        (DO NOT modify)
package.json
vo_raw/, download_vo_v2.ps1, urls.txt   (voice-line tooling, leave alone)
```

The character is a chibi Hu Tao (`tao-base.png`). `patpat.png` is a **horizontal sprite strip of 5 hand frames** (a hand patting down and coming back up), taken from the Minecraft mod LopyMine/PatPat. Do not assume its exact pixel size: read it (`file`, `node`, or any image tool available) and confirm the 5-frame layout before relying on it.

You do not need network access for anything essential. `github.com/aDu/pet-pet-gif` is only an optional conceptual reference for the "squish the avatar while a hand pats it" idea; do not depend on it.

---

## 2. Goals

1. **Per-click pat sound.** Every click or tap **on the character** (mouse, touch, pen, desktop and mobile) plays one random sound from `pat.ogg`, `pat1.ogg`, `pat2.ogg`. Random, never a fixed sequence.
2. **Pat animation uses the real sprite.** Use `patpat.png` frame by frame, synced with the character squash.
3. **Redesign** so the site no longer looks like generic AI-generated UI. Concrete art direction is in section 6. Follow it, do not improvise a different "modern gradient" look.

---

## 3. Hard constraints

- Do not modify `server.js`, the Socket.IO event names/payloads, the DB schema, or `data/`.
- No new runtime dependencies, no bundler, no framework. Vanilla JS only.
- Keep the existing element IDs that `app.js` relies on, or update both sides consistently.
- Every missing optional asset must fail silently (no console errors that break the game). Several voice groups (`hello`, `idle`, `healed`) reference files that do not exist yet; keep that feature working as "ignored if absent".
- Taps must keep counting and sounds must keep playing while the socket is disconnected.
- Do not refactor unrelated code. Keep `app.js` changes to the patches below.
- No emoji anywhere in the UI (icons are inline SVG, section 6).

---

## 4. What is wrong in the current code (diagnosis)

1. `app.js` counts a tap on **any** pointer press on the full-screen stage **and any keyboard key**. It must only count presses on the character.
2. `fx.js` `CONFIG.audio.tap` points to `tap-01.mp3 ... tap-06.mp3`, which do not exist. The real files are `pat.ogg`, `pat1.ogg`, `pat2.ogg`, so currently nothing plays on tap.
3. Even with correct files, `playVoice("tap")` uses a single non-interrupting voice channel plus `tapVoiceCooldownMs: 500`, so at most about 2 sounds per second and rapid clicks are silently dropped. Pat sounds must be polyphonic and fire on every click.
4. `CONFIG.handImage` is `hand.png` (missing), so only the placeholder SVG hand ever shows. The real asset is the 5-frame strip `patpat.png`.
5. Safari/iOS has historically had poor or no support for Ogg Vorbis in `decodeAudioData`. Because mobile is a requirement, provide `.mp3` fallbacks (task A3). Verify support rather than assuming.
6. UI problems that read as "AI slop": purple/pink gradient background, a blurred copy of the character as backdrop, a huge all-caps outlined title, emoji as icons (trophy, speaker, globe, medals, sparkles), a generic white rounded bottom sheet, glassmorphism pill, identical 18px rounding everywhere, centered everything.

---

## 5. Task A: interaction and audio

### A1. Replace `public/js/fx.js` completely with this file

IDs it expects in the DOM: `character`, `characterStage`, `characterImg`, `characterFallback`, `patHand`, `patHandSprite`, `patHandSvg`, `fxRing`, `muteBtn`.

```js
// public/js/fx.js
// Pat effect (sprite hand + squash & stretch) and audio for the character.
// Fail-safe: assets that do not exist are ignored without errors.
(() => {
    "use strict";

    const IMG_DIR = "/assets/img/";
    const AUDIO_DIR = "/assets/audio/";

    const CONFIG = {
        images: {
            base: "tao-base.png",
            happy: "tao-happy.png"          // optional
        },
        sprite: { file: "patpat.png", frames: 5 },   // horizontal strip, 5 equal frames
        audio: {
            pat: ["pat.ogg", "pat1.ogg", "pat2.ogg"],
            milestone: ["milestone-01.mp3", "milestone-02.mp3", "milestone-03.mp3"],
            hello: ["hello-01.mp3", "hello-02.mp3"],     // optional, ignored if missing
            idle: ["idle-01.mp3", "idle-02.mp3"],        // optional
            lowHp: ["lowhp-01.mp3"],
            healed: ["healed-01.mp3"]                    // optional
        },
        milestones: [100, 500, 1000, 2500, 5000],        // then every multiple of milestoneEvery
        milestoneEvery: 10000,
        volume: 0.85,
        avoidImmediateRepeat: true,   // still random; just never the same pat file twice in a row
        maxPatVoices: 6,              // polyphony cap for overlapping pat sounds
        patDurationMs: 260,           // one pat = all sprite frames, once
        handHoldMs: 320,
        happyHoldMs: 320,
        ringMs: 800,
        idleAfterMs: 20000,
        idleVoiceCooldownMs: 45000
    };

    const character = document.getElementById("character");
    const stage = document.getElementById("characterStage");
    const characterImg = document.getElementById("characterImg");
    const characterFallback = document.getElementById("characterFallback");
    const patHand = document.getElementById("patHand");
    const patHandSprite = document.getElementById("patHandSprite");
    const patHandSvg = document.getElementById("patHandSvg");
    const fxRing = document.getElementById("fxRing");
    const muteBtn = document.getElementById("muteBtn");

    if (!character || !stage || !characterImg || !characterFallback ||
        !patHand || !patHandSprite || !patHandSvg || !fxRing || !muteBtn) {
        window.TaoFX = { onTap() {}, onConnect() {}, onDisconnect() {} };
        return;
    }

    const reduceMotion = !!(window.matchMedia &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches);

    // ------------------------------------------------------
    // MUTE (persisted)
    // ------------------------------------------------------
    let muted = false;
    try { muted = localStorage.getItem("tao-muted") === "1"; } catch (_) { /* ignore */ }

    // ------------------------------------------------------
    // AUDIO (Web Audio API: low latency, polyphonic)
    // ------------------------------------------------------
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    const buffers = new Map();     // original file name -> AudioBuffer
    const lastPicked = {};
    const patVoices = [];          // currently playing pat sounds
    let ctx = null;
    let gain = null;
    let currentVoice = null;       // voice lines (milestone/hello/...): one at a time

    // Browsers without Ogg Vorbis support get the .mp3 twin of every .ogg file.
    const CAN_OGG = (() => {
        try {
            return document.createElement("audio")
                .canPlayType('audio/ogg; codecs="vorbis"') !== "";
        } catch (_) { return false; }
    })();

    function urlFor(file) {
        return AUDIO_DIR + (!CAN_OGG && file.endsWith(".ogg")
            ? file.replace(/\.ogg$/, ".mp3")
            : file);
    }

    if (AudioCtx) {
        ctx = new AudioCtx();      // starts "suspended", resumed on a user gesture
        gain = ctx.createGain();
        gain.gain.value = muted ? 0 : CONFIG.volume;
        gain.connect(ctx.destination);
        Object.values(CONFIG.audio).flat().forEach(loadAudio);
    }

    async function loadAudio(file) {
        try {
            const res = await fetch(urlFor(file));
            if (!res.ok) return;                       // missing file -> skip
            const data = await res.arrayBuffer();
            const buffer = await new Promise((resolve, reject) => {
                ctx.decodeAudioData(data, resolve, reject);   // callback form: works on old Safari too
            });
            buffers.set(file, buffer);
        } catch (_) { /* fetch/decode failed -> skip */ }
    }

    function unlockAudio() {
        if (ctx && ctx.state === "suspended") {
            ctx.resume().catch(() => {});
        }
    }

    ["pointerdown", "touchend", "click", "keydown"].forEach((type) => {
        window.addEventListener(type, unlockAudio, { passive: true });
    });

    // Uniformly random pick from the files that actually loaded.
    function pickBuffer(group) {
        const ready = CONFIG.audio[group].filter((file) => buffers.has(file));
        if (!ready.length) return null;

        let pool = ready;
        if (CONFIG.avoidImmediateRepeat && ready.length > 1) {
            pool = ready.filter((file) => file !== lastPicked[group]);
        }

        const file = pool[Math.floor(Math.random() * pool.length)];
        lastPicked[group] = file;
        return buffers.get(file);
    }

    // Pat sound: fires on EVERY tap, overlaps freely (capped), never gated by a cooldown.
    function playPat() {
        if (!ctx || muted) return;

        const buffer = pickBuffer("pat");
        if (!buffer) return;

        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(gain);
        source.onended = () => {
            const i = patVoices.indexOf(source);
            if (i !== -1) patVoices.splice(i, 1);
        };
        source.start();
        patVoices.push(source);

        while (patVoices.length > CONFIG.maxPatVoices) {
            try { patVoices.shift().stop(); } catch (_) { /* ignore */ }
        }
    }

    // Voice lines (milestone, hello, idle, lowHp, healed): one at a time.
    // interrupt: cut off the voice line that is playing.
    // passive: only play if audio is already running (idle / connection events).
    function playVoice(group, { interrupt = false, passive = false } = {}) {
        if (!ctx || muted) return false;
        if (passive && ctx.state !== "running") return false;
        if (currentVoice && !interrupt) return false;

        const buffer = pickBuffer(group);
        if (!buffer) return false;

        if (currentVoice) {
            try { currentVoice.stop(); } catch (_) { /* ignore */ }
        }

        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(gain);
        source.onended = () => {
            if (currentVoice === source) currentVoice = null;
        };
        source.start();
        currentVoice = source;
        return true;
    }

    // ------------------------------------------------------
    // IMAGES
    // ------------------------------------------------------
    const faces = {};

    function applyFace(name) {
        const src = faces[name] || faces.base;
        if (!src) {
            characterImg.hidden = true;
            characterFallback.hidden = false;
            return;
        }
        if (characterImg.getAttribute("src") !== src) {
            characterImg.setAttribute("src", src);
        }
        characterImg.hidden = false;
        characterFallback.hidden = true;
    }

    Object.entries(CONFIG.images).forEach(([name, file]) => {
        const probe = new Image();
        probe.onload = () => {
            faces[name] = IMG_DIR + file;
            if (name === "base") applyFace("base");
        };
        probe.src = IMG_DIR + file;     // missing file -> skip silently
    });

    // Sprite hand: horizontal strip of N equal frames, one frame shown at a time.
    let spriteReady = false;

    (() => {
        const { file, frames } = CONFIG.sprite;
        const probe = new Image();
        probe.onload = () => {
            const frameW = probe.naturalWidth / frames;
            patHand.style.setProperty("--hand-ar", `${frameW} / ${probe.naturalHeight}`);
            patHandSprite.style.backgroundImage = `url("${IMG_DIR + file}")`;
            patHandSprite.style.backgroundSize = `${frames * 100}% 100%`;
            patHandSprite.hidden = false;
            patHandSvg.hidden = true;
            spriteReady = true;
        };
        probe.src = IMG_DIR + file;
    })();

    // ------------------------------------------------------
    // PAT ANIMATION (Web Animations API: safe for very rapid taps)
    // ------------------------------------------------------
    let stageAnim = null;
    let handAnim = null;
    let spriteAnim = null;
    let handTimer = null;
    let faceTimer = null;

    // power: 1 = normal tap, 2 = milestone (stronger squash)
    function pat(power) {
        if (!reduceMotion) {
            const sx = 1 + 0.07 * power;
            const sy = 1 - 0.12 * power;

            // Character squash: deepest at ~40% so it lines up with the hand's lowest frames.
            if (stageAnim) stageAnim.cancel();
            stageAnim = stage.animate([
                { transform: "scale(1, 1)" },
                { transform: `scale(${sx}, ${sy})`, offset: 0.4 },
                { transform: `scale(${1 - 0.03 * power}, ${1 + 0.04 * power})`, offset: 0.72 },
                { transform: "scale(1, 1)" }
            ], { duration: CONFIG.patDurationMs, easing: "ease-out" });

            if (handAnim) handAnim.cancel();
            handAnim = patHand.animate([
                { transform: "translateY(-30%) rotate(-8deg)" },
                { transform: "translateY(14%) rotate(3deg)", offset: 0.4 },
                { transform: "translateY(-12%) rotate(-3deg)", offset: 0.72 },
                { transform: "translateY(-30%) rotate(-8deg)" }
            ], { duration: CONFIG.patDurationMs, easing: "ease-out" });

            // Sprite frames: 0 -> last, one step per frame, both ends included.
            if (spriteReady) {
                if (spriteAnim) spriteAnim.cancel();
                spriteAnim = patHandSprite.animate(
                    [{ backgroundPositionX: "0%" }, { backgroundPositionX: "100%" }],
                    { duration: CONFIG.patDurationMs, easing: `steps(${CONFIG.sprite.frames}, jump-none)` }
                );
            }
        }

        patHand.classList.add("is-visible");
        clearTimeout(handTimer);
        handTimer = setTimeout(() => patHand.classList.remove("is-visible"), CONFIG.handHoldMs);

        applyFace("happy");
        clearTimeout(faceTimer);
        faceTimer = setTimeout(() => applyFace("base"), CONFIG.happyHoldMs);
    }

    // ------------------------------------------------------
    // TAP
    // ------------------------------------------------------
    let hasInteracted = false;
    let greeted = false;
    let lastTapAt = performance.now();
    let lastIdleVoiceAt = 0;

    function isMilestone(total) {
        return CONFIG.milestones.includes(total) ||
            (total >= CONFIG.milestoneEvery && total % CONFIG.milestoneEvery === 0);
    }

    function showMilestone() {
        playVoice("milestone", { interrupt: true });
        pat(2);
        if (!reduceMotion) {
            fxRing.animate([
                { transform: "scale(0.6)", opacity: 0.9 },
                { transform: "scale(1.7)", opacity: 0 }
            ], { duration: CONFIG.ringMs, easing: "ease-out" });
        }
    }

    function onTap(totalTaps) {
        hasInteracted = true;
        lastTapAt = performance.now();
        unlockAudio();

        playPat();                                   // every tap, always

        if (isMilestone(totalTaps)) {
            showMilestone();
            return;
        }

        if (!greeted && playVoice("hello", { interrupt: true })) {
            greeted = true;
        }

        pat(1);
    }

    // ------------------------------------------------------
    // CONNECTION
    // ------------------------------------------------------
    let wasDisconnected = false;

    function onDisconnect() {
        wasDisconnected = true;
        character.classList.add("is-offline");
        playVoice("lowHp", { interrupt: true, passive: true });
    }

    function onConnect() {
        character.classList.remove("is-offline");
        if (!wasDisconnected) return;
        wasDisconnected = false;
        playVoice("healed", { interrupt: true, passive: true });
    }

    // ------------------------------------------------------
    // IDLE VOICE
    // ------------------------------------------------------
    setInterval(() => {
        if (!hasInteracted || document.visibilityState !== "visible") return;

        const now = performance.now();
        if (now - lastTapAt < CONFIG.idleAfterMs) return;
        if (now - lastIdleVoiceAt < CONFIG.idleVoiceCooldownMs) return;

        if (playVoice("idle", { passive: true })) lastIdleVoiceAt = now;
    }, 1000);

    // ------------------------------------------------------
    // MUTE BUTTON (icons are swapped by CSS via aria-pressed)
    // ------------------------------------------------------
    function renderMute() {
        muteBtn.setAttribute("aria-pressed", String(muted));
        muteBtn.setAttribute("aria-label", muted ? "Unmute" : "Mute");
    }

    muteBtn.addEventListener("click", () => {
        muted = !muted;
        try { localStorage.setItem("tao-muted", muted ? "1" : "0"); } catch (_) { /* ignore */ }

        if (gain) gain.gain.value = muted ? 0 : CONFIG.volume;
        if (muted) {
            if (currentVoice) { try { currentVoice.stop(); } catch (_) { /* ignore */ } }
            patVoices.splice(0).forEach((s) => { try { s.stop(); } catch (_) { /* ignore */ } });
        }
        renderMute();
        muteBtn.blur();
    });

    renderMute();

    window.TaoFX = {
        onTap,
        onConnect,
        onDisconnect,
        get lastPatFile() { return lastPicked.pat || null; }   // handy for manual testing
    };
})();
```

### A2. Patch `public/js/app.js`

Make these exact changes and nothing else.

**(a)** In the ELEMENTS block, remove `const stageElement = ...` and add:

```js
const characterElement = document.getElementById("character");
const statusElement = document.querySelector(".status");
```

**(b)** Replace the whole `TAP` section (the `tap()` function, the `stageElement` pointerdown listener, and the global `keydown` tap listener) with:

```js
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
```

Keep the `Escape` keydown listener at the bottom of the file (it closes the leaderboard).

**(c)** Connection handlers: replace the two handlers with:

```js
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
```

**(d)** Remove the `MEDALS` constant. In `updateRow`, replace the rank line with:

```js
row.querySelector(".lb-rank").textContent = String(index + 1).padStart(2, "0");
```

**(e)** In `setFlag`, replace the early-return branch and the image error handler with:

```js
const GLOBE = '<svg class="icon"><use href="#i-globe"></use></svg>';

// inside setFlag:
if (!isCountryCode(code)) {
    element.innerHTML = GLOBE;
    return;
}
// ...
img.addEventListener("error", () => {
    element.textContent = String(code).toUpperCase();
}, { once: true });
```

(Define `GLOBE` once near the top of the helpers section. The `fallbackEmoji` argument is now unused; leave the signature as is.)

**(f)** Copy: change the two strings that end in `taps/s` to end in `pats/s` (global rate in the `leaderboard` handler, and `.lb-pps` in `updateRow`). Internal variable names stay as they are.

### A3. Audio fallbacks for browsers without Ogg

If `ffmpeg` is available, create an `.mp3` twin next to each `.ogg`:

```bash
cd public/assets/audio
for f in pat pat1 pat2; do ffmpeg -y -i "$f.ogg" -codec:a libmp3lame -q:a 4 "$f.mp3"; done
```

If `ffmpeg` is not available, skip this and say so in your final report with the exact command for the user to run. The loader in `fx.js` already requests `.mp3` instead of `.ogg` when the browser cannot play Ogg.

---

## 6. Task B: redesign (art direction, follow it)

**Concept:** a funeral-parlor ledger and talisman-paper look, fitting Hu Tao. Flat ink-black background, aged-paper surfaces, one vermilion seal. Printed, tactile, slightly austere. Not glossy, not glowing.

**Palette (CSS custom properties, flat fills only, no gradients):**

| token | value | use |
|---|---|---|
| `--ink` | `#17110f` | page background |
| `--paper` | `#eee2c8` | text on ink, ledger surface |
| `--paper-2` | `#e0d0ae` | ruled lines, selected row |
| `--seal` | `#b7281c` | seal circle, hard shadows |
| `--seal-hi` | `#e0452f` | small accents on ink |
| `--ember` | `#e8832a` | focus ring, "connecting" state |
| `--ash` | `#8c7f6f` | secondary text on ink |
| `--ok` | `#7cae6a` | "live" state |

**Typography (self-host the files, no CDN at runtime):**
- Display (wordmark, counter, ledger heading): **Shippori Mincho B1**, weight 800.
- Labels and numerals: **IBM Plex Mono**, weights 400 and 600.
- Download the `.woff2` files (both are open-licensed Google Fonts) into `public/assets/fonts/` with these names: `ShipporiMinchoB1-ExtraBold.woff2`, `IBMPlexMono-Regular.woff2`, `IBMPlexMono-SemiBold.woff2`. If you cannot download them, leave the `@font-face` rules in place and ship with the fallback stacks; the page must still look deliberate. If the display font's digits are not tabular, render the big counter in the mono font instead.
- Banned: Inter, Nunito, Poppins, Space Grotesk, `ui-rounded`, and any rounded system stack.

**Anti-slop rules (checklist, all must hold):**
- No gradients, no glow, no `backdrop-filter`, no blurred background copy of the character.
- No `-webkit-text-stroke` outlined headline, no giant all-caps shouting title. The wordmark is small; the **counter** is the hero.
- No emoji. Icons are inline SVG (`#i-globe`, `#i-sound`, `#i-mute` below).
- Border radius 0 to 4px only, never pill-shaped. The only circles are the seal and the pat ring. The status dot is square on purpose.
- Hard offset shadows only (`3px 3px 0`), never blurred drop shadows.
- Asymmetric layout: wordmark and counter anchored left, controls top right, character centered on the seal.
- Spacing on an 8px scale. No more than one accent colour per component.
- No confetti, floating "+1" clutter, or sparkle effects. The only tap feedback is the pat animation, the sound, and the counter.

**Layout:**
- Mobile portrait (about 390 x 844): wordmark top-left, counter directly under it, character large and centered lower on the seal, ledger bar pinned at the bottom with safe-area padding.
- Desktop (>= 900px): counter vertically centered in a left column, character centered, ledger bar bottom center (max 960px).
- Landscape phones: `--char-size` is already `min(64vh, 86vw)`; make sure nothing overlaps the hit area.
- Disconnected: keep the existing gag (character desaturates and plays the low-HP voice) but desaturate instead of full grayscale, and show the state in the status label (`Live` / `Offline` / `Connecting`).

### B1. Replace `public/index.html`

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <meta name="theme-color" content="#17110f">
    <title>TaoPat</title>
    <link rel="stylesheet" href="/css/style.css">
</head>
<body>
    <svg class="sprite" aria-hidden="true" focusable="false">
        <symbol id="i-globe" viewBox="0 0 24 24">
            <g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round">
                <circle cx="12" cy="12" r="9"/>
                <path d="M3 12h18M12 3c3.2 3 3.2 15 0 18M12 3c-3.2 3-3.2 15 0 18"/>
            </g>
        </symbol>
        <symbol id="i-sound" viewBox="0 0 24 24">
            <g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5H4z"/>
                <path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>
            </g>
        </symbol>
        <symbol id="i-mute" viewBox="0 0 24 24">
            <g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5H4z"/>
                <path d="M16 9.5l5 5M21 9.5l-5 5"/>
            </g>
        </symbol>
    </svg>

    <main id="stage" class="stage">
        <div class="backdrop" aria-hidden="true"><div class="seal"></div></div>

        <header class="masthead">
            <h1 class="wordmark">Tao<span>Pat</span></h1>
            <p class="hint">Click or tap to pat</p>
        </header>

        <section class="tally" aria-label="Your pats">
            <p class="tally-label">Pats by you</p>
            <p class="tally-count"><span id="userTaps">0</span></p>
            <p class="tally-rate"><span id="userTPS">0</span> pats/s</p>
        </section>

        <!-- Only this element (and its children) counts as a tap target -->
        <div id="character" class="character" role="button" tabindex="0" aria-label="Pat the character">
            <div id="characterStage" class="character-stage">
                <img id="characterImg" class="character-img" alt="" draggable="false" hidden>
                <div id="characterFallback" class="character-fallback"><span>tao-base.png<br>not found</span></div>
            </div>

            <div id="fxRing" class="fx-ring"></div>

            <div id="patHand" class="pat-hand" aria-hidden="true">
                <div id="patHandSprite" class="pat-hand-sprite" hidden></div>
                <svg id="patHandSvg" viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg">
                    <g fill="#ffd9b8" stroke="#c98f6a" stroke-width="3" stroke-linejoin="round" stroke-linecap="round">
                        <rect x="20" y="34" width="16" height="44" rx="8" transform="rotate(22 28 34)"/>
                        <rect x="28" y="48" width="16" height="52" rx="8"/>
                        <rect x="48" y="48" width="16" height="62" rx="8"/>
                        <rect x="68" y="48" width="16" height="58" rx="8"/>
                        <rect x="88" y="48" width="16" height="46" rx="8"/>
                        <rect x="24" y="20" width="84" height="56" rx="22"/>
                    </g>
                </svg>
            </div>
        </div>
    </main>

    <div class="topbar">
        <div class="status" data-state="connecting">
            <span id="connectionDot" class="status-dot"></span>
            <span id="connectionText">Connecting</span>
        </div>

        <button id="muteBtn" class="icon-btn" type="button" aria-pressed="false" aria-label="Mute">
            <svg class="icon icon-sound"><use href="#i-sound"></use></svg>
            <svg class="icon icon-mute"><use href="#i-mute"></use></svg>
        </button>
    </div>

    <section id="board" class="board" data-open="false" aria-label="Leaderboard">
        <button id="boardToggle" class="board-bar" type="button" aria-expanded="false" aria-controls="boardPanel">
            <span class="bar-top">
                <span class="bar-rank">No. 1</span>
                <span id="topFlag" class="flag-slot"></span>
                <strong id="topTaps">-</strong>
            </span>

            <span class="bar-title">Leaderboard</span>

            <span class="bar-mine">
                <span class="bar-tag">You</span>
                <span id="myRegionFlag" class="flag-slot"><svg class="icon"><use href="#i-globe"></use></svg></span>
                <strong id="regionTaps">0</strong>
            </span>

            <span class="bar-chevron" aria-hidden="true"></span>
        </button>

        <div id="boardPanel" class="board-panel">
            <div class="lb-row lb-world">
                <span class="lb-rank"></span>
                <span class="lb-flag"><svg class="icon"><use href="#i-globe"></use></svg></span>
                <span class="lb-name">Worldwide</span>
                <span id="globalTPS" class="lb-pps" hidden></span>
                <strong id="globalTaps" class="lb-taps">0</strong>
            </div>

            <div id="leaderboard" class="lb-list">
                <div class="loading">Loading leaderboard...</div>
            </div>

            <div class="board-foot">
                Your region: <strong id="myRegion">Loading...</strong>
                &middot; <strong id="regionTPS">0</strong> pats/s
            </div>
        </div>
    </section>

    <script src="/socket.io/socket.io.js"></script>
    <script src="/js/fx.js"></script>
    <script src="/js/app.js"></script>
</body>
</html>
```

### B2. Replace `public/css/style.css`

```css
/* ======================================================
   TOKENS + BASE
====================================================== */

@font-face {
    font-family: "Shippori Mincho B1";
    src: url("/assets/fonts/ShipporiMinchoB1-ExtraBold.woff2") format("woff2");
    font-weight: 800;
    font-display: swap;
}
@font-face {
    font-family: "IBM Plex Mono";
    src: url("/assets/fonts/IBMPlexMono-Regular.woff2") format("woff2");
    font-weight: 400;
    font-display: swap;
}
@font-face {
    font-family: "IBM Plex Mono";
    src: url("/assets/fonts/IBMPlexMono-SemiBold.woff2") format("woff2");
    font-weight: 600;
    font-display: swap;
}

:root {
    --ink: #17110f;
    --paper: #eee2c8;
    --paper-2: #e0d0ae;
    --seal: #b7281c;
    --seal-hi: #e0452f;
    --ember: #e8832a;
    --ash: #8c7f6f;
    --ok: #7cae6a;

    --font-display: "Shippori Mincho B1", "Hiragino Mincho ProN", "Noto Serif", Georgia, serif;
    --font-mono: "IBM Plex Mono", ui-monospace, "Cascadia Mono", Consolas, monospace;

    --char-size: min(64vh, 86vw);
    --hand-width: 48%;      /* tune: hand size relative to the character */
    --hand-top: -16%;       /* tune: hand rest position relative to the character */
}

* { box-sizing: border-box; }

html, body {
    margin: 0;
    height: 100%;
    overflow: hidden;
    background: var(--ink);
    color: var(--paper);
    font-family: var(--font-mono);
}

body {
    -webkit-user-select: none;
    user-select: none;
    -webkit-tap-highlight-color: transparent;
    overscroll-behavior: none;
}

[hidden] { display: none !important; }
button { font: inherit; color: inherit; }
p { margin: 0; }

.sprite { position: absolute; width: 0; height: 0; overflow: hidden; }
.icon { display: block; width: 1.25em; height: 1.25em; }

/* ======================================================
   STAGE + BACKDROP
====================================================== */

.stage {
    position: fixed;
    inset: 0;
    overflow: hidden;
    touch-action: none;
}

.backdrop {
    position: absolute;
    inset: 0;
    background: var(--ink);
}

/* paper grain: a single tiled SVG noise, very faint */
.backdrop::after {
    content: "";
    position: absolute;
    inset: 0;
    opacity: .07;
    background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.8' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 1  0 0 0 0 .95  0 0 0 0 .85  0 0 0 .6 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>");
}

.seal {
    position: absolute;
    left: 50%;
    top: 58%;
    width: calc(var(--char-size) * .92);
    aspect-ratio: 1;
    transform: translate(-50%, -50%);
    border-radius: 50%;
    background: var(--seal);
    box-shadow: 0 0 0 10px var(--ink), 0 0 0 12px var(--seal);
}

/* ======================================================
   MASTHEAD + TALLY
====================================================== */

.masthead {
    position: absolute;
    z-index: 3;
    top: max(16px, env(safe-area-inset-top));
    left: 20px;
    pointer-events: none;
}

.wordmark {
    margin: 0;
    font: 800 clamp(26px, 3.2vw, 40px) / 1 var(--font-display);
    letter-spacing: -.01em;
}

.wordmark span { color: var(--seal-hi); }

.hint {
    margin-top: 8px;
    font-size: 12px;
    letter-spacing: .08em;
    text-transform: uppercase;
    color: var(--ash);
    transition: opacity .4s ease;
}

body.has-tapped .hint { opacity: 0; }

.tally {
    position: absolute;
    z-index: 3;
    left: 20px;
    top: calc(max(16px, env(safe-area-inset-top)) + 84px);
    pointer-events: none;
}

.tally-label {
    margin-bottom: 4px;
    font-size: 12px;
    letter-spacing: .08em;
    text-transform: uppercase;
    color: var(--ash);
}

.tally-count {
    font: 800 clamp(56px, 11vw, 132px) / .9 var(--font-display);
    font-variant-numeric: tabular-nums;
}

.tally-rate {
    margin-top: 8px;
    font-size: 13px;
    color: var(--ash);
}

@media (min-width: 900px) {
    .tally {
        top: 50%;
        transform: translateY(-62%);
    }
}

/* ======================================================
   CHARACTER, PAT HAND, RING
====================================================== */

.character {
    position: absolute;
    z-index: 2;
    left: 50%;
    top: 58%;
    width: var(--char-size);
    height: var(--char-size);
    transform: translate(-50%, -50%);
    pointer-events: none;      /* only .character-stage is the hit target */
    outline: none;
}

.character-stage {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
    transform-origin: 50% 92%;
    animation: idleBob 3.2s ease-in-out infinite;
    pointer-events: auto;
    cursor: pointer;
    touch-action: manipulation;
}

.character:focus-visible .character-stage {
    outline: 2px dashed var(--ember);
    outline-offset: 6px;
}

.character-img {
    width: 100%;
    height: 100%;
    object-fit: contain;
    -webkit-user-drag: none;
    filter: drop-shadow(6px 8px 0 rgba(0, 0, 0, .35));
}

.character-fallback {
    display: grid;
    place-items: center;
    width: 70%;
    height: 70%;
    border: 2px dashed var(--ash);
    color: var(--ash);
    font-size: 13px;
    text-align: center;
}

.pat-hand {
    position: absolute;
    z-index: 2;
    top: var(--hand-top);
    left: 0;
    right: 0;
    margin: 0 auto;
    width: var(--hand-width);
    aspect-ratio: var(--hand-ar, 1 / 1);   /* set by fx.js from the real sprite size */
    opacity: 0;
    transform: translateY(-30%) rotate(-8deg);
    transform-origin: 50% 20%;
    transition: opacity .12s ease;
    pointer-events: none;
}

.pat-hand.is-visible { opacity: 1; }

.pat-hand-sprite {
    width: 100%;
    height: 100%;
    background-repeat: no-repeat;
    background-position: 0 0;
}

.pat-hand svg {
    display: block;
    width: 100%;
    height: 100%;
}

.fx-ring {
    position: absolute;
    inset: 0;
    border-radius: 50%;
    border: 3px solid var(--paper);
    opacity: 0;
    pointer-events: none;
}

.character.is-offline { filter: saturate(.2) brightness(.8); }

@keyframes idleBob {
    0%, 100% { transform: translateY(0); }
    50%      { transform: translateY(-2%); }
}

/* ======================================================
   TOP BAR
====================================================== */

.topbar {
    position: fixed;
    z-index: 5;
    top: max(14px, env(safe-area-inset-top));
    right: 20px;
    display: flex;
    align-items: center;
    gap: 14px;
    pointer-events: none;
}

.topbar > * { pointer-events: auto; }

.status {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    letter-spacing: .08em;
    text-transform: uppercase;
    color: var(--ash);
}

.status-dot {
    width: 8px;
    height: 8px;
    background: var(--ember);          /* square on purpose */
}

.status[data-state="live"] .status-dot    { background: var(--ok); }
.status[data-state="offline"] .status-dot { background: var(--seal-hi); }

.icon-btn {
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    padding: 0;
    border: 2px solid var(--paper);
    border-radius: 2px;
    background: var(--ink);
    box-shadow: 3px 3px 0 var(--seal);
    cursor: pointer;
}

.icon-btn:active {
    transform: translate(2px, 2px);
    box-shadow: 1px 1px 0 var(--seal);
}

.icon-btn:focus-visible {
    outline: 2px solid var(--ember);
    outline-offset: 3px;
}

.icon-mute { display: none; }
.icon-btn[aria-pressed="true"] .icon-sound { display: none; }
.icon-btn[aria-pressed="true"] .icon-mute  { display: block; }

/* ======================================================
   LEADERBOARD (ledger sheet)
====================================================== */

.board {
    position: fixed;
    z-index: 8;
    left: 50%;
    bottom: 0;
    width: min(960px, 100vw);
    transform: translateX(-50%);
    padding-bottom: env(safe-area-inset-bottom);
    border: 2px solid var(--ink);
    border-bottom: 0;
    border-radius: 4px 4px 0 0;
    background: var(--paper);
    color: var(--ink);
    box-shadow: 0 -4px 0 var(--seal);
}

.board-bar {
    display: flex;
    align-items: center;
    gap: 16px;
    width: 100%;
    height: 56px;
    padding: 0 18px;
    border: 0;
    background: transparent;
    text-align: left;
    cursor: pointer;
}

.bar-top,
.bar-mine {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-size: clamp(13px, 3.4vw, 16px);
    white-space: nowrap;
}

.bar-top strong,
.bar-mine strong {
    font-weight: 600;
    font-variant-numeric: tabular-nums;
}

.bar-rank,
.bar-tag {
    font-size: 11px;
    letter-spacing: .08em;
    text-transform: uppercase;
    color: #6b5d4a;
}

.bar-mine { margin-left: auto; }

.bar-title {
    display: none;
    flex: 1;
    font: 800 20px / 1 var(--font-display);
}

.bar-chevron {
    width: 0;
    height: 0;
    border-left: 6px solid transparent;
    border-right: 6px solid transparent;
    border-bottom: 8px solid var(--ink);
    transition: transform .2s ease;
}

.board[data-open="true"] .bar-top,
.board[data-open="true"] .bar-mine { display: none; }
.board[data-open="true"] .bar-title { display: block; }
.board[data-open="true"] .bar-chevron { transform: rotate(180deg); }

.board-panel {
    max-height: 0;
    overflow: hidden;
    transition: max-height .28s ease;
}

.board[data-open="true"] .board-panel {
    max-height: min(64vh, 600px);
    overflow-y: auto;
    touch-action: pan-y;
    overscroll-behavior: contain;
}

.lb-row {
    display: grid;
    grid-template-columns: 40px 32px 1fr auto auto;
    align-items: center;
    gap: 10px;
    padding: 11px 18px;
    border-top: 1px solid var(--paper-2);
    font-size: 15px;
}

.lb-world { border-top: 2px solid var(--ink); }

.lb-rank {
    grid-column: 1;
    font-size: 12px;
    color: #6b5d4a;
}

.lb-flag {
    grid-column: 2;
    display: grid;
    place-items: center;
}

.lb-name {
    grid-column: 3;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.lb-pps {
    grid-column: 4;
    font-size: 11px;
    color: #2f6b34;
    white-space: nowrap;
}

.lb-taps {
    grid-column: 5;
    text-align: right;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
}

.lb-row.is-mine {
    background: var(--paper-2);
    box-shadow: inset 4px 0 0 var(--seal);
}

.flag-slot {
    display: inline-grid;
    place-items: center;
    min-width: 28px;
    font-size: 11px;
}

.flag-img {
    display: block;
    width: 28px;
    height: 20px;
    object-fit: cover;
    border-radius: 2px;
    box-shadow: 0 0 0 1px rgba(0, 0, 0, .25);
}

.board-foot {
    padding: 12px 18px 18px;
    border-top: 1px solid var(--paper-2);
    font-size: 12px;
    color: #6b5d4a;
}

.loading {
    padding: 20px;
    text-align: center;
    color: #6b5d4a;
}

/* ======================================================
   REDUCED MOTION
====================================================== */

@media (prefers-reduced-motion: reduce) {
    .character-stage { animation: none; }
    .board-panel,
    .bar-chevron,
    .hint { transition: none; }
}
```

### B3. Small housekeeping

- `package.json`: change `"name"` to `"taopat"`. Do not change the database filename (`tapgame.db`) or any Socket.IO event name.
- Add a short `README.md` (run instructions: `npm install`, `npm start`, open `http://localhost:3000`) with a credits line for the `patpat.png` texture and pat sounds taken from LopyMine/PatPat. Check that repository's license and state it accurately; if you cannot verify it, write "check license" rather than guessing.

---

## 7. Acceptance criteria

Verify each item. Use a headless browser (Playwright or Puppeteer) if one is available; otherwise reason carefully from the code and say which items you could not run.

1. `npm start` boots; the page loads with **zero console errors** (missing optional files such as `hello-*.mp3` must not log errors you introduced).
2. Clicking or tapping **outside the character** does nothing: no count, no sound. Pressing random keys does nothing. Focusing the character with Tab and pressing Space or Enter pats it.
3. Each click on the character increments the counter by exactly 1 and starts exactly one pat sound. Rapid clicking (10+ per second) still triggers a sound per click (up to `maxPatVoices` overlapping).
4. Randomness: stub `Math.random` or call the picker 300 times in a test; all of `pat.ogg`, `pat1.ogg`, `pat2.ogg` appear, there is no repeating cycle such as 0,1,2,0,1,2, and (with `avoidImmediateRepeat`) no file appears twice in a row.
5. Touch: with device emulation (an iPhone-sized and a Pixel-sized viewport), a tap on the character plays sound after the first gesture, two-finger tapping gives two pats, long-press shows no context menu, no double-tap zoom.
6. Sprite: all 5 frames of `patpat.png` are shown in order during one pat; the hand's aspect ratio is derived from the real image (`naturalWidth / 5`); no stretched or cropped frames. If the hand appears mirrored, wrongly placed, or covers the face, tune `--hand-top`, `--hand-width`, or add `scaleX(-1)`; take a screenshot to check.
7. Muting silences both pat sounds and voice lines immediately and persists across reload.
8. Disconnected state (stop the server): taps still count locally and still play sound; the status label reads `Offline`; the character is desaturated, not fully gray.
9. Design checklist from section 6 passes: no gradient, no emoji, no blur, no text stroke, no pill shapes, hard shadows only. Take screenshots at 390x844, 768x1024, and 1920x1080 and review them against that checklist. The ledger sheet opens and closes, and rows show `01`, `02`, ... instead of medal emoji.
10. `prefers-reduced-motion: reduce` disables the squash, hand, and idle bob (sound still plays).

---

## 8. Final report

When finished, reply with:
- the list of files changed or added;
- which acceptance items you verified and how, and which you could not verify;
- whether `.mp3` fallbacks were created and whether the display fonts were downloaded or fell back to system stacks;
- every assumption you made.
