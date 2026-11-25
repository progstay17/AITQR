import { canonicalBytes } from "./canonical.js";
import type {
  Bundle,
  SignedBundle,
  TrustedAdminKey,
  VerificationResult,
} from "../types.js";

function base64UrlToBytes(text: string): Uint8Array<ArrayBuffer> {
  const normalised = text.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalised + "=".repeat((4 - (normalised.length % 4)) % 4);
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  if (!/^(?:[0-9a-fA-F]{2})*$/.test(hex)) throw new Error("not hex");
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function isSignedBundle(value: unknown): value is SignedBundle {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<SignedBundle>;
  if (typeof candidate.bundle !== "object" || candidate.bundle === null) return false;
  const sig = candidate.sig;
  return (
    typeof sig === "object" &&
    sig !== null &&
    typeof sig.kid === "string" &&
    typeof sig.value === "string" &&
    typeof sig.alg === "string"
  );
}

export function assertBundleShape(bundle: Bundle): string[] {
  const problems: string[] = [];
  if (bundle.schema !== "aitqr.bundle/1") problems.push("bundle.schema must be aitqr.bundle/1");
  if (!Number.isInteger(bundle.seq) || bundle.seq < 0) problems.push("bundle.seq must be a non-negative integer");
  if (typeof bundle.issued !== "string" || Number.isNaN(Date.parse(bundle.issued))) {
    problems.push("bundle.issued must be an ISO date");
  }
  if (typeof bundle.global !== "object" || bundle.global === null) problems.push("bundle.global is required");
  if (typeof bundle.lists !== "object" || bundle.lists === null) problems.push("bundle.lists is required");
  if (!Array.isArray(bundle.profiles)) problems.push("bundle.profiles must be an array");
  return problems;
}

/**
 * Verify the admin signature over the canonical bundle and the bundle's own shape.
 * Fail-closed: an unknown key id or a signature mismatch means no configuration is trusted.
 */
export async function verifySignedBundle(
  candidate: unknown,
  trustedKeys: TrustedAdminKey[],
): Promise<VerificationResult> {
  if (!isSignedBundle(candidate)) {
    return { ok: false, code: "malformed", reason: "signed bundle is not shaped like { bundle, sig }" };
  }
  if (candidate.sig.alg !== "Ed25519") {
    return { ok: false, code: "unsupported-alg", reason: `unsupported signature algorithm ${candidate.sig.alg}` };
  }
  const trusted = trustedKeys.find((key) => key.kid === candidate.sig.kid);
  if (!trusted) {
    return { ok: false, code: "unknown-kid", reason: `signing key ${candidate.sig.kid} is not trusted` };
  }
  const shapeProblems = assertBundleShape(candidate.bundle);
  if (shapeProblems.length > 0) {
    return { ok: false, code: "malformed", reason: shapeProblems.join("; ") };
  }
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    return { ok: false, code: "bad-signature", reason: "WebCrypto is unavailable, so signatures cannot be checked" };
  }
  try {
    const key = await subtle.importKey("raw", hexToBytes(trusted.public), { name: "Ed25519" }, false, ["verify"]);
    const valid = await subtle.verify(
      { name: "Ed25519" },
      key,
      base64UrlToBytes(candidate.sig.value),
      canonicalBytes(candidate.bundle),
    );
    if (!valid) {
      return { ok: false, code: "bad-signature", reason: "bundle signature does not match its contents" };
    }
  } catch (error) {
    return {
      ok: false,
      code: "bad-signature",
      reason: error instanceof Error ? error.message : String(error),
    };
  }
  return { ok: true, bundle: candidate.bundle };
}
