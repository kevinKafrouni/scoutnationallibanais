import { randomBytes, scrypt as scryptCallback, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
const scrypt = promisify(scryptCallback);
export const digest = (value) => createHash('sha256').update(value).digest('hex');
export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const key = await scrypt(password, salt, 64);
  return `scrypt:${salt}:${key.toString('hex')}`;
}
export async function verifyPassword(password, hash) {
  const [, salt, key] = hash.split(':');
  const derived = await scrypt(password, salt, 64);
  return timingSafeEqual(derived, Buffer.from(key, 'hex'));
}
export function validPassword(value) {
  return typeof value === 'string' && value.length >= 12 && value.length <= 128;
}
