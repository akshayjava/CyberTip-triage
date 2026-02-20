# CyberTip Triage — ICAC Task Force Setup Guide

**For:** ICAC investigators, task force commanders, and IT administrators  
**Purpose:** Get CyberTip Triage running at your agency  
**Time required:** 30–60 minutes for initial setup

---

## Before You Begin

### What this system does

CyberTip Triage automatically reviews incoming CyberTips from NCMEC and electronically prioritizes them using AI. Each tip is:

- **Legally reviewed** — files that your ESP did not view are automatically locked per the Wilson Ruling. You never accidentally open a file you're not allowed to see.
- **Scored 0–100** — based on severity, victim age, urgency, whether a meeting is arranged, hash matches, and more.
- **Sorted into tiers** — IMMEDIATE, URGENT, STANDARD, MONITOR — so your investigators work the most critical cases first.
- **De-conflicted** — checked against active investigations to avoid stepping on another agency's case.
- **Preservation-tracked** — data retention deadlines shown prominently so you never lose evidence because you didn't send a timely 2703(f) letter.

### What you need before starting

| Requirement | Where to get it | Time to obtain |
|---|---|---|
| A computer running Windows 10+, Mac, or Linux | — | Already have |
| Internet connection | — | Already have |
| Anthropic API key | console.anthropic.com | 10 minutes |
| IDS Portal credentials | icacdatasystem.com | Already have (most task forces) |
| NCMEC API key | Contact NCMEC | 1–2 weeks |

> **Note on NCMEC API:** Most ICAC task forces already receive tips via the IDS Portal. The NCMEC API is an additional direct feed. You can start with just IDS Portal access.

---

## Option A: Install with One Command (Recommended)

This is the easiest method. Open a terminal (Command Prompt on Windows, Terminal on Mac/Linux) and paste this single line:

```
bash <(curl -sSL https://raw.githubusercontent.com/akshayjava/cybertip-triage/main/install.sh)
```

This will:
1. Check your computer has everything it needs
2. Download CyberTip Triage
3. Walk you through a setup wizard (5 minutes of answering questions)
4. Create a sample test tip so you can verify it works

---

## Option B: Manual Setup

If you prefer to see each step:

### Step 1 — Download the software

```bash
git clone https://github.com/akshayjava/cybertip-triage.git
cd cybertip-triage
```

### Step 2 — Run the setup wizard

```bash
node setup/wizard.mjs
```

The wizard will ask you:
- Your agency name and state
- Your Anthropic API key
- Whether you have IDS Portal credentials
- Whether you want Docker or direct installation

### Step 3 — Start the system

**If you chose Docker:**
```bash
./start.sh
```

**If you chose direct installation:**
```bash
npm install
npm run build
npm start
```

### Step 4 — Open the dashboard

Open your web browser and go to: **http://localhost:3000/dashboard**

---

## Getting Your Anthropic API Key

CyberTip Triage uses Anthropic's Claude AI. You need an API key to use it.

1. Go to **https://console.anthropic.com**
2. Create an account (or log in)
3. Click **"API Keys"** in the left sidebar
4. Click **"Create Key"**
5. Name it something like "ICAC Task Force"
6. Copy the key — it starts with `sk-ant-`
7. Paste it when the setup wizard asks

**Cost:** Anthropic charges per tip processed. Typical cost is **$2–5 per 1,000 tips**. Most task forces process 100–500 tips/month, so expect roughly **$1–3/month**.

---

## Connecting to IDS Portal

The ICAC Data System (IDS) at `icacdatasystem.com` is how NCMEC delivers tips to your task force.

1. In the setup wizard, say **Yes** when asked about IDS credentials
2. Enter your IDS login email and password
3. The system will automatically check IDS every 60 seconds for new tips

> **If you don't have IDS credentials:** Contact your ICAC regional commander or NCMEC directly at 1-800-THE-LOST.

---

## Connecting to NCMEC API (Optional)

The NCMEC API is a direct feed separate from IDS. It delivers tips in XML format and can be faster than the IDS portal for high-volume task forces.

1. Contact NCMEC's Technology Services at tech@missingkids.org
2. Request API access for your task force
3. Once you have credentials, add this to your `.env` file:
   ```
   NCMEC_API_ENABLED=true
   NCMEC_API_KEY=your-key-here
   ```
4. Restart the system

---

## Understanding the Dashboard

### The Queue

Tips are organized into five tiers:

| Tier | Score | Meaning |
|---|---|---|
| 🔴 **IMMEDIATE** | 85–100 | Act now — victim in danger, meeting arranged, or active CSAM |
| 🟠 **URGENT** | 60–84 | Review within 24 hours |
| 🟣 **PAUSED** | — | Another agency has an active case — contact them before proceeding |
| 🔵 **STANDARD** | 30–59 | Weekly review |
| ⚫ **MONITOR** | 0–29 | Low priority — check monthly |

### The Crisis Banner

A red banner at the top means a victim may be in immediate danger (sextortion with suicidal ideation). These tips are always IMMEDIATE and generate an automatic supervisor alert.

### The Files Tab

Each file in a tip shows its legal status:

- 🔒 **BLOCKED** — The ESP did not view this file. You need a warrant before opening it. The system automatically applies for one in your queue.
- 🔓 **Accessible** — The ESP viewed this file before reporting. You can review it.

When a warrant is granted, click **"Mark Granted"** and enter the warrant number. The file will automatically unlock.

### The Preservation Tab

Shows data retention deadlines for each ESP. When you see a red countdown, you need to issue a 2703(f) preservation letter **today**. Click **"Issue Preservation Request"** to approve the draft letter.

---

## Testing the System

A sample test tip is included at `test-data/ids-stubs/TEST-001.txt`. It will process automatically when the system starts (look for it in the STANDARD tier of the queue).

To verify the whole pipeline is working:

1. Open the dashboard
2. Look for **TEST-001** in the queue
3. Click it to open the detail view
4. Check the Audit Trail tab — all 7 agents should show ✓

If any agent shows ✗, check the logs: `docker compose logs -f app` (Docker) or look at the console output.

---

## Connecting Hash Databases

For maximum effectiveness, connect to hash matching databases:

### Project VIC
- Website: **projectvic.org**
- Process: Law enforcement vetting required
- Once approved: Add `PROJECT_VIC_API_KEY=your-key` to `.env`

### IWF (Internet Watch Foundation)
- For tips with international content
- Contact your NCMEC liaison
- Once approved: Add `IWF_API_KEY=your-key` to `.env`

### Interpol ICSE
- For internationally-sourced material
- Contact via your INTERPOL NCB liaison
- Once approved: Add `INTERPOL_ICSE_KEY=your-key` to `.env`

---

## Adding Investigators

Right now the system runs without user accounts — all investigators share the dashboard. For multi-user access with role separation, see the `SECURITY.md` guide (coming in the next release).

For now, recommended practice:
- Run the system on a dedicated workstation in your ICAC room
- All investigators use the dashboard from that workstation
- Supervisors are notified via the system's alert function

---

## De-Confliction Setup

The system will attempt to check for active investigations via your de-confliction system. To connect RISSafe or HighWay:

1. Contact your regional RISS center for API access
2. Add the credentials to `.env`:
   ```
   RISSAFE_API_KEY=your-key
   ```
3. The Linker Agent will automatically check every subject, IP, and username

Until connected, de-confliction runs in stub mode and always returns "no conflict" — meaning you **must** manually check RISSafe/HighWay for high-priority tips.

---

## Legal Requirements Checklist

**Before using in a real investigation:**

- [ ] **Wilson Ruling review** — Have your agency's legal counsel review how the system handles the `esp_viewed` flag. The system is conservative by default (blocks files when in doubt), but your DA should sign off on the logic.

- [ ] **CJIS compliance** — Have your CISO verify the deployment meets CJIS Security Policy requirements. Key points:
  - System must run on agency-owned hardware or CJIS-compliant cloud
  - Access requires MFA (configured separately — see `SECURITY.md`)
  - Audit logs are append-only (built in — nothing to configure)

- [ ] **Warrant workflow** — Tell your DA's office that warrant tracking is now electronic. Walk them through the "Files" tab so they understand how warrant grants unlock files.

- [ ] **Exigent circumstances** — The system allows supervisors to claim exigent circumstances to access blocked files. This requires supervisor authorization and is automatically logged. Make sure your supervisor knows this feature exists and when it's appropriate to use.

---

## Troubleshooting

**Dashboard doesn't load**
- Check the system is running: `docker compose ps` or look for a running terminal
- Make sure you're going to the right port: http://localhost:3000/dashboard
- Check logs: `docker compose logs app`

**"Cannot connect to API" error in dashboard**
- The server isn't running. Run `./start.sh`

**Tips aren't appearing**
- Check IDS credentials are correct in `.env`
- Check the IDS_ENABLED setting is `true`
- Look at logs for polling errors

**A file that should be accessible is showing as BLOCKED**
- This is the Wilson compliance system working correctly
- Check the esp_viewed field in the tip — if it's false or missing, a warrant is needed
- Contact your legal counsel if you believe the block is in error

**The AI agents are failing (showing ✗ in audit trail)**
- Check your ANTHROPIC_API_KEY in `.env` is correct
- Check you have sufficient Anthropic API credits
- The system will retry automatically; persistent failures require manual triage

---

## Getting Help

- **Technical issues:** Open a GitHub issue at github.com/akshayjava/cybertip-triage
- **NCMEC integration:** NCMEC Technology Services — tech@missingkids.org  
- **IDS Portal:** ICAC Data System support at icacdatasystem.com
- **Legal questions:** Consult your agency's legal counsel and DA's office
- **Reporting a security vulnerability:** Email directly — do not open a public issue

---

## Updates

To update to the latest version:

```bash
cd cybertip-triage
git pull
docker compose down
docker compose up -d --build
```

Or if using Node.js directly:
```bash
git pull
npm install
npm run build
npm start
```

---

*CyberTip Triage is open-source software for law enforcement use. It is not a commercial product and comes with no warranty. Always verify AI-generated triage decisions with experienced investigators.*
