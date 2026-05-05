// This file is for hashing passwords.
// node hash.js "MyStrongPassword!"

import bcrypt from "bcrypt";

const plain = process.argv[2];
if (!plain) {
  console.error("Usage: node hash.js <password>");
  process.exit(1);
}

const hash = await bcrypt.hash(plain, 12);
console.log(hash);