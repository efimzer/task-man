import { randomBytes, pbkdf2Sync } from 'node:crypto';

const PBKDF2_ITERATIONS = 120000;
const KEY_LENGTH = 32;
const DIGEST = 'sha256';

export function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  const hash = pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, KEY_LENGTH, DIGEST).toString('hex');
  return { salt, hash };
}

export function verifyPassword(password, { salt, hash }) {
  if (!salt || !hash) {
    return false;
  }
  const candidate = hashPassword(password, salt).hash;
  return candidate === hash;
}
