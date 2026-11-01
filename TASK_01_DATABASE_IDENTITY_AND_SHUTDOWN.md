# Task 01 — Durable User Identity, Statistics, and SQLite Shutdown Race

## Goal
Implement persistent per-browser user records and eliminate the `better-sqlite3` “database connection is not open” error without damaging the existing database or global/region totals.

## Inspect first
- `server.js`: database initialization/schema, `saveDatabase()`, all `setInterval` calls, `shutdown()`, Socket.IO connection handler, `tapBatch` handler, disconnect handler, and prepared statements.
- `public/js/app.js`: Socket.IO initialization and `userStats` / `initialState` handling.
- `public/js/game.js`: current `localStorage` statistics and stamp state.
- `data/tapgame.db`: inspect schema and counts read-only or with a safe backup. Never delete or recreate it.

## Requirements
1. Replace per-connection-only random identity with a stable, opaque client/browser ID persisted by the browser. Reuse that identity on reconnect and after public IP changes.
2. Different browsers/devices sharing one public IP must receive separate IDs. IP is not a primary key and matching IPs must never cause account merging.
3. Do not implement invasive fingerprinting. Use a random UUID generated with `crypto.randomUUID()` or a secure fallback, persisted in first-party localStorage/cookie. Validate the format/length server-side.
4. Pass the ID via Socket.IO handshake auth or another secure, minimal registration method. Bind the socket to that validated identity; do not allow client events to choose arbitrary user records after connection.
5. Persist user total pats and timestamps in SQLite. Restore the existing user's totals on reconnect. Preserve current global and region counting semantics and avoid double-counting during migration.
6. Persist earned stamp IDs/timestamps if the existing implementation can be integrated safely. Avoid making browser-supplied stamp claims authoritative; validate achievement awards server-side if server persistence is introduced.
7. Add an additive, idempotent migration in a transaction if schema changes are necessary. Preserve all existing rows and data. Keep `data/tapgame.db` unchanged as the database path.
8. Fix the reported save race:
   - Make shutdown idempotent (a second SIGINT/SIGTERM must not run the close sequence again).
   - Store interval handles and clear all save/leaderboard/rate intervals before closing the DB.
   - Ensure no timer or async callback can call `saveDatabase()` after `db.close()`.
   - Track database closed state and guard database operations; avoid swallowing unrelated errors.
   - Ensure save/checkpoint/close ordering is correct and the server/socket server closes gracefully.
   - Avoid logging “Database saved” if save failed.
   - Keep normal periodic persistence functioning while the app is running.
9. Avoid introducing race conditions between Socket.IO connection callbacks, DB writes, and shutdown.
10. Keep existing Socket.IO event names and payloads compatible where practical. If adding fields, make them additive and document them.

## Acceptance tests
- Existing user reconnects with the same browser ID and sees their stored total.
- Changing the client's IP does not create a new user record.
- Two separate browser profiles with the same public IP get distinct user records.
- Invalid/malformed client IDs are rejected or replaced safely.
- Existing global/region totals remain unchanged after migration, except for new legitimate taps.
- Repeated shutdown calls do not attempt a second save/close.
- No periodic save executes after DB closure.
- Run available project checks and add a focused regression test or a testable helper for shutdown/save behavior if practical.

## Deliverables
Implement the code, then report schema changes, migration behavior, tests, and any remaining limitations. Do not only describe the solution.
