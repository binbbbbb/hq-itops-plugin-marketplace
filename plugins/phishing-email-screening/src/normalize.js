export function normalizeEmail(value) {
  return String(value ?? "").trim().toLowerCase();
}

export function emailParts(value) {
  const normalized = normalizeEmail(value);
  const match = /^([^@\s]+)@([^@\s]+)$/.exec(normalized);
  return match ? { address: normalized, local: match[1], domain: match[2] } : null;
}

function lastPathPart(value) {
  const parts = String(value ?? "").split("/").filter(Boolean);
  return parts.at(-1)?.toLowerCase() ?? "";
}

export function normalizeRecord(raw) {
  const sender = normalizeEmail(raw.from);
  const receiver = normalizeEmail(raw.to);
  return {
    mid: String(raw.mid ?? "").trim(),
    tid: String(raw.tid ?? "").trim(),
    receivedAt: String(raw.time || raw["[t"] || "").trim(),
    sender,
    receiver,
    senderDn: String(raw.fromdn ?? "").trim(),
    receiverDn: String(raw.todn ?? "").trim(),
    senderDnAccount: lastPathPart(raw.fromdn),
    receiverDnAccount: lastPathPart(raw.todn),
    senderOrgId: String(raw.fromou ?? "").trim(),
    receiverOrgId: String(raw.toou ?? "").trim(),
    senderOrg: String(raw.fromOU ?? "").trim(),
    receiverOrg: String(raw.toOU ?? "").trim(),
    subject: String(raw.subject ?? "").trim(),
    serverName: String(raw.serverName ?? "").trim(),
    serverIp: String(raw.serverIP ?? "").trim(),
    flag: String(raw.flag ?? "").trim(),
    mailboxStatus: String(raw.status ?? "").trim(),
  };
}
