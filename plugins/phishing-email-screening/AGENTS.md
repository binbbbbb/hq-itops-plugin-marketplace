# Phishing Email Screening

- Treat this directory as the only editable source for the phishing-email-screening plugin.
- Use `skills/phishing-email-screening/SKILL.md` for phishing-email metadata scans.
- Keep both platform manifests pointed at the same `skills/` source and keep their versions identical.
- Never print, quote, summarize, or commit local credentials, Cookies, logs, reports, work files, or caches.
- Treat results as metadata-based pre-screening, not definitive proof that an email is safe or malicious.
- After changing code, the Skill, or a manifest, run the plugin tests and the marketplace root `npm test`.
