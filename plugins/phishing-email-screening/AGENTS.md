# Phishing Email Screening

- Use the project skill at `skills/phishing-email-screening/SKILL.md` for phishing-email metadata scans.
- Treat `skills/phishing-email-screening` as the only editable Skill source.
- Keep the Codex plugin manifest at `.codex-plugin/plugin.json` pointed at `./skills/`.
- Keep the CodeBuddy plugin and marketplace manifests under `.codebuddy-plugin/` pointed at the same `./skills/` source.
- Do not add plugin manifests for other agent platforms unless the user explicitly requests them.
- Never edit installed copies under `$CODEX_HOME/skills`.
- After changing the Skill source or a plugin manifest, validate the Skill and both the Codex and CodeBuddy plugins before completion.
- Never print, quote, summarize, or commit `coremail.cookie` or `notion.token` from `config/config.local.json`.
- Ask the user to update secrets locally; never ask them to paste credentials into chat.
- Treat results as metadata-based pre-screening, not definitive proof that an email is safe or malicious.
