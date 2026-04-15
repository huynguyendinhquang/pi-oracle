# Oracle WSL Port Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the fork installable and runnable as a `pi` extension in WSL, removing macOS-only packaging and adding WSL-friendly browser/auth defaults with manual auth fallback.

**Architecture:** Keep the existing isolated seed/runtime profile model. Add platform-aware configuration defaults and make auth bootstrap prefer cookie import but recover with a staged manual-login fallback when cookie import fails.

**Tech Stack:** TypeScript, Node.js, ESM worker scripts, `agent-browser`, local sanity tests.

---

### Task 1: Add failing sanity coverage for WSL support

**Files:**
- Modify: `scripts/oracle-sanity.ts`

- [ ] Add a failing sanity assertion that `package.json` is not macOS-only.
- [ ] Add a failing sanity assertion for platform-aware clone strategy defaults.
- [ ] Add a failing sanity assertion that auth bootstrap no longer contains macOS Keychain guidance.
- [ ] Run: `npm run sanity:oracle`
- [ ] Confirm the new assertions fail for the expected reasons.

### Task 2: Remove macOS-only packaging lock

**Files:**
- Modify: `package.json`
- Test: `scripts/oracle-sanity.ts`

- [ ] Remove the `os: ["darwin"]` restriction from `package.json`.
- [ ] Run: `npm run sanity:oracle`
- [ ] Confirm the packaging assertion now passes and remaining failures are expected.

### Task 3: Add platform-aware config defaults

**Files:**
- Modify: `extensions/oracle/lib/config.ts`
- Test: `scripts/oracle-sanity.ts`

- [ ] Add helpers for platform-specific Chrome executable candidates.
- [ ] Add helpers for platform-specific Chrome user-data roots.
- [ ] Make default clone strategy `copy` on Linux/WSL and `apfs-clone` on macOS.
- [ ] Make auto-generated user agent match the current platform.
- [ ] Update profile safety checks to reject the real Chrome user-data directory for the current platform.
- [ ] Run: `npm run typecheck`
- [ ] Run: `npm run sanity:oracle`

### Task 4: Generalize auth bootstrap and add manual fallback

**Files:**
- Modify: `extensions/oracle/worker/auth-bootstrap.mjs`
- Test: `scripts/oracle-sanity.ts`

- [ ] Replace macOS-specific Chrome profile assumptions with platform-aware ones.
- [ ] Remove macOS-only remediation text.
- [ ] Add a manual-login fallback path when cookie import/bootstrap fails.
- [ ] Keep staged-profile commit behavior for successful manual auth.
- [ ] Run: `npm run check:oracle-extension`
- [ ] Run: `npm run sanity:oracle`

### Task 5: Tidy runtime lookup and diagnostics

**Files:**
- Modify: `extensions/oracle/lib/runtime.ts`

- [ ] Add Linux-friendly `agent-browser` path candidates while preserving PATH fallback.
- [ ] Keep runtime cleanup and lease logic unchanged.
- [ ] Run: `npm run check:oracle-extension`
- [ ] Run: `npm run typecheck:worker-helpers`

### Task 6: Update docs for WSL usage

**Files:**
- Modify: `README.md`
- Optional modify/create: `docs/ORACLE_DESIGN.md`, `docs/ORACLE_WSL_SETUP.md`

- [ ] Update installation/requirements language so the fork is no longer documented as macOS-only.
- [ ] Document WSL Chrome expectations and the `/oracle-auth` fallback behavior.
- [ ] Add the fork GitHub install URL where appropriate.

### Task 7: Full verification

**Files:**
- Verify repo state only

- [ ] Run: `npm run check:oracle-extension`
- [ ] Run: `npm run typecheck`
- [ ] Run: `npm run typecheck:worker-helpers`
- [ ] Run: `npm run sanity:oracle`
- [ ] Report exact pass/fail evidence.
- [ ] If local environment blocks a command, state the blocker explicitly and do not claim success.
