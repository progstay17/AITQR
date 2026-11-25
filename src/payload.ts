import { canonicalize } from "./config/canonical.js";
import { fieldsOf, optionsFor } from "./profile.js";
import type { Bundle, FieldDef, FormValues, ListValue, Profile } from "./types.js";

export type ValidationCode = "required" | "max" | "pattern" | "option" | "number" | "range";

export interface ValidationIssue {
  key: string;
  code: ValidationCode;
  /** Extra data used by the message templates: the limit, the pattern, the allowed values. */
  detail?: string | number;
}

export const MQ1_PLAINTEXT_OVERHEAD = 1; // compression flag only; no signer metadata
export const ENVELOPE_OVERHEAD = 48; // ephemeral public key + GCM tag
export const TOKEN_PREFIX_CHARS = 4; // "MQ1:"

/** Exact base45 length for n bytes (RFC 9285 packs 2 bytes into 3 characters). */
export function base45Length(bytes: number): number {
  return 3 * Math.floor(bytes / 2) + (bytes % 2 === 1 ? 2 : 0);
}

/**
 * Estimated token length before encoding. Compression can only make this smaller, so a value
 * within budget here is a safe upper bound; the real length is checked again after encoding.
 */
export function estimateTokenChars(payload: Record<string, unknown>): number {
  const bodyBytes = new TextEncoder().encode(canonicalize(payload)).length;
  const envelope = ENVELOPE_OVERHEAD + MQ1_PLAINTEXT_OVERHEAD + bodyBytes;
  return TOKEN_PREFIX_CHARS + base45Length(envelope);
}

function coerceOption(value: ListValue, field: FieldDef): ListValue {
  if (field.type === "number") return typeof value === "number" ? value : Number(value);
  return value;
}

export function validateValues(
  profile: Profile,
  bundle: Bundle,
  values: FormValues,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const field of fieldsOf(profile)) {
    if (field.type === "computed" || field.type === "constant") continue;
    const raw = values[field.key];
    const empty = raw === undefined || raw === "" || raw === null;

    if (empty) {
      if (field.required) issues.push({ key: field.key, code: "required" });
      continue;
    }

    if (field.type === "checkbox") continue;

    const text = String(raw);
    if (field.max !== undefined && text.length > field.max) {
      issues.push({ key: field.key, code: "max", detail: field.max });
    }
    if (field.pattern !== undefined && !new RegExp(field.pattern).test(text)) {
      issues.push({ key: field.key, code: "pattern", detail: field.pattern });
    }
    if (field.type === "number") {
      const numeric = Number(text);
      if (!Number.isFinite(numeric)) issues.push({ key: field.key, code: "number" });
      else if (field.min !== undefined && numeric < field.min) {
        issues.push({ key: field.key, code: "range", detail: field.min });
      } else if (field.max !== undefined && numeric > field.max) {
        issues.push({ key: field.key, code: "range", detail: field.max });
      }
    }
    if (field.type === "select" || (field.type === "device_id" && field.list)) {
      const options = optionsFor(field, bundle);
      if (options.length > 0) {
        const allowed = options.map((option) => String(option));
        if (!allowed.includes(text)) {
          issues.push({ key: field.key, code: "option", detail: allowed.join(", ") });
        }
      }
    }
  }
  return issues;
}

/** Derived values are computed here; the operator cannot type or edit them. */
export function derivedValues(
  profile: Profile,
  context: { sessionId: string; deviceKid: string; now: number },
): Record<string, string | number> {
  const derived: Record<string, string | number> = {};
  for (const field of fieldsOf(profile)) {
    if (field.type === "computed") {
      derived[field.key] = derivedSourceValue(field.source, profile, context);
    }
  }
  return derived;
}

export function derivedSourceValue(
  source: FieldDef["source"],
  profile: Profile,
  context: { sessionId: string; deviceKid: string; now: number },
): string | number {
  switch (source) {
    case "session_id":
      return context.sessionId;
    case "device_clock":
      return new Date(context.now).toISOString();
    case "device_kid":
      return context.deviceKid;
    case "profile":
      return `${profile.id}/${profile.version}`;
    default:
      return "";
  }
}

/**
 * Map form values to the compact token payload.
 * `p`/`pv` always identify the profile and its version (PRD BR-04).
 */
export function buildPayload(
  profile: Profile,
  bundle: Bundle,
  values: FormValues,
  derived: Record<string, string | number>,
  sessionId: string,
): Record<string, unknown> {
  const payload: Record<string, unknown> = { p: profile.id, pv: profile.version, s: sessionId };
  for (const field of fieldsOf(profile)) {
    if (!field.short) continue;
    if (field.type === "computed") {
      payload[field.short] = derived[field.key] ?? derivedSourceValue(field.source, profile, {
        sessionId,
        deviceKid: "",
        now: Date.now(),
      });
      continue;
    }
    if (field.type === "constant") {
      payload[field.short] = field.value;
      continue;
    }
    const raw = values[field.key];
    if (raw === undefined || raw === "") {
      if (field.required) continue; // validation already reported it
      continue;
    }
    if (field.type === "checkbox") {
      payload[field.short] = Boolean(raw);
      continue;
    }
    if (field.type === "number") {
      payload[field.short] = Number(raw);
      continue;
    }
    if (field.type === "select") {
      const options = optionsFor(field, bundle);
      const match = options.find((option) => String(option) === String(raw));
      payload[field.short] = match === undefined ? raw : coerceOption(match, field);
      continue;
    }
    payload[field.short] = String(raw);
  }
  return payload;
}

export interface BudgetReport {
  chars: number;
  limit: number;
  target: number;
  /** Payload keys sorted by their canonical byte cost, largest first. */
  fieldCosts: { key: string; chars: number }[];
}

/** Which payload entries cost the most — used when the token is over budget (PRD AC-03). */
export function budgetReport(
  payload: Record<string, unknown>,
  profile: Profile,
): BudgetReport {
  const limit = profile.limits?.max_token_chars ?? 800;
  const target = profile.limits?.target_token_chars ?? 400;
  const fieldCosts = Object.entries(payload)
    .map(([key, value]) => ({
      key,
      chars: new TextEncoder().encode(canonicalize({ [key]: value })).length,
    }))
    .sort((a, b) => b.chars - a.chars);
  return { chars: estimateTokenChars(payload), limit, target, fieldCosts };
}

/** Human label for a payload key, so budget messages name the field rather than "sh". */
export function payloadKeyLabels(profile: Profile): Record<string, string> {
  const labels: Record<string, string> = { p: "profile", pv: "profile version", s: "session id" };
  for (const field of fieldsOf(profile)) {
    // Keep the built-in readable names for the shared keys; otherwise use the field key.
    if (field.short && labels[field.short] === undefined) labels[field.short] = field.key;
  }
  return labels;
}

export function clampToBudget(report: BudgetReport): boolean {
  return report.chars <= report.limit;
}
