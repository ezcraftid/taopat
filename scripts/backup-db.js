// scripts/backup-db.js
// Online, consistent backup of data/tapgame.db using better-sqlite3's backup API.
// Safe while the server is running (WAL). Keeps the newest KEEP backups.
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const Database = require("better-sqlite3");

const KEEP = Number(process.env.BACKUP_KEEP) || 14;
const root = path.join(__dirname, "..");
const source = path.join(root, "data", "tapgame.db");
const dir = path.join(root, "data", "backups");

if (!fs.existsSync(source)) {
    console.error("No database at", source);
    process.exit(1);
}

fs.mkdirSync(dir, { recursive: true });

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const dest = path.join(dir, `tapgame-${stamp}.db`);
const db = new Database(source, { fileMustExist: true });

db.backup(dest)
    .then(() => {
        db.close();

        const files = fs.readdirSync(dir)
            .filter((name) => /^tapgame-.*\.db$/.test(name))
            .sort();

        for (const name of files.slice(0, Math.max(0, files.length - KEEP))) {
            fs.unlinkSync(path.join(dir, name));
        }

        console.log("Backup written:", dest);
    })
    .catch((error) => {
        try { db.close(); } catch (_) { /* ignore */ }
        console.error("Backup failed:", error.message);
        process.exit(1);
    });
