import express from 'express';
import helmet from 'helmet';
import QRCode from 'qrcode';
import { randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { digest, hashPassword, verifyPassword, validPassword } from './security.js';
import { installMemberImport } from './member-import.js';
import { resolveUsername } from './member-identifiers.js';
import { cardPlan, resolveCard, resolveCodeCard, advanceCardSerial } from './card-numbering.js';

const memberFields = `id, revision, username, scout_id AS "scoutId", card_id AS "cardId",
  region_code AS "regionCode",group_code AS "groupCode",role_code AS "roleCode",card_serial AS "cardSerial",
  CASE WHEN region_code IS NULL THEN 'manual' ELSE 'structured' END AS "cardIdMode",
  first_name AS "firstName", last_name AS "lastName", father_name AS "fatherName",
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
function profile(body, { passwordRequired = true } = {}) {
  const firstName = String(body.firstName || '').trim().replace(/\s+/g, ' ');
  const lastName = String(body.lastName || '').trim().replace(/\s+/g, ' ');
  const fatherName = typeof body.fatherName === 'string' ? body.fatherName.trim().replace(/\s+/g, ' ') : '';
  if (!fatherName || fatherName.length > 60) throw fail(400, "Enter a father's name, up to 60 characters.");
  const date = body.dateOfBirth;
  if (!firstName || !lastName || firstName.length > 60 || lastName.length > 60) throw fail(400, 'Enter a first and last name, up to 60 characters each.');
  const parsed = new Date(`${date}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date || date < '1900-01-01' || date > new Date().toISOString().slice(0, 10)) throw fail(400, 'Enter a valid date of birth from 1900 through today.');
  if (!['A+','A-','B+','B-','AB+','AB-','O+','O-','Unknown'].includes(body.bloodType)) throw fail(400, 'Choose a valid blood type.');
  if ((passwordRequired || (body.password !== undefined && body.password !== '')) && !validPassword(body.password)) throw fail(400, 'Use a password of 12–128 characters.');
  return { firstName, lastName, fatherName, date, photo: photo(body.photoDataUrl) };
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
      req.auth = (await db.query(`SELECT s.role, s.member_id, (s.role = 'member' AND (m.access_code IS NULL OR m.access_code_expires_at IS NULL OR m.access_code_expires_at <= now())) AS needs_access_code
        FROM sessions s LEFT JOIN members m ON m.id = s.member_id WHERE s.token_hash = $1 AND s.expires_at > now()`, [req.tokenHash])).rows[0];
    }
    next();
  });
  function requireRole(role, { allowPending = false } = {}) {
    return (req, res, next) => {
      if (!req.auth) throw fail(401, 'Please sign in again.');
      if (req.auth.role !== role) throw fail(403, 'You do not have access to this action.');
      if (role === 'member' && req.auth.needs_access_code && !allowPending) throw fail(403, 'Enter an access code to activate your account.');
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
      codes = (await db.query('SELECT code,region_code AS "regionCode",group_code AS "groupCode",role_code AS "roleCode",created_at AS "createdAt", used_by AS "usedBy", used_at AS "usedAt" FROM access_codes ORDER BY created_at DESC, code')).rows;
    } else if (req.auth?.role === 'member' && !req.auth.needs_access_code) {
      members = (await db.query(`SELECT ${memberFields} FROM members WHERE id = $1`, [req.auth.member_id])).rows;
    }
    res.json({ members, codes, counts, session: { type: req.auth?.role || null, memberId: req.auth?.member_id || null, needsAccessCode: Boolean(req.auth?.needs_access_code) } });
  });
  app.post('/api/login', rateLimit, async (req, res) => {
    const { password, type } = req.body;
    if (typeof password !== 'string' || password.length > 128 || !['member', 'admin'].includes(type)) throw fail(400, 'Invalid sign-in details.');
    const identifier = String(req.body.username || req.body.scoutId || '').trim().toLowerCase();
    const scoutId = /^\d{1,8}$/.test(identifier) ? identifier.padStart(8, '0') : null;
    const result = type === 'admin' ? await db.query('SELECT password_hash FROM admin_account WHERE id = 1') : await db.query('SELECT id, password_hash, access_code FROM members WHERE scout_id = $1 OR username = $2', [scoutId, identifier]);
    const account = result.rows[0];
    const valid = await verifyPassword(password, account?.password_hash || await dummyHash);
    const firstSetup = type === 'member' && account?.password_hash === '' && account.access_code === null && password === '';
    if (!account || (!valid && !firstSetup)) throw fail(401, 'Incorrect sign-in details.');
    const token = await issueSession(db, req, type, account.id || null);
    setCookie(res, token); res.json({ ok: true });
  });
  app.post('/api/register', rateLimit, async (req, res) => {
    const fields = profile(req.body);
    const code = String(req.body.accessCode || '').trim().toUpperCase();
    if (!code || code.length > 80) throw fail(409, 'Invalid access code.');
    const passwordHash = await hashPassword(req.body.password);
    const client = await db.connect();
    let token;
    try {
      await client.query('BEGIN');
      const existing = (await client.query('SELECT code, used_by,region_code,group_code,role_code FROM access_codes WHERE code = $1 FOR UPDATE', [code])).rows[0];
      if (!existing || existing.used_by) throw fail(409, 'Invalid access code.');
      const name = await resolveUsername(client, null, fields.firstName, fields.lastName);
      const numbering = existing.group_code === null ? await resolveCard(client) : await resolveCodeCard(client, existing);
      const id = randomUUID();
      await client.query(`INSERT INTO members (id,first_name,last_name,date_of_birth,blood_type,password_hash,photo_data_url,access_code,father_name,username,card_id,region_code,group_code,role_code,card_serial)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`, [id, fields.firstName, fields.lastName, fields.date, req.body.bloodType, passwordHash, fields.photo, code, fields.fatherName, name, numbering.cardId, numbering.regionCode, numbering.groupCode, numbering.roleCode, numbering.cardSerial]);
      await client.query("UPDATE members SET access_code_expires_at=now() + interval '1 year' WHERE id=$1", [id]);
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
  app.post('/api/activate', requireRole('member', { allowPending: true }), rateLimit, async (req, res) => {
    const code = typeof req.body.accessCode === 'string' ? req.body.accessCode.trim().toUpperCase() : '';
    if (!code || code.length > 80) throw fail(409, 'Invalid access code.');
    if (!validPassword(req.body.password)) throw fail(400, 'Choose a new password of 12–128 characters.');
    const hash = await hashPassword(req.body.password);
    const client = await db.connect();
    let token;
    try {
      await client.query('BEGIN');
      const existing = (await client.query('SELECT code, used_by,region_code,group_code,role_code FROM access_codes WHERE code=$1 FOR UPDATE', [code])).rows[0];
      if (!existing || existing.used_by) throw fail(409, 'Invalid access code.');
      await client.query('SELECT pg_advisory_xact_lock(31002)');
      const member = (await client.query('SELECT access_code, (access_code_expires_at > now()) AS active FROM members WHERE id=$1 FOR UPDATE', [req.auth.member_id])).rows[0];
      if (!member) throw fail(401, 'Please sign in again.');
      if (member.access_code !== null && member.active) throw fail(409, 'Your account is already active.');
      if (member.access_code === null && existing.group_code !== null) {
        const numbering = await resolveCodeCard(client, existing, req.auth.member_id);
        await client.query(`UPDATE members SET card_id=$1,region_code=$2,group_code=$3,role_code=$4,card_serial=$5 WHERE id=$6`,
          [numbering.cardId, numbering.regionCode, numbering.groupCode, numbering.roleCode, numbering.cardSerial, req.auth.member_id]);
      }
      await client.query("UPDATE members SET access_code=$1,password_hash=$2,access_code_expires_at=now() + interval '1 year',revision=revision+1 WHERE id=$3", [code, hash, req.auth.member_id]);
      await client.query('UPDATE access_codes SET used_by=$1,used_at=now() WHERE code=$2', [req.auth.member_id, code]);
      await client.query('DELETE FROM sessions WHERE member_id=$1', [req.auth.member_id]);
      token = await issueSession(client, req, 'member', req.auth.member_id);
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
    setCookie(res, token); res.json({ ok: true });
  });
  app.post('/api/codes', requireRole('admin'), async (req, res) => {
    const quantity = req.body.quantity;
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 1000) throw fail(400, 'Choose between 1 and 1000 codes.');
    const numbering = cardPlan({ cardIdMode: 'structured', regionCode: req.body.regionCode, groupCode: req.body.groupCode, roleCode: req.body.roleCode });
    const codes = Array.from({ length: quantity }, () => `SNL-${randomBytes(8).toString('hex').toUpperCase()}`);
    await db.query('INSERT INTO access_codes (code,region_code,group_code,role_code) SELECT unnest($1::text[]),$2,$3,$4', [codes, numbering.regionCode, numbering.groupCode, numbering.roleCode]);
    res.status(201).json({ ok: true });
  });
  app.delete('/api/codes', requireRole('admin'), async (req, res) => {
    const { scope, code } = req.body;
    if (!['all', 'unused', 'single'].includes(scope) || (scope === 'single' && typeof code !== 'string')) throw fail(400, 'Choose which codes to delete.');
    const result = scope === 'all' ? await db.query('DELETE FROM access_codes')
      : scope === 'unused' ? await db.query('DELETE FROM access_codes WHERE used_by IS NULL')
      : await db.query('DELETE FROM access_codes WHERE code=$1', [code]);
    res.json({ ok: true, deleted: result.rowCount });
  });
  app.put('/api/photo', requireRole('member'), async (req, res) => {
    await db.query('UPDATE members SET photo_data_url = $1, revision=revision+1 WHERE id = $2', [photo(req.body.photoDataUrl), req.auth.member_id]);
    res.json({ ok: true });
  });
  app.post('/api/admin/members', requireRole('admin'), async (req, res) => {
    const fields = profile(req.body);
    const hash = await hashPassword(req.body.password);
    const id = randomUUID();
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(31002)');
      const name = await resolveUsername(client, null, fields.firstName, fields.lastName);
      const numbering = await resolveCard(client, req.body);
      await client.query(`INSERT INTO members (id,first_name,last_name,father_name,date_of_birth,blood_type,password_hash,access_code,username,card_id,region_code,group_code,role_code,card_serial)
        VALUES ($1,$2,$3,$4,$5,$6,$7,NULL,$8,$9,$10,$11,$12,$13)`, [id, fields.firstName, fields.lastName, fields.fatherName, fields.date, req.body.bloodType, hash, name, numbering.cardId, numbering.regionCode, numbering.groupCode, numbering.roleCode, numbering.cardSerial]);
      if (numbering.cardSerial) await advanceCardSerial(client);
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
    res.status(201).json({ ok: true });
  });
  app.put('/api/admin/members/:id', requireRole('admin'), async (req, res) => {
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(req.params.id)) throw fail(400, 'Invalid member ID.');
    const fields = profile(req.body, { passwordRequired: false });
    const hash = req.body.password ? await hashPassword(req.body.password) : null;
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(31002)');
      const current = (await client.query(`SELECT ${memberFields} FROM members WHERE id=$1 FOR UPDATE`, [req.params.id])).rows[0];
      if (!current) throw fail(404, 'Member not found.');
      const numbering = await resolveCard(client, { ...current, ...req.body }, current);
      const name = current.username || await resolveUsername(client, null, fields.firstName, fields.lastName, req.params.id);
      if (req.body.scoutId !== undefined) {
        const current = (await client.query('SELECT scout_id FROM members WHERE id=$1', [req.params.id])).rows[0];
        if (current && req.body.scoutId !== current.scout_id) throw fail(400, 'Login ID cannot be changed. Edit Card ID instead.');
      }
      const result = await client.query(`UPDATE members SET first_name=$1,last_name=$2,father_name=$3,date_of_birth=$4,
        blood_type=$5,username=$6,password_hash=COALESCE($7,password_hash),card_id=$9,region_code=$10,group_code=$11,role_code=$12,card_serial=$13,revision=revision+1 WHERE id=$8 RETURNING id`,
      [fields.firstName, fields.lastName, fields.fatherName, fields.date, req.body.bloodType, name, hash, req.params.id, numbering.cardId, numbering.regionCode, numbering.groupCode, numbering.roleCode, numbering.cardSerial]);
      if (numbering.cardSerial) await advanceCardSerial(client);
      if (!result.rows.length) throw fail(404, 'Member not found.');
      if (hash) await client.query('DELETE FROM sessions WHERE member_id=$1', [req.params.id]);
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
    res.json({ ok: true });
  });
  app.delete('/api/admin/members/:id', requireRole('admin'), async (req, res) => {
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(req.params.id)) throw fail(400, 'Invalid member ID.');
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      // Delete redeemed codes first so removing a member never makes a code reusable.
      await client.query('DELETE FROM access_codes WHERE used_by=$1', [req.params.id]);
      const result = await client.query('DELETE FROM members WHERE id=$1 RETURNING id', [req.params.id]);
      if (!result.rows.length) throw fail(404, 'Member not found.');
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
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
    const member = (await db.query('SELECT card_id FROM members WHERE id = $1', [req.auth.member_id])).rows[0];
    res.type('png').send(await QRCode.toBuffer(`Scout National Libanais\nCard ID: ${member.card_id}`, { width: 220, margin: 2 }));
  });
  installMemberImport(app, db, { requireAdmin: requireRole('admin'), profile, memberFields });
  app.use('/api', (req, res) => res.status(404).json({ error: 'Unknown API endpoint.' }));
  // Explicit allowlist: never expose .env, source files, or database backups.
  // Netlify serves static files itself; its CommonJS bundle has no import.meta.url.
  const root = serveStatic ? fileURLToPath(new URL('../', import.meta.url)) : undefined;
  for (const file of serveStatic ? ['index.html', 'portal.html', 'app.js', 'card-numbering-config.js', 'styles.css', 'id-front.jpeg', 'snl-logo.jpeg', 'favicon.ico', 'contact.html', 'site.js', 'site-config.js', 'contact-service.js', 'hero-mountains.jpg'] : []) {
    app.get(file === 'index.html' ? ['/', '/index.html'] : file === 'contact.html' ? ['/contact', '/contact/', '/contact.html'] : `/${file}`, (req, res) => res.sendFile(file, { root }));
  }
  app.use((error, req, res, next) => {
    if (error.code === '23505' && error.constraint === 'members_username_unique') return res.status(409).json({ error: 'Choose a different username.' });
    if (error.code === '23505' && error.constraint === 'members_scout_id_key') return res.status(409).json({ error: 'That Scout ID is already assigned. No changes were saved.' });
    if (error.code === '23505' && error.constraint === 'members_card_id_key') return res.status(409).json({ error: 'That Card ID is already assigned. No changes were saved.' });
    const status = error.status || 500;
    if (status >= 500) console.error('Request failed:', error.code || error.name);
    res.status(status).json({ error: status >= 500 ? 'The server could not complete this request. Please try again.' : status === 413 ? 'The uploaded file is too large.' : error.message });
  });
  return app;
}
