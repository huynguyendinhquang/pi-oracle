# Oracle Structured Response Format Design

## Goal

Add additive rich response persistence for ChatGPT replies so `pi-oracle` can preserve plain text, markdown, and href/reference metadata without breaking the current plain-text response contract.

## Assumptions

- Existing callers rely on `job.responsePath` plus `job.responseFormat: "text/plain"`.
- Phase 1 must be surgical and fallback-safe: plain-text completion still works if rich extraction fails.
- `pi-oracle` should keep using browser-visible DOM state, not undocumented ChatGPT APIs, as its primary source of truth.
- Accessibility snapshots remain useful for readiness/debugging, but not as the persisted response format.

## Scope

This design covers response extraction and persistence only:
- richer extraction from the assistant response subtree
- additive markdown/reference sidecars
- job metadata for alternate response assets
- `/oracle-read` and `/oracle-status` surfacing those extra assets

Non-goals for this phase:
- changing completion detection semantics
- replacing the current plain-text primary response contract
- using clipboard/native copy as the primary extraction path
- broad artifact-pipeline refactors unrelated to response links/references
- undocumented ChatGPT conversation API integration

## Current State

Today `extensions/oracle/worker/run-job.mjs` flattens assistant output via `innerText || textContent` in `assistantMessages()`. That gives readable text, but it loses:
- `href` values for inline links
- citation/source-card mapping
- code fence fidelity and language hints
- list/table structure
- inline emphasis and other markdown-worthy semantics

The persisted contract stays intentionally simple:
- `response.md` path for continuity
- `responseFormat: "text/plain"`
- artifact downloads stored separately under `artifacts/`

This means current persistence is stable but lossy.

## Design

### 1. Keep plain text as the compatibility anchor

Phase 1 keeps the current compatibility contract intact:
- `job.responsePath` still points to the legacy plain-text file
- `job.responseFormat` stays `"text/plain"`
- existing `/oracle-read` behavior remains readable for current callers

This avoids breaking wake-up messages, agent consumption, and any tooling that already expects plain text.

### 2. Add a structured-first extraction path beside the legacy path

Add a new structured extraction step in the worker that targets the final assistant response subtree with `evalPage(...)` and returns a normalized payload instead of flattened text only.

Recommended normalized shape:

```json
{
  "version": 1,
  "extractionMode": "structured-dom",
  "plainText": "...",
  "markdown": "...",
  "blocks": [
    { "type": "paragraph", "text": "..." },
    { "type": "code", "text": "...", "language": "ts" }
  ],
  "links": [
    { "kind": "inline", "text": "OpenAI", "href": "https://openai.com/" }
  ],
  "references": [
    { "kind": "citation", "label": "[1]", "text": "Source", "href": "https://example.com" }
  ]
}
```

The worker should derive this from the live DOM subtree, not from snapshots. Snapshots remain a side channel for completion heuristics and debugging only.

### 3. Persist additive sidecars, not a breaking replacement

Phase 1 should write these files under the job directory:
- `response.md` — legacy plain-text response, unchanged role
- `response.rich.md` — best-effort markdown serialization
- `response.rich.json` — canonical structured payload
- `response.references.json` — flattened link/reference sidecar for fast inspection

Why additive:
- low-risk rollout
- easy diff against existing plain-text behavior
- users can inspect richer assets without breaking current readers

### 4. Fallback ladder

Fallback is required at two levels:

1. **Structured extraction fallback**
   - Try structured DOM extraction first.
   - If it fails, log the failure and fall back to the existing plain-text extraction path.
   - Job still completes if plain text is available.

2. **Derived markdown/reference fallback**
   - If structured payload exists but markdown rendering fails, still save plain text plus structured JSON if safe.
   - Missing rich sidecars should not fail the whole job.

Record the mode explicitly in job metadata, e.g.:
- `responseExtractionMode: "structured-dom" | "plain-text-fallback"`

### 5. Link and reference preservation rules

The structured extractor should preserve at least:
- inline `<a href>` links with absolute URLs
- code blocks with best-effort language hints from class names
- ordered/unordered lists
- blockquotes
- basic tables
- citation/source links rendered as chips, superscripts, or footnote-like anchors

Rules:
- absolutize relative `href`/`src` against `document.baseURI`
- preserve DOM order for inline links/references
- keep citation links distinct from downloadable artifacts
- populate `OracleArtifactRecord.url` when an artifact candidate originates from an anchor with a stable href

### 6. File and metadata changes

Add optional metadata fields rather than mutating current ones in place. Expected new fields on the job record:
- `responseExtractionMode?`
- `markdownResponsePath?`
- `structuredResponsePath?`
- `referencesPath?`

Current fields remain:
- `responsePath`
- `responseFormat: "text/plain"`

### 7. Reader behavior

`/oracle-read` and `/oracle-status` should keep their current human-friendly plain-text preview, but surface the extra rich assets when present.

Expected additive behavior:
- keep showing the legacy plain-text response preview by default
- include extra metadata lines for markdown/structured/reference paths
- do not force callers to parse rich JSON unless they want it

### 8. Suggested file boundaries

To keep changes surgical, split the work into focused units:
- `extensions/oracle/worker/run-job.mjs`
  - orchestration only
  - calls extraction/persistence helpers
- `extensions/oracle/worker/response-format-helpers.mjs`
  - pure normalization/rendering helpers for plain text, markdown, and references
- `extensions/oracle/lib/jobs.ts`
  - additive metadata fields and persisted file paths
- `extensions/oracle/shared/job-observability-helpers.mjs`
  - additive status/read output lines

This avoids growing `run-job.mjs` further than needed.

## Testing Strategy

### Sanity coverage

Add regression coverage for:
- new helper presence
- additive file names/metadata fields
- fallback invariants: rich extraction failure must still preserve plain-text completion
- href preservation from representative assistant-response fixtures

### Pure helper coverage

Use small DOM/HTML fixtures to verify:
- links become absolute
- code fences preserve language when present
- tables and lists survive markdown rendering reasonably
- references/citations appear in `response.references.json`

### Verification

Run normal repo verification in the worktree:
- `npm run check:oracle-extension`
- `npm run typecheck`
- `npm run typecheck:worker-helpers`
- `npm run sanity:oracle`
- `npm run pack:check`

## Acceptance Criteria

- Existing plain-text response persistence still works unchanged for current readers.
- Rich extraction writes `response.rich.json` and `response.references.json` for representative responses.
- Markdown sidecar preserves inline links as markdown links with absolute `href` values.
- Jobs still complete successfully when rich extraction falls back to plain text.
- `/oracle-read` and `/oracle-status` surface rich-asset paths without breaking current plain-text previews.
