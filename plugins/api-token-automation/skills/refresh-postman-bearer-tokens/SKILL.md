---
name: refresh-postman-bearer-tokens
description: >-
  Refresh Bearer tokens in the fixed Postman automation targets by running the bundled deterministic update script for IT Service, Zeus, RCM, the MACM folder, and ACM excluding vCenter. Use implicitly only when the user explicitly asks to update, refresh, replace, or rotate these Postman or API Bearer tokens, including Chinese requests such as “更新 Postman Token”, “刷新接口 Token”, or “替换过期的 Bearer Token” when the fixed Postman context is clear. Do not use for token explanations, status-only checks, displaying tokens, user-supplied token values, unrelated systems, or requests to update only a subset of the fixed targets.
---

# Refresh Postman Bearer Tokens

Run the bundled deterministic workflow from the plugin root two levels above this Skill directory.

## Preserve the fixed boundary

- Run only `update-postman-bearer-token.js` from this plugin.
- Preserve the fixed token sources and Postman targets: IT Service, Zeus, RCM, the MACM folder, and ACM excluding vCenter.
- Do not accept a token value, endpoint, collection list, folder list, API key, or credential from chat.
- Do not read, display, summarize, or copy `postman-api-key.txt`, token endpoints, response tokens, token values, or generated Postman snapshots.
- If the user asks to update only a subset or change the scope, state that the script updates the complete fixed scope and obtain confirmation for that complete scope before executing.
- Loading this Skill implicitly does not authorize execution. Execute only when the user explicitly asks to update, refresh, replace, or rotate the fixed tokens.

## Run the fixed workflow

1. Resolve the plugin root two levels above this Skill directory. Do not depend on a user-specific absolute path.
2. Verify that `update-postman-bearer-token.js` exists and that either `POSTMAN_API_KEY` is set or `postman-api-key.txt` exists. Check existence only; never read or display the credential.
3. Run `node --check update-postman-bearer-token.js` from the plugin root.
4. Record only the existence and last-write times of expected local Postman snapshots. Do not read their contents.
5. Run `node update-postman-bearer-token.js` once from the plugin root. Do not retry automatically because it performs external writes.
6. Verify that the process exits successfully, every fixed target reports completion, and expected snapshot timestamps were updated. Do not treat local timestamp checks as proof that downstream APIs accept the new tokens.
7. Report the fixed targets updated, target-level failures, and the verification limitation. Never include token values or credential-file contents.

## Handle failures

- Stop on a failed preflight without running the update.
- If the script partially succeeds, report successful and failed targets separately and do not rerun automatically.
- If Postman authentication fails, ask the user to repair the API key locally; never request it in chat.
- If a token source fails, identify only the affected logical target and safe error category; do not expose the request URL, query parameters, response body, or secret material.
- Never modify or delete existing local snapshots as part of failure handling.
