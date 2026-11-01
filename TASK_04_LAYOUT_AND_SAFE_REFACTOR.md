# Task 04 — Lower Headpat, Consolidate Controls, and Safe Refactoring

## Goal
Improve headpat positioning and code maintainability without breaking existing working features.

## Inspect first
- Active frontend path and HTML IDs.
- `public/css/style.css` variables `--char-size`, `--hand-width`, `--hand-top`, `.character`, `.pat-hand`, `.stamp`, and responsive rules.
- `public/js/fx.js` sprite frame sizing and animation.
- `_check_ids.js`, `_check_urls.js`, and other existing checks.
- Determine whether `public1/` is served; assume it is legacy until proven otherwise.

## Requirements
1. Lower the headpat hand slightly and tune the character/hand positioning based on actual asset dimensions and rendered composition. Prefer tuning existing CSS variables such as `--hand-top` and `--hand-width` rather than rewriting animation logic.
2. Verify that the horizontal sprite has five equal frames and that frame width is derived from `naturalWidth / 5`. Keep animation timing and aspect ratio correct.
3. Ensure the hand does not cover the character's face awkwardly, float too far above the head, stretch, or clip at mobile/desktop viewport sizes.
4. Refactor only where there is clear benefit and low risk. Use small functions, meaningful names, consistent formatting, and comments that explain non-obvious behavior.
5. Do not wholesale rewrite `server.js`, `app.js`, `fx.js`, or `game.js`. Do not remove code just because it appears unfamiliar. Confirm a symbol or code path is unused before deleting it.
6. Preserve IDs referenced by JavaScript and the event names/payloads used by Socket.IO. If markup changes, update all corresponding selectors and checks in the same change.
7. Preserve disconnected-mode local tapping, audio fallback behavior, leaderboard, record panel, region/global totals, and accessibility.
8. Keep `public1/` untouched unless the active server configuration explicitly serves it and the feature needs to be applied there.
9. Avoid broad CSS resets and unrelated visual redesign. Respect `prefers-reduced-motion`.
10. Fix only confirmed defects. Explain any suspicious but retained code in the final report instead of deleting it speculatively.

## Acceptance tests
- The headpat appears better aligned on desktop and mobile and all five frames remain intact.
- All existing required element IDs exist exactly once.
- No buttons or menu controls count as pats.
- Existing animation, record dialog, leaderboard, and offline state still work.
- No new console errors or missing-element exceptions.

## Deliverables
Commit the focused CSS/markup/refactoring changes in the working tree and explain the changed behavior.
