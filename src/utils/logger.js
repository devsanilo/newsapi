/**
 * Winston Logger
 * Centralized logging with file and console transports
 */
const winston = require("winston");
const path = require("path");

const logDir = path.join(process.cwd(), "logs");

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || "info",
  format: winston.format.combine(
    winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
    winston.format.errors({ stack: true }),
    winston.format.json(),
  ),
  defaultMeta: { service: "noozia" },
  transports: [
    // Write errors to error.log
    new winston.transports.File({
      filename: path.join(logDir, "error.log"),
      level: "error",
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    }),
    // Write all logs to combined.log
    new winston.transports.File({
      filename: path.join(logDir, "combined.log"),
      maxsize: 5242880,
      maxFiles: 5,
    }),
  ],
});

// Always log to stdout.
//
// Container platforms (Dokploy, Docker, Kubernetes) capture the process's
// stdout/stderr — NOT files inside the container. Without a Console transport
// a production container emits nothing at all, so a startup crash shows up as
// an empty log viewer and an unexplained 502.
logger.add(
  new winston.transports.Console({
    format:
      process.env.NODE_ENV === "production"
        ? winston.format.combine(
            winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
            winston.format.errors({ stack: true }),
            winston.format.printf(({ timestamp, level, message, stack }) =>
              stack
                ? `${timestamp} [${level}] ${message}\n${stack}`
                : `${timestamp} [${level}] ${message}`,
            ),
          )
        : winston.format.combine(
            winston.format.colorize(),
            winston.format.printf(
              ({ timestamp, level, message, service, ...meta }) => {
                const metaStr = Object.keys(meta).length
                  ? ` ${JSON.stringify(meta)}`
                  : "";
                return `${timestamp} [${level}] ${message}${metaStr}`;
              },
            ),
          ),
  }),
);

module.exports = logger;
