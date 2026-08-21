import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ConfirmationStore } from "../src/confirmation-store.js";
import { deriveCurrentBadge } from "../src/config.js";
import { PermissionWorkflow, resolveUser } from "../src/workflow.js";

function fixtureClient() {
  const submissions = [];
  return {
    submissions,
    async listFieldSystems() {
      return [{ id: 10, name: "基础架构", children: [{ id: 20, name: "Zeus" }] }];
    },
    async listUsers(keyword) {
      if (keyword === "100001") return [{ id: 1, name: "当前用户", badge: "100001", department: "IT", group: "OPS" }];
      return [{ id: 2, name: "张三", badge: "100002", department: "IT", group: "A" }];
    },
    async listAssets({ keyword }) {
      const second = keyword === "srv-02";
      return { items: [{ id: second ? 31 : 30, host_name: second ? "srv-02" : "srv-01", system_id: 20 }], truncated: false };
    },
    async permissionOptions({ userIds }) {
      return {
        able_permission_type: [{ id: 1, name: "SSH" }, { id: 2, name: "SSH只读" }],
        user_info: [{ id: userIds[0], able_duration: [{ id: 7, name: "7天" }] }]
      };
    },
    async submit(payload) {
      submissions.push(payload);
      return 9001;
    }
  };
}

function tempStore(options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "server-permission-test-"));
  return { root, store: new ConfirmationStore({ root, id: () => "confirm-1", ...options }) };
}

const validDraft = {
  field_system: "Zeus",
  description: "日常运维需要",
  permissions: [{ asset: "srv-01", accounts: [{ permission_type: "SSH", duration: "7天" }] }]
};

test("derives badge from CodeBuddy install path", () => {
  assert.equal(deriveCurrentBadge({ installPath: "C:\\Users\\100001\\.codebuddy\\plugins\\x", home: "X:\\none", env: {}, exists: () => false }), "100001");
});

test("prepare defaults applicant to current user and emits canonical summary", async (t) => {
  const client = fixtureClient();
  const { root, store } = tempStore();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const workflow = new PermissionWorkflow({ client, store, currentBadge: "100001" });
  const result = await workflow.prepare(validDraft);
  assert.equal(result.confirmation_id, "confirm-1");
  assert.equal(result.summary.permissions[0].accounts[0].defaulted_to_self, true);
  assert.deepEqual(store.load("confirm-1").record.payload.permissions[0].accounts[0], { user_id: 1, permission_type: 1, duration: 7 });
});

test("multiple resources preserve explicit applicant mappings", async (t) => {
  const client = fixtureClient();
  const { root, store } = tempStore();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const workflow = new PermissionWorkflow({ client, store, currentBadge: "100001" });
  const result = await workflow.prepare({
    ...validDraft,
    permissions: [
      validDraft.permissions[0],
      { asset: "srv-02", accounts: [{ applicant: { badge: "100002" }, permission_type: 2, duration: 7 }] }
    ]
  });
  assert.equal(result.summary.permissions.length, 2);
  assert.equal(result.summary.permissions[1].asset.id, 31);
  assert.equal(result.summary.permissions[1].accounts[0].applicant.badge, "100002");
  assert.equal(result.summary.permissions[1].accounts[0].defaulted_to_self, false);
});

test("duplicate names require badge selection", () => {
  const users = [
    { id: 2, name: "张三", badge: "100002", department: "IT", group: "A" },
    { id: 3, name: "张三", badge: "100003", department: "IT", group: "B" }
  ];
  assert.throws(() => resolveUser(users, "张三"), (error) => error.code === "AMBIGUOUS_USER" && error.details.candidates.length === 2);
  assert.equal(resolveUser(users, { badge: "100003" }).id, 3);
});

test("validation rejects missing fields and overlong descriptions without submission", async (t) => {
  const client = fixtureClient();
  const { root, store } = tempStore();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const workflow = new PermissionWorkflow({ client, store, currentBadge: "100001" });
  await assert.rejects(() => workflow.prepare({}), (error) => error.code === "MISSING_FIELD_SYSTEM");
  await assert.rejects(() => workflow.prepare({ ...validDraft, description: "字".repeat(256) }), (error) => error.code === "DESCRIPTION_TOO_LONG");
  assert.equal(client.submissions.length, 0);
});

test("submit requires exact phrase and consumes confirmation once", async (t) => {
  const client = fixtureClient();
  const { root, store } = tempStore();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const workflow = new PermissionWorkflow({ client, store, currentBadge: "100001" });
  await workflow.prepare(validDraft);
  await assert.rejects(() => workflow.submit({ confirmation_id: "confirm-1", confirmation_phrase: "好" }), (error) => error.code === "CONFIRMATION_REQUIRED");
  assert.equal(client.submissions.length, 0);
  const result = await workflow.submit({ confirmation_id: "confirm-1", confirmation_phrase: "确认提交" });
  assert.equal(result.order_id, 9001);
  assert.equal(client.submissions.length, 1);
  await assert.rejects(() => workflow.submit({ confirmation_id: "confirm-1", confirmation_phrase: "确认提交" }), (error) => error.code === "CONFIRMATION_USED");
});

test("new prepare invalidates old confirmation and expiry is enforced", async (t) => {
  let now = 1000;
  let counter = 0;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "server-permission-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const store = new ConfirmationStore({ root, now: () => now, id: () => `confirm-${++counter}`, ttlMs: 100 });
  const workflow = new PermissionWorkflow({ client: fixtureClient(), store, currentBadge: "100001" });
  await workflow.prepare(validDraft);
  await workflow.prepare({ ...validDraft, description: "修改后的原因" });
  assert.throws(() => store.load("confirm-1"), (error) => error.code === "CONFIRMATION_NOT_FOUND");
  now = 1200;
  assert.throws(() => store.load("confirm-2"), (error) => error.code === "CONFIRMATION_EXPIRED");
});

test("duplicate and mutually exclusive permissions are rejected", async (t) => {
  const { root, store } = tempStore();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const workflow = new PermissionWorkflow({ client: fixtureClient(), store, currentBadge: "100001" });
  const duplicate = { ...validDraft, permissions: [{ asset: "srv-01", accounts: [
    { permission_type: "SSH", duration: "7天" }, { permission_type: "SSH", duration: "7天" }
  ] }] };
  await assert.rejects(() => workflow.prepare(duplicate), (error) => error.code === "DUPLICATE_PERMISSION");
  const exclusive = { ...validDraft, permissions: [{ asset: "srv-01", accounts: [
    { permission_type: "SSH", duration: "7天" }, { permission_type: "SSH只读", duration: "7天" }
  ] }] };
  await assert.rejects(() => workflow.prepare(exclusive), (error) => error.code === "MUTUALLY_EXCLUSIVE_PERMISSION");
});
