---
name: add-panel
description: Scaffold a new panel component for the Guardian UI layout
---

Create a new panel for the Guardian UI:

Panel name: $ARGUMENTS

Steps:
1. Create `src/panels/{PanelName}Panel.jsx` following the pattern in existing panels (TerminalPanel, ChatPanel, NotesPanel, SearchPanel)
2. Include PanelHeader component with appropriate label and action buttons
3. Add any new state slices needed in `src/store.js`
4. Add the panel to `src/App.jsx` in the Allotment layout (suggest placement)
5. Add any panel-specific CSS to `src/styles/panels.css`

Follow conventions in CLAUDE.md:
- Functional React component with hooks
- Self-contained local state, shared state in Zustand
- IPC channels prefixed with `guardian:`
- Dark theme using CSS variables from theme.css
