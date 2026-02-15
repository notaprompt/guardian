    1 -# Guardian UI
    1 +# Guardian
    2
    3 -Mission control interface wrapping Claude Code CLI into a resizable mul
      -ti-panel desktop app.
    3 +**A cognitive operating system for people who think in layers.**
    4
    5 +---
    6 +
    7 +## What it is
    8 +
    9 +Guardian is infrastructure for your mind. Not a note-taking app. Not a
      +chatbot. A persistent memory layer that learns how you think, helps you
      + navigate complexity, and remembers what matters.
   10 +
   11 +It's for the people who have 47 browser tabs open, three unfinished tho
      +ughts in different tools, and the nagging sense that they've solved thi
      +s problem before but can't remember where.
   12 +
   13 +## Why it exists
   14 +
   15 +We're drowning in context. Every conversation with AI starts from zero.
      + Every tool forgets what the last one knew. Every decision requires reb
      +uilding the same mental scaffolding over and over.
   16 +
   17 +Guardian remembers. Not just what you said, but what you meant. Not jus
      +t facts, but patterns. Not just answers, but the questions you didn't k
      +now to ask yet.
   18 +
   19 +## What it does
   20 +
   21 +- **Persistent memory.** Your conversations don't disappear. They accum
      +ulate into a living knowledge base that gets smarter the more you use i
      +t.
   22 +- **Semantic navigation.** Find what you need by what it means, not wha
      +t you called it three months ago.
   23 +- **Context preservation.** Jump between projects without losing your t
      +rain of thought. Guardian holds the threads.
   24 +- **Integration queue.** When information conflicts, Guardian doesn't o
      +verwrite. It asks. You decide. You stay sovereign.
   25 +
   26 +## How it works
   27 +
   28 +Guardian sits between you and AI. Every conversation flows through it.
      +Every insight gets remembered. Every pattern gets recognized.
   29 +
   30 +It uses semantic memory and symbolic architecture — FTS5 full-text sear
      +ch for retrieval, structured knowledge graphs for reasoning. Local-firs
      +t, privacy-preserving, yours.
   31 +
   32 +Think of it as the cognitive layer that should have always existed betw
      +een your brain and your tools.
   33 +
   34  ```
    6 -┌─────────────────────────────────────────────────────┐
    7 -│                    ◈ GUARDIAN                        │
    8 -├──────────────────────────┬──────────────────────────┤
    9 -│                          │                          │
   10 -│   Terminal / Claude Code │      Notes / Docs        │
   11 -│   (real PTY via xterm.js)│      (markdown editor)   │
   12 -│                          │                          │
   13 -├──────────────────────────┼──────────────────────────┤
   14 -│                          │                          │
   15 -│   Chat                   │   Memory / Search        │
   16 -│   (AI conversation)      │   (FAISS / file search)  │
   17 -│                          │                          │
   18 -└──────────────────────────┴──────────────────────────┘
   35 +┌──────────────────────────────────────────────────────────┐
   36 +│                      ◈ GUARDIAN                          │
   37 +├────────────────────────────┬─────────────────────────────┤
   38 +│                            │                             │
   39 +│   Terminal                 │      Chat                   │
   40 +│   (real PTY via xterm.js)  │      (multi-provider AI)    │
   41 +│                            │                             │
   42 +├────────────────────────────┼─────────────────────────────┤
   43 +│                            │                             │
   44 +│   Notes                    │   Memory / Search           │
   45 +│   (structured + scratch)   │   (FTS5 + knowledge graph)  │
   46 +│                            │                             │
   47 +└────────────────────────────┴─────────────────────────────┘
   48  ```
   49
   21 -All panels are resizable by dragging dividers. Terminal panel can toggl
      -e between raw shell and Claude Code CLI.
   50 +All panels are resizable. Everything is connected. Nothing is lost.
   51
   23 -## Quick Start
   52 +---
   53
   54 +## Who it's for
   55 +
   56 +- **The architects.** People who design systems, not just use them. PMs
      +, strategists, researchers, builders.
   57 +- **The overwhelmed.** People managing more complexity than any one bra
      +in should hold.
   58 +- **The pattern-seekers.** People who see connections others miss and n
      +eed tools that keep up.
   59 +- **The sovereignty-minded.** People who want their thinking to be thei
      +rs, not rented from a cloud somewhere.
   60 +
   61 +## What it's not
   62 +
   63 +Guardian is not a productivity hack. Not a replacement for thinking. No
      +t a chatbot with memory. Not another place to organize notes.
   64 +
   65 +It's infrastructure. The kind you don't notice until it's gone.
   66 +
   67 +---
   68 +
   69 +## Architecture
   70 +
   71 +### Stack
   72 +
   73 +| Layer | Technology |
   74 +|-------|-----------|
   75 +| **Runtime** | Electron 33 + Node.js |
   76 +| **Frontend** | React 18 + Vite |
   77 +| **State** | Zustand |
   78 +| **Database** | SQLite + FTS5 full-text search |
   79 +| **Terminal** | xterm.js + node-pty (real PTY) |
   80 +| **AI Providers** | Claude (CLI + API), OpenAI, Ollama (local), Firewo
      +rks, Moonshot |
   81 +| **Model Routing** | ForgeFrame — intent-based auto-selection by compl
      +exity and cost |
   82 +| **Memory** | 4-level hierarchical compression (raw → summary → patter
      +n → principle) |
   83 +| **Security** | Encrypted credential storage, IPC isolation, no raw No
      +de.js in renderer |
   84 +| **Theme** | Custom CSS — dark, brutalist-meets-MCM aesthetic |
   85 +
   86 +### Core Systems
   87 +
   88 +- **ForgeFrame** — Three-tier intent detection that auto-routes queries
      + to the optimal model by complexity and cost. Provider-agnostic: runs f
      +ully air-gapped on local models or scales through cloud APIs.
   89 +- **Hierarchical Memory Compression** — Automatic threshold-triggered d
      +istillation with strength decay (0.97/day) and retrieval reinforcement
      +(+0.15 per access). Creates an emergent forgetting curve that prioritiz
      +es frequently-accessed knowledge.
   90 +- **Reframe Detection** — AI safety layer that detects when model respo
      +nses subtly reframe a user's self-concept across 7 classification types
      +. Triggers automatic prompt correction when inaccuracy exceeds threshol
      +d.
   91 +- **Post-Session Intelligence** — Asynchronous pipeline that fires on c
      +onversation end: extracts decisions, tasks, and insights; auto-generate
      +s typed notes; indexes chunks with semantic summaries into FTS5; links
      +entities into a knowledge graph.
   92 +- **Integration Queue** — Conflict resolution through user choice. When
      + new information contradicts existing knowledge, Guardian surfaces the
      +conflict instead of silently overwriting.
   93 +
   94 +### Design Principles
   95 +
   96 +- **Local-first** — Cloud optional, not required
   97 +- **User sovereignty** — You own your data, your context, your decision
      +s
   98 +- **Privacy-preserving** — Designed for regulated environments where pr
      +ivacy isn't optional
   99 +- **Provider-agnostic** — No vendor lock-in, swap models without changi
      +ng code
  100 +
  101 +### Project Structure
  102 +
  103 +```
  104 +guardian-ui/
  105 +├── main.js                # Electron main process (60+ IPC handlers)
  106 +├── preload.js             # Secure IPC bridge
  107 +├── lib/
  108 +│   ├── providers.js       # Multi-provider AI abstraction
  109 +│   ├── forgeframe.js      # Intent-based model routing
  110 +│   ├── database.js        # SQLite + FTS5 + knowledge graph
  111 +│   ├── secure-store.js    # Encrypted credential management
  112 +│   ├── compression.js     # Hierarchical memory pipeline
  113 +│   ├── librarian.js       # Context retrieval engine
  114 +│   └── ...                # 20 backend modules
  115 +├── src/
  116 +│   ├── App.jsx            # Panel layout orchestrator
  117 +│   ├── store.js           # Zustand global state
  118 +│   ├── panels/
  119 +│   │   ├── TerminalPanel.jsx
  120 +│   │   ├── ChatPanel.jsx
  121 +│   │   ├── NotesPanel.jsx
  122 +│   │   └── SearchPanel.jsx
  123 +│   ├── components/        # Shared UI components
  124 +│   └── styles/            # Theme + panel CSS
  125 +└── arch/                  # Design specs and research
  126 +```
  127 +
  128 +---
  129 +
  130 +## Getting Started
  131 +
  132  ```bash
   26 -# Prerequisites: Node.js 20+, Claude Code CLI installed
  133 +# Clone
  134 +git clone https://github.com/notaprompt/guardian-ui-scaffold.git
  135 +cd guardian-ui-scaffold/guardian-ui
  136
   28 -# Install dependencies
  137 +# Install
  138  npm install
  139 +npx @electron/rebuild -f -w node-pty
  140
   31 -# Rebuild native modules for Electron
   32 -npx electron-rebuild -f -w node-pty
   33 -
   34 -# Start (launches Vite dev server + Electron)
  141 +# Run
  142  npm start
  143  ```
  144
  145  If `npm start` doesn't work, run the two processes separately:
  146 +
  147  ```bash
   40 -# Terminal 1: Start Vite dev server
  148 +# Terminal 1: Vite dev server
  149  npm run dev
  150
   43 -# Terminal 2: Start Electron (after Vite is running)
  151 +# Terminal 2: Electron (after Vite is running)
  152  npm run electron
  153  ```
  154
   47 -## Architecture
  155 +**Requirements:** Node.js 20+, npm, Git. Optional: [Ollama](https://oll
      +ama.com) for local models, [Claude CLI](https://docs.anthropic.com/en/d
      +ocs/claude-code) for Anthropic integration.
  156
   49 -- **Electron main process** (`main.js`) — PTY management, IPC handlers,
      - window lifecycle
   50 -- **Preload bridge** (`preload.js`) — Secure channel between main and r
      -enderer
   51 -- **React renderer** (`src/`) — Panel layout via allotment, state via Z
      -ustand
   52 -- **Terminal** — xterm.js connected to real PTY sessions via node-pty
  157 +---
  158
   54 -## Extending
  159 +## Current State
  160
   56 -### Add a new panel
   57 -```bash
   58 -# In Claude Code:
   59 -/add-panel FileExplorer
   60 -```
  161 +In development. Early. Rough. Real.
  162
   62 -### Add a new IPC channel
   63 -```bash
   64 -/add-ipc memory:search - semantic search via FAISS sidecar
   65 -```
  163 +60+ IPC channels across 20 backend modules. Multi-provider AI routing.
      +Hierarchical memory. Reframe detection. Knowledge graphs. Real terminal
      + with PTY. Four integrated panels — all resizable, all connected.
  164
   67 -### Connect ForgeFrame / FAISS
   68 -The Memory/Search panel has placeholder search logic. To connect real s
      -emantic search:
  165 +Built by one person who got tired of forgetting what they already knew.
  166
   70 -1. Add a FastAPI sidecar spawn in `main.js` (on app startup)
   71 -2. Add IPC handler `guardian:memory:search` that POSTs to the sidecar
   72 -3. Wire `SearchPanel.jsx` to call the IPC channel instead of the placeh
      -older
  167 +---
  168
   74 -### Architecture review
   75 -```bash
   76 -# In Claude Code, use the custom subagent:
   77 -"Use the guardian-architect agent to review the current IPC security mo
      -del"
   78 -```
  169 +## Philosophy
  170
   80 -## Stack
  171 +We built tools that make us efficient. Now we need tools that make us c
      +oherent.
  172
   82 -| Layer | Tech |
   83 -|-------|------|
   84 -| Shell | Electron 33 |
   85 -| UI | React 18 + Vite |
   86 -| Panels | allotment |
   87 -| Terminal | xterm.js + node-pty |
   88 -| State | Zustand |
   89 -| Theme | Custom CSS (dark, brutalist-MCM) |
  173 +Guardian is for the space between *"I know I've thought about this befo
      +re"* and *"where the hell did I put that thought?"*
  174
   91 -## Project Structure
  175 +It's for the cognitive load that doesn't fit in RAM but needs to be ins
      +tantly accessible anyway. It's for people who think for a living and ar
      +e tired of starting from scratch every time.
  176
   93 -```
   94 -guardian-ui/
   95 -├── main.js              # Electron main process
   96 -├── preload.js           # IPC bridge
   97 -├── CLAUDE.md            # Claude Code project memory
   98 -├── src/
   99 -│   ├── App.jsx          # Panel layout orchestrator
  100 -│   ├── store.js         # Zustand state
  101 -│   ├── panels/          # Self-contained panel components
  102 -│   ├── components/      # Shared UI components
  103 -│   └── styles/          # Theme + panel CSS
  104 -└── .claude/
  105 -    ├── commands/        # Slash commands
  106 -    ├── agents/          # Custom subagents
  107 -    └── skills/          # Auto-discovered skills
  108 -```
  177 +---
  178
  110 -## Roadmap
  179 +## The Vision
  180
  112 -- [ ] CodeMirror 6 for Notes panel (markdown highlighting, vim mode)
  113 -- [ ] FAISS sidecar for semantic memory search
  114 -- [ ] ForgeFrame model router integration
  115 -- [ ] Multiple terminal tabs
  116 -- [ ] Session persistence (auto-save notes, chat history)
  117 -- [ ] MCP server management panel
  118 -- [ ] Archetype profile injection into Claude sessions
  119 -- [ ] Tab/panel drag-and-drop reordering
  181 +A world where your tools remember what you've already figured out. Wher
      +e context doesn't evaporate between conversations. Where AI augments yo
      +ur thinking without owning it.
  182 +
  183 +Where you can trace every thought back to its origin. Where conflicting
      + information doesn't get silently overwritten. Where your cognitive inf
      +rastructure belongs to you.
  184 +
  185 +Guardian is the beginning of that.
  186 +
  187 +---
  188 +
  189 +**Memory that doesn't fade. Context that doesn't drop. Thinking that co
      +mpounds.**
  190 +
  191 +*Status: In development. Not production-ready. Use at your own risk.*
