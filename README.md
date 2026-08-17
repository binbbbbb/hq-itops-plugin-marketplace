# HQ ITOps Plugin Marketplace

Monorepo marketplace for Codex and CodeBuddy. Each directory under `plugins/` is the only editable source for that plugin, including its business logic, Skill, tests, and both platform manifests.

## Layout

- `.agents/plugins/marketplace.json`: Codex marketplace catalog.
- `.codebuddy-plugin/marketplace.json`: CodeBuddy marketplace catalog.
- `plugins/phishing-email-screening`: Coremail metadata phishing-email screening plugin.
- `plugins/api-token-automation`: Fixed Postman Bearer-token refresh plugin.
- `catalog/plugins.json`: Plugin order, marketplace policy, and category.
- `scripts/generate-marketplaces.mjs`: Generates both marketplace manifests from the catalog and plugin manifests.

Each plugin contains both platform manifests and uses one shared `skills/` source. Edit plugin code only under its own `plugins/<plugin-name>` directory.

## Development workflow

After changing plugin code, a Skill, a platform manifest, or catalog metadata:

```powershell
npm run generate
npm test
```

Keep the versions in `.codex-plugin/plugin.json` and `.codebuddy-plugin/plugin.json` identical. The generator copies the version and description into the CodeBuddy marketplace and maintains Codex local plugin sources.

## CodeBuddy releases

For any change that CodeBuddy users must receive, increment the changed plugin's semantic version in both platform manifests, run `npm run generate`, run `npm test`, and publish a new repository tag. Add or refresh the tagged repository ZIP as the CodeBuddy marketplace; update or reinstall the plugin if the client retains an older cached version.

Prefer immutable tag archives over the moving `main` branch, for example:

```text
https://github.com/<owner>/hq-itops-plugin-marketplace/archive/refs/tags/v1.1.0.zip
```

## Local configuration

Secrets and runtime outputs are intentionally excluded. Configure each plugin locally after installation:

- `phishing-email-screening`: create `config/config.local.json` locally.
- `api-token-automation`: set `POSTMAN_API_KEY` in the environment, or create `postman-api-key.txt` locally in the plugin root.
