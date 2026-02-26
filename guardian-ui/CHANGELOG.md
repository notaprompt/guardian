# Guardian Changelog

## [0.2.0] - 2026-02-26

### Added
- **Sovereign Layer** -- three-tier data sensitivity (surface/deep/sovereign) on notes, queue items, compression levels, and reframe events
- **Context gating** -- deep and sovereign notes/queue items excluded from LLM prompt injection; surface-only data reaches the model
- **Sovereign IPC** -- `setSensitivity` and `getSensitivity` handlers with table whitelist and enum validation
- **Export gating** -- sovereign notes blocked from single-note export; filtered from all-notes and full-data exports
- **Notes sensitivity toggle** -- cycle button in editor toolbar (surface > deep > sovereign); amber left border on list items for non-surface notes
- **Queue sensitivity toggle** -- cycle button per queue item with D/S indicator; amber left border treatment
- **Ollama client** (`lib/ollama.js`) -- minimal fetch wrapper for local Ollama: `isAvailable()`, `embed()`, `generate()` using native Node 20 fetch
- **Semantic search (Meaning mode)** -- embed query via nomic-embed-text, cosine similarity against stored Float32Array embeddings, ranked results with similarity percentage
- **Batch embedding (Embed All)** -- async pipeline over reflection messages with progress reporting, resumable (skips already-embedded), stores as Float32Array BLOBs
- **Inquiry mode (RAG)** -- retrieves top-5 context via semantic search (FTS fallback), builds numbered-excerpt prompt, generates analysis via Ollama, returns answer + source citations
- **Embed All button** in Reflections toolbar with live progress bar
- **Inquiry result UI** -- answer block with collapsible source citations clickable to conversation view
- **Meaning result UI** -- similarity percentage badge on search results

### Changed
- Reflections IPC handlers (`semantic`, `embed`, `analyze`) now async to support Ollama calls
- `searchReflections` store action routes all three modes (words/meaning/inquiry) instead of stubbing meaning and inquiry
- `exportFullDataAsJSON` accepts optional `excludeSovereign` flag
- Removed "available on local hardware" stub notices from Reflections mode buttons

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
