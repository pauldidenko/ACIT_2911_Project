/*
 * app.js - foundIt backend (Express + SQLite + sessions + file uploads)
 *
 * npm start - reads .env for PORT, DB_FILE, SESSION_SECRET
 * API routes are registered before static files so /api/... is never shadowed by a filename
 * Admin routes use requireAdmin (must be logged in)
 *
 * Public (no login): GET /api/public/items/recent/lost|found - 3 rows for index.html
 * Admin catalog: GET/POST/PUT/DELETE /api/admin/items
 * Account: GET /api/admin/stats, /api/admin/2fa/*
 * MFA: optional 6-digit code on login; setup on account page
 */
import express from "express";
import bodyParser from "body-parser";
import cors from "cors";
import session from "express-session";
import bcrypt from "bcrypt";
import sqlite3 from "sqlite3";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import multer from "multer";
import { authenticator } from "otplib";
import QRCode from "qrcode";

dotenv.config();

/* Production needs SESSION_SECRET in .env */
if (!process.env.SESSION_SECRET && process.env.NODE_ENV === "production") {
  throw new Error("SESSION_SECRET must be set in production");
}

/* ES modules need __dirname built from import.meta.url */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = Number(process.env.PORT) || 5000;

const app = express();

app.set("trust proxy", 1);

// Allow frontend requests and send cookies (needed for session login).
app.use(
  cors({
    origin: true,
    credentials: true,
  }),
);
app.use(bodyParser.json());

app.use(
  session({
    secret: process.env.SESSION_SECRET || "dev-only-change-this-secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
      maxAge: 1000 * 60 * 60 * 8,
    },
  }),
);

// Database file and schema file locations.
const dbFileName = process.env.DB_FILE || "foundit.db";
const dbPath = path.join(__dirname, dbFileName);
const schemaPath = path.join(__dirname, "schema.sql");
const db = new sqlite3.Database(dbPath);

// Helper for INSERT/UPDATE/DELETE SQL calls using async/await.
const runAsync = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.run(sql, params, function onResult(err) {
      if (err) return reject(err);
      resolve(this);
    });
  });

// Helper for SELECT SQL calls using async/await.
const allAsync = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });

// Reads schema.sql and creates missing tables when the app starts.
async function initializeDatabase() {
  const schemaSql = fs.readFileSync(schemaPath, "utf8");
  const statements = schemaSql
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  for (const statement of statements) {
    const normalized = statement.replace(
      /CREATE TABLE\s+([a-zA-Z_][a-zA-Z0-9_]*)/i,
      "CREATE TABLE IF NOT EXISTS $1",
    );
    await runAsync(normalized);
  }
}

/* Old DBs: migrate image_path_name column if needed */
async function ensureItemsImageColumn() {
  const cols = await allAsync(`PRAGMA table_info(items)`);
  const names = new Set(cols.map((c) => c.name));
  if (names.has("image_path")) return;
  if (names.has("image_path_name")) {
    await runAsync(
      `ALTER TABLE items RENAME COLUMN image_path_name TO image_path`,
    );
    return;
  }
  try {
    await runAsync(`ALTER TABLE items ADD COLUMN image_path TEXT`);
  } catch (err) {
    if (!/duplicate column/i.test(String(err.message))) throw err;
  }
}

/* Add totp_secret column if missing (MFA) */
async function ensureTotpSecretColumn() {
  const cols = await allAsync(`PRAGMA table_info(admin_users)`);
  const names = new Set(cols.map((c) => c.name));
  if (names.has("totp_secret")) return;
  try {
    await runAsync(`ALTER TABLE admin_users ADD COLUMN totp_secret TEXT`);
  } catch (err) {
    if (!/duplicate column/i.test(String(err.message))) throw err;
  }
}

/* Need at least one row in admin_users */
async function ensureAdminExists() {
  const users = await allAsync(`SELECT id, username FROM admin_users LIMIT 1`);
  if (users.length > 0) return;

  throw new Error(
    'No admin user found in database. Insert one into "admin_users" before starting the server.',
  );
}

function requireAdmin(req, res, next) {
  if (!req.session.isAdmin) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

/* Item photos: multer saves to project_web/uploads/items */
const itemsUploadDir = path.join(__dirname, "project_web", "uploads", "items");
if (!fs.existsSync(itemsUploadDir)) {
  fs.mkdirSync(itemsUploadDir, { recursive: true });
}

const itemImageStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, itemsUploadDir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    const base = path
      .basename(file.originalname, ext)
      .replace(/\s+/g, "-")
      .replace(/[^a-zA-Z0-9._-]/g, "");
    cb(null, `${Date.now()}-${base || "image"}${ext}`);
  },
});

const uploadItemImage = multer({
  storage: itemImageStorage,
  limits: { fileSize: 8 * 1024 * 1024 },
});

/* --- Routes (all API routes come before express.static below) --- */

/* Home page */
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "project_web", "index.html"));
});

/* Login - password first; if MFA is on, also need totpCode before we set the session */
app.post("/api/auth/login", async (req, res) => {
  const { username, password, totpCode } = req.body ?? {};

  if (!username || !password) {
    return res
      .status(400)
      .json({ error: "Username and password are required" });
  }

  try {
    const users = await allAsync(
      `SELECT id, username, password_hash, totp_secret FROM admin_users WHERE username = ?`,
      [username],
    );
    if (users.length === 0) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const admin = users[0];
    const validPassword = await bcrypt.compare(password, admin.password_hash);
    if (!validPassword) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    if (admin.totp_secret) {
      /* Password OK - tell frontend to show MFA field (requires2FA) */
      if (!totpCode) {
        return res.json({ requires2FA: true });
      }

      /* Check 6-digit code against saved secret */
      const isValid = authenticator.verify({
        token: String(totpCode).trim(),
        secret: admin.totp_secret,
      });

      if (!isValid) {
        return res.status(401).json({ error: "Invalid authentication code" });
      }
    }

    req.session.isAdmin = true;
    req.session.adminId = admin.id;
    req.session.username = admin.username;

    return res.json({ success: true, username: admin.username });
  } catch (error) {
    console.error("Login error:", error);
    return res.status(500).json({ error: "Server error during login" });
  }
});

/* MFA routes (account page) - setup, verify, enable, disable */

/* Is MFA turned on for this user? */
app.get("/api/admin/2fa/status", requireAdmin, async (req, res) => {
  try {
    const username = req.session.username;
    if (!username) {
      return res.status(400).json({ error: "Username not found in session" });
    }

    const users = await allAsync(
      `SELECT totp_secret FROM admin_users WHERE username = ?`,
      [username],
    );
    if (users.length === 0) {
      return res.status(404).json({ error: "Admin not found" });
    }

    return res.json({ has2FA: Boolean(users[0].totp_secret) });
  } catch (error) {
    console.error("2FA status error:", error);
    return res.status(500).json({ error: "Failed to check MFA status" });
  }
});

/* Generate secret + QR; temp secret lives in session until enable */
app.get("/api/admin/2fa/setup", requireAdmin, async (req, res) => {
  try {
    const username = req.session.username;
    if (!username) {
      return res.status(400).json({ error: "Username not found in session" });
    }

    const users = await allAsync(
      `SELECT id FROM admin_users WHERE username = ?`,
      [username],
    );
    if (users.length === 0) {
      return res.status(404).json({ error: "Admin not found" });
    }

    const secret = authenticator.generateSecret();
    const serviceName = "BCIT Lost and Found";
    const otpauth = authenticator.keyuri(username, serviceName, secret);

    let qrCode = null;
    try {
      qrCode = await QRCode.toDataURL(otpauth, {
        errorCorrectionLevel: "M",
        margin: 1,
      });
    } catch (qrErr) {
      console.error("QR code generation error:", qrErr);
    }

    req.session.temp2FASecret = secret;

    return res.json({
      secret,
      qrCode,
      manualEntryKey: secret,
    });
  } catch (error) {
    console.error("2FA setup error:", error);
    return res.status(500).json({ error: "Failed to generate MFA setup" });
  }
});

/* User entered a valid code from their authenticator app */
app.post("/api/admin/2fa/verify", requireAdmin, async (req, res) => {
  const { totpCode } = req.body ?? {};
  try {
    const tempSecret = req.session.temp2FASecret;
    if (!tempSecret) {
      return res.status(400).json({ error: "No MFA setup in progress" });
    }

    const isValid = authenticator.verify({
      token: String(totpCode || "").trim(),
      secret: tempSecret,
    });

    if (!isValid) {
      return res.status(400).json({ error: "Invalid code" });
    }

    return res.json({ success: true });
  } catch (error) {
    console.error("2FA verify error:", error);
    return res.status(500).json({ error: "Failed to verify code" });
  }
});

/* Save secret to database - MFA is now on */
app.post("/api/admin/2fa/enable", requireAdmin, async (req, res) => {
  try {
    const username = req.session.username;
    if (!username) {
      return res.status(400).json({ error: "Username not found in session" });
    }

    const tempSecret = req.session.temp2FASecret;
    if (!tempSecret) {
      return res.status(400).json({ error: "No MFA setup in progress" });
    }

    await runAsync(
      `UPDATE admin_users SET totp_secret = ? WHERE username = ?`,
      [tempSecret, username],
    );

    delete req.session.temp2FASecret;
    return res.json({ success: true });
  } catch (error) {
    console.error("2FA enable error:", error);
    return res.status(500).json({ error: "Failed to enable MFA" });
  }
});

/* Turn MFA off */
app.post("/api/admin/2fa/disable", requireAdmin, async (req, res) => {
  try {
    const username = req.session.username;
    if (!username) {
      return res.status(400).json({ error: "Username not found in session" });
    }

    await runAsync(
      `UPDATE admin_users SET totp_secret = NULL WHERE username = ?`,
      [username],
    );
    delete req.session.temp2FASecret;

    return res.json({ success: true });
  } catch (error) {
    console.error("2FA disable error:", error);
    return res.status(500).json({ error: "Failed to disable MFA" });
  }
});

app.post("/api/auth/logout", requireAdmin, (req, res) => {
  req.session.destroy((err) => {
    if (err) return res.status(500).json({ error: "Failed to log out" });
    return res.json({ success: true });
  });
});

app.get("/api/auth/session", (req, res) => {
  if (!req.session.isAdmin) return res.json({ authenticated: false });
  return res.json({
    authenticated: true,
    username: req.session.username,
  });
});

/* Public home page tables - no login, max 3 rows each, limited columns */
const PUBLIC_RECENT_LIMIT = 3;

/* Optional ?search= on URL - same text search as admin catalog */
function appendPublicSearchFilters(search, whereParts, params) {
  const term = String(search || "").trim();
  if (!term) return;
  whereParts.push(
    "(item_name LIKE ? OR description LIKE ? OR location_details LIKE ?)",
  );
  const like = `%${term}%`;
  params.push(like, like, like);
}

async function listPublicRecentLost(req, res) {
  const search = String(req.query.search || "").trim();
  const whereParts = [`status = 'lost'`];
  const params = [];
  appendPublicSearchFilters(search, whereParts, params);
  const whereClause = whereParts.join(" AND ");
  try {
    const rows = await allAsync(
      `
      SELECT item_name, campus, date_reported
      FROM items
      WHERE ${whereClause}
      ORDER BY datetime(date_reported) DESC, id DESC
      LIMIT ?
      `,
      [...params, PUBLIC_RECENT_LIMIT],
    );
    return res.json({ items: rows });
  } catch (error) {
    console.error("Failed to load public lost items:", error);
    return res.status(500).json({ error: "Failed to load items" });
  }
}

async function listPublicRecentFound(req, res) {
  const search = String(req.query.search || "").trim();
  const whereParts = [`status = 'found'`];
  const params = [];
  appendPublicSearchFilters(search, whereParts, params);
  const whereClause = whereParts.join(" AND ");
  try {
    const rows = await allAsync(
      `
      SELECT item_name, campus, date_found, date_reported
      FROM items
      WHERE ${whereClause}
      ORDER BY datetime(COALESCE(date_found, date_reported)) DESC, id DESC
      LIMIT ?
      `,
      [...params, PUBLIC_RECENT_LIMIT],
    );
    return res.json({ items: rows });
  } catch (error) {
    console.error("Failed to load public found items:", error);
    return res.status(500).json({ error: "Failed to load items" });
  }
}

app.get("/api/public/items/recent/lost", listPublicRecentLost);
app.get("/api/public/items/recent/found", listPublicRecentFound);

/*
 * Account page stat cards.
 * totalItems = lost + found + claimed (not deleted).
 * totalLost / totalFound / totalClaimed = exact status match.
 */
app.get("/api/admin/stats", requireAdmin, async (_req, res) => {
  try {
    const rows = await allAsync(`
      SELECT
        SUM(CASE WHEN status IN ('lost', 'found', 'claimed') THEN 1 ELSE 0 END) AS total_items,
        SUM(CASE WHEN status = 'lost' THEN 1 ELSE 0 END) AS total_lost,
        SUM(CASE WHEN status = 'found' THEN 1 ELSE 0 END) AS total_found,
        SUM(CASE WHEN status = 'claimed' THEN 1 ELSE 0 END) AS total_claimed
      FROM items
    `);
    const row = rows[0] ?? {};
    return res.json({
      totalItems: Number(row.total_items) || 0,
      totalLost: Number(row.total_lost) || 0,
      totalFound: Number(row.total_found) || 0,
      totalClaimed: Number(row.total_claimed) || 0,
    });
  } catch (error) {
    console.error("Failed to load admin stats:", error);
    return res.status(500).json({ error: "Failed to load stats" });
  }
});

/* Admin catalog list - filters, sort, pagination (GET /api/admin/items) */
async function listAdminItems(req, res) {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 10));
  const offset = (page - 1) * limit;

  const search = String(req.query.search || "").trim();
  const category = String(req.query.category || "").trim();
  const status = String(req.query.status || "").trim();
  const campus = String(req.query.campus || "").trim();
  const dateFrom = String(req.query.dateFrom || "").trim();

  /* Only allow known column names in ORDER BY (SQL injection guard) */
  const allowedSortColumns = {
    item_name: "item_name",
    category: "category",
    campus: "campus",
    date_reported: "date_reported",
    date_lost: "date_lost",
    date_found: "date_found",
    status: "status",
  };
  const sortBy =
    allowedSortColumns[String(req.query.sortBy || "date_reported")] ||
    "date_reported";
  const sortDir =
    String(req.query.sortDir || "desc").toLowerCase() === "asc"
      ? "ASC"
      : "DESC";
  const sortExpression =
    sortBy === "date_reported" ? "datetime(date_reported)" : sortBy;

  const where = [];
  const params = [];

  if (status) {
    where.push("status = ?");
    params.push(status);
  } else {
    /* Default: only show lost and found in the table */
    where.push("status IN ('lost', 'found')");
  }

  if (search) {
    where.push(
      "(item_name LIKE ? OR description LIKE ? OR location_details LIKE ?)",
    );
    const searchLike = `%${search}%`;
    params.push(searchLike, searchLike, searchLike);
  }
  if (category) {
    where.push("category = ?");
    params.push(category);
  }

  if (campus) {
    where.push("campus = ?");
    params.push(campus);
  }
  if (dateFrom) {
    where.push("date(date_reported) = date(?)");
    params.push(dateFrom);
  }

  const whereClause = where.length ? `WHERE ${where.join(" AND ")}` : "";

  try {
    /* Count for pagination */
    const countRows = await allAsync(
      `SELECT COUNT(*) AS total FROM items ${whereClause}`,
      params,
    );
    const totalItems = countRows[0]?.total || 0;
    const totalPages = Math.max(1, Math.ceil(totalItems / limit));

    /* Rows for this page */
    const itemRows = await allAsync(
      `
      SELECT
        id, item_name, category, campus, location_details, stored_location,
        date_reported, date_lost, date_found, date_claimed, status,
        claimant_name, claimant_contact, notes, image_path
      FROM items
      ${whereClause}
      ORDER BY ${sortExpression} ${sortDir}, id ${sortDir}
      LIMIT ? OFFSET ?
      `,
      [...params, limit, offset],
    );

    return res.json({
      items: itemRows,
      pagination: {
        page,
        limit,
        totalItems,
        totalPages,
      },
    });
  } catch (error) {
    console.error("Failed to load items:", error);
    return res.status(500).json({ error: "Failed to load items" });
  }
}

/* POST new item (multipart form + optional image) */
async function handleCreateItem(req, res) {
  const b = req.body ?? {};
  const item_name = String(b.item_name ?? "").trim();
  const category = String(b.category ?? "").trim();
  const campus = String(b.campus ?? "").trim();
  const status = String(b.status ?? "").trim();

  const allowedCategories = [
    "Electronics",
    "Accessories",
    "Clothing",
    "Keys & ID",
    "School Supplies",
    "Bottles & containers",
    "Sports & Fitness",
    "Documents",
    "Misc",
  ];
  const allowedCampus = ["Burnaby", "Downtown", "Aerospace"];
  const allowedStatus = ["lost", "found", "claimed", "deleted"];

  if (!item_name || !category || !campus || !status) {
    return res.status(400).json({
      error:
        "Missing required fields: item_name, category, campus, and status are required.",
    });
  }
  if (!allowedCategories.includes(category)) {
    return res.status(400).json({ error: "Invalid category." });
  }
  if (!allowedCampus.includes(campus)) {
    return res.status(400).json({ error: "Invalid campus." });
  }
  if (!allowedStatus.includes(status)) {
    return res.status(400).json({ error: "Invalid status." });
  }

  const description = String(b.description ?? "").trim() || null;
  const location_details = String(b.location_details ?? "").trim() || null;
  const stored_location = String(b.stored_location ?? "").trim() || null;
  const date_lost = String(b.date_lost ?? "").trim() || null;
  const date_found = String(b.date_found ?? "").trim() || null;
  const date_claimed = String(b.date_claimed ?? "").trim() || null;
  const claimant_name = String(b.claimant_name ?? "").trim() || null;
  const claimant_contact = String(b.claimant_contact ?? "").trim() || null;
  const notes = String(b.notes ?? "").trim() || null;

  const image_path = req.file ? `/uploads/items/${req.file.filename}` : null;

  try {
    const meta = await runAsync(
      `INSERT INTO items (
          item_name, description, category, campus,
          location_details, stored_location,
          date_lost, date_found, date_claimed,
          status, claimant_name, claimant_contact, notes,
          image_path
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        item_name,
        description,
        category,
        campus,
        location_details,
        stored_location,
        date_lost,
        date_found,
        date_claimed,
        status,
        claimant_name,
        claimant_contact,
        notes,
        image_path,
      ],
    );

    let newId = meta.lastID;
    if (newId == null) {
      const idRows = await allAsync(`SELECT last_insert_rowid() AS id`);
      newId = idRows[0]?.id;
    }

    return res.status(201).json({ success: true, id: newId, image_path });
  } catch (error) {
    console.error("Failed to create item:", error);
    return res.status(500).json({
      error: "Failed to create item",
      detail: String(error?.message || error),
    });
  }
}

/*
 * PUT update item (catalog edit popup).
 * Keeps date_claimed if the form does not send it.
 * New image replaces old file on disk when uploaded.
 */
async function handleUpdateItem(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) {
    return res.status(400).json({ error: "Invalid item id" });
  }

  let existingRows;
  try {
    existingRows = await allAsync(
      `
      SELECT id, image_path, date_claimed
      FROM items
      WHERE id = ?
      LIMIT 1
      `,
      [id],
    );
  } catch (error) {
    console.error("Update item - lookup failed:", error);
    return res.status(500).json({ error: "Failed to update item" });
  }

  if (existingRows.length === 0) {
    return res.status(404).json({ error: "Item not found" });
  }

  const existing = existingRows[0];
  const b = req.body ?? {};
  const item_name = String(b.item_name ?? "").trim();
  const category = String(b.category ?? "").trim();
  const campus = String(b.campus ?? "").trim();
  const status = String(b.status ?? "").trim();

  const allowedCategories = [
    "Electronics",
    "Accessories",
    "Clothing",
    "Keys & ID",
    "School Supplies",
    "Bottles & containers",
    "Sports & Fitness",
    "Documents",
    "Misc",
  ];
  const allowedCampus = ["Burnaby", "Downtown", "Aerospace"];
  const allowedStatus = ["lost", "found", "claimed", "deleted"];

  if (!item_name || !category || !campus || !status) {
    return res.status(400).json({
      error:
        "Missing required fields: item_name, category, campus, and status are required.",
    });
  }
  if (!allowedCategories.includes(category)) {
    return res.status(400).json({ error: "Invalid category." });
  }
  if (!allowedCampus.includes(campus)) {
    return res.status(400).json({ error: "Invalid campus." });
  }
  if (!allowedStatus.includes(status)) {
    return res.status(400).json({ error: "Invalid status." });
  }

  const description = String(b.description ?? "").trim() || null;
  const location_details = String(b.location_details ?? "").trim() || null;
  const stored_location = String(b.stored_location ?? "").trim() || null;
  const date_lost = String(b.date_lost ?? "").trim() || null;
  const date_found = String(b.date_found ?? "").trim() || null;
  /* Edit form has no date_claimed field yet - keep existing value */
  const date_claimed =
    String(b.date_claimed ?? "").trim() || existing.date_claimed || null;
  const claimant_name = String(b.claimant_name ?? "").trim() || null;
  const claimant_contact = String(b.claimant_contact ?? "").trim() || null;
  const notes = String(b.notes ?? "").trim() || null;

  let image_path = existing.image_path;
  /* Optional new photo - delete previous file from uploads folder */
  if (req.file) {
    if (
      existing.image_path &&
      existing.image_path.startsWith("/uploads/items/")
    ) {
      const rel = existing.image_path.replace(/^\//, "");
      const diskPath = path.join(__dirname, "project_web", rel);
      try {
        fs.unlinkSync(diskPath);
      } catch (_unlinkErr) {
        /* previous file already gone - ignore */
      }
    }
    image_path = `/uploads/items/${req.file.filename}`;
  }

  try {
    await runAsync(
      `
      UPDATE items SET
        item_name = ?,
        description = ?,
        category = ?,
        campus = ?,
        location_details = ?,
        stored_location = ?,
        date_lost = ?,
        date_found = ?,
        date_claimed = ?,
        status = ?,
        claimant_name = ?,
        claimant_contact = ?,
        notes = ?,
        image_path = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
      `,
      [
        item_name,
        description,
        category,
        campus,
        location_details,
        stored_location,
        date_lost,
        date_found,
        date_claimed,
        status,
        claimant_name,
        claimant_contact,
        notes,
        image_path,
        id,
      ],
    );

    return res.json({ success: true, id, image_path });
  } catch (error) {
    console.error("Failed to update item:", error);
    return res.status(500).json({
      error: "Failed to update item",
      detail: String(error?.message || error),
    });
  }
}

app
  .route("/api/admin/items")
  .get(requireAdmin, listAdminItems)
  .post(requireAdmin, uploadItemImage.single("image"), handleCreateItem);

/* Patch add-item.html so the form knows this server's URL (helps Live Server setups) */
function injectAppApiOriginMeta(html, req) {
  const origin = `${req.protocol}://${req.get("host")}`;
  return html.replace(
    /<meta\s+name=["']app-api-origin["']\s+content=["'][^"']*["']\s*\/?>/i,
    `<meta name="app-api-origin" content="${origin}">`,
  );
}

app.get("/add-item.html", (req, res) => {
  try {
    const htmlPath = path.join(__dirname, "project_web", "add-item.html");
    let html = fs.readFileSync(htmlPath, "utf8");
    html = injectAppApiOriginMeta(html, req);
    res.type("html").send(html);
  } catch (error) {
    console.error("Failed to serve add-item.html:", error);
    res.status(500).send("Failed to load page");
  }
});

app.put(
  "/api/admin/items/:id",
  requireAdmin,
  uploadItemImage.single("image"),
  handleUpdateItem,
);

/* Return JSON errors for bad uploads (before static files) */
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    const message =
      err.code === "LIMIT_FILE_SIZE"
        ? "Image too large (max 8 MB)."
        : err.code === "LIMIT_UNEXPECTED_FILE"
          ? 'Only one file allowed, field name must be "image".'
          : err.message;
    return res.status(400).json({ error: message });
  }
  if (err) {
    console.error("Unhandled error:", err);
    return res.status(500).json({ error: "Server error", detail: err.message });
  }
  next();
});

/* GET one item by id - catalog View and Edit popup */
app.get("/api/admin/items/:id", requireAdmin, async (req, res) => {
  const id = req.params.id;

  try {
    const rows = await allAsync(
      `
      SELECT 
        id,
        item_name,
        description,
        category,
        campus,
        status,
        location_details,
        stored_location,
        date_lost,
        date_found,
        date_reported,
        claimant_name,
        claimant_contact,
        notes,
        image_path
      FROM items
      WHERE id = ?
      LIMIT 1
      `,
      [id],
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: "Item not found" });
    }

    const item = rows[0];

    return res.json(item);
  } catch (error) {
    console.error("Error fetching item by id:", error);
    return res.status(500).json({ error: "Failed to fetch item" });
  }
});
/* Soft delete - set status to deleted (row stays in DB) */
app.delete("/api/admin/items/:id", requireAdmin, async (req, res) => {
  const id = req.params.id;

  try {
    const rows = await allAsync(
      `
      SELECT id, status
      FROM items
      WHERE id = ?
      LIMIT 1
      `,
      [id],
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: "Item not found" });
    }

    await runAsync(
      `
      UPDATE items
      SET status = 'deleted'
      WHERE id = ?
      `,
      [id],
    );

    return res.json({
      success: true,
      message: "Item deleted successfully",
    });
  } catch (error) {
    console.error("Failed to delete item:", error);

    return res.status(500).json({
      error: "Failed to delete item",
    });
  }
});

/* Serve project_web (HTML, CSS, JS, uploads) - must be after all /api routes */
app.use(express.static(path.join(__dirname, "project_web")));

async function startServer() {
  try {
    await initializeDatabase();
    await ensureItemsImageColumn();
    await ensureTotpSecretColumn();
    await ensureAdminExists();
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Server running at http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error("Startup error:", error);
    process.exit(1);
  }
}

/* npm start only - tests import app without listening */
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  startServer();
}

export { db };
export default app;
