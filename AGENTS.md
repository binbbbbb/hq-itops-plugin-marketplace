# HQ ITOps Plugin Marketplace

- Keep the Codex marketplace at `.agents/plugins/marketplace.json` and the CodeBuddy marketplace at `.codebuddy-plugin/marketplace.json`.
- Keep every plugin self-contained under `plugins/<plugin-name>`.
- Every plugin must provide both `.codex-plugin/plugin.json` and `.codebuddy-plugin/plugin.json`, pointing at the same local `skills/` source.
- Never commit, print, quote, or summarize `config/config.local.json`, `postman-api-key.txt`, tokens, Cookies, or generated Postman snapshots.
- Do not copy logs, reports, work files, backups, caches, or nested `.git` directories into plugins.
- After changing a Skill or manifest, validate the Skill, both plugin formats, and both marketplace manifests.
