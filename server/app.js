import express from 'express';
import helmet from 'helmet';
import QRCode from 'qrcode';
import { randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { digest, hashPassword, verifyPassword, validPassword } from './security.js';

const memberFields = `id, scout_id AS "scoutId", first_name AS "firstName", last_name AS "lastName",
  to_char(date_of_birth, 'YYYY-MM-DD') AS "dateOfBirth", blood_type AS "bloodType",
  photo_data_url AS "photoDataUrl", access_code AS "accessCode", registered_at AS "registeredAt"`;
const fail = (status, message) => Object.assign(new Error(message), { status });
function photo(value = '') {
  if (typeof value !== 'string' || value.length > 750000 ||
      (value !== '' && !/^data:image\/(jpeg|png);base64,[A-Za-z0-9+/]+={0,2}$/.test(value))) {
    throw fail(400, 'Choose a JPEG or PNG photo smaller than 550 KB after resizing.');
  }
  return value;
}
function profile(body) {
  const firstName = String(body.firstName || '').trim().replace(/\s+/g, ' ');
  const lastName = String(body.lastName || '').trim().replace(/\s+/g, ' ');
  const date = body.dateOfBirth;
  if (!firstName || !lastName || firstName.length > 60 || lastName.length > 60) throw fail(400, 'Enter a first and last name, up to 60 characters each.');
  const parsed = new Date(`${date}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date || date < '1900-01-01' || date > new Date().toISOString().slice(0, 10)) throw fail(400, 'Enter a valid date of birth from 1900 through today.');
  if (!['A+','A-','B+','B-','AB+','AB-','O+','O-','Unknown'].includes(body.bloodType)) throw fail(400, 'Choose a valid blood type.');
  if (!validPassword(body.password)) throw fail(400, 'Use a password of 12–128 characters.');
  return { firstName, lastName, date, photo: photo(body.photoDataUrl) };
}

export function createApp(db, { production = false, origin = 'http://localhost:3000', trustProxy = 0, serveStatic = true } = {}) {
  if (production && !origin.startsWith('https://')) throw new Error('APP_ORIGIN must be an HTTPS origin in production.');
  if (new URL(origin).origin !== origin) throw new Error('APP_ORIGIN must contain only the URL origin, with no trailing slash.');
  const app = express();
  app.set('trust proxy', trustProxy);
  app.disable('x-powered-by');
  app.use(helmet({ contentSecurityPolicy: { directives: {
    "img-src": ["'self'", 'data:', 'https://images.unsplash.com'],
    "upgrade-insecure-requests": production ? [] : null,
  } } }));
  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (!['GET', 'HEAD'].includes(req.method) && (req.get('origin') !== origin || !req.is('application/json'))) {
      return res.status(403).json({ error: 'Request origin or content type is not allowed.' });
    }
    next();
  });
  app.use(express.json({ limit: '1mb' }));
  app.use('/api', (req, res, next) => {
    if (!['GET', 'HEAD'].includes(req.method) && (!req.body || Array.isArray(req.body) || typeof req.body !== 'object')) {
      throw fail(400, 'Send a JSON object with the request.');
    }
    next();
  });

  const cookieOptions = { httpOnly: true, secure: production, sameSite: 'strict', path: '/' };
  const cookieName = production ? '__Host-snl-session' : 'snl-session';
  app.use('/api', async (req, res, next) => {
    const token = (req.headers.cookie || '').split(';').map(v => v.trim()).find(v => v.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
    req.tokenHash = token && /^[a-f0-9]{64}$/.test(token) ? digest(token) : null;
    if (req.tokenHash) {
      req.auth = (await db.query('SELECT role, member_id FROM sessions WHERE token_hash = $1 AND expires_at > now()', [req.tokenHash])).rows[0];
    }
    next();
  });
  function requireRole(role) {
    return (req, res, next) => {
      if (!req.auth) throw fail(401, 'Please sign in again.');
      if (req.auth.role !== role) throw fail(403, 'You do not have access to this action.');
      next();
    };
  }
  async function rateLimit(req, res, next) {
    const key = digest(`${req.ip}:authentication`);
    const { rows } = await db.query(`INSERT INTO rate_limits VALUES ($1, 1, now() + interval '15 minutes')
      ON CONFLICT (key) DO UPDATE SET hits = CASE WHEN rate_limits.expires_at < now() THEN 1 ELSE rate_limits.hits + 1 END,
      expires_at = CASE WHEN rate_limits.expires_at < now() THEN now() + interval '15 minutes' ELSE rate_limits.expires_at END RETURNING hits`, [key]);
    if (rows[0].hits > 30) { res.set('Retry-After', '900'); throw fail(429, 'Too many attempts. Try again in 15 minutes.'); }
    next();
  }
  async function issueSession(client, req, role, memberId = null) {
    const token = randomBytes(32).toString('hex');
    if (req.tokenHash) await client.query('DELETE FROM sessions WHERE token_hash = $1', [req.tokenHash]);
    await client.query("INSERT INTO sessions VALUES ($1, $2, $3, now() + interval '12 hours')", [digest(token), role, memberId]);
    return token;
  }
  const setCookie = (res, token) => res.cookie(cookieName, token, { ...cookieOptions, maxAge: 12 * 60 * 60 * 1000 });
  const dummyHash = hashPassword(randomBytes(32).toString('hex'));

  app.get('/healthz', async (req, res) => { await db.query('SELECT 1'); res.json({ status: 'ok' }); });
  app.get('/api/state', async (req, res) => {
    const counts = (await db.query(`SELECT (SELECT count(*)::int FROM members) AS members,
      (SELECT count(*)::int FROM access_codes WHERE used_by IS NULL) AS unused`)).rows[0];
    let members = [], codes = [];
    if (req.auth?.role === 'admin') {
      members = (await db.query(`SELECT ${memberFields} FROM members ORDER BY scout_id`)).rows;
      codes = (await db.query('SELECT code, created_at AS "createdAt", used_by AS "usedBy", used_at AS "usedAt" FROM access_codes ORDER BY created_at DESC, code')).rows;
    } else if (req.auth?.role === 'member') {
      members = (await db.query(`SELECT ${memberFields} FROM members WHERE id = $1`, [req.auth.member_id])).rows;
    }
    res.json({ members, codes, counts, session: { type: req.auth?.role || null, memberId: req.auth?.member_id || null } });
  });
  app.post('/api/login', rateLimit, async (req, res) => {
    const { password, type } = req.body;
    if (typeof password !== 'string' || password.length > 128 || !['member', 'admin'].includes(type)) throw fail(400, 'Invalid sign-in details.');
    const scoutId = String(req.body.scoutId || '').trim().replace(/\D/g, '').padStart(8, '0');
    const result = type === 'admin' ? await db.query('SELECT password_hash FROM admin_account WHERE id = 1') : await db.query('SELECT id, password_hash FROM members WHERE scout_id = $1', [scoutId]);
    const account = result.rows[0];
    const valid = await verifyPassword(password, account?.password_hash || await dummyHash);
    if (!account || !valid) throw fail(401, 'Incorrect sign-in details.');
    const token = await issueSession(db, req, type, account.id || null);
    setCookie(res, token); res.json({ ok: true });
  });
  app.post('/api/register', rateLimit, async (req, res) => {
    const fields = profile(req.body);
    const code = String(req.body.accessCode || '').trim().toUpperCase();
    if (code.length > 80) throw fail(400, 'Invalid access code.');
    const passwordHash = await hashPassword(req.body.password);
    const client = await db.connect();
    let token;
    try {
      await client.query('BEGIN');
      const existing = (await client.query('SELECT code, used_by FROM access_codes WHERE code = $1 FOR UPDATE', [code])).rows[0];
      if (!existing || existing.used_by) throw fail(409, 'This access code is invalid or has already been used.');
      const id = randomUUID();
      await client.query(`INSERT INTO members (id,first_name,last_name,date_of_birth,blood_type,password_hash,photo_data_url,access_code)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [id, fields.firstName, fields.lastName, fields.date, req.body.bloodType, passwordHash, fields.photo, code]);
      await client.query('UPDATE access_codes SET used_by = $1, used_at = now() WHERE code = $2', [id, code]);
      token = await issueSession(client, req, 'member', id);
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
    setCookie(res, token); res.status(201).json({ ok: true });
  });
  app.post('/api/logout', async (req, res) => {
    if (req.tokenHash) await db.query('DELETE FROM sessions WHERE token_hash = $1', [req.tokenHash]);
    res.clearCookie(cookieName, cookieOptions); res.json({ ok: true });
  });
  app.post('/api/codes', requireRole('admin'), async (req, res) => {
    const quantity = req.body.quantity;
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 1000) throw fail(400, 'Choose between 1 and 1000 codes.');
    const codes = Array.from({ length: quantity }, () => `SNL-${randomBytes(8).toString('hex').toUpperCase()}`);
    await db.query('INSERT INTO access_codes (code) SELECT unnest($1::text[])', [codes]);
    res.status(201).json({ ok: true });
  });
  app.put('/api/photo', requireRole('member'), async (req, res) => {
    await db.query('UPDATE members SET photo_data_url = $1 WHERE id = $2', [photo(req.body.photoDataUrl), req.auth.member_id]);
    res.json({ ok: true });
  });
  app.put('/api/admin/password', requireRole('admin'), rateLimit, async (req, res) => {
    if (!validPassword(req.body.password)) throw fail(400, 'Use a password of 12–128 characters.');
    const account = (await db.query('SELECT password_hash FROM admin_account WHERE id = 1')).rows[0];
    if (typeof req.body.currentPassword !== 'string' || req.body.currentPassword.length > 128 || !await verifyPassword(req.body.currentPassword, account.password_hash)) throw fail(401, 'Current password is incorrect.');
    const hash = await hashPassword(req.body.password);
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await client.query('UPDATE admin_account SET password_hash = $1 WHERE id = 1', [hash]);
      await client.query("DELETE FROM sessions WHERE role = 'admin' AND token_hash <> $1", [req.tokenHash]);
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
    res.json({ ok: true });
  });
  app.get('/api/card/qr', requireRole('member'), async (req, res) => {
    const member = (await db.query('SELECT scout_id FROM members WHERE id = $1', [req.auth.member_id])).rows[0];
    res.type('png').send(await QRCode.toBuffer(`Scout National Libanais\nScout ID: ${member.scout_id}`, { width: 220, margin: 2 }));
  });
  app.use('/api', (req, res) => res.status(404).json({ error: 'Unknown API endpoint.' }));
  // Explicit allowlist: never expose .env, source files, or database backups.
  // Netlify serves static files itself; its CommonJS bundle has no import.meta.url.
  const root = serveStatic ? fileURLToPath(new URL('../', import.meta.url)) : undefined;
  for (const file of serveStatic ? ['index.html', 'portal.html', 'app.js', 'styles.css', 'id-front.jpeg'] : []) {
    app.get(file === 'index.html' ? ['/', '/index.html'] : `/${file}`, (req, res) => res.sendFile(file, { root }));
  }
  app.use((error, req, res, next) => {
    const status = error.status || 500;
    if (status >= 500) console.error('Request failed:', error.code || error.name);
    res.status(status).json({ error: status >= 500 ? 'The server could not complete this request. Please try again.' : status === 413 ? 'The uploaded file is too large.' : error.message });
  });
  return app;
}
