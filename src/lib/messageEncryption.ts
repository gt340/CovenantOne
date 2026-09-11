import crypto from "crypto";

/**
 * Messages are stored as ciphertext + nonce (see the messages table),
 * encrypted here with a server-held key before every insert and decrypted
 * after every read. This is encryption at rest against anyone with direct
 * database access (including a compromised read-only DB credential) — it
 * is NOT end-to-end encryption, since the server holds the key. If true
 * end-to-end encryption is wanted later, this is the file to replace with
 * a client-side key-exchange scheme; nothing else needs to change since
 * callers only ever see plaintext in and plaintext out.
 */

const ALGORITHM = "aes-256-gcm";

function getKey(): Buffer {
  const secret = process.env.MESSAGE_ENCRYPTION_KEY;
  if (!secret) {
    throw new Error(
      "MESSAGE_ENCRYPTION_KEY is not set. Generate one with `openssl rand -hex 32` and set it as an env var on Vercel."
    );
  }
  const key = Buffer.from(secret, "hex");
  if (key.length !== 32) {
    throw new Error("MESSAGE_ENCRYPTION_KEY must be a 32-byte value, hex-encoded (64 hex characters).");
  }
  return key;
}

export function encryptMessage(plaintext: string): { ciphertext: Buffer; nonce: Buffer } {
  const nonce = crypto.randomBytes(12); // 96-bit nonce, standard for GCM
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), nonce);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  // Store the auth tag appended to the ciphertext so decryption can split it back out.
  return { ciphertext: Buffer.concat([encrypted, authTag]), nonce };
}

export function decryptMessage(ciphertext: Buffer, nonce: Buffer): string {
  const authTag = ciphertext.subarray(ciphertext.length - 16);
  const encrypted = ciphertext.subarray(0, ciphertext.length - 16);
  const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), nonce);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString("utf8");
}
