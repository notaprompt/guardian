# Guardian

**External cognitive infrastructure for minds that don't turn off.**

---

## What it is

Guardian is a persistent memory layer that learns how you think, helps you navigate complexity, and remembers what matters. Not a note-taking app. Not a chatbot. Infrastructure.

It's for people who have 47 browser tabs open, three unfinished thoughts in different tools, and the nagging sense that they've solved this problem before but can't remember where.

---

## What it does

**Persistent memory.** Your conversations don't disappear. They accumulate into a living knowledge base that gets smarter the more you use it.

**Semantic navigation.** Find what you need by what it *means*, not what you called it three months ago.

**Reflections.** Import your Claude and ChatGPT conversation history. Search by words, meaning, or open-ended inquiry. Your past thinking becomes navigable infrastructure.

**Context preservation.** Jump between projects without losing your train of thought. Guardian holds the threads.

**Integration queue.** When information conflicts, Guardian doesn't overwrite. It asks. You decide. You stay sovereign.

---

## Getting started

### Prerequisites

- Node.js 20+
- Claude Code CLI installed (for terminal integration)

### Install and run

```bash
npm install
npx electron-rebuild -f -w node-pty
npm start
```

If `npm start` doesn't work, run the two processes separately:

```bash
# Terminal 1: Vite dev server
npm run dev

# Terminal 2: Electron (after Vite is running)
npm run electron
```

### Production build

```bash
npm run build
```

---

## Stack

| Layer | Tech |
|-------|------|
| Shell | Electron 33 |
| UI | React 18 + Vite |
| State | Zustand |
| Database | SQLite + FTS5 full-text search (better-sqlite3) |
| Terminal | xterm.js + node-pty (real PTY) |
| LLMs | Multi-provider (Claude, OpenAI, Ollama, Fireworks, Moonshot) |
| Routing | ForgeFrame — intent-based model selection by tier |
| Theme | Custom CSS (dark, brutalist-MCM) |

---

## Architecture

<!-- TODO: Add architecture diagram (Mermaid or PNG) showing the data flow:
     Renderer (React/Zustand) <-> Preload IPC bridge <-> Main process <-> lib/ modules <-> SQLite
     Include: PTY lifecycle, LLM routing through ForgeFrame, post-chat pipeline
     (awareness -> summarize -> embeddings -> graph -> librarian), and reflections import path. -->

- **Electron main process** (`main.js`) — PTY management, IPC handlers, window lifecycle, LLM routing, sequential post-chat pipeline
- **Preload bridge** (`preload.js`) — Secure IPC channel between main and renderer
- **React renderer** (`src/`) — Panel layout via Allotment, state via Zustand, sidebar tab architecture
- **Terminal** — xterm.js connected to real PTY sessions via node-pty, supports docked (inline panel) and floating window modes with DOM persistence across transitions
- **Backend library** (`lib/`) — Database, providers, memory engine, knowledge graph, reflections pipeline

### Project structure

```
guardian-ui/
├── main.js                # Electron main process — PTY, IPC, LLM routing
├── preload.js             # Secure IPC bridge
├── lib/
│   ├── database.js        # SQLite/FTS5 memory storage + reflections schema
│   ├── providers.js       # Multi-LLM provider dispatch
│   ├── forgeframe.js      # Intent-based model router
│   ├── secure-store.js    # Encrypted API key storage
│   ├── embeddings.js      # Semantic embeddings pipeline
│   ├── knowledge-graph.js # Knowledge graph engine
│   ├── librarian.js       # Memory librarian (entity extraction)
│   ├── awareness.js       # Drift / awareness detection (batched queries)
│   ├── reflections.js     # Conversation history import, FTS search, analytics
│   ├── claude-cli.js      # Claude CLI integration utility
│   ├── reframe-detector.js
│   ├── identity-dimensions.js
│   ├── summarizer.js      # Conversation summarization
│   ├── compression.js     # Hierarchical memory compression
│   ├── terminal-history.js # Terminal session history
│   ├── backup.js          # Automated backup system
│   ├── importer.js        # Memory import pipeline
│   ├── import-parser.js   # ChatGPT/Claude export parsers
│   └── import-worker.js   # Async background import processing
├── src/
│   ├── App.jsx            # Panel layout orchestrator (Allotment, dock/undock)
│   ├── store.js           # Zustand global state
│   ├── TerminalHostContext.js # Shared DOM ref for terminal persistence
│   ├── panels/
│   │   ├── TerminalPanel.jsx   # xterm.js real terminal
│   │   ├── ChatPanel.jsx       # AI conversation
│   │   └── NotesPanel.jsx      # Markdown notes/docs
│   ├── components/
│   │   ├── ActivityBar.jsx         # Sidebar icon navigation (7 panels)
│   │   ├── SidebarContainer.jsx    # Lazy-loaded sidebar panel router
│   │   ├── TerminalWindow.jsx      # Floating terminal window (drag, dock zone)
│   │   ├── ReflectionsExplorer.jsx # Multi-mode reflection search
│   │   ├── ReflectionConversation.jsx # Single conversation detail view
│   │   ├── CommandPalette.jsx
│   │   ├── ModelPicker.jsx
│   │   ├── SettingsPanel.jsx
│   │   ├── MemoryExplorer.jsx
│   │   ├── KnowledgeGraph.jsx
│   │   ├── ImportWizard.jsx
│   │   ├── Onboarding.jsx
│   │   ├── ErrorBoundary.jsx
│   │   ├── AwarenessAlert.jsx
│   │   ├── DriftScoreBar.jsx
│   │   ├── DimensionLandscape.jsx
│   │   └── ReframeEventCard.jsx
│   ├── sidebar/
│   │   ├── SessionsPanel.jsx  # Session history browser
│   │   ├── SearchSidebar.jsx  # Memory search
│   │   ├── QueuePanel.jsx     # Integration queue
│   │   └── MemorySidebar.jsx  # Memory visualization
│   └── styles/
│       ├── theme.css           # CSS variables, dark theme
│       ├── panels.css
│       ├── sidebar.css         # Activity bar + sidebar layout
│       ├── terminal.css
│       └── terminal-window.css # Floating window positioning
└── .claude/
    ├── agents/
    ├── commands/
    └── skills/
```

### Conventions

- Functional React components with hooks
- CSS with BEM-style naming (no Tailwind in Electron)
- All IPC channels prefixed with `guardian:` (e.g., `guardian:pty:create`)
- State flows: Main process -> IPC -> Zustand store -> React components
- Panel components are self-contained; each manages its own local state

---

## Current state

In development. Local-first architecture. Built for regulated environments where privacy isn't optional.

- Sidebar architecture with activity bar and 7 lazy-loaded panel tabs
- Reflections pipeline: import, FTS search, multi-mode exploration
- Terminal docks inline as a resizable panel or floats as a draggable window
- Sequential post-chat pipeline: awareness, summarize, embeddings, graph, librarian
- Layout persistence per dock mode (column proportions survive transitions)

Early. Rough. Real.

---

*Built by people who got tired of forgetting what they already knew.*
