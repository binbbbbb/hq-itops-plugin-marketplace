import assert from "node:assert/strict";
import test from "node:test";
import { createScanService } from "../src/scan-service.js";

test("共享扫描服务保持 CLI 的扫描、报告和历史清理流程", async () => {
  const calls = [];
  const fixedNow = new Date("2026-09-01T12:00:00.000Z");
  const scan = createScanService({
    projectRoot: "plugin-root",
    dependencies: {
      loadConfig: () => ({
        timezone: "Asia/Shanghai",
        coremail: { auth: { mode: "cookie" }, pageSize: 100 },
        classification: { localAllowlist: { emails: [], domains: [] } },
      }),
      todayInTimezone: () => "2026-09-01",
      resolveCoremailCookie: async () => "Coremail.sid=SAFE_TEST_SID",
      fetchAllMail: async (input) => {
        calls.push(input);
        return {
          totalRecords: 1,
          pageCount: 1,
          records: [{ mid: "m1", time: "2026-09-01 09:00:00", from: "a@example.com", to: "b@example.com", subject: "测试" }],
        };
      },
      writeReports: ({ runId }) => ({
        reportDir: `plugin-root/reports/${runId}`,
        markdownPath: "report.md",
        csvPath: "analysis.csv",
        jsonPath: "summary.json",
      }),
      createLogger: () => ({ logPath: "safe.log", info() {}, error() {} }),
      pruneLocalHistory: () => ({ retainedRunIds: [], removedRunIds: [] }),
      now: () => fixedNow,
    },
  });
  const result = await scan({ begin: "2026-08-30", end: "2026-09-01", pageSize: 25 });
  assert.equal(result.runId, "20260901T120000Z");
  assert.equal(result.summary.analyzedRecords, 1);
  assert.equal(result.summary.counts["待确认"], 1);
  assert.equal(result.logPath, "safe.log");
  assert.deepEqual(calls[0], {
    config: { auth: { mode: "cookie" }, pageSize: 100, cookie: "Coremail.sid=SAFE_TEST_SID" },
    begin: "2026-08-30",
    end: "2026-09-01",
    pageSize: 25,
  });
});

