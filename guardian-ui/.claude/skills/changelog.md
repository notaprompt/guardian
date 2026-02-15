---
name: changelog
description: Generate changelog entries for Guardian. Analyzes recent git commits and produces formatted CHANGELOG.md entries.
user_invocable: true
---

Generate changelog entries for Guardian.

## Steps

1. Read the current `CHANGELOG.md` to understand existing format and latest version
2. Run `git log --oneline` to see recent commits since the last changelog entry
3. Run `git diff` against the last tagged version (or last changelog date) to understand scope of changes
4. Categorize changes into:
   - **Added** — new features
   - **Changed** — modifications to existing features
   - **Fixed** — bug fixes
   - **Removed** — removed features or code

## Format

```markdown
## [version] - YYYY-MM-DD

### Added
- Description of new feature (root cause or motivation, not just the symptom)

### Changed
- What changed and why

### Fixed
- What was broken and what fixed it

### Removed
- What was removed and why
```

## Rules

- Keep entries concise but specific
- Include the root cause, not just the symptom
- Increment patch version for fixes, minor for features
- Append to the top of CHANGELOG.md (newest first)
- Use present tense ("Add", "Fix", not "Added", "Fixed") in entry text
- Do not include commit hashes in the changelog
