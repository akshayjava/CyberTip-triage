import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { mountSetupRoutes } from '../api/setup_routes.js';
import * as fsPromises from 'fs/promises';

vi.mock('fs/promises', () => ({
  writeFile: vi.fn(),
  access: vi.fn().mockResolvedValue(undefined),
  readdir: vi.fn().mockResolvedValue([]),
  stat: vi.fn().mockResolvedValue({ isDirectory: () => true }),
  mkdir: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../auth/middleware.js', () => ({
  authMiddleware: (_req: any, _res: any, next: any) => next(),
  requireRole: () => (_req: any, _res: any, next: any) => next(),
}));

const BASE_PAYLOAD = {
  agencyName: 'Test Agency',
  agencyState: 'CA',
  contactEmail: 'admin@example.com',
  port: '3000',
  mode: 'node',
  apiKey: 'sk-ant-test-key',
  idsEnabled: false,
  ncmecEnabled: false,
  emailEnabled: false,
};

describe('Forensics tool saving during setup', () => {
  let app: express.Application;

  beforeEach(() => {
    vi.clearAllMocks();
    app = express();
    app.use(express.json());
    mountSetupRoutes(app);
  });

  it('saves selected forensics platforms to FORENSICS_ENABLED_PLATFORMS', async () => {
    const res = await request(app)
      .post('/api/setup/save')
      .send({ ...BASE_PAYLOAD, forensicsTools: ['GRIFFEYE', 'FTK'] });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const writeFileMock = fsPromises.writeFile as unknown as ReturnType<typeof vi.fn>;
    const envContent = writeFileMock.mock.calls[0][1] as string;
    expect(envContent).toContain('FORENSICS_ENABLED_PLATFORMS=GRIFFEYE,FTK,GENERIC');
  });

  it('always includes GENERIC even when not explicitly selected', async () => {
    const res = await request(app)
      .post('/api/setup/save')
      .send({ ...BASE_PAYLOAD, forensicsTools: ['AXIOM'] });

    expect(res.status).toBe(200);

    const writeFileMock = fsPromises.writeFile as unknown as ReturnType<typeof vi.fn>;
    const envContent = writeFileMock.mock.calls[0][1] as string;
    expect(envContent).toContain('GENERIC');
    expect(envContent).toContain('AXIOM');
  });

  it('falls back to GENERIC when forensicsTools is empty', async () => {
    const res = await request(app)
      .post('/api/setup/save')
      .send({ ...BASE_PAYLOAD, forensicsTools: [] });

    expect(res.status).toBe(200);

    const writeFileMock = fsPromises.writeFile as unknown as ReturnType<typeof vi.fn>;
    const envContent = writeFileMock.mock.calls[0][1] as string;
    expect(envContent).toContain('FORENSICS_ENABLED_PLATFORMS=GENERIC');
  });

  it('falls back to GENERIC when forensicsTools is omitted', async () => {
    const res = await request(app)
      .post('/api/setup/save')
      .send({ ...BASE_PAYLOAD });

    expect(res.status).toBe(200);

    const writeFileMock = fsPromises.writeFile as unknown as ReturnType<typeof vi.fn>;
    const envContent = writeFileMock.mock.calls[0][1] as string;
    expect(envContent).toContain('FORENSICS_ENABLED_PLATFORMS=GENERIC');
  });

  it('returns 400 when forensicsTools is a string instead of an array', async () => {
    const res = await request(app)
      .post('/api/setup/save')
      .send({ ...BASE_PAYLOAD, forensicsTools: 'GRIFFEYE,FTK' });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('forensicsTools must be an array');

    const writeFileMock = fsPromises.writeFile as unknown as ReturnType<typeof vi.fn>;
    expect(writeFileMock).not.toHaveBeenCalled();
  });

  it('returns 400 when forensicsTools contains an invalid platform name', async () => {
    const res = await request(app)
      .post('/api/setup/save')
      .send({ ...BASE_PAYLOAD, forensicsTools: ['GRIFFEYE', 'UNKNOWN_TOOL'] });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Invalid forensics platform');

    const writeFileMock = fsPromises.writeFile as unknown as ReturnType<typeof vi.fn>;
    expect(writeFileMock).not.toHaveBeenCalled();
  });

  it('returns 400 when forensicsTools contains non-string elements', async () => {
    const res = await request(app)
      .post('/api/setup/save')
      .send({ ...BASE_PAYLOAD, forensicsTools: [1, 2] });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('forensicsTools must be an array of strings');

    const writeFileMock = fsPromises.writeFile as unknown as ReturnType<typeof vi.fn>;
    expect(writeFileMock).not.toHaveBeenCalled();
  });

  it('accepts all valid platform names', async () => {
    const allPlatforms = ['GRIFFEYE', 'AXIOM', 'FTK', 'CELLEBRITE', 'ENCASE', 'GENERIC'];
    const res = await request(app)
      .post('/api/setup/save')
      .send({ ...BASE_PAYLOAD, forensicsTools: allPlatforms });

    expect(res.status).toBe(200);

    const writeFileMock = fsPromises.writeFile as unknown as ReturnType<typeof vi.fn>;
    const envContent = writeFileMock.mock.calls[0][1] as string;
    for (const p of allPlatforms) {
      expect(envContent).toContain(p);
    }
  });
});
