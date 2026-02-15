# Guardian Changelog

## [0.1.1] - 2026-02-14

### Fixed
- **Chat input hidden** — `.zone-body` missing flex column layout, input area and attach button pushed off-screen
- **"Claude Code cannot be launched inside another Claude Code session"** — `CLAUDECODE` env var leaking into subprocess environment
- **Auto-updater crash in dev mode** — `electron-updater` calling `app.getVersion()` at import time; wrapped in try/catch
- **Silent Electron exit** — `loadURL` for Vite dev server had no error handling; added retry loop (10s, 20 attempts)
- **ENAMETOOLONG on file attachments** — 44kb+ docx text embedded in CLI `-p` argument exceeded OS limit; prompt now piped via stdin
- **External models not in picker** — `forgeframe.loadProviderModels()` never called at startup; model list used hardcoded `MODELS` instead of `getModels()`

### Added
- **Fireworks AI provider** — registered in DB with OpenAI-compatible dispatch; Kimi K2.5 available as balanced-tier model
- **Ollama provider** — local inference support; Qwen 2.5 3B registered as quick-tier model
- **Provider dispatch in chat** — non-CLI providers now route through HTTP API instead of always spawning Claude CLI
- **Fireworks AI** added to API Keys settings UI
- **Store syncs models from backend** — `fetchModelSettings` pulls full model list including DB-registered providers
