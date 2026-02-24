## 2025-05-21 - Critical Privilege Escalation in Setup Routes
**Vulnerability:** The `POST /api/setup/save` endpoint, intended for initial system configuration, was accessible to any authenticated user (or anyone in dev mode). This allowed low-privileged users (e.g., investigators) or attackers with a valid token to overwrite the `.env` file, potentially changing the database URL, JWT secret, or other critical configurations, leading to full system takeover.
**Learning:** Middleware-based authentication (like `authMiddleware`) often provides a baseline "is authenticated" check but does not inherently enforce role-based access control (RBAC) for specific sensitive endpoints. Developers might assume that "authenticated" implies "safe," especially for setup/admin routes, but explicit role checks are mandatory.
**Prevention:**
1.  **Defense in Depth:** Always apply `requireRole("admin")` (or stricter) to sensitive configuration endpoints.
2.  **Environment Awareness:** Disable setup routes entirely after the initial configuration is complete (e.g., using a flag in `.env` or checking if `.env` exists).
3.  **Strict Middleware:** Ensure that critical routes have explicit authorization guards, not just authentication guards.
