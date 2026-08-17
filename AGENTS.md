# HQ ITOps Plugin Marketplace

- Keep the Codex marketplace at `.agents/plugins/marketplace.json` and the CodeBuddy marketplace at `.codebuddy-plugin/marketplace.json`.
- Treat every directory under `plugins/<plugin-name>` as the editable source of truth for that plugin.
- Treat `catalog/plugins.json` as the editable source for marketplace order, policy, and category.
- Keep every plugin self-contained under `plugins/<plugin-name>`.
- Every plugin must provide both `.codex-plugin/plugin.json` and `.codebuddy-plugin/plugin.json`, pointing at the same local `skills/` source.
- Keep the version in both plugin manifests identical. After changing a version or catalog metadata, run `npm run generate` instead of editing marketplace manifests by hand.
- Never commit, print, quote, or summarize `config/config.local.json`, `postman-api-key.txt`, tokens, Cookies, or generated Postman snapshots.
- Do not copy logs, reports, work files, backups, caches, or nested `.git` directories into plugins.
- After changing a plugin or catalog metadata, run `npm test`, validate each Skill, and validate both plugin formats and both marketplace manifests.
