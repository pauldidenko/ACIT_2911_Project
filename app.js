/**
 * app.js — Lost & Found backend (Express 5 + SQLite + sessions + multipart uploads).
 *
 * For teammates:
 * - Run: `npm start` (uses PORT and paths from `.env`; defaults in code if missing).
 * - Static files live in `project_web/`; API routes are registered BEFORE `express.static`
 *   so `/api/...` is never confused with a filename.
 * - Admin routes use `requireAdmin` (session must have logged in via POST `/api/auth/login`).
 * - Items: GET/POST `/api/admin/items` is one `app.route()` so GET (list) and POST (create + optional image) stay together.
 * - Images: uploaded to `project_web/uploads/items`, URL stored in DB as `/uploads/items/<filename>`.
 * - `GET /add-item.html` injects `<meta name="app-api-origin">` so the add-item page always knows the real server URL.
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

// Load values from .env into process.env (PORT, DB_FILE, SESSION_SECRET, etc).
dotenv.config();

// In ES modules, __dirname is not available by default, so we rebuild it.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = Number(process.env.PORT) || 5000;

const app = express();

// Allow frontend requests and send cookies (needed for session login).
app.use(
  cors({
    origin: true,
    credentials: true,
  }),
);
app.use(bodyParser.json());

// Session middleware stores login state in a server-side session + browser cookie.
app.use(
  session({
    secret: process.env.SESSION_SECRET || "dev-only-change-this-secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      maxAge: 1000 * 60 * 60 * 8, // 8 hours
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

// `items.image_path`: rename legacy `image_path_name` if present, else add column if missing.
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

// Safety check: app should not run without at least one admin account.
async function ensureAdminExists() {
  const users = await allAsync(`SELECT id, username FROM admin_users LIMIT 1`);
  if (users.length > 0) return;

  throw new Error(
    'No admin user found in database. Insert one into "admin_users" before starting the server.',
  );
}

// Middleware used by protected routes (admin-only endpoints).
function requireAdmin(req, res, next) {
  if (!req.session.isAdmin) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

// Uploaded item photos: stored under project_web/uploads/items and served as /uploads/items/...
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

// API routes are registered BEFORE express.static (same idea as template_server.js: session + routes,
// then static). That way POST /api/... is never ambiguous, and a stray file under project_web/ cannot shadow an API path.

// Default page route.
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "project_web", "index.html"));
});

// Login endpoint: verify username + bcrypt password hash, then create session.
app.post("/api/auth/login", async (req, res) => {
  const { username, password } = req.body ?? {};

  if (!username || !password) {
    return res
      .status(400)
      .json({ error: "Username and password are required" });
  }

  try {
    const users = await allAsync(
      `SELECT id, username, password_hash FROM admin_users WHERE username = ?`,
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

    req.session.isAdmin = true;
    req.session.adminId = admin.id;
    req.session.username = admin.username;

    return res.json({ success: true, username: admin.username });
  } catch (error) {
    console.error("Login error:", error);
    return res.status(500).json({ error: "Server error during login" });
  }
});

// Logout endpoint: destroy active session.
app.post("/api/auth/logout", requireAdmin, (req, res) => {
  req.session.destroy((err) => {
    if (err) return res.status(500).json({ error: "Failed to log out" });
    return res.json({ success: true });
  });
});

// Session-check endpoint used by frontend to know if user is already logged in.
app.get("/api/auth/session", (req, res) => {
  if (!req.session.isAdmin) return res.json({ authenticated: false });
  return res.json({
    authenticated: true,
    username: req.session.username,
  });
});

// Simple protected test route (useful for debugging auth quickly).
app.get("/api/admin/health", requireAdmin, (_req, res) => {
  res.json({ ok: true, message: "Admin session active" });
});

// Main catalog API: GET list + POST create on same path (single Route — fixes POST not matching when registered separately on Express 5 / router).
async function listAdminItems(req, res) {
  // Pagination controls.
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 10));
  const offset = (page - 1) * limit;

  // Filter values from query string.
  const search = String(req.query.search || "").trim();
  const category = String(req.query.category || "").trim();
  const status = String(req.query.status || "").trim();
  const campus = String(req.query.campus || "").trim();
  const dateFrom = String(req.query.dateFrom || "").trim();

  // Whitelist allowed sort columns to avoid SQL injection in ORDER BY.
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

  // Build dynamic WHERE clause only for provided filters.
  const where = [];
  const params = [];

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
  if (status) {
    where.push("status = ?");
    params.push(status);
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
    // Query 1: total matching rows (for pagination metadata).
    const countRows = await allAsync(
      `SELECT COUNT(*) AS total FROM items ${whereClause}`,
      params,
    );
    const totalItems = countRows[0]?.total || 0;
    const totalPages = Math.max(1, Math.ceil(totalItems / limit));

    // Query 2: current page of item rows.
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

// Create item (multipart: text fields + optional single image). Admin only.
// template_server.js uses paths like /admin/... — we expose both /api/admin/items and /admin/items.
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

app
  .route("/api/admin/items")
  .get(requireAdmin, listAdminItems)
  .post(requireAdmin, uploadItemImage.single("image"), handleCreateItem);

app.post(
  "/admin/items",
  requireAdmin,
  uploadItemImage.single("image"),
  handleCreateItem,
);

/** When serving add-item from Express, inject the real origin so the browser always POSTs to this server (any PORT). */
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

// Multer errors → JSON (keep before static so POST failures never fall through to HTML-only stacks).
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

// Static HTML/CSS/JS/uploads (after API routes + HTML overrides).
app.use(express.static(path.join(__dirname, "project_web")));

// App startup sequence: initialize DB, ensure admin exists, then listen.
async function startServer() {
  try {
    await initializeDatabase();
    await ensureItemsImageColumn();
    await ensureAdminExists();
    app.listen(PORT, () => {
      console.log(`Server running at http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error("Startup error:", error);
    process.exit(1);
  }
}

// Entry point.
startServer();

export default app;
