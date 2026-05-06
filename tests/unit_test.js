import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";
import { parseSortDir, calcOffset, formatDate, toTitleCase } from "../utils.js";

// parseSortDir() Tests
describe("parseSortDir()", () => {
  // Test 1: Testing the default sorter, descending (DESC)
  it("returns DESC by default", () => {
    assert.strictEqual(parseSortDir(undefined), "DESC");
  });

  // Test 2: Testing the ascending sorter (ASC)
  it("returns ASC when input is 'asc'", () => {
    assert.strictEqual(parseSortDir("asc"), "ASC");
  });

  // Test 3: Case insensitivity
  it("is case-insensitive", () => {
    assert.strictEqual(parseSortDir("ASC"), "ASC");
  });

  // Test 4: Unexpected input falls back to DESC
  it("returns DESC for unrecognized input", () => {
    assert.strictEqual(parseSortDir("meow"), "DESC");
  });
});

// calcOffset() Tests
describe("calcOffset()", () => {
  // Test 5: First page has no offset
  it("returns 0 for page 1", () => {
    assert.strictEqual(calcOffset(1, 10), 0);
  });

  // Test 6: Second page offset
  it("returns 10 for page 2 with limit 10", () => {
    assert.strictEqual(calcOffset(2, 10), 10);
  });

  // Test 7: Negative page stays at 1
  it("clamps negative page to 1", () => {
    assert.strictEqual(calcOffset(-5, 10), 0);
  });
});

// formatDate() Tests
describe("formatDate()", () => {
  // Test 8: Null input
  it("returns dash for null", () => {
    assert.strictEqual(formatDate(null), "-");
  });

  // Test 9: Invalid date string falls back
  it("returns original value for invalid date", () => {
    assert.strictEqual(formatDate("not-a-date"), "not-a-date");
  });
});

// toTitleCase() Tests
describe("toTitleCase()", () => {
  // Test 10: Capitalizes first letter
  it("capitalizes lost", () => {
    assert.strictEqual(toTitleCase("lost"), "Lost");
  });

  // Test 11: Null returns dash
  it("returns dash for null", () => {
    assert.strictEqual(toTitleCase(null), "-");
  });
});

// Filter Tests (beforeEach demo)
describe("item status filtering", () => {
  let mockItems;

  beforeEach(() => {
    // Resets the array fresh before each test
    mockItems = [
      { item_name: "Wallet", status: "lost" },
      { item_name: "AirPods", status: "found" },
      { item_name: "Keys", status: "lost" },
    ];
  });

  // Test 12: Filter lost items
  it("returns only lost items", () => {
    const lost = mockItems.filter((i) => i.status === "lost");
    assert.strictEqual(lost.length, 2);
  });

  // Test 13: Filter found items
  it("returns only found items", () => {
    const found = mockItems.filter((i) => i.status === "found");
    assert.strictEqual(found.length, 1);
  });

  // Test 14: Filter returns empty for unknown status
  it("returns empty for unknown status", () => {
    const claimed = mockItems.filter((i) => i.status === "claimed");
    assert.strictEqual(claimed.length, 0);
  });
});
