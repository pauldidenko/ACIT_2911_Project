-- =========================
-- 1. Admin User Table
-- =========================
CREATE TABLE admin_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL
);

-- =========================
-- 2. Items Table
-- =========================
CREATE TABLE items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    item_name TEXT NOT NULL,
    description TEXT,
    category TEXT,

    campus TEXT NOT NULL,

    location_details TEXT,
    stored_location TEXT,

    date_reported DATETIME DEFAULT CURRENT_TIMESTAMP,
    date_found DATE,
    date_claimed DATE,

    status TEXT DEFAULT 'found',

    claimant_name TEXT,
    claimant_contact TEXT,

    notes TEXT
);