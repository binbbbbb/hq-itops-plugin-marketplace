import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ConfigError } from "./errors.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const requirementsPath = path.join(projectRoot, "requirements.lock");
const REQUIRED_PLAYWRIGHT_VERSION = "1.62.0";
const RUNTIME_SCHEMA_VERSION = "2";
const LOCK_WAIT_MS = 120_000;
const LOCK_STALE_MS = 10 * 60_000;
const COMMAND_TIMEOUT_MS = 120_000;
const INSTALL_TIMEOUT_MS = 10 * 60_000;
const MAX_OUTPUT = 64 * 1024;

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export function runtimeBaseDir({ env = process.env, platform = process.platform, home = os.homedir() } = {}) {
  if (env.PHISHING_EMAIL_SCREENING_RUNTIME_DIR) {
    return path.resolve(env.PHISHING_EMAIL_SCREENING_RUNTIME_DIR);
  }
  if (platform === "win32") {
    const localAppData = env.LOCALAPPDATA || path.join(home, "AppData", "Local");
    return path.join(localAppData, "HQ-ITOps", "phishing-email-screening", "runtime");
  }
  if (platform === "darwin") {
    return path.join(home, "Library", "Application Support", "HQ-ITOps", "phishing-email-screening", "runtime");
  }
  const dataHome = env.XDG_DATA_HOME || path.join(home, ".local", "share");
  return path.join(dataHome, "hq-itops", "phishing-email-screening", "runtime");
}

export function pythonCandidates({ env = process.env, platform = process.platform } = {}) {
  const candidates = [];
  if (env.PHISHING_EMAIL_SCREENING_PYTHON) {
    candidates.push({ command: env.PHISHING_EMAIL_SCREENING_PYTHON, args: [], source: "environment" });
  }
  if (platform === "win32") {
    candidates.push({ command: "python", args: [], source: "path" });
    candidates.push({ command: "py", args: ["-3"], source: "launcher" });
  } else {
    candidates.push({ command: "python3", args: [], source: "path" });
    candidates.push({ command: "python", args: [], source: "path" });
  }
  return candidates;
}

export function venvPythonPath(venvDir, platform = process.platform) {
  return platform === "win32"
    ? path.join(venvDir, "Scripts", "python.exe")
    : path.join(venvDir, "bin", "python");
}

export function runCommand(command, args, {
  cwd = projectRoot,
  timeoutMs = COMMAND_TIMEOUT_MS,
  input,
  env = process.env,
} = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, args, {
        cwd,
        env,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
        shell: false,
      });
    } catch (error) {
      resolve({ ok: false, code: null, stdout: "", stderr: "", error });
      return;
    }
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      if (stdout.length > MAX_OUTPUT) child.kill();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
      if (stderr.length > MAX_OUTPUT) child.kill();
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ ok: false, code: null, stdout, stderr, error, timedOut });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0 && !timedOut, code, stdout, stderr, timedOut });
    });
    child.stdin.end(input);
  });
}

function runtimePaths(options = {}) {
  const requirements = fs.readFileSync(requirementsPath);
  const fingerprint = crypto.createHash("sha256")
    .update(requirements)
    .update(`\0runtime-schema-${RUNTIME_SCHEMA_VERSION}`)
    .digest("hex")
    .slice(0, 16);
  const runtimeDir = path.join(runtimeBaseDir(options), fingerprint);
  const venvDir = path.join(runtimeDir, "venv");
  return {
    fingerprint,
    runtimeDir,
    venvDir,
    pythonExecutable: venvPythonPath(venvDir, options.platform),
    lockPath: path.join(runtimeDir, "setup.lock"),
    statePath: path.join(runtimeDir, "state.json"),
  };
}

async function probePython(candidate, execute = runCommand) {
  const script = [
    "import json, sys",
    "print(json.dumps({'executable': sys.executable, 'version': list(sys.version_info[:3])}))",
  ].join("; ");
  const result = await execute(candidate.command, [...candidate.args, "-c", script], { timeoutMs: 15_000 });
  if (!result.ok) return null;
  try {
    const parsed = JSON.parse(result.stdout.trim());
    if (!Array.isArray(parsed.version) || parsed.version[0] !== 3 || parsed.version[1] < 9) return null;
    return { ...candidate, executable: parsed.executable, version: parsed.version.join(".") };
  } catch {
    return null;
  }
}

export async function discoverPython({ execute = runCommand, ...options } = {}) {
  for (const candidate of pythonCandidates(options)) {
    const discovered = await probePython(candidate, execute);
    if (discovered) return discovered;
  }
  return null;
}

async function probeRuntime(pythonExecutable, execute = runCommand) {
  if (!fs.existsSync(pythonExecutable)) return { healthy: false, reason: "missing" };
  const script = [
    "import importlib.metadata as m, json, sys",
    "print(json.dumps({'python': list(sys.version_info[:3]), 'playwright': m.version('playwright')}))",
  ].join("; ");
  const result = await execute(pythonExecutable, ["-c", script], { timeoutMs: 20_000 });
  if (!result.ok) return { healthy: false, reason: "unusable" };
  try {
    const details = JSON.parse(result.stdout.trim());
    return {
      healthy: details.playwright === REQUIRED_PLAYWRIGHT_VERSION,
      reason: details.playwright === REQUIRED_PLAYWRIGHT_VERSION ? null : "version-mismatch",
      details,
    };
  } catch {
    return { healthy: false, reason: "invalid-output" };
  }
}

async function acquireLock(lockPath) {
  const startedAt = Date.now();
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  while (Date.now() - startedAt < LOCK_WAIT_MS) {
    try {
      const handle = fs.openSync(lockPath, "wx");
      fs.writeFileSync(handle, JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }));
      return () => {
        try { fs.closeSync(handle); } catch {}
        try { fs.rmSync(lockPath, { force: true }); } catch {}
      };
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      try {
        const age = Date.now() - fs.statSync(lockPath).mtimeMs;
        if (age > LOCK_STALE_MS) {
          fs.rmSync(lockPath, { force: true });
          continue;
        }
      } catch (statError) {
        if (statError.code !== "ENOENT") throw statError;
      }
      await delay(500);
    }
  }
  throw new ConfigError("等待插件 Python 运行环境初始化超时，请稍后重试。");
}

function commandFailureMessage(prefix, result) {
  if (result.timedOut) return `${prefix}超时`;
  if (result.error?.code === "ENOENT") return `${prefix}失败：命令不存在`;
  const lastLine = result.stderr.trim().split(/\r?\n/).filter(Boolean).at(-1);
  return lastLine ? `${prefix}失败：${lastLine.slice(0, 300)}` : `${prefix}失败`;
}

export async function inspectPythonRuntime({ execute = runCommand, ...options } = {}) {
  const paths = runtimePaths(options);
  const probe = await probeRuntime(paths.pythonExecutable, execute);
  return { ...paths, ...probe, requiredPlaywrightVersion: REQUIRED_PLAYWRIGHT_VERSION };
}

export async function ensurePythonRuntime({
  execute = runCommand,
  report = () => {},
  ...options
} = {}) {
  let status = await inspectPythonRuntime({ execute, ...options });
  if (status.healthy) return status;

  const releaseLock = await acquireLock(status.lockPath);
  try {
    status = await inspectPythonRuntime({ execute, ...options });
    if (status.healthy) return status;

    const basePython = await discoverPython({ execute, ...options });
    if (!basePython) {
      throw new ConfigError(
        "未找到 Python 3.9 或更高版本。请安装 Python，或通过 PHISHING_EMAIL_SCREENING_PYTHON 环境变量指定解释器。",
      );
    }

    report(`正在创建插件专属 Python 环境（Python ${basePython.version}）...`);
    fs.rmSync(status.venvDir, { recursive: true, force: true });
    const createResult = await execute(
      basePython.command,
      [...basePython.args, "-m", "venv", status.venvDir],
      { timeoutMs: COMMAND_TIMEOUT_MS },
    );
    if (!createResult.ok) throw new ConfigError(commandFailureMessage("创建插件专属 Python 环境", createResult));

    report(`正在安装锁定版 Playwright ${REQUIRED_PLAYWRIGHT_VERSION}，首次运行可能需要几分钟...`);
    const installResult = await execute(status.pythonExecutable, [
      "-m", "pip", "install",
      "--disable-pip-version-check",
      "--no-input",
      "--no-deps",
      "-r", requirementsPath,
    ], { timeoutMs: INSTALL_TIMEOUT_MS });
    if (!installResult.ok) throw new ConfigError(commandFailureMessage("安装 Playwright 运行依赖", installResult));

    const verified = await inspectPythonRuntime({ execute, ...options });
    if (!verified.healthy) throw new ConfigError("插件专属 Python 环境创建完成，但 Playwright 校验失败。");
    fs.writeFileSync(verified.statePath, `${JSON.stringify({
      fingerprint: verified.fingerprint,
      playwrightVersion: REQUIRED_PLAYWRIGHT_VERSION,
      initializedAt: new Date().toISOString(),
    }, null, 2)}\n`, "utf8");
    report("插件专属 Python 环境已准备完成。");
    return verified;
  } finally {
    releaseLock();
  }
}

export const pythonRuntimeInternals = {
  projectRoot,
  requirementsPath,
  requiredPlaywrightVersion: REQUIRED_PLAYWRIGHT_VERSION,
};
