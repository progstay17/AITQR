import { TRUSTED_ADMIN_KEYS } from "./trustedAdminKeys.js";
import { verifySignedBundle } from "./verify.js";
import { validateProfile } from "../profile.js";
import type { Bundle, ConfigState, SignedBundle, TrustedAdminKey } from "../types.js";

const CACHE_KEY = "aitqr.bundle.v1";
const ACCOUNT_CONFIG_URL = "/api/account/config";
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

function readCache(key = CACHE_KEY): CacheEntry | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CacheEntry;
    if (!parsed || typeof parsed !== "object" || !parsed.signed) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(signed: SignedBundle, key = CACHE_KEY): void {
  try {
    localStorage.setItem(key, JSON.stringify({ signed, verifiedAt: Date.now() } satisfies CacheEntry));
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

async function fetchAccountBundle(): Promise<unknown | null> {
  let response: Response;
  try {
    response = await fetch(ACCOUNT_CONFIG_URL, { cache: "no-store", credentials: "same-origin" });
  } catch {
    // Network failures may use a previously verified account-scoped cache.
    return null;
  }
  if (response.status === 401 || response.status === 403) {
    throw new ConfigUnavailableError(
      "session is no longer authorised to load this account configuration",
      "authentication-required",
    );
  }
  if (!response.ok) {
    let detail = "";
    try {
      const payload = (await response.json()) as { error?: unknown };
      if (typeof payload?.error === "string") detail = payload.error.trim().replace(/\\s+/g, " ").slice(0, 180);
    } catch {
      // Keep the HTTP status when the proxy returns a non-JSON error page.
    }
    throw new ConfigUnavailableError(
      "server gagal menyediakan konfigurasi akun (HTTP " + response.status + ")" + (detail ? ": " + detail : ""),
      "account-config-http",
    );
  }
  try {
    return (await response.json()) as unknown;
  } catch {
    throw new ConfigUnavailableError(
      "server mengirim respons konfigurasi akun yang bukan JSON valid",
      "account-config-response",
    );
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
async function loadAccountConfig(accountId: string, trusted: TrustedAdminKey[], offline: boolean): Promise<ConfigState> {
  if (!accountId.trim()) throw new ConfigUnavailableError("account identity is missing", "account-missing");
  const cacheKey = CACHE_KEY + ".account." + encodeURIComponent(accountId);
  const cached = readCache(cacheKey);
  let cachedState: ConfigState | null = null;

  if (cached) {
    const checked = await verifySignedBundle(cached.signed, trusted);
    if (checked.ok && profileProblems(checked.bundle).length === 0) {
      cachedState = { bundle: checked.bundle, source: "cached", offline };
    }
  }

  if (!offline) {
    let remoteRaw: unknown | null = null;
    let remoteError: ConfigUnavailableError | null = null;
    try {
      remoteRaw = await fetchAccountBundle();
    } catch (error) {
      if (error instanceof ConfigUnavailableError && error.code === "authentication-required") throw error;
      if (error instanceof ConfigUnavailableError) remoteError = error;
      else throw error;
    }
    if (remoteError && !cachedState) throw remoteError;
    if (remoteRaw !== null) {
      const checked = await verifySignedBundle(remoteRaw, trusted);
      if (!checked.ok) {
        if (cachedState) return { ...cachedState, updateError: checked.reason };
        throw new ConfigUnavailableError("account configuration is not trusted: " + checked.reason, checked.code);
      }
      const problems = profileProblems(checked.bundle);
      if (problems.length > 0) {
        if (cachedState) return { ...cachedState, updateError: "account configuration is invalid: " + problems.join("; ") };
        throw new ConfigUnavailableError("account configuration is invalid: " + problems.join("; "), "invalid-profile");
      }
      if (cachedState && checked.bundle.seq < cachedState.bundle.seq) {
        return { ...cachedState, updateError: "server returned an older account configuration; the last verified version is still in use" };
      }
      writeCache(remoteRaw as SignedBundle, cacheKey);
      return { bundle: checked.bundle, source: "remote", offline: false };
    }
  }

  if (cachedState) {
    return {
      ...cachedState,
      offline: true,
      updateError: offline ? undefined : remoteError?.message ?? "account configuration could not be refreshed; using this account's last verified copy",
    };
  }

  throw new ConfigUnavailableError(
    "no verified configuration is available for this account; connect to the server and ask the administrator to publish its form",
    "account-config-unavailable",
  );
}

/**
 * Load a trusted configuration:
 *   - staff/admin sessions use a separately signed, account-scoped configuration and cache,
 *   - the legacy global loader remains for tooling and public bundle checks.
 */
export async function loadConfig(options: { trusted?: TrustedAdminKey[]; account?: string } = {}): Promise<ConfigState> {
  const trusted = options.trusted ?? TRUSTED_ADMIN_KEYS;
  const offline = typeof navigator !== "undefined" && navigator.onLine === false;
  if (options.account !== undefined) return loadAccountConfig(options.account, trusted, offline);

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
