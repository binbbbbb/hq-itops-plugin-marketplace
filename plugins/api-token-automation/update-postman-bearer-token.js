const fs = require("fs");
const https = require("https");
const path = require("path");

const zeusTokenUrl =
  "https://zeusapiuat.huaqin.com/api/token?badge=100023345&sign=ZNABTyssSCFy7zMW";
const macmTokenUrl = "https://macmapiuat.huaqin.com/api/sso/token?badge=100023345";
const acmTokenUrl = "https://itacmapidev.huaqin.com/api/sso/token?badge=100023345";

const postmanApiBaseUrl = "https://api.getpostman.com";
const existingCollectionNames = ["IT Service", "Zeus", "RCM"];
const macmFolderName = "MACM";
const acmCollectionName = "ACM";
const acmExcludedFolderNames = ["vCenter"];
const requestTimeoutMs = 30000;
const maxRequestAttempts = 4;
const retryableNetworkErrorCodes = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "EPIPE",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "ENETDOWN",
  "ENETUNREACH",
  "EHOSTUNREACH",
]);

function getPostmanApiKey() {
  if (process.env.POSTMAN_API_KEY) {
    return process.env.POSTMAN_API_KEY.trim();
  }

  const keyFile = path.resolve("postman-api-key.txt");
  if (fs.existsSync(keyFile)) {
    return fs.readFileSync(keyFile, "utf8").trim();
  }

  throw new Error(
    "Postman API key not found. Set POSTMAN_API_KEY or create postman-api-key.txt in this directory.",
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function safeRequestTarget(url) {
  const requestUrl = new URL(url);
  return `${requestUrl.origin}${requestUrl.pathname}`;
}

function isRetryableRequestError(error) {
  return (
    retryableNetworkErrorCodes.has(error?.code) ||
    error?.status === 408 ||
    error?.status === 429 ||
    error?.status >= 500
  );
}

async function requestText(url, options = {}) {
  const requestUrl = new URL(url);
  return new Promise((resolve, reject) => {
    const request = https.request(
      requestUrl,
      {
        method: options.method || "GET",
        headers: options.headers || {},
      },
      (response) => {
        const chunks = [];

        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          const responseText = Buffer.concat(chunks).toString("utf8");
          const isOk = response.statusCode >= 200 && response.statusCode < 300;

          if (!isOk) {
            const error = new Error(`Request failed: HTTP ${response.statusCode}`);
            error.status = response.statusCode;
            error.body = responseText;
            reject(error);
            return;
          }

          resolve(responseText);
        });
      },
    );

    request.setTimeout(requestTimeoutMs, () => {
      const error = new Error(
        `Request timed out after ${requestTimeoutMs}ms: ${safeRequestTarget(url)}`,
      );
      error.code = "ETIMEDOUT";
      request.destroy(error);
    });

    request.on("error", reject);

    if (options.body) {
      request.write(options.body);
    }

    request.end();
  });
}

async function requestJson(url, options = {}) {
  let lastError;

  for (let attempt = 1; attempt <= maxRequestAttempts; attempt += 1) {
    try {
      const text = await requestText(url, options);
      return text ? JSON.parse(text) : {};
    } catch (error) {
      lastError = error;
      if (!isRetryableRequestError(error) || attempt === maxRequestAttempts) {
        throw error;
      }

      const delayMs = 1000 * 2 ** (attempt - 1);
      console.warn(
        `Transient request failure for ${safeRequestTarget(url)} ` +
          `(attempt ${attempt}/${maxRequestAttempts}, ${error.code || `HTTP ${error.status}`}): ` +
          `retrying in ${delayMs}ms`,
      );
      await sleep(delayMs);
    }
  }

  throw lastError;
}

function extractToken(body) {
  const token =
    (typeof body?.data === "string" && body.data) ||
    body?.data?.access_token ||
    body?.data?.token ||
    body?.access_token ||
    body?.token;

  if (!token || typeof token !== "string") {
    throw new Error("Token response did not contain a supported token field");
  }

  return token;
}

async function getAccessToken(url) {
  return extractToken(await requestJson(url, { method: "GET" }));
}

function postmanHeaders(apiKey, { includeJsonContentType = false } = {}) {
  const headers = {
    "X-Api-Key": apiKey,
  };

  if (includeJsonContentType) {
    headers["Content-Type"] = "application/json";
  }

  return headers;
}

async function listPostmanCollections(apiKey) {
  const body = await requestJson(`${postmanApiBaseUrl}/collections`, {
    headers: postmanHeaders(apiKey),
  });

  return body.collections || [];
}

function resolveCollectionUids(collections, collectionNames) {
  const uidsByName = new Map();
  for (const collection of collections) {
    if (!collectionNames.includes(collection.name)) {
      continue;
    }

    if (uidsByName.has(collection.name)) {
      throw new Error(
        `Multiple Postman collections named "${collection.name}" found. Use unique names or split the script configuration by uid.`,
      );
    }

    uidsByName.set(collection.name, collection.uid);
  }

  const missing = collectionNames.filter((name) => !uidsByName.has(name));
  if (missing.length > 0) {
    throw new Error(`Postman collections not found: ${missing.join(", ")}`);
  }

  return collectionNames.map((name) => ({
    name,
    uid: uidsByName.get(name),
  }));
}

async function getPostmanCollection(apiKey, uid) {
  const body = await requestJson(`${postmanApiBaseUrl}/collections/${uid}`, {
    headers: postmanHeaders(apiKey),
  });

  if (!body.collection) {
    throw new Error(`Postman collection response did not include collection: ${uid}`);
  }

  return body.collection;
}

async function putPostmanCollection(apiKey, uid, collection) {
  await requestJson(`${postmanApiBaseUrl}/collections/${uid}`, {
    method: "PUT",
    headers: postmanHeaders(apiKey, { includeJsonContentType: true }),
    body: JSON.stringify({ collection }),
  });
}

function hasBearerAuth(request) {
  return request?.auth?.type === "bearer";
}

function setBearerAuth(request, token) {
  if (!request.auth || request.auth.type !== "bearer") {
    request.auth = {
      type: "bearer",
      bearer: [],
    };
  }

  const bearerEntries = Array.isArray(request.auth.bearer) ? request.auth.bearer : [];
  const tokenEntry = bearerEntries.find((entry) => entry?.key === "token");

  if (tokenEntry) {
    tokenEntry.value = token;
    tokenEntry.type = tokenEntry.type || "string";
    request.auth.bearer = bearerEntries;
    return;
  }

  request.auth.bearer = [
    ...bearerEntries,
    {
      key: "token",
      value: token,
      type: "string",
    },
  ];
}

function updateItems(items, token, options = {}) {
  let updated = 0;
  const excludedFolderNames = options.excludedFolderNames || [];

  for (const item of items || []) {
    if (Array.isArray(item.item)) {
      if (excludedFolderNames.includes(item.name)) {
        continue;
      }

      updated += updateItems(item.item, token, options);
      continue;
    }

    if (item.request && (options.forceBearer || hasBearerAuth(item.request))) {
      setBearerAuth(item.request, token);
      updated += 1;
    }
  }

  return updated;
}

function updateNamedFolders(items, folderName, token) {
  let updated = 0;

  for (const item of items || []) {
    if (!Array.isArray(item.item)) {
      continue;
    }

    if (item.name === folderName) {
      updated += updateItems(item.item, token);
    } else {
      updated += updateNamedFolders(item.item, folderName, token);
    }
  }

  return updated;
}

function writeLocalSnapshot(collectionName, collection) {
  const fileName = `${collectionName}.postman_collection.json`;
  fs.writeFileSync(path.resolve(fileName), `${JSON.stringify(collection, null, 2)}\n`, "utf8");
}

async function updateWholeCollection(apiKey, target, token) {
  const collection = await getPostmanCollection(apiKey, target.uid);
  const updated = updateItems(collection.item, token);
  await putPostmanCollection(apiKey, target.uid, collection);
  writeLocalSnapshot(target.name, collection);
  return updated;
}

async function updateMacm(apiKey, collections, token) {
  const macmCollection = collections.find((collection) => collection.name === macmFolderName);
  if (macmCollection) {
    const updated = await updateWholeCollection(
      apiKey,
      { name: macmFolderName, uid: macmCollection.uid },
      token,
    );
    return { updated, details: [`${macmFolderName}: ${updated} cloud requests updated, local snapshot saved`] };
  }

  let totalUpdated = 0;
  const details = [];
  for (const collectionRef of collections) {
    const collection = await getPostmanCollection(apiKey, collectionRef.uid);
    const updated = updateNamedFolders(collection.item, macmFolderName, token);
    if (updated === 0) {
      continue;
    }

    await putPostmanCollection(apiKey, collectionRef.uid, collection);
    writeLocalSnapshot(collectionRef.name, collection);
    totalUpdated += updated;
    details.push(
      `${macmFolderName} folder in ${collectionRef.name}: ${updated} cloud requests updated, local snapshot saved`,
    );
  }

  if (totalUpdated === 0) {
    throw new Error(`Postman collection or folder not found: ${macmFolderName}`);
  }

  return { updated: totalUpdated, details };
}

async function updateAcm(apiKey, collections, token) {
  const acmCollection = collections.find((collection) => collection.name === acmCollectionName);
  if (!acmCollection) {
    throw new Error(`Postman collection not found: ${acmCollectionName}`);
  }

  const collection = await getPostmanCollection(apiKey, acmCollection.uid);
  const updated = updateItems(collection.item, token, {
    forceBearer: true,
    excludedFolderNames: acmExcludedFolderNames,
  });
  await putPostmanCollection(apiKey, acmCollection.uid, collection);
  writeLocalSnapshot(acmCollectionName, collection);

  return {
    updated,
    details: [`${acmCollectionName}: ${updated} cloud requests updated, local snapshot saved`],
  };
}

async function main() {
  const apiKey = getPostmanApiKey();
  const zeusToken = await getAccessToken(zeusTokenUrl);
  const collections = await listPostmanCollections(apiKey);
  const existingTargets = resolveCollectionUids(collections, existingCollectionNames);
  const failures = [];

  console.log(`Bearer tokens refreshed at ${new Date().toISOString()}`);

  for (const target of existingTargets) {
    try {
      const updated = await updateWholeCollection(apiKey, target, zeusToken);
      console.log(`${target.name}: ${updated} cloud requests updated, local snapshot saved`);
    } catch (error) {
      failures.push(`${target.name}: ${error.message}`);
      console.error(`${target.name}: update failed: ${error.message}`);
    }
  }

  try {
    const macmToken = await getAccessToken(macmTokenUrl);
    const macmResult = await updateMacm(apiKey, collections, macmToken);
    for (const detail of macmResult.details) {
      console.log(detail);
    }
  } catch (error) {
    failures.push(`${macmFolderName}: ${error.message}`);
    console.error(`${macmFolderName}: update failed: ${error.message}`);
  }

  try {
    const acmToken = await getAccessToken(acmTokenUrl);
    const acmResult = await updateAcm(apiKey, collections, acmToken);
    for (const detail of acmResult.details) {
      console.log(detail);
    }
  } catch (error) {
    failures.push(`${acmCollectionName}: ${error.message}`);
    console.error(`${acmCollectionName}: update failed: ${error.message}`);
  }

  if (failures.length > 0) {
    throw new Error(`Bearer token refresh completed with failures: ${failures.join("; ")}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
