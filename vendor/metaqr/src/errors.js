/** Error classes. Catch `MetaQRError` to handle every library error. */
export class MetaQRError extends Error {
  constructor(message) { super(message); this.name = new.target.name; }
}
export class InvalidKeyError extends MetaQRError {}
export class FormatError extends MetaQRError {}
export class PayloadTooLargeError extends FormatError {}
export class DecryptError extends MetaQRError {}
/** The runtime lacks WebCrypto X25519 / CompressionStream and no fallback was supplied. */
export class UnsupportedPlatformError extends MetaQRError {}
/** The token is signed (MQ2): decode() is for unsigned tokens; verification happens on the decoder (Python). */
export class SignedTokenError extends FormatError {}
