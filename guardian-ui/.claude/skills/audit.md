---
name: audit
description: Run a security and architecture audit on Guardian's codebase. Checks Electron security, IPC validation, dependency vulnerabilities, and TRIM compliance.
user_invocable: true
---

Run a comprehensive security and architecture audit on Guardian.

## Audit checklist

### Electron security
- [ ] `nodeIntegration` is false in BrowserWindow
- [ ] `contextIsolation` is true
- [ ] `sandbox` is enabled where possible
- [ ] No raw `ipcRenderer` exposed to renderer
- [ ] All IPC channels validated in main process
- [ ] No `shell.openExternal` with unvalidated URLs
- [ ] CSP headers set in HTML

### IPC validation
- [ ] All `guardian:*` IPC handlers validate input types
- [ ] No arbitrary code execution via IPC payloads
- [ ] File path arguments are sanitized (no path traversal)
- [ ] PTY commands are not injectable

### Dependencies
- Run `npm audit` and report findings
- Check for outdated packages with `npm outdated`
- Flag any known CVEs in production dependencies

### Data security
- [ ] API keys stored via secure-store.js (not plaintext)
- [ ] SQLite database not world-readable
- [ ] No secrets in committed code or git history
- [ ] .gitignore covers sensitive files

### Architecture
- [ ] State flows correctly: Main -> IPC -> Zustand -> React
- [ ] No renderer-side Node.js API usage
- [ ] Error boundaries in place for panel components
- [ ] Memory/database operations don't block main thread

## Output

Report findings organized by severity (Critical / Warning / Info) with specific file:line references and recommended fixes.
