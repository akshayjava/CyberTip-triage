import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { mountSetupRoutes } from '../../api/setup_routes.js';
import * as fsPromises from 'fs/promises';

// Mock fs/promises
vi.mock('fs/promises', () => ({
  writeFile: vi.fn(),
  access: vi.fn().mockResolvedValue(undefined),
  readdir: vi.fn().mockResolvedValue([]),
  stat: vi.fn().mockResolvedValue({ isDirectory: () => true }),
  mkdir: vi.fn().mockResolvedValue(undefined),
}));

// Mock auth middleware to bypass authentication
vi.mock('../../auth/middleware.js', () => ({
  authMiddleware: (req: any, res: any, next: any) => next(),
  requireRole: () => (req: any, res: any, next: any) => next(),
}));

describe('Setup Configuration Injection Vulnerability', () => {
  let app: express.Application;

  beforeEach(() => {
    vi.clearAllMocks();
    app = express();
    app.use(express.json());
    mountSetupRoutes(app);
  });

  it('should reject malicious environment variables via agencyName', async () => {
    const maliciousPayload = {
      agencyName: 'My Agency"\nINJECTED_VAR=hacked\n#',
      agencyState: 'CA',
      contactEmail: 'admin@example.com',
      port: '3000',
      mode: 'node',
      apiKey: 'test-key',
      idsEnabled: false,
      ncmecEnabled: false,
      emailEnabled: false,
      forensicsTools: [],
    };

    const res = await request(app)
      .post('/api/setup/save')
      .send(maliciousPayload);

    // Verify the request was rejected
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Agency name cannot contain newlines or double quotes');

    // Verify that writeFile was NOT called
    const writeFileMock = fsPromises.writeFile as unknown as ReturnType<typeof vi.fn>;
    expect(writeFileMock).not.toHaveBeenCalled();
  });

  it('should reject malicious environment variables via idsEmail', async () => {
    const maliciousPayload = {
      agencyName: 'Valid Agency',
      agencyState: 'CA',
      contactEmail: 'admin@example.com',
      port: '3000',
      mode: 'node',
      apiKey: 'test-key',
      idsEnabled: true,
      idsEmail: 'investigator@agency.gov\nINJECTED_VAR=hacked',
      ncmecEnabled: false,
      emailEnabled: false,
      forensicsTools: [],
    };

    const res = await request(app)
      .post('/api/setup/save')
      .send(maliciousPayload);

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('IDS Email cannot contain newlines or double quotes');

    const writeFileMock = fsPromises.writeFile as unknown as ReturnType<typeof vi.fn>;
    expect(writeFileMock).not.toHaveBeenCalled();
  });

  it('should reject malicious environment variables via agencyState', async () => {
    const maliciousPayload = {
      agencyName: 'Valid Agency',
      agencyState: 'CA"\nINJECTED_STATE=hacked\n#',
      contactEmail: 'admin@example.com',
      port: '3000',
      mode: 'node',
      apiKey: 'test-key',
      idsEnabled: false,
      ncmecEnabled: false,
      emailEnabled: false,
      forensicsTools: [],
    };

    const res = await request(app)
      .post('/api/setup/save')
      .send(maliciousPayload);

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('State cannot contain newlines or double quotes');

    const writeFileMock = fsPromises.writeFile as unknown as ReturnType<typeof vi.fn>;
    expect(writeFileMock).not.toHaveBeenCalled();
  });

  it('should accept valid configuration', async () => {
    const validPayload = {
      agencyName: 'Valid Agency',
      agencyState: 'CA',
      contactEmail: 'admin@example.com',
      port: '3000',
      mode: 'node',
      apiKey: 'test-key',
      idsEnabled: false,
      ncmecEnabled: false,
      emailEnabled: false,
      forensicsTools: [],
    };

    const res = await request(app)
      .post('/api/setup/save')
      .send(validPayload);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const writeFileMock = fsPromises.writeFile as unknown as ReturnType<typeof vi.fn>;
    expect(writeFileMock).toHaveBeenCalled();
    const writtenContent = writeFileMock.mock.calls[0][1] as string;
    expect(writtenContent).toContain('AGENCY_NAME="Valid Agency"');
  });
});
