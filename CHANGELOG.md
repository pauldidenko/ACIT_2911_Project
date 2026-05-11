# Foundit Changelog

| **Date**   | **Change**                                      | **USER** |
| ---------- | ----------------------------------------------- | -------- |
| 2026-04-28 | Initialized Repo                                | Paul     |
| 2026-04-29 | Created Changelog                               | Daniel   |
| 2026-04-29 | Created README.md                               | Troy     |
| 2026-04-29 | Moved changelog into designated CHANGELOG.md    | Troy     |
| 2026-04-29 | Created web folder,added index.html,style.css   | Ariana   |
| 2026-04-30 | Created app.js file and empty folders           | Daniel   |
| 2026-05-01 | Created DB design in schema.sql                 | Paul     |
| 2026-05-01 | Added template_server.js file for reference     | Paul     |
| 2026-05-04 | Created tests folder and unit/integration files | Daniel   |
| 2026-05-06 | Backend (`app.js`): admin session + bcrypt login; SQLite catalog API (`GET`/`POST` `/api/admin/items`) using **`app.route()`** so list + create share one path (fixes `Cannot POST` with Express 5); optional image upload via **multer** → `project_web/uploads/items`, URLs stored as `/uploads/items/...`; **`GET /add-item.html`** injects `<meta name="app-api-origin">` so the browser targets the correct host/port; multer JSON error handler registered before static files | Paul |
| 2026-05-06 | Add Item UI (`add-item.html`, `add-item.js`, `add-item.css`): multipart form submits to POST `/api/admin/items` with **`credentials: "include"`**; **`resolveApiBase()`** finds Node when using Live Server / wrong port (probes `/api/auth/session`, meta tag, common ports); success/error **`#pageBanner`** + scroll-to-top + redirect to **`catalog.html`** | Paul |
| 2026-05-06 | Catalog (`catalog.html`, `catalog.js`, `catalog.css`): filter/search/sort/pagination table fed by **`GET /api/admin/items`**; **“+ Add Item”** button styled like **Reset filters** but light green; **`lost_body.css`** updated so **`catalog-add-btn`** matches | Paul |
| 2026-05-06 | Removed **Date claimed** field from add-item form (still nullable in DB / API if set elsewhere) | Paul |
| 2026-05-06 | **`hash.js`**: CLI bcrypt helper for generating **`admin_users`** password hashes | Paul |
| 2026-05-06 | Documentation: file-level / teammate comments added to **`app.js`**, **`add-item.*`**, **`catalog.*`**, **`login.css`**, **`account.html`**, **`lost_body.css`**, **`hash.js`** | Paul |
