import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { loadConfig, validateDateRange } from "../src/config.js";
import { redact } from "../src/logger.js";
import { makeAllowlist } from "../src/classifier.js";

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

test("扫描配置只使用本地邮箱和域名白名单", () => {
  const tempPath = path.resolve("tests", `.tmp-local-config-${process.pid}.json`);
  fs.writeFileSync(tempPath, JSON.stringify({
    coremail: {
      baseUrl: "https://157.255.37.89",
      cookie: "JSESSIONID=test; Coremail.sid=SAFE_TEST_SID",
      pageSize: 10,
    },
    classification: {
      cacSubjectBlacklist: ["本地 CAC 主题"],
      localAllowlist: {
        emails: ["Safe@Example.com"],
        domains: ["@Partner.COM"],
      },
    },
  }), "utf8");
  const config = loadConfig({ configPath: tempPath });
  const allowlist = makeAllowlist(config.classification.localAllowlist);
  assert.equal(allowlist.emails.has("safe@example.com"), true);
  assert.equal(allowlist.domains.has("partner.com"), true);
  assert.deepEqual(config.classification.cacSubjectBlacklist, ["本地 CAC 主题"]);
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
  }), "utf8");
  try {
    const config = loadConfig({ configPath: tempPath });
    assert.equal(config.coremail.auth.mode, "playwright");
    assert.equal(config.coremail.cookie, undefined);
    assert.deepEqual(config.classification.cacSubjectBlacklist, []);
  } finally {
    fs.rmSync(tempPath, { force: true });
  }
});

test("auto 模式优先使用账号密码生成新 Cookie", () => {
  const tempPath = path.resolve("tests", `.tmp-auto-auth-config-${process.pid}.json`);
  fs.writeFileSync(tempPath, JSON.stringify({
    coremail: {
      baseUrl: "https://157.255.37.89",
      cookie: "JSESSIONID=stale; Coremail.sid=STALE_TEST_SID",
      auth: {
        mode: "auto",
        username: "test-user",
        password: "test-password",
      },
    },
  }), "utf8");
  try {
    const config = loadConfig({ configPath: tempPath });
    assert.equal(config.coremail.auth.mode, "playwright");
  } finally {
    fs.rmSync(tempPath, { force: true });
  }
});

test("旧 cookie 模式缺少静态 Cookie 时自动迁移到账号密码登录", () => {
  const tempPath = path.resolve("tests", `.tmp-legacy-auth-config-${process.pid}.json`);
  fs.writeFileSync(tempPath, JSON.stringify({
    coremail: {
      baseUrl: "https://157.255.37.89",
      auth: {
        mode: "cookie",
        username: "test-user",
        password: "test-password",
      },
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
