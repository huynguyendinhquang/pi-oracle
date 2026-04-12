// Purpose: Provide pure ChatGPT UI interpretation helpers shared by oracle worker/auth flows.
// Responsibilities: Normalize allowed origins, interpret model-selection snapshots, and derive assistant-completion signatures.
// Scope: Pure snapshot/text heuristics only; browser I/O and retry loops stay in the worker/auth entrypoints.
// Usage: Imported by worker/auth runtime code and sanity tests to keep browser-driven logic behaviorally testable.
// Invariants/Assumptions: Snapshot text comes from agent-browser `snapshot -i`; helper outputs must stay deterministic and side-effect free.

import { parseSnapshotEntries } from "./artifact-heuristics.mjs";

/** @typedef {import("./chatgpt-ui-helpers.d.mts").OracleUiModelFamily} OracleUiModelFamily */
/** @typedef {import("./chatgpt-ui-helpers.d.mts").OracleUiSelection} OracleUiSelection */
/** @typedef {import("./artifact-heuristics.d.mts").SnapshotEntry} SnapshotEntry */

/** @typedef {{ responseText: string; artifactLabels?: string[]; suspiciousArtifactLabels?: string[] }} CompletionSignatureArgs */
/** @typedef {{ hasStopStreaming: boolean; hasTargetCopyResponse: boolean; responseText: string; artifactLabels?: string[]; suspiciousArtifactLabels?: string[] }} DerivedCompletionSignatureArgs */

export const CHATGPT_CANONICAL_APP_ORIGINS = Object.freeze([
  "https://chatgpt.com",
  "https://chat.openai.com",
]);

/** @type {Record<OracleUiModelFamily, string>} */
const MODEL_FAMILY_PREFIX = {
  instant: "Instant ",
  thinking: "Thinking ",
  pro: "Pro ",
};

const AUTO_SWITCH_LABEL = "Auto-switch to Thinking";

/**
 * @param {string | undefined} url
 * @returns {string | undefined}
 */
function originFromUrl(url) {
  if (typeof url !== "string" || !url.trim()) return undefined;
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}

/**
 * @param {Array<string | undefined>} values
 * @returns {string[]}
 */
function uniqueStrings(values) {
  return [...new Set(values.filter((value) => typeof value === "string" && value))];
}

/**
 * @param {string | undefined} value
 * @returns {string | undefined}
 */
function titleCase(value) {
  return value ? `${value[0].toUpperCase()}${value.slice(1)}` : value;
}

/**
 * @param {string | undefined} value
 * @returns {string}
 */
function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

/**
 * @param {string} chatUrl
 * @param {string | undefined} authUrl
 * @returns {string[]}
 */
export function buildAllowedChatGptOrigins(chatUrl, authUrl) {
  return uniqueStrings([
    ...CHATGPT_CANONICAL_APP_ORIGINS,
    originFromUrl(chatUrl),
    originFromUrl(authUrl),
    "https://auth.openai.com",
  ]);
}

/**
 * @param {string | undefined} label
 * @param {OracleUiModelFamily} family
 * @returns {boolean}
 */
export function matchesModelFamilyLabel(label, family) {
  const normalized = String(label || "");
  const prefix = MODEL_FAMILY_PREFIX[family];
  const exact = prefix.trim();
  return normalized === exact || normalized.startsWith(prefix) || normalized.startsWith(`${exact},`);
}

/**
 * @param {OracleUiSelection} selection
 * @returns {string | undefined}
 */
export function requestedEffortLabel(selection) {
  return selection?.effort ? titleCase(selection.effort) : undefined;
}

/**
 * @param {string} snapshot
 * @param {string | undefined} effortLabel
 * @returns {boolean}
 */
export function effortSelectionVisible(snapshot, effortLabel) {
  if (!effortLabel) return true;
  /** @type {SnapshotEntry[]} */
  const entries = parseSnapshotEntries(snapshot);
  return entries.some((entry) => {
    if (entry.disabled) return false;
    if (entry.kind === "combobox" && entry.value === effortLabel) return true;
    if (entry.kind !== "button") return false;
    const label = String(entry.label || "").toLowerCase();
    const normalizedEffort = effortLabel.toLowerCase();
    return (
      label === normalizedEffort ||
      label === `${normalizedEffort} thinking` ||
      label === `${normalizedEffort}, click to remove` ||
      label === `${normalizedEffort} thinking, click to remove`
    );
  });
}

/**
 * @param {string} snapshot
 * @returns {boolean}
 */
export function thinkingChipVisible(snapshot) {
  return /button "(?:Light|Standard|Extended|Heavy)(?: thinking)?(?:, click to remove)?"/i.test(snapshot);
}

/**
 * @param {string} snapshot
 * @returns {boolean}
 */
export function snapshotHasModelConfigurationUi(snapshot) {
  /** @type {SnapshotEntry[]} */
  const entries = parseSnapshotEntries(snapshot);
  const visibleFamilies = new Set(
    entries
      .filter((entry) => entry.kind === "button" && typeof entry.label === "string")
      .flatMap((entry) =>
        /** @type {OracleUiModelFamily[]} */ (["instant", "thinking", "pro"])
          .filter((family) => matchesModelFamilyLabel(entry.label, family)),
      ),
  );
  const hasCloseButton = entries.some((entry) => entry.kind === "button" && entry.label === "Close" && !entry.disabled);
  const hasEffortCombobox = entries.some(
    (entry) => entry.kind === "combobox" && ["Light", "Standard", "Extended", "Heavy"].includes(entry.value || "") && !entry.disabled,
  );
  return visibleFamilies.size >= 2 || hasCloseButton || hasEffortCombobox;
}

/**
 * @param {string} snapshot
 * @returns {boolean | undefined}
 */
export function autoSwitchToThinkingSelectionVisible(snapshot) {
  /** @type {SnapshotEntry[]} */
  const entries = parseSnapshotEntries(snapshot);
  let foundControl = false;

  for (const entry of entries) {
    const controlText = normalizeText([entry.label, entry.value, entry.line].filter(Boolean).join(" "));
    if (!controlText.toLowerCase().includes(AUTO_SWITCH_LABEL.toLowerCase())) continue;
    foundControl = true;

    if (/\b(?:checked|selected|enabled|on|active)\b/i.test(controlText)) return true;
    if (/\b(?:unchecked|not checked|disabled|off)\b/i.test(controlText)) return false;
    if (typeof entry.label === "string" && /click to remove/i.test(entry.label)) return true;
  }

  return foundControl ? false : undefined;
}

/**
 * @param {string} snapshot
 * @param {OracleUiSelection} selection
 * @returns {boolean}
 */
export function snapshotCanSafelySkipModelConfiguration(snapshot, selection) {
  if (!snapshotStronglyMatchesRequestedModel(snapshot, selection)) return false;

  if (selection.modelFamily === "thinking" || selection.modelFamily === "pro") {
    const effortLabel = requestedEffortLabel(selection);
    if (effortLabel && !effortSelectionVisible(snapshot, effortLabel)) return false;
  }

  if (selection.modelFamily === "instant" && selection.autoSwitchToThinking) {
    return autoSwitchToThinkingSelectionVisible(snapshot) === true;
  }

  return true;
}

/**
 * @param {string} snapshot
 * @param {OracleUiSelection} selection
 * @returns {boolean}
 */
export function snapshotStronglyMatchesRequestedModel(snapshot, selection) {
  /** @type {SnapshotEntry[]} */
  const entries = parseSnapshotEntries(snapshot);
  const familyMatched = entries.some((entry) => !entry.disabled && matchesModelFamilyLabel(entry.label, selection.modelFamily));
  if (!familyMatched) return false;

  const configurationUiVisible = snapshotHasModelConfigurationUi(snapshot);
  const effortLabel = requestedEffortLabel(selection);

  if (selection.modelFamily === "thinking" || selection.modelFamily === "pro") {
    if (!effortLabel) return true;
    if (effortSelectionVisible(snapshot, effortLabel)) return true;
    return !configurationUiVisible;
  }

  if (selection.modelFamily === "instant") {
    const autoSwitchState = autoSwitchToThinkingSelectionVisible(snapshot);
    if (selection.autoSwitchToThinking) {
      return autoSwitchState === true || (!configurationUiVisible && autoSwitchState === undefined);
    }
    return autoSwitchState !== true;
  }

  return false;
}

/**
 * @param {string} snapshot
 * @param {OracleUiSelection} selection
 * @returns {boolean}
 */
export function snapshotWeaklyMatchesRequestedModel(snapshot, selection) {
  /** @type {SnapshotEntry[]} */
  const entries = parseSnapshotEntries(snapshot);
  const familyMatched = entries.some((entry) => !entry.disabled && matchesModelFamilyLabel(entry.label, selection.modelFamily));

  if (selection.modelFamily === "thinking") {
    return familyMatched || effortSelectionVisible(snapshot, requestedEffortLabel(selection));
  }

  if (!familyMatched) return false;

  if (selection.modelFamily === "pro") {
    return !thinkingChipVisible(snapshot);
  }

  if (selection.modelFamily === "instant") {
    const autoSwitchState = autoSwitchToThinkingSelectionVisible(snapshot);
    return selection.autoSwitchToThinking ? autoSwitchState !== false : autoSwitchState !== true;
  }

  return false;
}

/**
 * @param {CompletionSignatureArgs} args
 * @returns {string | undefined}
 */
export function buildAssistantCompletionSignature({ responseText, artifactLabels = [], suspiciousArtifactLabels = [] }) {
  const normalizedResponse = normalizeText(responseText);
  if (normalizedResponse) return `text:${normalizedResponse}`;

  const labels = uniqueStrings([...artifactLabels, ...suspiciousArtifactLabels].map((value) => normalizeText(value))).sort((left, right) => left.localeCompare(right));
  if (labels.length > 0) return `artifacts:${labels.join("|")}`;

  return undefined;
}

/**
 * @param {DerivedCompletionSignatureArgs} args
 * @returns {string | undefined}
 */
export function deriveAssistantCompletionSignature({
  hasStopStreaming,
  hasTargetCopyResponse,
  responseText,
  artifactLabels = [],
  suspiciousArtifactLabels = [],
}) {
  if (hasStopStreaming) return undefined;

  if (hasTargetCopyResponse && normalizeText(responseText)) {
    return buildAssistantCompletionSignature({ responseText });
  }

  if (!normalizeText(responseText)) {
    return buildAssistantCompletionSignature({ responseText, artifactLabels, suspiciousArtifactLabels });
  }

  return undefined;
}
