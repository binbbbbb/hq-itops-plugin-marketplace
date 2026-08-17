import test from "node:test";
import assert from "node:assert/strict";
import { CLASSIFICATIONS, classifyRecord, makeAllowlist } from "../src/classifier.js";

const base = {
  mid: "m1",
  receivedAt: "2026-08-05 08:45:06",
  sender: "user@huaqin.com",
  senderDnAccount: "user",
  subject: "普通会议通知",
  serverName: "app",
  serverIp: "10.11.72.126",
};
const settings = {
  internalDomains: ["huaqin.com"],
  approvedServers: [{ name: "app", ip: "10.11.72.126" }],
  sensitiveSubjectKeywords: ["紧急付款"],
};

test("精确邮箱白名单命中为可信候选", () => {
  const result = classifyRecord(base, makeAllowlist({ emails: [base.sender] }), settings);
  assert.equal(result.classification, CLASSIFICATIONS.TRUSTED);
});

test("未命中白名单且无异常为待确认", () => {
  const result = classifyRecord({ ...base, sender: "new@partner.com", senderDnAccount: "" }, makeAllowlist(), settings);
  assert.equal(result.classification, CLASSIFICATIONS.PENDING);
});

test("元数据异常优先于精确白名单", () => {
  const result = classifyRecord(
    { ...base, senderDnAccount: "other" },
    makeAllowlist({ emails: [base.sender] }),
    settings,
  );
  assert.equal(result.classification, CLASSIFICATIONS.SUSPICIOUS);
  assert.match(result.reasons.join("；"), /目录账号不一致/);
});

test("相似域名和未知敏感主题标为可疑", () => {
  const result = classifyRecord(
    { ...base, sender: "boss@huaqim.com", senderDnAccount: "", subject: "紧急付款" },
    makeAllowlist(),
    settings,
  );
  assert.equal(result.classification, CLASSIFICATIONS.SUSPICIOUS);
  assert.equal(result.confidence, "高");
});

test("域名命中必须同时有目录和服务器佐证", () => {
  const allowlist = makeAllowlist({ domains: ["huaqin.com"] });
  assert.equal(classifyRecord(base, allowlist, settings).classification, CLASSIFICATIONS.TRUSTED);
  assert.equal(
    classifyRecord({ ...base, serverName: "unknown", serverIp: "10.0.0.1" }, allowlist, settings).classification,
    CLASSIFICATIONS.PENDING,
  );
});
