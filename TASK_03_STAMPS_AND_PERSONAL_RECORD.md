# Task 03 — More Challenging Stamps and Persistent Personal Record

## Goal
Expand TaoPat's achievement/stamp system to make it more varied and rewarding, while keeping its record panel clean and ensuring the stats remain consistent with the durable identity system.

## Inspect first
Read the full `public/js/game.js`, the record/stamp markup in `public/index.html`, and all stamp-related CSS in `public/css/style.css`. Coordinate with Task 01 so browser-local data and server-persisted data do not fight or overwrite one another.

## Requirements
1. Expand the existing `ACHIEVEMENTS` data-driven list rather than scattering hard-coded checks across the code.
2. Add a balanced set of harder achievements with distinct unlock conditions:
   - Lifetime total pats (early, medium, high, and long-term milestones).
   - Combo milestones.
   - Sustained speed/pats-per-second milestones.
   - Session challenges (for example, reach a target in one visit).
   - Consistency or return-play goals only if they can be tracked reliably and transparently.
3. Each stamp should have a stable ID, title, short description, category/condition, and clear unlock threshold. Avoid duplicate unlock notifications and repeated awards.
4. Show earned versus locked state, earned count, and progress toward the next relevant goal where practical. Do not make the record panel too dense; preserve mobile usability.
5. Keep existing stamp IDs and earned state compatible. If IDs or conditions must change, migrate or map old values so users do not lose existing stamps.
6. Persist stats in the authoritative place agreed with Task 01. Do not allow localStorage and server state to overwrite each other unpredictably. If the server remains authoritative for lifetime totals, local-only session combo/rate values may remain transient.
7. Ensure pats/s and combo are calculated from real tap timing and reset appropriately. Avoid awarding speed stamps based on impossible or stale rates.
8. Keep the existing record dialog accessible: focus handling, Escape-to-close, close button, scrim behavior, and reduced-motion styles must remain functional.
9. Avoid emoji in the UI and keep the existing TaoPat aesthetic.

## Suggested acceptance tests
- Existing earned stamps remain earned after upgrade.
- Each achievement unlocks at its intended threshold and only once.
- A single tap increments counters exactly once.
- Combo resets after the configured idle gap.
- Speed achievements require the intended sustained window rather than a one-frame spike.
- Record panel renders with zero earned stamps, some earned stamps, and all earned stamps without overflow.
- A returning user sees lifetime totals and stamps associated with the same persistent browser identity.

## Deliverables
Implement the expanded achievement definitions and tracking; document every new stamp's exact condition in the final report.
