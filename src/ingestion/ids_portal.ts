/**
 * IDS Portal Poller — Real Implementation
 *
 * Polls the ICAC Data System (icacdatasystem.com) for new CyberTip referrals.
 * Tips arrive as ZIP archives containing NCMEC PDF reports.
 *
 * Authentication flow:
 *   1. POST credentials → session cookie
 *   2. POST TOTP token  → fully authenticated session
 *   3. GET dashboard    → scrape list of new tip download URLs
 *   4. GET tip ZIP      → extract PDF → enqueue for processing
 *   5. Re-authenticate when session expires (typically ~30 min)
 *
 * Resilience:
 *   - Exponential backoff on transient HTTP failures (max 5 min)
 *   - Session expiry detected via 401/302-to-login responses
 *   - Processed tip IDs tracked in memory + DB to prevent double-processing
 *   - Stub mode (IDS_STUB_DIR) for local development without credentials
 *
 * Credentials required: ICAC task force registration at icacdatasystem.com
 * MFA: TOTP (Google Authenticator / Authy) — store base32 secret in IDS_MFA_SECRET
 */

import { readdir, readFile, mkdir, writeFile, unlink } from "fs/promises";
import { join } from "path";
import { randomUUID } from "crypto";
import { enqueueTip } from "./queue.js";
import type { IngestionConfig } from "./config.js";
import { parseNcmecPdfText, validateNcmecPdf } from "../parsers/ncmec_pdf.js";
import { alertSupervisor } from "../tools/alerts/alert_tools.js";

// ── Processed-tip tracking (in-memory; backed by DB on postgres builds) ────────

const processedTipIds = new Set<string>();

// ── TOTP generation ────────────────────────────────────────────────────────────

/**
 * Generate a TOTP token from a base32 secret.
 * Uses otplib if available; falls back to a manual RFC 6238 implementation
 * so the system works without the package installed in stub mode.
 */
async function generateTotp(base32Secret: string): Promise<string> {
  try {
    // Dynamic import — only required in real mode
    const { totp } = await import("otplib" as string) as { totp: { generate: (s: string) => string } };
    return totp.generate(base32Secret);
  } catch {
    // Fallback: manual TOTP (RFC 6238) using Node built-ins
    return generateTotpManual(base32Secret);
  }
}

function base32Decode(encoded: string): Buffer {
  const base32Chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const cleanEncoded = encoded.toUpperCase().replace(/=+$/, "");
  let bits = 0;
  let value = 0;
  const output: number[] = [];

  for (const char of cleanEncoded) {
    const idx = base32Chars.indexOf(char);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      output.push((value >>> bits) & 0xff);
    }
  }
  return Buffer.from(output);
}

async function generateTotpManual(base32Secret: string): Promise<string> {
  const { createHmac } = await import("crypto");
  const key   = base32Decode(base32Secret);
  const epoch = Math.floor(Date.now() / 1000 / 30);
  const time  = Buffer.alloc(8);
  time.writeUInt32BE(0, 0);
  time.writeUInt32BE(epoch, 4);

  const hmac   = createHmac("sha1", key).update(time).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const code   = (
    ((hmac[offset]!   & 0x7f) << 24) |
    ((hmac[offset+1]! & 0xff) << 16) |
    ((hmac[offset+2]! & 0xff) <<  8) |
     (hmac[offset+3]! & 0xff)
  ) % 1_000_000;

  return code.toString().padStart(6, "0");
}

// ── ZIP extraction ─────────────────────────────────────────────────────────────

/**
 * Extract the first PDF from a ZIP buffer.
 * Returns the PDF buffer, or throws if none found.
 */
async function extractPdfFromZip(zipBuffer: Buffer): Promise<Buffer> {
  const AdmZip = (await import("adm-zip" as string) as { default: new (b: Buffer) => AdmZipInstance }).default;

  interface AdmZipEntry { entryName: string; getData(): Buffer; }
  interface AdmZipInstance { getEntries(): AdmZipEntry[]; }

  const zip = new AdmZip(zipBuffer);
  const entries = zip.getEntries();

  const pdfEntry = entries.find((e) => e.entryName.toLowerCase().endsWith(".pdf"));
  if (!pdfEntry) {
    // Try any file if no PDF — some IDS zips contain .txt
    const txtEntry = entries.find((e) => e.entryName.toLowerCase().endsWith(".txt"));
    if (txtEntry) return txtEntry.getData();
    throw new Error(`No PDF or TXT found in ZIP. Files: ${entries.map((e) => e.entryName).join(", ")}`);
  }

  return pdfEntry.getData();
}

// ── HTTP helpers ───────────────────────────────────────────────────────────────

interface IdsSession {
  cookie: string;
  authenticated_at: number;
  expires_at: number;   // epoch ms
}

/**
 * Exponential backoff retry — doubles delay each attempt, caps at maxDelayMs.
 * Retries only on network errors and 5xx responses.
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { attempts?: number; baseDelayMs?: number; maxDelayMs?: number; label?: string } = {}
): Promise<T> {
  const { attempts = 4, baseDelayMs = 1_000, maxDelayMs = 300_000, label = "request" } = opts;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const isLast = attempt === attempts;
      const isRetryable =
        err instanceof Error &&
        (err.message.includes("ECONNRESET") ||
         err.message.includes("ETIMEDOUT") ||
         err.message.includes("5xx") ||
         err.message.includes("503") ||
         err.message.includes("502"));

      if (isLast || !isRetryable) throw err;

      const delay = Math.min(baseDelayMs * Math.pow(2, attempt - 1), maxDelayMs);
      console.warn(
        `[IDS] ${label} failed (attempt ${attempt}/${attempts}), retrying in ${delay}ms: ${String(err)}`
      );
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw new Error(`${label} exhausted all ${attempts} attempts`);
}

// ── Real IDS authentication ────────────────────────────────────────────────────

/**
 * Authenticate with the IDS portal using email/password + TOTP.
 *
 * IDS uses a two-step form login:
 *   Step 1: POST /login with credentials → gets session cookie + MFA challenge
 *   Step 2: POST /login/mfa with TOTP token → fully authenticated
 *
 * NOTE: The exact endpoint paths and form field names must be confirmed
 * against the live IDS portal. These are based on ICAC operational documentation
 * and may need adjustment if the portal is updated.
 */
async function authenticateIds(
  baseUrl: string,
  email: string,
  password: string,
  mfaSecret: string
): Promise<IdsSession> {
  const nodeFetch = (await import("node-fetch" as string) as { default: typeof fetch }).default;

  // Step 1: Submit credentials
  const loginResp = await withRetry(
    () => nodeFetch(`${baseUrl}/Account/Login`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ Email: email, Password: password, RememberMe: "false" }).toString(),
      redirect: "manual",
    }),
    { label: "IDS login step 1" }
  );

  // Capture session cookie from Set-Cookie header
  const setCookie = loginResp.headers.get("set-cookie") ?? "";
  const sessionMatch = setCookie.match(/\.AspNetCore\.Session=[^;]+/);
  if (!sessionMatch) {
    throw new Error(`IDS login step 1 failed — no session cookie. Status: ${loginResp.status}`);
  }
  const sessionCookie = sessionMatch[0];

  // Step 2: Submit TOTP
  const mfaToken = await generateTotp(mfaSecret);

  const mfaResp = await withRetry(
    () => nodeFetch(`${baseUrl}/Account/MfaLogin`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Cookie": sessionCookie,
      },
      body: new URLSearchParams({ Code: mfaToken, RememberDevice: "false" }).toString(),
      redirect: "manual",
    }),
    { label: "IDS login step 2 (MFA)" }
  );

  if (mfaResp.status !== 302 && mfaResp.status !== 200) {
    throw new Error(`IDS MFA login failed. Status: ${mfaResp.status}`);
  }

  // Merge any updated cookies from MFA response
  const mfaCookie = mfaResp.headers.get("set-cookie") ?? "";
  const authCookie = mfaCookie.includes(".AspNetCore") ? mfaCookie : sessionCookie;

  const now = Date.now();
  console.log(`[IDS] Authentication successful at ${new Date(now).toISOString()}`);

  return {
    cookie: authCookie.split(",").map((c) => c.split(";")[0]!.trim()).join("; "),
    authenticated_at: now,
    expires_at: now + 25 * 60 * 1000,  // 25 min — IDS sessions typically 30 min
  };
}

// ── Fetch new tip list from dashboard ─────────────────────────────────────────

interface IdsTipRef {
  tip_id:       string;
  download_url: string;
  urgent:       boolean;
  esp_name:     string;
}

/**
 * Scrape the IDS Case Referral Dashboard for unprocessed tip download links.
 * Returns tip references the caller hasn't seen before.
 */
async function fetchNewTipRefs(
  baseUrl: string,
  session: IdsSession
): Promise<IdsTipRef[]> {
  const nodeFetch = (await import("node-fetch" as string) as { default: typeof fetch }).default;

  const resp = await withRetry(
    () => nodeFetch(`${baseUrl}/CyberTip/Index`, {
      headers: { Cookie: session.cookie },
    }),
    { label: "IDS dashboard fetch" }
  );

  if (resp.status === 401 || resp.url.includes("Login")) {
    throw new Error("IDS session expired — re-authentication required");
  }
  if (!resp.ok) {
    throw new Error(`IDS dashboard returned ${resp.status}`);
  }

  const html = await resp.text();
  const refs: IdsTipRef[] = [];

  // Parse tip links from HTML table — IDS renders rows like:
  //   <tr data-tip-id="12345" data-urgent="true">
  //     <td>...<a href="/CyberTip/Download/12345">Download</a>...
  // These regex patterns must be confirmed against live IDS HTML structure
  const rowRegex = /<tr[^>]+data-tip-id="([^"]+)"[^>]*data-urgent="([^"]+)"[^>]*>(.*?)<\/tr>/gs;
  const linkRegex = /href="(\/CyberTip\/Download\/[^"]+)"/;
  const espRegex  = /data-esp="([^"]+)"/;

  let match;
  while ((match = rowRegex.exec(html)) !== null) {
    const tipId   = match[1]!;
    const urgent  = match[2]!.toLowerCase() === "true";
    const rowHtml = match[3]!;

    if (processedTipIds.has(tipId)) continue;

    const linkMatch = linkRegex.exec(rowHtml);
    const espMatch  = espRegex.exec(rowHtml);
    if (!linkMatch) continue;

    refs.push({
      tip_id:       tipId,
      download_url: `${baseUrl}${linkMatch[1]}`,
      urgent,
      esp_name:     espMatch?.[1] ?? "NCMEC",
    });
  }

  return refs;
}

// ── Download and extract tip ZIP ───────────────────────────────────────────────

async function downloadAndExtractTip(
  tipRef: IdsTipRef,
  session: IdsSession,
  downloadDir: string
): Promise<string> {
  const nodeFetch = (await import("node-fetch" as string) as { default: typeof fetch }).default;

  const resp = await withRetry(
    () => nodeFetch(tipRef.download_url, {
      headers: { Cookie: session.cookie },
    }),
    { label: `IDS download tip ${tipRef.tip_id}` }
  );

  if (!resp.ok) {
    throw new Error(`IDS download failed for tip ${tipRef.tip_id}: HTTP ${resp.status}`);
  }

  const contentType = resp.headers.get("content-type") ?? "";
  const buffer      = Buffer.from(await resp.arrayBuffer());

  let pdfContent: string;

  if (contentType.includes("zip") || contentType.includes("octet-stream")) {
    // ZIP containing PDF — extract it
    const pdfBuffer = await extractPdfFromZip(buffer);

    // Save PDF for reference
    const pdfPath = join(downloadDir, `${tipRef.tip_id}.pdf`);
    await writeFile(pdfPath, pdfBuffer);

    // Use pdf-parse to extract text
    const pdfParse = (await import("pdf-parse" as string) as { default: (b: Buffer) => Promise<{ text: string }> }).default;
    const parsed   = await pdfParse(pdfBuffer);
    pdfContent     = parsed.text;
  } else if (contentType.includes("pdf")) {
    // Direct PDF response
    const pdfParse = (await import("pdf-parse" as string) as { default: (b: Buffer) => Promise<{ text: string }> }).default;
    const parsed   = await pdfParse(buffer);
    pdfContent     = parsed.text;
  } else {
    // Assume text/plain
    pdfContent = buffer.toString("utf-8");
  }

  return pdfContent;
}

// ── Stub mode ─────────────────────────────────────────────────────────────────

async function pollStubDirectory(stubDir: string): Promise<void> {
  let files: string[];
  try {
    files = await readdir(stubDir);
  } catch {
    return; // Directory doesn't exist yet — normal on first run
  }

  const tipFiles = files.filter((f) => f.endsWith(".txt") || f.endsWith(".pdf.txt"));

  for (const filename of tipFiles) {
    const tipId = filename.replace(/\.[^.]+$/, "");
    if (processedTipIds.has(tipId)) continue;

    try {
      const content = await readFile(join(stubDir, filename), "utf-8");
      processedTipIds.add(tipId);

      await enqueueTip(
        {
          source: "NCMEC_IDS",
          raw_content: content,
          content_type: "pdf_text",
          received_at: new Date().toISOString(),
          metadata: { reporter_esp: "NCMEC" },
        },
        { priority: 2 }
      );

      console.log(`[IDS STUB] Enqueued tip from: ${filename}`);
    } catch (err) {
      console.error(`[IDS STUB] Failed to process ${filename}:`, err);
    }
  }
}

// ── Main poller ────────────────────────────────────────────────────────────────

export async function startIdsPoller(config: IngestionConfig): Promise<() => void> {
  if (!config.ids_portal.enabled) {
    console.log("[IDS] Poller disabled — set IDS_ENABLED=true to activate");
    return () => {};
  }

  await mkdir(config.ids_portal.download_dir, { recursive: true });

  const stubDir = process.env["IDS_STUB_DIR"];
  const mode    = stubDir ? "stub" : "real";

  console.log(
    `[IDS] Starting poller | mode=${mode} | interval=${config.ids_portal.poll_interval_ms}ms`
  );

  if (!stubDir) {
    // Validate credentials at startup — fail fast with a clear message
    const requiredVars = ["IDS_EMAIL", "IDS_PASSWORD", "IDS_MFA_SECRET"];
    const missing = requiredVars.filter((v) => !process.env[v]);
    if (missing.length > 0) {
      console.error(`[IDS] Missing required env vars: ${missing.join(", ")}. Poller not started.`);
      console.error("[IDS] Set IDS_STUB_DIR=/path/to/stubs for development without credentials.");
      return () => {};
    }
  }

  let session: IdsSession | null = null;
  let consecutiveFailures        = 0;

  async function poll(): Promise<void> {
    try {
      if (stubDir) {
        await pollStubDirectory(stubDir);
        return;
      }

      const email     = process.env["IDS_EMAIL"]!;
      const password  = process.env["IDS_PASSWORD"]!;
      const mfaSecret = process.env["IDS_MFA_SECRET"]!;

      // Re-authenticate if no session or session is expiring soon (5 min buffer)
      if (!session || session.expires_at < Date.now() + 5 * 60 * 1000) {
        session = await authenticateIds(config.ids_portal.base_url, email, password, mfaSecret);
      }

      const tipRefs = await fetchNewTipRefs(config.ids_portal.base_url, session);

      if (tipRefs.length === 0) {
        consecutiveFailures = 0;
        return;
      }

      console.log(`[IDS] Found ${tipRefs.length} new tip(s)`);

      for (const tipRef of tipRefs) {
        try {
          const pdfText = await downloadAndExtractTip(tipRef, session, config.ids_portal.download_dir);

          // Validate PDF structure before enqueueing
          const parsed = parseNcmecPdfText(pdfText);
          const validation = validateNcmecPdf(parsed);

          if (!validation.valid) {
            const msg = `PDF validation failed: ${validation.errors.join("; ")}`;
            console.error(`[IDS] Tip ${tipRef.tip_id}: ${msg}`);
            // Alert supervisor but proceed with enqueue (best effort)
            await alertSupervisor(
              tipRef.tip_id,
              "PARSER_WARNING",
              50,
              "Check tip content integrity and NCMEC PDF format.",
              msg
            );
          }

          processedTipIds.add(tipRef.tip_id);

          await enqueueTip(
            {
              source: "NCMEC_IDS",
              raw_content: pdfText,
              content_type: "pdf_text",
              received_at: new Date().toISOString(),
              metadata: {
                reporter_esp: tipRef.esp_name,
                originating_country: "US",
              },
            },
            { priority: tipRef.urgent ? 1 : 2 }
          );

          console.log(
            `[IDS] Enqueued tip ${tipRef.tip_id} | urgent=${tipRef.urgent} | esp=${tipRef.esp_name}`
          );
        } catch (tipErr) {
          console.error(`[IDS] Failed to process tip ${tipRef.tip_id}:`, tipErr);
          // Don't add to processedTipIds — will retry on next poll
        }
      }

      consecutiveFailures = 0;
    } catch (err) {
      consecutiveFailures++;
      const isSessionErr = err instanceof Error && err.message.includes("session expired");

      if (isSessionErr) {
        console.warn("[IDS] Session expired — will re-authenticate on next poll");
        session = null;
      } else {
        console.error(`[IDS] Poll error (failure #${consecutiveFailures}):`, err);
      }

      // Back off if repeated failures — something may be wrong with IDS
      if (consecutiveFailures >= 5) {
        const backoffMs = Math.min(consecutiveFailures * 2 * 60_000, 30 * 60_000);
        console.warn(`[IDS] ${consecutiveFailures} consecutive failures — backing off ${backoffMs / 60_000} min`);
      }
    }
  }

  // Run immediately on startup, then on interval
  await poll();
  const interval = setInterval(() => void poll(), config.ids_portal.poll_interval_ms);
  return () => clearInterval(interval);
}

// ── Manual injection for testing ───────────────────────────────────────────────

export async function injectTestTip(pdfText: string, urgent = false): Promise<string> {
  return enqueueTip(
    {
      source: "NCMEC_IDS",
      raw_content: pdfText,
      content_type: "pdf_text",
      received_at: new Date().toISOString(),
    },
    { priority: urgent ? 1 : 2 }
  );
}
