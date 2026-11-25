# metaqr token formats: MQ1 (unsigned) and MQ2 (signed)

Sections 1 to 7 define **MQ1**; section 8 defines **MQ2**, which adds a device signature. This document is normative for any implementation (Python reference, a browser/JS encoder, ...).
Fixed test vectors live in `tests/vectors.json`. An implementation is conformant if it

1. decodes every `token` and every `token_raw` to the listed `metadata`, and
2. given the vector's fixed ephemeral key and no compression, reproduces each `token_raw`
   byte for byte.

The compressed `token` bodies are **not** required to be reproduced: DEFLATE output is not
standardised across implementations (zlib levels, browser `CompressionStream`, ...), so two
conformant encoders may emit different but equally valid flag-1 bodies.

## 1. Overview

```
token    = "MQ1:" base45( envelope )
envelope = eph_pub[32] || ciphertext || tag[16]
```

`ciphertext || tag` is AES-256-GCM output (tag appended) over `plaintext`:

```
plaintext = flag[1] || body
flag 0x00 : body = UTF-8 JSON
flag 0x01 : body = raw DEFLATE (RFC 1951, no zlib/gzip header) of UTF-8 JSON
```

The JSON value MUST be an object. Encoders serialise with sorted keys, no whitespace, UTF-8
(no `\u` escaping of non-ASCII) and SHOULD emit whichever flag gives the shorter body.
Decoders MUST accept both flags and MUST reject any other flag value.

Number formatting is not normative (Python writes `1.0` where JavaScript writes `1`); decoders
simply parse the JSON. Keys are ordered by Unicode code point, not UTF-16 code unit.

## 2. Cryptography (ECIES, sealed-box style)

| Step | Definition |
|---|---|
| Recipient keys | X25519, 32-byte raw keys (`recipient_priv`, `recipient_pub`) |
| Ephemeral | fresh X25519 key pair per token; `eph_pub` is sent in the envelope |
| Shared secret | `X25519(eph_priv, recipient_pub)` (decoder: `X25519(recipient_priv, eph_pub)`) |
| KDF | HKDF-SHA256, `salt = eph_pub \|\| recipient_pub`, `info = "metaqr/v1"` (ASCII), 44 bytes out |
| Key / nonce | `okm[0:32]` = AES-256-GCM key, `okm[32:44]` = 96-bit nonce |
| AAD | `"MQ1:"` (ASCII) `\|\| eph_pub` |
| Tag | 16 bytes, appended to the ciphertext |

The nonce is derived, not transmitted: each token uses a fresh ephemeral key, so a (key, nonce)
pair is never reused. Implementations MUST reject an all-zero X25519 shared secret (low-order
point) and MUST NOT distinguish failure causes (wrong key vs. tampering) to callers beyond a
single "decryption failed" error.

## 3. Text encoding

`base45` is RFC 9285. Its alphabet is exactly the QR *alphanumeric* mode set
(`0-9 A-Z space $ % * + - . / :`), so a QR encoder packs it at about 5.5 bits/char.
Decoders MUST strip leading/trailing whitespace from the token and MUST reject any character
outside the alphabet and any length with `len % 3 == 1`.

## 4. Limits

| Limit | Value | Reason |
|---|---|---|
| Plaintext JSON | <= 4096 bytes | bound memory; stop decompression bombs |
| Encode, token length | <= 800 chars by default; aim for <= 400 | QR density vs. readability |
| Decode, token length | <= 4400 chars | above QR v40 capacity: always garbage |
| Inflate output | <= 4096 bytes, stream must end cleanly | decompression-bomb guard |

## 5. QR guidance (non-normative)

- Error correction **Q** by default (H if you can afford a denser code).
- 4-module quiet zone, black on white, high contrast, shown large and static for the whole window.
- Typical sizes (measured with OpenCV's encoder, ECC Q): 60 B payload -> 45x45 modules,
  150 B -> 65x65, 250 B -> 81x81. Smaller payload = easier to read from a filmed screen.
- Use short opaque IDs, not names; look details up on the decoder side.

## 6. Browser (JS) implementation notes (non-normative)

- X25519, HKDF and AES-GCM are available in WebCrypto in current browsers; for older ones use
  `@noble/curves` (x25519) with `crypto.subtle` for the rest.
- DEFLATE: `CompressionStream("deflate-raw")` or `fflate` / `pako` (raw mode).
- Ship the recipient *public* key only. Never ship the private key.

## 7. What MQ1 does NOT provide

Confidentiality and tamper-evidence only. It does **not** authenticate the sender (anyone holding
the public key can mint a valid token), prevent replay of a token into another video, or bind a
token to a particular recording. Signed tokens (section 8) add sender authentication; the other two
remain out of scope (see 8.8).

## 8. MQ2: signed tokens

```
token    = "MQ2:" base45( envelope )
envelope = eph_pub[32] || ciphertext || tag[16]            (same construction as section 2)
plaintext = flag[1] || kid[8] || iat[4] || nonce[8] || sig[64] || body
```

### 8.1 Encryption differences from MQ1

Domain separation: HKDF `info = "metaqr/v2"` (ASCII) and AAD = `"MQ2:"` (ASCII) `||` `eph_pub`. A token
therefore cannot be re-labelled between MQ1 and MQ2 (decryption fails).

### 8.2 Plaintext fields

| Field | Size | Meaning |
|---|---|---|
| `flag` | 1 | bit 0 (`0x01`): `body` is raw DEFLATE of the JSON; otherwise plain UTF-8 JSON. **All other bits MUST be 0**; a decoder MUST reject unknown bits. |
| `kid` | 8 | key id of the signing device: first 8 bytes of SHA-256 of its raw 32-byte Ed25519 public key |
| `iat` | 4 | issue time, seconds since the Unix epoch, big-endian unsigned (device clock: not trustworthy by itself) |
| `nonce` | 8 | random, unique per token |
| `sig` | 64 | Ed25519 signature (RFC 8032, deterministic) |
| `body` | n | the metadata JSON (section 1), compressed or not per `flag` |

The signature is **inside** the encryption (sign-then-encrypt), so someone who only sees the QR cannot
tell which device made it or link two tokens to one device.

### 8.3 Signed message

```
msg = "metaqr/v2/sig" || 0x00 || recipient_pub[32] || kid[8] || iat[4] || nonce[8] || raw_json
```

`recipient_pub` is the decoder's X25519 public key; this binds a signature to one decoder, so a signed
plaintext re-encrypted to another decoder does not verify there. `raw_json` is the **decompressed** body
bytes exactly as transmitted: verifiers never re-serialise, so JSON formatting differences between
implementations cannot break signatures.

### 8.4 Verification procedure (order matters)

1. Decrypt (section 2 with the v2 constants). Failure -> reject.
2. Plaintext length at least 85 bytes; reject unknown `flag` bits.
3. If compressed, inflate with the 4096-byte bound; otherwise `body` MUST be at most 4096 bytes.
4. Look up `kid` in the allow-list: unknown -> reject; status `revoked` -> reject.
5. Verify `sig` over `msg` with the device's public key. Failure -> reject.
6. **Only now** parse `raw_json` (it MUST be a JSON object).
7. Optional replay check (8.6).

A verifier that requires signatures MUST reject MQ1 tokens (no downgrade).

### 8.5 Allow-list (`allowlist.json`)

```json
{"format": "metaqr-allowlist", "version": 1,
 "devices": [{"id": "hp-budi", "public_key": "<64 hex, Ed25519>", "label": "optional", "status": "active"}]}
```

`id`: 1 to 64 chars of `A-Z a-z 0-9 . _ : @ -`, unique. `status`: `active` (accepted), `retired` (accepted,
flagged: key rotated out), `revoked` (rejected, regardless of `iat`: a thief can backdate it). Two entries
with the same `kid` are an error. The file is trusted input: whoever can edit it decides who is trusted.

### 8.6 Replay log (informative)

`token_id` = first 16 bytes (hex) of SHA-256(`sig`). A decoder keeps `token_id -> source` records; seeing a
`token_id` again for the same source is fine (every frame of one video shows it), for a different source it
is a replay. It reveals that a token appears in two recordings, not which one is genuine.

### 8.7 Size

Signing adds 84 plaintext bytes (about 126 Base45 characters). A typical 3-field record grows from about
168 to 294 characters (QR 53x53 -> 65x65 modules at ECC Q).

### 8.8 What MQ2 still does NOT provide

- Proof of who held the device, or protection against a legitimate device signing false metadata.
- A trustworthy time: `iat` is the device's claim.
- Binding to a recording: the signature does not cover the video. A genuine signed QR can be filmed and
  shown at the start of another recording. Mitigations are outside this format (replay log, matching `iat`,
  session id and camera serial against the camera's Session JSON, hashing the video).
- Integrity of the allow-list file itself.

### 8.9 MQ2 conformance

`tests/vectors.json` contains a `v2` section (device seed, allow-list, fixed `iat`/`nonce`/ephemeral key).
An implementation is conformant if it verifies every `token` and `token_raw`, reproduces each `token_raw`
byte for byte (Ed25519 is deterministic), and rejects every `negative` vector with the named error.
