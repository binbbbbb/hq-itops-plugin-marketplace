import { NotionError } from "./errors.js";
import { CLASSIFICATIONS, makeAllowlist } from "./classifier.js";

const NOTION_API = "https://api.notion.com/v1";

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function plainText(items = []) {
  return items.map((item) => item.plain_text ?? item.text?.content ?? "").join("");
}

function readProperty(property) {
  if (!property) return null;
  switch (property.type) {
    case "title": return plainText(property.title);
    case "rich_text": return plainText(property.rich_text);
    case "select": return property.select?.name ?? null;
    case "status": return property.status?.name ?? null;
    case "checkbox": return Boolean(property.checkbox);
    case "date": return property.date?.start ?? null;
    case "email": return property.email ?? null;
    default: return null;
  }
}

function isDateActive(start, end, now) {
  const nowTime = now.valueOf();
  const startTime = start ? new Date(start).valueOf() : Number.NEGATIVE_INFINITY;
  const normalizedEnd = /^\d{4}-\d{2}-\d{2}$/.test(String(end ?? "")) ? `${end}T23:59:59.999Z` : end;
  const endTime = end ? new Date(normalizedEnd).valueOf() : Number.POSITIVE_INFINITY;
  return !Number.isNaN(startTime) && !Number.isNaN(endTime) && startTime <= nowTime && endTime >= nowTime;
}

function richText(content) {
  return [{ type: "text", text: { content: String(content ?? "").slice(0, 2000) } }];
}

function propertyValue(schemaProperty, value) {
  if (!schemaProperty) return undefined;
  const text = String(value ?? "");
  switch (schemaProperty.type) {
    case "title": return { title: richText(text) };
    case "rich_text": return { rich_text: richText(text) };
    case "select": return { select: text ? { name: text.slice(0, 100) } : null };
    case "status": return { status: text ? { name: text.slice(0, 100) } : null };
    case "date": return { date: text ? { start: text } : null };
    case "email": return { email: text || null };
    case "checkbox": return { checkbox: Boolean(value) };
    default: return undefined;
  }
}

function toIsoMailTime(value) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text)) {
    return `${text.replace(" ", "T")}+08:00`;
  }
  const parsed = new Date(text);
  return Number.isNaN(parsed.valueOf()) ? null : parsed.toISOString();
}

export class NotionClient {
  constructor({ token, apiVersion = "2026-03-11", fetchImpl = globalThis.fetch }) {
    this.token = token;
    this.apiVersion = apiVersion;
    this.fetch = fetchImpl;
    this.schemas = new Map();
  }

  async request(endpoint, { method = "GET", body } = {}) {
    let lastError;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      let response;
      try {
        response = await this.fetch(`${NOTION_API}${endpoint}`, {
          method,
          headers: {
            Authorization: `Bearer ${this.token}`,
            "Notion-Version": this.apiVersion,
            "Content-Type": "application/json",
          },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
      } catch (error) {
        lastError = error;
        if (attempt < 2) await sleep(250 * 2 ** attempt);
        continue;
      }

      const text = await response.text();
      let payload = {};
      if (text) {
        try { payload = JSON.parse(text); } catch { payload = { message: text.slice(0, 300) }; }
      }
      if (response.ok) return payload;
      const retryable = response.status === 429 || response.status >= 500;
      lastError = new Error(payload.message || `HTTP ${response.status}`);
      if (retryable && attempt < 2) {
        const retryAfter = Math.min(Number(response.headers.get("retry-after") ?? 1), 5);
        await sleep(retryAfter * 1000);
        continue;
      }
      throw new NotionError(`Notion 请求失败（HTTP ${response.status}）：${payload.message || "未知错误"}`);
    }
    throw new NotionError(`Notion 连接失败：${lastError?.message ?? "未知错误"}`, { cause: lastError });
  }

  async getSchema(dataSourceId) {
    if (!this.schemas.has(dataSourceId)) {
      const schema = await this.request(`/data_sources/${encodeURIComponent(dataSourceId)}`);
      this.schemas.set(dataSourceId, schema.properties ?? {});
    }
    return this.schemas.get(dataSourceId);
  }

  async queryAll(dataSourceId, filter) {
    const results = [];
    let cursor;
    do {
      const payload = { page_size: 100, result_type: "page" };
      if (filter) payload.filter = filter;
      if (cursor) payload.start_cursor = cursor;
      const page = await this.request(`/data_sources/${encodeURIComponent(dataSourceId)}/query`, {
        method: "POST",
        body: payload,
      });
      results.push(...(page.results ?? []));
      cursor = page.has_more ? page.next_cursor : null;
    } while (cursor);
    return results;
  }
}

function assertProperty(schema, name, acceptedTypes, label) {
  const property = schema[name];
  if (!property) throw new NotionError(`Notion ${label}缺少属性“${name}”`);
  if (!acceptedTypes.includes(property.type)) {
    throw new NotionError(`Notion 属性“${name}”类型应为 ${acceptedTypes.join("/")}，实际为 ${property.type}`);
  }
}

export async function loadAllowlist(client, notionConfig, now = new Date()) {
  const id = notionConfig.allowlistDataSourceId;
  const names = notionConfig.allowlistProperties;
  const schema = await client.getSchema(id);
  assertProperty(schema, names.value, ["title", "rich_text"], "白名单");
  assertProperty(schema, names.type, ["select"], "白名单");
  assertProperty(schema, names.enabled, ["checkbox"], "白名单");

  const pages = await client.queryAll(id, {
    property: names.enabled,
    checkbox: { equals: true },
  });
  const emails = [];
  const domains = [];
  const rules = [];
  for (const page of pages) {
    const value = String(readProperty(page.properties[names.value]) ?? "").trim().toLowerCase();
    const type = String(readProperty(page.properties[names.type]) ?? "").trim().toLowerCase();
    const validFrom = readProperty(page.properties[names.validFrom]);
    const validUntil = readProperty(page.properties[names.validUntil]);
    if (!value || !isDateActive(validFrom, validUntil, now)) continue;
    if (type === "email") emails.push(value);
    else if (type === "domain") domains.push(value.replace(/^@/, ""));
    else continue;
    rules.push({
      value,
      type,
      note: String(readProperty(page.properties[names.note]) ?? ""),
    });
  }
  return { ...makeAllowlist({ emails, domains }), rules };
}

const RESULT_TYPES = Object.freeze({
  title: ["title"],
  messageId: ["rich_text", "title"],
  recordType: ["select", "status"],
  mailTime: ["date"],
  sender: ["email", "rich_text"],
  receiver: ["email", "rich_text"],
  subject: ["rich_text", "title"],
  classification: ["select", "status"],
  confidence: ["select", "status"],
  reasons: ["rich_text"],
  action: ["rich_text"],
  fromOrg: ["rich_text"],
  toOrg: ["rich_text"],
  server: ["rich_text"],
  scanRange: ["rich_text"],
  runId: ["rich_text"],
  handlingStatus: ["select", "status"],
});

export async function validateResultSchema(client, notionConfig) {
  const schema = await client.getSchema(notionConfig.resultsDataSourceId);
  for (const [key, accepted] of Object.entries(RESULT_TYPES)) {
    assertProperty(schema, notionConfig.resultProperties[key], accepted, "结果库");
  }
  return schema;
}

function buildProperties(schema, names, values) {
  const properties = {};
  for (const [key, value] of Object.entries(values)) {
    const name = names[key];
    if (!name) continue;
    const converted = propertyValue(schema[name], value);
    if (converted) properties[name] = converted;
  }
  return properties;
}

async function createPage(client, dataSourceId, properties) {
  return client.request("/pages", {
    method: "POST",
    body: { parent: { data_source_id: dataSourceId }, properties },
  });
}

async function updatePage(client, pageId, properties) {
  return client.request(`/pages/${encodeURIComponent(pageId)}`, {
    method: "PATCH",
    body: { properties },
  });
}

function pageMessageId(page, messageIdProperty) {
  return String(readProperty(page.properties[messageIdProperty]) ?? "");
}

function mailValues(item, { begin, end, runId, resolved = false }) {
  return {
    title: item.subject || `邮件 ${item.mid}`,
    messageId: item.mid,
    recordType: "EMAIL",
    mailTime: toIsoMailTime(item.receivedAt),
    sender: item.sender,
    receiver: item.receiver,
    subject: item.subject,
    classification: item.classification,
    confidence: item.confidence,
    reasons: item.reasons.join("；"),
    action: item.recommendedAction,
    fromOrg: item.senderOrg,
    toOrg: item.receiverOrg,
    server: `${item.serverName || "-"} / ${item.serverIp || "-"}`,
    scanRange: `${begin} 至 ${end}`,
    runId,
    handlingStatus: resolved ? "已解除" : "待处理",
  };
}

export async function syncScreeningResults(client, notionConfig, items, context) {
  const schema = await validateResultSchema(client, notionConfig);
  const id = notionConfig.resultsDataSourceId;
  const names = notionConfig.resultProperties;
  const rangeFilter = {
    and: [
      { property: names.recordType, [schema[names.recordType].type]: { equals: "EMAIL" } },
      { property: names.mailTime, date: { on_or_after: `${context.begin}T00:00:00+08:00` } },
      { property: names.mailTime, date: { on_or_before: `${context.end}T23:59:59+08:00` } },
    ],
  };
  const existingPages = await client.queryAll(id, rangeFilter);
  const existingByMid = new Map(existingPages.map((page) => [pageMessageId(page, names.messageId), page]));
  let created = 0;
  let updated = 0;
  let resolved = 0;

  for (const item of items) {
    const existing = existingByMid.get(item.mid);
    if (item.classification === CLASSIFICATIONS.TRUSTED) {
      if (!existing) continue;
      const properties = buildProperties(schema, names, mailValues(item, { ...context, resolved: true }));
      await updatePage(client, existing.id, properties);
      resolved += 1;
      continue;
    }
    const properties = buildProperties(schema, names, mailValues(item, context));
    if (existing) {
      await updatePage(client, existing.id, properties);
      updated += 1;
    } else {
      await createPage(client, id, properties);
      created += 1;
    }
  }
  return { created, updated, resolved };
}

export async function writeRunFailure(client, notionConfig, { runId, begin, end, error }) {
  const schema = await validateResultSchema(client, notionConfig);
  const names = notionConfig.resultProperties;
  const properties = buildProperties(schema, names, {
    title: `邮件初筛失败 ${begin} 至 ${end}`,
    messageId: `RUN:${runId}`,
    recordType: "RUN",
    mailTime: new Date().toISOString(),
    sender: "",
    receiver: "",
    subject: "Coremail 鉴权失效",
    classification: "运行失败",
    confidence: "高",
    reasons: error.message,
    action: "在本机更新 Coremail Cookie 后重试",
    fromOrg: "",
    toOrg: "",
    server: "Coremail",
    scanRange: `${begin} 至 ${end}`,
    runId,
    handlingStatus: "鉴权失败",
  });
  return createPage(client, notionConfig.resultsDataSourceId, properties);
}
