## 2024-05-23 - Sequential Queries Bottleneck
**Learning:** The codebase frequently performs sequential database queries for related statistics (e.g., `getTipStats` ran 3 separate queries). This multiplies latency by the number of queries.
**Action:** Always check for opportunities to combine related aggregations into a single query using `FILTER` clauses or `CASE` statements to reduce database round-trips.

## 2026-03-02 - Over-fetching in Deduplication Logic
**Learning:** The `bundle_dedup.ts` module was fetching up to 5,000 full tip records (including heavy JSONB columns and file attachments via `listTips`) just to filter them in-memory by `is_bundled`. This caused significant unnecessary data transfer and object hydration overhead.
**Action:** Always ensure repository methods (`listTips`, etc.) expose necessary filters (like `is_bundled`) to push predicates down to the database, especially for high-frequency or large-volume operations like deduplication.

## 2026-03-04 - Concurrent Reporting Queries Bottleneck
**Learning:** Using `Promise.all` to run multiple concurrent aggregations against the same table (e.g., counting `cyber_tips` by different criteria) exhausts connection pools and causes unnecessary database overhead.
**Action:** Consolidate concurrent statistical queries on the same table into a single query using PostgreSQL's `COUNT(*) FILTER (WHERE ...)` clause to perform all aggregations in one table scan.
