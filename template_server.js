import express from "express";
import bodyParser from "body-parser";
import sqlite3 from "sqlite3";
import path from "path";
import cors from "cors";
import session from "express-session";
import bcrypt from "bcrypt";
import nodemailer from "nodemailer";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { authenticator } from "otplib";
import QRCode from "qrcode";
import multer from "multer";
import fs from "fs";

dotenv.config();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// -------------------------------
// Middleware
// -------------------------------
app.use(
  cors({
    origin: true,
    credentials: true,
  })
);

app.use(bodyParser.json());

// ? Session MUST come BEFORE static/public routes
app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      maxAge: 1000 * 60 * 60,
    },
  })
);

// Static files AFTER session
app.use(express.static(path.join(__dirname, "public")));

// -------------------------------
// Database
// -------------------------------
const dbPath = path.resolve(__dirname, "Bookings.db");

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) console.error("? Database error:", err.message);
  else console.log("? Connected to SQLite:", dbPath);
});

const allAsync = (sql, params = []) =>
  new Promise((resolve, reject) =>
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)))
  );

const runAsync = (sql, params = []) =>
  new Promise((resolve, reject) =>
    db.run(sql, params, function (err) {
      err ? reject(err) : resolve(this);
    })
  );

// -------------------------------
// Email setup
// -------------------------------
const mailer = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// -------------------------------
// Routes
// -------------------------------
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "calendar.html"));
});

// -------------------------------
// Admin Login
// -------------------------------
app.post("/admin/login", async (req, res) => {
  const { username, password, totpCode } = req.body;
  try {
    const admins = await allAsync(`SELECT * FROM Admins WHERE username = ?`, [
      username,
    ]);
    if (admins.length === 0)
      return res.status(401).json({ error: "Invalid credentials" });

    const admin = admins[0];
    const valid = await bcrypt.compare(password, admin.password_hash);
    if (!valid) return res.status(401).json({ error: "Invalid credentials" });

    // Check if 2FA is enabled
    if (admin.totp_secret) {
      // 2FA is enabled - require TOTP code
      if (!totpCode) {
        return res.json({ requires2FA: true });
      }
      
      // Verify TOTP code
      const isValid = authenticator.verify({
        token: totpCode,
        secret: admin.totp_secret,
      });
      
      if (!isValid) {
        return res.status(401).json({ error: "Invalid 2FA code" });
      }
    }

    req.session.isAdmin = true;
    req.session.username = username; // Store username in session
    res.json({ success: true });
  } catch (err) {
    console.error("? Admin login error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// -------------------------------
// 2FA Setup Endpoints
// -------------------------------
app.get("/admin/2fa/status", requireAdmin, async (req, res) => {
  try {
    const username = req.session.username;
    if (!username) return res.status(400).json({ error: "Username not found in session" });
    
    const admins = await allAsync(`SELECT totp_secret FROM Admins WHERE username = ?`, [username]);
    if (admins.length === 0) return res.status(404).json({ error: "Admin not found" });
    
    res.json({ has2FA: !!admins[0].totp_secret });
  } catch (err) {
    console.error("? 2FA status error:", err);
    res.status(500).json({ error: "Failed to check 2FA status" });
  }
});

app.get("/admin/2fa/setup", requireAdmin, async (req, res) => {
  try {
    const username = req.session.username;
    if (!username) return res.status(400).json({ error: "Username not found in session" });
    
    const admins = await allAsync(`SELECT * FROM Admins WHERE username = ?`, [username]);
    if (admins.length === 0) return res.status(404).json({ error: "Admin not found" });

    // Generate a new secret
    const secret = authenticator.generateSecret();
    const serviceName = "MOVIN Dance Admin";
    const accountName = username;
    
    // Create OTP Auth URL
    const otpauth = authenticator.keyuri(accountName, serviceName, secret);
    
    // Generate QR code as data URL
    let qrCodeUrl;
    try {
      qrCodeUrl = await QRCode.toDataURL(otpauth, {
        errorCorrectionLevel: 'M',
        type: 'image/png',
        quality: 0.92,
        margin: 1
      });
    } catch (qrErr) {
      console.error("QR code generation error:", qrErr);
      // Continue without QR code - user can use manual entry
      qrCodeUrl = null;
    }
    
    // Store secret temporarily in session (don't save to DB yet)
    req.session.temp2FASecret = secret;
    
    res.json({ 
      secret, 
      qrCode: qrCodeUrl,
      manualEntryKey: secret // For manual entry if QR code doesn't work
    });
  } catch (err) {
    console.error("? 2FA setup error:", err);
    res.status(500).json({ error: "Failed to generate 2FA setup" });
  }
});

app.post("/admin/2fa/verify", requireAdmin, async (req, res) => {
  const { totpCode } = req.body;
  try {
    const tempSecret = req.session.temp2FASecret;
    if (!tempSecret) {
      return res.status(400).json({ error: "No 2FA setup in progress" });
    }

    const isValid = authenticator.verify({
      token: totpCode,
      secret: tempSecret,
    });

    if (!isValid) {
      return res.status(400).json({ error: "Invalid code" });
    }

    res.json({ success: true });
  } catch (err) {
    console.error("? 2FA verify error:", err);
    res.status(500).json({ error: "Failed to verify code" });
  }
});

app.post("/admin/2fa/enable", requireAdmin, async (req, res) => {
  try {
    const username = req.session.username;
    if (!username) return res.status(400).json({ error: "Username not found in session" });
    
    const tempSecret = req.session.temp2FASecret;
    if (!tempSecret) {
      return res.status(400).json({ error: "No 2FA setup in progress" });
    }

    await runAsync(
      `UPDATE Admins SET totp_secret = ? WHERE username = ?`,
      [tempSecret, username]
    );

    delete req.session.temp2FASecret;
    res.json({ success: true });
  } catch (err) {
    console.error("? 2FA enable error:", err);
    res.status(500).json({ error: "Failed to enable 2FA" });
  }
});

app.post("/admin/2fa/disable", requireAdmin, async (req, res) => {
  try {
    const username = req.session.username;
    if (!username) return res.status(400).json({ error: "Username not found in session" });
    
    await runAsync(
      `UPDATE Admins SET totp_secret = NULL WHERE username = ?`,
      [username]
    );
    res.json({ success: true });
  } catch (err) {
    console.error("? 2FA disable error:", err);
    res.status(500).json({ error: "Failed to disable 2FA" });
  }
});

app.post("/admin/logout", requireAdmin, (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error("? Logout error:", err);
      return res.status(500).json({ error: "Failed to logout" });
    }
    res.json({ success: true });
  });
});

function requireAdmin(req, res, next) {
  if (!req.session.isAdmin)
    return res.status(403).json({ error: "Unauthorized" });
  next();
}

// -------------------------------
// Bookings
// -------------------------------
app.get("/admin/bookings", requireAdmin, async (req, res) => {
  try {
    const bookings = await allAsync(
      `SELECT * FROM Bookings ORDER BY start_date DESC`
    );
    res.json(bookings);
  } catch (err) {
    console.error("? Failed to load bookings:", err);
    res.status(500).json({ error: "Failed to load admin bookings" });
  }
});

app.post("/admin/bookings/:id/status", requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  try {
    const booking = await allAsync(
      `SELECT * FROM Bookings WHERE booking_id = ?`,
      [id]
    );
    if (!booking[0])
      return res.status(404).json({ error: "Booking not found" });

    const b = booking[0];

    await runAsync(`UPDATE Bookings SET status = ? WHERE booking_id = ?`, [
      status,
      id,
    ]);

    let userSubject = "";
    let userHtml = "";
    let adminSubject = "";
    let adminHtml = "";

    if (status === "confirmed") {
      userSubject = "Booking Confirmed";
      userHtml = `
        <div style="font-family: Arial, sans-serif; line-height: 1.5; color: #333;">
          <p>Hi ${b.name},</p>
          <p>${
            b.start_date === b.end_date
              ? `Your booking for <strong>${b.start_date}</strong> has been confirmed.`
              : `Your booking from <strong>${b.start_date}</strong> to <strong>${b.end_date}</strong> has been confirmed.`
          }</p>
          <p><strong>Booking details:</strong><br>
             School: ${b.organization || "N/A"}<br>
             Address: ${b.address || "N/A"}<br>
             Participants: ${b.participants || "N/A"}<br>
             Details: ${b.details || "N/A"}</p>
          <p>Thank you,<br>MOVIN Dance<br>movindance.com</p>
        </div>
      `;
      adminSubject = "Booking Confirmed";
      adminHtml = `<div style="font-family: Arial, sans-serif; line-height: 1.5; color: #333;">
        <p><strong>Booking has been confirmed:</strong></p>
        <p>Name: ${b.name}<br>Email: ${b.email}<br>
        Dates: ${b.start_date}${
        b.start_date !== b.end_date ? ` to ${b.end_date}` : ""
      }<br>
        School: ${b.organization || "N/A"}<br>
        Address: ${b.address || "N/A"}<br>
        Participants: ${b.participants || "N/A"}<br>
        Details: ${b.details || "N/A"}</p></div>`;
    } else if (status === "denied") {
      userSubject = "Booking Denied";
      userHtml = `
        <div style="font-family: Arial, sans-serif; line-height: 1.5; color: #333;">
          <p>Hi ${b.name},</p>
          <p>${
            b.start_date === b.end_date
              ? `Your booking for <strong>${b.start_date}</strong> has been denied.`
              : `Your booking from <strong>${b.start_date}</strong> to <strong>${b.end_date}</strong> has been denied.`
          }</p>
          <p><strong>Booking details:</strong><br>
             School: ${b.organization || "N/A"}<br>
             Address: ${b.address || "N/A"}<br>
             Participants: ${b.participants || "N/A"}<br>
             Details: ${b.details || "N/A"}</p>
          <p>Thank you,<br>MOVIN Dance<br>movindance.com</p>
        </div>
      `;
      adminSubject = "Booking Denied";
      adminHtml = `<div style="font-family: Arial, sans-serif; line-height: 1.5; color: #333;">
        <p><strong>A booking has been denied:</strong></p>
        <p>Name: ${b.name}<br>Email: ${b.email}<br>
        Dates: ${b.start_date}${
        b.start_date !== b.end_date ? ` to ${b.end_date}` : ""
      }<br>
        School: ${b.organization || "N/A"}<br>
        Address: ${b.address || "N/A"}<br>
        Participants: ${b.participants || "N/A"}<br>
        Details: ${b.details || "N/A"}</p></div>`;
    }

    if (status === "confirmed" || status === "denied") {
      mailer.sendMail(
        {
          from: process.env.EMAIL_USER,
          to: b.email,
          subject: userSubject,
          html: userHtml,
        },
        (err) => {
          if (err) console.error("? User email error:", err);
        }
      );
      mailer.sendMail(
        {
          from: process.env.EMAIL_USER,
          to: process.env.EMAIL_USER,
          subject: adminSubject,
          html: adminHtml,
        },
        (err) => {
          if (err) console.error("? Admin email error:", err);
        }
      );
    }

    res.json({ success: true });
  } catch (err) {
    console.error("? Failed to update booking:", err);
    res.status(500).json({ error: "Failed to update booking" });
  }
});

// -------------------------------
// Camps routes (admin)
// -------------------------------
app.get("/admin/camps", requireAdmin, async (req, res) => {
  try {
    const camps = await allAsync(
      `SELECT * FROM Camps ORDER BY start_date ASC`
    );
    res.json(camps);
  } catch (err) {
    console.error("? Failed to load camps:", err);
    res.status(500).json({ error: "Failed to load camps" });
  }
});

app.post("/admin/camps", requireAdmin, async (req, res) => {
  const { camp_name, start_date, end_date, time, location, max_participants, min_age, max_age, status } =
    req.body;
  try {
    await runAsync(
      `INSERT INTO Camps (camp_name, start_date, end_date, time, location, max_participants, min_age, max_age, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        camp_name,
        start_date,
        end_date,
        time || "",
        location,
        max_participants,
        min_age,
        max_age,
        status || "open",
      ]
    );
    res.json({ success: true });
  } catch (err) {
    console.error("? Failed to create camp:", err);
    res.status(500).json({ error: "Failed to create camp" });
  }
});

app.post("/admin/camps/:id/status", requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  try {
    await runAsync(`UPDATE Camps SET status = ? WHERE camp_id = ?`, [
      status,
      id,
    ]);
    res.json({ success: true });
  } catch (err) {
    console.error("? Failed to update camp status:", err);
    res.status(500).json({ error: "Failed to update camp status" });
  }
});

// -------------------------------
// Edit / Update Camp
// -------------------------------
app.patch("/admin/camps/:id", requireAdmin, async (req, res) => {
  const { id } = req.params;
  const {
    camp_name,
    start_date,
    end_date,
    time,
    location,
    max_participants,
    min_age,
    max_age,
    status
  } = req.body;

  try {
    const result = await runAsync(
      `UPDATE Camps
       SET camp_name = ?, start_date = ?, end_date = ?, time = ?, location = ?,
           max_participants = ?, min_age = ?, max_age = ?, status = ?
       WHERE camp_id = ?`,
      [
        camp_name,
        start_date,
        end_date,
        time || "",
        location,
        max_participants,
        min_age,
        max_age,
        status || "open",
        id
      ]
    );

    res.json({ success: true });
  } catch (err) {
    console.error("? Failed to update camp:", err);
    res.status(500).json({ error: "Failed to update camp" });
  }
});

app.get("/admin/camps/:id/participants", requireAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    const participants = await allAsync(
      `SELECT * FROM Participants WHERE camp_id = ?`,
      [id]
    );
    res.json(participants);
  } catch (err) {
    console.error("? Failed to load camp participants:", err);
    res.status(500).json({ error: "Failed to load participants" });
  }
});

// -------------------------------
// Camps (home page)
// -------------------------------

// Get home page camps info
app.get("/admin/home-camps", requireAdmin, async (req, res) => {
  try {
    const rows = await allAsync(`SELECT * FROM Home_Camps WHERE id = 1`);
    if (rows.length === 0) {
      // create default row if missing
      await runAsync(`INSERT INTO Home_Camps (id, title) VALUES (1, '')`);
      return res.json({ id: 1, title: '', image_path: null, featured_camp_1: null, featured_camp_2: null });
    }
    res.json(rows[0]);
  } catch (err) {
    console.error("? Failed to load home camps:", err);
    res.status(500).json({ error: "Failed to load home camps" });
  }
});

// Update home camps info
app.post("/admin/home-camps", requireAdmin, async (req, res) => {
  const { title, image_path, featured_camp_1, featured_camp_2 } = req.body;
  try {
    // Build dynamic UPDATE query - only update columns that are provided
    const updates = [];
    const values = [];

    if (title !== undefined) {
      updates.push('title = ?');
      values.push(title);
    }

    if (image_path !== undefined) {
      updates.push('image_path = ?');
      values.push(image_path || null);
    }

    if (featured_camp_1 !== undefined) {
      updates.push('featured_camp_1 = ?');
      values.push(featured_camp_1 || null);
    }

    if (featured_camp_2 !== undefined) {
      updates.push('featured_camp_2 = ?');
      values.push(featured_camp_2 || null);
    }

    if (updates.length === 0) {
      return res.json({ success: true }); // Nothing to update
    }

    // Add WHERE clause value
    values.push(1);

    await runAsync(
      `UPDATE Home_Camps
       SET ${updates.join(', ')}
       WHERE id = ?`,
      values
    );
    res.json({ success: true });
  } catch (err) {
    console.error("? Failed to update home camps:", err);
    res.status(500).json({ error: "Failed to update home camps" });
  }
});

app.get("/admin/available-camps", requireAdmin, async (req, res) => {
  try {
    const camps = await allAsync(`
      SELECT camp_id, camp_name, start_date, end_date
      FROM Camps
      WHERE status = 'open' AND date(start_date) >= date('now')
      ORDER BY start_date ASC
    `);
    res.json(camps);
  } catch (err) {
    console.error("? Failed to load available camps:", err);
    res.status(500).json({ error: "Failed to load available camps" });
  }
});

// -------------------------------
// Ensure upload directory exists
// -------------------------------
const uploadDir = path.join(__dirname, "public", "uploads", "home-camps");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

// -------------------------------
// Multer storage setup
// -------------------------------
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    // sanitize filename and add timestamp to avoid collisions
    const ext = path.extname(file.originalname);
    const name = path.basename(file.originalname, ext).replace(/\s+/g, "-");
    cb(null, `${name}${ext}`);
  },
});

const upload = multer({ storage });

// -------------------------------
// Upload route
// -------------------------------
app.post(
  "/admin/home-camps/upload-image",
  requireAdmin,
  upload.single("image"),
  async (req, res) => {
    if (!req.file) return res.status(400).send("No file uploaded");

    const image_path = `/uploads/home-camps/${req.file.filename}`;

    try {
      // Save to database
      await runAsync(
        `UPDATE Home_Camps SET image_path = ? WHERE id = 1`,
        [image_path]
      );

      // Just send OK, no JSON needed
      res.send("Image uploaded and DB updated");
    } catch (err) {
      console.error("? DB update error:", err);
      res.status(500).send("Failed to save image to database");
    }
  }
);

app.delete('/admin/home-camps/image', async (req, res) => {
  try {
    const rows = await allAsync('SELECT image_path FROM Home_Camps LIMIT 1');
    if (!rows || !rows[0].image_path) return res.json({ success: true });

    const imagePath = rows[0].image_path;

    // Corrected: join __dirname with 'public' and remove leading slash
    const filePath = path.join(__dirname, 'public', imagePath.replace(/^\//, ''));

    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log(`Deleted file: ${filePath}`);
    } else {
      console.warn(`File not found: ${filePath}`);
    }

    await runAsync('UPDATE Home_Camps SET image_path = NULL');

    return res.json({ success: true });
  } catch (err) {
    console.error('Error deleting home camps image:', err);
    return res.status(500).json({ success: false, error: 'Failed to delete image' });
  }
});

// -------------------------------
// Public: home page camps
// -------------------------------
app.get("/api/home-camps", async (req, res) => {
  try {
    const rows = await allAsync(`SELECT * FROM Home_Camps WHERE id = 1`);
    if (!rows.length) {
      return res.json({
        title: "Upcoming Camps",
        image_path: null,
        featured_camp_1: null,
        featured_camp_2: null,
      });
    }
    res.json(rows[0]);
  } catch (err) {
    console.error("Failed to load public home camps:", err);
    res.status(500).json({ error: "Failed to load home camps" });
  }
});

// -------------------------------
// Reviews Section
// -------------------------------
// Ensure upload directories exist for reviews
[1, 2, 3].forEach(reviewId => {
  const reviewDir = path.join(__dirname, "public", "uploads", `review${reviewId}`);
  if (!fs.existsSync(reviewDir)) fs.mkdirSync(reviewDir, { recursive: true });
});

// Multer storage for reviews (keeps original filename)
const reviewStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const reviewId = req.params.id;
    cb(null, path.join(__dirname, "public", "uploads", `review${reviewId}`));
  },
  filename: (req, file, cb) => {
    // Keep original filename
    cb(null, file.originalname);
  },
});

const reviewUpload = multer({ storage: reviewStorage });

// Get a review
app.get("/admin/reviews/:id", requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const rows = await allAsync(`SELECT * FROM Reviews WHERE review_id = ?`, [id]);
    if (!rows.length) {
      return res.json({ title: '', description: '', image_path: null });
    }
    res.json(rows[0]);
  } catch (err) {
    console.error("Failed to load review:", err);
    res.status(500).json({ error: "Failed to load review" });
  }
});

// Update a review
app.post("/admin/reviews/:id", requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { title, description, image_path } = req.body;
    
    // Check if review exists
    const existing = await allAsync(`SELECT review_id FROM Reviews WHERE review_id = ?`, [id]);
    
    if (existing.length === 0) {
      // Create new review
      await runAsync(
        `INSERT INTO Reviews (review_id, title, description, image_path) VALUES (?, ?, ?, ?)`,
        [id, title, description, image_path || null]
      );
    } else {
      // Update existing review
      await runAsync(
        `UPDATE Reviews SET title = ?, description = ?, image_path = ? WHERE review_id = ?`,
        [title, description, image_path || null, id]
      );
    }
    
    res.json({ success: true });
  } catch (err) {
    console.error("Failed to update review:", err);
    res.status(500).json({ error: "Failed to update review" });
  }
});

// Upload image for a review
app.post(
  "/admin/reviews/:id/upload-image",
  requireAdmin,
  reviewUpload.single("image"),
  async (req, res) => {
    if (!req.file) return res.status(400).send("No file uploaded");

    const reviewId = req.params.id;
    const image_path = `/uploads/review${reviewId}/${req.file.originalname}`;

    try {
      // Update database
      const existing = await allAsync(`SELECT review_id FROM Reviews WHERE review_id = ?`, [reviewId]);
      
      if (existing.length === 0) {
        await runAsync(
          `INSERT INTO Reviews (review_id, title, description, image_path) VALUES (?, ?, ?, ?)`,
          [reviewId, '', '', image_path]
        );
      } else {
        await runAsync(
          `UPDATE Reviews SET image_path = ? WHERE review_id = ?`,
          [image_path, reviewId]
        );
      }

      res.send("Image uploaded and DB updated");
    } catch (err) {
      console.error("DB update error:", err);
      res.status(500).send("Failed to save image to database");
    }
  }
);

// Delete image for a review
app.delete("/admin/reviews/:id/image", requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const rows = await allAsync(`SELECT image_path FROM Reviews WHERE review_id = ?`, [id]);
    if (!rows || !rows[0] || !rows[0].image_path) return res.json({ success: true });

    const imagePath = rows[0].image_path;
    const filePath = path.join(__dirname, "public", imagePath.replace(/^\//, ""));

    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log(`Deleted file: ${filePath}`);
    } else {
      console.warn(`File not found: ${filePath}`);
    }

    await runAsync(`UPDATE Reviews SET image_path = NULL WHERE review_id = ?`, [id]);

    return res.json({ success: true });
  } catch (err) {
    console.error("Error deleting review image:", err);
    return res.status(500).json({ success: false, error: "Failed to delete image" });
  }
});


app.get("/api/available-camps", async (req, res) => {
  try {
    const camps = await allAsync(`
      SELECT camp_id, camp_name, start_date, end_date
      FROM Camps
      WHERE status = 'open'
      ORDER BY start_date ASC
    `);
    res.json(camps);
  } catch (err) {
    console.error("Failed to load public camps:", err);
    res.status(500).json({ error: "Failed to load camps" });
  }
});

// Get all reviews for public display
app.get("/api/reviews", async (req, res) => {
  try {
    const reviews = await allAsync(`
      SELECT review_id, title, description, image_path
      FROM Reviews
      WHERE review_id IN (1, 2, 3)
      ORDER BY review_id ASC
    `);
    res.json(reviews);
  } catch (err) {
    console.error("Failed to load reviews:", err);
    res.status(500).json({ error: "Failed to load reviews" });
  }
});

// -------------------------------
// Days Off routes (admin)
// -------------------------------
app.get("/admin/days-off", requireAdmin, async (req, res) => {
  try {
    const daysOff = await allAsync(
      `SELECT * FROM Days_Off ORDER BY start_date ASC`
    );
    res.json(daysOff);
  } catch (err) {
    console.error("? Failed to load days off:", err);
    res.status(500).json({ error: "Failed to load days off" });
  }
});

app.post("/admin/days-off", requireAdmin, async (req, res) => {
  const { start_date, end_date, description } = req.body;
  try {
    await runAsync(
      `INSERT INTO Days_Off (start_date, end_date, description) VALUES (?, ?, ?)`,
      [start_date, end_date, description]
    );
    res.json({ success: true });
  } catch (err) {
    console.error("? Failed to create days off:", err);
    res.status(500).json({ error: "Failed to create days off" });
  }
});

app.patch("/admin/days-off/:id", requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { start_date, end_date, description } = req.body;
  try {
    await runAsync(
      `UPDATE Days_Off SET start_date = ?, end_date = ?, description = ? WHERE days_off_id = ?`,
      [start_date, end_date, description, id]
    );
    res.json({ success: true });
  } catch (err) {
    console.error("? Failed to update days off:", err);
    res.status(500).json({ error: "Failed to update days off" });
  }
});

app.delete("/admin/days-off/:id", requireAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    await runAsync(
      `DELETE FROM Days_Off WHERE days_off_id = ?`,
      [id]
    );
    res.json({ success: true });
  } catch (err) {
    console.error("? Failed to delete days off:", err);
    res.status(500).json({ error: "Failed to delete days off" });
  }
});

// -------------------------------
// CSV Export Route
// -------------------------------
app.get("/admin/export/:table", requireAdmin, async (req, res) => {
  const { table } = req.params;
  const allowedTables = ["Bookings", "Camps", "Participants", "Days_Off"];
  
  if (!allowedTables.includes(table)) return res.status(400).json({ error: "Invalid table" });

  try {
    const rows = await allAsync(`SELECT * FROM ${table}`);
    if (!rows.length) return res.status(404).json({ error: "No data to export" });

    // Convert rows to CSV
    const headers = Object.keys(rows[0]);
    const csv = [
      headers.join(","), // header row
      ...rows.map(row => headers.map(h => {
        let val = row[h] === null || row[h] === undefined ? "" : row[h].toString();
        // Escape quotes & wrap in quotes if necessary
        return val.includes(",") || val.includes("\n") || val.includes('"')
          ? `"${val.replace(/"/g, '""')}"`
          : val;
      }).join(","))
    ].join("\n");

    res.header("Content-Type", "text/csv");
    res.attachment(`${table}.csv`);
    res.send(csv);

  } catch (err) {
    console.error(`Error exporting ${table}:`, err);
    res.status(500).json({ error: "Failed to export table" });
  }
});


// -------------------------------
// Public API: unavailable dates
// -------------------------------
app.get("/api/unavailable", async (req, res) => {
  try {
    const bookings = await allAsync(
      `SELECT start_date, end_date FROM Bookings WHERE status = 'confirmed'`
    );
    const camps = await allAsync(
      `SELECT start_date, end_date FROM Camps WHERE status != 'past'`
    );
    const daysOff = await allAsync(`SELECT start_date, end_date FROM Days_Off`);

    const expandRange = (start, end) => {
      const result = [];
      const s = new Date(start);
      const e = new Date(end);
      for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
        result.push(d.toISOString().split("T")[0]);
      }
      return result;
    };

    let unavailable = [
      ...bookings.flatMap((r) => expandRange(r.start_date, r.end_date)),
      ...camps.flatMap((r) => expandRange(r.start_date, r.end_date)),
      ...daysOff.flatMap((r) => expandRange(r.start_date, r.end_date)),
    ];

    unavailable = [...new Set(unavailable)];
    res.json({ unavailable });
  } catch (err) {
    console.error("? Error fetching unavailable dates:", err);
    res.status(500).json({ error: "Failed to fetch unavailable dates" });
  }
});

// -------------------------------
// Public API: new booking
// -------------------------------
app.post("/api/bookings", async (req, res) => {
  const {
    name,
    email,
    start_date,
    end_date,
    organization,
    address,
    participants,
    details,
  } = req.body;
  try {
    await runAsync(
      `INSERT INTO Bookings (name, email, start_date, end_date, organization, address, participants, details) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        name,
        email,
        start_date,
        end_date,
        organization,
        address,
        participants,
        details,
      ]
    );

    const newBooking = await allAsync(
      `SELECT * FROM Bookings WHERE rowid = last_insert_rowid()`
    );
    const b = newBooking[0];

    const userSubject = "Booking Received";
    const userHtml = `
      <div style="font-family: Arial, sans-serif; line-height: 1.5; color: #333;">
        <p>Hi ${b.name},</p>
        <p>${b.start_date === b.end_date
          ? `Your booking for <strong>${b.start_date}</strong> is received and pending review.`
          : `Your booking from <strong>${b.start_date}</strong> to <strong>${b.end_date}</strong> is received and pending review.`}</p>
        <p><strong>Booking details:</strong><br>
           School: ${b.organization || "N/A"}<br>
           Address: ${b.address || "N/A"}<br>
           Participants: ${b.participants || "N/A"}<br>
           Details: ${b.details || "N/A"}</p>
        <p>Thank you,<br>MOVIN Dance<br>movindance.com</p>
      </div>
    `;

    const adminSubject = "New Booking Pending";
    const adminHtml = `
      <div style="font-family: Arial, sans-serif; line-height: 1.5; color: #333;">
        <p><strong>A new booking has been received:</strong></p>
        <p>Name: ${b.name}<br>Email: ${b.email}<br>
        Dates: ${b.start_date}${b.start_date !== b.end_date ? ` to ${b.end_date}` : ""}<br>
        School: ${b.organization || "N/A"}<br>
        Address: ${b.address || "N/A"}<br>
        Participants: ${b.participants || "N/A"}<br>
        Details: ${b.details || "N/A"}</p>
      </div>
    `;

    mailer.sendMail(
      { from: process.env.EMAIL_USER, to: b.email, subject: userSubject, html: userHtml },
      (err) => { if (err) console.error("? User pending email error:", err); }
    );
    mailer.sendMail(
      { from: process.env.EMAIL_USER, to: process.env.EMAIL_USER, subject: adminSubject, html: adminHtml },
      (err) => { if (err) console.error("? Admin pending email error:", err); }
    );

    res.json({ success: true });
  } catch (err) {
    console.error("? Booking insert error:", err);
    res.status(500).json({ error: "Failed to submit booking" });
  }
});

// -------------------------------
// Public API: camps dropdown
// -------------------------------
app.get("/api/camps", async (req, res) => {
  try {
    const camps = await allAsync(`
      SELECT c.camp_id, c.camp_name, c.start_date, c.end_date, c.time, c.location, c.max_participants,
             COUNT(p.participants_id) AS current_participants
      FROM Camps c
      LEFT JOIN Participants p ON c.camp_id = p.camp_id
      WHERE c.status = 'open' AND date(c.end_date) >= date('now')
      GROUP BY c.camp_id
      HAVING COUNT(p.participants_id) < c.max_participants
      ORDER BY c.start_date ASC
    `);
    res.json(camps);
  } catch (err) {
    console.error("? Failed to load public camps:", err);
    res.status(500).json({ error: "Failed to load camps" });
  }
});

// -------------------------------
// Public API: register participant
// -------------------------------
app.post("/api/camps/:id/register", async (req, res) => {
  const { id } = req.params;
  const { registration_name, participant_name, email, birth_date, details } = req.body;

  try {
    const camp = (await allAsync(`SELECT * FROM Camps WHERE camp_id = ?`, [id]))[0];
    if (!camp) return res.status(404).json({ error: "Camp not found" });

    // ----------- AGE CHECK -----------
    const birth = new Date(birth_date);
    const today = new Date();
    let age = today.getFullYear() - birth.getFullYear();
    const m = today.getMonth() - birth.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
    if (age < camp.min_age || age > camp.max_age) {
      return res.status(400).json({
        error: `Participant age must be between ${camp.min_age} and ${camp.max_age}`
      });
    }
    // -------------------------------

    await runAsync(
      `INSERT INTO Participants (camp_id, registration_name, participant_name, email, birth_date, details)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, registration_name, participant_name, email, birth_date, details]
    );

    const userHtml = `
      <div style="font-family: Arial, sans-serif; line-height: 1.5; color: #333;">
        <p>Hi ${registration_name},</p>
        <p><strong>You have been registered for ${camp.camp_name} (${camp.start_date}   ${camp.end_date}).</strong></p>
        <p><strong>Time: ${camp.time}</strong></p>
        <p><strong>Location: ${camp.location}</strong></p>
        <p>Participant: ${participant_name}<br>
           Birth Date: ${birth_date}<br>
           Details: ${details || "N/A"}</p>
        <p>Thank you,<br>MOVIN Dance<br>movindance.com</p>
      </div>
    `;
    const adminHtml = `
      <div style="font-family: Arial, sans-serif; line-height: 1.5; color: #333;">
        <p><strong>New participant registered:</strong></p>
        <p>Registratant: ${registration_name}<br>
        Participant: ${participant_name}<br>
        Email: ${email}<br>
        Birth Date: ${birth_date}<br>
        Details: ${details || "N/A"}<br>
        Camp: ${camp.camp_name} (${camp.start_date}   ${camp.end_date})</p>
      </div>
    `;

    mailer.sendMail({ from: process.env.EMAIL_USER, to: email, subject: "Camp Registration", html: userHtml });
    mailer.sendMail({ from: process.env.EMAIL_USER, to: process.env.EMAIL_USER, subject: "New Camp Participant", html: adminHtml });

    res.json({ success: true });
  } catch (err) {
    console.error("? Participant registration error:", err);
    res.status(500).json({ error: "Failed to register participant" });
  }
});

// -------------------------------
// Camp Reminder System
// -------------------------------
// Ensure reminder_sent column exists (for existing databases)
async function ensureReminderColumnExists() {
  try {
    await runAsync(`ALTER TABLE Participants ADD COLUMN reminder_sent INTEGER DEFAULT 0`);
    console.log("? Added reminder_sent column to Participants table");
  } catch (err) {
    // Column might already exist, which is fine
    if (!err.message.includes("duplicate column")) {
      console.error("? Error checking reminder_sent column:", err.message);
    }
  }
}

async function sendCampReminders() {
  try {
    const now = new Date();
    const targetDate = new Date(now);
    targetDate.setHours(targetDate.getHours() + 24);
    const targetDateStr = targetDate.toISOString().split('T')[0];

    const camps = await allAsync(`
      SELECT camp_id, camp_name, start_date, end_date, time, location
      FROM Camps
      WHERE date(start_date) = date(?)
        AND status IN ('open', 'closed')
    `, [targetDateStr]);

    if (camps.length === 0) return;

    let totalSent = 0;

    for (const camp of camps) {
      const participants = await allAsync(`
        SELECT participants_id, registration_name, participant_name, email
        FROM Participants
        WHERE camp_id = ? AND (reminder_sent IS NULL OR reminder_sent = 0)
      `, [camp.camp_id]);

      for (const p of participants) {
        const reminderHtml = `
          <div style="font-family: Arial, sans-serif; line-height: 1.5; color: #333;">
            <p>Hi ${p.registration_name},</p>
            <p><strong>This is a friendly reminder that ${camp.camp_name} starts tomorrow (${camp.start_date})!</strong></p>
            <p><strong>Camp Details:</strong><br>
               Camp: ${camp.camp_name}<br>
               Start Date: ${camp.start_date}<br>
               End Date: ${camp.end_date}<br>
               Time: ${camp.time}<br>
               Location: ${camp.location || "TBA"}</p>
            ${p.participant_name ? `<p>Participant: ${p.participant_name}</p>` : ''}
            <p>We look forward to seeing you there!</p>
            <p>Thank you,<br>MOVIN Dance<br>movindance.com</p>
          </div>
        `;

        try {
          await new Promise((resolve, reject) => {
            mailer.sendMail({
              from: process.env.EMAIL_USER,
              to: p.email,
              subject: `Reminder: ${camp.camp_name} Starts Tomorrow`,
              html: reminderHtml,
            }, (err) => err ? reject(err) : resolve());
          });

          await runAsync(`
            UPDATE Participants SET reminder_sent = 1 WHERE participants_id = ?
          `, [p.participants_id]);

          totalSent++;
          await new Promise(r => setTimeout(r, 500)); // Delay between emails
        } catch (err) {
          console.error(`? Error sending reminder to ${p.email}:`, err);
        }
      }
    }

    if (totalSent > 0) {
      console.log(`? Camp reminders sent: ${totalSent} emails`);
    }
  } catch (err) {
    console.error('? Error in sendCampReminders:', err);
  }
}

// -------------------------------
// Start server
// -------------------------------
// Ensure database schema is up to date
ensureReminderColumnExists().then(() => {
  app.listen(PORT, () => {
    console.log(`? Server running on port ${PORT}`);
    console.log(`? Camp reminder system initialized (checks every hour)`);
    
    // Run immediately on startup, then every hour
    sendCampReminders();
    setInterval(sendCampReminders, 60 * 60 * 1000);
  });
});