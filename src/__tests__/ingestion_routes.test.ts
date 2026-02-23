import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import request from "supertest";
import { mountIngestionRoutes } from "../ingestion/routes.js";
import { upsertAgency } from "../db/agencies.js";
import { v4 as uuidv4 } from "uuid";

// Setup test app
const app = express();
app.use(express.json());
mountIngestionRoutes(app);

describe("Agency API Key Validation", () => {
  const activeKey = "active-key-123";
  const inactiveKey = "inactive-key-456";
  const activeAgencyName = "Active Agency";

  beforeAll(async () => {
    // Ensure DB mode is memory for tests unless overridden,
    // but upsertAgency handles memory mode too.
    process.env["DB_MODE"] = "memory";

    // Seed data
    await upsertAgency({
      agency_id: uuidv4(),
      name: activeAgencyName,
      api_key: activeKey,
      status: "active",
      created_at: new Date().toISOString()
    });

    await upsertAgency({
      agency_id: uuidv4(),
      name: "Inactive Agency",
      api_key: inactiveKey,
      status: "inactive",
      created_at: new Date().toISOString()
    });
  });

  it("should accept valid active API key", async () => {
    const res = await request(app)
      .post("/intake/agency")
      .set("x-agency-key", activeKey)
      .set("x-agency-name", "Some Header Name") // Should be ignored in favor of registry name
      .send({ content: "test tip content" });

    expect(res.status).toBe(200);
    // The route returns { received: true, job_id: ..., agency: agencyName }
    expect(res.body.agency).toBe(activeAgencyName);
  });

  it("should reject inactive API key", async () => {
    const res = await request(app)
      .post("/intake/agency")
      .set("x-agency-key", inactiveKey)
      .set("x-agency-name", "Inactive Agency")
      .send({ content: "test tip" });

    // Expect 403 Forbidden
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("Unauthorized agency");
  });

  it("should reject unknown API key", async () => {
    const res = await request(app)
      .post("/intake/agency")
      .set("x-agency-key", "unknown-key-999")
      .set("x-agency-name", "Unknown Agency")
      .send({ content: "test tip" });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe("Unauthorized agency");
  });

  it("should return 401 if key is missing", async () => {
    const res = await request(app)
      .post("/intake/agency")
      // No x-agency-key
      .set("x-agency-name", "Some Agency")
      .send({ content: "test tip" });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Missing agency credentials");
  });

  it("should return 401 if name header is missing", async () => {
    // Even if key is valid, existing middleware logic requires name header
    const res = await request(app)
      .post("/intake/agency")
      .set("x-agency-key", activeKey)
      // No x-agency-name
      .send({ content: "test tip" });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Missing agency credentials");
  });
});
