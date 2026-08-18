# Plugin contract

## Repository layout

```text
plugins/<plugin-name>/
|-- .codex-plugin/plugin.json
|-- .codebuddy-plugin/plugin.json
|-- skills/
|   `-- <skill-name>/SKILL.md
|-- AGENTS.md
|-- README.md
`-- plugin-specific runtime files and tests
```

The plugin directory is the editable and distributable unit. Keep every runtime dependency needed by the plugin inside this directory unless it is an explicitly declared external service or environment dependency.

## Shared manifest requirements

Keep these values equivalent across both manifests:

- `name`: match `plugins/<plugin-name>` and the catalog entry.
- `version`: use identical strict semantic versions.
- `description`, `author`, `repository`, and `keywords`: describe the same package.
- `skills`: point to the same local Skill implementations but preserve each platform's schema. Use the string `"./skills/"` for Codex. For CodeBuddy 2.109.2, use an array enumerating every direct Skill directory, for example `["./skills/example-skill/"]`.

Codex-only interface metadata belongs in `.codex-plugin/plugin.json`. Do not invent CodeBuddy-only copies of shared Skills.

Keep CodeBuddy Skills in the standard `skills/<skill-name>/SKILL.md` layout. Each CodeBuddy array entry must directly contain `SKILL.md`. Do not use `["./skills/"]`: CodeBuddy 2.109.2 accepts that type but registers a false Skill named `skills`, leaving the real nested Skills undiscovered.

Do not infer cross-platform field types from similar names. If hosted documentation and the installed target client disagree, run the target client's native validator, inspect its non-secret cache output when necessary, and encode the verified behavior in repository validation. Revisit this compatibility rule when upgrading the supported CodeBuddy client.

## Catalog contract

Use `catalog/plugins.json` only for marketplace-level metadata:

- stable plugin ordering;
- category;
- installation policy;
- authentication policy.

Generate both marketplace manifests from the catalog and local plugin manifests. Never use generated marketplace files as editable metadata sources.

## Version decisions

- Patch: compatible fixes, instruction corrections, safe metadata changes, or internal behavior adjustments.
- Minor: backward-compatible new behavior or capability.
- Major: incompatible configuration, invocation, output, or dependency changes.

Use a plain `MAJOR.MINOR.PATCH` version for normal marketplace changes and releases. Do not add platform-specific build metadata such as `+codex.<cachebuster>` to either manifest: these plugins are shared by Codex and CodeBuddy, and the same version is user-facing on both platforms. When content changes must be distributed, bump the appropriate semantic version instead of using a cachebuster.

Do not bump unrelated plugin versions. Keep both manifests on the same plain version in the same change.

## New plugin minimum

Add all of the following:

1. A self-contained `plugins/<plugin-name>/` directory.
2. Codex and CodeBuddy manifests.
3. At least one valid Skill under `skills/`.
4. Plugin-specific `AGENTS.md` and concise user-facing documentation.
5. Safe configuration examples and ignore rules when local credentials are needed.
6. Deterministic validation or tests appropriate to the plugin.
7. One matching entry in `catalog/plugins.json`.
