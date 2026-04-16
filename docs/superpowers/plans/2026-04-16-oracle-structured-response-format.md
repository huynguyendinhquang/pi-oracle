# Oracle Structured Response Format Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add structured response extraction and additive markdown/reference sidecars while keeping the current plain-text oracle response contract intact as the compatibility fallback.

**Architecture:** Keep `response.md` plus `responseFormat: "text/plain"` as the primary contract in phase 1. Add a structured DOM extraction path in the worker, persist additive `response.rich.*` sidecars, and surface extra paths in job metadata and read/status output. If any rich step fails, log it and fall back to the existing plain-text path instead of failing the job.

**Tech Stack:** TypeScript, Node.js, ESM worker scripts, `evalPage(...)`, local sanity tests.

---

### Task 1: Add failing sanity coverage for the new additive contract

**Files:**
- Modify: `scripts/oracle-sanity.ts`
- Optional modify: `scripts/oracle-sanity-support.ts`

- [ ] Add a failing sanity assertion that `extensions/oracle/worker/run-job.mjs` references a structured response helper path and a plain-text fallback path.
- [ ] Add a failing sanity assertion for the new rich sidecar filenames:
  - `response.rich.json`
  - `response.rich.md`
  - `response.references.json`
- [ ] Add a failing sanity assertion that the legacy plain-text contract is still present:

```ts
assert(workerSource.includes('responseFormat: "text/plain"'), 'worker should keep text/plain as the compatibility response format during phase 1');
```

- [ ] Run: `npm run sanity:oracle`
- [ ] Confirm the new assertions fail for the expected reasons.

### Task 2: Add additive job metadata for rich response assets

**Files:**
- Modify: `extensions/oracle/lib/jobs.ts`
- Modify: `extensions/oracle/shared/job-observability-helpers.d.mts`
- Modify: `extensions/oracle/shared/job-observability-helpers.mjs`

- [ ] Add optional job fields for rich response assets:

```ts
responseExtractionMode?: "structured-dom" | "plain-text-fallback";
markdownResponsePath?: string;
structuredResponsePath?: string;
referencesPath?: string;
```

- [ ] Keep these existing fields unchanged:

```ts
responsePath: string;
responseFormat?: "text/plain";
```

- [ ] Update observability helpers so read/status output can show additive paths when present, without changing the existing plain-text preview contract.
- [ ] Run: `npm run typecheck`
- [ ] Run: `npm run sanity:oracle`

### Task 3: Create pure response-format helpers

**Files:**
- Create: `extensions/oracle/worker/response-format-helpers.mjs`
- Create: `extensions/oracle/worker/response-format-helpers.d.mts`
- Test: `scripts/oracle-sanity.ts`

- [ ] Create a small helper module for pure formatting logic only. Start with shapes like:

```js
export function renderStructuredResponsePlainText(response) { /* ... */ }
export function renderStructuredResponseMarkdown(response) { /* ... */ }
export function buildResponseReferences(response) { /* ... */ }
```

- [ ] Keep this file free of browser orchestration. It should only normalize already-extracted response data.
- [ ] Add sanity coverage for representative fixtures:
  - inline link becomes markdown link
  - code block preserves fenced style
  - reference sidecar preserves `href`
- [ ] Run: `npm run check:oracle-extension`
- [ ] Run: `npm run sanity:oracle`

### Task 4: Add structured DOM extraction in the worker

**Files:**
- Modify: `extensions/oracle/worker/run-job.mjs`
- Use: `extensions/oracle/worker/response-format-helpers.mjs`
- Test: `scripts/oracle-sanity.ts`

- [ ] Add a new worker helper alongside `assistantMessages()` for structured extraction, e.g. `assistantMessagesStructured(job)`.
- [ ] Make the page-side extractor walk the final assistant response subtree and preserve at least:
  - paragraph text
  - `a[href]` links
  - lists
  - `pre/code`
  - blockquotes
  - simple tables
  - citation/source anchors
- [ ] Absolutize relative `href` values against `document.baseURI` inside the page-context extractor.
- [ ] Keep completion detection logic unchanged: it can still use the existing plain text derived from the target response.
- [ ] Run: `npm run check:oracle-extension`
- [ ] Run: `npm run sanity:oracle`

### Task 5: Add runtime fallback from structured extraction to legacy plain text

**Files:**
- Modify: `extensions/oracle/worker/run-job.mjs`
- Test: `scripts/oracle-sanity.ts`

- [ ] Wrap rich extraction so failure does not fail the job if legacy text extraction still works.
- [ ] Record the chosen mode in job metadata:

```js
responseExtractionMode: structuredOk ? 'structured-dom' : 'plain-text-fallback'
```

- [ ] Keep the legacy plain-text write path as the final compatibility anchor.
- [ ] Add sanity coverage that rich extraction failure still leaves the worker on the completion path, not the failure path.
- [ ] Run: `npm run sanity:oracle`

### Task 6: Persist additive rich sidecars

**Files:**
- Modify: `extensions/oracle/worker/run-job.mjs`
- Modify: `extensions/oracle/lib/jobs.ts`

- [ ] Write files under the job directory:

```text
response.md
response.rich.md
response.rich.json
response.references.json
```

- [ ] Keep `response.md` as the legacy plain-text file in phase 1.
- [ ] Populate additive job metadata paths only when the rich files were actually written.
- [ ] Do not fail the job solely because `response.rich.md` or `response.references.json` could not be written.
- [ ] Run: `npm run sanity:oracle`
- [ ] Run: `npm run typecheck:worker-helpers`

### Task 7: Preserve href/reference metadata first; keep artifact URL backfill optional

**Files:**
- Modify: `extensions/oracle/worker/run-job.mjs`
- Optional modify: `extensions/oracle/lib/jobs.ts`
- Test: `scripts/oracle-sanity.ts`

- [ ] Preserve inline link/reference metadata in the structured response payload even when the plain-text response stays unchanged.
- [ ] Add sanity coverage proving that visible link text alone is not the only preserved output.
- [ ] Only if the anchor-origin mapping is obvious and low-risk, populate `OracleArtifactRecord.url` for artifact candidates that come directly from stable anchors.
- [ ] If artifact URL backfill starts dragging in unrelated artifact-pipeline changes, stop and defer that part without blocking the core response-format rollout.
- [ ] Run: `npm run sanity:oracle`

### Task 8: Surface rich assets in read/status output

**Files:**
- Modify: `extensions/oracle/shared/job-observability-helpers.mjs`
- Modify: `extensions/oracle/lib/commands.ts`
- Modify: `extensions/oracle/lib/tools.ts`
- Test: `scripts/oracle-sanity-poller-suite.ts`

- [ ] Keep current plain-text preview behavior unchanged.
- [ ] Add additive metadata lines for:
  - `markdown-response`
  - `structured-response`
  - `references`
- [ ] Update any wake-up/read/status formatting tests that need to assert the new paths.
- [ ] Run: `npm run sanity:oracle`

### Task 9: Update docs for the additive contract

**Files:**
- Modify: `docs/ORACLE_DESIGN.md`
- Optional modify: `README.md`

- [ ] Document that phase 1 keeps `text/plain` as the compatibility contract.
- [ ] Document the new additive sidecars and fallback semantics.
- [ ] Document that markdown/reference fidelity is best-effort and derived from the live assistant DOM subtree.

### Task 10: Full verification in the worktree

**Files:**
- Verify repo state only

- [ ] Run: `npm run check:oracle-extension`
- [ ] Run: `npm run typecheck`
- [ ] Run: `npm run typecheck:worker-helpers`
- [ ] Run: `npm run sanity:oracle`
- [ ] Run: `npm run pack:check`
- [ ] Report exact pass/fail evidence.
- [ ] If live confirmation is needed, run a narrow oracle smoke after `/reload` and confirm the plain-text response still reads correctly while rich sidecars are present.
