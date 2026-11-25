/** Localised UI text. Profile data carries both languages so switching locale needs no refetch. */
export type Localized = string | { id: string; en: string };

export type FieldType =
  | "text"
  | "select"
  | "number"
  | "datetime"
  | "device_id"
  | "checkbox"
  | "constant"
  | "computed";

export type DerivedSource = "session_id" | "device_clock" | "device_kid" | "profile";

export interface FieldDef {
  key: string;
  type: FieldType;
  label: Localized;
  /** Payload key. Fields without `short` are entered but not carried in the token. */
  short?: string;
  required?: boolean;
  max?: number;
  min?: number;
  pattern?: string;
  /** Name of a list in the bundle (select / radio options). */
  list?: string;
  /** constant: the fixed value; computed: the derived source. */
  value?: string | number | boolean;
  source?: DerivedSource;
  placeholder?: Localized;
  help?: Localized;
  /** Form group id: details | place | camera. */
  group?: string;
  /** Tooling only: a safe example value for budget/vector tools. */
  sample?: string | number | boolean;
}

export interface DerivedDef {
  key: string;
  type: "computed";
  source: DerivedSource;
  short?: string;
  label?: Localized;
}

export interface Profile {
  id: string;
  version: number;
  title: Localized;
  consumer: string;
  recipient: { kid: string; public: string };
  schema_id: string;
  fields: FieldDef[];
  /** Automatic values the operator can never edit (PRD §5 `derived`). */
  derived?: DerivedDef[];
  limits?: { max_token_chars?: number; target_token_chars?: number };
  qr?: { ecc?: "L" | "M" | "Q" | "H"; min_display_ratio?: number };
}

export interface GlobalConfig {
  default_locale: "id" | "en";
  require_persisted_key: boolean;
  qr: { ecc: "L" | "M" | "Q" | "H"; quiet_modules: number };
  allowed_profiles?: string[];
}

export type ListValue = string | number;

export interface Bundle {
  schema: "aitqr.bundle/1";
  seq: number;
  issued: string;
  max_age_days: number | null;
  global: GlobalConfig;
  lists: Record<string, ListValue[]>;
  profiles: Profile[];
}

export interface TrustedAdminKey {
  kid: string;
  public: string;
  label?: string;
}

export interface SignedBundle {
  bundle: Bundle;
  sig: { alg: "Ed25519"; kid: string; value: string };
}

export type VerificationResult =
  | { ok: true; bundle: Bundle }
  | { ok: false; code: VerificationFailure; reason: string };

export type VerificationFailure =
  | "malformed"
  | "unknown-kid"
  | "bad-signature"
  | "unsupported-alg";

export interface ConfigState {
  bundle: Bundle;
  source: "builtin" | "cached" | "remote";
  /** Present when a remote update was rejected but a valid bundle is in use. */
  updateError?: string;
  offline: boolean;
}

export type Locale = "id" | "en";

export interface FormValues {
  [fieldKey: string]: string | number | boolean;
}

export interface IssueRecord {
  sid: string;
  profileId: string;
  profileVersion: number;
  issuedAt: number;
  token: string;
  kidHex: string;
  /** Recorder and other display-only values, kept on this device only. */
  summary: Record<string, string>;
}
