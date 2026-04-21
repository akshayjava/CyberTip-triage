## 2026-05-22 - Insecure Randomness in Setup Secrets
**Vulnerability:** The `generateSecret` function in `src/api/setup_routes.ts` used `Math.random()` and `Date.now()` to create cryptographic secrets (JWT keys, DB passwords). This is predictable and lacks sufficient entropy for security-critical values.
**Learning:** `Math.random()` is not cryptographically secure. Relying on it for generating secrets, tokens, or keys introduces a vulnerability where an attacker could potentially predict the generated values if they can narrow down the generation timestamp or seed state.
**Prevention:**
1.  **Use `crypto.randomBytes`:** Always use `crypto.randomBytes(length)` (or `crypto.getRandomValues` in browser contexts) for generating any security-critical random values.
2.  **Linting Rules:** Ensure linting rules (like `sonarjs/no-insecure-random`) are active to catch usages of `Math.random()` in sensitive contexts.
3.  **Review Secret Generation:** Periodically audit codebase for `Math.random()` usage, especially in authentication or configuration modules.

## 2026-03-01 - Insecure Randomness in job IDs
**Vulnerability:** The `enqueueTip` function in `src/ingestion/queue.ts` used `Math.random()` to create job IDs, which lacks sufficient entropy.
**Learning:** Relying on `Math.random()` for generating any IDs, even in a queue context, is a predictable approach and not considered a security best practice for uniqueness or entropy.
**Prevention:** Replace with `crypto.randomUUID()`.

## 2026-06-15 - Hardcoded VPN Portal Secret Fallback
**Vulnerability:** The `/intake/portal` endpoint in `src/ingestion/routes.ts` relied on a fallback hardcoded secret (`"dev-secret"`) for validating HMAC signatures if `VPN_PORTAL_SECRET` was omitted from the environment. This allowed unauthorized users to bypass authentication in improperly configured deployments by guessing or knowing the fallback key.
**Learning:** Security-critical configuration values (like HMAC secrets for endpoints) must never have hardcoded defaults that fall back securely. If an endpoint requires authentication and the secret is missing, it is safer to prevent the application from starting entirely. When fixing such issues, explicitly throwing an error on startup is preferred over silently un-mounting the route, which could lead to difficult-to-diagnose operational failures in existing deployments that were accidentally missing the flag.
**Prevention:**
1.  **Fail Fast:** Always check for required security configuration keys (e.g., `VPN_PORTAL_SECRET`, `JWT_SECRET`) during application startup or module initialization and throw a fatal error if they are missing.
2.  **No Fallbacks:** Do not use `?? "dev-secret"` or similar constructs for cryptographic secrets in application code.

## 2026-07-20 - Leftover Developer Bypass in Authentication Middleware
**Vulnerability:** The `verifyHmacSignature` middleware in `src/ingestion/routes.ts` contained a hardcoded condition `if (signature === "dev-bypass") { next(); return; }` that allowed an unauthenticated attacker to bypass the HMAC signature validation entirely.
**Learning:** Development and debugging backdoors must never be committed to the main codebase or shipped to production. They undermine the entire security model of the endpoint. Security mechanisms must be tested using valid, securely generated test credentials or proper mocking in test suites, not through hardcoded application bypasses.
**Prevention:**
1.  **No Code Bypasses:** Do not include code that intentionally bypasses security checks (like "dev mode" flags or hardcoded "magic" values) in production middleware.
2.  **Use Test Environments:** Ensure tests use validly signed test fixtures or mock the middleware at the test framework level.
## 2026-08-15 - Insecure Input Validation on Agency Name
**Vulnerability:** The `/intake/agency` endpoint in `src/ingestion/routes.ts` blindly trusted the `x-agency-name` header. An attacker could potentially inject malicious characters leading to Log Injection or XSS in admin dashboards.
**Learning:** Custom HTTP headers provided by clients or external systems must be treated as untrusted input. Validation logic must be applied specifically to the expected format.
**Prevention:**
1.  **Strict Regex Validation:** Apply an explicit regex validation such as `/^[\p{L}\p{N}\s\-\.\(\)\[\]&',]{2,100}$/u` to ensure header strings only contain valid business characters. Include the `u` flag to safely support international characters.
2.  **Fail Fast:** Return a 400 Bad Request directly from the middleware when validation fails to prevent downstream systems from interacting with bad data.
