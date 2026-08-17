# API Token Automation

- Treat this directory as the only editable source for the api-token-automation plugin.
- Keep both platform manifests pointed at the same `skills/` source and keep their versions identical.
- Never read, print, quote, summarize, or commit `postman-api-key.txt`, Bearer tokens, generated Postman snapshots, backups, logs, reports, or work files.
- After changing the script, Skill, or a manifest, run `npm run check` in this directory and the marketplace root `npm test`.
