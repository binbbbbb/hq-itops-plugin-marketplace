import { ZeusClient } from "./api-client.js";
import { ConfirmationStore } from "./confirmation-store.js";
import { loadConfig } from "./config.js";
import { WorkflowError } from "./errors.js";
import { PermissionWorkflow, publicUser, resolveSystem, resolveUser } from "./workflow.js";

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
    description: "Get live permission types and allowed durations for one Zeus system/server. Omit user_ids to use the MCP-configured current user; otherwise pass one or more canonical user IDs.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["system_id", "server_id"],
      properties: {
        system_id: { type: "integer" },
        server_id: { type: "integer" },
        user_ids: {
          type: "array",
          minItems: 1,
          uniqueItems: true,
          items: { type: "integer" },
          description: "Optional canonical user IDs. Omit this field to resolve the configured current user; never pass an empty array."
        }
      }
    },
    annotations: { title: "Get permission options", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  },
  {
    name: "prepare_application",
    description: "Live-validate and normalize a complete server-login permission draft. Creates only a short-lived local confirmation; it does not submit to Zeus. A host may bind it to a stable conversation_key.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["description", "permissions"],
      properties: {
        conversation_key: {
          type: "string",
          minLength: 1,
          maxLength: 255,
          description: "Optional stable opaque host-conversation key. When supplied, the pending confirmation is bound to this key and the configured current user."
        },
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
    description: "Submit exactly one previously prepared application to production Zeus using either its private confirmation_id or the stable conversation_key used to prepare it. Call only after the user replies with the exact standalone phrase 确认提交. Never retry automatically.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["confirmation_phrase"],
      oneOf: [
        { required: ["confirmation_id"] },
        { required: ["conversation_key"] }
      ],
      properties: {
        confirmation_id: { type: "string", pattern: "^[0-9A-Za-z-]+$" },
        conversation_key: {
          type: "string",
          minLength: 1,
          maxLength: 255,
          description: "Stable opaque host-conversation key previously supplied to prepare_application."
        },
        confirmation_phrase: { type: "string", enum: ["确认提交"] }
      }
    },
    annotations: { title: "Submit permission application", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true }
  }
];

export function createRequestAuthorizer(dependencies = {}) {
  const config = dependencies.config ?? loadConfig();
  return async function authorize(authorization, { traceId } = {}) {
    const value = String(authorization ?? "");
    if (!value.startsWith("Bearer ")) throw new WorkflowError("AUTH_EXPIRED");
    const client = dependencies.authorizationClientFactory
      ? dependencies.authorizationClientFactory({ apiBase: config.apiBase, authorization: value, logger: dependencies.logger, traceId })
      : new ZeusClient({ apiBase: config.apiBase, authorization: value, logger: dependencies.logger, traceId });
    const result = await client.getMcpAuthorization(config.mcpKey);
    return {
      authorization: value,
      traceId,
      user: result.user,
      allowedTools: new Set(result.allowedTools.filter((tool) => MCP_TOOLS.some((item) => item.name === tool)))
    };
  };
}

export function createMcpToolRuntime(dependencies = {}) {
  const config = dependencies.config ?? loadConfig();
  const store = dependencies.store ?? new ConfirmationStore();
  return async function callTool(name, input = {}, context = {}) {
    if (!context.allowedTools?.has(name)) throw new WorkflowError("PERMISSION_DENIED");
    const client = dependencies.clientFactory
      ? dependencies.clientFactory({ apiBase: config.apiBase, authorization: context.authorization, logger: dependencies.logger, traceId: context.traceId })
      : dependencies.client ?? new ZeusClient({ apiBase: config.apiBase, authorization: context.authorization, logger: dependencies.logger, traceId: context.traceId });
    const resolveCurrentUser = async () => {
      const currentUser = context.user;
      if (Number.isInteger(Number(currentUser?.id)) && Number(currentUser.id) > 0) return currentUser;
      const badge = String(currentUser?.badge ?? "").trim();
      if (!badge) throw new WorkflowError("CURRENT_USER_NOT_FOUND");
      const result = await client.listUsers(badge);
      return resolveUser(Array.isArray(result) ? result : result.items, { badge }, { current: true });
    };
    const createWorkflow = (currentUser) => new PermissionWorkflow({ client, store, currentUser, environment: config.environment });
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
      case "get_permission_options": {
        if (!Number.isInteger(Number(input.system_id)) || Number(input.system_id) <= 0
          || !Number.isInteger(Number(input.server_id)) || Number(input.server_id) <= 0) {
          throw new WorkflowError("CONFIG_INVALID");
        }
        const defaultedToCurrentUser = input.user_ids === undefined || input.user_ids === null;
        let userIds;
        if (defaultedToCurrentUser) {
          userIds = [Number((await resolveCurrentUser()).id)];
        } else {
          if (!Array.isArray(input.user_ids) || !input.user_ids.length
            || input.user_ids.some((id) => !Number.isInteger(Number(id)) || Number(id) <= 0)) {
            throw new WorkflowError("CONFIG_INVALID");
          }
          userIds = input.user_ids.map(Number);
        }
        const options = await client.permissionOptions({
          systemId: Number(input.system_id),
          assetId: Number(input.server_id),
          userIds
        });
        return {
          ...options,
          resolved_user_ids: userIds,
          defaulted_to_current_user: defaultedToCurrentUser
        };
      }
      case "prepare_application": {
        const workflow = createWorkflow(await resolveCurrentUser());
        return await workflow.prepare(input);
      }
      case "submit_application":
        return await createWorkflow(context.user).submit(input);
      default:
        throw new WorkflowError("CONFIG_INVALID", { supported_tools: MCP_TOOLS.map((tool) => tool.name) });
    }
  };
}
