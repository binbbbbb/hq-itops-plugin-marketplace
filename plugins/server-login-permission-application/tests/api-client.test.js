import assert from "node:assert/strict";
import test from "node:test";
import { ZeusClient } from "../src/api-client.js";

function response(body, ok = true) {
  return { ok, async json() { return body; } };
}

test("client exchanges an in-memory token and sends canonical POST once", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), options });
    if (String(url).includes("/api/token")) return response({ code: 100000, data: { access_token: "test-token" } });
    return response({ code: 100000, data: 42 });
  };
  const client = new ZeusClient({ apiBase: "https://zeusapi.huaqin.com", tokenSign: "test-sign", badge: "100001", fetchImpl });
  const payload = { field_id: 1, system_id: 2, description: "reason", submit_type: 2, permissions: [] };
  assert.equal(await client.submit(payload), 42);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].options.method, "POST");
  assert.deepEqual(JSON.parse(calls[1].options.body), payload);
  assert.equal(calls[1].options.headers.Authorization, "Bearer test-token");
});

test("submission network failures are uncertain and are never retried", async () => {
  let calls = 0;
  const fetchImpl = async (url) => {
    calls += 1;
    if (String(url).includes("/api/token")) return response({ code: 100000, data: { access_token: "test-token" } });
    throw new Error("network test-sign test-token");
  };
  const client = new ZeusClient({ apiBase: "https://zeusapi.huaqin.com", tokenSign: "test-sign", badge: "100001", fetchImpl });
  await assert.rejects(() => client.submit({}), (error) => {
    assert.equal(error.code, "SUBMISSION_UNCERTAIN");
    assert.doesNotMatch(error.message, /test-sign|test-token/);
    return true;
  });
  assert.equal(calls, 2);
});

test("asset pagination supports legacy object responses", async () => {
  const fetchImpl = async (url) => {
    if (String(url).includes("/api/token")) return response({ code: 100000, data: { access_token: "test-token" } });
    const page = Number(new URL(url).searchParams.get("page"));
    return response({ code: 100000, data: { total: 3, ops_asset_list: page === 1 ? [
      { id: 1, host_name: "a" }, { id: 2, host_name: "b" }
    ] : [{ id: 3, host_name: "c" }] } });
  };
  const client = new ZeusClient({ apiBase: "https://zeusapi.huaqin.com", tokenSign: "test-sign", badge: "100001", fetchImpl });
  const result = await client.listAssets({ systemId: 2, pageSize: 2 });
  assert.deepEqual(result.items.map((item) => item.host_name), ["a", "b", "c"]);
  assert.equal(result.truncated, false);
});

test("global asset search omits system_id and preserves asset field/system metadata", async () => {
  let assetUrl;
  const fetchImpl = async (url) => {
    if (String(url).includes("/api/token")) return response({ code: 100000, data: { access_token: "test-token" } });
    assetUrl = new URL(url);
    return response({ code: 100000, data: [{
      id: 913,
      host_name: "srv-01",
      field_id: 57,
      field_name: "物流领域",
      system_id: 10,
      system_name: "物流管理系统"
    }] });
  };
  const client = new ZeusClient({ apiBase: "https://zeusapi.huaqin.com", tokenSign: "test-sign", badge: "100001", fetchImpl });
  const result = await client.listAssets({ keyword: "srv-01" });
  assert.equal(assetUrl.searchParams.has("system_id"), false);
  assert.deepEqual(result.items[0], {
    id: 913,
    host_name: "srv-01",
    ops_resource_name: "",
    system_id: 10,
    system_name: "物流管理系统",
    field_id: 57,
    field_name: "物流领域"
  });
});
