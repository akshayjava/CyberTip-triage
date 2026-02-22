## 2024-05-23 - Sequential Queries Bottleneck
**Learning:** The codebase frequently performs sequential database queries for related statistics (e.g., `getTipStats` ran 3 separate queries). This multiplies latency by the number of queries.
**Action:** Always check for opportunities to combine related aggregations into a single query using `FILTER` clauses or `CASE` statements to reduce database round-trips.
