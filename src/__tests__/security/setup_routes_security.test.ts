import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { mountSetupRoutes } from '../../api/setup_routes.js';

// Mock fs/promises to prevent side effects
vi.mock('fs/promises', () => ({
  writeFile: vi.fn(),
  access: vi.fn().mockResolvedValue(undefined),
  readdir: vi.fn().mockResolvedValue([]),
  stat: vi.fn(),
  mkdir: vi.fn(),
}));

describe('Setup Routes Security', () => {
  let app: express.Application;

  beforeEach(() => {
    vi.resetModules();
  });

  it('should deny non-admin access to /api/setup/save', async () => {
    app = express();
    app.use(express.json());

    // Simulate an authenticated investigator (non-admin)
    app.use((req, res, next) => {
      req.session = {
        officer_id: '1',
        badge_number: '123',
        name: 'Investigator',
        role: 'investigator', // Not admin
        unit: 'ICAC',
        specialty: null,
        max_concurrent_cases: 1,
        jti: '1',
        iat: 1,
        exp: 1,
        last_active_at: new Date().toISOString()
      } as any;
      next();
    });

    mountSetupRoutes(app);

    const res = await request(app)
      .post('/api/setup/save')
      .send({ agencyName: 'Test Agency', agencyState: 'NY', mode: 'node', port: '3000' });

    // Expect 403 Forbidden
    // If this fails with 200, the vulnerability exists.
    expect(res.status).toBe(403);
    if (res.status === 403) {
      expect(res.body.error).toContain("requires admin role");
    }
  });

  it('should allow admin access to /api/setup/save', async () => {
    app = express();
    app.use(express.json());

    // Simulate an authenticated admin
    app.use((req, res, next) => {
      req.session = {
        officer_id: '99',
        badge_number: 'ADM-01',
        name: 'Admin',
        role: 'admin', // Admin
        unit: 'ICAC',
        specialty: null,
        max_concurrent_cases: 99,
        jti: '99',
        iat: 1,
        exp: 1,
        last_active_at: new Date().toISOString()
      } as any;
      next();
    });

    mountSetupRoutes(app);

    const res = await request(app)
      .post('/api/setup/save')
      .send({ agencyName: 'Test Agency', agencyState: 'NY', mode: 'node', port: '3000' });

    expect(res.status).toBe(200);
    expect(res.body.message).toBe("Configuration saved");
  });
});
