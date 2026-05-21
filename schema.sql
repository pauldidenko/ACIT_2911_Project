-- =========================
-- 1. Admin User Table
-- =========================
CREATE TABLE admin_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    -- NULL = MFA off. When set, holds the shared secret for the admin's authenticator app (Google Authenticator, etc.).
    totp_secret TEXT
);

-- =========================
-- 2. Items Table
-- =========================
CREATE TABLE items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    item_name TEXT NOT NULL,
    description TEXT,
    category TEXT NOT NULL CHECK (
        category IN (
            'Electronics',
            'Accessories',
            'Clothing',
            'Keys & ID',
            'School Supplies',
            'Bottles & containers',
            'Sports & Fitness',
            'Documents',
            'Misc'
        )
    ),

    campus TEXT NOT NULL CHECK (campus IN ('Burnaby', 'Downtown', 'Aerospace')),

    location_details TEXT, -- where item was lost/found
    stored_location TEXT, -- where item is stored

    date_reported DATETIME DEFAULT CURRENT_TIMESTAMP,
    date_lost DATE,
    date_found DATE,
    date_claimed DATE,

    status TEXT NOT NULL CHECK (status IN ('lost','found', 'claimed', 'deleted')
    ), 

    claimant_name TEXT,
    claimant_contact TEXT,

    notes TEXT,

    image_path TEXT,

    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);