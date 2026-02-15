# Guardian User Guide

Guardian is an Electron desktop application that wraps Claude Code CLI into a multi-panel mission control interface. It combines a real terminal, AI chat, a notes system, memory search, an integration queue, and cognitive telemetry into a single workspace. All data is stored locally on your machine.

---

## Getting Started

### Prerequisites

- **Node.js** (v18+)
- **Claude Code CLI** installed and authenticated (`claude --version` should work)
- **Windows**, **macOS**, or **Linux**

### Installation

```
npm install
npx @electron/rebuild -f -w node-pty
```

### Running

Development mode (two terminals):

```
npm run dev          # Start Vite dev server
npm run electron     # Start Electron (after dev server is up)
```

Or use the combined start command:

```
npm start            # Runs both concurrently
```

Production build:

```
npm run build        # Build renderer
npm run dist         # Package with electron-builder
```

### First Launch — Onboarding

When you launch Guardian for the first time, you will see the onboarding flow:

1. **Welcome** — The Guardian glyph and tagline. Click "Begin setup" to proceed.
2. **Architecture Self-Assessment** — Five questions that calibrate Guardian to your cognitive style. Your answers determine whether Guardian classifies you as Phase-Lock (PL), Context-Dependent (CD), or Time-Division (TD). This affects features like awareness-trap detection sensitivity. All results are stored locally, never transmitted.
3. **Workspace Setup** — Choose your preferred shell, default AI model, and optionally import existing Markdown notes.
4. **Transition** — Click "Enter Guardian" to open the main cockpit.

You can re-take the self-assessment at any time from Settings (Ctrl+,) under the Profile section.

---

## The Cockpit

Guardian's interface is a multi-panel cockpit with four resizable zones:

```
+-------------------+-------------------+----------------+
|                   |                   |                |
|    Terminal       |      Chat         |    Notes       |
|   (Ctrl+1)        |    (Ctrl+2)        |   (Ctrl+3)     |
|                   |                   |                |
|                   |                   +----------------+
|                   |                   |                |
|                   |                   |  Artifacts /   |
|                   |                   |  Search        |
|                   |                   |   (Ctrl+4)     |
+-------------------+-------------------+----------------+
```

### Top Bar

The top bar shows:
- The Guardian glyph and name
- **Model Picker** (ForgeFrame) — current AI model and auto-route toggle
- **Session status** — "session active" or "idle"
- **Open threads count** — number of unresolved integration queue items
- **Architecture type** — your assessed cognitive architecture (PL/CD/TD)

### Bottom Bar (Telemetry Strip)

The bottom bar displays real-time session telemetry:
- **System state indicator** — idle, thinking, responding, or error (with colored dot)
- **Session duration** — elapsed time since session start
- **Token burn rate** — tokens consumed per minute (rolling 2-minute average)
- **Drift detection** — subtle message when your interaction pattern shifts (consolidating, expanding, slowing, accelerating)
- **Exchange count** — number of back-and-forth messages
- **Thinking ratio** — percentage of Claude's output that was thinking
- **Total tokens** — cumulative tokens burned in the session

### Ambient Orbs

Three background orbs respond to session state:
- **Warm orb** (top-left) — opacity and scale increase with token burn rate (metabolic load proxy)
- **Cool orb** (bottom-right) — hue shifts from blue to amber as session duration increases
- **Glow orb** (center) — pulses during Claude thinking, brightens during responses, dims on errors

### Panel Resizing

- Drag the handles between panels to resize
- Double-click a handle to reset to default proportions
- **Ctrl+Shift+M** — maximize the focused panel (collapse all others to zero); press again to restore

---

## Terminal Panel

The terminal provides a real PTY session via node-pty with full xterm.js emulation.

### Features

- Default shell: PowerShell on Windows, `$SHELL` on Unix
- Claude CLI is available on PATH within the terminal
- Clickable links (via WebLinksAddon)
- Ctrl+V paste support
- 1000-line scrollback buffer
- Full color support (xterm-256color)

### Split Terminals

Guardian supports up to 4 terminal panes:

- **Ctrl+Shift+D** — split: add a new terminal pane
- **Ctrl+Shift+W** — close the active pane
- **Ctrl+Tab** — cycle between panes
- Click the numbered tabs in the header to switch panes
- The toggle button in the header switches between horizontal and vertical split orientation
- With 4 panes, the layout becomes a 2x2 quad grid

### Terminal Snapshots

- **Ctrl+Shift+S** — capture the active terminal's viewport content as a snapshot artifact
- Click the "S" button in the terminal header for the same action
- Snapshots are saved to the terminal history database

### Terminal History Search

- Use the search input in the terminal header bar to search your command history
- Results show the command input, timestamp, and a preview of the output
- Search is debounced (300ms) for performance

### Claude Code in Terminal

You can also launch Claude Code directly in a terminal pane via the `guardian:claude:launch` IPC channel. This opens Claude's interactive mode in a dedicated PTY.

---

## Chat Panel

The chat panel provides a streaming conversation interface with Claude, powered by the Claude Code CLI in `--output-format stream-json` mode.

### Sending Messages

- Type in the textarea at the bottom
- Press **Enter** to send (Shift+Enter for newline)
- Click the Send button
- While Claude is responding, the Send button shows "..." and input is disabled

### Stopping a Response

- Click the stop button (square icon) in the chat header while Claude is responding

### Sessions

- Each conversation is a **session** stored in SQLite
- Click **+** in the chat header to start a new session
- Sessions are auto-titled from your first message
- Resume any previous session from the Sessions tab in the Artifacts panel
- Session history is preserved across app restarts

### Context Injection

Every message sent to Claude is automatically enriched with context:

1. **Notes** — your active notes are injected as `[guardian-notes]` blocks
2. **Integration queue** — open thread items are injected as `[guardian-open-threads]` blocks
3. **Conversation history** — relevant past conversations found via full-text search are injected as `[guardian-context]` blocks

The total context injection budget is approximately 2000 tokens. This can be configured in Settings under Context Injection.

### Thinking Display

Claude's thinking process is shown in expandable indicators within messages:
- Auto-summarized (first sentence of each paragraph, max 3 lines)
- Pulsing icon while Claude is actively thinking
- Click the expand/collapse button or double-click to see the full thinking text

### File Attachments

- Click the **+** button next to the input to open a file dialog
- Supported formats: text files (.txt, .md, .json, .js, .py, etc.), images (.png, .jpg, .gif, .webp, .svg), documents (.docx, .pdf)
- Paste images directly from clipboard
- Text files are injected as context blocks in the prompt
- Images are saved as temp files and passed to Claude via `--file` flags
- .docx files are parsed (XML text extraction) and injected as text
- .pdf files have basic text extraction (uncompressed streams)
- Attachments show as a preview strip with thumbnail and remove button

### Error Handling

Chat errors are classified and displayed with appropriate context:
- **auth** — authentication/API key issues
- **rate_limit** — rate limiting
- **network** — connection problems
- **unknown** — other errors

### Awareness-Trap Detection

After each successful chat response, Guardian analyzes your conversation history for patterns that may indicate an awareness trap:
- Repeated discussion of the same topic across 3+ sessions without resolution
- High meta-language usage ("I keep...", "I notice I...", "same pattern")
- Absence of action items

When detected, an amber alert banner appears at the top of the chat with two options:
- **Add to integration queue** — promotes the topic to a trackable open thread
- **Dismiss** — suppresses the alert for 7 days

This feature can be disabled in Settings under Detection.

---

## Notes Panel

The notes panel provides a three-type note system with auto-save and version history.

### Note Types

- **Scratch** — quick unstructured capture, no title required, auto-timestamped
- **Structured** — titled, organized notes for design documents, reference material, decision logs
- **Journal** — date-stamped reflections, auto-titled with the current date (YYYY-MM-DD)

### Using Notes

- Click **+** in the header to create a new note (type matches the current filter, defaults to scratch)
- Use the type tabs (All / Scratch / Structured / Journal) to filter the note list
- Click a note in the sidebar to select it
- Edit the content in the main textarea — changes auto-save with a 500ms debounce
- For structured and journal notes, edit the title in the toolbar

### Version History

- Click the "history" button in the editor toolbar to view version history
- Every save that changes content creates a version snapshot
- Click "revert" on any version to restore that content (the current content is saved as a new version before reverting)

### Deleting Notes

- Click "delete" in the editor toolbar to remove the active note

---

## Artifacts / Search Panel

The bottom-right panel serves multiple functions, switchable via header buttons:

### Integration Queue (! button)

The integration queue tracks open threads — unresolved topics, tasks, or questions.

- Type in the input field and press Enter to add a new item
- Each item can be:
  - **Resolved** (ok button) — marks the thread as done
  - **Deferred** (-- button) — acknowledges it but sets it aside
  - **Reopened** (^ button) — moves a deferred item back to open
  - **Deleted** (x button) — permanently removes the item
- Open thread count is shown in the top bar

### Search (? button)

Full-text search across all your Guardian data:

- **Keyword mode** — SQLite FTS5 search across conversations, notes, and session summaries
- **Semantic mode** — searches against AI-generated semantic summaries of conversation chunks (meaning-based, not just keyword matching)
- Toggle between modes using the keyword/semantic buttons
- Results show type, title, and content snippet

### Sessions (# button)

Browse and manage your conversation history:

- Lists all sessions with title, start date, and token count
- Click any session to **resume** it — messages are loaded back into the chat panel, and the Claude CLI session ID is restored for continuity
- Click "summarize" to generate an AI-powered summary of the session
- Summaries are stored and searchable

### Knowledge Graph (diamond button)

A force-directed visualization of entities and relationships extracted from your conversations:

- **Entity types** — person (warm), concept (blue), project (green), decision (amber), question (warm neutral)
- Node size scales with mention count
- Pan by clicking and dragging the background
- Zoom with mouse wheel
- Hover over nodes for tooltip details
- Click a node to see related sessions — click a session to resume it
- Entity extraction runs automatically after each chat response

---

## ForgeFrame Model Routing

Guardian includes ForgeFrame, an intelligent model routing system.

### Available Models

| Model | Tier | Description |
|-------|------|-------------|
| Sonnet (claude-sonnet-4-5-20250929) | balanced | Code, writing, analysis |
| Opus (claude-opus-4-6) | deep | Complex reasoning, deep analysis |
| Haiku (claude-haiku-4-5-20251001) | quick | Quick questions, fast responses |

### Auto-Routing

When enabled (default), ForgeFrame automatically selects the optimal model based on your message:
- **Short messages** (< 20 chars) route to Haiku
- **Long messages** (> 500 chars) route to Opus
- Keywords like "analyze", "deep dive", "architecture", "trade-offs" trigger Opus
- Keywords like "quick", "brief", "tl;dr", "define" trigger Haiku
- Everything else routes to Sonnet

### Manual Override

- Click the model picker in the top bar to select a model manually
- Toggle auto-route on/off from the dropdown
- Manual selection always overrides auto-routing
- Configure the default model in Settings under AI Model

---

## Command Palette

Press **Ctrl+Shift+P** to open the command palette.

- Fuzzy-matched command search across all available actions
- Arrow keys to navigate, Enter to execute, Escape to close
- Most recently used commands appear at the top
- Commands include panel navigation, session management, note creation, search, backup/export, import, settings, and layout controls

### Available Commands

**Navigation:** Focus Terminal, Focus Chat, Focus Notes, Focus Search

**Session:** New Chat Session

**Notes:** New Scratch Note, New Structured Note, New Journal Entry

**Memory:** Search Memory

**Layout:** Maximize Focused Panel

**Settings:** Open Settings

**Backup & Data:** Create Backup, Restore from Backup, Export Current Session (Markdown), Export Session as JSON, Export All Notes, Export Full Data (JSON), Import Notes, Import Obsidian Vault

---

## Settings

Press **Ctrl+,** to open the Settings panel. Sections include:

### Profile
- View your architecture type, encoding preference, and integration load
- Re-take the architecture self-assessment

### AI Model
- Select default model (Sonnet, Opus, or Haiku)
- Toggle ForgeFrame auto-routing

### Context
- Toggle notes injection (on/off)
- Adjust max context tokens (500-4000, slider)

### Detection
- Toggle awareness-trap detection (on/off)

### Data
- View data directory path (~/.guardian)
- Set backup frequency (daily, weekly, manual only)

### Shortcuts
- View all keyboard shortcuts

### About
- Guardian version and credits

---

## Backup and Data

### Manual Backup

- **Ctrl+Shift+B** — create a backup immediately
- Or use the command palette: "Create Backup"
- Backups are saved to `~/.guardian/backups/`
- Format: .zip on Windows, .tar.gz on Unix
- Old backups are rotated (keeps last 5 by default)

### Auto Backup

Guardian checks for auto-backup on each startup. If the last backup is older than the configured interval (default: 24 hours), a new backup is created automatically.

Configure backup frequency in Settings under Data.

### Restore

- Command palette: "Restore from Backup"
- Opens a file dialog to select a .zip or .tar.gz backup file
- Extracts files back to `~/.guardian/`

### Export

- **Export Current Session** — saves the active conversation as Markdown or JSON
- **Export All Notes** — exports all notes as individual Markdown files to a chosen directory
- **Export Full Data (JSON)** — exports all sessions, notes, and usage data as a single JSON file

### Import

- **Import Notes** — import Markdown files as structured notes
- **Import Obsidian Vault** — import an entire Obsidian vault folder (reads YAML frontmatter for tags)

---

## Data Storage

All Guardian data is stored locally under `~/.guardian/`:

```
~/.guardian/
  config/
    settings.json       # User preferences
    layout.json         # Panel layout and window size
    profile.json        # Architecture self-assessment results
    keybindings.json    # Custom keyboard shortcuts
  data/
    guardian.db          # SQLite: sessions, messages, notes, artifacts, queue, usage, embeddings
  notes/
    scratch/            # Scratch note files
    structured/         # Structured note files
    journal/            # Journal entries
  artifacts/
    code/               # Code artifacts
    docs/               # Document artifacts
    media/              # Image/diagram artifacts
  backups/
    guardian-backup-*.zip/.tar.gz
  logs/
    guardian.log         # Application log (daily rotation)
```

The SQLite database uses WAL journal mode for performance and stores:
- Sessions and messages (with full-text search via FTS5)
- Notes with version history
- Integration queue items
- Usage/token tracking
- Semantic embedding chunks with FTS-indexed summaries
- Knowledge graph entities and relationships
- Awareness-trap dismissal records

### Local-First

No data leaves your machine. There is no cloud sync, no telemetry, and no analytics. The only network calls Guardian makes are to the Claude API (via the Claude CLI) for chat and embedding generation.

---

## Session Telemetry

Guardian tracks real-time cognitive load proxies during your sessions:

- **Token burn rate** — tokens consumed per minute over a rolling 2-minute window. Normalized to 0-1 where 1000 tok/min = 1.0.
- **Session duration** — minutes elapsed, normalized to 0-1 where 120 minutes = 1.0.
- **Exchange count** — number of user-assistant message pairs.
- **Thinking ratio** — percentage of Claude's output that was thinking blocks.
- **Drift detection** — analyzes changes in message length patterns and response cadence to detect shifts in interaction mode (consolidating, expanding, slowing, accelerating).

Telemetry state is pushed from the main process every 5 seconds and drives the ambient orbs and bottom bar display.

---

## Auto-Summarization

After each successful chat response, Guardian automatically generates a summary of the session using Claude CLI. Summaries are:
- Stored in the sessions table
- Searchable via full-text search
- Displayed in the session list in the Artifacts panel
- You can also manually trigger re-summarization with the "summarize" / "re-summarize" button

---

## Troubleshooting

### Claude CLI not found

Guardian expects `claude` to be on your PATH, or at `~/.local/bin/claude.exe`. If chat shows "Claude CLI not found", install the Claude Code CLI and ensure it is accessible.

### node-pty build issues

If the terminal shows "node-pty not available", run:

```
npx @electron/rebuild -f -w node-pty
```

### Database errors

Guardian uses better-sqlite3 (native module). If you see database errors after an Electron upgrade, rebuild native modules:

```
npx @electron/rebuild
```

### Data location

All data is at `~/.guardian/`. You can view the exact path in Settings under Data, or via the system info IPC channel.
