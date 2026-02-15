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
- node-pty (PTY spawning — native module, needs electron-rebuild)
- Zustand (state management)
- CodeMirror 6 (notes editor — future)

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
├── main.js                # Electron main process
├── preload.js             # IPC bridge
├── index.html             # Electron entry HTML
├── package.json
├── vite.config.js
├── src/
│   ├── App.jsx            # Root — panel layout orchestrator
│   ├── store.js           # Zustand global state
│   ├── panels/
│   │   ├── TerminalPanel.jsx   # xterm.js real terminal
│   │   ├── ChatPanel.jsx       # Chat with Claude
│   │   ├── NotesPanel.jsx      # Markdown notes/docs
│   │   └── SearchPanel.jsx     # Memory/search panel
│   ├── components/
│   │   └── PanelHeader.jsx     # Reusable panel title bar
│   └── styles/
│       ├── theme.css           # CSS variables, dark theme
│       ├── panels.css          # Panel-specific styles
│       └── terminal.css        # xterm overrides
├── .claude/
│   ├── commands/               # Slash commands for this project
│   ├── skills/                 # Project skills
│   └── agents/                 # Custom subagents
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
- **Adding FAISS memory**: Create a FastAPI sidecar process spawned from main.js, connect via localhost HTTP
- **Adding ForgeFrame router**: IPC channel to main process which manages model selection and routing

## Known Constraints
- node-pty is a native module — must run `npx electron-rebuild` after install
- xterm.js FitAddon needs explicit `.fit()` calls on panel resize
- Allotment `onChange` fires on every pixel of drag — debounce expensive operations
