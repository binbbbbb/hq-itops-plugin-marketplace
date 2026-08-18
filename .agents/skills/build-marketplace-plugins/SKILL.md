---
name: build-marketplace-plugins
description: Build, update, validate, or prepare releases for plugins in the HQ ITOps monorepo marketplace while preserving Codex and CodeBuddy compatibility. Use when adding a plugin, changing plugin code or Skills, editing plugin manifests or catalog metadata, regenerating marketplace manifests, reviewing plugin packaging, bumping plugin versions, or preparing a marketplace release. Do not use for running an installed business plugin or changing unrelated repository infrastructure.
---

# Build Marketplace Plugins

Maintain marketplace plugins from their monorepo sources and keep the Codex and CodeBuddy packages aligned.

## Establish scope

1. Read the repository `AGENTS.md` and the target plugin's `AGENTS.md` before editing.
2. Inspect `git status --short` and preserve unrelated or pre-existing changes.
3. Identify whether the request changes plugin behavior, plugin metadata, catalog metadata, generated marketplaces, or release state.
4. Treat publishing, tagging, pushing, and external release creation as separate actions requiring explicit user authorization.

## Use the sources of truth

- Edit plugin implementation, configuration examples, tests, and Skills only under `plugins/<plugin-name>/`.
- Edit marketplace order, category, and installation policy only in `catalog/plugins.json`.
- Do not manually edit `.agents/plugins/marketplace.json` or `.codebuddy-plugin/marketplace.json`; regenerate them with `npm run generate`.
- Keep plugin directories self-contained. Do not depend on files outside the plugin directory at runtime.
- Read [references/plugin-contract.md](references/plugin-contract.md) before adding a plugin or changing manifests, Skills, or package structure.

## Implement a plugin change

1. Make the smallest coherent change in `plugins/<plugin-name>/`.
2. Keep `.codex-plugin/plugin.json` and `.codebuddy-plugin/plugin.json` aligned for name, version, description, author, repository, keywords, and local Skill source. Use Codex's string `"./skills/"`; for CodeBuddy 2.109.2, enumerate every direct Skill directory in an array such as `["./skills/<skill-name>/"]`.
3. Bump both manifest versions together for a distributable behavior or metadata change. Apply semantic versioning according to compatibility impact. Use a plain shared `MAJOR.MINOR.PATCH` version for normal repository changes and releases. Do not add platform-specific build metadata such as `+codex.<cachebuster>` to cross-platform manifests; a real distributable change must receive a normal semantic-version bump instead.
4. Update or add deterministic plugin tests when behavior changes.
5. Add a new catalog entry only when introducing a new plugin. Keep catalog names identical to directory and manifest names.
6. Run `npm run generate` after changing a version or catalog metadata.

## Protect package boundaries

- Never read, print, quote, summarize, or package `config/config.local.json`, `postman-api-key.txt`, tokens, Cookies, or generated Postman snapshots.
- Never package logs, reports, work files, backups, caches, `node_modules`, `.workbuddy`, or nested `.git` directories.
- Keep secrets in ignored local configuration or environment variables. Commit only safe examples with placeholders.
- Reuse a plugin's existing `skills/` source for both platforms; do not duplicate Skill implementations by platform.

## Validate the result

1. Run `npm run generate:check` to confirm generated marketplace manifests are current.
2. Run `npm test` from the repository root.
3. Validate every added or changed Skill with the repository-available Skill validator.
4. Run the installed target client's native plugin validator when platform schema compatibility is in question; prefer observed client behavior over a conflicting online example, and record the tested client version.
5. Inspect `git diff --check`, `git diff --stat`, and the relevant diff without exposing ignored secret files.
6. Use [references/release-checklist.md](references/release-checklist.md) when preparing a commit, tag, or CodeBuddy update.
7. Report changed files, validation results, and any unpublished version or release step clearly.

