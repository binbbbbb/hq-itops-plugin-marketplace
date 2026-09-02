import path from "node:path";
import { fileURLToPath } from "node:url";
import { classifyAll, makeAllowlist } from "./classifier.js";
import { loadConfig, todayInTimezone, validateDateRange } from "./config.js";
import { resolveCoremailCookie } from "./coremail-auth.js";
import { fetchAllMail } from "./coremail.js";
import { pruneLocalHistory } from "./history.js";
import { createLogger } from "./logger.js";
import { normalizeRecord } from "./normalize.js";
import { summarize, writeReports } from "./report.js";

export const DEFAULT_PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function makeRunId(now = new Date()) {
  return now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

const DEFAULT_DEPENDENCIES = Object.freeze({
  loadConfig,
  todayInTimezone,
  validateDateRange,
  resolveCoremailCookie,
  fetchAllMail,
  makeAllowlist,
  normalizeRecord,
  classifyAll,
  summarize,
  writeReports,
  createLogger,
  pruneLocalHistory,
  now: () => new Date(),
});

export function createScanService({ projectRoot = DEFAULT_PROJECT_ROOT, dependencies = {} } = {}) {
  const deps = { ...DEFAULT_DEPENDENCIES, ...dependencies };

  return async function scan({ begin: requestedBegin, end: requestedEnd, pageSize, configPath } = {}) {
    const config = deps.loadConfig({ ...(configPath ? { configPath } : {}) });
    const today = deps.todayInTimezone(config.timezone);
    const { begin, end } = deps.validateDateRange(
      requestedBegin ?? today,
      requestedEnd ?? requestedBegin ?? today,
    );
    const runId = makeRunId(deps.now());
    const logger = deps.createLogger(projectRoot, runId);

    const cleanHistory = () => {
      try {
        const result = deps.pruneLocalHistory(projectRoot, 10);
        if (result.removedRunIds.length > 0) {
          logger.info(`已清理 ${result.removedRunIds.length} 次过期本地运行记录`);
        }
      } catch (error) {
        logger.error(`本地历史清理失败：${error.message}`);
      }
    };

    try {
      logger.info(`开始扫描 ${begin} 至 ${end}`);
      config.coremail.cookie = await deps.resolveCoremailCookie(config.coremail);
      logger.info(config.coremail.auth.mode === "playwright" ? "Coremail 自动登录成功" : "已加载 Coremail Cookie");
      const allowlist = deps.makeAllowlist(config.classification.localAllowlist);
      logger.info("已加载本地邮箱和域名白名单");
      const fetched = await deps.fetchAllMail({ config: config.coremail, begin, end, pageSize });
      const normalized = fetched.records.map(deps.normalizeRecord);
      const items = deps.classifyAll(normalized, allowlist, config.classification);
      const summary = deps.summarize(items, {
        runId,
        begin,
        end,
        totalRecords: fetched.totalRecords,
        pageCount: fetched.pageCount,
        generatedAt: deps.now().toISOString(),
        allowlistSource: "local",
      });
      const reportPaths = deps.writeReports({ projectRoot, runId, items, summary });
      logger.info(`报告已生成：${reportPaths.reportDir}`);
      return { runId, items, summary, reportPaths, logPath: logger.logPath };
    } catch (error) {
      logger.error(`${error.code ?? "ERROR"}: ${error.message}`);
      if (!error.logPath) error.logPath = logger.logPath;
      throw error;
    } finally {
      cleanHistory();
    }
  };
}
