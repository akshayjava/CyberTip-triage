/**
 * Ingestion Configuration
 *
 * Central config for all intake channels.
 * Environment variables control which channels are active.
 */

export interface IngestionConfig {
  ids_portal: {
    enabled: boolean;
    base_url: string;
    poll_interval_ms: number;
    download_dir: string;
  };
  ncmec_api: {
    enabled: boolean;
    base_url: string;
    poll_interval_ms: number;
  };
  email: {
    enabled: boolean;
    host: string;
    port: number;
    user: string;
    tls: boolean;
  };
  vpn_portal: {
    enabled: boolean;
    port: number;
  };
  inter_agency: {
    enabled: boolean;
  };
  queue: {
    redis_host: string;
    redis_port: number;
    concurrency: number;
  };
}

export function loadConfig(): IngestionConfig {
  return {
    ids_portal: {
      enabled: process.env["IDS_ENABLED"] === "true",
      base_url: process.env["IDS_BASE_URL"] ?? "https://www.icacdatasystem.com",
      poll_interval_ms: parseInt(process.env["IDS_POLL_INTERVAL_MS"] ?? "60000"),
      download_dir: process.env["IDS_DOWNLOAD_DIR"] ?? "/tmp/cybertip-ids",
    },
    ncmec_api: {
      enabled: process.env["NCMEC_API_ENABLED"] === "true",
      base_url: process.env["NCMEC_API_BASE_URL"] ?? "https://api.ncmec.org",
      poll_interval_ms: parseInt(process.env["NCMEC_POLL_INTERVAL_MS"] ?? "30000"),
    },
    email: {
      enabled: process.env["EMAIL_ENABLED"] === "true",
      host: process.env["EMAIL_IMAP_HOST"] ?? "imap.agency.gov",
      port: parseInt(process.env["EMAIL_IMAP_PORT"] ?? "993"),
      user: process.env["EMAIL_USER"] ?? "",
      tls: process.env["EMAIL_TLS"] !== "false",
    },
    vpn_portal: {
      enabled: process.env["VPN_PORTAL_ENABLED"] === "true",
      port: parseInt(process.env["VPN_PORTAL_PORT"] ?? "3001"),
    },
    inter_agency: {
      enabled: process.env["INTER_AGENCY_ENABLED"] === "true",
    },
    queue: {
      redis_host: process.env["REDIS_HOST"] ?? "localhost",
      redis_port: parseInt(process.env["REDIS_PORT"] ?? "6379"),
      concurrency: parseInt(process.env["QUEUE_CONCURRENCY"] ?? "5"),
    },
  };
}
