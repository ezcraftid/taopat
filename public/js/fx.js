// public/js/fx.js
// Pat effect (sprite hand + squash & stretch) and audio for the character.
// Fail-safe: assets that do not exist are ignored without errors.
(() => {
    "use strict";

    const IMG_DIR = "/assets/img/";
    const AUDIO_DIR = "/assets/audio/";

    const CONFIG = {
        // Every face except "base" is optional: a missing file falls back to a simpler one.
        images: {
            base: "tao-base.png",
            happy: "tao-happy.png",           // while being patted
            combo: "tao-combo.png",           // combo tier 2 and up
            milestone: "tao-milestone.png",   // milestone moments
            offline: "tao-offline.png",       // while the server is unreachable
            sleepy: "tao-sleepy.png"          // after a long idle
        },
        faceFallback: { happy: "base", combo: "happy", milestone: "happy", offline: "base", sleepy: "base" },
        sprite: { file: "patpat.png", frames: 5 },   // horizontal strip, 5 equal frames
        // Every group is optional too. Missing files are skipped without errors.
        audio: {
            pat: ["pat.ogg", "pat1.ogg", "pat2.ogg"],                        // every tap, always
            milestone: ["milestone-01.mp3", "milestone-02.mp3", "milestone-03.mp3"],
            hello: ["hello-01.mp3"],                                         // first tap of a visit
            idle: ["idle-01.mp3", "idle-02.mp3", "idle-03.mp3"],             // after a pause
            combo: ["combo-01.mp3", "combo-02.mp3", "combo-03.mp3",
                    "combo-04.mp3", "combo-05.mp3", "combo-06.mp3"],         // combo tier 1 and 2
            hype: ["hype-01.mp3", "hype-02.mp3", "hype-03.mp3"],             // combo tier 3 and 4
            gift: ["gift-01.mp3", "gift-02.mp3", "gift-03.mp3"],             // a new stamp is earned
            stamp: ["stamp-01.mp3", "stamp-02.mp3"],                         // sound effect when a stamp lands
            lowHp: ["lowhp-01.mp3"],                                         // connection lost
            healed: ["healed-01.mp3"]                                        // connection back
        },
        milestones: [100, 500, 1000, 2500, 5000],        // then every multiple of milestoneEvery
        milestoneEvery: 10000,
        volume: 0.85,
        stampGain: 1.2,               // stamp sound effect loudness (1 = same as pats)
        avoidImmediateRepeat: true,   // still random; just never the same file twice in a row
        maxPatVoices: 6,              // polyphony cap for overlapping pat sounds
        patDurationMs: 260,           // one pat = all sprite frames, once
        handHoldMs: 320,
        happyHoldMs: 320,
        comboFaceHoldMs: 700,
        milestoneFaceHoldMs: 1400,
        ringMs: 800,
        sleepyAfterMs: 30000,         // idle time before the sleepy face
        idleAfterMs: 20000,           // idle time before an idle voice line
        idleVoiceCooldownMs: 45000
    };

    const character = document.getElementById("character");
    const stage = document.getElementById("characterStage");
    const characterImg = document.getElementById("characterImg");
    const characterFallback = document.getElementById("characterFallback");
    const patHand = document.getElementById("patHand");
    const patHandSprite = document.getElementById("patHandSprite");
    const fxRing = document.getElementById("fxRing");
    const muteBtn = document.getElementById("muteBtn");
    const fxLayer = document.getElementById("fxLayer");      // optional: ink flecks and ghosts

    if (!character || !stage || !characterImg || !characterFallback ||
        !patHand || !patHandSprite || !fxRing || !muteBtn) {
        window.TaoFX = { onTap() {}, onConnect() {}, onDisconnect() {}, onComboEnd() {}, onGift() {}, onStampShow() {} };
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
    const audioErrors = [];        // shown in the ?debug panel
    let ctx = null;
    let gain = null;
    let currentVoice = null;       // voice lines (milestone/hello/...): one at a time

    const IS_IOS = /iP(hone|ad|od)/.test(navigator.userAgent) ||
        (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

    // iOS 16.4+: tell Safari this page is "playback" audio so the hardware
    // silent switch does NOT mute Web Audio. Without this, iPhones on silent
    // hear nothing at all.
    function setAudioSessionPlayback() {
        try {
            if (navigator.audioSession) navigator.audioSession.type = "playback";
        } catch (_) { /* ignore */ }
    }
    setAudioSessionPlayback();

    // Older iOS: looping a silent <audio> element flips the audio session to
    // "playback" too. Started from the first real gesture.
    const SILENT_WAV = "data:audio/wav;base64,UklGRkQDAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YSADAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgA==";
    let silentEl = null;

    function startSilentElement() {
        if (!IS_IOS || silentEl) return;
        try {
            silentEl = document.createElement("audio");
            silentEl.src = SILENT_WAV;
            silentEl.loop = true;
            silentEl.preload = "auto";
            silentEl.setAttribute("playsinline", "");
            silentEl.setAttribute("x-webkit-airplay", "deny");
            silentEl.volume = 0.01;
            const p = silentEl.play();
            if (p && p.catch) p.catch((e) => { audioErrors.push("silent: " + e.name); silentEl = null; });
        } catch (e) { audioErrors.push("silent: " + e.message); silentEl = null; }
    }

    // Browsers without Ogg Vorbis support get the .mp3 twin of every .ogg file.
    const CAN_OGG = (() => {
        try {
            return document.createElement("audio")
                .canPlayType('audio/ogg; codecs="vorbis"') !== "";
        } catch (_) { return false; }
    })();

    function urlFor(file, forceMp3) {
        const useMp3 = file.endsWith(".ogg") && (forceMp3 || !CAN_OGG);
        return AUDIO_DIR + (useMp3 ? file.replace(/\.ogg$/, ".mp3") : file);
    }

    function decode(data) {
        // callback form: works on old Safari too
        return new Promise((resolve, reject) => {
            const p = ctx.decodeAudioData(data, resolve, reject);
            if (p && p.catch) p.catch(reject);
        });
    }

    async function fetchAndDecode(url) {
        const res = await fetch(url);
        if (!res.ok) throw new Error(res.status + " " + url);
        return decode(await res.arrayBuffer());
    }

    if (AudioCtx) {
        try {
            ctx = new AudioCtx();      // starts "suspended", resumed on a user gesture
            gain = ctx.createGain();
            gain.gain.value = muted ? 0 : CONFIG.volume;
            gain.connect(ctx.destination);
            Object.values(CONFIG.audio).flat().forEach(loadAudio);
        } catch (e) {
            audioErrors.push("ctx: " + e.message);
            ctx = null;
        }
    }

    async function loadAudio(file) {
        try {
            buffers.set(file, await fetchAndDecode(urlFor(file, false)));
            return;
        } catch (e) {
            // missing optional file (404) -> skip silently; decode failure on .ogg -> retry as .mp3
            if (!/^404/.test(String(e.message)) && file.endsWith(".ogg") && CAN_OGG) {
                try { buffers.set(file, await fetchAndDecode(urlFor(file, true))); return; }
                catch (e2) { audioErrors.push(file + ": " + (e2.message || e2.name)); return; }
            }
            if (!/^404/.test(String(e.message))) audioErrors.push(file + ": " + (e.message || e.name));
        }
    }

    let silentBufferPlayed = false;

    function unlockAudio() {
        setAudioSessionPlayback();
        startSilentElement();
        if (!ctx) return;

        // "interrupted" is an iOS-only state (phone call, tab switch), so test for !== running
        if (ctx.state !== "running") {
            try { ctx.resume().catch(() => {}); } catch (_) { /* ignore */ }
        }

        // Classic iOS unlock: play a 1-sample silent buffer inside the gesture
        if (!silentBufferPlayed) {
            try {
                const b = ctx.createBuffer(1, 1, 22050);
                const s = ctx.createBufferSource();
                s.buffer = b;
                s.connect(ctx.destination);
                s.start(0);
                silentBufferPlayed = true;
            } catch (_) { /* ignore */ }
        }
    }

    // iOS only accepts some events as "user activation" for audio: touchend / click
    // always work, pointerdown/touchstart do not on every version. Listen to all.
    ["pointerdown", "pointerup", "touchstart", "touchend", "click", "keydown"].forEach((type) => {
        window.addEventListener(type, unlockAudio, { passive: true, capture: true });
    });

    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible" && ctx && ctx.state !== "running") {
            try { ctx.resume().catch(() => {}); } catch (_) { /* ignore */ }
        }
    });

    // Uniformly random pick from the files that actually loaded.
    function pickBuffer(group) {
        const ready = (CONFIG.audio[group] || []).filter((file) => buffers.has(file));
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

    // Stamp sound effect: a one-shot that never cuts a voice line.
    let lastStampAt = 0;
    function playStamp() {
        if (!ctx || muted) return;
        const now = performance.now();
        if (now - lastStampAt < 150) return;   // never stack two stamp sounds on top of each other
        lastStampAt = now;
        const buffer = pickBuffer("stamp");
        if (!buffer) return;
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        const boost = ctx.createGain();
        boost.gain.value = CONFIG.stampGain;
        source.connect(boost);
        boost.connect(gain);
        source.start();
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
    // FACES (each one optional: a missing file falls back to a simpler face)
    // ------------------------------------------------------
    const faces = {};             // name -> url, only for files that loaded
    let faceMode = "base";        // resting face: base / sleepy / offline
    let faceFlash = null;         // short-lived face: happy / combo / milestone
    let faceTimer = null;
    let currentFace = "-";
    let offline = false;

    function resolveFace(name) {
        let n = name;
        for (let i = 0; i < 4 && n && !faces[n]; i++) n = CONFIG.faceFallback[n];
        return n && faces[n] ? n : "base";
    }

    function renderFace() {
        const shown = resolveFace(faceFlash || faceMode);
        const src = faces[shown];

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
        currentFace = shown;
    }

    function setFaceMode(mode) {
        faceMode = mode;
        renderFace();
    }

    function flashFace(name, ms) {
        faceFlash = name;
        renderFace();
        clearTimeout(faceTimer);
        faceTimer = setTimeout(() => { faceFlash = null; renderFace(); }, ms);
    }

    Object.entries(CONFIG.images).forEach(([name, file]) => {
        const probe = new Image();
        probe.onload = () => {
            faces[name] = IMG_DIR + file;
            renderFace();
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

    // power: 1 = normal tap, up to 2 = milestone (stronger squash)
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
    }

    // ------------------------------------------------------
    // INK EFFECTS: flecks and paper ghosts (hard-edged, no glow, no blur).
    // Capped, and skipped entirely under prefers-reduced-motion.
    // ------------------------------------------------------
    const MAX_FLECKS = 28;
    const MAX_GHOSTS = 4;
    let flecksAlive = 0;
    let ghostsAlive = 0;

    const GHOST_SVG =
        '<svg viewBox="0 0 24 28" aria-hidden="true">' +
        '<path d="M12 1.5C6.8 1.5 3 5.4 3 10.6V26l3-2.4 3 2.4 3-2.4 3 2.4 3-2.4 3 2.4V10.6C21 5.4 17.2 1.5 12 1.5z"/>' +
        '<circle cx="9" cy="11" r="1.6"/><circle cx="15" cy="11" r="1.6"/></svg>';

    function spawnFlecks(count) {
        if (!fxLayer || reduceMotion) return;
        const unit = Math.max(character.clientWidth, 240) / 400;

        for (let i = 0; i < count && flecksAlive < MAX_FLECKS; i++) {
            const el = document.createElement("i");
            const color = Math.random() < 0.5 ? 0 : (Math.random() < 0.6 ? 1 : 2);
            el.className = "fleck c" + color + " s" + Math.floor(Math.random() * 3);
            fxLayer.appendChild(el);
            flecksAlive++;

            const dx = (Math.random() < 0.5 ? -1 : 1) * (30 + Math.random() * 110) * unit;
            const up = -(20 + Math.random() * 55) * unit;
            const fall = (50 + Math.random() * 70) * unit;
            const spin = (Math.random() * 2 - 1) * 260;

            const anim = el.animate([
                { transform: "translate(-50%, -50%) rotate(0deg)", opacity: 1 },
                { transform: `translate(calc(-50% + ${dx * 0.6}px), calc(-50% + ${up}px)) rotate(${spin / 2}deg)`,
                  opacity: 1, offset: 0.4 },
                { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${fall}px)) rotate(${spin}deg)`, opacity: 0 }
            ], { duration: 380 + Math.random() * 260, easing: "cubic-bezier(.2,.7,.4,1)" });

            let gone = false;
            const done = () => {
                if (gone) return;
                gone = true;
                el.remove();
                flecksAlive--;
            };
            anim.onfinish = done;
            anim.oncancel = done;
        }
    }

    function spawnGhosts(count) {
        if (!fxLayer || reduceMotion) return;
        const rise = character.clientHeight * 0.75;
        const unit = Math.max(character.clientWidth, 240) / 400;

        for (let i = 0; i < count && ghostsAlive < MAX_GHOSTS; i++) {
            const el = document.createElement("div");
            el.className = "ghost";
            el.innerHTML = GHOST_SVG;
            el.style.left = (22 + Math.random() * 56) + "%";
            fxLayer.appendChild(el);
            ghostsAlive++;

            const sway = (Math.random() < 0.5 ? -1 : 1) * (14 + Math.random() * 18) * unit;
            const anim = el.animate([
                { transform: "translate(-50%, 0) scale(.7)", opacity: 0 },
                { transform: `translate(calc(-50% + ${sway}px), ${-rise * 0.25}px) scale(1)`, opacity: 1, offset: 0.18 },
                { transform: `translate(calc(-50% - ${sway}px), ${-rise * 0.6}px) scale(1)`, opacity: 1, offset: 0.6 },
                { transform: `translate(-50%, ${-rise}px) scale(.95)`, opacity: 0 }
            ], { duration: 1500, delay: i * 110, easing: "ease-out", fill: "backwards" });

            let gone = false;
            const done = () => {
                if (gone) return;
                gone = true;
                el.remove();
                ghostsAlive--;
            };
            anim.onfinish = done;
            anim.oncancel = done;
        }
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

    function pulseRing() {
        if (reduceMotion) return;
        fxRing.animate([
            { transform: "scale(0.6)", opacity: 0.9 },
            { transform: "scale(1.7)", opacity: 0 }
        ], { duration: CONFIG.ringMs, easing: "ease-out" });
    }

    const NO_GAME = { combo: 0, tier: 0, tierUp: false, rate: 0, unlocked: [] };

    function onTap(totalTaps) {
        hasInteracted = true;
        lastTapAt = performance.now();
        unlockAudio();

        // Wake up from the sleepy face.
        if (faceMode === "sleepy") setFaceMode(offline ? "offline" : "base");

        playPat();                                   // every tap, always

        // Combo / stats / stamps live in game.js; fx.js only reacts to the result.
        let game = NO_GAME;
        try { if (window.TaoGame) game = window.TaoGame.onTap(totalTaps) || NO_GAME; }
        catch (_) { game = NO_GAME; }

        const milestone = isMilestone(totalTaps);
        const tier = game.tier || 0;

        // One voice line at most per tap, highest priority first. A group with no
        // files is skipped, so the next candidate gets its chance.
        const candidates = [];
        if (milestone) candidates.push("milestone");
        if (!greeted) candidates.push("hello");
        if (game.unlocked && game.unlocked.length) candidates.push("gift");
        if (game.tierUp) candidates.push(tier >= 3 ? "hype" : "combo");

        for (const group of candidates) {
            if (playVoice(group, { interrupt: true })) {
                if (group === "hello") greeted = true;
                break;
            }
        }

        let power = 1 + Math.min(tier, 3) * 0.12;
        let face = tier >= 2 ? "combo" : "happy";
        let faceMs = tier >= 2 ? CONFIG.comboFaceHoldMs : CONFIG.happyHoldMs;
        let flecks = (game.rate || 0) >= 10 ? 2 : 4;

        if (milestone) {
            power = 2;
            face = "milestone";
            faceMs = CONFIG.milestoneFaceHoldMs;
            flecks += 6;
            pulseRing();
        }

        if (game.tierUp) {
            flecks += 4;
            spawnGhosts(Math.min(tier, 3));
        }

        pat(power);
        flashFace(face, faceMs);
        spawnFlecks(flecks);
    }

    // game.js calls this when the server confirms a new stamp.
    function onGift() {
        playVoice("gift", { interrupt: true });
    }

    // game.js calls this when the combo times out.
    function onComboEnd() {
        if (faceFlash === "combo") {
            clearTimeout(faceTimer);
            faceFlash = null;
            renderFace();
        }
    }

    // ------------------------------------------------------
    // CONNECTION
    // ------------------------------------------------------
    let wasDisconnected = false;

    function onDisconnect() {
        wasDisconnected = true;
        offline = true;
        character.classList.add("is-offline");
        setFaceMode("offline");
        playVoice("lowHp", { interrupt: true, passive: true });
    }

    function onConnect() {
        offline = false;
        character.classList.remove("is-offline");
        setFaceMode("base");
        if (!wasDisconnected) return;
        wasDisconnected = false;
        playVoice("healed", { interrupt: true, passive: true });
    }

    // ------------------------------------------------------
    // IDLE (sleepy face, then an idle voice line)
    // ------------------------------------------------------
    setInterval(() => {
        if (document.visibilityState !== "visible") return;

        const now = performance.now();
        const idleFor = now - lastTapAt;

        if (idleFor >= CONFIG.sleepyAfterMs && faceMode === "base" && !offline) {
            setFaceMode("sleepy");
        }

        if (!hasInteracted) return;
        if (idleFor < CONFIG.idleAfterMs) return;
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

    // ------------------------------------------------------
    // ?debug panel: open the site as /?debug on the iPhone to see what is wrong
    // ------------------------------------------------------
    if (/[?&]debug\b/.test(location.search)) {
        const box = document.createElement("pre");
        box.style.cssText = "position:fixed;left:8px;top:8px;z-index:99;margin:0;padding:8px;" +
            "background:#000c;color:#9f9;font:11px/1.35 monospace;max-width:92vw;" +
            "white-space:pre-wrap;pointer-events:none";
        document.body.appendChild(box);
        const total = Object.values(CONFIG.audio).flat().length;
        setInterval(() => {
            box.textContent =
                "ctx: " + (ctx ? ctx.state : "none") + "\n" +
                "ios: " + IS_IOS + "  ogg: " + CAN_OGG + "\n" +
                "audioSession: " + (navigator.audioSession ? navigator.audioSession.type : "n/a") + "\n" +
                "buffers: " + buffers.size + "/" + total + "  (pat: " +
                    CONFIG.audio.pat.filter((f) => buffers.has(f)).length + "/3)\n" +
                "muted: " + muted + "  face: " + currentFace + "\n" +
                "faces: " + (Object.keys(faces).join(",") || "-") + "\n" +
                "game: " + (window.TaoGame ? ("combo " + window.TaoGame.combo + " tier " + window.TaoGame.tier) : "none") + "\n" +
                "last pat: " + (lastPicked.pat || "-") + "\n" +
                "errors: " + (audioErrors.slice(-4).join(" | ") || "-");
        }, 400);
    }

    window.TaoFX = {
        onTap,
        onConnect,
        onDisconnect,
        onComboEnd,
        onGift,
        onStampShow: playStamp,   // called by game.js when a stamp appears on screen
        get lastPatFile() { return lastPicked.pat || null; }   // handy for manual testing
    };
})();