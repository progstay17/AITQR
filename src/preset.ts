import { validateProfile } from "./profile.js";
import type { Bundle, ListValue, Profile } from "./types.js";

export const PROFILE_PRESET_FORMAT = "aitqr.profile-preset/1";
export const PROFILE_PRESETS_FORMAT = "aitqr.profile-presets/1";

export interface ProfilePresetFile {
  format: typeof PROFILE_PRESET_FORMAT;
  profile: Profile;
  lists: Record<string, ListValue[]>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function listsForProfile(profile: Profile, lists: Record<string, ListValue[]>): Record<string, ListValue[]> {
  const result: Record<string, ListValue[]> = {};
  for (const field of profile.fields ?? []) {
    if (!field.list) continue;
    const values = lists[field.list];
    if (Array.isArray(values)) result[field.list] = clone(values);
  }
  return result;
}

export function exportProfilePreset(profile: Profile, bundle: Bundle): ProfilePresetFile {
  return {
    format: PROFILE_PRESET_FORMAT,
    profile: clone(profile),
    lists: listsForProfile(profile, bundle.lists),
  };
}

function normaliseEntry(profileValue: unknown, listsValue: unknown, index: number): ProfilePresetFile {
  if (!isRecord(profileValue)) throw new Error(`Preset ke-${index + 1} harus berupa object JSON.`);
  const profile = clone(profileValue) as unknown as Profile;
  const lists = isRecord(listsValue) ? clone(listsValue) as Record<string, ListValue[]> : {};
  for (const [name, values] of Object.entries(lists)) {
    if (!Array.isArray(values) || !values.every((value) => typeof value === "string" || typeof value === "number")) {
      throw new Error(`Daftar opsi "${name}" harus berupa array string/angka.`);
    }
  }
  const problems = validateProfile(profile, lists);
  if (problems.length > 0) {
    throw new Error(`Preset ${profile.id || `ke-${index + 1}`} tidak valid: ${problems.join("; ")}`);
  }
  return { format: PROFILE_PRESET_FORMAT, profile, lists };
}

/** Accept an exported preset, an exported collection, a full bundle, or a raw profile JSON object. */
export function importProfilePresets(value: unknown): ProfilePresetFile[] {
  if (Array.isArray(value)) {
    if (value.length === 0) throw new Error("File preset tidak berisi profil.");
    return value.map((entry, index) => {
      if (isRecord(entry) && entry.format === PROFILE_PRESET_FORMAT) {
        return normaliseEntry(entry.profile, entry.lists, index);
      }
      return normaliseEntry(entry, {}, index);
    });
  }
  if (!isRecord(value)) throw new Error("File preset harus berupa object atau array JSON.");

  if (value.format === PROFILE_PRESET_FORMAT) {
    return [normaliseEntry(value.profile, value.lists, 0)];
  }
  if (value.format === PROFILE_PRESETS_FORMAT && Array.isArray(value.presets)) {
    if (value.presets.length === 0) throw new Error("File preset tidak berisi profil.");
    return value.presets.map((entry, index) => {
      if (!isRecord(entry) || entry.format !== PROFILE_PRESET_FORMAT) {
        throw new Error(`Preset ke-${index + 1} memiliki format yang tidak dikenal.`);
      }
      return normaliseEntry(entry.profile, entry.lists, index);
    });
  }

  const signedOrBundle = isRecord(value.bundle) ? value.bundle : value;
  if (Array.isArray(signedOrBundle.profiles)) {
    const commonLists = isRecord(signedOrBundle.lists) ? signedOrBundle.lists : {};
    if (signedOrBundle.profiles.length === 0) throw new Error("Bundle tidak berisi profil.");
    return signedOrBundle.profiles.map((profile, index) => normaliseEntry(profile, commonLists, index));
  }

  return [normaliseEntry(value.profile ?? value, value.lists, 0)];
}

export function exportAllProfilePresets(profiles: Profile[], bundle: Bundle): {
  format: typeof PROFILE_PRESETS_FORMAT;
  presets: ProfilePresetFile[];
} {
  return {
    format: PROFILE_PRESETS_FORMAT,
    presets: profiles.map((profile) => exportProfilePreset(profile, bundle)),
  };
}
