# MASTER PROMPT — TaoPat v1 Safe Feature Upgrade

You are an experienced Node.js engineer working inside an existing project called TaoPat v1. Implement the requested features in the existing repository, using the task files in this pack as the execution plan. Work directly in the repository; do not merely provide suggestions or code snippets.

## Mandatory workflow
1. Inspect the real repository files first, especially `package.json`, `README.md`, `TAOPAT_BRIEF.md`, `server.js`, `public/index.html`, `public/css/style.css`, `public/js/app.js`, `public/js/fx.js`, and `public/js/game.js`. Confirm which frontend directory is actually served. `public1/` may be legacy; do not assume it is active.
2. Read all `TASK_*.md` files and execute them in numeric order.
3. Establish a baseline: run available existing checks and inspect the database schema safely before editing. Never treat `repomix-output.xml` as the source to modify.
4. Make small, reviewable, additive changes. Preserve current behavior, event contracts, working animation/audio effects, leaderboard, regional/global totals, and all existing data. Do not rewrite the app wholesale.
5. No framework, build system, or new runtime dependency unless absolutely necessary and justified. Prefer the existing Node.js + Express + Socket.IO + better-sqlite3 + vanilla JS stack.
6. Keep the existing database file `data/tapgame.db`; do not delete, rename, recreate, or replace it. Use additive, idempotent migrations and back up the database before any migration when practical.
7. Do not invent that tests passed. Run what is available, report exact commands and results, and clearly list anything that could not be tested.

## Product goals
- Add background music using three future-provided audio assets. The owner will supply the music files. Implement configurable filenames/metadata and graceful missing-asset handling; do not download or fabricate audio. Choose tracks randomly, avoid immediately repeating the same track when possible, and show each track title briefly in a subtle toast/now-playing label. Background music mute must be independent from game content/SFX/voice mute.
- Add durable per-user statistics. The same browser should normally reconnect to the same user record when its IP changes. Two different browsers/devices behind the same public IP must remain separate users. Do not use IP address as the primary identity and do not merge users merely because IPs match. Prefer a random opaque browser/client ID persisted in a first-party cookie or localStorage and sent during Socket.IO connection; validate it server-side. Store only the minimum useful IP metadata needed by the existing region logic/security. Do not use invasive browser fingerprinting or attempt to identify a person across browsers without consent. Explain that clearing site data, private browsing, or changing browsers can create a new identity.
- Persist user totals and useful statistics (at minimum total pats, current session pats if useful, pats/second as transient rate, created/last-seen timestamps, and earned stamp IDs/timestamps if stamps are persisted server-side). Keep the existing global/region statistics and leaderboard semantics intact.
- Add more challenging, varied stamps/achievements with clear thresholds, descriptions, and progress where practical. Avoid awarding the same stamp repeatedly. Include a balanced range of lifetime milestones, combo feats, speed feats, and session goals. Make the record UI understandable and visually consistent.
- Add a creator/about action that opens `https://deni26.my.id/`.
- Consolidate controls into one compact, accessible menu/dropdown with a clear open/close animation. Keep the interface clean and responsive. Include distinct controls for content/SFX mute and background music mute.
- Lower/reposition the character/headpat hand slightly to improve alignment. Tune existing CSS variables and inspect the sprite dimensions/animation rather than guessing.
- Refactor carefully: organize and remove only code proven unused or incorrect. Preserve stable IDs and Socket.IO events unless all callers are updated consistently.
- Fix the SQLite error: `Database save error: TypeError: The database connection is not open` from `saveDatabase` invoked by a periodic timer after closure. Make shutdown idempotent, stop/clear periodic jobs before closing the database, prevent any further save after closure, handle the HTTP/socket server shutdown gracefully, and avoid double-closing the database.

## Identity and privacy design constraints
- A client ID is a pseudonymous browser installation identifier, not a verified real-world identity.
- Generate it using cryptographically secure randomness on the client where supported; send it through Socket.IO's supported handshake/auth mechanism or a carefully validated registration event.
- Use a durable first-party cookie or localStorage as the persistence mechanism. If a cookie is used, choose appropriate `SameSite` and `Secure` behavior for the deployment; do not assume HTTPS on localhost.
- Never trust a client-supplied user ID as authorization for modifying arbitrary records. Validate length/format and bind each socket only to the identity presented during its own handshake.
- IP address can change and can be shared by many people. It must not be the identity key. Do not store full IP history indefinitely unless there is a clear need; minimize retention and document it.
- Do not create a stealth fingerprint based on canvas, fonts, installed plugins, hardware, or other entropy. The user explicitly wants browser continuity, not invasive fingerprinting.
- If schema migration is needed, inspect the current schema and use a transaction. Preserve all legacy totals; do not silently reset old users or global/region stats. Provide a safe mapping/backfill strategy if feasible.

## UI and accessibility
- Preserve TaoPat's existing visual art direction. Do not replace it with generic gradients or an unrelated redesign.
- Use accessible button labels, `aria-expanded`, focus-visible states, Escape-to-close behavior, and reduced-motion support.
- Do not let menu interactions accidentally trigger a pat. Do not count clicks on controls as taps.
- Missing future music files must fail gracefully without breaking game audio or generating noisy repeated console errors.
- Keep music and SFX state independent and persist each setting separately where appropriate.
- Make mobile and desktop layouts work; avoid covering the character's face or clipping the menu.

## Required final response from you
At the end, summarize:
1. Files changed and the purpose of each.
2. Database migration/schema changes and how existing data was preserved.
3. How browser identity works and its limitations.
4. How the two mute controls work.
5. Added stamps and their unlock rules.
6. Exact tests/commands run and results.
7. Remaining manual checks or assumptions, including where the owner should place the three music files.
8. Any known risks or work not completed.

Do not stop after writing a plan. Implement, test, and audit the code. If a requested item cannot safely be completed, explain why and finish the other safe items.
