import https from "node:https";
import { AuthExpiredError, AppError } from "./errors.js";

const ALLOWED_HOST = "157.255.37.89";

export function parseCookie(cookieText) {
  const cookies = new Map();
  for (const item of String(cookieText ?? "").split(";")) {
    const index = item.indexOf("=");
    if (index <= 0) continue;
    cookies.set(item.slice(0, index).trim().toLowerCase(), item.slice(index + 1).trim());
  }
  const sid = cookies.get("coremail.sid");
  if (!sid || !/^[A-Za-z0-9_-]+$/.test(sid)) {
    throw new AuthExpiredError("Cookie 中缺少有效的 Coremail.sid，请在本机更新 Cookie。", {
      code: "AUTH_EXPIRED",
    });
  }
  return { sid, cookies };
}

export function buildSearchUrl({ baseUrl, cookie, begin, end }) {
  const base = new URL(baseUrl);
  if (base.protocol !== "https:" || base.hostname !== ALLOWED_HOST) {
    throw new AppError("Coremail 地址不在允许的固定主机范围内", { code: "COREMAIL_HOST_REJECTED" });
  }
  const { sid } = parseCookie(cookie);
  const url = new URL(`/webadmin/~${encodeURIComponent(sid)}/~/usr/searchMail.jsp`, base);
  const params = new URLSearchParams({
    action: "",
    subject: "",
    sender: "",
    receiver: "",
    toOrg: "",
    keyword: "",
    specified_range: "0",
    beginDate: begin,
    endDate: end,
    showquery: "1",
  });
  url.search = params.toString();
  return url;
}

function looksLikeLoginPage(body, contentType = "") {
  const sample = String(body).slice(0, 4096).toLowerCase();
  return (
    contentType.toLowerCase().includes("text/html") ||
    sample.includes("<html") ||
    sample.includes("jsessionid") ||
    sample.includes("login") ||
    sample.includes("登录")
  );
}

export function parseSearchResponse({ status, contentType = "", body = "" }) {
  if ([301, 302, 303, 307, 308, 401, 403].includes(status) || looksLikeLoginPage(body, contentType)) {
    throw new AuthExpiredError();
  }
  if (status < 200 || status >= 300) {
    throw new AppError(`Coremail 请求失败，HTTP ${status}`, { code: "COREMAIL_HTTP_ERROR" });
  }
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch (error) {
    throw new AuthExpiredError("Coremail 返回非 JSON 内容，可能是会话已失效。", { cause: error });
  }
  if (!Number.isInteger(parsed.totalRecords) || !Array.isArray(parsed.records)) {
    throw new AuthExpiredError("Coremail 响应结构异常，可能是会话已失效。");
  }
  return parsed;
}

export function postSearchPage({ url, cookie, results, startIndex, allowInsecureTls, timeoutMs = 20000 }) {
  if (url.hostname !== ALLOWED_HOST) {
    return Promise.reject(new AppError("拒绝向非固定 Coremail 主机发送 Cookie", { code: "COREMAIL_HOST_REJECTED" }));
  }
  const body = new URLSearchParams({ results: String(results), startIndex: String(startIndex) }).toString();

  return new Promise((resolve, reject) => {
    const request = https.request(
      url,
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded",
          "Content-Length": Buffer.byteLength(body),
          Cookie: cookie,
        },
        timeout: timeoutMs,
        rejectUnauthorized: allowInsecureTls ? false : true,
      },
      (response) => {
        let data = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          data += chunk;
        });
        response.on("end", () => {
          const status = response.statusCode ?? 0;
          const contentType = String(response.headers["content-type"] ?? "");
          try {
            resolve(parseSearchResponse({ status, contentType, body: data }));
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    request.on("timeout", () => request.destroy(new Error("request timeout")));
    request.on("error", (error) => {
      if (error instanceof AuthExpiredError || error instanceof AppError) reject(error);
      else reject(new AppError(`Coremail 连接失败：${error.message}`, { code: "COREMAIL_NETWORK_ERROR", cause: error }));
    });
    request.end(body);
  });
}

export async function fetchAllMail({ config, begin, end, pageSize, requestPage = postSearchPage }) {
  const url = buildSearchUrl({
    baseUrl: config.baseUrl,
    cookie: config.cookie,
    begin,
    end,
  });
  const size = pageSize ?? config.pageSize;
  const unique = new Map();
  let startIndex = 0;
  let totalRecords = null;
  let pageCount = 0;

  while (totalRecords === null || startIndex < totalRecords) {
    pageCount += 1;
    if (pageCount > 10000) {
      throw new AppError("Coremail 分页超过安全上限", { code: "COREMAIL_PAGINATION_LIMIT" });
    }
    const page = await requestPage({
      url,
      cookie: config.cookie,
      results: size,
      startIndex,
      allowInsecureTls: Boolean(config.allowInsecureTls),
      timeoutMs: config.timeoutMs,
    });
    totalRecords = page.totalRecords;
    if (page.records.length === 0) {
      if (startIndex < totalRecords) {
        throw new AppError("Coremail 在达到 totalRecords 前返回空分页", { code: "COREMAIL_INCOMPLETE_PAGE" });
      }
      break;
    }
    for (const record of page.records) {
      const key = String(record.mid || `${record.time || record["[t"]}|${record.from}|${record.to}|${record.subject}`);
      if (!unique.has(key)) unique.set(key, record);
    }
    startIndex += page.records.length;
    if (page.records.length < size && startIndex >= totalRecords) break;
  }

  return { totalRecords, records: [...unique.values()], pageCount };
}
