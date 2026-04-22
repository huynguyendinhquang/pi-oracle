# Oracle Configurable Response Format Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a configurable `response.defaultFormat` on the `feat/oracle-structured-response-formats` worktree so `/oracle-read` can prefer markdown when available while preserving `response.md` and existing plain-text compatibility.

**Architecture:** This is a presentation-only Phase D pass. The worker keeps writing `response.md` plus best-effort rich sidecars, then resolves an additive `preferredResponseFormat` and `preferredResponsePath` onto the job record from config and available files. Readers (`/oracle-read`, `oracle_read`, summaries) switch to the preferred artifact for preview only; wake-up transport and wake-up content remain unchanged.

**Tech Stack:** Node ESM, existing oracle config loader, persisted `OracleJob` metadata, slash commands, oracle tools, sanity suite, poller suite.

---

## File Structure

### Files to modify
- `extensions/oracle/lib/config.ts`
  - Add `response.defaultFormat` to the config schema, defaults, project-override allowlist, and validation.
- `extensions/oracle/lib/jobs.ts`
  - Add additive preferred-response metadata fields to `OracleJob`.
- `extensions/oracle/worker/run-job.mjs`
  - Resolve and persist `preferredResponseFormat` / `preferredResponsePath` after response persistence completes.
- `extensions/oracle/lib/commands.ts`
  - Make `/oracle-read` preview the preferred artifact while keeping `/oracle-status` metadata-only.
- `extensions/oracle/lib/tools.ts`
  - Make `oracle_read` tool preview the preferred artifact and expose preferred metadata in details.
- `extensions/oracle/shared/job-observability-helpers.mjs`
  - Surface `preferred-response-format:` and `preferred-response:` lines in summaries.
- `extensions/oracle/shared/job-observability-helpers.d.mts`
  - Add preferred-response fields to shared summary typing.
- `scripts/oracle-sanity.ts`
  - Add source-level regression checks for config schema, preferred-response metadata, and reader selection behavior.
- `scripts/oracle-sanity-poller-suite.ts`
  - Add no-regression checks proving wake-up content/semantics stay unchanged.
- `docs/ORACLE_DESIGN.md`
  - Document `response.defaultFormat` and preferred-response metadata as a worktree-branch capability.

### Files intentionally NOT modified in Phase D first pass
- `extensions/oracle/lib/poller.ts`
- `extensions/oracle/shared/job-lifecycle-helpers.mjs`
- `extensions/oracle/lib/queue.ts`
- `extensions/oracle/worker/response-format-helpers.mjs`

Reason: Phase D must stay presentation-only and must not introduce another wake-up/completion variable while branch stabilization work continues.

---

### Task 1: Add response-format preference to config

**Files:**
- Modify: `extensions/oracle/lib/config.ts`
- Test: `scripts/oracle-sanity.ts`

- [ ] **Step 1: Write failing config-schema assertions in `scripts/oracle-sanity.ts`**

Add assertions near the existing config-source checks that require the new response section, enum validation, and project-override safety.

```ts
assert(configSource.includes('response: {') && configSource.includes('defaultFormat:'), 'oracle config should define response.defaultFormat');
assert(configSource.includes('const RESPONSE_FORMATS = ["markdown", "plain"] as const;'), 'oracle config should define allowed response formats');
assert(configSource.includes('PROJECT_OVERRIDE_KEYS = new Set(["defaults", "worker", "poller", "artifacts", "cleanup", "response"])'), 'oracle project config should allow response.* overrides');
assert(configSource.includes('defaultFormat: "markdown"'), 'oracle default config should prefer markdown on the worktree branch');
assert(configSource.includes('expectEnum(response.defaultFormat, "response.defaultFormat", RESPONSE_FORMATS)'), 'oracle config validation should reject invalid response.defaultFormat values');
```

- [ ] **Step 2: Run sanity to prove the new assertions fail first**

Run:
```bash
cd /home/dev/dev/pi-oracle/.worktrees/oracle-structured-response-formats
npm run sanity:oracle
```

Expected: FAIL with one of the new `response.defaultFormat` assertion messages.

- [ ] **Step 3: Implement config support in `extensions/oracle/lib/config.ts`**

Add the response-format enum, config shape, default config, project override allowlist, and validation.

```ts
export const RESPONSE_FORMATS = ["markdown", "plain"] as const;
export type OracleResponseDefaultFormat = (typeof RESPONSE_FORMATS)[number];
```

```ts
const PROJECT_OVERRIDE_KEYS = new Set(["defaults", "worker", "poller", "artifacts", "cleanup", "response"]);
```

```ts
export interface OracleConfig {
  defaults: {
    preset: OracleSubmitPresetId;
  };
  response: {
    defaultFormat: OracleResponseDefaultFormat;
  };
  browser: {
    sessionPrefix: string;
    authSeedProfileDir: string;
    runtimeProfilesDir: string;
    maxConcurrentJobs: number;
    cloneStrategy: OracleCloneStrategy;
    chatUrl: string;
    authUrl: string;
    runMode: OracleBrowserRunMode;
    executablePath?: string;
    userAgent?: string;
    args: string[];
  };
  // ...rest unchanged
}
```

```ts
export const DEFAULT_CONFIG: OracleConfig = {
  defaults: {
    preset: "pro_extended",
  },
  response: {
    defaultFormat: "markdown",
  },
  browser: {
    sessionPrefix: "oracle",
    authSeedProfileDir: join(agentExtensionsDir, "oracle-auth-seed-profile"),
    runtimeProfilesDir: join(agentExtensionsDir, "oracle-runtime-profiles"),
    maxConcurrentJobs: 2,
    cloneStrategy: defaultCloneStrategy(),
    chatUrl: "https://chatgpt.com/",
    authUrl: "https://chatgpt.com/auth/login",
    runMode: defaultBrowserRunMode(),
    executablePath: detectedChromeExecutablePath,
    userAgent: detectedChromeUserAgent,
    args: defaultBrowserArgs(),
  },
  // ...rest unchanged
};
```

```ts
const response = expectObject(root.response, "response");
```

```ts
response: {
  defaultFormat: expectEnum(response.defaultFormat, "response.defaultFormat", RESPONSE_FORMATS),
},
```

- [ ] **Step 4: Run config-focused verification**

Run:
```bash
cd /home/dev/dev/pi-oracle/.worktrees/oracle-structured-response-formats
npm run check:oracle-extension
npm run sanity:oracle
```

Expected: PASS.

- [ ] **Step 5: Commit Task 1**

```bash
cd /home/dev/dev/pi-oracle/.worktrees/oracle-structured-response-formats
git add extensions/oracle/lib/config.ts scripts/oracle-sanity.ts
git commit -m "feat(oracle): add response format preference config"
```

---

### Task 2: Persist preferred response metadata on the job

**Files:**
- Modify: `extensions/oracle/lib/jobs.ts`
- Modify: `extensions/oracle/worker/run-job.mjs`
- Test: `scripts/oracle-sanity.ts`

- [ ] **Step 1: Write failing job-metadata assertions in `scripts/oracle-sanity.ts`**

Add assertions requiring new preferred-response fields on the job interface and terminal patch.

```ts
assert(jobsSource.includes('preferredResponseFormat?: "markdown" | "plain";'), 'OracleJob should include preferredResponseFormat');
assert(jobsSource.includes('preferredResponsePath?: string;'), 'OracleJob should include preferredResponsePath');
assert(workerSource.includes('preferredResponseFormat: preferredResponse.format,'), 'worker should persist preferredResponseFormat on terminal jobs');
assert(workerSource.includes('preferredResponsePath: preferredResponse.path,'), 'worker should persist preferredResponsePath on terminal jobs');
assert(workerSource.includes('const preferredResponse = resolvePreferredResponse('), 'worker should resolve preferred response metadata after persistence');
```

- [ ] **Step 2: Run sanity to confirm failure**

Run:
```bash
cd /home/dev/dev/pi-oracle/.worktrees/oracle-structured-response-formats
npm run sanity:oracle
```

Expected: FAIL on preferred-response assertions.

- [ ] **Step 3: Extend `OracleJob` in `extensions/oracle/lib/jobs.ts`**

Add additive preferred-response fields only.

```ts
responsePath: string;
responseFormat?: "text/plain";
responseExtractionMode?: "structured-dom" | "plain-text-fallback";
markdownResponsePath?: string;
structuredResponsePath?: string;
referencesPath?: string;
preferredResponseFormat?: "markdown" | "plain";
preferredResponsePath?: string;
artifactPaths: string[];
```

- [ ] **Step 4: Add preferred-response resolution in `extensions/oracle/worker/run-job.mjs`**

Add a small helper near `persistResponseFiles()` that resolves reader preference from config and available artifacts after persistence succeeds.

```js
function resolvePreferredResponse(job, sidecarPaths) {
  const preferred = job.config.response.defaultFormat;
  if (preferred === "markdown" && sidecarPaths.markdownResponsePath) {
    return { format: "markdown", path: sidecarPaths.markdownResponsePath };
  }
  return { format: "plain", path: job.responsePath };
}
```

Use it after `persistResponseFiles(...)` returns and before the final terminal patch is written.

```js
const sidecarPaths = await persistResponseFiles(currentJob, completion);
const preferredResponse = resolvePreferredResponse(currentJob, sidecarPaths);
```

Persist it in both completion branches that already write the terminal patch.

```js
patch: {
  responsePath: currentJob.responsePath,
  responseFormat: "text/plain",
  markdownResponsePath: sidecarPaths.markdownResponsePath,
  structuredResponsePath: sidecarPaths.structuredResponsePath,
  referencesPath: sidecarPaths.referencesPath,
  preferredResponseFormat: preferredResponse.format,
  preferredResponsePath: preferredResponse.path,
  artifactFailureCount,
  responseExtractionMode: completion.responseExtractionMode,
  cleanupPending: true,
},
```

- [ ] **Step 5: Run focused verification**

Run:
```bash
cd /home/dev/dev/pi-oracle/.worktrees/oracle-structured-response-formats
npm run check:oracle-extension
npm run sanity:oracle
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit Task 2**

```bash
cd /home/dev/dev/pi-oracle/.worktrees/oracle-structured-response-formats
git add extensions/oracle/lib/jobs.ts extensions/oracle/worker/run-job.mjs scripts/oracle-sanity.ts
git commit -m "feat(oracle): persist preferred response metadata"
```

---

### Task 3: Make `/oracle-read` and `oracle_read` preview the preferred artifact

**Files:**
- Modify: `extensions/oracle/lib/commands.ts`
- Modify: `extensions/oracle/lib/tools.ts`
- Modify: `extensions/oracle/shared/job-observability-helpers.mjs`
- Modify: `extensions/oracle/shared/job-observability-helpers.d.mts`
- Test: `scripts/oracle-sanity.ts`

- [ ] **Step 1: Write failing reader/summarizer assertions in `scripts/oracle-sanity.ts`**

Add source assertions for preferred-preview selection and additive summary lines.

```ts
assert(commandsSource.includes('const previewPath = job.preferredResponsePath || job.responsePath;'), '/oracle-read should preview the preferred response path');
assert(toolsSource.includes('const previewPath = current.preferredResponsePath || current.responsePath;'), 'oracle_read tool should preview the preferred response path');
assert(observabilitySource.includes('const preferredResponseFormatLine = job.preferredResponseFormat ? `preferred-response-format: ${job.preferredResponseFormat}` : undefined;'), 'job summary should surface preferred response format');
assert(observabilitySource.includes('const preferredResponseLine = job.preferredResponsePath ? `preferred-response: ${job.preferredResponsePath}` : undefined;'), 'job summary should surface preferred response path');
```

- [ ] **Step 2: Run sanity to confirm failure**

Run:
```bash
cd /home/dev/dev/pi-oracle/.worktrees/oracle-structured-response-formats
npm run sanity:oracle
```

Expected: FAIL on reader/summarizer assertions.

- [ ] **Step 3: Update shared summary typing in `job-observability-helpers.d.mts`**

Extend the summary-like interface.

```ts
preferredResponseFormat?: "markdown" | "plain";
preferredResponsePath?: string;
```

- [ ] **Step 4: Update summary output in `job-observability-helpers.mjs`**

Add preferred-response lines without removing existing lines.

```js
const preferredResponseFormatLine = job.preferredResponseFormat ? `preferred-response-format: ${job.preferredResponseFormat}` : undefined;
const preferredResponseLine = job.preferredResponsePath ? `preferred-response: ${job.preferredResponsePath}` : undefined;
```

Insert them after the existing response lines.

```js
responseLine,
responseFormatLine,
responseExtractionModeLine,
markdownResponseLine,
structuredResponseLine,
referencesLine,
preferredResponseFormatLine,
preferredResponseLine,
```

- [ ] **Step 5: Update `/oracle-read` preview path in `extensions/oracle/lib/commands.ts`**

Keep `/oracle-status` metadata-only. Only `/oracle-read` preview should switch.

```ts
const responseAvailable = Boolean(job.responsePath && existsSync(job.responsePath));
let responsePreview: string | undefined;
if (options?.responsePreview) {
  const previewPath = job.preferredResponsePath || job.responsePath;
  if (previewPath && existsSync(previewPath)) {
    try {
      responsePreview = (await readFile(previewPath, "utf8")).slice(0, 4000);
    } catch {
      responsePreview = undefined;
    }
  }
}
```

- [ ] **Step 6: Update `oracle_read` tool preview path in `extensions/oracle/lib/tools.ts`**

```ts
let responsePreview: string | undefined;
let responseAvailable = false;
try {
  const previewPath = current.preferredResponsePath || current.responsePath;
  const response = await import("node:fs/promises").then((fs) => fs.readFile(previewPath || "", "utf8"));
  responsePreview = response.slice(0, 4000);
  responseAvailable = true;
} catch {
  responsePreview = undefined;
}
```

- [ ] **Step 7: Run focused verification**

Run:
```bash
cd /home/dev/dev/pi-oracle/.worktrees/oracle-structured-response-formats
npm run check:oracle-extension
npm run sanity:oracle
npm run typecheck
npm run typecheck:worker-helpers
```

Expected: PASS.

- [ ] **Step 8: Commit Task 3**

```bash
cd /home/dev/dev/pi-oracle/.worktrees/oracle-structured-response-formats
git add extensions/oracle/lib/commands.ts extensions/oracle/lib/tools.ts extensions/oracle/shared/job-observability-helpers.mjs extensions/oracle/shared/job-observability-helpers.d.mts scripts/oracle-sanity.ts
git commit -m "feat(oracle): preview preferred response artifacts"
```

---

### Task 4: Add no-regression coverage for wake-up/completion semantics

**Files:**
- Modify: `scripts/oracle-sanity-poller-suite.ts`
- Modify: `scripts/oracle-sanity.ts`

- [ ] **Step 1: Add failing no-regression assertions to `scripts/oracle-sanity.ts`**

Add source-level guards that Phase D does not alter wake-up content or poller transport.

```ts
assert(observabilitySource.includes('const responseLine = options.responseAvailable === false\n    ? "Response file: unavailable yet"\n    : `Response file: ${options.responsePath ?? job.responsePath ?? `response unavailable for ${job.id}`}`;'), 'wake-up content should still reference the legacy response path in Phase D first pass');
assert(!pollerSource.includes('preferredResponsePath'), 'Phase D first pass should not make poller wake-up transport format-aware');
```

- [ ] **Step 2: Add/extend poller-suite assertions**

In `scripts/oracle-sanity-poller-suite.ts`, extend the existing wake-up-content checks so the Phase D branch still proves the same wake-up text contract.

```ts
assert(notificationText.includes(`Use /oracle-read ${jobId}`), 'wake-up content should still direct the receiver to /oracle-read');
assert(notificationText.includes(`Response file: ${deliveredJob.responsePath}`), 'wake-up content should still reference the compatibility response path in Phase D first pass');
assert(!notificationText.includes('preferred-response:'), 'wake-up content should remain unchanged in Phase D first pass');
```

- [ ] **Step 3: Run tests to confirm the new guards fail first**

Run:
```bash
cd /home/dev/dev/pi-oracle/.worktrees/oracle-structured-response-formats
npm run sanity:oracle
```

Expected: FAIL before implementation if any Phase D code touched wake-up semantics.

- [ ] **Step 4: Re-run sanity after implementation changes are in place**

Run:
```bash
cd /home/dev/dev/pi-oracle/.worktrees/oracle-structured-response-formats
npm run sanity:oracle
```

Expected: PASS.

- [ ] **Step 5: Commit Task 4**

```bash
cd /home/dev/dev/pi-oracle/.worktrees/oracle-structured-response-formats
git add scripts/oracle-sanity.ts scripts/oracle-sanity-poller-suite.ts
git commit -m "test(oracle): guard response format rollout from wake-up regressions"
```

---

### Task 5: Update design docs and run full verification

**Files:**
- Modify: `docs/ORACLE_DESIGN.md`

- [ ] **Step 1: Update `docs/ORACLE_DESIGN.md` config shape and response-format section**

Update the documented config shape to include the new response section.

```json
{
  "defaults": {
    "preset": "<preset id from ORACLE_SUBMIT_PRESETS>"
  },
  "response": {
    "defaultFormat": "markdown"
  },
  "browser": {
    "sessionPrefix": "oracle",
    "authSeedProfileDir": "<absolute path to oracle auth seed profile>",
    "runtimeProfilesDir": "<absolute path to oracle runtime profiles dir>",
    "maxConcurrentJobs": 2,
    "cloneStrategy": "apfs-clone",
    "chatUrl": "https://chatgpt.com/",
    "authUrl": "https://chatgpt.com/auth/login",
    "runMode": "headless",
    "executablePath": "<optional absolute path to Chrome executable>",
    "userAgent": "<optional real-Chrome UA override>",
    "args": ["--disable-blink-features=AutomationControlled"]
  }
}
```

Update the response-format section to say:

```md
- `response.md` remains the compatibility artifact.
- `response.rich.md` is the preferred artifact when `response.defaultFormat = markdown` and markdown exists.
- `preferredResponseFormat` / `preferredResponsePath` are additive job metadata fields used by readers.
- Phase D first pass does not change wake-up transport or wake-up content.
```

- [ ] **Step 2: Run full repo verification in the worktree**

Run:
```bash
cd /home/dev/dev/pi-oracle/.worktrees/oracle-structured-response-formats
npm run check:oracle-extension
npm run typecheck
npm run typecheck:worker-helpers
npm run sanity:oracle
npm run pack:check
```

Expected: all PASS.

- [ ] **Step 3: Reinstall the worktree branch package and reload pi**

Run:
```bash
cd /home/dev/dev/pi-oracle
pi remove git:github.com:huynguyendinhquang/pi-oracle@main || true
pi install git:github.com:huynguyendinhquang/pi-oracle@feat/oracle-structured-response-formats
```

Then in the live persisted pi session:
```text
/reload
```

Expected: branch package loaded from `feat/oracle-structured-response-formats`.

- [ ] **Step 4: Live-verify markdown preference and plain fallback**

First, create a worktree-local config override for the project if needed:

```json
{
  "response": {
    "defaultFormat": "markdown"
  }
}
```

Save to:
```text
/home/dev/dev/pi-oracle/.worktrees/oracle-structured-response-formats/.pi/extensions/oracle.json
```

Then submit a markdown-rich oracle prompt and verify:
- `/oracle-read <job-id>` previews markdown body when `response.rich.md` exists
- `/oracle-status <job-id>` shows:
  - `preferred-response-format: markdown`
  - `preferred-response: .../response.rich.md`

For fallback, temporarily switch the project config to:

```json
{
  "response": {
    "defaultFormat": "plain"
  }
}
```

Then submit another job and verify:
- `/oracle-read <job-id>` previews `response.md`
- `/oracle-status <job-id>` shows:
  - `preferred-response-format: plain`
  - `preferred-response: .../response.md`

- [ ] **Step 5: Commit Task 5**

```bash
cd /home/dev/dev/pi-oracle/.worktrees/oracle-structured-response-formats
git add docs/ORACLE_DESIGN.md
git commit -m "docs(oracle): document configurable response format preference"
```

---

## Self-Review Checklist

- [ ] The plan touches only the worktree branch files, not root `main` implementation files.
- [ ] Phase D remains presentation-only: no `poller.ts` edits, no wake-up content changes, no completion-path changes.
- [ ] `response.md` remains required in every task.
- [ ] `job.responseFormat` remains `"text/plain"` in every task.
- [ ] Markdown preference changes preview/selection only.
- [ ] Every code-changing step includes concrete code snippets and exact commands.
- [ ] Full verification and live verification are both included.
