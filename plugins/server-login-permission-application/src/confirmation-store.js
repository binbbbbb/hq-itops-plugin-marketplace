import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { WorkflowError } from "./errors.js";

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  return value;
}

export function payloadHash(payload) {
  return crypto.createHash("sha256").update(JSON.stringify(stable(payload))).digest("hex");
}

export class ConfirmationStore {
  constructor({ root = path.join(os.tmpdir(), "hq-itops-server-login-permission"), now = () => Date.now(), id = () => crypto.randomUUID(), ttlMs = 30 * 60 * 1000 } = {}) {
    this.root = root;
    this.now = now;
    this.id = id;
    this.ttlMs = ttlMs;
  }

  clearPending() {
    fs.mkdirSync(this.root, { recursive: true });
    for (const entry of fs.readdirSync(this.root, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith(".json")) fs.rmSync(path.join(this.root, entry.name));
    }
  }

  create({ payload, summary }) {
    this.clearPending();
    const confirmationId = this.id();
    const createdAt = this.now();
    const record = {
      confirmation_id: confirmationId,
      created_at: createdAt,
      expires_at: createdAt + this.ttlMs,
      status: "pending",
      hash: payloadHash(payload),
      payload,
      summary
    };
    fs.writeFileSync(path.join(this.root, `${confirmationId}.json`), JSON.stringify(record), { encoding: "utf8", flag: "wx", mode: 0o600 });
    return record;
  }

  load(confirmationId) {
    const safeId = String(confirmationId ?? "");
    if (!/^[0-9A-Za-z-]+$/.test(safeId)) throw new WorkflowError("CONFIRMATION_NOT_FOUND");
    const file = path.join(this.root, `${safeId}.json`);
    if (!fs.existsSync(file)) throw new WorkflowError("CONFIRMATION_NOT_FOUND");
    let record;
    try {
      record = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (error) {
      throw new WorkflowError("CONFIRMATION_NOT_FOUND", undefined, error);
    }
    if (record.status !== "pending") throw new WorkflowError("CONFIRMATION_USED");
    if (this.now() > record.expires_at) throw new WorkflowError("CONFIRMATION_EXPIRED");
    if (payloadHash(record.payload) !== record.hash) throw new WorkflowError("CONFIRMATION_CHANGED");
    return { record, file };
  }

  consume(confirmationId) {
    const { record, file } = this.load(confirmationId);
    record.status = "used";
    record.used_at = this.now();
    fs.writeFileSync(file, JSON.stringify(record), { encoding: "utf8", mode: 0o600 });
    return record;
  }
}
