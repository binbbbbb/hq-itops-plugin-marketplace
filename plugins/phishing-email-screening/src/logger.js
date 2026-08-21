import fs from "node:fs";
import path from "node:path";

export function redact(text) {
  return String(text ?? "")
    .replace(/(JSESSIONID|Coremail(?:\.sid)?)=[^;\s]+/gi, (_match, name) => `${name}=[REDACTED]`)
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [REDACTED]")
    .replace(/~[A-Za-z0-9_-]{12,}~?/g, "~[REDACTED]~");
}

export function createLogger(projectRoot, runId) {
  const logDir = path.join(projectRoot, "logs");
  fs.mkdirSync(logDir, { recursive: true });
  const logPath = path.join(logDir, `${runId}.log`);
  const write = (level, message) => {
    const line = `${new Date().toISOString()} ${level} ${redact(message)}\n`;
    fs.appendFileSync(logPath, line, "utf8");
  };
  return {
    logPath,
    info: (message) => write("INFO", message),
    error: (message) => write("ERROR", message),
  };
}
