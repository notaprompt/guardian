# Guardian UI

Mission control interface wrapping Claude Code CLI into a resizable multi-panel desktop app.

```
┌─────────────────────────────────────────────────────┐
│                    ◈ GUARDIAN                        │
├──────────────────────────┬──────────────────────────┤
│                          │                          │
│   Terminal / Claude Code │      Notes / Docs        │
│   (real PTY via xterm.js)│      (markdown editor)   │
│                          │                          │
├──────────────────────────┼──────────────────────────┤
│                          │                          │
│   Chat                   │   Memory / Search        │
│   (AI conversation)      │   (FAISS / file search)  │
│                          │                          │
└──────────────────────────┴──────────────────────────┘
```

All panels are resizable by dragging dividers. Terminal panel can toggle between raw shell and Claude Code CLI.

## Quick Start

```bash
# Prerequisites: Node.js 20+, Claude Code CLI installed

# Install dependencies
npm install

# Rebuild native modules for Electron
npx electron-rebuild -f -w node-pty

# Start (launches Vite dev server + Electron)
npm start
```

If `npm start` doesn't work, run the two processes separately:
```bash
# Terminal 1: Start Vite dev server
npm run dev

# Terminal 2: Start Electron (after Vite is running)
npm run electron
```

## Architecture

- **Electron main process** (`main.js`) — PTY management, IPC handlers, window lifecycle
- **Preload bridge** (`preload.js`) — Secure channel between main and renderer
- **React renderer** (`src/`) — Panel layout via allotment, state via Zustand
- **Terminal** — xterm.js connected to real PTY sessions via node-pty

## Extending

### Add a new panel
```bash
# In Claude Code:
/add-panel FileExplorer
```

### Add a new IPC channel
```bash
/add-ipc memory:search - semantic search via FAISS sidecar
```

### Connect ForgeFrame / FAISS
The Memory/Search panel has placeholder search logic. To connect real semantic search:

1. Add a FastAPI sidecar spawn in `main.js` (on app startup)
2. Add IPC handler `guardian:memory:search` that POSTs to the sidecar
3. Wire `SearchPanel.jsx` to call the IPC channel instead of the placeholder

### Architecture review
```bash
# In Claude Code, use the custom subagent:
"Use the guardian-architect agent to review the current IPC security model"
```

## Stack

| Layer | Tech |
|-------|------|
| Shell | Electron 33 |
| UI | React 18 + Vite |
| Panels | allotment |
| Terminal | xterm.js + node-pty |
| State | Zustand |
| Theme | Custom CSS (dark, brutalist-MCM) |

## Project Structure

```
guardian-ui/
├── main.js              # Electron main process
├── preload.js           # IPC bridge
├── CLAUDE.md            # Claude Code project memory
├── src/
│   ├── App.jsx          # Panel layout orchestrator
│   ├── store.js         # Zustand state
│   ├── panels/          # Self-contained panel components
│   ├── components/      # Shared UI components
│   └── styles/          # Theme + panel CSS
└── .claude/
    ├── commands/        # Slash commands
    ├── agents/          # Custom subagents
    └── skills/          # Auto-discovered skills
```

## Roadmap

- [ ] CodeMirror 6 for Notes panel (markdown highlighting, vim mode)
- [ ] FAISS sidecar for semantic memory search
- [ ] ForgeFrame model router integration
- [ ] Multiple terminal tabs
- [ ] Session persistence (auto-save notes, chat history)
- [ ] MCP server management panel
- [ ] Archetype profile injection into Claude sessions
- [ ] Tab/panel drag-and-drop reordering
