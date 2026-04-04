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

## 2026-03-07 - Redundant Array Iteration Overhead
**Learning:** Functions computing multiple statistics from a single array (e.g., `getQueueStats` filtering `inMemoryQueue` for different statuses) were running separate `.filter().length` passes for each condition, causing unnecessary $O(M \times N)$ iteration overhead where $M$ is the number of conditions.
**Action:** Consolidate multiple array filtering passes into a single $O(N)$ loop or `reduce` operation to compute all required categorical statistics simultaneously without redundant intermediate array allocations.

## 2026-03-08 - O(N*M) Array Filtering in Object Hydration
**Learning:** In `src/db/tips.ts`, the `listTips` function combined tips with their files using a nested `.filter()` loop: `allFiles.filter(f => f.tip_id === row.tip_id)` inside a `.map()`. This resulted in an $O(N \times M)$ time complexity, causing significant CPU overhead and event loop blocking when querying large pages of tips (e.g., 500+ records) with multiple files each.
**Action:** Always replace nested array searches during object hydration with an $O(N+M)$ Map or Object lookup. Build a grouping dictionary once, then retrieve the related items in $O(1)$ time per row.

## 2026-03-31 - Consolidate filtering for array of records
**Learning:** Running multiple `.filter()` operations consecutively over large in-memory arrays (like `listTips` doing 9 separate filters in dev mode) incurs significant O(K*N) CPU overhead and unnecessary object allocations. Duplicate conditions pushed to the database querying layer (like `opts.unit`) unnecessarily bloats generated SQL.
**Action:** Always combine array filtering logic into a single `.filter()` pass evaluating all conditions at once (O(N)). When building dynamic query conditions, ensure keys aren't pushed redundantly to avoid duplicating `WHERE` clauses.

## 2026-04-01 - Sequential API Calls in Route Handlers
**Learning:** Using sequential `await` in a `for...of` loop to save individually generated database records (e.g., `saveMLATRequest`) forces the event loop to block on each I/O operation one by one, scaling latency linearly ($O(N)$) with the number of operations.
**Action:** Replace sequential `await` loops with `Promise.all` mapping when writing independent database records concurrently. This executes all operations simultaneously, reducing total I/O wait time to roughly $O(1)$ (the time of the slowest single query).

## 2026-04-02 - Sequential Queries in Object Hydration
**Learning:** In `getTipById`, the codebase fetched the parent record `cyber_tips`, awaited it, and only then initiated a `Promise.all` for child queries (`tip_files`, `preservation_requests`, `audit_log`). This sequential pattern adds a full database round-trip of latency per tip lookup, which is a significant bottleneck for high-frequency operations.
**Action:** Consolidate parent and child queries into a single `Promise.all` batch whenever possible. Wait for the batch to resolve, then check if the parent row exists before hydrating objects to save a full sequential database round-trip.
