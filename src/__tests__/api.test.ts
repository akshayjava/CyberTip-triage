/**
 * API Route Tests — HTTP integration tests
 *
 * Tests all REST API endpoints for correct behavior, auth, and edge cases.
 * Uses a lightweight Express app instance — no real DB or AI calls.
 */

import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { mountApiRoutes } from "../api/routes.js";
import { mountSetupRoutes } from "../api/setup_routes.js";
import { mountIngestionRoutes } from "../ingestion/routes.js";

// ── Test app setup ────────────────────────────────────────────────────────────

function buildTestApp() {
  const app = express();
  app.use(express.json());
  // Mock session for requireRole middleware used in setup routes
  app.use((req, res, next) => {
    // @ts-expect-error - Mocking session
    req.session = { role: "admin" };
    next();
  });
  mountApiRoutes(app);
  mountSetupRoutes(app);
  mountIngestionRoutes(app);
  return app;
}

const app = buildTestApp();

// ── Health endpoints ──────────────────────────────────────────────────────────

describe("GET /health", () => {
  it("returns 200 with status: ok", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(res.body.ts).toBeTruthy();
  });
});

describe("GET /health/detailed", () => {
  beforeAll(() => {
    process.env["DB_MODE"] = "memory";
    process.env["QUEUE_MODE"] = "memory";
  });

  it("returns 200 with api: ok", async () => {
    const res = await request(app).get("/health/detailed");
    expect(res.status).toBe(200);
    expect(res.body.api).toBe("ok");
  });

  it("reports db as memory when DB_MODE=memory", async () => {
    process.env["DB_MODE"] = "memory";
    const res = await request(app).get("/health/detailed");
    expect(res.body.db).toBe("memory");
  });

  it("reports stub_dir_exists as boolean", async () => {
    const res = await request(app).get("/health/detailed");
    expect(typeof res.body.stub_dir_exists).toBe("boolean");
  });

  it("reports anthropic key as missing when not set", async () => {
    const saved = process.env["ANTHROPIC_API_KEY"];
    delete process.env["ANTHROPIC_API_KEY"];
    const res = await request(app).get("/health/detailed");
    expect(res.body.anthropic).toBe("missing");
    process.env["ANTHROPIC_API_KEY"] = saved;
  });
});

// ── Queue endpoint ─────────────────────────────────────────────────────────────

describe("GET /api/queue", () => {
  it("returns 200 with object keyed by tier", async () => {
    const res = await request(app).get("/api/queue");
    expect(res.status).toBe(200);
    expect(typeof res.body).toBe("object");
  });

  it("accepts tier filter param", async () => {
    const res = await request(app).get("/api/queue?tier=IMMEDIATE");
    expect(res.status).toBe(200);
  });

  it("returns empty structure when no tips in queue", async () => {
    const res = await request(app).get("/api/queue");
    expect(res.status).toBe(200);
    // Each tier bucket should be array (possibly empty)
    for (const value of Object.values(res.body as Record<string, unknown>)) {
      expect(Array.isArray(value)).toBe(true);
    }
  });
});

// ── Stats endpoint ────────────────────────────────────────────────────────────

describe("GET /api/stats", () => {
  it("returns 200 with expected shape", async () => {
    const res = await request(app).get("/api/stats");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("queue");
    expect(res.body).toHaveProperty("tips");
  });

  it("includes tips.total count", async () => {
    const res = await request(app).get("/api/stats");
    expect(typeof res.body.tips?.total).toBe("number");
  });
});

// ── Tip detail endpoint ───────────────────────────────────────────────────────

describe("GET /api/tips/:id", () => {
  it("returns 404 for unknown tip_id", async () => {
    const res = await request(app).get("/api/tips/nonexistent-id-12345");
    expect(res.status).toBe(404);
  });

  it("returns 400 for empty id", async () => {
    // Express won't match empty param, so this hits the queue route
    const res = await request(app).get("/api/tips/");
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});

// ── Warrant update endpoint ───────────────────────────────────────────────────

describe("POST /api/tips/:id/warrant/:fileId", () => {
  it("returns 404 for unknown tip", async () => {
    const res = await request(app)
      .post("/api/tips/unknown-tip/warrant/unknown-file")
      .send({ status: "granted" });
    expect(res.status).toBe(404);
  });

  it("returns 400 for invalid warrant status", async () => {
    const res = await request(app)
      .post("/api/tips/any-tip/warrant/any-file")
      .send({ status: "invalid_status" });
    expect(res.status).toBe(400);
  });

  it("accepts valid warrant statuses", async () => {
    const validStatuses = ["applied", "granted", "denied"];
    for (const status of validStatuses) {
      const res = await request(app)
        .post("/api/tips/some-tip/warrant/some-file")
        .send({ status });
      // 404 is OK (tip doesn't exist) but NOT 400
      expect(res.status).not.toBe(400);
    }
  });
});

// ── Assignment endpoint ───────────────────────────────────────────────────────

describe("POST /api/tips/:id/assign", () => {
  it("returns 404 for unknown tip", async () => {
    const res = await request(app)
      .post("/api/tips/unknown/assign")
      .send({ investigator: "Det. Smith" });
    expect(res.status).toBe(404);
  });

  it("returns 400 if investigator not provided", async () => {
    const res = await request(app)
      .post("/api/tips/any-tip/assign")
      .send({});
    expect(res.status).toBe(400);
  });
});

// ── Crisis endpoint ───────────────────────────────────────────────────────────

describe("GET /api/crisis", () => {
  it("returns 200 with array", async () => {
    const res = await request(app).get("/api/crisis");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

// ── Clusters endpoint ─────────────────────────────────────────────────────────

describe("GET /api/clusters", () => {
  it("returns 200 with array", async () => {
    const res = await request(app).get("/api/clusters");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

// ── Setup save endpoint ───────────────────────────────────────────────────────

describe("POST /api/setup/save", () => {
  it("returns 400 when agencyName is missing", async () => {
    const res = await request(app)
      .post("/api/setup/save")
      .send({ agencyState: "CA", mode: "docker", port: "3000" });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("Agency name");
  });

  it("returns 400 when agencyState is missing", async () => {
    const res = await request(app)
      .post("/api/setup/save")
      .send({ agencyName: "Test Task Force", mode: "docker", port: "3000" });
    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid mode", async () => {
    const res = await request(app)
      .post("/api/setup/save")
      .send({ agencyName: "Test", agencyState: "CA", mode: "invalid", port: "3000" });
    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid port", async () => {
    const res = await request(app)
      .post("/api/setup/save")
      .send({ agencyName: "Test", agencyState: "CA", mode: "docker", port: "99999" });
    expect(res.status).toBe(400);
  });

  it("returns 400 for port below 1024", async () => {
    const res = await request(app)
      .post("/api/setup/save")
      .send({ agencyName: "Test", agencyState: "CA", mode: "docker", port: "80" });
    expect(res.status).toBe(400);
  });
});

// ── Ingestion route auth tests ────────────────────────────────────────────────

describe("POST /intake/agency — Auth required", () => {
  it("returns 401 without API key header", async () => {
    const res = await request(app)
      .post("/intake/agency")
      .send({ body: "tip content", agency: "test" });
    expect(res.status).toBe(401);
  });

  it("returns 401 with invalid API key", async () => {
    process.env["INTER_AGENCY_API_KEYS"] = "valid-key-123";
    const res = await request(app)
      .post("/intake/agency")
      .set("x-agency-key", "wrong-key")
      .send({ body: "tip content", agency: "test" });
    expect(res.status).toBe(401);
  });

  it("accepts valid API key", async () => {
    process.env["INTER_AGENCY_API_KEYS"] = "valid-key-123";
    const res = await request(app)
      .post("/intake/agency")
      .set("x-agency-key", "valid-key-123")
      .set("x-agency-name", "Test Agency")
      .send({ body: "tip content" });
    expect(res.status).not.toBe(401);
  });
});

describe("POST /intake/portal — HMAC signature required", () => {
  it("returns 401 without signature header", async () => {
    process.env["VPN_PORTAL_SECRET"] = "test-secret";
    const res = await request(app)
      .post("/intake/portal")
      .send({ body: "tip content" });
    expect(res.status).toBe(401);
  });
});
