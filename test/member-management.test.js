import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { createApp } from '../server/app.js';
import { migrate } from '../server/migrate.js';
import { testDatabase } from './support/database.js';

test('usernames and admin member management preserve authorization and code security', async t => {
  const engine = new PGlite();
  const db = testDatabase(engine);
  const password = 'a-long-test-password';
  await migrate(db, password);
  const server = createApp(db).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await engine.close(); });
  async function request(path, method = 'GET', body, cookie) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
      method, headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000', ...(cookie ? { Cookie: cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, data: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
  }
  const admin = (await request('/login', 'POST', { type: 'admin', password })).cookie;
  const profile = { firstName: 'Test', lastName: 'Scout', fatherName: 'Parent', dateOfBirth: '2005-04-17', bloodType: 'O+', password, username: 'Test.Scout' };
  await request('/codes', 'POST', { quantity: 1 }, admin);
  const code = (await request('/state', 'GET', undefined, admin)).data.codes[0].code;
  const registration = await request('/register', 'POST', { ...profile, accessCode: code });
  assert.equal(registration.status, 201);
  const member = (await request('/state', 'GET', undefined, registration.cookie)).data.members[0];
  assert.equal(member.username, 'test.scout');
  for (const invalidCode of [code, 'missing-code', '', 'x'.repeat(81)]) {
    const result = await request('/register', 'POST', { ...profile, accessCode: invalidCode });
    assert.equal(result.status, 409);
    assert.equal(result.data.error, 'Invalid access code.');
  }
  assert.equal((await request('/login', 'POST', { type: 'member', scoutId: ' TEST.SCOUT ', password })).status, 200);
  assert.equal((await request('/login', 'POST', { type: 'member', scoutId: member.scoutId, password })).status, 200);
  assert.equal((await request('/login', 'POST', { type: 'member', scoutId: `abc${member.scoutId}`, password })).status, 401);
  for (const [method, path] of [['POST', '/admin/members'], ['PUT', `/admin/members/${member.id}`], ['DELETE', `/admin/members/${member.id}`]]) {
    assert.equal((await request(path, method, profile)).status, 401);
    assert.equal((await request(path, method, profile, registration.cookie)).status, 403);
  }
  assert.equal((await request('/admin/members', 'POST', profile, admin)).status, 409);
  assert.equal((await request('/admin/members', 'POST', { ...profile, username: 'admin' }, admin)).status, 400);
  assert.equal((await request('/admin/members', 'POST', { ...profile, username: 'added.scout' }, admin)).status, 201);
  const added = (await request('/state', 'GET', undefined, admin)).data.members.find(m => m.username === 'added.scout');
  assert.ok(added);
  const addedLogin = await request('/login', 'POST', { type: 'member', scoutId: 'added.scout', password });
  assert.equal(addedLogin.status, 200);
  assert.equal((await request(`/admin/members/${added.id}`, 'PUT', { ...profile, username: 'edited.scout', firstName: 'Edited', password: '' }, admin)).status, 200);
  assert.equal((await request('/login', 'POST', { type: 'member', scoutId: 'edited.scout', password })).status, 200);
  const newPassword = 'new-long-test-password';
  assert.equal((await request(`/admin/members/${added.id}`, 'PUT', { ...profile, username: 'edited.scout', password: newPassword }, admin)).status, 200);
  assert.equal((await request('/state', 'GET', undefined, addedLogin.cookie)).data.session.type, null);
  assert.equal((await request('/login', 'POST', { type: 'member', scoutId: 'edited.scout', password })).status, 401);
  assert.equal((await request('/login', 'POST', { type: 'member', scoutId: 'edited.scout', password: newPassword })).status, 200);
  assert.equal((await request(`/admin/members/${member.id}`, 'DELETE', {}, admin)).status, 200);
  assert.equal((await request('/state', 'GET', undefined, registration.cookie)).data.session.type, null);
  assert.equal((await request('/register', 'POST', { ...profile, accessCode: code })).data.error, 'Invalid access code.');
  assert.equal((await request(`/admin/members/${member.id}`, 'DELETE', {}, admin)).status, 404);
  await migrate(db, password);
  assert.equal((await request('/login', 'POST', { type: 'member', scoutId: 'edited.scout', password: newPassword })).status, 200);
});
