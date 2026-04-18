# Oracle Configurable Response Format Design

## Goal

Add a configurable response-format mode on the `feat/oracle-structured-response-formats` worktree so `pi-oracle` can prefer markdown output when available, while preserving the current plain-text compatibility path and falling back safely when rich extraction is unavailable.

## Assumptions

- This design targets the `feat/oracle-structured-response-formats` worktree/branch only, not `main`.
- Phase A/B stabilization happens first: completion detection should move back to plain-text-first before Phase D changes response selection behavior.
- `response.md` plus `job.responseFormat: "text/plain"` remain the compatibility anchor until a later explicit contract change.
- `response.rich.md` is already the intended primary human/AI-readable artifact when structured extraction succeeds.
- Existing users and tooling must still be able to read plain text without configuration changes.

## Scope

This phase covers response-format preference and reader/output selection only:
- add config for preferred response format
- resolve preferred response asset per job
- surface preferred artifact in `/oracle-read`, wake-up guidance, and related observability
- preserve best-effort fallback to plain text

Non-goals for this phase:
- changing the `oracle_submit` tool signature
- replacing `response.md` as the required compatibility artifact
- removing structured sidecars
- changing wake-up transport mechanics
- changing artifact download behavior
- redesigning the job schema beyond additive preference metadata

## Current State

On the worktree branch today:
- `response.md` is always written and remains the compatibility artifact.
- `response.rich.md`, `response.rich.json`, and `response.references.json` are best-effort sidecars.
- `job.responseFormat` still records `"text/plain"`.
- `/oracle-read` still previews the plain-text response by default, even when richer markdown exists.
- wake-up content points callers to `response.md` and `/oracle-read`, not to a format-aware preferred artifact.

This means the branch already captures richer output, but it does not yet let users choose markdown as the default reading mode.

## Design

### 1. Add an explicit response preference section to config

Extend `OracleConfig` with a new safe section:

```json
{
  "response": {
    "defaultFormat": "markdown"
  }
}
```

Allowed values:
- `"markdown"`
- `"plain"`

Recommended config shape:

```ts
response: {
  defaultFormat: "markdown" | "plain";
}
```

### 2. Default behavior

Recommended Phase D default:
- packaged default: `response.defaultFormat = "markdown"`
- runtime fallback: if markdown asset is unavailable for a job, automatically use plain text

Why this default:
- matches the branch goal that `response.rich.md` is the primary human/AI-readable artifact
- keeps plain text as compatibility fallback rather than the preferred default
- avoids forcing users to opt in on every machine when the branch already captures markdown successfully

Fallback rule:

```text
preferred = markdown
  -> use response.rich.md if present
  -> else use response.md

preferred = plain
  -> use response.md
```

### 3. Preserve compatibility artifacts unchanged

Even when markdown is the preferred default:
- always keep writing `response.md`
- always keep `job.responseFormat = "text/plain"` for compatibility in this phase
- keep `response.rich.md`, `response.rich.json`, and `response.references.json` additive and best-effort

This keeps old readers stable while letting new readers choose the better artifact.

### 4. Add resolved preferred response metadata on the job

Additive job metadata should make the chosen readable artifact explicit. Recommended optional fields:
- `preferredResponseFormat?`
- `preferredResponsePath?`

Example:

```json
{
  "responseFormat": "text/plain",
  "responseExtractionMode": "structured-dom",
  "markdownResponsePath": "/tmp/oracle-.../response.rich.md",
  "preferredResponseFormat": "markdown",
  "preferredResponsePath": "/tmp/oracle-.../response.rich.md"
}
```

Rules:
- resolve these fields after response persistence is complete
- if markdown is preferred but missing, persist:
  - `preferredResponseFormat: "plain"`
  - `preferredResponsePath: response.md`
- do not treat markdown absence as job failure

### 5. Reader behavior

#### `/oracle-read`

`/oracle-read` should use the resolved preferred artifact for its preview body:
- if preferred format resolves to markdown and `response.rich.md` exists, preview markdown text
- otherwise preview plain text from `response.md`

The job summary should still include all additive paths when present:
- `response:`
- `markdown-response:`
- `structured-response:`
- `references:`
- `preferred-response-format:`
- `preferred-response:`

#### `/oracle-status`

`/oracle-status` should remain metadata-oriented, not full-body preview oriented. It should surface:
- preferred response format
- preferred response path
- all additive rich sidecar paths when present

#### Wake-up content

Wake-up guidance should become format-aware without changing transport:
- keep `Use /oracle-read <jobId>` as the primary instruction
- change the secondary response-file line to point at the resolved preferred path when present
- if markdown is preferred and available, reference `response.rich.md`
- otherwise keep referencing `response.md`

This keeps wake-up UX aligned with the configured default mode.

### 6. Config override rules

Recommended resolution order:

```text
job-resolved preferred format
  = explicit job override (future phase, not implemented here) if present
  else project config response.defaultFormat if allowed
  else global config response.defaultFormat
  else packaged default (markdown)
```

For Phase D itself, only config-based selection is required. Submit-time override remains a later optional phase.

### 7. Project override safety

Unlike browser/auth settings, response-format preference is safe for project-level override. Expand the safe override list to include `response`.

This allows:
- one repo to prefer markdown
- another repo to stay plain
- machine-global default to remain overridable per project

### 8. Failure and fallback semantics

Required invariants:
- job completion must not depend on markdown availability
- markdown preference must never block plain-text persistence
- reader selection must degrade silently to plain text when markdown is unavailable
- missing `response.rich.md` with `defaultFormat = markdown` must not throw; it must resolve to plain

### 9. Suggested file boundaries

Keep changes focused:
- `extensions/oracle/lib/config.ts`
  - add `response.defaultFormat`
  - validate values
  - allow safe project override if intended
- `extensions/oracle/lib/jobs.ts`
  - add additive preferred-response fields
- `extensions/oracle/worker/run-job.mjs`
  - resolve preferred response format/path after persistence
- `extensions/oracle/shared/job-observability-helpers.mjs`
  - surface preferred response metadata
- `extensions/oracle/lib/commands.ts`
  - make `/oracle-read` preview the preferred artifact
- `extensions/oracle/lib/poller.ts`
  - keep transport unchanged; only pass the preferred path into wake-up content if needed
- `extensions/oracle/shared/job-observability-helpers.d.mts`
  - update shared summary typing
- `scripts/oracle-sanity.ts`
  - config validation and preferred-path invariants
- `scripts/oracle-sanity-poller-suite.ts`
  - wake-up content uses preferred response path when available

## Testing Strategy

### Config coverage

Add sanity coverage for:
- `response.defaultFormat = markdown`
- `response.defaultFormat = plain`
- invalid values rejected clearly
- project override safety for `response`

### Resolution coverage

Add tests for:
- markdown preferred + markdown exists -> preferred path is `response.rich.md`
- markdown preferred + markdown missing -> preferred path falls back to `response.md`
- plain preferred -> preferred path is always `response.md`

### Reader coverage

Add tests for:
- `/oracle-read` previews markdown body when preferred markdown exists
- `/oracle-read` previews plain text when markdown unavailable
- `/oracle-status` surfaces preferred response fields without switching to body preview mode

### Wake-up coverage

Add tests for:
- wake-up content still says `Use /oracle-read <jobId>`
- response-file line references `preferredResponsePath` when available
- fallback to `response.md` when markdown is missing

### Verification

Run normal worktree verification:
- `npm run check:oracle-extension`
- `npm run typecheck`
- `npm run typecheck:worker-helpers`
- `npm run sanity:oracle`
- `npm run pack:check`

Live verification after implementation:
- install worktree branch package
- `/reload`
- run one markdown-rich oracle prompt
- confirm `/oracle-read` previews markdown by default
- confirm plain fallback still works on a forced plain-text-fallback job

## Acceptance Criteria

- The worktree branch supports `response.defaultFormat: "markdown" | "plain"` in config.
- Packaged default resolves to markdown preference.
- `response.md` remains required and `job.responseFormat` remains `"text/plain"` in this phase.
- Jobs surface `preferredResponseFormat` and `preferredResponsePath` additively.
- `/oracle-read` previews markdown by default when markdown exists.
- `/oracle-read` falls back to plain text when markdown is unavailable.
- Wake-up guidance points at the resolved preferred response path without changing wake-up transport.
- Existing plain-text compatibility consumers keep working unchanged.
