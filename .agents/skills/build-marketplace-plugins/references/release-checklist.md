# Release checklist

## Before committing

- Confirm only intended files changed with `git status --short`.
- Confirm both plugin manifests have the same plain `MAJOR.MINOR.PATCH` version and shared metadata, without platform-specific cachebuster metadata.
- Run `npm run generate` after version or catalog changes.
- Run `npm run generate:check` and `npm test`.
- Validate every added or changed Skill.
- Run `git diff --check` and inspect the relevant diff.
- Confirm no local credentials, snapshots, logs, caches, backups, or nested repositories are included.

## Publishing boundary

Do not commit, push, create tags, or publish releases unless the user explicitly requests those actions. When authorized, stage only the reviewed paths rather than all workspace changes.

## CodeBuddy update

1. Commit the plugin source, both synchronized manifests, catalog change when applicable, and both regenerated marketplace manifests.
2. Push the authorized branch and create the authorized immutable release tag.
3. Configure CodeBuddy to use the tagged repository archive or other immutable marketplace source.
4. Refresh the marketplace in CodeBuddy. If it retains the previous package, uninstall and reinstall the changed plugin.
5. Reconfigure ignored local runtime credentials after installation when the plugin requires them.

Do not publish a new archive under an existing tag. Create a new semantic version and tag so clients can distinguish the package and avoid stale caches.
