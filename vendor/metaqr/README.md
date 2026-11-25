# metaqr (JavaScript)

Browser / Node **encoder** for metaqr tokens. Zero dependencies (WebCrypto + platform streams).
Tokens are byte-compatible with the Python library: the web tool creates them, the Python decoder
reads them back from the recording. Format: [../SPEC.md](../SPEC.md).

```js
import { encode } from "./src/index.js";

const PUBLIC_KEY = "07a37cbc...";     // 64 hex chars from `metaqr keygen` (public.key). NEVER the private key.

const token = await encode({ officer_id: "P-0427", session_id: "S-20261124-0007" }, PUBLIC_KEY);
// "MQ1:H0BZ:E492..."  -> hand this string to your QR renderer
```

`decode(token, privateKey)` also exists, for tests and verification of **unsigned** tokens only. In the field
the private key stays on the decoder PC, and signed tokens are verified by the Python decoder.

## Signing (per-device key)

```js
import { encode, loadOrCreateDeviceSigner } from "./src/index.js";

const dev = await loadOrCreateDeviceSigner();     // creates the key on first run, then reuses it
// Show dev.publicHex (and dev.kidHex) to the operator ONCE: the admin adds it to allowlist.json with
//   metaqr allowlist add allowlist.json --id hp-budi --pub <publicHex>
if (!dev.persisted) alert("Storage unavailable: this key will be lost when the page closes");

const token = await encode(meta, PUBLIC_KEY, { signer: dev.signer });     // "MQ2:..."
```

- The private key is generated **non-extractable** and stored as a `CryptoKey` in IndexedDB: the page's
  JavaScript can sign with it but cannot read it out. (Verified in Chromium: `exportKey` is rejected, the key
  survives page reloads, and different browser profiles get different keys.)
- If the site data is cleared, or the browser evicts storage (notably iOS for web apps that are not used for a
  while), the key is gone: the device gets a new key and needs a new allow-list entry. Warn operators.
- Needs WebCrypto **Ed25519** (current Chrome/Edge, Firefox and Safari should have it; **test on your phones**).
  Otherwise `UnsupportedPlatformError`; you can pass any signer object instead:
  `{ publicKey: Uint8Array(32), sign: async (message) => Uint8Array(64) }`.
- Other helpers: `createDeviceSigner()` (no storage), `signerFromSeed(seed)` (tests / Node scripts),
  `forgetDeviceKey()`, `kidOf(publicKey)`, `tokenVersion(token)`.
- A signed token is about 126 characters longer, so the QR is denser (65x65 vs 53x53 modules for a typical
  record). Show it larger.


## Requirements and platform notes

- **Secure context.** `crypto.subtle` exists only on HTTPS, `http://localhost`, and (in Chromium) `file://`.
  An installed PWA served over HTTPS and cached by a service worker works offline. If the context is
  not secure you get `UnsupportedPlatformError` with a message saying so.
- **Needs** WebCrypto with X25519, HKDF and AES-GCM, plus `CompressionStream("deflate-raw")`
  (compression only; without it tokens are simply sent uncompressed).
- Tested here on Node 22 and Chromium 157. Current Safari, Firefox and Chrome are documented to
  support WebCrypto X25519, but **test on your target phones** before relying on it.
- Browsers without WebCrypto X25519: pass a backend (below).

## Options

```js
await encode(metadata, publicKey, {
  compress: null,    // null = automatic (smaller wins), true / false = force
  maxChars: 800,     // hard cap on token length; aim for <= 400 (smaller QR = easier to read)
  x25519: backend,   // optional, see below
});
```
Metadata must be a plain JSON object (no `undefined`, `NaN`, `Date`, `Map`, `BigInt`, cycles). Use short
opaque IDs; look names up on the decoder side.

### Custom X25519 backend

A backend is two async functions. Example sketch with `@noble/curves` (**not tested here**; the injection
path is tested with a Node-crypto stand-in). Make sure `exchange` throws on an all-zero result, as the
spec requires.

```js
import { x25519 } from "@noble/curves/ed25519";
const backend = {
  async publicFromPrivate(priv) { return x25519.getPublicKey(priv); },
  async exchange(priv, pub)     { return x25519.getSharedSecret(priv, pub); },
};
await encode(meta, PUBLIC_KEY, { x25519: backend });
```
HKDF and AES-GCM still use WebCrypto, which exists wherever `crypto.subtle` does.

## Showing the token as a QR

This package only produces the token string; bring your own QR renderer (bundle it locally for offline
use, e.g. `nayuki-qr-code-generator` or `qrcode-generator`). Tips:

- The token is **uppercase** QR-alphanumeric text. Do not lowercase or URL-encode it.
- Use error correction **Q** (or H) and make sure the library encodes in *alphanumeric* mode (it makes the
  QR about 8 modules narrower than byte mode); byte mode still works, just denser.
- 4-module white quiet zone, black on white, full-screen, max brightness, keep the screen awake
  (Wake Lock API), and hold it static for the whole 3-5 s window.

## Tests

```bash
cd js && npm test                      # 45 tests, Node >= 20.12
node js/scripts/browser-check.cjs      # optional: vectors + device-key persistence + Python verification, inside Chromium (needs playwright)
```
Cross-language tests (Python <-> JS, bit-exact encoder comparison, QR image round trip) are in
`../tests/test_js_interop.py`.

## Known differences from Python (harmless)

- Compressed (flag 1) bodies can differ byte-wise, because DEFLATE output is not standardised. Both sides
  decode both. Uncompressed tokens are bit-identical.
- Numbers like `1.0` serialise as `1` in JS. Decoders parse JSON, so values compare equal.
