import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  ensurePythonRuntime,
  pythonCandidates,
  runtimeBaseDir,
} from "../src/python-runtime.js";

function ok(stdout = "") {
  return { ok: true, code: 0, stdout, stderr: "" };
}

test("Windows Python 发现优先使用显式环境变量和 PATH 中的 python", () => {
  const candidates = pythonCandidates({
    platform: "win32",
    env: { PHISHING_EMAIL_SCREENING_PYTHON: "D:\\Tools\\python.exe" },
  });
  assert.deepEqual(candidates.slice(0, 2), [
    { command: "D:\\Tools\\python.exe", args: [], source: "environment" },
    { command: "python", args: [], source: "path" },
  ]);
});

test("运行时目录可由环境变量指定，不依赖共享配置中的绝对路径", () => {
  const resolved = runtimeBaseDir({
    env: { PHISHING_EMAIL_SCREENING_RUNTIME_DIR: ".runtime-test" },
    platform: "win32",
    home: "C:\\Users\\test",
  });
  assert.equal(resolved, path.resolve(".runtime-test"));
});

test("首次调用创建专属 venv 并安装锁定版 Playwright，后续调用复用", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "phishing-python-runtime-"));
  const calls = [];
  const execute = async (command, args) => {
    calls.push({ command, args: [...args] });
    const venvIndex = args.indexOf("venv");
    if (args.includes("-m") && venvIndex >= 0) {
      const venvDir = args[venvIndex + 1];
      const pythonPath = path.join(venvDir, "Scripts", "python.exe");
      fs.mkdirSync(path.dirname(pythonPath), { recursive: true });
      fs.writeFileSync(pythonPath, "test", "utf8");
      return ok();
    }
    if (args.includes("pip") && args.includes("install")) return ok();
    if (args[0] === "-c" && command.endsWith("python.exe")) {
      return ok(JSON.stringify({ python: [3, 13, 5], playwright: "1.62.0" }));
    }
    if (command === "py" && args.includes("-c")) {
      return ok(JSON.stringify({ executable: "C:\\Python313\\python.exe", version: [3, 13, 5] }));
    }
    return { ok: false, code: 1, stdout: "", stderr: "not found" };
  };

  try {
    const options = {
      execute,
      env: { PHISHING_EMAIL_SCREENING_RUNTIME_DIR: tempDir },
      platform: "win32",
      home: tempDir,
    };
    const first = await ensurePythonRuntime(options);
    assert.equal(first.healthy, true);
    assert.equal(first.details.playwright, "1.62.0");
    assert.equal(calls.filter(({ args }) => args.includes("install")).length, 1);

    const second = await ensurePythonRuntime(options);
    assert.equal(second.pythonExecutable, first.pythonExecutable);
    assert.equal(calls.filter(({ args }) => args.includes("install")).length, 1);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
