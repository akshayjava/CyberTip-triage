import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the officers DB module
vi.mock("../../db/officers.js", () => ({
  getOfficerByBadge: vi.fn(),
  recordLogin: vi.fn(),
  revokeJTI: vi.fn(),
  isJTIRevoked: vi.fn(),
}));

describe("JWT Auth Configuration", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules(); // Ensure modules are re-evaluated
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("should throw error if JWT_SECRET is missing", async () => {
    delete process.env.JWT_SECRET;

    // Attempt to import the module without JWT_SECRET
    // This expects the module to throw immediately on load
    await expect(() => import("../../auth/jwt.js")).rejects.toThrowError(/JWT_SECRET/);
  });

  it("should load successfully if JWT_SECRET is present", async () => {
    process.env.JWT_SECRET = "test-secret-value";
    const jwt = await import("../../auth/jwt.js");
    expect(jwt).toBeDefined();
  });
});

describe("JWT Auth Functions", () => {
  let jwtModule: typeof import("../../auth/jwt.js");
  let dbMock: any;

  beforeEach(async () => {
    vi.resetModules();
    process.env.JWT_SECRET = "test-secret-value";

    // Dynamic import to pick up the env var
    jwtModule = await import("../../auth/jwt.js");

    // Get the mocked module
    dbMock = await import("../../db/officers.js");
    vi.clearAllMocks();
  });

  it("should login successfully with valid credentials", async () => {
    // Generate a valid hash using the module's helper
    const password = "password123";
    const passwordHash = jwtModule.hashPassword(password);

    const mockOfficer = {
      officer_id: "123",
      badge_number: "BADGE123",
      name: "Test Officer",
      role: "investigator",
      unit: "ICAC",
      active: true,
      password_hash: passwordHash,
      max_concurrent_cases: 20,
    };

    // Mock the DB response
    dbMock.getOfficerByBadge.mockResolvedValue(mockOfficer);
    dbMock.recordLogin.mockResolvedValue(undefined);

    const response = await jwtModule.login({ badge_number: "BADGE123", password });

    expect(response.token).toBeDefined();
    expect(response.session.officer_id).toBe("123");
    expect(dbMock.recordLogin).toHaveBeenCalledWith("123");
  });

  it("should verify a valid token", async () => {
    const password = "password123";
    const passwordHash = jwtModule.hashPassword(password);

    const mockOfficer = {
      officer_id: "123",
      badge_number: "BADGE123",
      name: "Test Officer",
      role: "investigator",
      unit: "ICAC",
      active: true,
      password_hash: passwordHash,
    };
    dbMock.getOfficerByBadge.mockResolvedValue(mockOfficer);
    dbMock.isJTIRevoked.mockResolvedValue(false);

    // Login to get a token
    const { token } = await jwtModule.login({ badge_number: "BADGE123", password });

    // Verify the token
    const session = await jwtModule.verifyToken(token);
    expect(session).not.toBeNull();
    expect(session?.officer_id).toBe("123");
  });
});
