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

// Serve static frontend files from project_web/.
app.use(express.static(path.join(__dirname, "project_web")));

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

// Main catalog API: supports filters, search, sorting, and pagination.
app.get("/api/admin/items", requireAdmin, async (req, res) => {
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
        claimant_name, claimant_contact, notes
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
});

// App startup sequence: initialize DB, ensure admin exists, then listen.
async function startServer() {
  try {
    await initializeDatabase();
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
