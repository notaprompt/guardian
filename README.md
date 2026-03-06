# Guardian

**External cognitive infrastructure for minds that don't turn off.**

---

## What it is

You've had the conversation before. You've solved the problem before. You know you wrote it down somewhere. You just can't find it, so you rebuild from scratch, again, at 2am, with 47 tabs open.

Guardian is a desktop app that makes sure that stops happening. Everything you think through -- every conversation, every insight, every half-finished thread -- stays. On your machine. Searchable. Retrievable. Yours.

Not a note-taking app. Not a chatbot with a memory gimmick. A place where your thinking accumulates instead of evaporating.

---

## How it feels

You open Guardian and pick up where you left off. Not because it summarized your last session into a bullet list, but because the context is still there -- the threads, the patterns, the things you were circling.

You ask a question and it pulls in what you've already figured out. Not because it's watching you. Because you told it, and it remembered, and now it gives it back when you need it.

You import a year of Claude conversations and suddenly that insight from October is findable by what it meant, not what you titled it.

You notice a pattern you keep returning to. Guardian noticed it too. Not to tell you what to do about it -- just to surface it. You decide what matters. Always.

---

## What's here

This is a real application. ~31,700 lines across 24 backend modules and 30 React components. Everything below is built, wired, and working.

**Your conversations persist.** Every message lives in local SQLite. Sessions resume. Context from past conversations shows up in new ones when it's relevant.

**Your thinking compounds.** After every conversation, a pipeline runs: summarize, extract patterns, build connections, compress into durable knowledge. Three levels of compression -- session summaries become patterns, patterns become principles. Not concatenation. Actual synthesis.

**Your history is searchable.** Import Claude and ChatGPT archives. Full-text search and semantic retrieval across everything you've ever thought through with AI. Find things by what they mean.

**Your models work for you.** Five LLM providers (Claude, OpenAI, Ollama, Fireworks, Moonshot). ForgeFrame routes by intent -- quick questions get fast models, deep reasoning gets frontier models. Or you pick. Your call.

**Your notes have versions.** Scratch pad for the 3am thought. Structured notes for the design doc. Journal entries. Full version history. Mark anything sovereign to keep it out of AI context entirely.

**Your terminal is real.** Actual PTY. Docks or floats. History is searchable. No emulation.

**Your connections are visible.** Knowledge graph extracts entities and relationships from conversations. Grows over time. See the shape of what you've been thinking about.

**Your sovereignty is structural.** Nothing phones home. No telemetry. Local SQLite. The integration queue doesn't auto-resolve conflicts -- it surfaces them and you decide. Sensitive notes stay out of AI context. Your data never leaves your machine unless you send it.

---

## What's not here yet

- Guardian as a client of the ForgeFrame memory server (bridge written, not activated)
- Sovereign proxy integration (scrub PII before it reaches cloud LLMs)
- Local embedding model (currently uses Claude for semantic work)
- Automated conflict detection in the integration queue

---

## For developers

Electron 33. React 18. Vite. Zustand. SQLite + FTS5. xterm.js + node-pty.

```bash
cd guardian-ui
npm install
npx @electron/rebuild -f -w node-pty
npm start
```

See `guardian-ui/README.md` for full architecture, data flow diagrams, and project structure.

---

*Built because every mind deserves a guardian.*
