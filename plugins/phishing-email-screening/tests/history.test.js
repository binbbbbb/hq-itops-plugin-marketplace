import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pruneLocalHistory } from "../src/history.js";

test("本地报告和日志按运行 ID 合并保留最近十次", () => {
  const root = path.resolve("tests", `.tmp-history-${process.pid}-${Date.now()}`);
  const reports = path.join(root, "reports");
  const logs = path.join(root, "logs");
  fs.mkdirSync(reports, { recursive: true });
  fs.mkdirSync(logs, { recursive: true });
  const runIds = Array.from({ length: 12 }, (_, index) => `20260818T0100${String(index).padStart(2, "0")}Z`);
  for (const [index, runId] of runIds.entries()) {
    fs.writeFileSync(path.join(logs, `${runId}.log`), "test", "utf8");
    if (index !== 3) fs.mkdirSync(path.join(reports, runId), { recursive: true });
  }
  fs.writeFileSync(path.join(logs, "keep-me.txt"), "unrelated", "utf8");

  try {
    const result = pruneLocalHistory(root, 10);
    assert.deepEqual(result.removedRunIds, [runIds[1], runIds[0]]);
    assert.equal(fs.existsSync(path.join(logs, `${runIds[0]}.log`)), false);
    assert.equal(fs.existsSync(path.join(reports, runIds[1])), false);
    assert.equal(fs.existsSync(path.join(logs, `${runIds[11]}.log`)), true);
    assert.equal(fs.existsSync(path.join(logs, "keep-me.txt")), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
