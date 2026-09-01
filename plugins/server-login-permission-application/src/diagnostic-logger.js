const SAFE_FIELD_NAMES = new Set([
  "trace_id",
  "transport",
  "method",
  "tool",
  "status",
  "duration_ms",
  "error_code"
]);

function safeFields(fields) {
  const result = {};
  for (const [key, value] of Object.entries(fields ?? {})) {
    if (!SAFE_FIELD_NAMES.has(key) || value === undefined || value === null || value === "") continue;
    if (key === "duration_ms") {
      result[key] = Math.max(0, Math.round(Number(value) || 0));
      continue;
    }
    result[key] = String(value).slice(0, 100).replace(/[\r\n\t]/g, " ");
  }
  return result;
}

function localTimestamp(date, timeZone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    fractionalSecondDigits: 3,
    hourCycle: "h23",
    timeZoneName: "longOffset"
  }).formatToParts(date).map((part) => [part.type, part.value]));
  const offset = String(parts.timeZoneName ?? "GMT+00:00").replace(/^GMT/, "");
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}.${parts.fractionalSecond}${offset}`;
}

export function createDiagnosticLogger({
  level = process.env.MCP_LOG_LEVEL || "info",
  format = process.env.MCP_LOG_FORMAT || "text",
  timeZone = process.env.MCP_LOG_TIME_ZONE || "Asia/Shanghai",
  output = process.stderr,
  now = () => new Date()
} = {}) {
  const enabled = String(level).trim().toLowerCase() !== "off";
  const json = String(format).trim().toLowerCase() === "json";

  return {
    info(event, fields = {}) {
      if (!enabled) return;
      const timestamp = localTimestamp(now(), timeZone);
      const safe = safeFields(fields);
      if (json) {
        output.write(`${JSON.stringify({ timestamp, level: "INFO", event, ...safe })}\n`);
        return;
      }
      const suffix = Object.entries(safe).map(([key, value]) => `${key}=${value}`).join(" ");
      output.write(`${timestamp.replace("T", " ")} INFO ${event}${suffix ? ` ${suffix}` : ""}\n`);
    }
  };
}
