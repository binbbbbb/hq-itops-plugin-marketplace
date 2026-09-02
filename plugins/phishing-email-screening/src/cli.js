#!/usr/bin/env node
import { consoleRows } from "./report.js";
import { createScanService } from "./scan-service.js";
import { EXIT_CODES, AppError, AuthExpiredError, ConfigError } from "./errors.js";

export function parseArgs(argv) {
  const args = { json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--json") args.json = true;
    else if (["--begin", "--end", "--page-size", "--config"].includes(token)) {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new ConfigError(`${token} 缺少参数值`);
      index += 1;
      if (token === "--begin") args.begin = value;
      if (token === "--end") args.end = value;
      if (token === "--config") args.configPath = value;
      if (token === "--page-size") args.pageSize = Number(value);
    } else if (token === "--help" || token === "-h") args.help = true;
    else throw new ConfigError(`未知参数：${token}`);
  }
  if (args.pageSize !== undefined && (!Number.isInteger(args.pageSize) || args.pageSize < 1 || args.pageSize > 500)) {
    throw new ConfigError("--page-size 必须是 1 到 500 的整数");
  }
  return args;
}

function printHelp() {
  console.log("用法: npm run scan -- [--begin YYYY-MM-DD] [--end YYYY-MM-DD] [--page-size 100] [--json] [--config path]");
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return EXIT_CODES.OK;
  }
  try {
    const { items, summary, reportPaths } = await createScanService()({
      begin: args.begin,
      end: args.end,
      pageSize: args.pageSize,
      configPath: args.configPath,
    });
    if (args.json) console.log(JSON.stringify({ summary, reportPaths }, null, 2));
    else {
      console.table(consoleRows(items));
      console.log(`报告目录：${reportPaths.reportDir}`);
      console.log(`汇总：可信候选 ${summary.counts["可信候选"]}，待确认 ${summary.counts["待确认"]}，可疑 ${summary.counts["可疑"]}`);
    }
    return EXIT_CODES.OK;
  } catch (error) {
    if (error instanceof AuthExpiredError) {
      console.error("Coremail 自动鉴权失败。请检查本机配置的账号密码、Chrome 和网络。插件会根据账号密码生成请求所需的 Cookie，不要在 Agent 对话中粘贴凭据或 Cookie。");
      if (error.diagnosticCode) console.error(`诊断：${error.message}（${error.diagnosticCode}）`);
    } else {
      console.error(error.message);
    }
    if (error.logPath) console.error(`日志：${error.logPath}`);
    return error instanceof AppError ? error.exitCode : EXIT_CODES.DATA;
  }
}

run()
  .then((exitCode) => { process.exitCode = exitCode; })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = error instanceof AppError ? error.exitCode : EXIT_CODES.DATA;
  });
