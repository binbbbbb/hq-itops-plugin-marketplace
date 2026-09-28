import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const opsRoot = path.join(pluginRoot, "ops");
const startScript = path.join(opsRoot, "start-mcp.sh");
const packageVersion = JSON.parse(fs.readFileSync(path.join(pluginRoot, "package.json"), "utf8")).version;

function writeExecutable(file, contents) {
  fs.writeFileSync(file, contents, { encoding: "utf8", mode: 0o755 });
}

function createMinimalProject(root, directoryName, version = packageVersion) {
  const project = path.join(root, directoryName);
  fs.mkdirSync(path.join(project, "scripts"), { recursive: true });
  fs.mkdirSync(path.join(project, "src"), { recursive: true });
  fs.writeFileSync(path.join(project, "package.json"), JSON.stringify({ name: "server-login-permission-application", version }));
  fs.writeFileSync(path.join(project, "scripts", "runtime-http.js"), "// fixture\n");
  return project;
}

test("restart script validates only the project selected through current", () => {
  const manager = fs.readFileSync(startScript, "utf8");
  const service = fs.readFileSync(path.join(opsRoot, "server-login-permission-mcp.service"), "utf8");
  const nginx = fs.readFileSync(path.join(opsRoot, "server-login-permission-mcp.nginx.conf"), "utf8");

  assert.match(manager, /Usage: start-mcp\.sh restart/);
  assert.match(manager, /current must be a symbolic link/);
  assert.match(manager, /current target must stay under the application root/);
  assert.doesNotMatch(manager, /activate <|rollback <|install <|prune/);
  assert.match(manager, /current/);
  assert.doesNotMatch(manager, /previous/);
  assert.match(service, /WorkingDirectory=\/opt\/hq-itops\/server-permission-mcp\/current/);
  assert.match(nginx, /proxy_set_header Authorization \$http_authorization/);
});

test("restart script uses the manually selected current project on Linux", { skip: process.platform !== "linux" }, () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-release-test-"));
  try {
    const appRoot = path.join(temporary, "app");
    const fakeBin = path.join(temporary, "bin");
    fs.mkdirSync(fakeBin, { recursive: true });
    writeExecutable(path.join(fakeBin, "systemctl"), "#!/usr/bin/env bash\nexit 0\n");
    writeExecutable(path.join(fakeBin, "curl"), `#!/usr/bin/env bash
if [[ "\${FAKE_HEALTH_MODE:-ok}" == "mismatch" ]]; then
  printf '{"ok":true,"service":"server-login-permission-application","version":"0.0.0"}'
  exit 0
fi
version=$(node -p "JSON.parse(require('fs').readFileSync(process.env.MCP_APP_ROOT + '/current/package.json', 'utf8')).version")
printf '{"ok":true,"service":"server-login-permission-application","version":"%s"}' "$version"
`);
    const environment = { ...process.env, MCP_APP_ROOT: appRoot, PATH: `${fakeBin}:${process.env.PATH}` };

    const initialDirectory = "20260928-101500";
    createMinimalProject(appRoot, initialDirectory);
    fs.symlinkSync(initialDirectory, path.join(appRoot, "current"));
    execFileSync("bash", [startScript, "restart"], { env: environment, stdio: "pipe" });
    assert.equal(fs.readlinkSync(path.join(appRoot, "current")), initialDirectory);
    assert.match(execFileSync("bash", [startScript, "status"], { env: environment, encoding: "utf8" }), /package_version=/);

    const replacementDirectory = "20260929-101500";
    createMinimalProject(appRoot, replacementDirectory, "2.0.1");
    fs.unlinkSync(path.join(appRoot, "current"));
    fs.symlinkSync(replacementDirectory, path.join(appRoot, "current"));
    execFileSync("bash", [startScript, "restart"], { env: environment, stdio: "pipe" });
    assert.equal(fs.readlinkSync(path.join(appRoot, "current")), replacementDirectory);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
