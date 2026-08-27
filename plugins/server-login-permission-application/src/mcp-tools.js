import { ZeusClient } from "./api-client.js";
import { ConfirmationStore } from "./confirmation-store.js";
import { deriveCurrentBadge, loadConfig } from "./config.js";
import { WorkflowError } from "./errors.js";
import { PermissionWorkflow, publicUser, resolveSystem } from "./workflow.js";

const selectorSchema = {
  anyOf: [
    { type: "string", minLength: 1 },
    { type: "integer" },
    { type: "object", additionalProperties: true }
  ]
};

const accountSchema = {
  type: "object",
  additionalProperties: false,
  required: ["permission_type", "duration"],
  properties: {
    applicant: selectorSchema,
    permission_type: selectorSchema,
    duration: selectorSchema
  }
};

export const MCP_TOOLS = [
  {
    name: "search_users",
    description: "Search live Zeus user candidates by badge or name. Use this before preparing an application when an applicant is explicitly named.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["keyword"],
      properties: { keyword: { type: "string", minLength: 1, description: "Badge or user name." } }
    },
    annotations: { title: "Search Zeus users", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  },
  {
    name: "search_servers",
    description: "Search live Zeus server candidates across all assets by default. Each result includes its field and system so selecting a server can default those values. Optionally scope the search to a field/system.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        field_system: { ...selectorSchema, description: "Optional field/system name or canonical ID used to scope the search." },
        keyword: { type: "string", description: "Optional host name or resource keyword." }
      }
    },
    annotations: { title: "Search Zeus servers", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  },
  {
    name: "get_permission_options",
    description: "Get live permission types and allowed durations for one Zeus system/server and one or more canonical user IDs.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["system_id", "server_id", "user_ids"],
      properties: {
        system_id: { type: "integer" },
        server_id: { type: "integer" },
        user_ids: { type: "array", minItems: 1, uniqueItems: true, items: { type: "integer" } }
      }
    },
    annotations: { title: "Get permission options", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  },
  {
    name: "prepare_application",
    description: "Live-validate and normalize a complete server-login permission draft. Creates only a short-lived local confirmation; it does not submit to Zeus.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["description", "permissions"],
      properties: {
        field_system: { ...selectorSchema, description: "Optional field/system name or canonical ID. When omitted, it is derived from the selected asset." },
        description: { type: "string", minLength: 1, maxLength: 255 },
        previous_confirmation_id: { type: "string", pattern: "^[0-9A-Za-z-]+$" },
        permissions: {
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["asset", "accounts"],
            properties: {
              asset: selectorSchema,
              accounts: { type: "array", minItems: 1, items: accountSchema }
            }
          }
        }
      }
    },
    annotations: { title: "Prepare permission application", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
  },
  {
    name: "submit_application",
    description: "Submit exactly one previously prepared application to production Zeus. Call only after the user replies with the exact standalone phrase 确认提交. Never retry automatically.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["confirmation_id", "confirmation_phrase"],
      properties: {
        confirmation_id: { type: "string", pattern: "^[0-9A-Za-z-]+$" },
        confirmation_phrase: { type: "string", enum: ["确认提交"] }
      }
    },
    annotations: { title: "Submit permission application", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true }
  }
];

export function createMcpToolRuntime(dependencies = {}) {
  let runtime;

  function getRuntime() {
    if (runtime) return runtime;
    const config = dependencies.config ?? loadConfig();
    const badge = deriveCurrentBadge({ explicitBadge: config.currentBadge, ...(dependencies.identity ?? {}) });
    if (!badge) throw new WorkflowError("CURRENT_USER_NOT_FOUND");
    const client = dependencies.client ?? new ZeusClient({ apiBase: config.apiBase, tokenSign: config.tokenSign, badge });
    const store = dependencies.store ?? new ConfirmationStore();
    runtime = {
      client,
      workflow: new PermissionWorkflow({ client, store, currentBadge: badge, environment: config.environment })
    };
    return runtime;
  }

  return async function callTool(name, input = {}) {
    const { client, workflow } = getRuntime();
    switch (name) {
      case "search_users": {
        const keyword = String(input.keyword ?? "").trim();
        if (!keyword) throw new WorkflowError("USER_NOT_FOUND");
        const result = await client.listUsers(keyword);
        const users = Array.isArray(result) ? result : result.items;
        return { users: users.map(publicUser), truncated: Array.isArray(result) ? false : result.truncated };
      }
      case "search_servers": {
        const hasSystem = input.field_system !== undefined && input.field_system !== null && input.field_system !== "";
        const system = hasSystem ? resolveSystem(await client.listFieldSystems(), input.field_system) : undefined;
        const result = await client.listAssets({ systemId: system?.system_id, keyword: String(input.keyword ?? "").trim() });
        return {
          ...(system ? {
            field: { id: system.field_id, name: system.field_name },
            system: { id: system.system_id, name: system.system_name }
          } : {}),
          servers: result.items,
          truncated: result.truncated
        };
      }
      case "get_permission_options":
        if (!Number.isInteger(Number(input.system_id)) || Number(input.system_id) <= 0
          || !Number.isInteger(Number(input.server_id)) || Number(input.server_id) <= 0
          || !Array.isArray(input.user_ids) || !input.user_ids.length
          || input.user_ids.some((id) => !Number.isInteger(Number(id)) || Number(id) <= 0)) {
          throw new WorkflowError("CONFIG_INVALID");
        }
        return await client.permissionOptions({
          systemId: Number(input.system_id),
          assetId: Number(input.server_id),
          userIds: (input.user_ids ?? []).map(Number)
        });
      case "prepare_application":
        return await workflow.prepare(input);
      case "submit_application":
        return await workflow.submit(input);
      default:
        throw new WorkflowError("CONFIG_INVALID", { supported_tools: MCP_TOOLS.map((tool) => tool.name) });
    }
  };
}
