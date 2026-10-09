const express = require("express");
const http = require("http");
const path = require("path");
const crypto = require("crypto");
const Database = require("better-sqlite3");
const { Server } = require("socket.io");

// ======================================================
// APP
// ======================================================

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;


// ======================================================
// DATABASE
// ======================================================

const DATA_DIR = path.join(__dirname, "data");
const DB_PATH = path.join(DATA_DIR, "tapgame.db");

const fs = require("fs");

if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, {
        recursive: true
    });
}

const db = new Database(DB_PATH);

// SQLite optimization
db.pragma("journal_mode = WAL");
db.pragma("synchronous = NORMAL");
db.pragma("busy_timeout = 5000");


// ======================================================
// DATABASE TABLES
// ======================================================

db.exec(`
    CREATE TABLE IF NOT EXISTS global_stats (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        total_taps INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS regions (
        country_code TEXT PRIMARY KEY,
        country_name TEXT NOT NULL,
        flag TEXT NOT NULL,
        total_taps INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
        user_id TEXT PRIMARY KEY,
        region_code TEXT NOT NULL,
        total_taps INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
    );
`);


// ======================================================
// INITIAL GLOBAL ROW
// ======================================================

const existingGlobal = db
    .prepare(`
        SELECT id
        FROM global_stats
        WHERE id = 1
    `)
    .get();

if (!existingGlobal) {

    db.prepare(`
        INSERT INTO global_stats (
            id,
            total_taps,
            updated_at
        )
        VALUES (
            1,
            0,
            ?
        )
    `).run(Date.now());
}


// ======================================================
// LOAD GLOBAL STATE
// ======================================================

let globalTaps =
    db
        .prepare(`
            SELECT total_taps
            FROM global_stats
            WHERE id = 1
        `)
        .get()
        ?.total_taps || 0;


// ======================================================
// MEMORY STATE
// ======================================================

const users = new Map();

const regions = new Map();


// ======================================================
// LOAD REGIONS FROM DATABASE
// ======================================================

const savedRegions = db
    .prepare(`
        SELECT
            country_code,
            country_name,
            flag,
            total_taps
        FROM regions
    `)
    .all();

for (const region of savedRegions) {

    regions.set(
        region.country_code,
        {
            code: region.country_code,
            name: region.country_name,
            flag: region.flag,

            taps: region.total_taps,

            currentWindowTaps: 0,
            tapsPerSecond: 0
        }
    );
}


console.log(
    `Loaded ${regions.size} regions`
);

console.log(
    `Global taps: ${globalTaps.toLocaleString()}`
);


// ======================================================
// STATIC FILES
// ======================================================

app.use(
    express.static(
        path.join(__dirname, "public")
    )
);


// ======================================================
// STATUS API
// ======================================================

app.get("/api/status", (req, res) => {

    res.json({
        users: users.size,

        regions: regions.size,

        globalTaps,

        database: "SQLite"
    });

});


// ======================================================
// IP
// ======================================================

function getClientIP(socket) {

    let ip =
        socket.handshake.headers["x-forwarded-for"] ||
        socket.handshake.address;

    if (typeof ip === "string") {

        ip =
            ip
                .split(",")[0]
                .trim();
    }

    if (ip?.startsWith("::ffff:")) {

        ip =
            ip.substring(7);
    }

    return ip;
}


// ======================================================
// FLAG
// ======================================================

function getFlagEmoji(countryCode) {

    if (
        !countryCode ||
        countryCode.length !== 2
    ) {
        return "🌐";
    }

    return countryCode
        .toUpperCase()
        .split("")
        .map(
            char =>
                String.fromCodePoint(
                    127397 +
                    char.charCodeAt(0)
                )
        )
        .join("");
}


// ======================================================
// REGION FROM IP
// ======================================================

async function getRegionFromIP(ip) {

    // Local network
    if (
        ip === "127.0.0.1" ||
        ip === "::1" ||
        ip.startsWith("192.168.") ||
        ip.startsWith("10.") ||
        ip.startsWith("172.")
    ) {

        return {
            code: "LOCAL",
            name: "Local Network",
            flag: "🌐"
        };
    }


    try {

        const response =
            await fetch(
                `http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,country,countryCode`
            );

        const data =
            await response.json();


        if (
            data.status === "success"
        ) {

            return {

                code:
                    data.countryCode,

                name:
                    data.country,

                flag:
                    getFlagEmoji(
                        data.countryCode
                    )
            };
        }

    } catch (error) {

        console.error(
            "IP lookup error:",
            error.message
        );
    }


    return {

        code: "UNKNOWN",

        name: "Unknown",

        flag: "🌐"
    };
}


// ======================================================
// GET / CREATE REGION
// ======================================================

function getOrCreateRegion(region) {

    if (!regions.has(region.code)) {

        regions.set(
            region.code,
            {
                code: region.code,

                name: region.name,

                flag: region.flag,

                taps: 0,

                currentWindowTaps: 0,

                tapsPerSecond: 0
            }
        );
    }

    return regions.get(
        region.code
    );
}


// ======================================================
// SOCKET CONNECTION
// ======================================================

io.on(
    "connection",
    async (socket) => {

        const userId =
            crypto.randomUUID();

        const ip =
            getClientIP(socket);


        console.log(
            `Connected: ${socket.id} | ${ip}`
        );


        const region =
            await getRegionFromIP(ip);


        const regionData =
            getOrCreateRegion(region);


        // ==========================================
        // USER
        // ==========================================

        users.set(
            socket.id,
            {

                id: userId,

                taps: 0,

                region:
                    region.code,

                connectedAt:
                    Date.now(),

                currentWindowTaps:
                    0,

                tapsPerSecond:
                    0
            }
        );


        // ==========================================
        // DATABASE USER
        // ==========================================

        db.prepare(`
            INSERT OR IGNORE INTO users (
                user_id,
                region_code,
                total_taps,
                created_at,
                updated_at
            )
            VALUES (
                ?,
                ?,
                0,
                ?,
                ?
            )
        `).run(
            userId,
            region.code,
            Date.now(),
            Date.now()
        );


        // ==========================================
        // INITIAL STATE
        // ==========================================

        socket.emit(
            "initialState",
            {

                user: {

                    taps: 0,

                    tapsPerSecond: 0
                },

                region: {

                    code:
                        regionData.code,

                    name:
                        regionData.name,

                    flag:
                        regionData.flag,

                    taps:
                        regionData.taps,

                    tapsPerSecond:
                        0
                },

                global: {

                    taps:
                        globalTaps
                }
            }
        );


        // ==========================================
        // TAP BATCH
        // ==========================================

        socket.on(
            "tapBatch",
            amount => {

                const user =
                    users.get(
                        socket.id
                    );


                if (!user) {
                    return;
                }


                // Validation
                if (
                    !Number.isInteger(
                        amount
                    )
                ) {
                    return;
                }


                if (
                    amount <= 0
                ) {
                    return;
                }


                // Prevent absurd values
                if (
                    amount > 1000
                ) {
                    return;
                }


                // ==================================
                // USER
                // ==================================

                user.taps += amount;

                user.currentWindowTaps +=
                    amount;


                // ==================================
                // REGION
                // ==================================

                const regionData =
                    regions.get(
                        user.region
                    );


                if (regionData) {

                    regionData.taps +=
                        amount;

                    regionData.currentWindowTaps +=
                        amount;
                }


                // ==================================
                // GLOBAL
                // ==================================

                globalTaps +=
                    amount;
            }
        );


        // ==========================================
        // DISCONNECT
        // ==========================================

        socket.on(
            "disconnect",
            () => {

                console.log(
                    `Disconnected: ${socket.id}`
                );


                users.delete(
                    socket.id
                );
            }
        );

    }
);


// ======================================================
// PREPARED STATEMENTS
// ======================================================

const updateGlobal =
    db.prepare(`
        UPDATE global_stats
        SET
            total_taps = ?,
            updated_at = ?
        WHERE id = 1
    `);


const updateRegion =
    db.prepare(`
        INSERT INTO regions (
            country_code,
            country_name,
            flag,
            total_taps,
            updated_at
        )
        VALUES (
            ?,
            ?,
            ?,
            ?,
            ?
        )
        ON CONFLICT(country_code)
        DO UPDATE SET
            country_name = excluded.country_name,
            flag = excluded.flag,
            total_taps = excluded.total_taps,
            updated_at = excluded.updated_at
    `);


const updateUser =
    db.prepare(`
        UPDATE users
        SET
            total_taps = ?,
            updated_at = ?
        WHERE user_id = ?
    `);


// ======================================================
// SAVE DATABASE
// ======================================================

function saveDatabase() {

    const now =
        Date.now();


    const transaction =
        db.transaction(
            () => {

                // Global
                updateGlobal.run(
                    globalTaps,
                    now
                );


                // Regions
                for (
                    const region
                    of regions.values()
                ) {

                    updateRegion.run(

                        region.code,

                        region.name,

                        region.flag,

                        region.taps,

                        now
                    );
                }


                // Users
                for (
                    const user
                    of users.values()
                ) {

                    updateUser.run(

                        user.taps,

                        now,

                        user.id
                    );
                }
            }
        );


    transaction();
}


// ======================================================
// TAP/S
// ======================================================

setInterval(
    () => {

        for (
            const [socketId, user]
            of users
        ) {

            user.tapsPerSecond =
                user.currentWindowTaps;

            user.currentWindowTaps =
                0;


            const socket =
                io.sockets.sockets.get(
                    socketId
                );


            if (socket) {

                socket.emit(
                    "userStats",
                    {

                        taps:
                            user.taps,

                        tapsPerSecond:
                            user.tapsPerSecond
                    }
                );
            }
        }


        for (
            const region
            of regions.values()
        ) {

            region.tapsPerSecond =
                region.currentWindowTaps;

            region.currentWindowTaps =
                0;
        }

    },
    1000
);


// ======================================================
// SQLITE CHECKPOINT
// ======================================================

// Save every second
setInterval(
    () => {

        try {

            saveDatabase();

        } catch (error) {

            console.error(
                "Database save error:",
                error
            );
        }

    },
    1000
);


// ======================================================
// LEADERBOARD
// ======================================================

setInterval(
    () => {

        const leaderboard =
            [...regions.values()]
                .sort(
                    (a, b) =>
                        b.taps - a.taps
                )
                .slice(0, 20)
                .map(region => ({

                    code:
                        region.code,

                    name:
                        region.name,

                    flag:
                        region.flag,

                    taps:
                        region.taps,

                    tapsPerSecond:
                        region.tapsPerSecond
                }));


        io.emit(
            "leaderboard",
            {

                global: {

                    taps:
                        globalTaps
                },

                regions:
                    leaderboard
            }
        );

    },
    500
);


// ======================================================
// GRACEFUL SHUTDOWN
// ======================================================

function shutdown() {

    console.log(
        "Saving database..."
    );


    try {

        saveDatabase();

        db.pragma(
            "wal_checkpoint(TRUNCATE)"
        );

        db.close();

        console.log(
            "Database saved."
        );

    } catch (error) {

        console.error(
            "Shutdown error:",
            error
        );
    }


    server.close(
        () => {

            process.exit(0);

        }
    );
}


process.on(
    "SIGINT",
    shutdown
);

process.on(
    "SIGTERM",
    shutdown
);


// ======================================================
// SERVER
// ======================================================

server.listen(
    PORT,
    () => {

        console.log(`
========================================
 TAP CHARACTER SERVER
========================================

Port:
${PORT}

Database:
${DB_PATH}

Global taps:
${globalTaps.toLocaleString()}

Loaded regions:
${regions.size}

========================================
        `);

    }
);