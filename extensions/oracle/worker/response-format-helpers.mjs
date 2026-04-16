// Purpose: Provide pure structured-response formatting helpers for oracle worker sidecars.
// Responsibilities: Render plain text/markdown views and flatten link/reference metadata from extracted response payloads.
// Scope: Pure formatting only; no browser orchestration, DOM reads, or filesystem effects.
// Usage: Imported by worker/runtime code and sanity tests after structured response extraction.
// Invariants/Assumptions: Input payload already comes from extraction step; helpers normalize tolerant mixed shapes.

/** @typedef {import("./response-format-helpers.d.mts").OracleStructuredResponse} OracleStructuredResponse */
/** @typedef {import("./response-format-helpers.d.mts").OracleStructuredResponseBlock} OracleStructuredResponseBlock */
/** @typedef {import("./response-format-helpers.d.mts").OracleStructuredResponseInline} OracleStructuredResponseInline */
/** @typedef {import("./response-format-helpers.d.mts").OracleStructuredResponseReference} OracleStructuredResponseReference */

/**
 * @param {unknown} value
 * @returns {string}
 */
function normalizeString(value) {
  return typeof value === "string" ? value.replace(/\r\n?/g, "\n") : "";
}

/**
 * @param {unknown} value
 * @returns {string | undefined}
 */
function optionalString(value) {
  const text = normalizeString(value).trim();
  return text ? text : undefined;
}

/**
 * @param {unknown} value
 * @returns {unknown[]}
 */
function asArray(value) {
  return Array.isArray(value) ? value : [];
}

/**
 * @param {OracleStructuredResponseInline[] | undefined} inlines
 * @returns {string}
 */
function renderInlineText(inlines) {
  return asArray(inlines)
    .map((inline) => {
      if (typeof inline === "string") return normalizeString(inline);
      if (!inline || typeof inline !== "object") return "";
      return normalizeString(inline.text);
    })
    .join("");
}

/**
 * @param {OracleStructuredResponseInline[] | undefined} inlines
 * @returns {string}
 */
function renderInlineMarkdown(inlines) {
  return asArray(inlines)
    .map((inline) => {
      if (typeof inline === "string") return normalizeString(inline);
      if (!inline || typeof inline !== "object") return "";
      const text = normalizeString(inline.text);
      const href = optionalString(inline.href);
      if (!href) return text;
      const label = text || href;
      return `[${label}](${href})`;
    })
    .join("");
}

/**
 * @param {unknown} item
 * @returns {string}
 */
function renderListItemText(item) {
  if (typeof item === "string") return normalizeString(item).trim();
  if (!item || typeof item !== "object") return "";
  const inlineText = renderInlineText(Array.isArray(item.inlines) ? item.inlines : undefined).trim();
  return inlineText || normalizeString(item.text).trim();
}

/**
 * @param {unknown} item
 * @returns {string}
 */
function renderListItemMarkdown(item) {
  if (typeof item === "string") return normalizeString(item).trim();
  if (!item || typeof item !== "object") return "";
  const inlineMarkdown = renderInlineMarkdown(Array.isArray(item.inlines) ? item.inlines : undefined).trim();
  return inlineMarkdown || normalizeString(item.text).trim();
}

/**
 * @param {string} code
 * @returns {string}
 */
function buildCodeFence(code) {
  const longestTickRun = Math.max(0, ...(code.match(/`+/g) || []).map((segment) => segment.length));
  return "`".repeat(Math.max(3, longestTickRun + 1));
}

/**
 * @param {OracleStructuredResponseBlock} block
 * @returns {string}
 */
function renderBlockPlainText(block) {
  if (!block || typeof block !== "object") return "";
  if (block.type === "code") return normalizeString(block.text).replace(/\n+$/g, "").trim();
  if (block.type === "list") {
    return asArray(block.items)
      .map((item) => renderListItemText(item))
      .filter(Boolean)
      .join("\n");
  }
  const inlineText = renderInlineText(block.inlines).trim();
  return inlineText || normalizeString(block.text).trim();
}

/**
 * @param {OracleStructuredResponseBlock} block
 * @returns {string}
 */
function renderBlockMarkdown(block) {
  if (!block || typeof block !== "object") return "";
  if (block.type === "code") {
    const code = normalizeString(block.text).replace(/\n+$/g, "");
    const fence = buildCodeFence(code);
    const language = optionalString(block.language) || "";
    return `${fence}${language}\n${code}\n${fence}`;
  }
  if (block.type === "blockquote") {
    const quote = (renderInlineMarkdown(block.inlines).trim() || normalizeString(block.text).trim());
    return quote
      .split("\n")
      .map((line) => `> ${line}`)
      .join("\n");
  }
  if (block.type === "list") {
    const ordered = block.ordered === true;
    return asArray(block.items)
      .map((item, index) => {
        const prefix = ordered ? `${index + 1}. ` : "- ";
        const body = renderListItemMarkdown(item);
        return body ? `${prefix}${body}` : "";
      })
      .filter(Boolean)
      .join("\n");
  }
  const inlineMarkdown = renderInlineMarkdown(block.inlines).trim();
  return inlineMarkdown || normalizeString(block.text).trim();
}

/**
 * @param {OracleStructuredResponse | undefined} response
 * @returns {string}
 */
export function renderStructuredResponsePlainText(response) {
  const provided = optionalString(response?.plainText);
  if (provided) return provided;

  const rendered = asArray(response?.blocks)
    .map((block) => renderBlockPlainText(/** @type {OracleStructuredResponseBlock} */ (block)))
    .filter(Boolean)
    .join("\n\n")
    .trim();
  return rendered;
}

/**
 * @param {OracleStructuredResponse | undefined} response
 * @returns {string}
 */
export function renderStructuredResponseMarkdown(response) {
  const provided = optionalString(response?.markdown);
  if (provided) return provided;

  const rendered = asArray(response?.blocks)
    .map((block) => renderBlockMarkdown(/** @type {OracleStructuredResponseBlock} */ (block)))
    .filter(Boolean)
    .join("\n\n")
    .trim();
  return rendered || renderStructuredResponsePlainText(response);
}

/**
 * @param {OracleStructuredResponseInline[] | undefined} inlines
 * @returns {OracleStructuredResponseReference[]}
 */
function referencesFromInlines(inlines) {
  return asArray(inlines)
    .map((inline) => {
      if (!inline || typeof inline !== "object") return undefined;
      const href = optionalString(inline.href);
      if (!href) return undefined;
      return {
        kind: optionalString(inline.kind) || "inline",
        text: optionalString(inline.text),
        href,
      };
    })
    .filter((reference) => Boolean(reference));
}

/**
 * @param {unknown} value
 * @returns {OracleStructuredResponseReference | undefined}
 */
function normalizeReference(value) {
  if (!value || typeof value !== "object") return undefined;
  const href = optionalString(value.href);
  if (!href) return undefined;
  return {
    kind: optionalString(value.kind) || "reference",
    label: optionalString(value.label),
    text: optionalString(value.text),
    href,
  };
}

/**
 * @param {OracleStructuredResponse | undefined} response
 * @returns {OracleStructuredResponseReference[]}
 */
export function buildResponseReferences(response) {
  const fromBlocks = asArray(response?.blocks)
    .flatMap((block) => {
      if (!block || typeof block !== "object") return [];
      const blockInlines = referencesFromInlines(Array.isArray(block.inlines) ? block.inlines : undefined);
      const listInlines = asArray(block.items).flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        return referencesFromInlines(Array.isArray(item.inlines) ? item.inlines : undefined);
      });
      return [...blockInlines, ...listInlines];
    });

  const fromTopLevel = [...asArray(response?.links), ...asArray(response?.references)]
    .map((reference) => normalizeReference(reference))
    .filter((reference) => Boolean(reference));

  const deduped = new Map();
  for (const reference of [...fromTopLevel, ...fromBlocks]) {
    const key = [reference.kind || "", reference.label || "", reference.text || "", reference.href || ""].join("|");
    if (!deduped.has(key)) deduped.set(key, reference);
  }

  return [...deduped.values()];
}
