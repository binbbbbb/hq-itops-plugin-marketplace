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
  const assetQueries = [];
  return {
    submissions,
    assetQueries,
    async listFieldSystems() {
      return [{ id: 10, name: "基础架构", children: [{ id: 20, name: "Zeus" }] }];
    },
    async listUsers(keyword) {
      if (keyword === "100001") return [{ id: 1, name: "当前用户", badge: "100001", department: "IT", group: "OPS" }];
      return [{ id: 2, name: "张三", badge: "100002", department: "IT", group: "A" }];
    },
    async listAssets({ systemId, keyword }) {
      assetQueries.push({ systemId, keyword });
      const second = keyword === "srv-02";
      return { items: [{
        id: second ? 31 : 30,
        host_name: second ? "srv-02" : "srv-01",
        field_id: 10,
        field_name: "基础架构",
        system_id: 20,
        system_name: "Zeus"
      }], truncated: false };
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

test("prepare returns safe live candidates when a permission type is not allowed", async (t) => {
  const client = fixtureClient();
  const { root, store } = tempStore();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const workflow = new PermissionWorkflow({ client, store, currentBadge: "100001" });
  await assert.rejects(() => workflow.prepare({
    ...validDraft,
    permissions: [{ asset: "srv-01", accounts: [{ permission_type: "FTP", duration: "7天" }] }]
  }), (error) => {
    assert.equal(error.code, "PERMISSION_TYPE_NOT_ALLOWED");
    assert.deepEqual(error.details.allowed_permission_types, [{ id: 1, name: "SSH" }, { id: 2, name: "SSH只读" }]);
    return true;
  });
});

test("prepare accepts permission types nested under the selected user", async (t) => {
  const client = fixtureClient();
  client.permissionOptions = async ({ userIds }) => ({
    user_info: [{
      user_id: userIds[0],
      able_permission_type: [{ dict_id: 3, label: "FTP" }],
      able_duration: [{ dict_id: 30, label: "1个月" }]
    }]
  });
  const { root, store } = tempStore();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const workflow = new PermissionWorkflow({ client, store, currentBadge: "100001" });
  const result = await workflow.prepare({
    ...validDraft,
    permissions: [{ asset: "srv-01", accounts: [{ permission_type: "FTP", duration: "1个月" }] }]
  });
  assert.equal(result.summary.permissions[0].accounts[0].permission_type.id, 3);
  assert.equal(result.summary.permissions[0].accounts[0].duration.id, 30);
});

test("prepare derives the field and system from the selected asset", async (t) => {
  const client = fixtureClient();
  const { root, store } = tempStore();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const workflow = new PermissionWorkflow({ client, store, currentBadge: "100001" });
  const { field_system, ...assetFirstDraft } = validDraft;
  const result = await workflow.prepare(assetFirstDraft);
  assert.deepEqual(result.summary.field, { id: 10, name: "基础架构" });
  assert.deepEqual(result.summary.system, { id: 20, name: "Zeus" });
  assert.equal(result.summary.permissions[0].asset.field_name, "基础架构");
  assert.equal(result.summary.permissions[0].asset.system_name, "Zeus");
  assert.equal(client.assetQueries[0].systemId, undefined);
});

test("prepare revalidates a numeric asset selector with its cached canonical hostname", async (t) => {
  const client = fixtureClient();
  client.getCachedAssetById = (id) => Number(id) === 30
    ? { id: 30, host_name: "srv-01", ops_resource_name: "" }
    : undefined;
  const { root, store } = tempStore();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const workflow = new PermissionWorkflow({ client, store, currentBadge: "100001" });
  await workflow.prepare({
    description: "数字资产ID联调",
    permissions: [{ asset: 30, accounts: [{ permission_type: "SSH", duration: "7天" }] }]
  });
  assert.equal(client.assetQueries[0].keyword, "srv-01");
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

test("validation rejects missing request data and overlong descriptions without submission", async (t) => {
  const client = fixtureClient();
  const { root, store } = tempStore();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const workflow = new PermissionWorkflow({ client, store, currentBadge: "100001" });
  await assert.rejects(() => workflow.prepare({}), (error) => error.code === "MISSING_DESCRIPTION");
  await assert.rejects(() => workflow.prepare({ ...validDraft, description: "字".repeat(256) }), (error) => error.code === "DESCRIPTION_TOO_LONG");
  assert.equal(client.submissions.length, 0);
});

test("asset-derived applications reject resources from different systems", async (t) => {
  const client = fixtureClient();
  client.listFieldSystems = async () => [{
    id: 10,
    name: "基础架构",
    children: [{ id: 20, name: "Zeus" }, { id: 21, name: "CMDB" }]
  }];
  client.listAssets = async ({ keyword }) => ({
    items: [{ id: keyword === "srv-02" ? 31 : 30, host_name: keyword, field_id: 10, system_id: keyword === "srv-02" ? 21 : 20 }],
    truncated: false
  });
  const { root, store } = tempStore();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const workflow = new PermissionWorkflow({ client, store, currentBadge: "100001" });
  await assert.rejects(() => workflow.prepare({
    description: "跨系统资源",
    permissions: [
      { asset: "srv-01", accounts: [{ permission_type: "SSH", duration: "7天" }] },
      { asset: "srv-02", accounts: [{ permission_type: "SSH", duration: "7天" }] }
    ]
  }), (error) => error.code === "ASSET_SYSTEM_MISMATCH");
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

test("conversation-bound confirmation submits without exposing its confirmation ID", async (t) => {
  const client = fixtureClient();
  const { root, store } = tempStore();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const workflow = new PermissionWorkflow({ client, store, currentBadge: "100001" });
  await workflow.prepare({ ...validDraft, conversation_key: "dify-conversation-1" });
  const result = await workflow.submit({
    conversation_key: "dify-conversation-1",
    confirmation_phrase: "确认提交"
  });
  assert.equal(result.order_id, 9001);
  assert.equal(client.submissions.length, 1);
  await assert.rejects(() => workflow.submit({
    conversation_key: "dify-conversation-1",
    confirmation_phrase: "确认提交"
  }), (error) => error.code === "CONFIRMATION_NOT_FOUND");
});

test("conversation binding rejects malformed keys and mixed identifiers", async (t) => {
  const client = fixtureClient();
  const { root, store } = tempStore();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const workflow = new PermissionWorkflow({ client, store, currentBadge: "100001" });
  await assert.rejects(
    () => workflow.prepare({ ...validDraft, conversation_key: { unsafe: true } }),
    (error) => error.code === "CONFIG_INVALID"
  );
  await workflow.prepare({ ...validDraft, conversation_key: "dify-conversation-1" });
  await assert.rejects(
    () => workflow.submit({ confirmation_id: "confirm-1", conversation_key: "dify-conversation-1", confirmation_phrase: "确认提交" }),
    (error) => error.code === "CONFIG_INVALID"
  );
  assert.equal(client.submissions.length, 0);
});

test("conversation-bound confirmations are isolated by current user and conversation", async (t) => {
  let counter = 0;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "server-permission-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const store = new ConfirmationStore({ root, id: () => `confirm-${++counter}` });
  const firstClient = fixtureClient();
  const first = new PermissionWorkflow({ client: firstClient, store, currentBadge: "100001" });
  const second = new PermissionWorkflow({ client: fixtureClient(), store, currentBadge: "100002" });
  await first.prepare({ ...validDraft, conversation_key: "shared-key" });
  await assert.rejects(() => second.submit({
    conversation_key: "shared-key",
    confirmation_phrase: "确认提交"
  }), (error) => error.code === "CONFIRMATION_NOT_FOUND");
  await assert.rejects(() => first.submit({
    conversation_key: "other-key",
    confirmation_phrase: "确认提交"
  }), (error) => error.code === "CONFIRMATION_NOT_FOUND");
  await first.submit({ conversation_key: "shared-key", confirmation_phrase: "确认提交" });
  assert.equal(firstClient.submissions.length, 1);
});

test("a new prepare replaces only the prior confirmation in the same conversation", async (t) => {
  let counter = 0;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "server-permission-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const store = new ConfirmationStore({ root, id: () => `confirm-${++counter}` });
  const workflow = new PermissionWorkflow({ client: fixtureClient(), store, currentBadge: "100001" });
  await workflow.prepare({ ...validDraft, conversation_key: "conversation-a" });
  await workflow.prepare({ ...validDraft, description: "修改后的申请", conversation_key: "conversation-a" });
  await workflow.prepare({ ...validDraft, description: "另一个会话", conversation_key: "conversation-b" });
  assert.throws(() => store.load("confirm-1"), (error) => error.code === "CONFIRMATION_NOT_FOUND");
  assert.equal(store.load("confirm-2").record.status, "pending");
  assert.equal(store.load("confirm-3").record.status, "pending");
});

test("new prepare invalidates only the explicitly replaced confirmation and expiry is enforced", async (t) => {
  let now = 1000;
  let counter = 0;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "server-permission-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const store = new ConfirmationStore({ root, now: () => now, id: () => `confirm-${++counter}`, ttlMs: 100 });
  const workflow = new PermissionWorkflow({ client: fixtureClient(), store, currentBadge: "100001" });
  const first = await workflow.prepare(validDraft);
  await workflow.prepare({ ...validDraft, description: "修改后的原因", previous_confirmation_id: first.confirmation_id });
  assert.throws(() => store.load("confirm-1"), (error) => error.code === "CONFIRMATION_NOT_FOUND");
  now = 1200;
  assert.throws(() => store.load("confirm-2"), (error) => error.code === "CONFIRMATION_EXPIRED");
});

test("independent prepares keep each other's confirmations valid", async (t) => {
  let counter = 0;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "server-permission-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const store = new ConfirmationStore({ root, id: () => `confirm-${++counter}` });
  const workflow = new PermissionWorkflow({ client: fixtureClient(), store, currentBadge: "100001" });
  await workflow.prepare(validDraft);
  await workflow.prepare({ ...validDraft, description: "另一个独立任务" });
  assert.equal(store.load("confirm-1").record.status, "pending");
  assert.equal(store.load("confirm-2").record.status, "pending");
});

test("replacing an expired confirmation still creates a usable new confirmation", async (t) => {
  let now = 1000;
  let counter = 0;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "server-permission-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const store = new ConfirmationStore({ root, now: () => now, id: () => `confirm-${++counter}`, ttlMs: 100 });
  const workflow = new PermissionWorkflow({ client: fixtureClient(), store, currentBadge: "100001" });
  const first = await workflow.prepare(validDraft);
  now = 1200;
  const second = await workflow.prepare({ ...validDraft, description: "过期后修改", previous_confirmation_id: first.confirmation_id });
  assert.equal(second.confirmation_id, "confirm-2");
  assert.equal(store.load("confirm-2").record.status, "pending");
});

test("an atomic confirmation lock blocks a second process before status changes", async (t) => {
  const { root, store } = tempStore();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  store.create({ payload: { value: 1 }, summary: {} });
  fs.writeFileSync(path.join(root, "confirm-1.lock"), "claimed", { flag: "wx" });
  assert.throws(() => new ConfirmationStore({ root }).consume("confirm-1"), (error) => error.code === "CONFIRMATION_USED");
  assert.equal(store.load("confirm-1").record.status, "pending");
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

test("duplicate and mutually exclusive permissions cannot be split across repeated asset entries", async (t) => {
  const { root, store } = tempStore();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const workflow = new PermissionWorkflow({ client: fixtureClient(), store, currentBadge: "100001" });
  const repeated = (permissionTypes) => ({ ...validDraft, permissions: permissionTypes.map((permission_type) => ({
    asset: "srv-01", accounts: [{ permission_type, duration: "7天" }]
  })) });
  await assert.rejects(() => workflow.prepare(repeated(["SSH", "SSH"])), (error) => error.code === "DUPLICATE_PERMISSION");
  await assert.rejects(() => workflow.prepare(repeated(["SSH", "SSH只读"])), (error) => error.code === "MUTUALLY_EXCLUSIVE_PERMISSION");
});
