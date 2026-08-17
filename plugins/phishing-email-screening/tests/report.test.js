import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { summarize, writeReports } from "../src/report.js";

test("Markdown、CSV 和 JSON 报告包含全部记录", () => {
  const root = path.resolve("tests", `.tmp-report-${process.pid}-${Date.now()}`);
  fs.mkdirSync(root, { recursive: true });
  const items = [
    {
      mid: "m1", receivedAt: "2026-08-05 08:45:06", sender: "a@example.com", receiver: "b@example.com",
      subject: "测试", senderOrg: "A", receiverOrg: "B", serverName: "app", serverIp: "10.0.0.1",
      allowlistStatus: "未命中", classification: "待确认", confidence: "低", reasons: ["未命中"],
      recommendedAction: "人工确认",
    },
  ];
  const summary = summarize(items, { runId: "run1", begin: "2026-08-05", end: "2026-08-05", totalRecords: 1 });
  const output = writeReports({ projectRoot: root, runId: "run1", items, summary });
  assert.match(fs.readFileSync(output.markdownPath, "utf8"), /a@example\.com/);
  assert.match(fs.readFileSync(output.csvPath, "utf8"), /待确认/);
  assert.equal(JSON.parse(fs.readFileSync(output.jsonPath, "utf8")).analyzedRecords, 1);
  fs.rmSync(root, { recursive: true, force: true });
});
