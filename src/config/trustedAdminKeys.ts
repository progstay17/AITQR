import type { TrustedAdminKey } from "../types.js";

/**
 * Admin public keys embedded in the build. Rotating the signing key means shipping a new build.
 * The matching private key never enters this repository, the bundle or the build output
 * (PRD §11 M3, ARCHITECTURE §3, AGENTS §4).
 */
export const TRUSTED_ADMIN_KEYS: TrustedAdminKey[] = [
  {
    kid: "700334e69ea0ab7d",
    public: "f7578bfe5c3819c6a84a35480f9d6aafe71cc91c493797680df5f46978026c4b",
    label: "local-dev-admin",
  },
  {
    kid: "f203b83b51c573cb",
    public: "d8d334c2bec984b4c6aac1bc9d46ce8c718d401fb38fb57835f5e496639fbc7f",
    label: "production-admin",
  },
];
