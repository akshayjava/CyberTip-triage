import { describe, it, expect, mock, beforeAll } from "bun:test";

// Mock the officers DB module before importing jwt.js
mock.module("../../db/officers.js", () => ({
  getOfficerByBadge: mock(() => Promise.resolve(null)),
  recordLogin: mock(() => Promise.resolve()),
  updatePasswordHash: mock(() => Promise.resolve()),
  revokeJTI: mock(() => Promise.resolve()),
  isJTIRevoked: mock(() => Promise.resolve(false)),
}));

describe("Password Hashing Security Fix", () => {
  let jwt: typeof import("../../auth/jwt.js");
  let db: any;

  beforeAll(async () => {
    process.env.JWT_SECRET = "a-very-long-and-secure-secret-for-testing-purposes-only";
    jwt = await import("../../auth/jwt.js");
    db = await import("../../db/officers.js");
  });

  it("should use 600,000 iterations for new hashes", () => {
    const hash = jwt.hashPassword("password123");
    expect(hash).toContain(":600000:");
    expect(hash).toStartWith("pbkdf2:600000:");
  });

  it("should verify passwords with old iteration counts (backward compatibility)", () => {
    // Manually create a 100k iteration hash (the old default)
    // We use node's crypto to ensure we're testing against a standard PBKDF2
    const crypto = require("crypto");
    const salt = "test-salt";
    const derived = crypto.pbkdf2Sync("password123", salt, 100000, 32, "sha256").toString("hex");
    const oldHash = `pbkdf2:100000:${salt}:${derived}`;

    expect(jwt.verifyPassword("password123", oldHash)).toBe(true);
    expect(jwt.verifyPassword("wrong-password", oldHash)).toBe(false);
  });

  it("should upgrade hash iterations on successful login", async () => {
    const officerId = "test-officer-id";
    const salt = "test-salt";
    const crypto = require("crypto");
    const derived = crypto.pbkdf2Sync("password123", salt, 100000, 32, "sha256").toString("hex");
    const oldHash = `pbkdf2:100000:${salt}:${derived}`;

    const mockOfficer = {
      officer_id: officerId,
      badge_number: "BADGE-001",
      name: "Security Test Officer",
      role: "investigator",
      unit: "ICAC",
      active: true,
      password_hash: oldHash,
    };

    db.getOfficerByBadge.mockResolvedValue(mockOfficer);

    await jwt.login({ badge_number: "BADGE-001", password: "password123" });

    // Verify updatePasswordHash was called
    expect(db.updatePasswordHash).toHaveBeenCalled();

    // The second argument should be the new hash with 600k iterations
    const lastCall = db.updatePasswordHash.mock.calls[db.updatePasswordHash.mock.calls.length - 1];
    expect(lastCall[0]).toBe(officerId);
    expect(lastCall[1]).toContain(":600000:");

    // Verify it's actually valid
    expect(jwt.verifyPassword("password123", lastCall[1])).toBe(true);
  });

  it("should NOT upgrade if iteration count is already 600,000 or higher", async () => {
    const officerId = "test-officer-id-2";
    const modernHash = jwt.hashPassword("password123");

    const mockOfficer = {
      officer_id: officerId,
      badge_number: "BADGE-002",
      name: "Security Test Officer 2",
      role: "investigator",
      unit: "ICAC",
      active: true,
      password_hash: modernHash,
    };

    db.getOfficerByBadge.mockResolvedValue(mockOfficer);
    db.updatePasswordHash.mockClear();

    await jwt.login({ badge_number: "BADGE-002", password: "password123" });

    expect(db.updatePasswordHash).not.toHaveBeenCalled();
  });
});
