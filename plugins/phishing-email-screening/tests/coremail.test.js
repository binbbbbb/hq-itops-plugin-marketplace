import test from "node:test";
import assert from "node:assert/strict";
import { buildSearchUrl, fetchAllMail, parseCookie, parseSearchResponse } from "../src/coremail.js";
import { AuthExpiredError } from "../src/errors.js";
import { normalizeRecord } from "../src/normalize.js";

const cookie = "JSESSIONID=test; Coremail=abc; Coremail.sid=SAFE_TEST_SID";

test("Cookie 解析和 URL 派生不依赖硬编码 sid", () => {
  assert.equal(parseCookie(cookie).sid, "SAFE_TEST_SID");
  const url = buildSearchUrl({
    baseUrl: "https://157.255.37.89",
    cookie,
    begin: "2026-08-01",
    end: "2026-08-05",
  });
  assert.match(url.pathname, /SAFE_TEST_SID/);
  assert.equal(url.searchParams.get("beginDate"), "2026-08-01");
  assert.equal(url.searchParams.get("endDate"), "2026-08-05");
});

test("分页抓取按 mid 去重并推进 startIndex", async () => {
  const starts = [];
  const pages = [
    { totalRecords: 4, records: [{ mid: "1" }, { mid: "2" }] },
    { totalRecords: 4, records: [{ mid: "2" }, { mid: "3" }] },
  ];
  const result = await fetchAllMail({
    config: { baseUrl: "https://157.255.37.89", cookie, pageSize: 2 },
    begin: "2026-08-01",
    end: "2026-08-01",
    requestPage: async ({ startIndex }) => {
      starts.push(startIndex);
      return pages.shift();
    },
  });
  assert.deepEqual(starts, [0, 2]);
  assert.deepEqual(result.records.map((item) => item.mid), ["1", "2", "3"]);
});

test("标准化兼容异常 [t 字段", () => {
  const record = normalizeRecord({
    "[t": "2026-08-05 08:45:06",
    mid: "m1",
    from: " User@Example.com ",
    to: "a@example.com",
  });
  assert.equal(record.receivedAt, "2026-08-05 08:45:06");
  assert.equal(record.sender, "user@example.com");
});

test("401、403、重定向、HTML、非法 JSON 和缺失结构均识别为鉴权失效", () => {
  for (const status of [302, 401, 403]) {
    assert.throws(() => parseSearchResponse({ status, body: "" }), AuthExpiredError);
  }
  assert.throws(
    () => parseSearchResponse({ status: 200, contentType: "text/html", body: "<html>login</html>" }),
    AuthExpiredError,
  );
  assert.throws(() => parseSearchResponse({ status: 200, body: "not-json" }), AuthExpiredError);
  assert.throws(() => parseSearchResponse({ status: 200, body: "{}" }), AuthExpiredError);
  assert.deepEqual(
    parseSearchResponse({ status: 200, contentType: "application/json", body: '{"totalRecords":0,"records":[]}' }),
    { totalRecords: 0, records: [] },
  );
});
