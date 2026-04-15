# Oracle WSL Port Handoff

Status: planning handoff for local work in `~/dev/pi-oracle`
Date: 2026-04-14
Owner for next steps: current pi session/operator

## Purpose

This document explains, in plain language, how to port `pi-oracle` from its current macOS-first setup to a **WSL-first setup using Google Chrome inside WSL**.

It is meant to help the next person pick up the work, understand the risks, and know what to change first.

## Current upstream state

Today, `pi-oracle` is designed and packaged primarily for:

- macOS
- Google Chrome
- `agent-browser`
- isolated browser profiles per job
- ChatGPT auth copied from the user's normal Chrome profile into a separate oracle auth seed profile

Important facts from the current repo:

- `package.json` currently restricts installs to `darwin`
- `extensions/oracle/lib/config.ts` has macOS Chrome defaults
- `extensions/oracle/worker/auth-bootstrap.mjs` assumes macOS-style Chrome profile paths and messaging
- runtime job execution is already mostly platform-agnostic once browser/profile paths are valid

## Target for the first WSL port

Keep the first scope intentionally narrow:

- **Platform:** WSL2
- **Browser:** Google Chrome for Linux running inside WSL
- **Auth source:** a Chrome profile inside WSL, not Windows Chrome
- **Goal:** get `/oracle-auth`, `/oracle`, `/oracle-followup`, `/oracle-read`, and `/oracle-status` working end-to-end

## Non-goals for v1

Do not try to solve these in the first pass:

- Windows Chrome profile reuse from WSL
- Chromium support
- native Windows support
- official upstream adoption on day one
- broad refactors unrelated to WSL support

## Plain-English architecture

The intended WSL flow is:

1. The user installs Chrome inside WSL.
2. The user logs into ChatGPT in that WSL Chrome profile.
3. `/oracle-auth` reads that WSL Chrome login state and copies it into a separate oracle auth seed profile.
4. Each `/oracle` job clones that seed profile into a temporary runtime profile.
5. The worker opens ChatGPT.com in that isolated runtime browser.
6. The worker uploads the repo archive and prompt.
7. The worker saves the reply and artifacts locally.
8. The poller wakes the matching `pi` session if possible.

That means the clean WSL design is still the same design as upstream. Only the browser environment changes.

## Recommended approach

Use a **hybrid auth strategy**:

### Preferred path

Keep the current auth model:

- read cookies from a normal WSL Chrome profile
- seed the isolated oracle auth profile
- verify auth there

### Fallback path

If cookie import is unreliable on WSL, allow `/oracle-auth` to:

- open the isolated oracle auth browser
- let the user complete login manually once
- save that isolated profile as the oracle seed profile

### Why this hybrid is recommended

- It preserves the current, nicer architecture if Linux cookie import works.
- It gives a practical escape hatch if Linux cookie import is flaky.
- It reduces the chance of getting stuck on one dependency during the first port.

## Main technical unknown

The biggest open question is whether the current cookie-reading approach works cleanly against **Google Chrome inside WSL**.

If it does, the port is straightforward.
If it does not, the manual-login fallback becomes the fastest path to a working beta.

## File-by-file change plan

## 1) `package.json`

### Current issue
The package is marked macOS-only.

### Change
Remove or widen:

```json
"os": ["darwin"]
```

### Goal
Allow install and test on Linux/WSL.

---

## 2) `extensions/oracle/lib/config.ts`

### Current issue
This file hardcodes macOS defaults such as:

- `/Applications/Google Chrome.app/...`
- `~/Library/Application Support/Google/Chrome`
- clone strategy defaulting to `apfs-clone`

### Change
Add platform-aware defaults.

For Linux/WSL, detect sensible defaults like:

- executable candidates:
  - `/usr/bin/google-chrome`
  - `/usr/bin/google-chrome-stable`
- profile root candidates:
  - `~/.config/google-chrome`
- clone strategy:
  - `copy`

### Goal
Make a fresh WSL install usable without hand-editing everything.

---

## 3) `extensions/oracle/worker/auth-bootstrap.mjs`

### Current issue
This is the main macOS-specific file.
It assumes macOS Chrome profile layout and includes macOS-specific help text.

### Change
Make auth bootstrap browser-source aware instead of macOS-specific.

#### Specific updates
- Replace hardcoded macOS real-Chrome profile root checks with platform-aware profile roots.
- Make profile safety checks work for Linux Chrome paths.
- Update error messages to say "configured browser profile" instead of implying macOS.
- Remove macOS-only guidance such as Keychain-specific wording.
- If needed, add a fallback mode for manual login directly in the isolated seed profile.

### Goal
Make `/oracle-auth` work in WSL using a WSL Chrome profile.

---

## 4) `extensions/oracle/lib/runtime.ts`

### Current issue
Some browser/dependency checks are generic, but defaults and assumptions still lean Mac.

### Change
- Ensure Linux executable checks are clear and friendly.
- Ensure `cloneStrategy: copy` is the default on Linux.
- Keep prerequisite checks for:
  - `agent-browser`
  - `tar`
  - `zstd`
- Improve diagnostics if Chrome is missing from expected Linux paths.

### Goal
Give clear setup errors in WSL instead of confusing Mac-oriented ones.

---

## 5) `extensions/oracle/worker/run-job.mjs`

### Current issue
The worker is fairly portable already, but needs validation under Linux paths and copy-mode profile cloning.

### Change
- Confirm runtime profile cloning works with Linux Chrome profiles.
- Confirm headed/headless launches work under WSL.
- Confirm uploads/downloads still work with `agent-browser` on WSL.

### Goal
Avoid changing this file unless WSL-specific browser behavior forces it.

---

## 6) Documentation

### Files to update
- `README.md`
- `docs/ORACLE_DESIGN.md`
- add a new WSL setup document if needed

### Recommended new doc
- `docs/ORACLE_WSL_SETUP.md`

### Goal
Give non-experts a reliable setup flow.

## Suggested implementation order

### Phase 1: environment proof
Do these before large code edits:

1. Install Google Chrome inside WSL.
2. Verify Chrome launches via `agent-browser`.
3. Log into ChatGPT in the WSL Chrome profile.
4. Test whether the current cookie-reading path can see that login.
5. Test a minimal isolated-profile bootstrap.

If Phase 1 fails only at cookie import, do not abandon the whole effort. Switch to the manual-login fallback design.

### Phase 2: platform defaults
Implement Linux/WSL-aware defaults in config and auth bootstrap.

### Phase 3: end-to-end validation
Run real jobs from isolated `pi` sessions and verify:

- `/oracle-auth`
- `/oracle`
- `/oracle-followup`
- `/oracle-read`
- `/oracle-status`
- job cleanup
- artifact download behavior

### Phase 4: packaging and release
Only after end-to-end validation passes:

- push fork updates to GitHub
- publish a beta npm package if desired
- document installation clearly

## Acceptance criteria for the WSL beta

A first beta is successful if all of these are true:

- package installs on WSL
- Chrome inside WSL can be detected or configured cleanly
- `/oracle-auth` succeeds with WSL Chrome
- `/oracle` submits a real job and gets a real ChatGPT response
- follow-up jobs reopen the same ChatGPT thread
- artifacts, if any, save correctly
- cleanup removes runtime profiles after completion
- macOS behavior is not broken by the port

## Testing plan

The repo's own instructions say code changes must be tested in isolated `pi` sessions using this local extension.

Minimum testing should include:

1. **Static checks**
   - `npm run check:oracle-extension`
   - `npm run typecheck`
   - `npm run typecheck:worker-helpers`

2. **Repo validation**
   - `npm run sanity:oracle`

3. **WSL local-extension validation**
   - run isolated `pi` sessions loading the local repo version
   - use `instant` or `thinking_light` during extension validation

4. **Real auth test**
   - complete `/oracle-auth`
   - verify ChatGPT ready state

5. **Real submission test**
   - run a small oracle request first
   - then a follow-up request

6. **Failure-mode tests**
   - missing Chrome path
   - missing seed profile
   - stale auth
   - cleanup after cancellation

## Release and publishing notes

## GitHub
Yes, this can be pushed as a fork or derivative repo on GitHub after local validation.

## npm
Yes, the repo is already shaped like a `pi` package and can be published once it passes validation.

Recommended release strategy:

- publish as a **beta/community fork first**
- validate with real WSL users
- only then consider a stable release

## "Official" status

This is not a technical toggle.

A package can be:

1. a working community package
2. a published npm package
3. a featured/forked package
4. an official upstream-recommended package

Only the first two are fully under the operator's control.
"Official" depends on maintainer buy-in, trust, support expectations, and stability.

## Recommendation on branding and release

Do this in order:

1. make the WSL port work locally
2. test it in isolated `pi` sessions
3. push the fork to GitHub
4. publish a beta package if desired
5. gather evidence that it is stable
6. only then discuss whether it should become an official upstream fork/recommendation

## First practical next steps in this repo

1. Create a working branch for the WSL port.
2. Probe the WSL environment for:
   - Chrome path
   - Chrome profile path
   - `agent-browser`
   - `tar`
   - `zstd`
3. Decide whether current cookie import works against WSL Chrome.
4. If it works, implement the native-profile-import path.
5. If it does not, implement the manual-login fallback in `/oracle-auth`.
6. Validate through isolated local `pi` sessions.

## Decision summary

For the first WSL version, the recommended decision is:

- **Target:** WSL + Google Chrome only
- **Architecture:** keep isolated seed/runtime profile model
- **Auth:** prefer WSL Chrome cookie import, fall back to manual login if needed
- **Release:** community beta first, not "official" first

## Notes for the next operator

Stay disciplined about scope. The biggest risk is not the worker itself. The biggest risk is spending too much time trying to make WSL interoperate with Windows Chrome state.

Keep everything WSL-native for v1.
That is the cleanest and most realistic path.
