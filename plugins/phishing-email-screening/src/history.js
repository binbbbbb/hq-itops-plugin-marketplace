import fs from "node:fs";
import path from "node:path";

const RUN_ID_PATTERN = /^\d{8}T\d{6}Z$/;

function matchingEntries(directory, selectRunId) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true })
    .map(selectRunId)
    .filter((runId) => RUN_ID_PATTERN.test(runId));
}

export function pruneLocalHistory(projectRoot, keep = 10) {
  if (!Number.isInteger(keep) || keep < 1) throw new TypeError("keep 必须是正整数");
  const reportRoot = path.join(projectRoot, "reports");
  const logRoot = path.join(projectRoot, "logs");
  const reportRunIds = matchingEntries(reportRoot, (entry) => entry.isDirectory() ? entry.name : "");
  const logRunIds = matchingEntries(logRoot, (entry) => {
    if (!entry.isFile() || path.extname(entry.name) !== ".log") return "";
    return path.basename(entry.name, ".log");
  });
  const allRunIds = [...new Set([...reportRunIds, ...logRunIds])].sort().reverse();
  const retainedRunIds = allRunIds.slice(0, keep);
  const removedRunIds = allRunIds.slice(keep);

  for (const runId of removedRunIds) {
    fs.rmSync(path.join(reportRoot, runId), { recursive: true, force: true });
    fs.rmSync(path.join(logRoot, `${runId}.log`), { force: true });
  }
  return { retainedRunIds, removedRunIds };
}
