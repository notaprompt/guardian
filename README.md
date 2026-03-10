# Guardian

**Local control plane for model inference. Your data, your machine, provable.**

Desktop application that intercepts, scrubs, routes, logs, and remembers every interaction between you and cloud models. Everything stays on your machine.

---

## What it does

Guardian sits at the inference boundary -- the point where your data meets a model. Every request passes through a local pipeline: intercept the prompt, scrub sensitive content, inject relevant context from memory, forward to the provider, rehydrate the response, and log everything. The pipeline is modality-agnostic. Chat was the first interface, not the product.

### Interfaces into the control plane

**Chat.** Multi-provider routing with automatic context injection from local memory. Past conversations surface when relevant.

**Notes.** Scratch, structured, journal. Version history with revert. Mark anything private to exclude it from model context.

**Terminal.** Real PTY via node-pty. Docks or floats. History captured and searchable.

**Awareness.** Surfaces topics you keep returning to across sessions. Flags patterns for review.

**Search.** Import Claude and ChatGPT archives. Full-text and semantic search across everything.

**Knowledge graph.** Entities and relationships extracted from conversations. Grows over time.

**Session instruments.** Token usage, session depth, integration queue status. Visible without demanding attention.

---

## Not built yet

- Local proxy pipeline (PII scrubbing before cloud LLMs)
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
