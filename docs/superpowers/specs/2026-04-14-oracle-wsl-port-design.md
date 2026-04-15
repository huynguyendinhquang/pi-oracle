# Oracle WSL Port Design

## Goal

Make this fork installable and usable as a `pi` extension from WSL, without being blocked by the current macOS-only packaging and defaults.

## Scope

This design covers the first WSL-focused port:
- WSL2
- Google Chrome inside WSL
- `pi` local extension loading from this fork
- `/oracle-auth`, `/oracle`, `/oracle-followup`, `/oracle-read`, and `/oracle-status`

Non-goals:
- Windows Chrome reuse from WSL
- Chromium support
- native Windows support

## Design

### Packaging
- Remove the macOS-only `os` restriction from `package.json`.
- Keep the package installable from GitHub/npm in WSL.

### Platform-aware defaults
In `extensions/oracle/lib/config.ts`:
- detect platform-specific Chrome executable candidates
  - macOS: `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`
  - Linux/WSL: `/usr/bin/google-chrome`, `/usr/bin/google-chrome-stable`
- detect platform-specific Chrome user-data roots
  - macOS: `~/Library/Application Support/Google/Chrome`
  - Linux/WSL: `~/.config/google-chrome`
- default `cloneStrategy`
  - macOS: `apfs-clone`
  - Linux/WSL: `copy`
- generate a platform-matching Chrome user agent string when auto-detecting Chrome
- keep macOS behavior unchanged

### Auth bootstrap
In `extensions/oracle/worker/auth-bootstrap.mjs`:
- replace macOS-specific real-profile root assumptions with platform-aware Chrome user-data roots
- update messaging from “real Chrome/macOS/Keychain” wording to neutral “configured Chrome profile” wording
- keep the cookie import path as the preferred path
- add a fallback manual-login path:
  1. if cookie import/bootstrap fails, start a clean staged oracle auth profile
  2. open the isolated auth browser headed
  3. let the user sign into ChatGPT manually
  4. wait until ChatGPT is authenticated and ready
  5. commit the staged profile as the reusable oracle auth seed

### Runtime and worker behavior
In `extensions/oracle/lib/runtime.ts` and related worker code:
- keep current runtime behavior mostly intact
- allow Linux-friendly `agent-browser` lookup alongside existing macOS-oriented paths
- rely on valid browser/profile paths plus `copy` cloning on Linux

### Verification
- update sanity checks so the package is no longer asserted to be macOS-only
- add sanity coverage for Linux/WSL defaults and for the removal of macOS-only auth messaging
- run repo verification
- then validate with isolated `pi` sessions loading the local extension in WSL

## Acceptance criteria
- package is installable in WSL
- WSL Chrome defaults are detected/configurable cleanly
- `/oracle-auth` works through cookie import or manual fallback
- macOS defaults still behave as before
