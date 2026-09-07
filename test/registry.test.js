import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { createApp } from '../server/app.js';
import { migrate } from '../server/migrate.js';

import { testDatabase } from './support/database.js';

test('database-backed registry integration', async (t) => {
  const engine = new PGlite();
  const db = testDatabase(engine);
  const password = 'a-long-test-password';
  await db.query('CREATE ROLE anon');
  await db.query('CREATE ROLE authenticated');
  await migrate(db, password);
  const app = createApp(db);
  let server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = () => `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await engine.close(); });
  async function request(path, { method = 'GET', body, cookie, origin = 'http://localhost:3000' } = {}) {
    const response = await fetch(base() + path, {
      method,
      headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json', Origin: origin }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const type = response.headers.get('content-type') || '';
    const data = type.includes('application/json') ? await response.json() : await response.text();
    return { status: response.status, data, headers: response.headers, cookie: response.headers.get('set-cookie')?.split(';')[0] };
  }
  let adminCookie, memberCookie, member, codes;
  await t.test('Supabase API roles have no registry privileges and RLS blocks rows even if SELECT is granted', async () => {
    const tables = ['members', 'access_codes', 'admin_account', 'sessions', 'rate_limits'];
    for (const role of ['anon', 'authenticated']) {
      for (const table of tables) {
        const result = await db.query('SELECT has_table_privilege($1, $2, $3) AS allowed', [role, table, 'SELECT,INSERT,UPDATE,DELETE']);
        assert.equal(result.rows[0].allowed, false);
      }
      const client = await db.connect();
      try {
        await client.query('BEGIN');
        await client.query(`GRANT USAGE ON SCHEMA public TO ${role}`);
        await client.query(`GRANT SELECT ON admin_account TO ${role}`);
        await client.query(`SET LOCAL ROLE ${role}`);
        assert.equal((await client.query('SELECT count(*)::int AS n FROM admin_account')).rows[0].n, 0);
      } finally { await client.query('ROLLBACK'); client.release(); }
    }
  });
  await t.test('migration is repeatable and does not reset admin password', async () => {
    await migrate(db, 'different-long-password');
    const login = await request('/api/login', { method: 'POST', body: { type: 'admin', password } });
    assert.equal(login.status, 200);
    assert.match(login.headers.get('set-cookie'), /HttpOnly/);
    assert.match(login.headers.get('set-cookie'), /SameSite=Strict/);
    adminCookie = login.cookie;
  });
  await t.test('anonymous users cannot read private data or generate codes', async () => {
    const result = await request('/api/state');
    assert.deepEqual(result.data.members, []);
    assert.deepEqual(result.data.codes, []);
    assert.equal((await request('/api/codes', { method: 'POST', body: { quantity: 2 } })).status, 401);
    assert.equal((await request('/api/card/qr')).status, 401);
  });
  await t.test('secrets and source files are never served', async () => {
    for (const path of ['/.env', '/server/schema.sql', '/package.json', '/.git/config']) {
      assert.equal((await request(path)).status, 404);
    }
    assert.equal((await request('/')).status, 200);
  });
  await t.test('cross-origin changes and invalid quantities are rejected', async () => {
    assert.equal((await request('/api/codes', { method: 'POST', cookie: adminCookie, origin: 'https://evil.example', body: { quantity: 1 } })).status, 403);
    assert.equal((await request('/api/codes', { method: 'POST', cookie: adminCookie, body: { quantity: 1001 } })).status, 400);
    assert.equal((await request('/api/codes', { method: 'POST', cookie: adminCookie, body: { quantity: 2 } })).status, 201);
    codes = (await request('/api/state', { cookie: adminCookie })).data.codes;
    assert.equal(codes.length, 2);
  });
  const registration = { firstName: 'Test', lastName: 'Scout', dateOfBirth: '2005-04-17', bloodType: 'O+', password };
  await t.test('registration validates inputs without consuming the access code', async () => {
    for (const invalid of [{ password: '1234' }, { dateOfBirth: '2005-02-31' }, { bloodType: 'invalid' }, { photoDataUrl: 'data:image/svg+xml;base64,abcd' }]) {
      assert.equal((await request('/api/register', { method: 'POST', body: { ...registration, accessCode: codes[0].code, ...invalid } })).status, 400);
    }
    assert.equal((await db.query('SELECT count(*)::int AS n FROM members')).rows[0].n, 0);
  });
  await t.test('competing registrations redeem an access code once', async () => {
    const attempts = await Promise.all([1, 2].map(() => request('/api/register', { method: 'POST', body: { ...registration, accessCode: codes[0].code } })));
    assert.deepEqual(attempts.map(r => r.status).sort(), [201, 409]);
    memberCookie = attempts.find(r => r.status === 201).cookie;
    const result = await request('/api/state', { cookie: memberCookie });
    assert.equal(result.data.members.length, 1);
    assert.equal(result.data.codes.length, 0);
    member = result.data.members[0];
    assert.equal(member.scoutId, '00031001');
    assert.equal(member.dateOfBirth, registration.dateOfBirth);
    assert.equal(member.password, undefined);
    assert.equal(member.password_hash, undefined);
    const stored = (await db.query('SELECT password_hash FROM members')).rows[0].password_hash;
    assert.ok(stored.startsWith('scrypt:'));
    assert.ok(!stored.includes(password));
    assert.equal((await request('/api/codes', { method: 'POST', cookie: memberCookie, body: { quantity: 1 } })).status, 403);
  });
  await t.test('members see only their own record and updates ignore supplied member IDs', async () => {
    const second = await request('/api/register', { method: 'POST', body: { ...registration, firstName: 'Second', accessCode: codes[1].code } });
    assert.equal(second.status, 201);
    const result = await request('/api/state', { cookie: second.cookie });
    assert.equal(result.data.members.length, 1);
    assert.equal(result.data.members[0].firstName, 'Second');
    const photoDataUrl = 'data:image/png;base64,iVBORw0KGgo=';
    assert.equal((await request('/api/photo', { method: 'PUT', cookie: memberCookie, body: { photoDataUrl, memberId: result.data.members[0].id } })).status, 200);
    assert.equal((await request('/api/state', { cookie: second.cookie })).data.members[0].photoDataUrl, '');
    assert.equal((await request('/api/state', { cookie: memberCookie })).data.members[0].photoDataUrl, photoDataUrl);
    const qr = await request('/api/card/qr', { cookie: memberCookie });
    assert.equal(qr.status, 200);
    assert.match(qr.headers.get('content-type'), /image\/png/);
  });
  await t.test('server restart preserves data and sessions; logout revokes session', async () => {
    await new Promise(resolve => server.close(resolve));
    server = createApp(db).listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    assert.equal((await request('/api/state', { cookie: memberCookie })).data.members[0].id, member.id);
    assert.equal((await request('/api/logout', { method: 'POST', cookie: memberCookie, body: {} })).status, 200);
    assert.equal((await request('/api/state', { cookie: memberCookie })).data.session.type, null);
    const login = await request('/api/login', { method: 'POST', body: { type: 'member', scoutId: member.scoutId, password } });
    assert.equal(login.status, 200);
    memberCookie = login.cookie;
    assert.equal((await request('/api/login', { method: 'POST', body: { type: 'member', scoutId: member.scoutId, password: 'wrong' } })).status, 401);
  });
  await t.test('password change verifies current password and revokes other admin sessions', async () => {
    const other = await request('/api/login', { method: 'POST', body: { type: 'admin', password } });
    const newPassword = 'a-new-long-password';
    assert.equal((await request('/api/admin/password', { method: 'PUT', cookie: adminCookie, body: { currentPassword: 'wrong', password: newPassword } })).status, 401);
    assert.equal((await request('/api/admin/password', { method: 'PUT', cookie: adminCookie, body: { currentPassword: password, password: newPassword } })).status, 200);
    assert.equal((await request('/api/state', { cookie: other.cookie })).data.session.type, null);
    assert.equal((await request('/api/login', { method: 'POST', body: { type: 'admin', password: newPassword } })).status, 200);
  });
  await t.test('expired sessions fail and authentication attempts are limited', async () => {
    await db.query("UPDATE sessions SET expires_at = now() - interval '1 minute'");
    assert.equal((await request('/api/photo', { method: 'PUT', cookie: memberCookie, body: { photoDataUrl: '' } })).status, 401);
    let result;
    for (let i = 0; i < 31; i++) result = await request('/api/login', { method: 'POST', body: { type: 'admin', password: 'wrong' } });
    assert.equal(result.status, 429);
    assert.equal(result.headers.get('retry-after'), '900');
  });
});
