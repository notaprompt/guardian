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

- **Electron main process** (`main.js`) — PTY management, IPC handlers, window lifecycle, LLM routing
- **Preload bridge** (`preload.js`) — Secure IPC channel between main and renderer
- **React renderer** (`src/`) — Panel layout via allotment, state via Zustand
- **Terminal** — xterm.js connected to real PTY sessions via node-pty
- **Backend library** (`lib/`) — Database, providers, memory engine, knowledge graph

### Project structure

```
guardian-ui/
├── main.js                # Electron main process — PTY, IPC, LLM routing
├── preload.js             # Secure IPC bridge
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
│   ├── App.jsx            # Panel layout orchestrator
│   ├── store.js           # Zustand global state
│   ├── panels/
│   │   ├── TerminalPanel.jsx   # xterm.js real terminal
│   │   ├── ChatPanel.jsx       # AI conversation
│   │   ├── NotesPanel.jsx      # Markdown notes/docs
│   │   └── SearchPanel.jsx     # Memory/search panel
│   ├── components/
│   │   ├── CommandPalette.jsx
│   │   ├── ModelPicker.jsx
│   │   ├── SettingsPanel.jsx
│   │   ├── MemoryExplorer.jsx
│   │   ├── KnowledgeGraph.jsx
│   │   ├── ImportWizard.jsx
│   │   ├── Onboarding.jsx
│   │   ├── AwarenessAlert.jsx
│   │   ├── DriftScoreBar.jsx
│   │   ├── DimensionLandscape.jsx
│   │   └── ReframeEventCard.jsx
│   └── styles/
│       ├── theme.css           # CSS variables, dark theme
│       ├── panels.css
│       └── terminal.css
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

Early. Rough. Real.

---

*Built by people who got tired of forgetting what they already knew.*
