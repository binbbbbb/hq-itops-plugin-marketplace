import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { AuthExpiredError, ConfigError } from "./errors.js";
import { parseCookie } from "./coremail.js";
import { ensurePythonRuntime } from "./python-runtime.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bundledHelperPath = path.join(projectRoot, "scripts", "get_coremail_cookie.py");
const MAX_HELPER_OUTPUT = 64 * 1024;
const AUTH_DIAGNOSTIC_MESSAGES = Object.freeze({
  BROWSER_START_FAILED: "无法启动配置的 Chrome 浏览器",
  AUTH_INPUT_INVALID: "插件传给登录助手的认证参数无效",
  LOGIN_PAGE_LOAD_FAILED: "无法加载 Coremail 登录页",
  LOGIN_FORM_FAILED: "无法定位或提交 Coremail 登录表单",
  LOGIN_REJECTED: "Coremail 登录页拒绝了本次登录",
  LOGIN_REDIRECT_TIMEOUT: "提交登录后未在限定时间内进入 WebAdmin",
  SESSION_READ_FAILED: "无法读取浏览器中的 Coremail 会话",
  SESSION_NOT_ISSUED: "已进入 WebAdmin，但服务端未签发完整会话信息",
  AUTH_HELPER_FAILED: "Coremail 登录帮助程序执行失败",
  AUTH_HELPER_STDERR_EMPTY: "登录帮助程序异常退出且未返回诊断信息",
  AUTH_HELPER_UNSTRUCTURED: "登录帮助程序返回了旧版或非结构化错误",
  HELPER_NOT_READABLE: "Python 无法读取内置登录帮助脚本",
  HELPER_ENCODING_INVALID: "内置登录帮助脚本编码无效",
  HELPER_SYNTAX_ERROR: "内置登录帮助脚本存在 Python 语法错误",
  HELPER_PYTHON_EXCEPTION: "内置登录帮助脚本在启动阶段发生 Python 异常",
  PLAYWRIGHT_IMPORT_FAILED: "登录帮助脚本无法导入 Playwright",
});

export function parseAuthHelperDiagnostic(stderr) {
  const raw = String(stderr ?? "").trim();
  const lines = raw.split(/\r?\n/).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      const parsed = JSON.parse(lines[index]);
      if (parsed && typeof parsed.code === "string" && AUTH_DIAGNOSTIC_MESSAGES[parsed.code]) {
        return {
          code: parsed.code,
          message: AUTH_DIAGNOSTIC_MESSAGES[parsed.code],
        };
      }
    } catch {
      // Older helpers wrote human-readable stderr. Do not surface it because it
      // can contain untrusted page text or authentication material.
    }
  }
  const embeddedCode = raw.match(/"code"\s*:\s*"([A-Z_]+)"/u)?.[1];
  if (embeddedCode && AUTH_DIAGNOSTIC_MESSAGES[embeddedCode]) {
    return {
      code: embeddedCode,
      message: AUTH_DIAGNOSTIC_MESSAGES[embeddedCode],
    };
  }
  const safePatterns = [
    [/can't open file|No such file/iu, "HELPER_NOT_READABLE"],
    [/UnicodeDecodeError|Non-UTF-8/iu, "HELPER_ENCODING_INVALID"],
    [/SyntaxError/iu, "HELPER_SYNTAX_ERROR"],
    [/ModuleNotFoundError|No module named/iu, "PLAYWRIGHT_IMPORT_FAILED"],
    [/Traceback/iu, "HELPER_PYTHON_EXCEPTION"],
  ];
  for (const [pattern, code] of safePatterns) {
    if (pattern.test(raw)) return { code, message: AUTH_DIAGNOSTIC_MESSAGES[code] };
  }
  return {
    code: raw ? "AUTH_HELPER_UNSTRUCTURED" : "AUTH_HELPER_STDERR_EMPTY",
    message: raw
      ? AUTH_DIAGNOSTIC_MESSAGES.AUTH_HELPER_UNSTRUCTURED
      : AUTH_DIAGNOSTIC_MESSAGES.AUTH_HELPER_STDERR_EMPTY,
  };
}

function helperAuthError(stderr) {
  const diagnostic = parseAuthHelperDiagnostic(stderr);
  const error = new AuthExpiredError(diagnostic.message);
  error.diagnosticCode = diagnostic.code;
  return error;
}

export function stageBundledAuthHelper(runtime) {
  if (!runtime?.runtimeDir) return bundledHelperPath;
  const stagedPath = path.join(runtime.runtimeDir, "get_coremail_cookie.py");
  fs.mkdirSync(runtime.runtimeDir, { recursive: true });
  fs.copyFileSync(bundledHelperPath, stagedPath);
  return stagedPath;
}

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
          reject(helperAuthError(stderr));
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
  const auth = config.auth ?? { mode: "auto" };
  const hasCredentials = Boolean(auth.username && auth.password);
  const useStaticCookie = auth.mode === "cookie" && Boolean(config.cookie);
  if (useStaticCookie || (auth.mode === "auto" && !hasCredentials && config.cookie)) {
    parseCookie(config.cookie);
    return config.cookie;
  }

  // Authentication behavior is part of the plugin package. Always use the
  // bundled helper so a stale or external local path cannot silently bypass
  // fixes and safety checks shipped with the plugin.
  if (!fs.existsSync(bundledHelperPath)) {
    throw new ConfigError(`Coremail 自动登录脚本不存在：${bundledHelperPath}`);
  }
  const runtime = await ensureRuntime({ report: reportRuntime });
  const scriptPath = stageBundledAuthHelper(runtime);
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
