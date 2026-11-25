import type { Bundle, FieldDef, ListValue, Locale, Localized, Profile } from "./types.js";

/**
 * Fields the form must render: the profile's own fields plus its derived values, which arrive in the
 * spec's `derived[]` array but behave exactly like computed fields.
 */
export function fieldsOf(profile: Profile): FieldDef[] {
  const derived = (profile.derived ?? []).map<FieldDef>((entry) => ({
    key: entry.key,
    type: "computed",
    label: entry.label ?? entry.key,
    source: entry.source,
    short: entry.short,
  }));
  return [...profile.fields, ...derived];
}

export const FIELD_TYPES = [
  "text",
  "select",
  "number",
  "datetime",
  "device_id",
  "checkbox",
  "constant",
  "computed",
] as const;

export const DERIVED_SOURCES = ["session_id", "device_clock", "device_kid", "profile"] as const;

export function localize(text: Localized | undefined, locale: Locale): string {
  if (text === undefined) return "";
  if (typeof text === "string") return text;
  return text[locale] || text.id || text.en;
}

/** Structural validation of one profile. Used by the app at load time and by `bundle:lint`. */
export function validateProfile(profile: Profile, lists: Record<string, ListValue[]>): string[] {
  const problems: string[] = [];
  const where = `profile ${profile.id || "(missing id)"}`;
  if (!profile.id || !/^[a-z0-9][a-z0-9-]{1,63}$/.test(profile.id)) {
    problems.push(`${where}: id must be lowercase letters, digits and dashes`);
  }
  if (!Number.isInteger(profile.version) || profile.version < 1) problems.push(`${where}: version must be >= 1`);
  if (!profile.consumer) problems.push(`${where}: consumer is required`);
  if (!profile.schema_id) problems.push(`${where}: schema_id is required`);
  if (!profile.recipient || !/^[0-9a-fA-F]{64}$/.test(profile.recipient.public ?? "")) {
    problems.push(`${where}: recipient.public must be 64 hex characters (X25519 public key)`);
  }
  if (!Array.isArray(profile.fields) || profile.fields.length === 0) {
    problems.push(`${where}: fields must be a non-empty array`);
    return problems;
  }

  const keys = new Set<string>();
  const shorts = new Set<string>();
  for (const field of fieldsOf(profile)) {
    const label = `${where} field ${field.key || "(missing key)"}`;
    if (!field.key) problems.push(`${label}: key is required`);
    if (keys.has(field.key)) problems.push(`${label}: duplicate key`);
    keys.add(field.key);
    if (!field.label) problems.push(`${label}: label is required`);
    if (!FIELD_TYPES.includes(field.type)) problems.push(`${label}: unknown type ${String(field.type)}`);
    if (field.short) {
      if (shorts.has(field.short)) problems.push(`${label}: duplicate short key ${field.short}`);
      shorts.add(field.short);
    }
    if (field.type === "select") {
      if (!field.list) {
        problems.push(`${label}: select needs a list name`);
      } else {
        const options = lists[field.list];
        if (!Array.isArray(options) || options.length === 0) {
          problems.push(`${label}: list ${field.list} is missing or empty`);
        }
      }
    }
    if (field.pattern) {
      try {
        new RegExp(field.pattern);
      } catch {
        problems.push(`${label}: pattern does not compile`);
      }
    }
    if (field.type === "constant" && field.value === undefined) problems.push(`${label}: constant needs a value`);
    if (field.type === "computed" && !DERIVED_SOURCES.includes(field.source as never)) {
      problems.push(`${label}: computed needs a known source`);
    }
    if (field.max !== undefined && (!Number.isInteger(field.max) || field.max < 1)) {
      problems.push(`${label}: max must be a positive integer`);
    }
  }

  const limits = profile.limits ?? {};
  if (limits.max_token_chars !== undefined && limits.max_token_chars > 800) {
    problems.push(`${where}: max_token_chars above the MQ1 hard cap of 800`);
  }
  if (limits.target_token_chars !== undefined && limits.target_token_chars < 100) {
    problems.push(`${where}: target_token_chars below 100 is not useful`);
  }
  return problems;
}

export function profilesForBundle(bundle: Bundle): Profile[] {
  const allowed = bundle.global.allowed_profiles;
  if (!allowed || allowed.length === 0) return bundle.profiles;
  return bundle.profiles.filter((profile) => allowed.includes(profile.id));
}

export function findProfile(bundle: Bundle, id: string): Profile | undefined {
  return profilesForBundle(bundle).find((profile) => profile.id === id);
}

export function optionsFor(field: FieldDef, bundle: Bundle): ListValue[] {
  if (!field.list) return [];
  return bundle.lists[field.list] ?? [];
}

export function resolveLists(
  profile: Profile,
  bundle: Bundle,
): Record<string, ListValue[]> {
  const resolved: Record<string, ListValue[]> = {};
  for (const field of fieldsOf(profile)) {
    if (field.list) resolved[field.list] = optionsFor(field, bundle);
  }
  return resolved;
}

export function groupsOf(profile: Profile): string[] {
  const order: string[] = [];
  for (const field of fieldsOf(profile)) {
    const group = field.group ?? "details";
    if (!order.includes(group)) order.push(group);
  }
  return order;
}
