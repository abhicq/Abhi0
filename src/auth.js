import crypto from 'node:crypto';
import { config } from './config.js';
import { q } from './db.js';

const b64u = (b) => Buffer.from(b).toString('base64url');

export function signJwt(payload, ttlSec = 60 * 60 * 24 * 7) {
  const header = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64u(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ttlSec }));
  const sig = crypto.createHmac('sha256', config.jwtSecret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

export function verifyJwt(token) {
  const [h, b, s] = String(token || '').split('.');
  if (!h || !b || !s) return null;
  const expected = crypto.createHmac('sha256', config.jwtSecret).update(`${h}.${b}`).digest('base64url');
  if (s.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(s), Buffer.from(expected))) return null;
  const payload = JSON.parse(Buffer.from(b, 'base64url').toString());
  if (payload.exp < Date.now() / 1000) return null;
  return payload;
}

export function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function checkPassword(pw, stored) {
  const [, saltHex, hashHex] = String(stored).split('$');
  if (!saltHex) return false;
  const hash = crypto.scryptSync(pw, Buffer.from(saltHex, 'hex'), 64);
  return crypto.timingSafeEqual(hash, Buffer.from(hashHex, 'hex'));
}

// AES-256-GCM for OAuth tokens at rest.
const encKey = crypto.createHash('sha256').update(config.encryptionKey).digest();
export function encrypt(text) {
  if (text == null) return null;
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', encKey, iv);
  const enc = Buffer.concat([c.update(String(text), 'utf8'), c.final()]);
  return `${iv.toString('hex')}:${c.getAuthTag().toString('hex')}:${enc.toString('hex')}`;
}
export function decrypt(blob) {
  if (!blob) return null;
  const [iv, tag, enc] = blob.split(':');
  const d = crypto.createDecipheriv('aes-256-gcm', encKey, Buffer.from(iv, 'hex'));
  d.setAuthTag(Buffer.from(tag, 'hex'));
  return Buffer.concat([d.update(Buffer.from(enc, 'hex')), d.final()]).toString('utf8');
}

export async function requireAuth(req, res, next) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const payload = verifyJwt(token);
  if (!payload) return res.status(401).json({ error: 'Unauthorized' });
  const user = await q.get('SELECT id, tenant_id, email, name, role, is_platform_admin FROM users WHERE id = ?', payload.uid);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  req.user = user;
  req.tenantId = user.tenant_id;
  next();
}

export function requirePlatformAdmin(req, res, next) {
  if (!req.user?.is_platform_admin) return res.status(403).json({ error: 'Platform admin only' });
  next();
}
