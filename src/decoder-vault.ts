/** AES-256-GCM envelope encryption for account decoder keys. The master key is supplied
 * only through the protected server environment and must be backed up separately from SQLite. */
const encoder = new TextEncoder();

function fromHex(value: string): Uint8Array {
  if (!/^[0-9a-f]{64}$/i.test(value)) throw new Error("AITQR_VAULT_MASTER_KEY must be 64 hexadecimal characters");
  return Uint8Array.from(value.match(/.{2}/g)!, (part) => Number.parseInt(part, 16));
}

function toBase64(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

async function vaultKey(masterKey: string): Promise<CryptoKey> {
  const raw = fromHex(masterKey.trim());
  try { return await crypto.subtle.importKey("raw", asArrayBuffer(raw), "AES-GCM", false, ["encrypt", "decrypt"]); }
  finally { raw.fill(0); }
}

function keyContext(accountId: string, kid: string): Uint8Array {
  return encoder.encode("aitqr-decoder-key/v1:" + accountId + ":" + kid);
}

function asArrayBuffer(value: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(value.byteLength);
  new Uint8Array(buffer).set(value);
  return buffer;
}

export async function sealDecoderKey(privateKeyHex: string, masterKey: string, accountId: string, kid: string): Promise<{ iv: string; ciphertext: string }> {
  const raw = fromHex(privateKeyHex);
  try {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await vaultKey(masterKey);
    const plaintext = encoder.encode(privateKeyHex.toLowerCase());
    try {
      const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
        { name: "AES-GCM", iv: asArrayBuffer(iv), additionalData: asArrayBuffer(keyContext(accountId, kid)) },
        key,
        asArrayBuffer(plaintext),
      ));
      return { iv: toBase64(iv), ciphertext: toBase64(ciphertext) };
    } finally {
      plaintext.fill(0);
    }
  } finally {
    raw.fill(0);
  }
}

export async function openDecoderKey(
  ivText: string,
  ciphertextText: string,
  masterKey: string,
  accountId: string,
  kid: string,
): Promise<Uint8Array> {
  const key = await vaultKey(masterKey);
  const plaintext = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: asArrayBuffer(fromBase64(ivText)),
      additionalData: asArrayBuffer(keyContext(accountId, kid)),
      tagLength: 128,
    },
    key,
    asArrayBuffer(fromBase64(ciphertextText)),
  );
  const bytes = new Uint8Array(plaintext);
  try {
    const hex = new TextDecoder().decode(bytes);
    if (!/^[0-9a-f]{64}$/.test(hex)) throw new Error("Stored decoder key is invalid");
    return Uint8Array.from(hex.match(/.{2}/g)!, (part) => Number.parseInt(part, 16));
  } finally {
    bytes.fill(0);
  }
}  const hex = new TextDecoder().decode(plaintext);
  if (!/^[0-9a-f]{64}$/.test(hex)) throw new Error("Stored decoder key is invalid");
  return Uint8Array.from(hex.match(/.{2}/g)!, (part) => Number.parseInt(part, 16));
}
