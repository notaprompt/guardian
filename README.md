# Guardian

**External cognitive infrastructure for minds that don't turn off.**

Desktop app. Local SQLite. Your thinking persists instead of evaporating.

---

## What it does

**Persistent chat.** Messages stored locally. Sessions resume. Past context surfaces in new conversations when relevant.

**Post-chat pipeline.** After every response: summarize, extract patterns, build connections, compress. Session summaries become patterns, patterns become principles.

**Search your history.** Import Claude and ChatGPT archives. Full-text and semantic search across everything. Find things by what they mean.

**Multi-provider routing.** Claude, OpenAI, Ollama, Fireworks, Moonshot. Intent-based dispatch -- simple questions get fast models, deep reasoning gets frontier models.

**Notes with versions.** Scratch, structured, journal. Version history with revert. Mark anything sovereign to keep it out of AI context.

**Knowledge graph.** Entities and relationships extracted from conversations automatically. Grows over time.

**Awareness detection.** Surfaces topics you keep returning to across sessions. Flags patterns -- you decide what to do with them.

**Real terminal.** PTY via node-pty. Docks or floats. History searchable.

**Local-first.** No telemetry. No phone home. Your data stays on your machine.

---

## Not built yet

- Sovereign proxy integration (PII scrubbing before cloud LLMs)
- Local embedding model (currently uses Claude for semantic work)
- Automated conflict detection in integration queue

---

## Get started

Electron 33. React 18. Vite. Zustand. SQLite + FTS5. xterm.js + node-pty.

```bash
cd guardian-ui
npm install
npx @electron/rebuild -f -w node-pty
npm start
```

See `guardian-ui/README.md` for architecture and project structure.
