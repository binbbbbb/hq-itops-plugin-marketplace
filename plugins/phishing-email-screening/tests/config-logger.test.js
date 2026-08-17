import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { loadConfig, validateDateRange } from "../src/config.js";
import { redact } from "../src/logger.js";

test("日期范围校验包含正确顺序和真实日期", () => {
  assert.deepEqual(validateDateRange("2026-08-01", "2026-08-05"), { begin: "2026-08-01", end: "2026-08-05" });
  assert.throws(() => validateDateRange("2026-08-06", "2026-08-05"));
  assert.throws(() => validateDateRange("2026-02-30", "2026-03-01"));
});

test("日志脱敏不会保留 Cookie、sid 或 Bearer token", () => {
  const output = redact("JSESSIONID=secret; Coremail.sid=very_secret_sid; Bearer abc.def");
  assert.doesNotMatch(output, /secret_sid|JSESSIONID=secret|abc\.def/);
  assert.match(output, /\[REDACTED\]/);
});

test("MCP 页面模式不要求 Notion Token 或 Data Source ID", () => {
  const tempPath = path.resolve("tests", `.tmp-mcp-config-${process.pid}.json`);
  fs.writeFileSync(tempPath, JSON.stringify({
    coremail: {
      baseUrl: "https://157.255.37.89",
      cookie: "JSESSIONID=test; Coremail.sid=SAFE_TEST_SID",
      pageSize: 10,
    },
    notion: {
      mode: "mcp",
      allowlistPageId: "allowlist-page",
      resultsPageId: "results-page",
      executionLogPageId: "log-page",
    },
  }), "utf8");
  const config = loadConfig({ configPath: tempPath });
  assert.equal(config.notion.mode, "mcp");
  fs.rmSync(tempPath, { force: true });
});

test("Playwright 自动登录模式不要求静态 Cookie", () => {
  const tempPath = path.resolve("tests", `.tmp-auth-config-${process.pid}.json`);
  fs.writeFileSync(tempPath, JSON.stringify({
    coremail: {
      baseUrl: "https://157.255.37.89",
      auth: {
        mode: "playwright",
        username: "test-user",
        password: "test-password",
      },
    },
    notion: {
      mode: "mcp",
      allowlistPageId: "allowlist-page",
      resultsPageId: "results-page",
      executionLogPageId: "log-page",
    },
  }), "utf8");
  try {
    const config = loadConfig({ configPath: tempPath });
    assert.equal(config.coremail.auth.mode, "playwright");
    assert.equal(config.coremail.cookie, undefined);
  } finally {
    fs.rmSync(tempPath, { force: true });
  }
});
