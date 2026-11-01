# TaoPat v1 — Agent Task Pack

## How to use
1. Copy these Markdown files into the root of the TaoPat repository (the same directory as `server.js` and `package.json`).
2. Open the repository root in your coding CLI agent.
3. Paste the complete contents of `MASTER_PROMPT.md` into the CLI.
4. The agent should read and execute the task files in the listed order, inspecting the real repository before changing code.

## Task order
1. `TASK_01_DATABASE_IDENTITY_AND_SHUTDOWN.md`
2. `TASK_02_AUDIO_AND_MENU.md`
3. `TASK_03_STAMPS_AND_PERSONAL_RECORD.md`
4. `TASK_04_LAYOUT_AND_SAFE_REFACTOR.md`
5. `TASK_05_TESTING_AND_FINAL_AUDIT.md`

## Important project-specific observations from the supplied Repomix
- The project uses Node.js, Express, Socket.IO, `better-sqlite3`, and vanilla HTML/CSS/JS.
- The active frontend appears to be under `public/`: `public/index.html`, `public/css/style.css`, `public/js/app.js`, `public/js/fx.js`, and `public/js/game.js`.
- `public1/` also exists and looks like a legacy/alternate copy. Do not change it unless the active server configuration proves it is served.
- The SQLite database is `data/tapgame.db`. Preserve it and its existing data.
- Current `public/js/game.js` stores personal stats in `localStorage` (`taopat-stats-v1`), while the server creates a fresh random user ID on every Socket.IO connection. This is not durable server-side identity.
- `server.js` has a periodic database save interval and a shutdown handler that saves and closes the database. The reported error is consistent with a save callback firing after the database has already been closed, or shutdown being invoked more than once. Verify the exact control flow before patching.
- Existing CSS variables include `--char-size`, `--hand-width`, and `--hand-top`; tune these rather than replacing the whole layout.
- The code already contains separate pat/voice effects and a mute button. Keep content/voice SFX mute separate from background music mute.
- The repomix file is a snapshot, not the working source. Edit the real repository files only.

## Scope policy
Treat the user's current feature request as the source of truth where it conflicts with old instructions embedded in project documentation. In particular, implementing persistent per-user statistics and fixing the database shutdown race may require changes to `server.js` and a safe, additive SQLite migration. Do not perform destructive schema changes or rewrite the project from scratch.
