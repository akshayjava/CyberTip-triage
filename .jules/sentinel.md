## 2026-05-22 - Insecure Randomness in Setup Secrets
**Vulnerability:** The `generateSecret` function in `src/api/setup_routes.ts` used `Math.random()` and `Date.now()` to create cryptographic secrets (JWT keys, DB passwords). This is predictable and lacks sufficient entropy for security-critical values.
**Learning:** `Math.random()` is not cryptographically secure. Relying on it for generating secrets, tokens, or keys introduces a vulnerability where an attacker could potentially predict the generated values if they can narrow down the generation timestamp or seed state.
**Prevention:**
1.  **Use `crypto.randomBytes`:** Always use `crypto.randomBytes(length)` (or `crypto.getRandomValues` in browser contexts) for generating any security-critical random values.
2.  **Linting Rules:** Ensure linting rules (like `sonarjs/no-insecure-random`) are active to catch usages of `Math.random()` in sensitive contexts.
3.  **Review Secret Generation:** Periodically audit codebase for `Math.random()` usage, especially in authentication or configuration modules.