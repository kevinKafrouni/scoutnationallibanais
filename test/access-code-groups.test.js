import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { createApp } from '../server/app.js';
import { migrate } from '../server/migrate.js';
import { testDatabase } from './support/database.js';

test('access codes assign the next Card ID in their region, group and role sequence', async t => {
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
  const state = async () => (await request('/state', 'GET', undefined, admin)).data;
  const profile = { firstName: 'Group', lastName: 'Scout', fatherName: 'Parent', dateOfBirth: '2005-04-17', bloodType: 'O+', password };
  const nda = { regionCode: '02', groupCode: '024', roleCode: '2' };
  async function generate(fields, quantity = 1) {
    const before = new Set((await state()).codes.map(item => item.code));
    assert.equal((await request('/codes', 'POST', { quantity, ...fields }, admin)).status, 201);
    return (await state()).codes.filter(item => !before.has(item.code));
  }
  const register = (code, firstName) => request('/register', 'POST', { ...profile, firstName, accessCode: code,
    regionCode: '05', groupCode: '027', roleCode: '1', cardSerial: '9999', cardId: 'spoofed-id' });
  const ownMember = async result => (await request('/state', 'GET', undefined, result.cookie)).data.members[0];
  let codes;
  await t.test('only admins generate codes, metadata is validated, and generation reserves no serials', async () => {
    assert.equal((await request('/codes', 'POST', { quantity: 1, ...nda })).status, 401);
    for (const invalid of [{ groupCode: '101' }, { roleCode: '3' }, { regionCode: '06' }]) {
      assert.equal((await request('/codes', 'POST', { quantity: 1, ...nda, ...invalid }, admin)).status, 400);
    }
    assert.equal((await request('/admin/members', 'POST', { ...profile, cardId: '0202420012', cardIdMode: 'manual' }, admin)).status, 201);
    codes = await generate(nda, 4);
    assert.equal(codes.length, 4);
    assert.equal(codes[0].groupCode, '024');
    assert.equal(codes[0].regionCode, '02');
    assert.equal(codes[0].roleCode, '2');
    assert.equal((await db.query('SELECT count(*)::integer AS n FROM card_id_counters')).rows[0].n, 0);
  });
  await t.test('known groups use their assigned districts', async () => {
    for (const [groupCode, district] of [['024', '02'], ['025', '02'], ['027', '02'], ['026', '01']]) {
      const [code] = await generate({ ...nda, groupCode, regionCode: '05' });
      assert.equal(code.regionCode, district);
    }
  });
  await t.test('concurrent code redemption continues existing IDs and ignores member-supplied classification', async () => {
    const registrations = await Promise.all([register(codes[0].code, 'First'), register(codes[1].code, 'Second')]);
    assert.deepEqual(registrations.map(result => result.status), [201, 201]);
    const members = await Promise.all(registrations.map(ownMember));
    assert.deepEqual(members.map(member => member.cardId).sort(), ['0202420013', '0202420014']);
    for (const member of members) {
      assert.equal(member.regionCode, '02'); assert.equal(member.groupCode, '024'); assert.equal(member.roleCode, '2');
    }
    const duplicate = await Promise.all([register(codes[2].code, 'Third'), register(codes[2].code, 'Fourth')]);
    assert.deepEqual(duplicate.map(result => result.status).sort(), [201, 409]);
    assert.equal((await ownMember(duplicate.find(result => result.status === 201))).cardId, '0202420015');
    assert.equal(duplicate.find(result => result.status === 409).data.error, 'Invalid access code.');
  });
  await t.test('imported pending members receive their code sequence at activation and login ID stays unchanged', async () => {
    await request('/admin/members', 'POST', { ...profile, firstName: 'Imported', cardId: 'PENDING-PLACEHOLDER' }, admin);
    const pending = (await state()).members.find(member => member.firstName === 'Imported');
    const cookie = (await request('/login', 'POST', { type: 'member', scoutId: pending.scoutId, password })).cookie;
    const result = await request('/activate', 'POST', { accessCode: codes[3].code, password, groupCode: '027', cardSerial: '9999' }, cookie);
    assert.equal(result.status, 200);
    const active = await ownMember(result);
    assert.equal(active.cardId, '0202420016');
    assert.equal(active.scoutId, pending.scoutId);
    assert.equal(active.groupCode, '024');
    assert.equal((await request('/activate', 'POST', { accessCode: codes[3].code, password }, result.cookie)).status, 409);
    await request(`/admin/members/${active.id}`, 'DELETE', {}, admin);
    const [next] = await generate(nda);
    assert.equal((await ownMember(await register(next.code, 'After deletion'))).cardId, '0202420017');
  });
  await t.test('groups, regions and roles have independent sequences without granting admin privileges', async () => {
    for (const [fields, expected] of [
      [{ ...nda, groupCode: '025' }, '0202520001'], [{ ...nda, groupCode: '026', regionCode: '02' }, '0102620001'], [{ ...nda, roleCode: '1' }, '0202410001'],
    ]) {
      const [code] = await generate(fields);
      const result = await register(code.code, expected);
      assert.equal(result.status, 201);
      assert.equal((await ownMember(result)).cardId, expected);
      assert.equal((await request('/codes', 'POST', { quantity: 1, ...nda }, result.cookie)).status, 403);
    }
  });
  await t.test('exhaustion rolls back without redeeming the code, and migration preserves assignments', async () => {
    await db.query("UPDATE card_id_counters SET last_serial=9999 WHERE prefix='020252'");
    const [code] = await generate({ ...nda, groupCode: '025' });
    const before = (await state()).members.length;
    const result = await register(code.code, 'Exhausted');
    assert.equal(result.status, 400);
    assert.match(result.data.error, /allocated/);
    assert.equal((await state()).members.length, before);
    assert.equal((await state()).codes.find(item => item.code === code.code).usedBy, null);
    await migrate(db, password);
    assert.equal((await db.query("SELECT last_serial FROM card_id_counters WHERE prefix='020242'")).rows[0].last_serial, 17);
    assert.equal((await state()).codes.find(item => item.code === code.code).groupCode, '025');
  });
  await t.test('legacy codes remain valid without replacing an imported manual Card ID', async () => {
    await db.query("INSERT INTO access_codes (code) VALUES ('LEGACY-ACTIVATION')");
    await request('/admin/members', 'POST', { ...profile, firstName: 'Legacy', cardId: 'LEGACY-CARD', cardIdMode: 'manual' }, admin);
    const member = (await state()).members.find(item => item.firstName === 'Legacy');
    const cookie = (await request('/login', 'POST', { type: 'member', scoutId: member.scoutId, password })).cookie;
    const result = await request('/activate', 'POST', { accessCode: 'LEGACY-ACTIVATION', password }, cookie);
    assert.equal(result.status, 200);
    const active = await ownMember(result);
    assert.equal(active.cardId, 'LEGACY-CARD');
    assert.equal(active.scoutId, member.scoutId);
    assert.equal(active.groupCode, null);
  });
  await t.test('code cleanup preserves membership and expired members must renew without changing IDs', async () => {
    const [code, spare] = await generate(nda, 2);
    const registered = await register(code.code, 'Renewal');
    assert.equal(registered.status, 201);
    const member = await ownMember(registered);
    assert.equal((await request('/codes', 'DELETE', { scope: 'all' }, registered.cookie)).status, 403);
    assert.equal((await request('/codes', 'DELETE', { scope: 'single', code: spare.code }, admin)).data.deleted, 1);
    assert.equal((await register(spare.code, 'Deleted')).status, 409);
    assert.equal((await request('/codes', 'DELETE', { scope: 'all' }, admin)).status, 200);
    assert.equal((await ownMember(registered)).id, member.id);
    await db.query("UPDATE members SET access_code_expires_at=now() - interval '1 second' WHERE id=$1", [member.id]);
    const pending = (await request('/state', 'GET', undefined, registered.cookie)).data;
    assert.equal(pending.session.needsAccessCode, true);
    assert.deepEqual(pending.members, []);
    assert.equal((await request('/card/qr', 'GET', undefined, registered.cookie)).status, 403);
    const login = await request('/login', 'POST', { type: 'member', scoutId: member.scoutId, password });
    assert.equal(login.status, 200);
    const [renewal] = await generate({ ...nda, groupCode: '027' });
    const renewed = await request('/activate', 'POST', { accessCode: renewal.code, password }, login.cookie);
    assert.equal(renewed.status, 200);
    const active = await ownMember(renewed);
    assert.equal(active.cardId, member.cardId);
    assert.equal(active.scoutId, member.scoutId);
    assert.equal((await db.query("SELECT access_code_expires_at > now() + interval '364 days' AS valid FROM members WHERE id=$1", [member.id])).rows[0].valid, true);
    const [next] = await generate(nda);
    await db.query("UPDATE members SET access_code_expires_at=now() - interval '1 second' WHERE id=$1", [member.id]);
    assert.equal((await request('/activate', 'POST', { accessCode: next.code, password }, renewed.cookie)).status, 200);
    assert.equal((await request('/codes', 'DELETE', { scope: 'unused' }, admin)).status, 200);
  });

});
