/*
Integration Tests: 
Routes, Middleware, and DB are working
Test image upload functionality @ /tests/fixtures/lost.jpg
*/

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import supertest from "supertest";
import app from "../app.js";

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
    agent = supertest.agent(app); // simulats logged-in admin
    await agent
      .post("/api/auth/login")
      .send({ username: "admin", password: "pass" });
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
    agent = supertest.agent(app);
    await agent
      .post("/api/auth/login")
      .send({ username: "admin", password: "pass" });
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

describe("DELETE /api/admin/items/:id", () => {
  //tests DELETE functionality, (we do not have that implemented yet)
  it("Prevents Deletion of an Item Without Admin Credentials", async () => {
    const res = await supertest(app).delete("/api/admin/items/1");
    assert.strictEqual(res.status, 401);
  });
});
