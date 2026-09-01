import { WorkflowError } from "./errors.js";

const BACKEND_CODES = new Map([
  ["SYSTEM_NOT_FOUND", "SYSTEM_NOT_FOUND"],
  ["ROLE_NOT_FOUND", "USER_NOT_FOUND"],
  ["ASSET_NOT_FOUND", "ASSET_NOT_FOUND"],
  ["RESOURCE_NOT_OWNER", "API_REJECTED"],
  ["DICT_CONFIG_DURATION", "DURATION_NOT_ALLOWED"],
  ["DICT_CONFIG_TYPR", "PERMISSION_TYPE_NOT_ALLOWED"],
  ["WB_DURATION", "DURATION_NOT_ALLOWED"],
  ["OWNER_DURATION", "DURATION_NOT_ALLOWED"],
  ["USER_NO_PERMISSION", "API_REJECTED"]
]);

function safeBackendCode(response) {
  const candidates = [response?.msg, response?.message, response?.data?.code];
  for (const candidate of candidates) {
    const value = String(candidate ?? "");
    for (const [backend, safe] of BACKEND_CODES) if (value.includes(backend)) return safe;
  }
  return "API_REJECTED";
}

function expectSuccess(body, stage) {
  if (!body || body.code !== 100000) throw new WorkflowError(safeBackendCode(body), { stage });
  return body.data;
}

function normalizeUsers(data) {
  const list = Array.isArray(data) ? data : data?.user_list ?? data?.list ?? [];
  return list.map((user) => ({
    id: Number(user.id),
    name: String(user.name ?? user.user_name ?? ""),
    badge: String(user.badge ?? ""),
    department: String(user.dep_title ?? user.department ?? ""),
    group: String(user.group_title ?? user.group ?? "")
  }));
}

function normalizeAssets(data) {
  const list = Array.isArray(data) ? data : data?.ops_asset_list ?? data?.asset_list ?? data?.list ?? [];
  return list.map((asset) => ({
    id: Number(asset.id),
    host_name: String(asset.host_name ?? asset.ops_resource_name ?? asset.name ?? ""),
    ops_resource_name: String(asset.ops_resource_name ?? ""),
    system_id: asset.system_id == null ? undefined : Number(asset.system_id),
    system_name: String(asset.system_name ?? ""),
    field_id: asset.field_id == null ? undefined : Number(asset.field_id),
    field_name: String(asset.field_name ?? "")
  }));
}

function firstArray(...values) {
  let empty = [];
  for (const value of values) {
    const candidate = Array.isArray(value) ? value
      : Array.isArray(value?.items) ? value.items
        : Array.isArray(value?.list) ? value.list
          : Array.isArray(value?.options) ? value.options
            : undefined;
    if (candidate?.length) return candidate;
    if (candidate) empty = candidate;
  }
  return empty;
}

function normalizePermissionOption(option) {
  if (!option || typeof option !== "object") return undefined;
  const id = Number(option.id ?? option.value ?? option.dict_id ?? option.dictId ?? option.dict_value
    ?? option.permission_type_id ?? option.duration_id ?? option.key);
  const name = String(option.name ?? option.dict_name ?? option.dictName ?? option.label ?? option.title
    ?? option.value_name ?? option.value_label ?? option.permission_type_name ?? option.duration_name ?? "").trim();
  if (!Number.isInteger(id) || id <= 0 || !name) return undefined;
  return { id, name };
}

function normalizePermissionOptionList(...values) {
  const unique = new Map();
  for (const option of firstArray(...values)) {
    const normalized = normalizePermissionOption(option);
    if (normalized) unique.set(`${normalized.id}:${normalized.name.toLocaleLowerCase()}`, normalized);
  }
  return [...unique.values()];
}

function intersectOptionLists(lists) {
  if (!lists.length || lists.some((list) => !list.length)) return [];
  const allowed = new Set(lists[0].map((item) => `${item.id}:${item.name.toLocaleLowerCase()}`));
  for (const list of lists.slice(1)) {
    const current = new Set(list.map((item) => `${item.id}:${item.name.toLocaleLowerCase()}`));
    for (const key of allowed) if (!current.has(key)) allowed.delete(key);
  }
  return lists[0].filter((item) => allowed.has(`${item.id}:${item.name.toLocaleLowerCase()}`));
}

export function normalizePermissionOptions(data) {
  const source = data?.data && typeof data.data === "object" ? data.data : data ?? {};
  const rawUsers = firstArray(source.user_info, source.userInfo, source.users);
  const userInfo = rawUsers.map((user) => ({
    id: Number(user.id ?? user.user_id),
    able_duration: normalizePermissionOptionList(
      user.able_duration,
      user.ableDuration,
      user.durations,
      user.duration_options,
      user.duration
    ),
    able_permission_type: normalizePermissionOptionList(
      user.able_permission_type,
      user.ablePermissionType,
      user.permission_types,
      user.permission_type_options,
      user.permission_type
    )
  })).filter((user) => Number.isInteger(user.id) && user.id > 0);

  const topLevelTypes = normalizePermissionOptionList(
    source.able_permission_type,
    source.ablePermissionType,
    source.permission_types,
    source.permission_type_options,
    source.permission_type
  );
  const nestedTypes = userInfo.map((user) => user.able_permission_type);
  return {
    able_permission_type: topLevelTypes.length ? topLevelTypes : intersectOptionLists(nestedTypes),
    user_info: userInfo
  };
}

export class ZeusClient {
  constructor({ apiBase, tokenSign, badge, fetchImpl = globalThis.fetch, timeoutMs = 15000 }) {
    this.apiBase = apiBase;
    this.tokenSign = tokenSign;
    this.badge = badge;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.accessToken = "";
    this.assetsById = new Map();
  }

  async rawRequest(pathname, { method = "GET", params, body, authenticated = true, submission = false } = {}) {
    const url = new URL(pathname, this.apiBase);
    for (const [key, value] of Object.entries(params ?? {})) {
      if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const headers = { Accept: "application/json", "Content-Type": "application/json" };
      if (authenticated) headers.Authorization = `Bearer ${await this.getAccessToken()}`;
      const response = await this.fetchImpl(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal
      });
      if (!response.ok) throw new WorkflowError(submission ? "SUBMISSION_UNCERTAIN" : "API_UNAVAILABLE");
      try {
        return await response.json();
      } catch (error) {
        throw new WorkflowError(submission ? "SUBMISSION_UNCERTAIN" : "API_UNAVAILABLE", undefined, error);
      }
    } catch (error) {
      if (error instanceof WorkflowError) throw error;
      throw new WorkflowError(submission ? "SUBMISSION_UNCERTAIN" : "API_UNAVAILABLE", undefined, error);
    } finally {
      clearTimeout(timer);
    }
  }

  async getAccessToken() {
    if (this.accessToken) return this.accessToken;
    const response = await this.rawRequest("/api/token", { authenticated: false, params: { badge: this.badge, sign: this.tokenSign } });
    if (response?.code !== 100000 || !response?.data?.access_token) throw new WorkflowError("AUTH_FAILED");
    this.accessToken = String(response.data.access_token);
    return this.accessToken;
  }

  async listFieldSystems() {
    const data = expectSuccess(await this.rawRequest("/api/resource_center/field_systems"), "field_systems");
    return Array.isArray(data) ? data : data?.field_systems ?? [];
  }

  async listUsers(keyword, { pageSize = 50, maxPages = 20 } = {}) {
    const collected = [];
    let truncated = false;
    for (let page = 1; page <= maxPages; page += 1) {
      const data = expectSuccess(await this.rawRequest("/api/user", { params: { keyword, page, page_size: pageSize } }), "users");
      const pageItems = normalizeUsers(data);
      collected.push(...pageItems);
      if (Array.isArray(data)) {
        truncated = pageItems.length >= pageSize;
        break;
      }
      if (!Number.isFinite(Number(data?.total)) || collected.length >= Number(data.total) || pageItems.length < pageSize) break;
      if (page === maxPages) truncated = true;
    }
    return { items: collected, truncated };
  }

  async listAssets({ systemId, keyword = "", pageSize = 200, maxPages = 20 } = {}) {
    const collected = [];
    let truncated = false;
    for (let page = 1; page <= maxPages; page += 1) {
      const data = expectSuccess(await this.rawRequest("/api/resource_center/asset_info_list", {
        params: { system_id: systemId, keyword, page, page_size: pageSize }
      }), "assets");
      const pageItems = normalizeAssets(data);
      for (const asset of pageItems) if (Number.isInteger(asset.id) && asset.id > 0) this.assetsById.set(asset.id, asset);
      collected.push(...pageItems);
      if (Array.isArray(data)) {
        truncated = pageItems.length >= pageSize;
        break;
      }
      if (!Number.isFinite(Number(data?.total)) || collected.length >= Number(data.total) || pageItems.length < pageSize) break;
      if (page === maxPages) truncated = true;
    }
    return { items: collected, truncated };
  }

  getCachedAssetById(assetId) {
    return this.assetsById.get(Number(assetId));
  }

  async permissionOptions({ systemId, assetId, userIds, lang = "zh" }) {
    const data = expectSuccess(await this.rawRequest("/api/ops/permission_type_duration", {
      params: { system_id: systemId, asset_id: assetId, user_ids: userIds.join(","), lang }
    }), "permission_options");
    return normalizePermissionOptions(data);
  }

  async submit(payload) {
    const data = expectSuccess(await this.rawRequest("/api/order/ops_permission_apply", { method: "POST", body: payload, submission: true }), "submission");
    return normalizeOrderId(data);
  }
}

function normalizeOrderId(data) {
  const candidates = [data, data?.order_id, data?.orderId, data?.id, data?.data?.order_id, data?.data?.orderId, data?.data?.id];
  for (const candidate of candidates) {
    const value = Number(candidate);
    if (Number.isInteger(value) && value > 0) return value;
  }
  return null;
}

export { normalizeAssets, normalizeUsers };
