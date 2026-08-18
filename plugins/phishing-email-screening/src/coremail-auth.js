import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { AuthExpiredError, ConfigError } from "./errors.js";
import { parseCookie } from "./coremail.js";
import { ensurePythonRuntime } from "./python-runtime.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MAX_HELPER_OUTPUT = 64 * 1024;

function runCookieHelper({ pythonExecutable, scriptPath, request, timeoutMs }) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(pythonExecutable, [scriptPath], {
        cwd: projectRoot,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });
    } catch (error) {
      reject(new ConfigError(`无法启动 Coremail 自动登录程序：${error.message}`, { cause: error }));
      return;
    }
    let stdout = "";
    let stderr = "";
    let settled = false;

    const finish = (callback) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback();
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(() => reject(new AuthExpiredError("Coremail 自动登录超时，请检查本机网络、Chrome 和登录配置。")));
    }, timeoutMs + 10_000);

    child.on("error", (error) => {
      finish(() => reject(new ConfigError(`无法启动 Coremail 自动登录程序：${error.message}`, { cause: error })));
    });
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      if (stdout.length > MAX_HELPER_OUTPUT) child.kill();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
      if (stderr.length > MAX_HELPER_OUTPUT) child.kill();
    });
    child.on("close", (code) => {
      finish(() => {
        if (code !== 0) {
          reject(new AuthExpiredError("Coremail 自动登录失败，请检查本机凭据、Chrome 和网络后重试。"));
          return;
        }
        try {
          resolve(JSON.parse(stdout));
        } catch (error) {
          reject(new AuthExpiredError("Coremail 自动登录程序返回了无效结果。", { cause: error }));
        }
      });
    });
    child.stdin.end(JSON.stringify(request));
  });
}

export async function resolveCoremailCookie(config, {
  runHelper = runCookieHelper,
  ensureRuntime = ensurePythonRuntime,
  reportRuntime = (message) => console.error(message),
} = {}) {
  const auth = config.auth ?? { mode: "cookie" };
  if (auth.mode === "cookie") {
    parseCookie(config.cookie);
    return config.cookie;
  }

  const scriptPath = path.resolve(projectRoot, auth.scriptPath);
  if (!fs.existsSync(scriptPath)) {
    throw new ConfigError(`Coremail 自动登录脚本不存在：${scriptPath}`);
  }
  const runtime = await ensureRuntime({ report: reportRuntime });
  const result = await runHelper({
    pythonExecutable: runtime.pythonExecutable,
    scriptPath,
    timeoutMs: auth.timeoutMs,
    request: {
      loginUrl: new URL(auth.loginPath, `${config.baseUrl}/`).href,
      username: auth.username,
      password: auth.password,
      headless: auth.headless,
      browserChannel: auth.browserChannel,
      timeoutMs: auth.timeoutMs,
      postLoginWaitMs: auth.postLoginWaitMs,
    },
  });
  if (!result || typeof result.cookie !== "string") {
    throw new AuthExpiredError("Coremail 自动登录未返回有效 Cookie。");
  }
  parseCookie(result.cookie);
  return result.cookie;
}
