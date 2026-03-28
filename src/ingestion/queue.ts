import { randomUUID } from "crypto";
/**
 * Tip Processing Queue
 *
 * BullMQ-based queue for reliable, concurrent tip processing.
 * Priority lanes:
 *   1 = NCMEC urgent-flagged tips
 *   2 = Standard NCMEC / ESP tips
 *   5 = Public submissions / email
 *
 * Tips are enqueued by ingestion sources and processed by workers
 * that call the Orchestrator pipeline.
 *
 * In development (QUEUE_MODE=memory), uses in-memory processing
 * without Redis dependency.
 */

import type { RawTipInput } from "../agents/intake.js";
import { processTip } from "../orchestrator.js";
import { upsertTip } from "../db/tips.js";
import type { CyberTip } from "../models/index.js";
import { shouldProcessTip, warmBundleCache } from "./bundle_dedup.js";

// Warm bundle dedup cache on module load (non-blocking)
void warmBundleCache();

// ── In-memory queue for development ──────────────────────────────────────────

interface QueuedJob {
  id: string;
  data: RawTipInput;
  priority: number;
  added_at: string;
  status: "waiting" | "active" | "completed" | "failed";
  result?: unknown;
  error?: string;
}

const inMemoryQueue: QueuedJob[] = [];
const activeJobs = new Set<string>();
const MAX_CONCURRENT_JOBS = 1; // Strict serial processing to prevent race conditions

async function processNextJob(): Promise<void> {
  if (activeJobs.size >= MAX_CONCURRENT_JOBS) return;

  // Sort by priority (lower number = higher priority)
  const next = inMemoryQueue
    .filter((j) => j.status === "waiting")
    .sort((a, b) => a.priority - b.priority)[0];

  if (!next) return;

  activeJobs.add(next.id);
  next.status = "active";

  try {
    console.log(`[QUEUE] -> Starting job ${next.id} calling processTip...`, JSON.stringify(next.data).slice(0, 100));
    // Run pipeline — gets the preliminary tip object first
    const result = await processTip(next.data);
    const tip = result as CyberTip;

    // Bundle dedup gate: check before persisting to avoid flooding queue
    // shouldProcessTip returns false for duplicates (already folded into canonical)
    const proceed = await shouldProcessTip(tip).catch(() => true); // fail-open
    if (!proceed) {
      next.status = "completed";
      next.result = { deduplicated: true, tip_id: tip.tip_id };
      console.log(`[QUEUE] Job ${next.id} deduplicated as bundle duplicate.`);
      return;
    }

    next.status = "completed";
    next.result = result;
    // Persist to DB — this is the only place tips are written after processing
    await upsertTip(tip).catch((dbErr: unknown) => {
      console.error(`[QUEUE] DB persist failed for job ${next.id}:`, dbErr);
      // Don't fail the job — tip is in memory, will retry on next upsert attempt
    });
  } catch (err) {
    next.status = "failed";
    next.error = err instanceof Error ? err.message : String(err);
    console.error(`[QUEUE] Job ${next.id} failed:`, err);
  } finally {
    activeJobs.delete(next.id);
    // Process next job
    setImmediate(() => void processNextJob());
  }
}

// ── Queue interface ───────────────────────────────────────────────────────────

export interface EnqueueOptions {
  priority?: 1 | 2 | 5;
  delay_ms?: number;
}

export interface QueueStats {
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  total: number;
}

/**
 * Add a tip to the processing queue.
 * Returns the job ID for status tracking.
 */
export async function enqueueTip(
  input: RawTipInput,
  options: EnqueueOptions = {}
): Promise<string> {
  const jobId = `tip-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const priority = options.priority ?? (input.source === "NCMEC_IDS" ? 2 : 5);

  if (process.env["QUEUE_MODE"] === "bullmq") {
    // Production: use BullMQ + Redis
    return enqueueBullMq(jobId, input, priority, options.delay_ms);
  }

  // Development: in-memory
  const job: QueuedJob = {
    id: jobId,
    data: input,
    priority,
    added_at: new Date().toISOString(),
    status: "waiting",
  };

  if (options.delay_ms && options.delay_ms > 0) {
    setTimeout(() => {
      inMemoryQueue.push(job);
      void processNextJob();
    }, options.delay_ms);
  } else {
    inMemoryQueue.push(job);
    void processNextJob();
  }

  console.log(
    `[QUEUE] Enqueued tip from ${input.source} | priority=${priority} | job=${jobId}`
  );
  return jobId;
}

export function getQueueStats(): QueueStats {
  return {
    waiting: inMemoryQueue.filter((j) => j.status === "waiting").length,
    active: inMemoryQueue.filter((j) => j.status === "active").length,
    completed: inMemoryQueue.filter((j) => j.status === "completed").length,
    failed: inMemoryQueue.filter((j) => j.status === "failed").length,
    total: inMemoryQueue.length,
  };
}

export function getJobStatus(jobId: string): QueuedJob | undefined {
  return inMemoryQueue.find((j) => j.id === jobId);
}

// ── BullMQ production implementation ─────────────────────────────────────────

// Singleton instance to prevent connection exhaustion
let bullMqQueue: import("bullmq").Queue | null = null;

async function getBullMqQueue(): Promise<import("bullmq").Queue> {
  if (bullMqQueue) return bullMqQueue;

  const { Queue } = await import("bullmq");
  const { loadConfig } = await import("./config.js");
  const config = loadConfig();

  bullMqQueue = new Queue("cybertips", {
    connection: {
      host: config.queue.redis_host,
      port: config.queue.redis_port,
    },
  });

  return bullMqQueue;
}

export async function closeQueue(): Promise<void> {
  if (bullMqQueue) {
    await bullMqQueue.close();
    bullMqQueue = null;
  }
}

async function enqueueBullMq(
  jobId: string,
  input: RawTipInput,
  priority: number,
  delay_ms?: number
): Promise<string> {
  const queue = await getBullMqQueue();

  const job = await queue.add("process_tip", input, {
    jobId,
    priority,
    delay: delay_ms,
    attempts: 3,
    backoff: { type: "exponential", delay: 2000 },
  });

  return job.id ?? jobId;
}

/**
 * Start BullMQ workers (production only).
 * Call this once at server startup when QUEUE_MODE=bullmq.
 */
export async function startQueueWorkers(): Promise<void> {
  if (process.env["QUEUE_MODE"] !== "bullmq") return;

  const { Worker } = await import("bullmq");
  const { loadConfig } = await import("./config.js");
  const config = loadConfig();

  const worker = new Worker(
    "cybertips",
    async (job) => {
      const tip = await processTip(job.data as RawTipInput);
      // Persist to DB immediately after pipeline — BullMQ handles retries on failure
      await upsertTip(tip as CyberTip);
      return tip;
    },
    {
      connection: {
        host: config.queue.redis_host,
        port: config.queue.redis_port,
      },
      concurrency: config.queue.concurrency,
    }
  );

  worker.on("completed", (job) => {
    console.log(`[WORKER] Job ${job.id} completed`);
  });

  worker.on("failed", (job, err) => {
    console.error(`[WORKER] Job ${job?.id} failed:`, err);
  });

  console.log(
    `[WORKER] Started ${config.queue.concurrency} concurrent workers`
  );
}
