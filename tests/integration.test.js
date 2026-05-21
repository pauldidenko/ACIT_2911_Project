/*
Integration Tests: 
Routes, Middleware, and DB are working
Test image upload functionality @ /tests/fixtures/lost.jpg

--- Public home API tests (added with index.html dynamic tables) ---
These hit GET /api/public/items/recent/lost|found with **no** login cookie. They document the
contract for the browser: 200 JSON, `items` is an array with at most 3 rows, and responses must
not leak private fields like `description` (only the whitelisted columns from app.js).
*/

import { describe, it, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import supertest from "supertest";
import app from "../app.js";
import { db } from "../app.js";
import bcrypt from "bcrypt";

describe("GET /", () => {
  //tests web apps home page is up and running as normal
  it("returns 200 OK: Server is running", async () => {
    const res = await supertest(app).get("/");
    assert.equal(res.status, 200);
  });
  it("Returns the correct content type Header", async () => {
    const res = await supertest(app).get("/");
    assert.ok(res.header["content-type"].includes("text/html"));
  });
});

describe("POST /api/admin/items with image", () => {
  //tests uploading lost item with an image to the server as admin/security
  let agent;

  before(async () => {
    const hash = await bcrypt.hash("pass", 10);
    await new Promise((resolve, reject) => {
      db.run(
        `INSERT OR IGNORE INTO admin_users (username, password_hash, totp_secret) VALUES (?, ?, NULL)`,
        ["test_admin", hash],
        (err) => (err ? reject(err) : resolve()),
      );
    });

    agent = supertest.agent(app);
    await agent
      .post("/api/auth/login")
      .send({ username: "test_admin", password: "pass" });
  });

  it("returns 201 with image_path when image is uploaded", async () => {
    const res = await agent
      .post("/api/admin/items")
      .field("item_name", "Lost Keys")
      .field("category", "Keys & ID")
      .field("campus", "Burnaby")
      .field("status", "found")
      .attach("image", "tests/fixtures/lost.jpg");
    assert.equal(res.status, 201);
    assert.ok(res.body.image_path);
  });
});

describe("POST /api/admin/items", () => {
  //tests uploading lost item (no image)
  let agent;

  before(async () => {
    const hash = await bcrypt.hash("pass", 10);
    await new Promise((resolve, reject) => {
      db.run(
        `INSERT OR IGNORE INTO admin_users (username, password_hash, totp_secret) VALUES (?, ?, NULL)`,
        ["test_admin", hash],
        (err) => (err ? reject(err) : resolve()),
      );
    });

    agent = supertest.agent(app);
    await agent
      .post("/api/auth/login")
      .send({ username: "test_admin", password: "pass" });
  });

  it("Returns 401 ERROR when not logged in", async () => {
    //requires user to be logged in as admin to add items
    const res = await supertest(app)
      .post("/api/admin/items")
      .send({ name: "Test Item", description: "A test item" });
    assert.equal(res.status, 401);
  });
  it("Returns 201 SUCCESS when a valid item is added", async () => {
    const res = await agent.post("/api/admin/items").send({
      item_name: "Lost Wallet",
      category: "Accessories",
      campus: "Burnaby",
      status: "found",
    });
    assert.equal(res.status, 201);
    assert.ok(res.body.id);
  });
});

describe("GET /api/public/items/recent (home preview)", () => {
  /*
   * Public routes used by project_web/js/index.js on the home page.
   * Anyone can call them - assertions make sure we never accidentally expose admin-only fields
   * and that pagination-by-limit stays capped at 3 for both lost and found previews.
   */
  it("returns recent lost items without auth (200, items array, max 3)", async () => {
    const res = await supertest(app).get("/api/public/items/recent/lost");
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.items));
    assert.ok(res.body.items.length <= 3);
    if (res.body.items.length > 0) {
      const row = res.body.items[0];
      assert.ok("item_name" in row);
      assert.ok("campus" in row);
      assert.ok("date_reported" in row);
      assert.ok(!("description" in row));
    }
  });

  it("returns recent found items without auth (200, items array, max 3)", async () => {
    const res = await supertest(app).get("/api/public/items/recent/found");
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.items));
    assert.ok(res.body.items.length <= 3);
    if (res.body.items.length > 0) {
      const row = res.body.items[0];
      assert.ok("item_name" in row);
      assert.ok("campus" in row);
      assert.ok(!("description" in row));
    }
  });
});

after(() => {
  db.run(`DELETE FROM admin_users WHERE username = 'test_admin'`);
  db.close();
});
