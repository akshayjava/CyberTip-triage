/**
 * Email Ingestion — IMAP listener for tip inbox
 */

import { enqueueTip } from "./queue.js";
import type { IngestionConfig } from "./config.js";

export async function startEmailIngestion(
  config: IngestionConfig
): Promise<() => void> {
  if (!config.email.enabled) {
    console.log("[EMAIL] Ingestion disabled");
    return () => {};
  }

  const password = process.env["EMAIL_PASSWORD"];
  if (!config.email.user || !password) {
    console.error("[EMAIL] Missing EMAIL_USER or EMAIL_PASSWORD");
    return () => {};
  }

  console.log(`[EMAIL] Starting IMAP listener on ${config.email.host}`);

  // In production: use the 'imap' + 'mailparser' packages
  // Lazy import to avoid errors when email is disabled
  let stopFn = () => {};

  try {
    const { default: Imap } = await import("imap");
    const { simpleParser } = await import("mailparser");

    const imap = new Imap({
      user: config.email.user,
      password,
      host: config.email.host,
      port: config.email.port,
      tls: config.email.tls,
      tlsOptions: { rejectUnauthorized: true },
    });

    function openInbox(cb: (err: Error | null) => void): void {
      imap.openBox("INBOX", false, cb);
    }

    imap.once("ready", () => {
      openInbox((err) => {
        if (err) { console.error("[EMAIL] Could not open inbox:", err); return; }

        // Process unseen messages
        imap.search(["UNSEEN"], (err, uids) => {
          if (err || !uids.length) return;

          const fetch = imap.fetch(uids, { bodies: "" });
          fetch.on("message", (msg) => {
            const chunks: Buffer[] = [];
            msg.on("body", (stream) => {
              stream.on("data", (chunk: Buffer) => chunks.push(chunk));
              stream.once("end", () => {
                const rawEmail = Buffer.concat(chunks).toString("utf-8");
                void simpleParser(rawEmail).then(async (parsed) => {
                  const body = parsed.text ?? parsed.html ?? "";
                  await enqueueTip({
                    source: "email",
                    raw_content: body,
                    content_type: "email",
                    received_at: parsed.date?.toISOString() ?? new Date().toISOString(),
                    metadata: {
                      reporter_esp: parsed.from?.text,
                    },
                  }, { priority: 5 });
                });
              });
            });
            // Mark as seen
            msg.once("attributes", (attrs: unknown) => {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              imap.addFlags((attrs as any).uid, ["\\Seen"], () => {});
            });
          });
        });
      });
    });

    imap.once("error", (...args: unknown[]) => console.error("[EMAIL] IMAP error:", args[0]));
    imap.connect();

    stopFn = () => imap.end();
  } catch (err) {
    console.warn("[EMAIL] Could not start IMAP listener (missing imap package?):", err);
  }

  return stopFn;
}
