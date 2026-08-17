import { emailParts, normalizeEmail } from "./normalize.js";

export const CLASSIFICATIONS = Object.freeze({
  TRUSTED: "可信候选",
  PENDING: "待确认",
  SUSPICIOUS: "可疑",
});

function levenshtein(left, right) {
  const a = [...left];
  const b = [...right];
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = previous[0];
    previous[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const old = previous[j];
      previous[j] = Math.min(
        previous[j] + 1,
        previous[j - 1] + 1,
        diagonal + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      diagonal = old;
    }
  }
  return previous[b.length];
}

export function makeAllowlist({ emails = [], domains = [] } = {}) {
  return {
    emails: new Set(emails.map(normalizeEmail).filter(Boolean)),
    domains: new Set(domains.map((value) => String(value).trim().toLowerCase().replace(/^@/, "")).filter(Boolean)),
  };
}

function inspectServer(record, approvedServers) {
  if (!Array.isArray(approvedServers) || approvedServers.length === 0) {
    return { exact: false, conflict: false };
  }
  const exact = approvedServers.some(
    (server) => server.name === record.serverName && server.ip === record.serverIp,
  );
  const partial = approvedServers.some(
    (server) => server.name === record.serverName || server.ip === record.serverIp,
  );
  return { exact, conflict: partial && !exact };
}

function isLookalikeDomain(domain, internalDomains) {
  if (!domain) return false;
  return internalDomains.some((known) => {
    if (domain === known) return false;
    if (domain.startsWith("xn--")) return true;
    return Math.abs(domain.length - known.length) <= 1 && levenshtein(domain, known) <= 1;
  });
}

export function classifyRecord(record, allowlist, settings = {}) {
  const sender = emailParts(record.sender);
  const internalDomains = (settings.internalDomains ?? []).map((value) => String(value).toLowerCase());
  const keywords = (settings.sensitiveSubjectKeywords ?? []).filter(Boolean);
  const reasons = [];
  const matchedRules = [];
  const anomalies = [];
  // 检查必要邮件元数据，进行异常检检测
  if (!sender || !record.mid || !record.receivedAt) anomalies.push("必要邮件元数据缺失或格式异常");
  const exactEmail = Boolean(sender && allowlist.emails.has(sender.address));
  const domainMatch = Boolean(sender && allowlist.domains.has(sender.domain));
  if (exactEmail) matchedRules.push(`email:${sender.address}`);
  if (domainMatch) matchedRules.push(`domain:${sender.domain}`);

  const isInternal = Boolean(sender && internalDomains.includes(sender.domain));
  const directoryPresent = Boolean(record.senderDnAccount);
  const directoryMatch = Boolean(sender && directoryPresent && record.senderDnAccount === sender.local);
  if (isInternal && directoryPresent && !directoryMatch) anomalies.push("内部邮箱账号与 fromdn 目录账号不一致");

  const server = inspectServer(record, settings.approvedServers ?? []);
  if (server.conflict) anomalies.push("服务器名称与 IP 白名单映射冲突");
  if (sender && isLookalikeDomain(sender.domain, internalDomains)) anomalies.push("发件域名与内部域名高度相似");

  const sensitiveMatches = keywords.filter((keyword) => record.subject.includes(keyword));
  const unknownSender = !exactEmail && !domainMatch;
  if (unknownSender && sensitiveMatches.length > 0) {
    anomalies.push(`未知发件人主题包含敏感词：${sensitiveMatches.join("、")}`);
  }

  if (anomalies.length > 0) {
    reasons.push(...anomalies);
    if (exactEmail || domainMatch) reasons.push("即使命中白名单，异常信号仍优先处理");
    return {
      classification: CLASSIFICATIONS.SUSPICIOUS,
      confidence: anomalies.length >= 2 ? "高" : "中",
      allowlistStatus: exactEmail ? "精确邮箱命中" : domainMatch ? "域名命中" : "未命中",
      matchedRules,
      reasons,
      recommendedAction: "重点复核，确认前不要操作链接、附件或敏感业务",
    };
  }

  if (exactEmail) {
    reasons.push("发件人命中精确邮箱白名单", "未发现现有元数据冲突");
    return {
      classification: CLASSIFICATIONS.TRUSTED,
      confidence: "中",
      allowlistStatus: "精确邮箱命中",
      matchedRules,
      reasons,
      recommendedAction: "正常展示并保留审计记录",
    };
  }

  if (domainMatch && directoryMatch && server.exact) {
    reasons.push("发件域名命中白名单", "目录账号一致且服务器名称/IP组合已登记");
    return {
      classification: CLASSIFICATIONS.TRUSTED,
      confidence: "中",
      allowlistStatus: "域名命中并有内部佐证",
      matchedRules,
      reasons,
      recommendedAction: "正常展示并保留审计记录",
    };
  }

  if (domainMatch) reasons.push("仅命中域名白名单，缺少目录与服务器的组合佐证");
  else reasons.push("发件人未命中邮箱或域名白名单");
  if (!directoryPresent && isInternal) reasons.push("接口未提供可用于佐证的发件人目录账号");
  if (!server.exact) reasons.push("服务器组合未提供可信佐证");

  return {
    classification: CLASSIFICATIONS.PENDING,
    confidence: "低",
    allowlistStatus: domainMatch ? "仅域名命中" : "未命中",
    matchedRules,
    reasons,
    recommendedAction: "人工确认发件人身份和业务背景",
  };
}

export function classifyAll(records, allowlist, settings) {
  return records.map((record) => ({ ...record, ...classifyRecord(record, allowlist, settings) }));
}
