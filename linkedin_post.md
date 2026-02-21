# LinkedIn Post — CyberTip Triage

---

**Suggested post:**

---

Child exploitation investigators receive thousands of CyberTips every month. Most task forces triage them manually — reading PDFs, cross-referencing databases, checking legal compliance — while the clock ticks on cases that can't wait.

I built **CyberTip Triage**: an open-source, AI-powered pipeline designed for ICAC (Internet Crimes Against Children) task forces to automatically process, score, and route NCMEC reports so investigators can focus on the cases that need them most.

Here's how it works:

**7 specialized AI agents. 5 pipeline stages.**
- *Intake* — normalizes raw tips from IDS Portal, XML feeds, email, and direct ESP submission
- *Legal Gate* — deterministically enforces 4th Amendment warrant requirements and REPORT Act 2024 compliance before any file is accessed
- *Extraction + Hash/OSINT* — parallel entity extraction and hash matching against NCMEC, Project VIC, IWF, and Interpol databases
- *Classifier + Linker* — offense categorization, deconfliction, and cross-case cluster detection
- *Priority Scorer* — assigns a 0–100 urgency score and routes to the right unit (IMMEDIATE → on-call supervisor SMS within seconds)

**A few design principles I'm proud of:**

1. **AI recommends. Humans decide.** No warrant is applied for, no preservation letter sent, no case assigned without explicit investigator approval. The system is a force multiplier, not a replacement.

2. **Legal compliance is code, not a prompt.** Wilson v. US warrant logic, circuit-specific precedents, and chain-of-custody audit trails are enforced deterministically — not left to an LLM to "remember."

3. **Zero-dependency dev mode.** No database, no Redis, no external credentials needed to run locally. Fully in-memory for rapid iteration and safe testing.

**Stack:** TypeScript · Express · PostgreSQL · BullMQ · Anthropic Claude (Opus / Sonnet / Haiku) · React dashboard · Twilio · Docker

This is the kind of problem where good engineering has real stakes. If you work in law enforcement tech, digital forensics, or child safety policy — I'd genuinely love to connect and hear how task forces are handling tip volume today.

🔗 [link to repo]

#ChildSafety #ICAC #LawEnforcementTech #AI #TypeScript #OpenSource #CyberTip #NCMEC

---

> **Usage note:** Adjust the tone, remove/add hashtags, and insert your actual repo URL before posting.
> You may also want to add a screenshot of the investigator dashboard for visual impact.
