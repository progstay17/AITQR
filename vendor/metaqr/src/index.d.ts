export type KeyLike = Uint8Array | ArrayBuffer | string;

export interface X25519Backend {
  publicFromPrivate(priv: Uint8Array): Promise<Uint8Array>;
  exchange(priv: Uint8Array, pub: Uint8Array): Promise<Uint8Array>;
}
export interface CryptoOptions { x25519?: X25519Backend; }
/** A device signer: Ed25519 public key + sign function. */
export interface Signer {
  publicKey: Uint8Array;
  sign(message: Uint8Array): Promise<Uint8Array>;
}
export interface DeviceSigner {
  signer: Signer; keyPair: CryptoKeyPair; publicKey: Uint8Array; publicHex: string; kidHex: string;
  /** loadOrCreateDeviceSigner only: false = storage unavailable, the key lives until the page closes. */
  persisted?: boolean; created?: boolean; storageError?: string;
}
export interface DeviceStoreOptions { dbName?: string; storeName?: string; keyName?: string; }
export interface EncodeOptions extends CryptoOptions {
  /** Sign the token with this device key (makes an MQ2 token). */
  signer?: Signer;
  /** null/undefined = automatic (smaller wins), true/false = force. */
  compress?: boolean | null;
  /** Hard cap on token length (default 800). Aim for <= 400. */
  maxChars?: number;
}
export type Metadata = Record<string, unknown>;

export function encode(metadata: Metadata, publicKey: KeyLike, options?: EncodeOptions): Promise<string>;
export function decode(token: string, privateKey: KeyLike, options?: CryptoOptions): Promise<Metadata>;
export function parse(token: string): Uint8Array;
export function tokenVersion(token: string): 1 | 2;
export function createDeviceSigner(): Promise<DeviceSigner>;
export function generateDeviceKey(): Promise<CryptoKeyPair>;
export function signerFromKeyPair(keyPair: CryptoKeyPair): Promise<Signer>;
export function signerFromSeed(seed: KeyLike): Promise<Signer>;
export function kidOf(publicKey: KeyLike): Promise<Uint8Array>;
export function loadOrCreateDeviceSigner(options?: DeviceStoreOptions): Promise<DeviceSigner>;
export function forgetDeviceKey(options?: DeviceStoreOptions): Promise<void>;
export function isToken(text: unknown): boolean;
export function compressionAvailable(): boolean;
export function fingerprint(publicKey: KeyLike): Promise<string>;
export function hexToBytes(hex: string): Uint8Array;
export function bytesToHex(bytes: Uint8Array): string;
export function generateKeyPair(options?: CryptoOptions): Promise<{
  privateKey: Uint8Array; publicKey: Uint8Array; privateHex: string; publicHex: string;
}>;
export const webCryptoX25519: X25519Backend;
export const DEFAULT_MAX_TOKEN_CHARS: number;
export const RECOMMENDED_TOKEN_CHARS: number;
export const VERSION: string;

export class MetaQRError extends Error {}
export class InvalidKeyError extends MetaQRError {}
export class FormatError extends MetaQRError {}
export class PayloadTooLargeError extends FormatError {}
export class DecryptError extends MetaQRError {}
export class UnsupportedPlatformError extends MetaQRError {}
export class SignedTokenError extends FormatError {}
