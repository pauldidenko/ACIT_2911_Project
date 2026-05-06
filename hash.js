/**
 * hash.js — one-off CLI helper to bcrypt-hash a password.
 *
 * Use when adding or resetting an admin row in SQLite (`admin_users.password_hash`).
 *
 * Usage (from project root):
 *   node hash.js "YourPlainPassword"
 *
 * Copy the printed hash into INSERT/UPDATE for `admin_users` — never commit real passwords.
 */

import bcrypt from "bcrypt";

const plain = process.argv[2];
if (!plain) {
  console.error("Usage: node hash.js <password>");
  process.exit(1);
}

const hash = await bcrypt.hash(plain, 12);
console.log(hash);