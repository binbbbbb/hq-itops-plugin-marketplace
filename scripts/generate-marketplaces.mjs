import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const checkOnly = process.argv.includes("--check");

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
}

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

const catalog = readJson("catalog/plugins.json");
if (catalog.schemaVersion !== 1 || !Array.isArray(catalog.plugins)) {
  throw new Error("catalog/plugins.json has an unsupported schema");
}

const plugins = catalog.plugins.map((entry) => {
  const pluginRoot = path.join(root, "plugins", entry.name);
  const codexManifest = JSON.parse(fs.readFileSync(path.join(pluginRoot, ".codex-plugin", "plugin.json"), "utf8"));
  const codeBuddyManifest = JSON.parse(fs.readFileSync(path.join(pluginRoot, ".codebuddy-plugin", "plugin.json"), "utf8"));
  if (codexManifest.name !== entry.name || codeBuddyManifest.name !== entry.name) {
    throw new Error(`${entry.name}: plugin manifest name mismatch`);
  }
  if (codexManifest.version !== codeBuddyManifest.version) {
    throw new Error(`${entry.name}: Codex and CodeBuddy versions must match`);
  }
  return { entry, manifest: codexManifest };
});

const outputs = new Map([
  [".agents/plugins/marketplace.json", {
    name: "hq-itops-plugin-marketplace",
    interface: { displayName: "HQ ITOps Plugin Marketplace" },
    plugins: plugins.map(({ entry }) => ({
      name: entry.name,
      source: { source: "local", path: `./plugins/${entry.name}` },
      policy: entry.policy,
      category: entry.category,
    })),
  }],
  [".codebuddy-plugin/marketplace.json", {
    name: "hq-itops-plugin-marketplace",
    description: "HQ ITOps plugins for Codex and CodeBuddy.",
    owner: { name: "HQ ITOps" },
    plugins: plugins.map(({ entry, manifest }) => ({
      name: entry.name,
      source: `./plugins/${entry.name}`,
      description: manifest.description,
      version: manifest.version,
    })),
  }],
]);

const stale = [];
for (const [relativePath, value] of outputs) {
  const target = path.join(root, relativePath);
  const expected = stableJson(value);
  if (checkOnly) {
    if (!fs.existsSync(target) || fs.readFileSync(target, "utf8") !== expected) stale.push(relativePath);
    continue;
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  if (!fs.existsSync(target) || fs.readFileSync(target, "utf8") !== expected) {
    fs.writeFileSync(target, expected);
  }
}

if (stale.length) {
  throw new Error(`Marketplace manifests are out of date:\n${stale.join("\n")}`);
}
console.log(checkOnly ? "Marketplace manifests are current." : "Marketplace manifests generated.");
