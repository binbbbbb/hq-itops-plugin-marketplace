---
name: server-login-permission-application
description: Use when a user asks in natural language to create or submit a Zeus server login permission application, including Chinese requests such as “申请服务器登录权限”, “服务器权限提单”, or “帮某人开服务器登录权限”. Guides missing-field collection, resolves every value through live Zeus candidate APIs, prints a complete normalized ticket summary, and submits only after the exact second-confirmation phrase. Do not use for database permissions, network-device OPS permissions, permission renewal, approval actions, ticket status queries, or general permission explanations.
---

# Server Login Permission Application

Use the bundled deterministic CLI from the plugin root two levels above this Skill directory. Never call Zeus with ad-hoc curl, expose authentication material, or bypass `prepare` or `submit`.

## Establish the request

Collect the field/system, a non-empty application reason of at most 255 characters, and one or more resources. For each resource collect one or more applicant, permission type, and duration tuples.

If the applicant is omitted, use the current user and tell the user that the applicant defaults to themselves. If multiple resources or applicants are present and their mapping is unclear, ask for the mapping; never create a Cartesian product by assumption.

## Resolve only live candidates

Run `node scripts/runtime-cli.js <command>` from the plugin root and pass JSON on stdin.

- `systems`: list field/system candidates.
- `users`: search by badge or name. For duplicate names, show the returned name, badge, department, and group and require a choice.
- `assets`: search resources within the selected system.
- `options`: retrieve permission types and per-user durations for a system/resource/applicant tuple.
- `prepare`: resolve and revalidate the complete draft, store a short-lived pending confirmation, and return the normalized summary.

Do not accept any value merely because it looks plausible. It must resolve uniquely from the corresponding live response. When the CLI returns `AMBIGUOUS_*`, show only its safe candidate list and ask the user to choose. When it returns `MISSING_*`, ask only for the missing information.

The `prepare` input shape is:

```json
{
  "field_system": "field or system name/id",
  "description": "reason",
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

## Require a second confirmation

After `prepare` succeeds, print the complete returned summary, including production environment, submitter, field/system, reason, every resource, every applicant name and badge, permission type, and duration. Preserve the confirmation ID privately for the next step and say: `请核对以上信息，仅回复“确认提交”才会正式提单；如需修改，请直接说明字段。`

- Do not submit for `好`, `可以`, `是`, `确认`, or any other phrase.
- If the user changes any field, run `prepare` again; the previous confirmation becomes invalid.
- Only after the exact standalone phrase `确认提交`, run `submit` with JSON containing `confirmation_id` and `confirmation_phrase`.
- Never rerun `submit` automatically, including after timeout or an uncertain response.

On success, report the order ID and returned detail link. On `SUBMISSION_UNCERTAIN`, state that the result is uncertain and direct the user to My Applications; do not retry. For other safe error codes, explain the corrective action without displaying raw response bodies, URLs containing query parameters, Tokens, or signing values.

