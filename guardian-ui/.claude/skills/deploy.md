---
name: deploy
description: Build and package Guardian for distribution. Runs Vite production build, rebuilds native modules for Electron, and packages with electron-builder.
user_invocable: true
---

Build and package Guardian for distribution.

## Steps

1. Run `npm run build` to create the Vite production bundle
2. Run `npx electron-rebuild -f -w node-pty,better-sqlite3` to rebuild native modules
3. Set `CSC_IDENTITY_AUTO_DISCOVERY=false` to skip code signing for local builds
4. Run `npx electron-builder --win` to create the Windows installer

## Important notes

- Kill any running Guardian.exe processes before building (they lock the release directory)
- Use PNG for the Windows icon — electron-builder auto-converts
- Windows needs Developer Mode ON for symlink permissions
- The `release/` directory contains the built output
- node-pty must be beta.10 for ConPTY support on Windows
- If better-sqlite3 fails to rebuild, try `npx electron-rebuild -f -w better-sqlite3 -t prod`

## Output

Report build success/failure and the path to the built installer.
