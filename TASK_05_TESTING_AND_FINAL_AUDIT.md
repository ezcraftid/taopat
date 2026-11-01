# Task 05 — Regression Testing and Final Audit

## Goal
Verify that all changes from Tasks 01–04 integrate without breaking existing TaoPat behavior.

## Required audit
1. Run `npm test` if present; inspect `package.json` first. Run `npm start` or the documented start command when safe.
2. Run existing repository checks if applicable, including `_check_ids.js`, `_check_picker.js`, and `_check_urls.js`. Do not assume `_check_urls.js` works unless the server is running on its expected port.
3. Add focused tests for database shutdown idempotency, client ID validation, migration safety, achievement unlock rules, and music track selection where practical. Avoid introducing a test framework dependency just for trivial checks.
4. Check for duplicate HTML IDs and broken script ordering.
5. Search for old selectors/events and confirm all references match the new markup.
6. Verify `public1/` is not accidentally served or modified without reason.
7. Verify the SQLite DB path remains `data/tapgame.db`; check that the migration preserves existing global, region, and user totals.
8. Confirm periodic save intervals are stopped before database close and that shutdown can be called more than once safely.
9. Confirm two mute preferences are separate and persisted independently.
10. Confirm missing future music assets do not break the page and that autoplay is only attempted after a user gesture.
11. Review keyboard navigation, Escape-to-close, focus visibility, reduced-motion behavior, mobile layout, and whether menu actions accidentally trigger a pat.
12. Run `node --check` on changed JavaScript files, plus any syntax checks supported by the current Node version.
13. Do not claim visual screenshot review unless screenshots were actually generated and inspected.

## Final report format
- **Implemented:** concise feature list.
- **Files changed:** file-by-file summary.
- **Database safety:** migration, backup, data preservation.
- **Identity behavior:** how IDs persist and limitations.
- **Stamps:** exact names and unlock conditions.
- **Audio/menu:** filenames expected, random selection, independent mute behavior.
- **Tests:** exact command, pass/fail, short result.
- **Manual checks still needed:** explicitly list anything not run or that requires the owner's three music files.
- **Known limitations:** do not hide incomplete work.

## Completion standard
Do not stop after writing tests or a plan. Implement all safe requested changes, run the available checks, fix regressions, and provide an honest final report.
