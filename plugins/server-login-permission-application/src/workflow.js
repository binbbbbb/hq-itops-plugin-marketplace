import { WorkflowError } from "./errors.js";

const text = (value) => String(value ?? "").trim();
const lower = (value) => text(value).toLocaleLowerCase();

function optionalConversationKey(value) {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") throw new WorkflowError("CONFIG_INVALID");
  const normalized = value.trim();
  if (!normalized || normalized.length > 255) throw new WorkflowError("CONFIG_INVALID");
  return normalized;
}

function publicUser(user) {
  return { id: user.id, name: user.name, badge: user.badge, department: user.department, group: user.group };
}

function flattenSystems(fields) {
  const result = [];
  for (const field of fields ?? []) {
    for (const system of field.children ?? []) {
      result.push({ field_id: Number(field.id), field_name: text(field.name), system_id: Number(system.id), system_name: text(system.name) });
    }
  }
  return result;
}

function pick(candidates, input, { idKeys, nameKeys, notFound, ambiguous, present }) {
  const raw = typeof input === "object" && input !== null ? input : { value: input };
  const requestedIds = idKeys.map((key) => raw[key]).filter((value) => value !== undefined && value !== null && value !== "").map(Number);
  if (/^\d+$/.test(text(raw.value))) requestedIds.push(Number(raw.value));
  const requestedText = lower(raw.value ?? raw.name ?? raw.badge ?? raw.host_name ?? raw.system_name);
  let matches = candidates.filter((candidate) => {
    if (requestedIds.length && idKeys.some((key) => requestedIds.includes(Number(candidate[key])))) return true;
    return requestedText && nameKeys.some((key) => lower(candidate[key]) === requestedText);
  });
  if (requestedIds.length > 1) matches = matches.filter((candidate) => idKeys.every((key) => raw[key] == null || Number(candidate[key]) === Number(raw[key])));
  if (!matches.length) throw new WorkflowError(notFound);
  if (matches.length > 1) throw new WorkflowError(ambiguous, { candidates: matches.slice(0, 20).map(present) });
  return matches[0];
}

export function resolveSystem(fields, input) {
  return pick(flattenSystems(fields), input, {
    idKeys: ["system_id", "field_id"], nameKeys: ["system_name", "field_name"],
    notFound: "SYSTEM_NOT_FOUND", ambiguous: "AMBIGUOUS_SYSTEM", present: (item) => item
  });
}

export function resolveUser(users, input, { current = false } = {}) {
  const raw = typeof input === "object" && input !== null ? input : { value: input };
  const badgeQuery = text(raw.badge ?? raw.value);
  const exactBadge = users.filter((user) => badgeQuery && lower(user.badge) === lower(badgeQuery));
  if (exactBadge.length === 1) return exactBadge[0];
  try {
    return pick(users, input, {
      idKeys: ["id"], nameKeys: ["name"],
      notFound: current ? "CURRENT_USER_NOT_FOUND" : "USER_NOT_FOUND",
      ambiguous: "AMBIGUOUS_USER", present: publicUser
    });
  } catch (error) {
    if (error.code === "AMBIGUOUS_USER") throw error;
    throw new WorkflowError(current ? "CURRENT_USER_NOT_FOUND" : "USER_NOT_FOUND");
  }
}

export function resolveAsset(assets, input, systemId) {
  const scoped = systemId == null
    ? assets
    : assets.filter((asset) => asset.system_id == null || Number(asset.system_id) === Number(systemId));
  return pick(scoped, input, {
    idKeys: ["id"], nameKeys: ["host_name", "ops_resource_name"],
    notFound: "ASSET_NOT_FOUND", ambiguous: "AMBIGUOUS_ASSET",
    present: (asset) => ({
      id: asset.id,
      host_name: asset.host_name,
      ops_resource_name: asset.ops_resource_name,
      field_id: asset.field_id,
      field_name: asset.field_name,
      system_id: asset.system_id,
      system_name: asset.system_name
    })
  });
}

function systemForAsset(fields, asset) {
  if (asset.system_id == null && asset.field_id == null) throw new WorkflowError("SYSTEM_NOT_FOUND");
  return resolveSystem(fields, { system_id: asset.system_id, field_id: asset.field_id });
}

function normalizeOption(item) {
  return {
    id: Number(item.id ?? item.value ?? item.dict_id ?? item.dictId ?? item.dict_value
      ?? item.permission_type_id ?? item.duration_id ?? item.key),
    name: text(item.name ?? item.dict_name ?? item.dictName ?? item.label ?? item.title
      ?? item.value_name ?? item.value_label ?? item.permission_type_name ?? item.duration_name)
  };
}

function resolveOption(items, input, notFound, ambiguous, detailsKey) {
  const candidates = items.map(normalizeOption).filter((item) => Number.isInteger(item.id) && item.id > 0 && item.name);
  try {
    return pick(candidates, input, {
      idKeys: ["id"], nameKeys: ["name"], notFound, ambiguous, present: (item) => item
    });
  } catch (error) {
    if (error?.code === notFound) throw new WorkflowError(notFound, { [detailsKey]: candidates });
    throw error;
  }
}

function permissionTypesForUser(options, userId) {
  const topLevel = options?.able_permission_type ?? [];
  if (topLevel.length) return topLevel;
  const users = options?.user_info ?? [];
  const exact = users.find((item) => Number(item.id ?? item.user_id) === Number(userId));
  return (exact ?? users.at(-1) ?? {}).able_permission_type ?? [];
}

function durationsForUser(options, userId) {
  const users = options?.user_info ?? [];
  const exact = users.find((item) => Number(item.id ?? item.user_id) === Number(userId));
  return (exact ?? users.at(-1) ?? {}).able_duration ?? [];
}

function assetIdFromSelector(input) {
  const value = typeof input === "object" && input !== null ? input.id : input;
  return /^\d+$/.test(text(value)) ? Number(value) : undefined;
}

function assetSearchKeyword(client, input) {
  const assetId = assetIdFromSelector(input);
  if (assetId !== undefined) {
    const cached = client.getCachedAssetById?.(assetId);
    return text(cached?.host_name || cached?.ops_resource_name);
  }
  return text(typeof input === "object" && input !== null
    ? input.name ?? input.host_name ?? input.value
    : input);
}

async function findCurrentUser(client, currentBadge) {
  if (!currentBadge) throw new WorkflowError("CURRENT_USER_NOT_FOUND");
  const result = await client.listUsers(currentBadge);
  return resolveUser(Array.isArray(result) ? result : result.items, { badge: currentBadge }, { current: true });
}

async function findApplicant(client, input, currentUser) {
  if (input === undefined || input === null || text(input) === "") return { user: currentUser, defaulted: true };
  const query = typeof input === "object" ? input.badge ?? input.name ?? input.id ?? input.value : input;
  const result = await client.listUsers(text(query));
  return { user: resolveUser(Array.isArray(result) ? result : result.items, input), defaulted: false };
}

export class PermissionWorkflow {
  constructor({ client, store, currentBadge, environment = "生产环境" }) {
    this.client = client;
    this.store = store;
    this.currentBadge = currentBadge;
    this.environment = environment;
  }

  async prepare(draft) {
    const conversationKey = optionalConversationKey(draft?.conversation_key);
    const description = text(draft?.description);
    if (!description) throw new WorkflowError("MISSING_DESCRIPTION");
    if ([...description].length > 255) throw new WorkflowError("DESCRIPTION_TOO_LONG");
    if (!Array.isArray(draft?.permissions) || !draft.permissions.length) throw new WorkflowError("MISSING_PERMISSIONS");

    const fields = await this.client.listFieldSystems();
    const explicitSystem = draft.field_system ? resolveSystem(fields, draft.field_system) : undefined;
    let system = explicitSystem;
    const currentUser = await findCurrentUser(this.client, this.currentBadge);
    const payloadPermissions = [];
    const summaryPermissions = [];
    const groupedPermissions = new Map();

    for (const permission of draft.permissions) {
      if (!Array.isArray(permission.accounts) || !permission.accounts.length) throw new WorkflowError("MISSING_ACCOUNTS");
      const assetResult = await this.client.listAssets({
        systemId: explicitSystem?.system_id,
        keyword: assetSearchKeyword(this.client, permission.asset)
      });
      const asset = resolveAsset(assetResult.items, permission.asset, explicitSystem?.system_id);
      const selectedSystem = asset.system_id == null && explicitSystem
        ? explicitSystem
        : systemForAsset(fields, asset);
      if (system && (system.field_id !== selectedSystem.field_id || system.system_id !== selectedSystem.system_id)) {
        throw new WorkflowError("ASSET_SYSTEM_MISMATCH");
      }
      system ??= selectedSystem;
      const grouped = groupedPermissions.get(asset.id);
      if (grouped) {
        grouped.accounts.push(...permission.accounts);
        grouped.candidatesTruncated ||= assetResult.truncated;
      } else {
        groupedPermissions.set(asset.id, { asset, accounts: [...permission.accounts], candidatesTruncated: assetResult.truncated });
      }
    }

    for (const { asset, accounts, candidatesTruncated } of groupedPermissions.values()) {
      const payloadAccounts = [];
      const summaryAccounts = [];
      const seen = new Set();
      const typesByUser = new Map();

      for (const account of accounts) {
        const { user, defaulted } = await findApplicant(this.client, account.applicant, currentUser);
        const options = await this.client.permissionOptions({ systemId: system.system_id, assetId: asset.id, userIds: [user.id] });
        const permissionType = resolveOption(
          permissionTypesForUser(options, user.id),
          account.permission_type,
          "PERMISSION_TYPE_NOT_ALLOWED",
          "AMBIGUOUS_PERMISSION_TYPE",
          "allowed_permission_types"
        );
        const duration = resolveOption(
          durationsForUser(options, user.id),
          account.duration,
          "DURATION_NOT_ALLOWED",
          "AMBIGUOUS_DURATION",
          "allowed_durations"
        );
        const duplicateKey = `${user.id}:${permissionType.id}`;
        if (seen.has(duplicateKey)) throw new WorkflowError("DUPLICATE_PERMISSION");
        seen.add(duplicateKey);
        const selectedTypes = typesByUser.get(user.id) ?? new Set();
        if ((permissionType.id === 1 && selectedTypes.has(2)) || (permissionType.id === 2 && selectedTypes.has(1))) throw new WorkflowError("MUTUALLY_EXCLUSIVE_PERMISSION");
        selectedTypes.add(permissionType.id);
        typesByUser.set(user.id, selectedTypes);
        payloadAccounts.push({ user_id: user.id, permission_type: permissionType.id, duration: duration.id });
        summaryAccounts.push({ applicant: publicUser(user), defaulted_to_self: defaulted, permission_type: permissionType, duration });
      }
      payloadPermissions.push({ asset_id: asset.id, accounts: payloadAccounts });
      summaryPermissions.push({
        asset: {
          id: asset.id,
          host_name: asset.host_name,
          field_id: system.field_id,
          field_name: system.field_name,
          system_id: system.system_id,
          system_name: system.system_name
        },
        candidates_truncated: candidatesTruncated,
        accounts: summaryAccounts
      });
    }

    const payload = { field_id: system.field_id, system_id: system.system_id, description, submit_type: 2, permissions: payloadPermissions };
    const summary = {
      environment: this.environment,
      submitter: publicUser(currentUser),
      field: { id: system.field_id, name: system.field_name },
      system: { id: system.system_id, name: system.system_name },
      description,
      permissions: summaryPermissions
    };
    const record = this.store.create({
      payload,
      summary,
      ...(conversationKey ? { context: { principal: this.currentBadge, conversationKey } } : {})
    });
    if (draft.previous_confirmation_id) this.store.supersede(draft.previous_confirmation_id);
    return { confirmation_id: record.confirmation_id, expires_at: new Date(record.expires_at).toISOString(), summary };
  }

  async submit({ confirmation_id: confirmationId, conversation_key: rawConversationKey, confirmation_phrase: confirmationPhrase }) {
    if (confirmationPhrase !== "确认提交") throw new WorkflowError("CONFIRMATION_REQUIRED");
    const conversationKey = optionalConversationKey(rawConversationKey);
    if (confirmationId && conversationKey) throw new WorkflowError("CONFIG_INVALID");
    const record = conversationKey
      ? this.store.consumeByContext({ principal: this.currentBadge, conversationKey })
      : this.store.consume(confirmationId);
    const orderId = await this.client.submit(record.payload);
    if (!orderId) {
      return {
        order_id: null,
        detail_url: null,
        note: "提交成功，但 Zeus 响应中未包含工单号，请前往 Zeus“我的申请”页面核对。"
      };
    }
    return {
      order_id: orderId,
      detail_url: `https://zeus.huaqin.com/order/ops_permission_apply/profile/${encodeURIComponent(String(orderId))}`
    };
  }
}

export { flattenSystems, publicUser };
