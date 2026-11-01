// public/js/music.js
// Three-track background music with its own mute toggle, independent from the
// game SFX/voice mute in fx.js. Tracks are optional: missing files are skipped
// without spamming the console. Playback only starts after a user gesture.
(() => {
    "use strict";

    // Owner-supplied assets, stored relative to the document (portable across
    // roots/subdirectories). Place the files at exactly these paths.
    const asset = (path) => (window.TaoCore && window.TaoCore.assetUrl
        ? window.TaoCore.assetUrl(path) : path);

    const TRACKS = [
        { file: "assets/audio/music-01.mp3", title: "Music 01" },
        { file: "assets/audio/music-02.mp3", title: "Music 02" },
        { file: "assets/audio/music-03.mp3", title: "Music 03" }
    ];

    const STORAGE_KEY = "tao-music-muted";
    const VOLUME = 0.15;
    const TOAST_MS = 2600;

    const btn = document.getElementById("musicBtn");
    const toast = document.getElementById("musicToast");
    const toastTitle = document.getElementById("musicToastTitle");

    let muted = false;
    try { muted = localStorage.getItem(STORAGE_KEY) === "1"; } catch (_) { /* ignore */ }

    const audio = new Audio();
    audio.preload = "none";
    audio.volume = VOLUME;

    let started = false;
    let current = -1;
    const failed = new Set();     // indices whose file is missing/undecodable
    const warned = new Set();     // warn once per broken track (no console floods)
    let toastTimer = null;

    function pickIndex() {
        const available = [];
        for (let i = 0; i < TRACKS.length; i++) {
            if (!failed.has(i)) available.push(i);
        }
        if (!available.length) return -1;

        let pool = available;
        if (available.length > 1 && current !== -1) {
            pool = available.filter((i) => i !== current);
        }
        return pool[Math.floor(Math.random() * pool.length)];
    }

    function showToast(title) {
        if (!toast || !toastTitle) return;
        toastTitle.textContent = title;
        toast.hidden = false;
        // Let the browser paint the hidden element before animating opacity.
        requestAnimationFrame(() => toast.classList.add("is-shown"));
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => {
            toast.classList.remove("is-shown");
            setTimeout(() => { toast.hidden = true; }, 320);
        }, TOAST_MS);
    }

    function playIndex(index) {
        const track = TRACKS[index];
        if (!track) return;
        current = index;
        audio.src = asset(track.file);
        const promise = audio.play();
        if (promise && promise.catch) {
            promise.catch(() => { /* autoplay blocked or missing: ignore */ });
        }
    }

    function next() {
        if (muted) return;
        const index = pickIndex();
        if (index === -1) return;
        playIndex(index);
    }

    audio.addEventListener("playing", () => {
        const track = TRACKS[current];
        if (track) showToast(track.title);
    });

    audio.addEventListener("ended", next);

    audio.addEventListener("error", () => {
        if (current !== -1) {
            failed.add(current);
            if (!warned.has(current)) {
                warned.add(current);
                console.warn("TaoPat: background music file missing or unplayable:",
                    TRACKS[current] && TRACKS[current].file);
            }
        }
        const index = pickIndex();
        if (index === -1) { current = -1; return; }
        // Defer slightly so a broken file cannot spin in a tight loop.
        setTimeout(() => playIndex(index), 50);
    });

    function applyMute() {
        audio.muted = muted;
        if (muted) {
            try { audio.pause(); } catch (_) { /* ignore */ }
        }
        if (btn) {
            btn.setAttribute("aria-pressed", String(muted));
            btn.setAttribute("aria-label", muted ? "Unmute background music" : "Mute background music");
        }
    }

    function ensureStarted() {
        if (started) return;
        started = true;
        if (!muted) next();
    }

    // Browsers block autoplay until a gesture; start on the first one.
    ["pointerdown", "touchend", "click", "keydown"].forEach((type) => {
        window.addEventListener(type, ensureStarted, { once: true, passive: true, capture: true });
    });

    if (btn) {
        btn.addEventListener("click", () => {
            muted = !muted;
            try { localStorage.setItem(STORAGE_KEY, muted ? "1" : "0"); } catch (_) { /* ignore */ }
            applyMute();
            if (!muted) {
                started = true;
                if (audio.paused) next();
            }
            btn.blur();
        });
    }

    applyMute();

    window.TaoMusic = {
        isMuted: () => muted,
        setMuted(value) {
            muted = !!value;
            try { localStorage.setItem(STORAGE_KEY, muted ? "1" : "0"); } catch (_) { /* ignore */ }
            applyMute();
            if (!muted) {
                started = true;
                if (audio.paused) next();
            }
        },
        tracks: TRACKS
    };
})();