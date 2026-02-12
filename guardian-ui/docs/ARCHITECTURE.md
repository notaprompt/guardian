# Guardian Architecture Overview

Developer-facing documentation for the Guardian codebase.

---

## Process Model

Guardian is an Electron application with three process layers:

```
+-------------------------------------------------------+
|  Electron Main Process (main.js)                      |
|  - Window management (BrowserWindow)                  |
|  - IPC handler registry (ipcMain.handle / ipcMain.on) |
|  - PTY session manager (node-pty)                     |
|  - Chat process manager (Claude CLI spawn)            |
|  - Database manager (better-sqlite3 via lib/database) |
|  - Session telemetry engine                           |
|  - ForgeFrame model routing (lib/forgeframe)          |
|  - Awareness-trap detection (lib/awareness)           |
|  - Auto-summarization (lib/summarizer)                |
|  - Embedding indexing (lib/embeddings)                |
|  - Knowledge graph extraction (lib/knowledge-graph)   |
|  - Backup/export/import (lib/backup, exporter, importer)|
|  - File dialog handler                                |
|  - Logger (lib/logger)                                |
+-------------------------------------------------------+
|  Preload Bridge (preload.js)                          |
|  - contextBridge.exposeInMainWorld('guardian', {...})  |
|  - Selective IPC exposure — never exposes ipcRenderer  |
|  - Returns cleanup functions for event listeners       |
+-------------------------------------------------------+
|  Renderer Process (React + Vite)                      |
|  - App.jsx — Layout orchestrator (Allotment panels)   |
|  - Zustand store (src/store.js) — Global state        |
|  - Panel components — Self-contained views            |
|  - Component library — Shared UI elements             |
|  - Style system — CSS custom properties (theme.css)   |
+-------------------------------------------------------+
```

### Data Flow

- **User action** -> Renderer (React) -> `window.guardian.*` API -> IPC -> Main process -> Database/CLI/PTY
- **State updates** -> Main process -> IPC push (`send()`) -> Preload listener -> Zustand store -> React re-render

### Security Model

- `contextIsolation: true` — renderer cannot access Node.js APIs directly
- `nodeIntegration: false` — no `require()` in renderer
- `sandbox: false` — required for preload script to use `require('electron')`
- All IPC channels are explicitly whitelisted in `preload.js`
- Only specific channels are exposed; `ipcRenderer` is never exposed directly

---

## Project Structure

```
guardian-ui/
  main.js                # Electron main process — all IPC handlers
  preload.js             # Secure IPC bridge (contextBridge)
  index.html             # Electron entry HTML
  package.json
  vite.config.js
  lib/
    paths.js             # Directory constants, ~/.guardian/ initialization
    database.js          # SQLite via better-sqlite3 — all CRUD operations
    logger.js            # File-based application logger
    forgeframe.js        # ForgeFrame model routing engine
    awareness.js         # Awareness-trap detection (TRIM 9.4)
    summarizer.js        # Claude CLI session auto-summarization
    embeddings.js        # Semantic embedding pipeline
    knowledge-graph.js   # Entity/relationship extraction and storage
    terminal-history.js  # Terminal I/O capture and search
    backup.js            # Backup create/restore/rotate (ZIP/tar.gz)
    exporter.js          # Export sessions and notes as Markdown/JSON
    importer.js          # Import Markdown files and Obsidian vaults
  src/
    App.jsx              # Root — panel layout, keyboard shortcuts, telemetry, orbs
    store.js             # Zustand global state
    panels/
      TerminalPanel.jsx  # xterm.js PTY terminal with split panes
      ChatPanel.jsx      # Chat with Claude (stream-json)
      NotesPanel.jsx     # Three-type notes with version history
      SearchPanel.jsx    # Search, sessions, integration queue, knowledge graph
    components/
      PanelHeader.jsx    # Reusable panel title bar
      ErrorBoundary.jsx  # React error boundary per panel
      CommandPalette.jsx # Ctrl+Shift+P fuzzy command search
      ModelPicker.jsx    # ForgeFrame model selector in top bar
      ThinkingIndicator.jsx # Expandable thinking display in chat
      TokenUsage.jsx     # Token usage statistics display
      AwarenessAlert.jsx # TRIM 9.4 awareness-trap banner
      KnowledgeGraph.jsx # Force-directed entity graph (d3-force + canvas)
      Onboarding.jsx     # 4-step onboarding flow
      SettingsPanel.jsx  # Full settings UI with 7 sections
    styles/
      theme.css          # CSS custom properties, dark void theme
      panels.css         # Panel-specific styles
      terminal.css       # xterm overrides
      command-palette.css
      model-picker.css
      onboarding.css
      settings.css
      knowledge-graph.css
  arch/
    GUARDIAN_PRODUCT_SPEC.md  # Full product specification
  docs/
    USER_GUIDE.md        # User-facing guide
    KEYBOARD_SHORTCUTS.md # Shortcut reference card
    ARCHITECTURE.md      # This file
```

---

## IPC Channel Registry

All IPC channels are prefixed with `guardian:`. The preload bridge exposes them through the `window.guardian` object.

### PTY Operations

| Channel | Direction | Type | Purpose |
|---------|-----------|------|---------|
| `guardian:pty:create` | renderer -> main | invoke | Spawn new PTY session |
| `guardian:pty:write` | renderer -> main | send (fire-and-forget) | Write data to PTY |
| `guardian:pty:resize` | renderer -> main | send (fire-and-forget) | Resize PTY dimensions |
| `guardian:pty:kill` | renderer -> main | invoke | Kill a PTY session |
| `guardian:pty:data` | main -> renderer | push | PTY stdout output |
| `guardian:pty:exit` | main -> renderer | push | PTY process exited |
| `guardian:pty:snapshot` | renderer -> main | invoke | Save terminal viewport snapshot |

### Terminal History

| Channel | Direction | Type | Purpose |
|---------|-----------|------|---------|
| `guardian:terminal:history:search` | renderer -> main | invoke | Search terminal command history |
| `guardian:terminal:history:recent` | renderer -> main | invoke | Get recent commands |

### Claude Code Launch

| Channel | Direction | Type | Purpose |
|---------|-----------|------|---------|
| `guardian:claude:launch` | renderer -> main | invoke | Launch Claude CLI in a PTY |

### Chat

| Channel | Direction | Type | Purpose |
|---------|-----------|------|---------|
| `guardian:chat:send` | renderer -> main | invoke | Send message to Claude (spawns CLI process) |
| `guardian:chat:stop` | renderer -> main | invoke | Kill in-flight chat process |
| `guardian:chat:newSession` | renderer -> main | invoke | End current session, reset state |
| `guardian:chat:event` | main -> renderer | push | Stream-json events (content, thinking, tool_use, result) |
| `guardian:chat:error` | main -> renderer | push | Classified error messages |
| `guardian:chat:done` | main -> renderer | push | Chat process exited |
| `guardian:chat:sessionCreated` | main -> renderer | push | New session ID assigned |
| `guardian:chat:modelUsed` | main -> renderer | push | ForgeFrame routing result for this message |

### Session Management

| Channel | Direction | Type | Purpose |
|---------|-----------|------|---------|
| `guardian:session:list` | renderer -> main | invoke | List all sessions |
| `guardian:session:get` | renderer -> main | invoke | Get session with messages |
| `guardian:session:resume` | renderer -> main | invoke | Resume a previous session |
| `guardian:session:delete` | renderer -> main | invoke | Delete a session |
| `guardian:session:update` | renderer -> main | invoke | Update session fields |
| `guardian:session:summarize` | renderer -> main | invoke | Trigger AI summarization |
| `guardian:session:summaryReady` | main -> renderer | push | Summary generation complete |

### Notes

| Channel | Direction | Type | Purpose |
|---------|-----------|------|---------|
| `guardian:notes:load` | renderer -> main | invoke | Load all notes from DB |
| `guardian:notes:save` | renderer -> main | invoke | Bulk save notes |
| `guardian:notes:create` | renderer -> main | invoke | Create a single note |
| `guardian:notes:update` | renderer -> main | invoke | Update a note (triggers version snapshot) |
| `guardian:notes:delete` | renderer -> main | invoke | Delete a note and its versions |
| `guardian:notes:history` | renderer -> main | invoke | Get version history for a note |
| `guardian:notes:revert` | renderer -> main | invoke | Revert note to a specific version |

### Usage

| Channel | Direction | Type | Purpose |
|---------|-----------|------|---------|
| `guardian:usage:load` | renderer -> main | invoke | Load usage records |
| `guardian:usage:append` | renderer -> main | invoke | Append a usage record |

### Integration Queue

| Channel | Direction | Type | Purpose |
|---------|-----------|------|---------|
| `guardian:queue:list` | renderer -> main | invoke | List queue items (filtered by status) |
| `guardian:queue:add` | renderer -> main | invoke | Add a new queue item |
| `guardian:queue:update` | renderer -> main | invoke | Update item status/priority/text |
| `guardian:queue:delete` | renderer -> main | invoke | Delete a queue item |

### Telemetry

| Channel | Direction | Type | Purpose |
|---------|-----------|------|---------|
| `guardian:telemetry:session` | renderer -> main | invoke | Get current telemetry snapshot |
| `guardian:telemetry:state` | main -> renderer | push | Telemetry state pushed every 5 seconds |

### Profile

| Channel | Direction | Type | Purpose |
|---------|-----------|------|---------|
| `guardian:profile:get` | renderer -> main | invoke | Read user profile from disk |
| `guardian:profile:set` | renderer -> main | invoke | Write user profile to disk |

### Search

| Channel | Direction | Type | Purpose |
|---------|-----------|------|---------|
| `guardian:search` | renderer -> main | invoke | Full-text search (FTS5) across messages, notes, sessions |
| `guardian:search:semantic` | renderer -> main | invoke | Semantic search via embedding summaries |

### Embeddings

| Channel | Direction | Type | Purpose |
|---------|-----------|------|---------|
| `guardian:embeddings:indexed` | main -> renderer | push | Embedding indexing complete for a session |

### Knowledge Graph

| Channel | Direction | Type | Purpose |
|---------|-----------|------|---------|
| `guardian:graph:entities` | renderer -> main | invoke | Get all entities |
| `guardian:graph:relationships` | renderer -> main | invoke | Get all relationships |
| `guardian:graph:extract` | renderer -> main | invoke | Trigger entity extraction for a session |
| `guardian:graph:entitySessions` | renderer -> main | invoke | Get sessions mentioning an entity |
| `guardian:graph:extracted` | main -> renderer | push | Extraction complete |

### Awareness-Trap Detection

| Channel | Direction | Type | Purpose |
|---------|-----------|------|---------|
| `guardian:awareness:check` | renderer -> main | invoke | Manually trigger awareness check |
| `guardian:awareness:dismiss` | renderer -> main | invoke | Dismiss a detected topic (7-day cooldown) |
| `guardian:awareness:detected` | main -> renderer | push | Pattern detected after chat response |

### ForgeFrame Model Routing

| Channel | Direction | Type | Purpose |
|---------|-----------|------|---------|
| `guardian:model:get` | renderer -> main | invoke | Get current model, auto-route state, model list |
| `guardian:model:set` | renderer -> main | invoke | Set selected model |
| `guardian:model:list` | renderer -> main | invoke | List available models |
| `guardian:model:autoRoute` | renderer -> main | invoke | Enable/disable auto-routing |

### Welcome

| Channel | Direction | Type | Purpose |
|---------|-----------|------|---------|
| `guardian:welcome:init` | renderer -> main | invoke | Create starter content (note + queue item) |

### Backup

| Channel | Direction | Type | Purpose |
|---------|-----------|------|---------|
| `guardian:backup:create` | renderer -> main | invoke | Create a backup archive |
| `guardian:backup:list` | renderer -> main | invoke | List existing backups |
| `guardian:backup:restore` | renderer -> main | invoke | Restore from a backup file |

### Export

| Channel | Direction | Type | Purpose |
|---------|-----------|------|---------|
| `guardian:export:session` | renderer -> main | invoke | Export session as Markdown or JSON |
| `guardian:export:note` | renderer -> main | invoke | Export a note as Markdown or JSON |
| `guardian:export:allNotes` | renderer -> main | invoke | Export all notes to a directory |
| `guardian:export:fullData` | renderer -> main | invoke | Export all data as JSON |

### Import

| Channel | Direction | Type | Purpose |
|---------|-----------|------|---------|
| `guardian:import:markdown` | renderer -> main | invoke | Import Markdown files as notes |
| `guardian:import:obsidian` | renderer -> main | invoke | Import an Obsidian vault folder |
| `guardian:import:backup` | renderer -> main | invoke | Import/restore from a backup file |

### File Dialogs

| Channel | Direction | Type | Purpose |
|---------|-----------|------|---------|
| `guardian:file:open` | renderer -> main | invoke | Open file dialog (multi-select, images + docs) |
| `guardian:file:save` | renderer -> main | invoke | Save file dialog |

### Config

| Channel | Direction | Type | Purpose |
|---------|-----------|------|---------|
| `guardian:config:get` | renderer -> main | invoke | Read settings (all or by key) |
| `guardian:config:set` | renderer -> main | invoke | Write a settings key-value pair |
| `guardian:config:layout:get` | renderer -> main | invoke | Read layout config |
| `guardian:config:layout:set` | renderer -> main | invoke | Write layout config |

### System

| Channel | Direction | Type | Purpose |
|---------|-----------|------|---------|
| `guardian:system:info` | renderer -> main | invoke | Get platform, shell, versions, Claude availability |

---

## Database Schema

SQLite via better-sqlite3 at `~/.guardian/data/guardian.db`. WAL journal mode, NORMAL synchronous, foreign keys enabled.

### Core Tables

```sql
sessions (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  claude_session_id TEXT,       -- Claude CLI --resume ID
  title TEXT,
  summary TEXT,                 -- AI-generated session summary
  model TEXT,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  tokens_in INTEGER DEFAULT 0,
  tokens_out INTEGER DEFAULT 0
)

messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL -> sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL,            -- user, assistant, system
  content TEXT,
  thinking TEXT,                 -- Full thinking block content
  attachments TEXT,              -- JSON array
  tokens_in INTEGER DEFAULT 0,
  tokens_out INTEGER DEFAULT 0,
  timestamp TEXT NOT NULL
)

notes (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL DEFAULT 'scratch',  -- scratch, structured, journal
  title TEXT DEFAULT '',
  content TEXT DEFAULT '',
  color TEXT DEFAULT 'default',
  project_id TEXT,
  tags TEXT DEFAULT '[]',        -- JSON array
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
)

note_versions (
  id TEXT PRIMARY KEY,
  note_id TEXT -> notes(id) ON DELETE CASCADE,
  content TEXT,
  created_at TEXT NOT NULL
)

artifacts (
  id TEXT PRIMARY KEY,
  session_id TEXT -> sessions(id),
  message_id TEXT -> messages(id),
  type TEXT NOT NULL,             -- code, doc, image, diagram
  title TEXT,
  language TEXT,
  file_path TEXT,
  version INTEGER DEFAULT 1,
  content TEXT,
  created_at TEXT NOT NULL
)

queue_items (
  id TEXT PRIMARY KEY,
  text TEXT NOT NULL,
  source_session_id TEXT,
  source_message_id TEXT,
  status TEXT DEFAULT 'open',    -- open, deferred, resolved, promoted
  priority INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  resolved_at TEXT
)

usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT,
  input_tokens INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  timestamp TEXT NOT NULL
)

embeddings (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL -> sessions(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  chunk_text TEXT NOT NULL,
  semantic_summary TEXT,         -- AI-generated semantic summary
  created_at TEXT NOT NULL
)

-- Knowledge Graph (V.1.d)
kg_entities (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,             -- person, concept, project, decision, question
  mention_count INTEGER DEFAULT 1,
  first_seen TEXT,
  last_seen TEXT
)

kg_relationships (
  id TEXT PRIMARY KEY,
  source_entity_id TEXT -> kg_entities(id),
  target_entity_id TEXT -> kg_entities(id),
  type TEXT NOT NULL,             -- related_to, contradicts, builds_on, depends_on
  session_id TEXT,
  created_at TEXT
)

awareness_dismissals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  topic TEXT NOT NULL,
  dismissed_at TEXT NOT NULL
)
```

### FTS5 Virtual Tables

```sql
messages_fts (content, thinking)          -- FTS on message content and thinking
notes_fts (title, content)                -- FTS on note title and content
sessions_fts (title, summary)             -- FTS on session title and summary
embeddings_fts (chunk_text, semantic_summary)  -- FTS on embedding chunks
```

---

## Zustand Store Structure

The global state in `src/store.js` is organized into these slices:

| Slice | Key Fields | Purpose |
|-------|------------|---------|
| Terminal | `terminals`, `activeTerminalId`, `splitMode`, `terminalPaneOrder` | PTY session tracking, split layout |
| Sessions | `activeSessionId`, `sessions` | Session list and active session ID |
| Chat | `chatMessages`, `chatIsResponding`, `thinkingBlocks` | Chat message state, thinking blocks |
| Notes | `notes`, `activeNoteId`, `noteTypeFilter`, `noteVersions` | Note CRUD with type filtering |
| Search | `searchQuery`, `searchResults`, `searchMode`, `semanticSearchResults` | FTS and semantic search state |
| Telemetry | `telemetry` (elapsed, burnRate, intensity, duration, drift, systemState) | Real-time session metrics |
| Queue | `queueItems`, `queueUnresolved` | Integration queue items |
| Ambient | `ambientState` (warmIntensity, coolShift, glowState) | Orb rendering state |
| Profile | `profile` (architecture, encoding, integrationLoad, awarenessPatterns) | User cognitive profile |
| Model | `models`, `selectedModel`, `autoRoute`, `lastAutoTier` | ForgeFrame model routing |
| Awareness | `awareness` | Current awareness-trap detection result |
| Graph | `graphEntities`, `graphRelationships`, `graphLoading` | Knowledge graph data |
| Layout | `focusedPanel`, `maximizedPanel`, `layoutSizes` | Panel focus and resize state |
| UI | `commandPaletteOpen`, `settingsOpen` | Overlay visibility |
| System | `systemInfo` | Platform info from main process |
| Usage | `usageRecords` | Token usage history |

---

## Key Libraries

| Library | Version | Purpose |
|---------|---------|---------|
| Electron | 33+ | Desktop shell, main/renderer process model |
| React | 18.3 | UI rendering |
| Vite | 6.0 | Dev server and bundler for renderer |
| Zustand | 4.5 | Global state management |
| allotment | 1.20 | Resizable split panel layout |
| @xterm/xterm | 5.5 | Terminal emulator in browser |
| @xterm/addon-fit | 0.10 | Auto-fit terminal to container |
| @xterm/addon-web-links | 0.11 | Clickable URLs in terminal |
| @xterm/addon-webgl | 0.19 | WebGL renderer for terminal (optional) |
| node-pty | 1.2.0-beta.10 | Native PTY spawning |
| better-sqlite3 | 12.6 | Synchronous SQLite database |
| d3-force | 3.0 | Force-directed graph simulation |

---

## How to Add a New Panel

1. Create `src/panels/NewPanel.jsx`:

```jsx
import React from 'react';
import PanelHeader from '../components/PanelHeader';

export default function NewPanel() {
  return (
    <>
      <PanelHeader label="New Panel" />
      <div className="zone-body">
        {/* Panel content */}
      </div>
    </>
  );
}
```

2. Add the panel to the Allotment layout in `src/App.jsx`:
   - Import the component
   - Add an `<Allotment.Pane>` with an `<ErrorBoundary>` wrapper
   - Add visibility logic for maximize mode

3. Add a panel key mapping in `App.jsx`:

```js
const PANEL_KEYS = { '1': 'terminal', '2': 'chat', '3': 'notes', '4': 'artifacts', '5': 'newpanel' };
```

4. Add any needed state slices in `src/store.js`.

5. Add styles in `src/styles/panels.css` or a new CSS file.

---

## How to Add a New IPC Channel

1. **Main process** (`main.js`): Register the handler.

```js
// For request-response (renderer awaits result):
ipcMain.handle('guardian:newfeature:action', (event, args) => {
  try {
    // Do work...
    return { ok: true, data: result };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// For fire-and-forget (renderer does not wait):
ipcMain.on('guardian:newfeature:fire', (event, args) => {
  // Do work...
});

// For pushing data to renderer:
function sendToRenderer(channel, data) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data);
  }
}
```

2. **Preload** (`preload.js`): Expose the channel through `window.guardian`.

```js
newfeature: {
  action: (args) => ipcRenderer.invoke('guardian:newfeature:action', args),
  fire: (args) => ipcRenderer.send('guardian:newfeature:fire', args),
  onEvent: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('guardian:newfeature:event', handler);
    return () => ipcRenderer.removeListener('guardian:newfeature:event', handler);
  },
},
```

3. **Renderer** (`src/`): Call the API from components or store actions.

```js
// In a component or store action:
const result = await window.guardian.newfeature.action({ key: 'value' });

// For event listeners (in useEffect):
useEffect(() => {
  const unsub = window.guardian.newfeature.onEvent((data) => {
    // Handle event...
  });
  return () => unsub?.();
}, []);
```

### Conventions

- All channels are prefixed with `guardian:`
- Use `ipcMain.handle` for request-response patterns (renderer uses `ipcRenderer.invoke`)
- Use `ipcMain.on` for fire-and-forget (renderer uses `ipcRenderer.send`)
- Use `mainWindow.webContents.send` for main-to-renderer pushes (renderer uses `ipcRenderer.on` with cleanup)
- Always return `{ ok: true, ... }` or `{ ok: false, error: '...' }` from handlers
- Wrap handlers in try/catch and log errors via `lib/logger`
- Preload listeners must return a cleanup function for proper React useEffect teardown

---

## Telemetry Engine

The telemetry engine in `main.js` tracks real-time session metrics:

- **Token burn rate**: rolling 2-minute window of tokens consumed, normalized to tokens/minute
- **Intensity**: burn rate normalized to 0-1 (1000 tok/min = 1.0), drives warm orb
- **Duration**: session minutes normalized to 0-1 (120 min = 1.0), drives cool orb
- **System state**: idle, thinking, responding, error — drives glow orb
- **Drift detection**: compares recent vs. older message lengths and timing gaps to detect pattern shifts (consolidating, expanding, slowing, accelerating)

State is pushed to the renderer every 5 seconds via `guardian:telemetry:state`.

---

## Post-Chat Processing Pipeline

After each successful chat response (`proc.on('close')` with exit code 0), the main process runs these async operations sequentially — none block the UI:

1. **Awareness-trap detection** — analyzes session history for recurring unresolved topics
2. **Auto-summarization** — generates a session summary via Claude CLI
3. **Semantic embedding** — chunks the conversation and generates semantic summaries for each chunk
4. **Knowledge graph extraction** — extracts entities and relationships from the conversation

Each operation has its own error handling and logs failures without affecting the others.
