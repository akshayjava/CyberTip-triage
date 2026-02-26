export type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";

const LEVELS: Record<LogLevel, number> = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
};

export interface Logger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

class ConsoleLogger implements Logger {
  constructor(private context: string) {}

  private get currentLevel(): number {
    const levelStr = (process.env.LOG_LEVEL?.toUpperCase() || "INFO") as LogLevel;
    return LEVELS[levelStr] ?? LEVELS.INFO;
  }

  private log(level: LogLevel, message: string, args: unknown[]) {
    if (LEVELS[level] < this.currentLevel) return;

    const timestamp = new Date().toISOString();
    const prefix = `[${timestamp}] [${level}] [${this.context}]`;

    // Use console methods appropriate for the level
    switch (level) {
      case "ERROR":
        console.error(prefix, message, ...args);
        break;
      case "WARN":
        console.warn(prefix, message, ...args);
        break;
      case "INFO":
        console.log(prefix, message, ...args);
        break;
      case "DEBUG":
        // console.debug is an alias for console.log in Node.js
        console.debug(prefix, message, ...args);
        break;
    }
  }

  debug(message: string, ...args: unknown[]) {
    this.log("DEBUG", message, args);
  }

  info(message: string, ...args: unknown[]) {
    this.log("INFO", message, args);
  }

  warn(message: string, ...args: unknown[]) {
    this.log("WARN", message, args);
  }

  error(message: string, ...args: unknown[]) {
    this.log("ERROR", message, args);
  }
}

export function createLogger(context: string): Logger {
  return new ConsoleLogger(context);
}
