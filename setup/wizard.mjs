#!/usr/bin/env node
/**
 * CyberTip Triage — Interactive Setup Wizard
 *
 * Walks an ICAC investigator or IT admin through initial configuration.
 * Writes a .env file and validates everything before first launch.
 *
 * Run: node setup/wizard.mjs
 */

import { createInterface } from "readline";
import { writeFile, readFile, access, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";
import { createHash } from "crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

// ── Terminal colors ───────────────────────────────────────────────────────────
const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
  bgRed: "\x1b[41m",
  bgBlue: "\x1b[44m",
};

const bold = (s) => `${c.bold}${s}${c.reset}`;
const dim = (s) => `${c.dim}${s}${c.reset}`;
const red = (s) => `${c.red}${s}${c.reset}`;
const green = (s) => `${c.green}${s}${c.reset}`;
const yellow = (s) => `${c.yellow}${s}${c.reset}`;
const cyan = (s) => `${c.cyan}${s}${c.reset}`;
const blue = (s) => `${c.blue}${s}${c.reset}`;

// ── Input helpers ─────────────────────────────────────────────────────────────
const rl = createInterface({ input: process.stdin, output: process.stdout });

function ask(question, defaultVal = "") {
  return new Promise((resolve) => {
    const suffix = defaultVal ? dim(` [${defaultVal}]`) : "";
    rl.question(`  ${question}${suffix}: `, (answer) => {
      resolve(answer.trim() || defaultVal);
    });
  });
}

function askSecret(question) {
  return new Promise((resolve) => {
    process.stdout.write(`  ${question}: `);
    process.stdin.setRawMode?.(true);
    let val = "";
    process.stdin.resume();
    process.stdin.setEncoding("utf8");
    const onData = (ch) => {
      if (ch === "\n" || ch === "\r" || ch === "\u0003") {
        process.stdin.setRawMode?.(false);
        process.stdin.removeListener("data", onData);
        process.stdout.write("\n");
        resolve(val);
      } else if (ch === "\u007f") {
        val = val.slice(0, -1);
        process.stdout.clearLine?.(0);
        process.stdout.cursorTo?.(0);
        process.stdout.write(`  ${question}: ${"*".repeat(val.length)}`);
      } else {
        val += ch;
        process.stdout.write("*");
      }
    };
    process.stdin.on("data", onData);
  });
}

async function askYesNo(question, defaultVal = true) {
  const hint = defaultVal ? "Y/n" : "y/N";
  const answer = await ask(`${question} (${hint})`, defaultVal ? "y" : "n");
  return answer.toLowerCase().startsWith("y");
}

function print(msg = "") { console.log(msg); }
function hr() { print(dim("─".repeat(60))); }
function section(title) {
  print();
  print(`${c.bgBlue}${c.bold}  ${title}  ${c.reset}`);
  print();
}
function success(msg) { print(green(`  ✓ ${msg}`)); }
function warn(msg) { print(yellow(`  ⚠ ${msg}`)); }
function err(msg) { print(red(`  ✗ ${msg}`)); }
function info(msg) { print(cyan(`  → ${msg}`)); }

function generateSecret(length = 32) {
  return createHash("sha256")
    .update(Math.random().toString() + Date.now().toString())
    .digest("hex")
    .slice(0, length);
}

// ── Checks ────────────────────────────────────────────────────────────────────

function checkNode() {
  const version = process.versions.node;
  const major = parseInt(version.split(".")[0]);
  if (major < 20) {
    err(`Node.js v20+ required. You have v${version}.`);
    info("Download: https://nodejs.org/en/download");
    process.exit(1);
  }
  success(`Node.js v${version}`);
}

function checkDocker() {
  try {
    execSync("docker --version", { stdio: "pipe" });
    execSync("docker compose version", { stdio: "pipe" });
    success("Docker + Docker Compose found");
    return true;
  } catch {
    warn("Docker not found — you will need to run Node.js directly");
    return false;
  }
}

async function checkAnthropicKey(key) {
  if (!key || !key.startsWith("sk-ant-")) {
    return false;
  }
  // Basic format check — real validation happens on first API call
  return key.length > 30;
}

// ── Main wizard ───────────────────────────────────────────────────────────────

async function main() {
  print();
  print(`${c.bold}${c.blue}╔══════════════════════════════════════════════════╗${c.reset}`);
  print(`${c.bold}${c.blue}║   🛡  CyberTip Triage — ICAC Setup Wizard       ║${c.reset}`);
  print(`${c.bold}${c.blue}╚══════════════════════════════════════════════════╝${c.reset}`);
  print();
  print("This wizard will configure CyberTip Triage for your task force.");
  print("It takes about 5 minutes. You can change any setting later by");
  print(`editing the ${bold(".env")} file that gets created.`);
  print();
  warn("This system handles CSAM reports. Authorized law enforcement use only.");
  print();

  // ── System checks ──────────────────────────────────────────────────────────
  section("Step 1 of 7 — System Check");
  checkNode();
  const hasDocker = checkDocker();

  // ── Deployment mode ────────────────────────────────────────────────────────
  section("Step 2 of 7 — Deployment Mode");
  print("  How do you want to run CyberTip Triage?");
  print();
  print(`  ${bold("1. Docker")} (recommended) — one command, everything included`);
  print(`     No technical knowledge needed. Installs its own database.`);
  print();
  print(`  ${bold("2. Node.js")} — run directly on this machine`);
  print(`     Requires a separate PostgreSQL database.`);
  print();

  let mode = "docker";
  if (hasDocker) {
    const useDocker = await askYesNo("Use Docker?", true);
    mode = useDocker ? "docker" : "node";
  } else {
    warn("Docker not available — using Node.js mode");
    mode = "node";
  }

  success(`Deployment mode: ${mode === "docker" ? "Docker (recommended)" : "Node.js"}`);

  // ── Agency info ────────────────────────────────────────────────────────────
  section("Step 3 of 7 — Your Task Force");
  const agencyName = await ask("Agency / Task Force name", "ICAC Task Force");
  const agencyState = await ask("State (2-letter code)", "CA");
  const contactEmail = await ask("IT contact email (for alerts)");
  const port = await ask("Port to run on", "3000");

  // ── Anthropic API key ──────────────────────────────────────────────────────
  section("Step 4 of 7 — Anthropic API Key");
  print("  CyberTip Triage uses Anthropic's Claude AI for tip analysis.");
  print(`  Get your key at: ${bold("https://console.anthropic.com")}`);
  print();
  print("  Recommended model access: Claude Opus + Sonnet + Haiku");
  print("  Estimated cost: ~$2–5 per 1,000 tips processed");
  print();

  let anthropicKey = "";
  let keyValid = false;
  while (!keyValid) {
    anthropicKey = await askSecret("Anthropic API key (sk-ant-...)");
    keyValid = await checkAnthropicKey(anthropicKey);
    if (!keyValid) {
      err("Key format invalid — should start with sk-ant- and be at least 30 characters");
      const retry = await askYesNo("Try again?", true);
      if (!retry) {
        warn("Skipping API key — you must add it to .env before starting");
        anthropicKey = "REPLACE_WITH_YOUR_ANTHROPIC_API_KEY";
        break;
      }
    } else {
      success("API key format valid");
    }
  }

  // ── Database ───────────────────────────────────────────────────────────────
  let dbUrl = "";
  let dbPassword = generateSecret(20);

  if (mode === "node") {
    section("Step 5 of 7 — Database");
    print("  CyberTip Triage needs PostgreSQL 15+.");
    print(`  Install guide: ${bold("https://www.postgresql.org/download/")}`);
    print();
    const hasExistingDb = await askYesNo("Do you have a PostgreSQL database already?", false);

    if (hasExistingDb) {
      dbUrl = await ask("Database URL", "postgresql://user:password@localhost:5432/cybertip");
    } else {
      print();
      warn("You need PostgreSQL installed and running before starting.");
      info("On Windows: download from postgresql.org/download/windows");
      info("On Mac: run: brew install postgresql@15");
      info("On Ubuntu: run: sudo apt install postgresql-15");
      dbUrl = "postgresql://cybertip:CHANGEME@localhost:5432/cybertip";
    }
  } else {
    section("Step 5 of 7 — Database");
    success("Docker will set up PostgreSQL automatically");
    info("Database password will be auto-generated");
    dbPassword = generateSecret(20);
    dbUrl = `postgresql://cybertip:${dbPassword}@postgres:5432/cybertip`;
  }

  // ── IDS Portal credentials ────────────────────────────────────────────────
  section("Step 6 of 7 — NCMEC IDS Portal (Optional)");
  print("  The IDS Portal (icacdatasystem.com) delivers CyberTip referrals");
  print("  from NCMEC to your task force. Credentials require ICAC registration.");
  print();

  const hasIdsCredentials = await askYesNo("Do you have IDS Portal credentials?", false);
  let idsEmail = "";
  let idsPassword = "";
  let idsEnabled = false;

  if (hasIdsCredentials) {
    idsEmail = await ask("IDS login email");
    idsPassword = await askSecret("IDS password");
    idsEnabled = true;
    success("IDS Portal configured — tips will be polled automatically");
  } else {
    warn("IDS not configured — you can add credentials to .env later");
    info("Register at: https://www.icacdatasystem.com");
    info("In the meantime, you can manually submit tips via the VPN portal");
  }

  // ── Email tip inbox ────────────────────────────────────────────────────────
  const hasEmailInbox = await askYesNo(
    "Do you have an email inbox for receiving tips? (e.g. tips@icac.agency.gov)",
    false
  );
  let emailHost = "";
  let emailUser = "";
  let emailPassword = "";
  let emailEnabled = false;

  if (hasEmailInbox) {
    emailHost = await ask("IMAP server hostname", "imap.agency.gov");
    emailUser = await ask("Email address");
    emailPassword = await askSecret("Email password");
    emailEnabled = true;
    success("Email ingestion configured");
  }

  // ── NCMEC API ─────────────────────────────────────────────────────────────
  const hasNcmecApi = await askYesNo("Do you have NCMEC API credentials?", false);
  let ncmecApiKey = "";
  let ncmecEnabled = false;

  if (hasNcmecApi) {
    ncmecApiKey = await askSecret("NCMEC API key");
    ncmecEnabled = true;
    success("NCMEC API configured");
  } else {
    info("Contact NCMEC at: missingkids.org/gethelpnow/cyberTipline");
  }

  // ── Security ──────────────────────────────────────────────────────────────
  section("Step 7 of 7 — Security Configuration");
  const portalSecret = generateSecret(32);
  const redisPassword = generateSecret(20);
  success("Auto-generated secure secrets for internal services");

  // ── Write .env ────────────────────────────────────────────────────────────
  const envContent = `# CyberTip Triage — Configuration
# Generated by setup wizard on ${new Date().toISOString()}
# Agency: ${agencyName} (${agencyState})
# ⚠ KEEP THIS FILE SECURE — Contains credentials

# ── Agency ────────────────────────────────────────────────────────────────────
AGENCY_NAME="${agencyName}"
AGENCY_STATE="${agencyState.toUpperCase()}"
CONTACT_EMAIL="${contactEmail}"

# ── Server ────────────────────────────────────────────────────────────────────
PORT=${port}
NODE_ENV=production
CORS_ORIGIN=http://localhost:${port}

# ── Anthropic AI ──────────────────────────────────────────────────────────────
ANTHROPIC_API_KEY=${anthropicKey}

# ── Database ──────────────────────────────────────────────────────────────────
DB_MODE=${mode === "docker" ? "postgres" : "postgres"}
DATABASE_URL=${dbUrl}
DB_PASSWORD=${dbPassword}

# ── Queue ─────────────────────────────────────────────────────────────────────
QUEUE_MODE=${mode === "docker" ? "bullmq" : "memory"}
REDIS_HOST=${mode === "docker" ? "redis" : "localhost"}
REDIS_PORT=6379
REDIS_PASSWORD=${redisPassword}
QUEUE_CONCURRENCY=5

# ── NCMEC IDS Portal ──────────────────────────────────────────────────────────
IDS_ENABLED=${idsEnabled}
IDS_BASE_URL=https://www.icacdatasystem.com
IDS_POLL_INTERVAL_MS=60000
IDS_DOWNLOAD_DIR=/tmp/cybertip-ids
IDS_STUB_DIR=./test-data/ids-stubs
${idsEnabled ? `IDS_EMAIL=${idsEmail}
IDS_PASSWORD=${idsPassword}` : `# IDS_EMAIL=your-ids-email@agency.gov
# IDS_PASSWORD=`}

# ── NCMEC API ─────────────────────────────────────────────────────────────────
NCMEC_API_ENABLED=${ncmecEnabled}
NCMEC_API_BASE_URL=https://api.ncmec.org
NCMEC_POLL_INTERVAL_MS=30000
${ncmecEnabled ? `NCMEC_API_KEY=${ncmecApiKey}` : `# NCMEC_API_KEY=`}

# ── Email Ingestion ───────────────────────────────────────────────────────────
EMAIL_ENABLED=${emailEnabled}
${emailEnabled ? `EMAIL_IMAP_HOST=${emailHost}
EMAIL_IMAP_PORT=993
EMAIL_TLS=true
EMAIL_USER=${emailUser}
EMAIL_PASSWORD=${emailPassword}` : `# EMAIL_IMAP_HOST=imap.agency.gov
# EMAIL_IMAP_PORT=993
# EMAIL_TLS=true
# EMAIL_USER=tips@icac.agency.gov
# EMAIL_PASSWORD=`}

# ── VPN Portal ────────────────────────────────────────────────────────────────
VPN_PORTAL_ENABLED=true
VPN_PORTAL_PORT=3001
VPN_PORTAL_SECRET=${portalSecret}

# ── Inter-Agency ──────────────────────────────────────────────────────────────
INTER_AGENCY_ENABLED=false
# INTER_AGENCY_API_KEYS=key1,key2

# ── External APIs (add as you obtain credentials) ────────────────────────────
# PROJECT_VIC_API_KEY=         # projectvic.org — law enforcement vetting required
# IWF_API_KEY=                 # IWF Contraband Filter — contact IWF LE liaison
# INTERPOL_ICSE_KEY=           # Via your INTERPOL NCB liaison
# RISSAFE_API_KEY=             # Contact your regional RISS center
# HIBP_API_KEY=                # haveibeenpwned.com/API
`;

  await writeFile(join(ROOT, ".env"), envContent, { mode: 0o600 });
  success(".env file created with permissions set to owner-only (600)");

  // ── Write start scripts ────────────────────────────────────────────────────
  if (mode === "docker") {
    const startScript = `#!/bin/bash
# CyberTip Triage — Start Script
set -e
echo "Starting CyberTip Triage..."
docker compose up -d
echo ""
echo "✓ CyberTip Triage is running"
echo "  Dashboard: http://localhost:${port}/dashboard"
echo "  API:       http://localhost:${port}/api"
echo ""
echo "To view logs: docker compose logs -f app"
echo "To stop:      docker compose down"
`;
    await writeFile(join(ROOT, "start.sh"), startScript, { mode: 0o755 });

    const stopScript = `#!/bin/bash
echo "Stopping CyberTip Triage..."
docker compose down
echo "✓ Stopped"
`;
    await writeFile(join(ROOT, "stop.sh"), stopScript, { mode: 0o755 });

    const logsScript = `#!/bin/bash
docker compose logs -f app
`;
    await writeFile(join(ROOT, "logs.sh"), logsScript, { mode: 0o755 });
  }

  // ── Create test data directory ─────────────────────────────────────────────
  await mkdir(join(ROOT, "test-data", "ids-stubs"), { recursive: true });

  // Write a sample stub tip for testing
  const sampleTip = `NCMEC CyberTipline Report
Report Number: TEST-001
NOT URGENT

Section A: Electronic Service Provider Information
Reporting ESP: TEST_FIXTURE
Incident Date: ${new Date().toISOString().split("T")[0]}
Subject Email: test.subject@example.com
Subject Username: test_user_123
Subject IP Address: 192.0.2.100

Uploaded File 1:
Filename: test_image.jpg
File Viewed by Reporting ESP: Yes
Publicly Available: No
MD5: aabbccddaabbccddaabbccddaabbccdd

Description: [SAMPLE TIP FOR TESTING] This is a synthetic test tip
created during setup to verify the pipeline is working correctly.
This tip does not represent a real incident.

Section B: Geolocation
Country: United States
State: ${agencyState}
City: Test City
ISP: Test ISP

Section C: Additional Information
Notes: Sample tip created by setup wizard.
`;
  await writeFile(
    join(ROOT, "test-data", "ids-stubs", "TEST-001.txt"),
    sampleTip
  );

  // ── Summary ────────────────────────────────────────────────────────────────
  print();
  print(`${c.bold}${c.green}╔══════════════════════════════════════════════════╗${c.reset}`);
  print(`${c.bold}${c.green}║   ✓  Setup Complete!                             ║${c.reset}`);
  print(`${c.bold}${c.green}╚══════════════════════════════════════════════════╝${c.reset}`);
  print();
  print(`  ${bold("Agency:")}       ${agencyName} (${agencyState})`);
  print(`  ${bold("Mode:")}         ${mode === "docker" ? "Docker" : "Node.js"}`);
  print(`  ${bold("IDS Portal:")}   ${idsEnabled ? green("✓ Configured") : yellow("Not yet — add credentials to .env")}`);
  print(`  ${bold("NCMEC API:")}    ${ncmecEnabled ? green("✓ Configured") : yellow("Not yet — add credentials to .env")}`);
  print(`  ${bold("Email:")}        ${emailEnabled ? green("✓ Configured") : yellow("Not configured")}`);
  print();
  hr();
  print();

  if (mode === "docker") {
    print(`  ${bold("To start CyberTip Triage:")} `);
    print();
    print(`    ${cyan("./start.sh")}`);
    print();
    print(`  Or manually:`);
    print(`    ${cyan("docker compose up -d")}`);
    print();
    print(`  Then open: ${bold(`http://localhost:${port}/dashboard`)}`);
  } else {
    print(`  ${bold("To start CyberTip Triage:")} `);
    print();
    print(`    ${cyan("npm install")}`);
    print(`    ${cyan("npm run build")}`);
    print(`    ${cyan("npm start")}`);
    print();
    print(`  Then open: ${bold(`http://localhost:${port}/dashboard`)}`);
  }

  print();
  hr();
  print();
  print(`  ${bold("Test the pipeline:")} A sample tip has been placed in`);
  print(`  ${cyan("test-data/ids-stubs/")} — it will process automatically`);
  print(`  when IDS_STUB_DIR is enabled (already set in .env).`);
  print();
  print(`  ${bold("Next steps (see SETUP_GUIDE.md):")}`);
  print(`  1. Verify the dashboard loads and shows the test tip`);
  print(`  2. Request NCMEC API access if you don't have it`);
  print(`  3. Have your legal counsel review the Wilson Ruling implementation`);
  print(`  4. Run the full test suite: ${cyan("npm test")}`);
  print();
  warn("Keep your .env file secure — it contains API keys and passwords.");
  warn("Never commit .env to version control.");
  print();

  rl.close();
  process.exit(0);
}

main().catch((err) => {
  console.error(red(`\nSetup failed: ${err.message}`));
  rl.close();
  process.exit(1);
});
