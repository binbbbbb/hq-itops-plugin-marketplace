import fs from "node:fs";
import path from "node:path";
import { ConfigError } from "./errors.js";

export const DEFAULT_CONFIG_PATH = path.resolve("config", "config.local.json");

const DEFAULTS = Object.freeze({
  timezone: "Asia/Shanghai",
  coremail: {
    baseUrl: "https://157.255.37.89",
    allowInsecureTls: false,
    timeoutMs: 20000,
    pageSize: 100,
    auth: {
      mode: "auto",
      scriptPath: "scripts/get_coremail_cookie.py",
      loginPath: "/webadmin/",
      browserChannel: "chrome",
      headless: true,
      timeoutMs: 30000,
      postLoginWaitMs: 1000,
    },
  },
  classification: {
    internalDomains: [],
    approvedServers: [],
    sensitiveSubjectKeywords: [],
    cacSubjectBlacklist: [],
    localAllowlist: { emails: [], domains: [] },
  },
});

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function deepMerge(base, override) {
  const result = structuredClone(base);
  for (const [key, value] of Object.entries(override ?? {})) {
    if (isPlainObject(value) && isPlainObject(result[key])) {
      result[key] = deepMerge(result[key], value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

function requireNonPlaceholder(value, name) {
  if (!value || /^REPLACE_/i.test(String(value))) {
    throw new ConfigError(`缺少配置：${name}`);
  }
}

function hasConfiguredValue(value) {
  return Boolean(value) && !/^REPLACE_/i.test(String(value));
}

function requireStringArray(value, name) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new ConfigError(`${name} 必须是字符串数组`);
  }
}

export function loadConfig({ configPath = DEFAULT_CONFIG_PATH } = {}) {
  const resolved = path.resolve(configPath);
  if (!fs.existsSync(resolved)) {
    throw new ConfigError(
      `配置文件不存在：${resolved}。请复制 config/config.example.json 为 config/config.local.json 并在本机填写。`,
    );
  }

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(resolved, "utf8"));
  } catch (error) {
    throw new ConfigError(`配置文件不是有效 JSON：${resolved}`, { cause: error });
  }

  const config = deepMerge(DEFAULTS, parsed);
  config.coremail.cookie = process.env.COREMAIL_COOKIE || config.coremail.cookie;
  config.coremail.auth.username = process.env.COREMAIL_USERNAME || config.coremail.auth.username;
  config.coremail.auth.password = process.env.COREMAIL_PASSWORD || config.coremail.auth.password;

  if (!["auto", "cookie", "playwright"].includes(config.coremail.auth.mode)) {
    throw new ConfigError("coremail.auth.mode 必须是 auto、cookie 或 playwright");
  }

  const hasCookie = hasConfiguredValue(config.coremail.cookie);
  const hasUsername = hasConfiguredValue(config.coremail.auth.username);
  const hasPassword = hasConfiguredValue(config.coremail.auth.password);
  const hasCredentials = hasUsername && hasPassword;

  if (config.coremail.auth.mode === "auto") {
    if (hasCredentials) config.coremail.auth.mode = "playwright";
    else if (hasCookie) config.coremail.auth.mode = "cookie";
    else throw new ConfigError("缺少 Coremail 自动登录凭据或可用 Cookie");
  } else if (config.coremail.auth.mode === "cookie" && !hasCookie && hasCredentials) {
    // Compatibility migration for local files that selected cookie mode before
    // automatic credential-based authentication became the default.
    config.coremail.auth.mode = "playwright";
  }

  if (config.coremail.auth.mode === "cookie") {
    requireNonPlaceholder(config.coremail.cookie, "coremail.cookie / COREMAIL_COOKIE");
  } else {
    requireNonPlaceholder(config.coremail.auth.username, "coremail.auth.username / COREMAIL_USERNAME");
    requireNonPlaceholder(config.coremail.auth.password, "coremail.auth.password / COREMAIL_PASSWORD");
    requireNonPlaceholder(config.coremail.auth.scriptPath, "coremail.auth.scriptPath");
    if (!Number.isInteger(config.coremail.auth.timeoutMs) || config.coremail.auth.timeoutMs < 1000) {
      throw new ConfigError("coremail.auth.timeoutMs 必须是不小于 1000 的整数");
    }
  }
  if (config.coremail.baseUrl !== "https://157.255.37.89") {
    throw new ConfigError("coremail.baseUrl 只允许配置为 https://157.255.37.89");
  }
  if (!Number.isInteger(config.coremail.pageSize) || config.coremail.pageSize < 1 || config.coremail.pageSize > 500) {
    throw new ConfigError("coremail.pageSize 必须是 1 到 500 的整数");
  }

  if (!isPlainObject(config.classification)) throw new ConfigError("classification 必须是对象");
  if (!isPlainObject(config.classification.localAllowlist)) {
    throw new ConfigError("classification.localAllowlist 必须是对象");
  }
  requireStringArray(config.classification.localAllowlist.emails, "classification.localAllowlist.emails");
  requireStringArray(config.classification.localAllowlist.domains, "classification.localAllowlist.domains");
  requireStringArray(config.classification.cacSubjectBlacklist, "classification.cacSubjectBlacklist");

  config.__path = resolved;
  return config;
}

export function todayInTimezone(timezone = "Asia/Shanghai", now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function validateDateRange(begin, end) {
  const pattern = /^\d{4}-\d{2}-\d{2}$/;
  if (!pattern.test(begin) || !pattern.test(end)) {
    throw new ConfigError("日期必须使用 YYYY-MM-DD 格式");
  }
  const valid = (value) => {
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
  };
  if (!valid(begin) || !valid(end)) throw new ConfigError("日期值无效");
  if (begin > end) throw new ConfigError("开始日期不能晚于结束日期");
  return { begin, end };
}
