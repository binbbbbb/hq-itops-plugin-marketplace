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

  pruneExpired() {
    fs.mkdirSync(this.root, { recursive: true });
    for (const entry of fs.readdirSync(this.root, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      const file = path.join(this.root, entry.name);
      try {
        const record = JSON.parse(fs.readFileSync(file, "utf8"));
        if (this.now() <= Number(record.expires_at)) continue;
        fs.rmSync(file, { force: true });
        fs.rmSync(file.replace(/\.json$/, ".lock"), { force: true });
      } catch {
        // Leave malformed records untouched so they cannot be mistaken for valid confirmations.
      }
    }
  }

  create({ payload, summary }) {
    this.pruneExpired();
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

  claim(confirmationId) {
    const safeId = String(confirmationId ?? "");
    if (!/^[0-9A-Za-z-]+$/.test(safeId)) throw new WorkflowError("CONFIRMATION_NOT_FOUND");
    fs.mkdirSync(this.root, { recursive: true });
    const lock = path.join(this.root, `${safeId}.lock`);
    try {
      fs.writeFileSync(lock, String(this.now()), { encoding: "utf8", flag: "wx", mode: 0o600 });
    } catch (error) {
      if (error?.code === "EEXIST") throw new WorkflowError("CONFIRMATION_USED");
      throw new WorkflowError("CONFIRMATION_NOT_FOUND", undefined, error);
    }
    try {
      return { ...this.load(safeId), lock };
    } catch (error) {
      if (error?.code === "CONFIRMATION_NOT_FOUND") fs.rmSync(lock, { force: true });
      throw error;
    }
  }

  supersede(confirmationId) {
    let claimed;
    try {
      claimed = this.claim(confirmationId);
    } catch (error) {
      if (["CONFIRMATION_NOT_FOUND", "CONFIRMATION_EXPIRED", "CONFIRMATION_USED"].includes(error?.code)) return false;
      throw error;
    }
    const { record, file } = claimed;
    record.status = "superseded";
    record.superseded_at = this.now();
    fs.writeFileSync(file, JSON.stringify(record), { encoding: "utf8", mode: 0o600 });
    return true;
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
    if (record.status === "superseded") throw new WorkflowError("CONFIRMATION_NOT_FOUND");
    if (record.status !== "pending") throw new WorkflowError("CONFIRMATION_USED");
    if (this.now() > record.expires_at) throw new WorkflowError("CONFIRMATION_EXPIRED");
    if (payloadHash(record.payload) !== record.hash) throw new WorkflowError("CONFIRMATION_CHANGED");
    return { record, file };
  }

  consume(confirmationId) {
    const { record, file } = this.claim(confirmationId);
    record.status = "used";
    record.used_at = this.now();
    fs.writeFileSync(file, JSON.stringify(record), { encoding: "utf8", mode: 0o600 });
    return record;
  }
}
