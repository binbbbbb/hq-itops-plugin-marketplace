#!/usr/bin/env node
import { ensurePythonRuntime, inspectPythonRuntime, runCommand } from "../src/python-runtime.js";

async function main() {
  const action = process.argv[2];
  if (!new Set(["setup", "doctor"]).has(action)) {
    console.error("用法: node scripts/runtime-cli.js <setup|doctor>");
    return 2;
  }

  if (action === "setup") {
    const runtime = await ensurePythonRuntime({ report: (message) => console.error(message) });
    console.log(`Python 运行环境已就绪，Playwright ${runtime.details.playwright}。`);
    return 0;
  }

  const runtime = await inspectPythonRuntime();
  if (!runtime.healthy) {
    console.error("插件专属 Python 环境尚未就绪。请运行 npm run setup，或直接执行首次扫描以自动初始化。");
    return 1;
  }

  const importCheck = await runCommand(runtime.pythonExecutable, [
    "-c",
    "from playwright.sync_api import sync_playwright; print('ok')",
  ], { timeoutMs: 20_000 });
  if (!importCheck.ok) {
    console.error("Playwright 模块导入失败，请重新运行 npm run setup。");
    return 1;
  }
  console.log(`运行环境健康：Python ${runtime.details.python.join(".")}，Playwright ${runtime.details.playwright}。`);
  return 0;
}

main()
  .then((code) => { process.exitCode = code; })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
