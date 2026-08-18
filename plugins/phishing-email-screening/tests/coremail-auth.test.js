import test from "node:test";
import assert from "node:assert/strict";
import { resolveCoremailCookie } from "../src/coremail-auth.js";
import { AuthExpiredError } from "../src/errors.js";

const cookie = "JSESSIONID=test; Coremail=abc; Coremail.sid=SAFE_TEST_SID";

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
      return { cookie };
    },
  });
  assert.equal(resolved, cookie);
  assert.equal(received.loginUrl, "https://157.255.37.89/webadmin/");
  assert.equal(received.username, "test-user");
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
