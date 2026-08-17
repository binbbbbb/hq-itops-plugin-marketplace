# HQ ITOps Plugin Marketplace

Dual-platform marketplace for Codex and CodeBuddy.

## Layout

- `.agents/plugins/marketplace.json`: Codex marketplace catalog.
- `.codebuddy-plugin/marketplace.json`: CodeBuddy marketplace catalog.
- `plugins/phishing-email-screening`: Coremail metadata phishing-email screening plugin.
- `plugins/api-token-automation`: Fixed Postman Bearer-token refresh plugin.

Each plugin contains both platform manifests and uses one shared `skills/` source.

## Local configuration

Secrets and runtime outputs are intentionally excluded. Configure each plugin locally after installation:

- `phishing-email-screening`: create `config/config.local.json` locally.
- `api-token-automation`: set `POSTMAN_API_KEY` in the environment, or create `postman-api-key.txt` locally in the plugin root.
