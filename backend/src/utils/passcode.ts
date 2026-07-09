import crypto from "crypto";

/**
 * Simple passcode hashing using Node's built-in scrypt - deliberately
 * not bcrypt/argon2 to avoid adding a new dependency for what is a
 * low-stakes secret (a team passcode for a private friends' league,
 * not a real account password). Format stored: "salt:hash", both hex.
 */
export function hashPasscode(passcode: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(passcode, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPasscode(passcode: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const candidate = crypto.scryptSync(passcode, salt, 64);
  const expected = Buffer.from(hash, "hex");
  if (candidate.length !== expected.length) return false;
  return crypto.timingSafeEqual(candidate, expected);
}
