import { TRUSTED_ADMIN_KEYS } from "./trustedAdminKeys.js";
import { verifySignedBundle } from "./verify.js";
import { validateProfile } from "../profile.js";
import type { Bundle, ConfigState, SignedBundle, TrustedAdminKey } from "../types.js";

const CACHE_KEY = "aitqr.bundle.v1";
const BUILTIN_URL = "/bundles/default.bundle.json";
const UPDATE_URL = "/bundles/latest.bundle.json";

interface CacheEntry {
  signed: SignedBundle;
  verifiedAt: number;
}

export class ConfigUnavailableError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = "ConfigUnavailableError";
  }
}

function readCache(): CacheEntry | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CacheEntry;
    if (!parsed || typeof parsed !== "object" || !parsed.signed) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(signed: SignedBundle): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ signed, verifiedAt: Date.now() } satisfies CacheEntry));
  } catch {
    // A full or blocked storage must not stop issuance: the built-in bundle still applies.
  }
}

async function fetchBundle(url: string): Promise<unknown | null> {
  try {
    const response = await fetch(url, { cache: "no-cache", credentials: "same-origin" });
    if (!response.ok) return null;
    return (await response.json()) as unknown;
  } catch {
    return null;
  }
}

function profileProblems(bundle: Bundle): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  for (const profile of bundle.profiles) {
    if (ids.has(profile.id)) problems.push(`duplicate profile id ${profile.id}`);
    ids.add(profile.id);
    problems.push(...validateProfile(profile, bundle.lists));
  }
  return problems;
}

/**
 * Load the trusted configuration:
 *   1. verify the built-in bundle (a broken build must not issue anything),
 *   2. verify the cached bundle (offline, from an earlier session),
 *   3. try a same-origin update, accepted only if its `seq` is not older than what we hold.
 * A rejected update keeps the last valid configuration and reports why (PRD FR-01, AC-02).
 */
export async function loadConfig(options: { trusted?: TrustedAdminKey[] } = {}): Promise<ConfigState> {
  const trusted = options.trusted ?? TRUSTED_ADMIN_KEYS;
  const offline = typeof navigator !== "undefined" && navigator.onLine === false;

  const builtinRaw = await fetchBundle(BUILTIN_URL);
  if (builtinRaw === null) {
    throw new ConfigUnavailableError("the built-in bundle could not be loaded", "builtin-missing");
  }
  const builtin = await verifySignedBundle(builtinRaw, trusted);
  if (!builtin.ok) {
    throw new ConfigUnavailableError(`the built-in bundle is not trusted: ${builtin.reason}`, builtin.code);
  }
  const builtinProblems = profileProblems(builtin.bundle);
  if (builtinProblems.length > 0) {
    throw new ConfigUnavailableError(`the built-in bundle is invalid: ${builtinProblems.join("; ")}`, "invalid-profile");
  }

  let best: ConfigState = { bundle: builtin.bundle, source: "builtin", offline };

  const cached = readCache();
  if (cached) {
    const checked = await verifySignedBundle(cached.signed, trusted);
    if (checked.ok && checked.bundle.seq >= best.bundle.seq && profileProblems(checked.bundle).length === 0) {
      best = { bundle: checked.bundle, source: "cached", offline };
    }
  }

  if (!offline) {
    const remoteRaw = await fetchBundle(UPDATE_URL);
    if (remoteRaw !== null) {
      const checked = await verifySignedBundle(remoteRaw, trusted);
      if (!checked.ok) {
        best = { ...best, updateError: checked.reason };
      } else if (profileProblems(checked.bundle).length > 0) {
        best = { ...best, updateError: "the updated bundle contains invalid profiles" };
      } else if (checked.bundle.seq < best.bundle.seq) {
        best = { ...best, updateError: "the updated bundle is older than the one already in use" };
      } else {
        best = { bundle: checked.bundle, source: "remote", offline };
        writeCache({ bundle: checked.bundle, sig: (remoteRaw as SignedBundle).sig });
      }
    }
  }

  if (best.source !== "builtin" && best.source !== "cached" && best.source !== "remote") {
    throw new ConfigUnavailableError("no configuration could be verified", "unverified");
  }
  return best;
}

export function bundleAgeDays(bundle: Bundle, now: number): number | null {
  const issued = Date.parse(bundle.issued);
  if (Number.isNaN(issued)) return null;
  return Math.max(0, Math.floor((now - issued) / 86_400_000));
}

export function isExpired(bundle: Bundle, now: number): boolean {
  if (bundle.max_age_days === null) return false;
  const age = bundleAgeDays(bundle, now);
  return age !== null && age > bundle.max_age_days;
}
