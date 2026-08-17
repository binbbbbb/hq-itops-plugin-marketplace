import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readJson = (relativePath) => JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
const catalog = readJson("catalog/plugins.json");
const codexMarketplace = readJson(".agents/plugins/marketplace.json");
const codeBuddyMarketplace = readJson(".codebuddy-plugin/marketplace.json");
const failures = [];
const allowedInstallation = new Set(["NOT_AVAILABLE", "AVAILABLE", "INSTALLED_BY_DEFAULT"]);
const allowedAuthentication = new Set(["ON_INSTALL", "ON_USE"]);

function fail(message) {
  failures.push(message);
}

function walkFiles(targetPath) {
  return fs.readdirSync(targetPath, { withFileTypes: true }).flatMap((entry) => {
    const child = path.join(targetPath, entry.name);
    return entry.isDirectory() ? walkFiles(child) : [child];
  });
}

if (catalog.schemaVersion !== 1 || !Array.isArray(catalog.plugins)) {
  fail("catalog/plugins.json has an unsupported schema");
}
const expectedNames = catalog.plugins.map((entry) => entry.name);
if (new Set(expectedNames).size !== expectedNames.length) fail("catalog/plugins.json contains duplicate plugin names");
const pluginDirectories = fs.readdirSync(path.join(root, "plugins"), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();
if (JSON.stringify(pluginDirectories) !== JSON.stringify([...expectedNames].sort())) {
  fail("plugins/ directories do not match catalog/plugins.json");
}
if (JSON.stringify(codexMarketplace.plugins.map((entry) => entry.name)) !== JSON.stringify(expectedNames)) {
  fail("Codex marketplace order does not match catalog/plugins.json");
}
if (JSON.stringify(codeBuddyMarketplace.plugins.map((entry) => entry.name)) !== JSON.stringify(expectedNames)) {
  fail("CodeBuddy marketplace order does not match catalog/plugins.json");
}

for (const entry of catalog.plugins) {
  if (!entry.category || !allowedInstallation.has(entry.policy?.installation) || !allowedAuthentication.has(entry.policy?.authentication)) {
    fail(`${entry.name}: invalid catalog category or policy`);
  }
  const pluginRoot = path.join(root, "plugins", entry.name);
  for (const required of ["AGENTS.md", ".codex-plugin/plugin.json", ".codebuddy-plugin/plugin.json", "skills"]) {
    if (!fs.existsSync(path.join(pluginRoot, required))) fail(`${entry.name}: missing ${required}`);
  }
  if (!fs.existsSync(pluginRoot)) continue;
  const codexManifest = readJson(`plugins/${entry.name}/.codex-plugin/plugin.json`);
  const codeBuddyManifest = readJson(`plugins/${entry.name}/.codebuddy-plugin/plugin.json`);
  if (codexManifest.name !== entry.name || codeBuddyManifest.name !== entry.name) fail(`${entry.name}: manifest name mismatch`);
  if (codexManifest.version !== codeBuddyManifest.version) {
    fail(`${entry.name}: Codex/CodeBuddy manifest version mismatch`);
  }
  if (!codexManifest.description || !codeBuddyManifest.description || !codexManifest.author?.name || !codeBuddyManifest.author?.name) {
    fail(`${entry.name}: incomplete plugin metadata`);
  }
  if (codexManifest.skills !== "./skills/" || !Array.isArray(codeBuddyManifest.skills)
    || !codeBuddyManifest.skills.length || codeBuddyManifest.skills.some((value) => !value.startsWith("./skills/"))) {
    fail(`${entry.name}: both manifests must use the local skills/ source`);
  }
  for (const skillPath of codeBuddyManifest.skills) {
    const resolved = path.resolve(pluginRoot, skillPath);
    if (!resolved.startsWith(`${path.resolve(pluginRoot, "skills")}${path.sep}`) && resolved !== path.resolve(pluginRoot, "skills")) {
      fail(`${entry.name}: unsafe CodeBuddy skill path ${skillPath}`);
    } else if (!fs.existsSync(resolved)) {
      fail(`${entry.name}: missing CodeBuddy skill path ${skillPath}`);
    }
  }
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(codexManifest.version)) {
    fail(`${entry.name}: version is not strict semver`);
  }
  if (!Array.isArray(codexManifest.interface?.defaultPrompt) || codexManifest.interface.defaultPrompt.length > 3) {
    fail(`${entry.name}: invalid Codex defaultPrompt`);
  }
  const skillFiles = walkFiles(path.join(pluginRoot, "skills")).filter((file) => path.basename(file) === "SKILL.md");
  if (!skillFiles.length) fail(`${entry.name}: no SKILL.md found`);
  for (const skillFile of skillFiles) {
    const contents = fs.readFileSync(skillFile, "utf8");
    if (!contents.startsWith("---") || !/^name:\s*[a-z0-9-]+\s*$/m.test(contents) || !/^description:\s*.+$/m.test(contents)) {
      fail(`${entry.name}: invalid Skill frontmatter in ${path.relative(root, skillFile)}`);
    }
  }
  for (const file of walkFiles(pluginRoot)) {
    const relative = path.relative(pluginRoot, file).replaceAll("\\", "/").toLowerCase();
    if (/(^|\/)(config\.local\.json|postman-api-key\.txt)$/.test(relative)
      || /(^|\/)(logs|reports|work|node_modules|\.git|\.workbuddy)(\/|$)/.test(relative)
      || relative.endsWith(".postman_collection.json")
      || relative.includes(".bak-")) {
      fail(`${entry.name}: forbidden packaged file ${relative}`);
    }
  }
  const codexEntry = codexMarketplace.plugins.find((item) => item.name === entry.name);
  const codeBuddyEntry = codeBuddyMarketplace.plugins.find((item) => item.name === entry.name);
  if (codexEntry?.source?.source !== "local" || codexEntry?.source?.path !== `./plugins/${entry.name}`) {
    fail(`${entry.name}: invalid Codex marketplace source`);
  }
  if (codexEntry?.category !== entry.category
    || codexEntry?.policy?.installation !== entry.policy.installation
    || codexEntry?.policy?.authentication !== entry.policy.authentication) {
    fail(`${entry.name}: Codex marketplace policy/category mismatch`);
  }
  if (codeBuddyEntry?.source !== `./plugins/${entry.name}` || codeBuddyEntry?.version !== codexManifest.version) {
    fail(`${entry.name}: invalid CodeBuddy marketplace source/version`);
  }
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log(`Validated ${catalog.plugins.length} monorepo plugins and both marketplace manifests.`);
