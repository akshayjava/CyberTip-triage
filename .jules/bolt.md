## 2024-05-23 - Sequential Queries Bottleneck
**Learning:** The codebase frequently performs sequential database queries for related statistics (e.g., `getTipStats` ran 3 separate queries). This multiplies latency by the number of queries.
**Action:** Always check for opportunities to combine related aggregations into a single query using `FILTER` clauses or `CASE` statements to reduce database round-trips.

## 2026-03-02 - Over-fetching in Deduplication Logic
**Learning:** The `bundle_dedup.ts` module was fetching up to 5,000 full tip records (including heavy JSONB columns and file attachments via `listTips`) just to filter them in-memory by `is_bundled`. This caused significant unnecessary data transfer and object hydration overhead.
**Action:** Always ensure repository methods (`listTips`, etc.) expose necessary filters (like `is_bundled`) to push predicates down to the database, especially for high-frequency or large-volume operations like deduplication.

## 2026-03-04 - Concurrent Reporting Queries Bottleneck
**Learning:** Using `Promise.all` to run multiple concurrent aggregations against the same table (e.g., counting `cyber_tips` by different criteria) exhausts connection pools and causes unnecessary database overhead.
**Action:** Consolidate concurrent statistical queries on the same table into a single query using PostgreSQL's `COUNT(*) FILTER (WHERE ...)` clause to perform all aggregations in one table scan.

## 2026-03-05 - Memory Exhaustion from Bulk Tip Fetching
**Learning:** Several analytical endpoints and batch operations (e.g., `handleGetBundle`, `handleHashStats` in Tier 3 routes, and reporting aggregations) were fetching 10,000+ tip records via `listTips({ limit: 10_000 })` without excluding large text blobs like `raw_body` and `files`. This causes massive object hydration overhead and severe memory inflation, even if only metadata or dates are needed.
**Action:** Always explicitly use `exclude_body: true` (and `exclude_files: true` when appropriate) when fetching large batches of tips for aggregation or duplicate counting.

## 2026-03-05 - Memory Exhaustion from Bulk Tip Fetching for Aggregation
**Learning:** The application was fetching up to 10,000 full tip records into Node.js memory just to filter them by `duplicate_of` or to compute hash match statistics in loops. This created a massive `O(N)` memory and time bottleneck that caused significant latency and object hydration overhead.
**Action:** Always push aggregations and data filtering down to the database level using `COUNT(*) FILTER (WHERE ...)` and `WHERE` clauses instead of loading and iterating over thousands of rows in memory.

## 2026-03-05 - Memory Exhaustion from Finding Tips by Nested Property
**Learning:** `src/auth/tier2_routes.ts` was fetching 1000 full tip records via `listTips({ limit: 1000 })` just to perform an `O(N)` loop to find a single tip that matched a specific `request_id` inside the nested `preservation_requests` array. Fetching large records that include raw body texts into Node.js memory just for lookup purposes causes significant overhead and memory exhaustion.
**Action:** Replace high-volume in-memory search loops with specific database queries (e.g., querying `preservation_requests` to get `tip_id` and then `getTipById(tip_id)`) to drastically reduce data transfer and object hydration costs.

## 2026-03-06 - Concurrent Database Updates in Loops
**Learning:** In the `runClusterScan` nightly job, processing `cluster.tip_ids` sequentially caused unnecessary latency for database lookups (`getTipById`) and updates (`upsertTip`, `appendAuditEntry`). Parallelizing these with `Promise.all` improves performance by ~70%.
**Action:** Use `Promise.all` to parallelize asynchronous database operations within loops, but ensure side effects (like updating shared counters or arrays) are performed sequentially *after* the parallel batch resolves to maintain correctness.

## 2026-03-08 - Repository Limits Silently Breaking Batch Jobs
**Learning:** `listTips` enforces a strict 500-record safety limit (`Math.min(opts.limit, 500)`). Batch jobs like the nightly digest that attempt to fetch thousands of records into memory using `limit: 5000` silently fail to aggregate full data, capping off at the most recent 500 records.
**Action:** Never use `listTips` for full-table aggregations or large batch processing. Always write targeted SQL aggregations (like `COUNT(*) FILTER`) to push processing down to the database. This prevents memory bloat and avoids silent truncation bugs caused by repository safety limits.
