import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";
import { apiLimiter } from "../../middleware/rate-limit.js";

describe("Rate Limiting Middleware", () => {
  it("should verify that apiLimiter is active and setting headers", async () => {
    // 1. Setup a test app mirroring src/index.ts structure
    const app = express();

    // Apply the limiter to /api
    app.use("/api", apiLimiter);

    // Add a dummy route
    app.get("/api/test", (_req, res) => {
      res.json({ status: "ok" });
    });

    // 2. Make the first request
    const res1 = await request(app).get("/api/test");
    expect(res1.status).toBe(200);

    // Check for standard RateLimit headers (draft-7)
    // express-rate-limit with standardHeaders: true sends:
    // RateLimit-Limit, RateLimit-Remaining, RateLimit-Reset
    const limitHeader = res1.headers["ratelimit-limit"];
    const remainingHeader = res1.headers["ratelimit-remaining"];

    expect(limitHeader).toBeDefined();
    expect(remainingHeader).toBeDefined();

    const limit = parseInt(limitHeader as string, 10);
    const remaining1 = parseInt(remainingHeader as string, 10);

    expect(limit).toBe(1000); // Configured max
    // Remaining should be limit - 1 (or close to it)
    expect(remaining1).toBeLessThan(limit);

    // 3. Make a second request to ensure counter decreases
    const res2 = await request(app).get("/api/test");
    const remaining2 = parseInt(res2.headers["ratelimit-remaining"] as string, 10);

    expect(remaining2).toBeLessThan(remaining1);
  });
});
