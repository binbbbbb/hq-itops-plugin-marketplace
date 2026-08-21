import { WorkflowError } from "./errors.js";

const text = (value) => String(value ?? "").trim();
const lower = (value) => text(value).toLocaleLowerCase();

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
  const scoped = assets.filter((asset) => asset.system_id == null || Number(asset.system_id) === Number(systemId));
  return pick(scoped, input, {
    idKeys: ["id"], nameKeys: ["host_name", "ops_resource_name"],
    notFound: "ASSET_NOT_FOUND", ambiguous: "AMBIGUOUS_ASSET",
    present: (asset) => ({ id: asset.id, host_name: asset.host_name, ops_resource_name: asset.ops_resource_name })
  });
}

function normalizeOption(item) {
  return { id: Number(item.id ?? item.value), name: text(item.name ?? item.dict_name) };
}

function resolveOption(items, input, notFound, ambiguous) {
  return pick(items.map(normalizeOption), input, {
    idKeys: ["id"], nameKeys: ["name"], notFound, ambiguous, present: (item) => item
  });
}

function durationsForUser(options, userId) {
  const users = options?.user_info ?? [];
  const exact = users.find((item) => Number(item.id ?? item.user_id) === Number(userId));
  return (exact ?? users.at(-1) ?? {}).able_duration ?? [];
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
    if (!draft?.field_system) throw new WorkflowError("MISSING_FIELD_SYSTEM");
    const description = text(draft.description);
    if (!description) throw new WorkflowError("MISSING_DESCRIPTION");
    if ([...description].length > 255) throw new WorkflowError("DESCRIPTION_TOO_LONG");
    if (!Array.isArray(draft.permissions) || !draft.permissions.length) throw new WorkflowError("MISSING_PERMISSIONS");

    const system = resolveSystem(await this.client.listFieldSystems(), draft.field_system);
    const currentUser = await findCurrentUser(this.client, this.currentBadge);
    const payloadPermissions = [];
    const summaryPermissions = [];

    for (const permission of draft.permissions) {
      if (!Array.isArray(permission.accounts) || !permission.accounts.length) throw new WorkflowError("MISSING_ACCOUNTS");
      const assetQuery = typeof permission.asset === "object" ? permission.asset.name ?? permission.asset.host_name ?? permission.asset.id : permission.asset;
      const assetResult = await this.client.listAssets({ systemId: system.system_id, keyword: text(assetQuery) });
      const asset = resolveAsset(assetResult.items, permission.asset, system.system_id);
      const payloadAccounts = [];
      const summaryAccounts = [];
      const seen = new Set();
      const typesByUser = new Map();

      for (const account of permission.accounts) {
        const { user, defaulted } = await findApplicant(this.client, account.applicant, currentUser);
        const options = await this.client.permissionOptions({ systemId: system.system_id, assetId: asset.id, userIds: [user.id] });
        const permissionType = resolveOption(options?.able_permission_type ?? [], account.permission_type, "PERMISSION_TYPE_NOT_ALLOWED", "AMBIGUOUS_PERMISSION_TYPE");
        const duration = resolveOption(durationsForUser(options, user.id), account.duration, "DURATION_NOT_ALLOWED", "AMBIGUOUS_DURATION");
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
      summaryPermissions.push({ asset: { id: asset.id, host_name: asset.host_name }, candidates_truncated: assetResult.truncated, accounts: summaryAccounts });
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
    const record = this.store.create({ payload, summary });
    return { confirmation_id: record.confirmation_id, expires_at: new Date(record.expires_at).toISOString(), summary };
  }

  async submit({ confirmation_id: confirmationId, confirmation_phrase: confirmationPhrase }) {
    if (confirmationPhrase !== "确认提交") throw new WorkflowError("CONFIRMATION_REQUIRED");
    const record = this.store.consume(confirmationId);
    const orderId = await this.client.submit(record.payload);
    return {
      order_id: orderId,
      detail_url: `https://zeus.huaqin.com/order/ops_permission_apply/profile/${encodeURIComponent(String(orderId))}`
    };
  }
}

export { flattenSystems, publicUser };
