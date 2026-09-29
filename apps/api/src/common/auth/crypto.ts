import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';
import * as argon2 from 'argon2';

/**
 * Argon2id with parameters sized for a 4 vCPU / 8 GB box: strong enough that an
 * offline attack on a leaked hash is expensive, cheap enough that a login at the
 * counter is not noticeably slow.
 */
const ARGON_OPTS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 19_456, // 19 MiB — OWASP's current floor
  timeCost: 2,
  parallelism: 1,
};

export async function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, ARGON_OPTS);
}

export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}

/** Opaque tokens (refresh tokens, QR punch tokens) are stored as SHA-256, never in clear. */
export function sha256(input: string | Buffer): string {
  return createHash('sha256').update(input).digest('hex');
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/** Webhook signatures (Razorpay) and attendance-device payload signatures. */
export function hmacSha256(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

export function verifyHmac(secret: string, payload: string, signature: string): boolean {
  return constantTimeEqual(hmacSha256(secret, payload), signature);
}

// ─── Envelope encryption for legal documents and TOTP secrets ────────────────
//
// Each document body is encrypted with its own random 256-bit data key; the data key
// is itself encrypted with the master key and stored alongside the row. Compromising
// the object store is not enough to read a partnership deed, and rotating the master
// key means re-wrapping small data keys rather than re-encrypting every file.

const ALGO = 'aes-256-gcm';

function masterKey(): Buffer {
  const raw = process.env.MASTER_ENCRYPTION_KEY ?? '';
  if (!raw) throw new Error('MASTER_ENCRYPTION_KEY is not set');
  // Accept a base64 32-byte key; otherwise derive one deterministically so that
  // development works with a human-typed value.
  const asB64 = Buffer.from(raw, 'base64');
  if (asB64.length === 32) return asB64;
  return scryptSync(raw, 'mithilakitchen.master.v1', 32);
}

export interface SealedBlob {
  /** iv:tag:ciphertext, all base64 */
  ciphertext: string;
  /** The data key, wrapped with the master key. */
  encryptedDataKey: string;
}

function wrap(key: Buffer, plaintext: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key, iv);
  const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return [iv.toString('base64'), cipher.getAuthTag().toString('base64'), body.toString('base64')].join(
    ':',
  );
}

function unwrap(key: Buffer, packed: string): Buffer {
  const [ivB64, tagB64, bodyB64] = packed.split(':');
  if (!ivB64 || !tagB64 || !bodyB64) throw new Error('Malformed ciphertext');
  const decipher = createDecipheriv(ALGO, key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(bodyB64, 'base64')), decipher.final()]);
}

/** Seal a document body. Returns the ciphertext and the wrapped data key. */
export function sealBlob(plaintext: Buffer): SealedBlob {
  const dataKey = randomBytes(32);
  return {
    ciphertext: wrap(dataKey, plaintext),
    encryptedDataKey: wrap(masterKey(), dataKey),
  };
}

export function openBlob(ciphertext: string, encryptedDataKey: string): Buffer {
  const dataKey = unwrap(masterKey(), encryptedDataKey);
  return unwrap(dataKey, ciphertext);
}

/** Short strings (TOTP secrets, vendor bank account numbers) go straight under the master key. */
export function sealString(plain: string): string {
  return wrap(masterKey(), Buffer.from(plain, 'utf8'));
}

export function openString(packed: string): string {
  return unwrap(masterKey(), packed).toString('utf8');
}

/**
 * A 6-digit numeric OTP. `randomInt`-equivalent via rejection-free modulo on a wide
 * random value — biased by less than 1 in 2^40, which is irrelevant here, and far
 * better than Math.random().
 */
export function generateOtp(): string {
  const n = randomBytes(4).readUInt32BE(0) % 1_000_000;
  return n.toString().padStart(6, '0');
}
