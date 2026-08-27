---
name: server-login-permission-application
description: Use when a user asks in natural language to create or submit a Zeus server login permission application, including Chinese requests such as “申请服务器登录权限”, “服务器权限提单”, or “帮某人开服务器登录权限”. Guides missing-field collection, resolves every value through live Zeus candidate APIs, prints a complete normalized ticket summary, and submits only after the exact second-confirmation phrase. Do not use for database permissions, network-device OPS permissions, permission renewal, approval actions, ticket status queries, or general permission explanations.
---

# Server Login Permission Application

Use only the five tools from the bundled `server-login-permission` MCP server. Never call Zeus with ad-hoc curl, run the legacy CLI, expose authentication material, or bypass `prepare_application` or `submit_application`.

## Establish the request

Collect a non-empty application reason of at most 255 characters and one or more resources. For each resource collect one or more applicant, permission type, and duration tuples. Do not ask for the field/system when the selected resource already provides it; default both values from that live resource candidate. Accept an explicitly supplied field/system as an optional search scope.

If the applicant is omitted, use the current user and tell the user that the applicant defaults to themselves. If multiple resources or applicants are present and their mapping is unclear, ask for the mapping; never create a Cartesian product by assumption.

## Resolve only live candidates

Use the MCP tools as follows:

- `search_users`: search by badge or name. For duplicate names, show the returned name, badge, department, and group and require a choice.
- `search_servers`: search the full live asset list by resource name or ID when no field/system was supplied. Each candidate includes its canonical field and system; once the user selects a resource, use those values as the defaults. If the user explicitly supplied a field/system, pass it to scope the search.
- `get_permission_options`: retrieve permission types and per-user durations for canonical system, resource, and user IDs.
- `prepare_application`: resolve and revalidate the complete draft, store a short-lived pending confirmation, and return the normalized summary without submitting.
- `submit_application`: perform the one allowed Zeus write after the exact second confirmation.

Do not accept any value merely because it looks plausible. It must resolve uniquely from the corresponding live response. When a tool returns `AMBIGUOUS_*`, show only its safe candidate list and ask the user to choose. When it returns `MISSING_*`, ask only for the missing information.

The `prepare_application` input shape is:

```json
{
  "field_system": "optional field or system name/id; omit to derive it from the selected asset",
  "description": "reason",
  "previous_confirmation_id": "optional prior confirmation ID when revising this same request",
  "permissions": [
    {
      "asset": "host name/id",
      "accounts": [
        {
          "applicant": "optional badge/name/id",
          "permission_type": "type name/id",
          "duration": "duration name/id"
        }
      ]
    }
  ]
}
```

All resources in one application must resolve to the same field/system. If `ASSET_SYSTEM_MISMATCH` is returned, split the resources into separate applications instead of changing or guessing their ownership metadata.

## Require a second confirmation

After `prepare_application` succeeds, print the complete returned summary, including production environment, submitter, field/system, reason, every resource, every applicant name and badge, permission type, and duration. Preserve the confirmation ID privately for the next step and say: `请核对以上信息，仅回复“确认提交”才会正式提单；如需修改，请直接说明字段。`

- Do not submit for `好`, `可以`, `是`, `确认`, or any other phrase.
- If the user changes any field, run `prepare_application` again; the previous confirmation becomes invalid.
- When rerunning `prepare_application` after a user change, pass the prior private confirmation ID as `previous_confirmation_id`. Do not pass an ID from another request.
- Only after the exact standalone phrase `确认提交`, call `submit_application` with `confirmation_id` and `confirmation_phrase`.
- Never rerun `submit_application` automatically, including after timeout or an uncertain response.

On success, report the order ID and returned detail link. On `SUBMISSION_UNCERTAIN`, state that the result is uncertain and direct the user to My Applications; do not retry. For other safe error codes, explain the corrective action without displaying raw response bodies, URLs containing query parameters, Tokens, or signing values.
