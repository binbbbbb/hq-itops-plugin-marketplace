import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  parseAuthHelperDiagnostic,
  resolveCoremailCookie,
  stageBundledAuthHelper,
} from "../src/coremail-auth.js";
import { AuthExpiredError } from "../src/errors.js";

const cookie = "JSESSIONID=test; Coremail=abc; Coremail.sid=SAFE_TEST_SID";

test("自动登录帮助程序只暴露固定诊断码", () => {
  assert.deepEqual(parseAuthHelperDiagnostic('{"code":"LOGIN_REJECTED"}\n'), {
    code: "LOGIN_REJECTED",
    message: "Coremail 登录页拒绝了本次登录",
  });
  assert.deepEqual(parseAuthHelperDiagnostic("untrusted page output"), {
    code: "AUTH_HELPER_UNSTRUCTURED",
    message: "登录帮助程序返回了旧版或非结构化错误",
  });
});

test("自动登录前将内置帮助脚本暂存到专属运行目录", () => {
  const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "phishing-auth-helper-"));
  try {
    const stagedPath = stageBundledAuthHelper({ runtimeDir });
    assert.equal(path.dirname(stagedPath), runtimeDir);
    assert.match(fs.readFileSync(stagedPath, "utf8"), /def get_coremail_cookies/);
  } finally {
    fs.rmSync(runtimeDir, { recursive: true, force: true });
  }
});

test("静态 Cookie 模式保持向后兼容", async () => {
  const resolved = await resolveCoremailCookie({ cookie, auth: { mode: "cookie" } }, {
    runHelper: async () => assert.fail("静态模式不应启动浏览器登录"),
  });
  assert.equal(resolved, cookie);
});

test("Playwright 模式通过独立帮助脚本获取 Cookie", async () => {
  let received;
  const resolved = await resolveCoremailCookie({
    baseUrl: "https://157.255.37.89",
    auth: {
      mode: "playwright",
      username: "test-user",
      password: "test-password",
      pythonCommand: "python",
      scriptPath: "scripts/get_coremail_cookie.py",
      loginPath: "/webadmin/",
      browserChannel: "chrome",
      headless: true,
      timeoutMs: 30000,
      postLoginWaitMs: 1000,
    },
  }, {
    ensureRuntime: async () => ({ pythonExecutable: "managed-python" }),
    runHelper: async (options) => {
      received = options.request;
      assert.equal(options.pythonExecutable, "managed-python");
      assert.match(options.scriptPath, /scripts[\\/]get_coremail_cookie\.py$/);
      return { cookie };
    },
  });
  assert.equal(resolved, cookie);
  assert.equal(received.loginUrl, "https://157.255.37.89/webadmin/");
  assert.equal(received.username, "test-user");
});

test("auto 模式在账号密码可用时生成新 Cookie", async () => {
  let helperCalled = false;
  const resolved = await resolveCoremailCookie({
    baseUrl: "https://157.255.37.89",
    cookie: "JSESSIONID=stale; Coremail.sid=STALE_TEST_SID",
    auth: {
      mode: "auto",
      username: "test-user",
      password: "test-password",
      scriptPath: "scripts/get_coremail_cookie.py",
      loginPath: "/webadmin/",
      timeoutMs: 30000,
    },
  }, {
    ensureRuntime: async () => ({ pythonExecutable: "managed-python" }),
    runHelper: async () => {
      helperCalled = true;
      return { cookie };
    },
  });
  assert.equal(helperCalled, true);
  assert.equal(resolved, cookie);
});

test("自动登录返回无效 Cookie 时按鉴权失败处理", async () => {
  await assert.rejects(() => resolveCoremailCookie({
    baseUrl: "https://157.255.37.89",
    auth: {
      mode: "playwright",
      username: "test-user",
      password: "test-password",
      pythonCommand: "python",
      scriptPath: "scripts/get_coremail_cookie.py",
      loginPath: "/webadmin/",
      timeoutMs: 30000,
    },
  }, {
    ensureRuntime: async () => ({ pythonExecutable: "managed-python" }),
    runHelper: async () => ({ cookie: "JSESSIONID=only" }),
  }), AuthExpiredError);
});
