/**
 * Type shims for packages that require `npm install`.
 * Run `npm install` to get real types; these are structural stubs only.
 */

// ── zod ───────────────────────────────────────────────────────────────────────
declare module "zod" {
  // Interfaces for the types Zod produces
  export interface ZodType<Output = any> {
    optional(): ZodOptional<this>;
    nullable(): ZodNullable<this>;
    parse(data: unknown): Output;
    safeParse(data: unknown): { success: boolean; data?: Output; error?: ZodError };
    _output: Output;
  }
  export type ZodTypeAny = ZodType<unknown>;
  export interface ZodError extends Error { issues: Array<{ message: string; path: (string | number)[] }> }
  export interface ZodOptional<T extends ZodTypeAny> extends ZodType<unknown> {}
  export interface ZodNullable<T extends ZodTypeAny> extends ZodType<unknown> {}
  export interface ZodUnion<T extends readonly ZodTypeAny[]> extends ZodType<unknown> {}
  export interface ZodRecord<V extends ZodTypeAny> extends ZodType<Record<string, unknown>> {}
  export interface ZodAny extends ZodType<unknown> {}
  export interface ZodUnknown extends ZodType<unknown> {}
  export interface ZodLiteral<T> extends ZodType<T> { _output: T }
  export interface ZodObject<Shape extends Record<string, ZodTypeAny> = Record<string, ZodTypeAny>>
    extends ZodType<{ [K in keyof Shape]?: any }> {
    partial(): ZodObject<Shape>;
    required(keys?: Partial<Record<keyof Shape, true>>): ZodObject<Shape>;
    extend<U extends Record<string, ZodTypeAny>>(shape: U): ZodObject<Shape & U>;
    shape: Shape;
  }
  export interface ZodString extends ZodType<string> {
    min(n: number): ZodString; max(n: number): ZodString; email(): ZodString; url(): ZodString;
    uuid(): ZodString; date(): ZodString; datetime(): ZodString; length(n: number): ZodString;
    regex(re: RegExp): ZodString; startsWith(s: string): ZodString;
  }
  export interface ZodNumber extends ZodType<number> {
    min(n: number): ZodNumber; max(n: number): ZodNumber; int(): ZodNumber;
    positive(): ZodNumber; nonnegative(): ZodNumber;
  }
  export interface ZodBoolean extends ZodType<boolean> {}
  export interface ZodArray<T extends ZodTypeAny> extends ZodType<unknown[]> {
    min(n: number): ZodArray<T>; max(n: number): ZodArray<T>;
  }
  export interface ZodEnum<T extends readonly [string, ...string[]]> extends ZodType<T[number]> {}

  // The `z` export is both a namespace (for z.infer type) and a const value (for z.object() calls)
  export namespace z {
    // Type-level helper — used as z.infer<typeof schema>
    type infer<T extends ZodTypeAny> = T extends ZodType<infer U> ? U : any; // shim: real types after npm install
  }
  export const z: {
    object<T extends Record<string, ZodTypeAny>>(shape: T): ZodObject<T>;
    string(): ZodString;
    number(): ZodNumber;
    boolean(): ZodBoolean;
    array<T extends ZodTypeAny>(type: T): ZodArray<T>;
    enum<T extends readonly [string, ...string[]]>(values: T): ZodEnum<T>;
    literal<T>(value: T): ZodLiteral<T>;
    unknown(): ZodUnknown;
    any(): ZodAny;
    union<T extends readonly ZodTypeAny[]>(types: T): ZodUnion<T>;
    record<V extends ZodTypeAny>(valueType: V): ZodRecord<V>;
    optional<T extends ZodTypeAny>(type: T): ZodOptional<T>;
  };

  // Also export top-level for `import { z, ZodType, ... } from "zod"` usage
  export function object<T extends Record<string, ZodTypeAny>>(shape: T): ZodObject<T>;
  export function string(): ZodString;
  export function number(): ZodNumber;
  export function boolean(): ZodBoolean;
  export function array<T extends ZodTypeAny>(type: T): ZodArray<T>;
  export function literal<T>(value: T): ZodLiteral<T>;
  export function unknown(): ZodUnknown;
  export function any(): ZodAny;
  export function union<T extends readonly ZodTypeAny[]>(types: T): ZodUnion<T>;
  export function record<V extends ZodTypeAny>(valueType: V): ZodRecord<V>;
  export function optional<T extends ZodTypeAny>(type: T): ZodOptional<T>;
  // Note: `enum` is a reserved word; zod re-exports it as z.enum
  export type infer<T extends ZodTypeAny> = T extends ZodType<infer U> ? U : any; // shim: real types after npm install
}
// ── @anthropic-ai/sdk ─────────────────────────────────────────────────────────
declare module "@anthropic-ai/sdk" {
  class Anthropic {
    constructor(options?: { apiKey?: string });
    messages: { create(params: Anthropic.MessageCreateParams): Promise<Anthropic.Message> };
  }
  namespace Anthropic {
    interface MessageCreateParams {
      model: string; max_tokens: number; system?: string;
      messages: MessageParam[]; tools?: Tool[];
      tool_choice?: { type: "auto" | "required" | "none" };
    }
    interface Message {
      id: string; type: "message"; role: "assistant"; content: ContentBlock[];
      stop_reason: "end_turn" | "tool_use" | "max_tokens" | null;
      usage: { input_tokens: number; output_tokens: number };
    }
    type ContentBlock = TextBlock | ToolUseBlock;
    interface TextBlock { type: "text"; text: string }
    interface ToolUseBlock { type: "tool_use"; id: string; name: string; input: unknown }
    type MessageParam =
      | { role: "user"; content: string | ContentBlockParam[] }
      | { role: "assistant"; content: string | ContentBlock[] };
    type ContentBlockParam = ToolResultBlockParam | TextBlockParam;
    interface ToolResultBlockParam { type: "tool_result"; tool_use_id: string; content: string }
    interface TextBlockParam { type: "text"; text: string }
    interface Tool {
      name: string; description?: string;
      input_schema: { type: "object"; properties: Record<string, unknown>; required?: string[] };
    }
  }
  export default Anthropic;
}

// ── pg ────────────────────────────────────────────────────────────────────────
declare module "pg" {
  export interface PoolConfig {
    connectionString?: string; host?: string; port?: number; database?: string;
    user?: string; password?: string; max?: number;
    idleTimeoutMillis?: number; connectionTimeoutMillis?: number;
    ssl?: boolean | { rejectUnauthorized?: boolean };
  }
  export interface QueryResult<T = unknown> {
    rows: T[]; rowCount: number | null; command: string;
    fields: Array<{ name: string; dataTypeID: number }>;
  }
  export interface PoolClient {
    query<T = unknown>(sql: string, values?: unknown[]): Promise<QueryResult<T>>;
    release(err?: Error): void;
  }
  export class Pool {
    constructor(config?: PoolConfig);
    query<T = unknown>(sql: string, values?: unknown[]): Promise<QueryResult<T>>;
    connect(): Promise<PoolClient>;
    end(): Promise<void>;
    on(event: "error", handler: (err: Error) => void): this;
    on(event: string, handler: (...args: unknown[]) => void): this;
  }
}

// ── express ───────────────────────────────────────────────────────────────────
declare module "express" {
  import { IncomingMessage, ServerResponse } from "http";
  export interface Request extends IncomingMessage {
    params: Record<string, string>;
    query: Record<string, string | string[] | undefined>;
    body: unknown;
    on(event: string, handler: (...args: unknown[]) => void): this;
  }
  export interface Response extends ServerResponse {
    status(code: number): this;
    json(data: unknown): this;
    send(data: unknown): this;
    sendFile(path: string): void;
    write(data: string): boolean;
    end(data?: string): this;
    setHeader(name: string, value: string | number | readonly string[]): this;
    sendStatus(code: number): this;
    redirect(url: string): this;
    redirect(status: number, url: string): this;
    locals: Record<string, unknown>;
  }
  export type NextFunction = (err?: unknown) => void;
  export type RequestHandler = (req: Request, res: Response, next: NextFunction) => void | Promise<void>;
  export interface Application {
    use(handler: RequestHandler | ((req: Request, res: Response, next: NextFunction) => void)): this;
    use(path: string, handler: RequestHandler): this;
    get(path: string, ...handlers: RequestHandler[]): this;
    post(path: string, ...handlers: RequestHandler[]): this;
    put(path: string, ...handlers: RequestHandler[]): this;
    delete(path: string, ...handlers: RequestHandler[]): this;
    patch(path: string, ...handlers: RequestHandler[]): this;
    listen(port: number, callback?: () => void): import("http").Server;
    listen(port: number, host: string, callback?: () => void): import("http").Server;
  }
  interface ExpressStatic {
    (): Application;
    Router(): Router;
    json(options?: { limit?: string | number; strict?: boolean }): RequestHandler;
    urlencoded(opts: { extended: boolean }): RequestHandler;
    static(root: string, opts?: unknown): RequestHandler;
  }
  export interface Router {
    use(handler: RequestHandler): this;
    get(path: string, ...handlers: RequestHandler[]): this;
    post(path: string, ...handlers: RequestHandler[]): this;
  }
  const express: ExpressStatic;
  export default express;
  export = express;
}

// ── bullmq ────────────────────────────────────────────────────────────────────
declare module "bullmq" {
  export interface QueueOptions {
    connection?: { host?: string; port?: number; password?: string };
    defaultJobOptions?: Record<string, unknown>;
  }
  export interface Job<T = unknown> {
    id: string; data: T; name: string;
    opts: Record<string, unknown>; progress: number;
    returnvalue: unknown; failedReason: string;
  }
  export interface WorkerOptions {
    connection?: { host?: string; port?: number; password?: string };
    concurrency?: number;
  }
  export class Queue<T = unknown> {
    constructor(name: string, opts?: QueueOptions);
    add(name: string, data: T, opts?: { priority?: number; jobId?: string; delay?: number; attempts?: number; backoff?: unknown }): Promise<Job<T>>;
    getWaiting(): Promise<Job<T>[]>;
    getActive(): Promise<Job<T>[]>;
    getCompleted(): Promise<Job<T>[]>;
    getFailed(): Promise<Job<T>[]>;
    getJobCounts(): Promise<Record<string, number>>;
    close(): Promise<void>;
  }
  export class Worker<T = unknown> {
    constructor(name: string, processor: (job: Job<T>) => Promise<unknown>, opts?: WorkerOptions);
    on(event: 'completed', handler: (job: Job<T>, result: unknown) => void): this;
    on(event: 'failed', handler: (job: Job<T> | undefined, err: Error) => void): this;
    on(event: 'error', handler: (err: Error) => void): this;
    on(event: string, handler: (...args: unknown[]) => void): this;
    close(): Promise<void>;
  }
}

// ── nodemailer ────────────────────────────────────────────────────────────────
declare module "nodemailer" {
  export interface TransportOptions {
    host?: string; port?: number; secure?: boolean;
    auth?: { user: string; pass: string }; service?: string;
  }
  export interface MailOptions {
    from?: string; to: string | string[]; cc?: string | string[];
    subject: string; text?: string; html?: string;
  }
  export interface SentMessageInfo {
    messageId: string; accepted: string[]; rejected: string[]; response: string;
  }
  export interface Transporter {
    sendMail(opts: MailOptions): Promise<SentMessageInfo>;
    verify(): Promise<true>;
  }
  export function createTransport(opts: TransportOptions): Transporter;
}

// ── twilio ────────────────────────────────────────────────────────────────────
declare module "twilio" {
  export interface TwilioMessage { sid: string; status: string; to: string; from: string; body: string }
  export interface TwilioClient {
    messages: { create(opts: { body: string; from: string; to: string }): Promise<TwilioMessage> };
  }
  function twilio(accountSid: string, authToken: string): TwilioClient;
  export default twilio;
}

// ── otplib ────────────────────────────────────────────────────────────────────
declare module "otplib" {
  export const totp: {
    generate(secret: string): string;
    verify(opts: { token: string; secret: string }): boolean;
    options: { digits: number; step: number };
  };
}

// ── adm-zip ───────────────────────────────────────────────────────────────────
declare module "adm-zip" {
  export interface ZipEntry {
    entryName: string;
    getData(): Buffer;
    isDirectory: boolean;
  }
  class AdmZip {
    constructor(buffer?: Buffer | string);
    getEntries(): ZipEntry[];
    getEntry(name: string): ZipEntry | null;
    readFile(entry: ZipEntry | string): Buffer | null;
    extractAllTo(targetPath: string, overwrite?: boolean): void;
  }
  export default AdmZip;
}

// ── imap ──────────────────────────────────────────────────────────────────────
declare module "imap" {
  export interface ImapConfig {
    user: string; password: string; host: string; port: number; tls: boolean;
    tlsOptions?: Record<string, unknown>;
    authTimeout?: number; connTimeout?: number;
  }
  export interface MessageSource {
    on(event: "data", h: (chunk: Buffer) => void): this;
    on(event: "end", h: () => void): this;
    once(event: "end", h: () => void): this;
  }
  export interface FetchMessage {
    on(event: "body", h: (stream: MessageSource, info: unknown) => void): this;
    on(event: "attributes", h: (attrs: unknown) => void): this;
    on(event: string, h: (...args: unknown[]) => void): this;
    once(event: "end", h: () => void): this;
    once(event: string, h: (...args: unknown[]) => void): this;
  }
  class Imap {
    constructor(config: ImapConfig);
    connect(): void; end(): void;
    openBox(name: string, ro: boolean, cb: (err: Error | null, box: unknown) => void): void;
    search(criteria: unknown[], cb: (err: Error | null, uids: number[]) => void): void;
    fetch(uids: number[], opts: unknown): { on(event: "message", h: (msg: FetchMessage, seq: number) => void): void };
    addFlags(uid: number, flags: string[], cb: (err: Error | null) => void): void;
    on(event: string, handler: (...args: unknown[]) => void): this;
    once(event: string, handler: (...args: unknown[]) => void): this;
  }
  export = Imap;
}

// ── mailparser ────────────────────────────────────────────────────────────────
declare module "mailparser" {
  export interface ParsedMail {
    subject?: string;
    from?: { text: string; value: Array<{ address: string; name: string }> };
    to?: { text: string }; text?: string; html?: string; date?: Date;
    attachments?: Array<{ filename: string; content: Buffer; contentType: string }>;
  }
  export function simpleParser(source: Buffer | string): Promise<ParsedMail>;
}

// ── p-retry ───────────────────────────────────────────────────────────────────
declare module "p-retry" {
  export interface Options {
    retries?: number;
    onFailedAttempt?: (error: Error & { attemptNumber: number; retriesLeft: number }) => void | Promise<void>;
    minTimeout?: number; maxTimeout?: number; factor?: number;
  }
  export default function pRetry<T>(fn: (attempt: number) => Promise<T>, opts?: Options): Promise<T>;
}

// ── p-queue ───────────────────────────────────────────────────────────────────
declare module "p-queue" {
  export interface QueueOptions { concurrency?: number; autoStart?: boolean }
  export default class PQueue {
    constructor(opts?: QueueOptions);
    add<T>(fn: () => Promise<T>): Promise<T>;
    onIdle(): Promise<void>;
    get size(): number;
    get pending(): number;
    clear(): void;
  }
}

// ── node-fetch ────────────────────────────────────────────────────────────────
declare module "node-fetch" {
  export interface RequestInit {
    method?: string; headers?: Record<string, string>;
    body?: string | Buffer; redirect?: "follow" | "manual" | "error";
  }
  export interface Response {
    ok: boolean; status: number; statusText: string;
    headers: { get(name: string): string | null; raw(): Record<string, string[]> };
    text(): Promise<string>; json(): Promise<unknown>; buffer(): Promise<Buffer>;
  }
  export default function fetch(url: string, init?: RequestInit): Promise<Response>;
}

// ── supertest ─────────────────────────────────────────────────────────────────
declare module "supertest" {
  import type { Application } from "express";
  interface TestResponse { status: number; body: unknown; headers: Record<string, string>; text: string }
  interface Test extends Promise<TestResponse> {
    set(field: string, value: string): this;
    send(data: unknown): this;
    expect(status: number): this;
  }
  interface SuperTest {
    get(url: string): Test; post(url: string): Test;
    put(url: string): Test; delete(url: string): Test;
  }
  export default function request(app: Application | string): SuperTest;
}

// ── vitest ────────────────────────────────────────────────────────────────────
declare module "vitest" {
  export function describe(name: string, fn: () => void): void;
  export function it(name: string, fn: () => void | Promise<void>): void;
  export function test(name: string, fn: () => void | Promise<void>): void;
  export function expect(value: unknown): Matchers;
  export function beforeAll(fn: () => void | Promise<void>): void;
  export function afterAll(fn: () => void | Promise<void>): void;
  export function beforeEach(fn: () => void | Promise<void>): void;
  export function afterEach(fn: () => void | Promise<void>): void;
  export const vi: {
    fn(): MockFn;
    spyOn(obj: object, method: string): MockFn;
    mock(moduleName: string, factory?: () => unknown): void;
    clearAllMocks(): void; resetAllMocks(): void; restoreAllMocks(): void;
  };
  export interface MockFn {
    (...args: unknown[]): unknown;
    mockReturnValue(val: unknown): this;
    mockResolvedValue(val: unknown): this;
    mockResolvedValueOnce(val: unknown): this;
    mockRejectedValueOnce(err: unknown): this;
    mockImplementation(fn: (...args: unknown[]) => unknown): this;
    mockImplementationOnce(fn: (...args: unknown[]) => unknown): this;
    mockReturnValueOnce(val: unknown): this;
    mockReset(): this;
    mockClear(): this;
    mock: { calls: unknown[][]; results: Array<{ type: "return" | "throw"; value: unknown }> };
  }
  export interface Matchers {
    toBe(expected: unknown): void; toEqual(expected: unknown): void;
    toStrictEqual(expected: unknown): void;
    toBeTruthy(): void; toBeFalsy(): void; toBeNull(): void;
    toBeUndefined(): void; toBeDefined(): void;
    toBeGreaterThan(n: number): void; toBeGreaterThanOrEqual(n: number): void;
    toBeLessThan(n: number): void; toBeLessThanOrEqual(n: number): void;
    toHaveLength(n: number): void; toContain(value: unknown): void;
    toMatch(pattern: RegExp | string): void;
    toHaveProperty(key: string, value?: unknown): void;
    toMatchObject(obj: unknown): void;
    toThrow(error?: string | RegExp | (new (...args: unknown[]) => unknown)): void;
    rejects: Matchers; resolves: Matchers;
    toHaveBeenCalled(): void; toHaveBeenCalledOnce(): void;
    toHaveBeenCalledTimes(n: number): void; toHaveBeenCalledWith(...args: unknown[]): void;
    not: Matchers;
  }
}
