import fs from "node:fs";
import { ZeusClient } from "./api-client.js";
import { ConfirmationStore } from "./confirmation-store.js";
import { deriveCurrentBadge, loadConfig } from "./config.js";
import { safeErrorJson, WorkflowError } from "./errors.js";
import { flattenSystems, PermissionWorkflow, publicUser } from "./workflow.js";

async function readInput(stdin = process.stdin) {
  if (stdin.isTTY) return {};
  const raw = fs.readFileSync(0, "utf8").trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new WorkflowError("CONFIG_INVALID", undefined, error);
  }
}

export async function run(command, input, dependencies = {}) {
  const config = dependencies.config ?? loadConfig();
  const badge = deriveCurrentBadge({ explicitBadge: config.currentBadge, ...(dependencies.identity ?? {}) });
  if (!badge) throw new WorkflowError("CURRENT_USER_NOT_FOUND");
  const client = dependencies.client ?? new ZeusClient({ apiBase: config.apiBase, tokenSign: config.tokenSign, badge });
  const store = dependencies.store ?? new ConfirmationStore();
  const workflow = new PermissionWorkflow({ client, store, currentBadge: badge, environment: config.environment });

  switch (command) {
    case "systems":
      return { systems: flattenSystems(await client.listFieldSystems()) };
    case "users": {
      const result = await client.listUsers(String(input.keyword ?? ""));
      const users = Array.isArray(result) ? result : result.items;
      return { users: users.map(publicUser), truncated: Array.isArray(result) ? false : result.truncated };
    }
    case "assets":
      return await client.listAssets({ systemId: Number(input.system_id), keyword: String(input.keyword ?? "") });
    case "options":
      return await client.permissionOptions({ systemId: Number(input.system_id), assetId: Number(input.asset_id), userIds: (input.user_ids ?? []).map(Number) });
    case "prepare":
      return await workflow.prepare(input);
    case "submit":
      return await workflow.submit(input);
    default:
      throw new WorkflowError("CONFIG_INVALID", { supported_commands: ["systems", "users", "assets", "options", "prepare", "submit"] });
  }
}

export async function main(argv, io = { stdin: process.stdin, stdout: process.stdout, stderr: process.stderr }) {
  try {
    const data = await run(argv[0], await readInput(io.stdin));
    io.stdout.write(`${JSON.stringify({ ok: true, data })}\n`);
  } catch (error) {
    io.stderr.write(`${JSON.stringify(safeErrorJson(error))}\n`);
    process.exitCode = 1;
  }
}
