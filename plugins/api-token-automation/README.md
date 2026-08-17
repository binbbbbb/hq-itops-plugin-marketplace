# API Token Automation

This directory is the only editable source for the dual-platform API Token Automation plugin. Codex and CodeBuddy use the same `skills/` source and runtime script.

The workflow refreshes Bearer tokens for the fixed Postman automation targets. Set `POSTMAN_API_KEY` in the environment, or create an untracked `postman-api-key.txt` locally before running it. Never commit credentials, generated Postman snapshots, backups, logs, reports, or work files.

```powershell
npm run update
npm run check
```

For a user-facing release, increment the version in both plugin manifests, then run `npm run generate` and `npm test` from the marketplace root. CodeBuddy installs the plugin through the root `.codebuddy-plugin/marketplace.json`.
