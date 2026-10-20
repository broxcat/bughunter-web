// Structured application logger (pino). Import this instead of using console.*
// so every log line is a filterable JSON object in production and a readable,
// colorized line in development.
//
// Level comes from LOG_LEVEL (default "info"). In development we pipe through a
// pino-pretty transport for human-readable output; in production we emit plain
// newline-delimited JSON for log collectors.
//
// Use `scanLogger(scanRunId)` for anything scan-related (worker, scanners, oob)
// so every line carries `scanRunId` and the whole scan can be correlated
// end-to-end by filtering on that one field.

import pino, { type Logger } from "pino";

const level = process.env.LOG_LEVEL ?? "info";
const isProduction = process.env.NODE_ENV === "production";

export const logger: Logger = pino({
  level,
  ...(isProduction
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "SYS:standard",
            ignore: "pid,hostname",
          },
        },
      }),
});

/**
 * A child logger bound to a scan run. Every line it emits carries `scanRunId`
 * so scan activity (worker, scanners, oob) can be correlated end-to-end.
 */
export function scanLogger(scanRunId: string): Logger {
  return logger.child({ scanRunId });
}
