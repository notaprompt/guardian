# Guardian UI — Mission Control Interface

## What This Is
Electron + React desktop app — neuroprotective cognitive infrastructure built on TRIM.
Four integrated panels: Chat, Terminal (real PTY), Notes/Docs, Search/Memory. All resizable via drag handles.

## Architecture
- **Electron main process** (`main.js`): Window management, PTY spawning via node-pty, IPC handlers
- **Preload** (`preload.js`): Secure IPC bridge between main and renderer
- **React renderer** (`src/`): Panel layout using allotment, xterm.js for terminal, Zustand for state
- **Styles**: Dark theme, brutalist-meets-MCM aesthetic. CSS variables in `src/styles/theme.css`

## Tech Stack
- Electron 33+
- React 18 + Vite
- allotment (resizable split panels)
- xterm.js + xterm-addon-fit + xterm-addon-web-links (terminal emulator)
- node-pty beta.10 (PTY spawning — native module, needs electron-rebuild, ConPTY on Windows)
- better-sqlite3 (SQLite + FTS5 full-text search)
- Zustand (state management)
- Multi-LLM providers (Claude CLI, OpenAI, Ollama local, Fireworks, Moonshot)
- ForgeFrame (intent-based model routing by tier: quick/balanced/deep)

## Key Commands
- `npm install` — Install deps
- `npm run dev` — Start Vite dev server for renderer
- `npm run electron` — Start Electron (run after dev server is up)
- `npm run build` — Production build
- `npx electron-rebuild` — Rebuild native modules (node-pty) for Electron

## Project Structure
```
guardian-ui/
├── CLAUDE.md              # This file
├── main.js                # Electron main process — PTY, IPC, LLM routing
├── preload.js             # Secure IPC bridge
├── index.html
├── package.json
├── vite.config.js
├── lib/
│   ├── database.js        # SQLite/FTS5 memory storage
│   ├── providers.js       # Multi-LLM provider dispatch
│   ├── forgeframe.js      # Intent-based model router
│   ├── secure-store.js    # Encrypted API key storage
│   ├── embeddings.js      # Semantic embeddings pipeline
│   ├── knowledge-graph.js # Knowledge graph engine
│   ├── librarian.js       # Memory librarian (entity extraction)
│   ├── awareness.js       # Drift / awareness detection
│   ├── reframe-detector.js
│   ├── identity-dimensions.js
│   ├── summarizer.js      # Conversation summarization
│   ├── compression.js     # Hierarchical memory compression
│   ├── backup.js          # Automated backup system
│   ├── importer.js        # Memory import pipeline
│   ├── import-parser.js   # ChatGPT/Claude export parsers
│   └── import-worker.js   # Async background import processing
├── src/
│   ├── App.jsx            # Root — panel layout orchestrator
│   ├── store.js           # Zustand global state
│   ├── panels/
│   │   ├── TerminalPanel.jsx   # xterm.js real terminal
│   │   ├── ChatPanel.jsx       # AI conversation
│   │   ├── NotesPanel.jsx      # Markdown notes/docs
│   │   └── SearchPanel.jsx     # Memory/search panel
│   ├── components/             # 19 components (see src/components/)
│   └── styles/                 # 10 stylesheets (see src/styles/)
├── .claude/
│   ├── agents/guardian-architect.md
│   ├── commands/               # /add-panel, /add-ipc
│   └── skills/                 # /deploy, /test-providers, /audit, /changelog
```

## Conventions
- Use functional React components with hooks
- CSS Modules or plain CSS with BEM-style naming — no Tailwind in Electron
- All IPC channels prefixed with `guardian:` (e.g., `guardian:pty:create`)
- State flows: Main process → IPC → Zustand store → React components
- Panel components are self-contained; each manages its own local state
- Keep Electron main process logic in main.js; extract to modules as it grows

## Extension Points
- **Adding a new panel**: Create `src/panels/NewPanel.jsx`, add to `App.jsx` Allotment layout, add state slice in `store.js`
- **Adding MCP integration**: Wire through IPC from main process, expose via preload
- **Adding a provider**: Register in `lib/providers.js`, add to DB via Settings, ForgeFrame auto-routes by tier
- **Memory import**: Use `lib/import-parser.js` for new conversation export formats

## Known Constraints
- node-pty is a native module — must run `npx electron-rebuild` after install
- xterm.js FitAddon needs explicit `.fit()` calls on panel resize
- Allotment `onChange` fires on every pixel of drag — debounce expensive operations
