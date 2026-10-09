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
    const fxRing = document.getElementById("fxRing");
    const muteBtn = document.getElementById("muteBtn");

    if (!character || !stage || !characterImg || !characterFallback ||
        !patHand || !patHandSprite || !fxRing || !muteBtn) {
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
                "muted: " + muted + "\n" +
                "last pat: " + (lastPicked.pat || "-") + "\n" +
                "errors: " + (audioErrors.slice(-4).join(" | ") || "-");
        }, 400);
    }

    window.TaoFX = {
        onTap,
        onConnect,
        onDisconnect,
        get lastPatFile() { return lastPicked.pat || null; }   // handy for manual testing
    };
})();