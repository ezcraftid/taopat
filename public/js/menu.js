// public/js/menu.js
// Compact, accessible dropdown that groups the secondary actions. Opening and
// closing is animated with CSS; Escape and outside clicks close it. Choosing a
// menu item never counts as a pat because pats are only registered on the
// character element in app.js.
(() => {
    "use strict";

    const menu = document.getElementById("menu");
    const btn = document.getElementById("menuBtn");
    const panel = document.getElementById("menuPanel");
    const boardBtn = document.getElementById("boardMenuBtn");

    if (!menu || !btn || !panel) return;

    function isOpen() {
        return menu.dataset.open === "true";
    }

    function setOpen(open) {
        menu.dataset.open = String(open);
        btn.setAttribute("aria-expanded", String(open));
        btn.setAttribute("aria-label", open ? "Close menu" : "Open menu");
    }

    btn.addEventListener("click", () => setOpen(!isOpen()));

    // Close when clicking outside the menu.
    document.addEventListener("pointerdown", (event) => {
        if (!isOpen()) return;
        if (menu.contains(event.target)) return;
        setOpen(false);
    });

    // Escape closes and returns focus to the trigger.
    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && isOpen()) {
            setOpen(false);
            btn.focus();
        }
    });

    // Toggles stay open so both mute switches can be changed in one visit;
    // navigation-style items close the menu.
    panel.addEventListener("click", (event) => {
        const item = event.target.closest(".menu-item");
        if (!item) return;
        if (item.id === "muteBtn" || item.id === "musicBtn") return;
        setOpen(false);
    });

    if (boardBtn) {
        boardBtn.addEventListener("click", () => {
            if (window.TaoBoard && typeof window.TaoBoard.toggle === "function") {
                window.TaoBoard.toggle();
            }
            setOpen(false);
        });
    }

    window.TaoMenu = {
        isOpen,
        open: () => setOpen(true),
        close: () => setOpen(false)
    };
})();
