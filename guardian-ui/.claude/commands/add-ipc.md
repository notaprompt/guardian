---
name: add-ipc
description: Add a new IPC channel connecting Electron main process to React renderer
---

Add a new IPC channel for: $ARGUMENTS

Steps:
1. Add the `ipcMain.handle` or `ipcMain.on` handler in `main.js` under the appropriate section
2. Expose the channel through `preload.js` in the `contextBridge.exposeInMainWorld` block
3. Name the channel with `guardian:` prefix (e.g., `guardian:memory:search`)
4. If the channel returns data, use `ipcMain.handle` + `ipcRenderer.invoke` (async)
5. If fire-and-forget, use `ipcMain.on` + `ipcRenderer.send`
6. Add TypeScript-style JSDoc comment on the handler describing the expected payload shape
7. Update CLAUDE.md if this adds a new integration point
