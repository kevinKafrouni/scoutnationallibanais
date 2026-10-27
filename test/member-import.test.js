import { test } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { PGlite } from '@electric-sql/pglite';
import { createApp } from '../server/app.js';
import { migrate } from '../server/migrate.js';
import { memberWorkbook } from '../server/member-import.js';
import { testDatabase } from './support/database.js';

test('Excel imports, gated activation, and atomic bulk edits', async t => {
  const engine = new PGlite();
  const db = testDatabase(engine);
  const password = 'admin-test-password';
  await migrate(db, password);
  const server = createApp(db).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await engine.close(); });
  async function request(path, method = 'GET', body, cookie) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
      method, headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000', ...(cookie ? { Cookie: cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = response.headers.get('content-type')?.includes('json') ? await response.json() : Buffer.from(await response.arrayBuffer());
    return { status: response.status, data, cookie: response.headers.get('set-cookie')?.split(';')[0] };
  }
  const admin = (await request('/login', 'POST', { type: 'admin', password })).cookie;
  const profile = { firstName: 'Imported', lastName: 'Scout', fatherName: 'Parent', dateOfBirth: '2005-04-17', bloodType: 'O+' };
  const firstRow = { ...profile, cardId: '00031001', username: 'imported.one' };
  const secondRow = { ...profile, username: 'imported.two', firstName: 'Second' };
  let preview, imported, first, second, pendingCookie, activeCookie;
  const previewRows = rows => request('/admin/import/preview', 'POST', { rows }, admin);
  const save = preview => request('/admin/import', 'POST', { rows: preview.rows, requestId: preview.requestId }, admin);
  const state = async () => (await request('/state', 'GET', undefined, admin)).data;

  await t.test('workbooks are admin-only and invalid files fail safely', async () => {
    for (const [path, method, body] of [['/admin/members-workbook', 'GET'], ['/admin/import/preview', 'POST', { fileData: 'not a file' }], ['/admin/import', 'POST', { rows: [] }]]) {
      assert.equal((await request(path, method, body)).status, 401);
    }
    assert.equal((await request('/admin/import/preview', 'POST', { fileData: 'not a file' }, admin)).status, 400);
    assert.equal((await previewRows([])).status, 400);
    assert.equal((await previewRows(Array(201).fill(firstRow))).status, 400);
    const zip = new JSZip();
    zip.file('large.xml', 'a'.repeat(10000001));
    const fileData = (await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })).toString('base64');
    assert.equal((await request('/admin/import/preview', 'POST', { fileData }, admin)).status, 400);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await memberWorkbook([firstRow]));
    workbook.getWorksheet('Members').getCell('E2').value = { formula: '1+1', result: 2 };
    assert.equal((await request('/admin/import/preview', 'POST', { fileData: Buffer.from(await workbook.xlsx.writeBuffer()).toString('base64') }, admin)).status, 400);
  });
  await t.test('Excel dates parse, preview is read-only, custom IDs reserve generated ID space', async () => {
    const template = await request('/admin/members-workbook?template=1', 'GET', undefined, admin);
    assert.equal(template.status, 200);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await memberWorkbook([firstRow, secondRow]));
    workbook.getWorksheet('Members').getCell('H2').value = new Date('2005-04-17T00:00:00Z');
    workbook.getWorksheet('Members').getCell('H2').numFmt = 'yyyy-mm-dd';
    const result = await request('/admin/import/preview', 'POST', { fileData: Buffer.from(await workbook.xlsx.writeBuffer()).toString('base64') }, admin);
    assert.equal(result.status, 200);
    preview = result.data;
    assert.deepEqual(preview.errors, []);
    assert.deepEqual(preview.summary, { added: 2, updated: 0 });
    assert.equal(preview.rows[0].dateOfBirth, '2005-04-17');
    assert.equal((await state()).members.length, 0);
    const saved = await save(preview);
    assert.equal(saved.status, 200);
    imported = saved.data;
    assert.equal(imported.credentials.length, 2);
    const members = (await state()).members;
    first = members.find(member => member.username === 'imported-scout');
    second = members.find(member => member.username === 'second-scout');
    assert.equal(first.scoutId, '00031001');
    assert.equal(second.scoutId, '00031002');
    assert.equal(first.accessCode, null);
    assert.equal(second.accessCode, null);
    const retry = await save(preview);
    assert.equal(retry.status, 200);
    assert.equal(retry.data.alreadyApplied, true);
    assert.deepEqual(retry.data.credentials, []);
    assert.equal((await state()).members.length, 2);
    const stored = await db.query('SELECT password_hash FROM members');
    for (const credential of imported.credentials) assert.equal(credential.initialPassword, '');
    assert.ok(stored.rows.every(row => row.password_hash === ''));
  });
  await t.test('pending members cannot bypass activation through direct API calls', async () => {
    const initialPassword = imported.credentials.find(row => row.username === first.username).initialPassword;
    pendingCookie = (await request('/login', 'POST', { type: 'member', scoutId: first.scoutId, password: initialPassword })).cookie;
    assert.ok(pendingCookie);
    const pending = (await request('/state', 'GET', undefined, pendingCookie)).data;
    assert.equal(pending.session.needsAccessCode, true);
    assert.deepEqual(pending.members, []);
    assert.equal((await request('/card/qr', 'GET', undefined, pendingCookie)).status, 403);
    assert.equal((await request('/photo', 'PUT', { photoDataUrl: '' }, pendingCookie)).status, 403);
    for (const [path, method, body] of [['/admin/members-workbook', 'GET'], ['/admin/import/preview', 'POST', { rows: [firstRow] }], ['/admin/import', 'POST', { rows: [firstRow] }]]) {
      assert.equal((await request(path, method, body, pendingCookie)).status, 403);
    }
    const invalid = await request('/activate', 'POST', { accessCode: 'missing', password: 'chosen-long-password' }, pendingCookie);
    assert.equal(invalid.status, 409);
    assert.equal(invalid.data.error, 'Invalid access code.');
    await request('/codes', 'POST', { quantity: 2 }, admin);
    const code = (await state()).codes[0].code;
    const activate = await request('/activate', 'POST', { accessCode: code, password: 'chosen-long-password', memberId: second.id }, pendingCookie);
    assert.equal(activate.status, 200);
    activeCookie = activate.cookie;
    const active = (await request('/state', 'GET', undefined, activeCookie)).data;
    assert.equal(active.session.needsAccessCode, false);
    assert.equal(active.members[0].id, first.id);
    assert.equal(active.members[0].accessCode, code);
    assert.equal((await state()).members.find(member => member.id === second.id).accessCode, null);
    assert.equal((await request('/state', 'GET', undefined, pendingCookie)).data.session.type, null);
    assert.equal((await request('/card/qr', 'GET', undefined, activeCookie)).status, 200);
    assert.equal((await request('/login', 'POST', { type: 'member', scoutId: first.scoutId, password: initialPassword })).status, 401);
    assert.equal((await request('/login', 'POST', { type: 'member', scoutId: first.scoutId, password: 'chosen-long-password' })).status, 200);
  });
  await t.test('duplicate IDs are rejected and Scout IDs can be swapped atomically', async () => {
    const members = (await state()).members;
    const duplicate = await previewRows(members.map(member => ({ ...member, cardIdMode: 'manual', cardId: 'SNL-123' })));
    assert.ok(duplicate.data.errors.some(error => /Duplicate cardId/.test(error.message)));
    assert.equal((await save(duplicate.data)).status, 400);
    const colliding = await previewRows([{ ...members[0], cardIdMode: 'manual', cardId: members[1].cardId }]);
    assert.ok(colliding.data.errors.some(error => /already assigned/.test(error.message)));
    const swapped = await previewRows(members.map((member, index) => ({ ...member, cardIdMode: 'manual', cardId: members[1 - index].cardId })));
    assert.deepEqual(swapped.data.errors, []);
    assert.equal((await save(swapped.data)).status, 200);
    const after = (await state()).members;
    for (const member of members) {
      assert.equal(after.find(row => row.id === member.id).cardId, members.find(row => row.id !== member.id).cardId);
      assert.equal(after.find(row => row.id === member.id).scoutId, member.scoutId);
    }
    assert.equal((await request('/state', 'GET', undefined, activeCookie)).data.members[0].id, first.id);
    assert.equal((await request('/login', 'POST', { type: 'member', scoutId: '00031001', password: 'chosen-long-password' })).status, 200);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load((await request('/admin/members-workbook', 'GET', undefined, admin)).data);
    assert.equal(workbook.getWorksheet('Members').getCell('J2').text, '');
    const roundTrip = await request('/admin/import/preview', 'POST', { fileData: Buffer.from(await workbook.xlsx.writeBuffer()).toString('base64') }, admin);
    assert.deepEqual(roundTrip.data.errors, []);
  });
  await t.test('stale exports and validation failures never partially save', async () => {
    const current = (await state()).members.find(row => row.id === first.id);
    const stale = await previewRows([{ ...current, firstName: 'Stale edit' }, { ...profile, username: 'should.not.exist' }]);
    assert.deepEqual(stale.data.errors, []);
    assert.equal((await request(`/admin/members/${first.id}`, 'PUT', { ...current, firstName: 'Current edit', password: '' }, admin)).status, 200);
    assert.equal((await save(stale.data)).status, 400);
    assert.equal((await state()).members.length, 2);
    assert.equal((await state()).members.find(row => row.id === first.id).firstName, 'Current edit');
    const invalid = await previewRows([{ ...profile, cardId: 'x'.repeat(61), username: 'ok.name' }, { ...profile, firstName: '', username: 'admin' }]);
    assert.equal(invalid.data.errors.length, 2);
    await migrate(db, password);
    assert.equal((await state()).members.find(row => row.id === second.id).accessCode, null);
  });
  await t.test('card IDs accept custom formats, login IDs stay fixed, and usernames default with collision suffixes', async () => {
    const defaults = await previewRows([{ ...profile, cardId: 'SNL/2026-001' }, { ...profile, cardId: 'SNL/2026-002' }]);
    assert.deepEqual(defaults.data.errors, []);
    assert.equal(defaults.data.rows[0].username, 'imported-scout-2');
    assert.equal(defaults.data.rows[1].username, 'imported-scout-3');
    assert.equal((await save(defaults.data)).status, 200);
    const current = (await state()).members.find(row => row.id === first.id);
    assert.equal((await request(`/admin/members/${first.id}`, 'PUT', { ...current, cardId: 'LEB-0042/A', password: '' }, admin)).status, 200);
    const edited = (await state()).members.find(row => row.id === first.id);
    assert.equal(edited.cardId, 'LEB-0042/A');
    assert.equal(edited.scoutId, current.scoutId);
    const rejectLoginEdit = await previewRows([{ ...edited, scoutId: '12345678' }]);
    assert.match(rejectLoginEdit.data.errors[0].message, /Login ID is read-only/);
    assert.equal((await request(`/admin/members/${first.id}`, 'PUT', { ...edited, scoutId: '12345678' }, admin)).status, 400);
    const download = await request('/admin/credentials-workbook', 'POST', { credentials: [{ scoutId: '00031001', cardId: 'LEB-0042/A', username: 'imported-scout', initialPassword: '=literal-password' }] }, admin);
    assert.equal(download.status, 200);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(download.data);
    const cell = workbook.getWorksheet('Credentials').getCell('D2');
    assert.equal(cell.value, '=literal-password');
    assert.equal(cell.type, ExcelJS.ValueType.String);
  });
  await t.test('organizational numbering matches the confirmed examples and previews allocate without consuming serials', async () => {
    const source = [
      { ...profile, firstName: 'Leadership', regionCode: '02', groupCode: '03', roleCode: '1', cardSerial: '0001' },
      { ...profile, firstName: 'NDAK', regionCode: '02', groupCode: '027', roleCode: '2', cardSerial: '0001' },
      { ...profile, firstName: 'Automatic', regionCode: '01', groupCode: '024', roleCode: '2' },
    ];
    const before = (await db.query('SELECT last_value,is_called FROM card_serial_seq')).rows[0];
    const preview = (await previewRows(source)).data;
    assert.deepEqual(preview.errors, []);
    assert.equal(preview.rows[0].cardId, '020310001');
    assert.equal(preview.rows[1].cardId, '0202720001');
    assert.match(preview.rows[2].cardId, /^020242\d{4}$/);
    assert.deepEqual((await db.query('SELECT last_value,is_called FROM card_serial_seq')).rows[0], before);
    assert.equal((await save(preview)).status, 200);
    const member = (await state()).members.find(row => row.cardId === '020310001');
    const loginId = member.scoutId;
    const changed = (await previewRows([{ id: member.id, revision: member.revision, regionCode: '05', groupCode: '025', roleCode: '2' }])).data;
    assert.equal(changed.rows[0].cardId, '0202520001');
    assert.equal((await save(changed)).status, 200);
    const after = (await state()).members.find(row => row.id === member.id);
    assert.equal(after.cardId, '0202520001');
    assert.equal(after.scoutId, loginId);
    const invalid = (await previewRows([{ ...profile, regionCode: '06' }, { ...profile, groupCode: '101' }, { ...profile, roleCode: '3' }, { ...profile, cardSerial: '0000' }])).data;
    assert.equal(invalid.errors.length, 4);
    await migrate(db, password);
    assert.equal((await state()).members.find(row => row.id === member.id).cardId, '0202520001');
    const one = (await previewRows([{ ...profile, firstName: 'Concurrent one', regionCode: '03' }])).data;
    const two = (await previewRows([{ ...profile, firstName: 'Concurrent two', regionCode: '04' }])).data;
    assert.equal(one.rows[0].cardSerial, two.rows[0].cardSerial);
    assert.equal((await save(one)).status, 200);
    const collision = await save(two);
    assert.equal(collision.status, 400);
    assert.match(collision.data.error, /allocated after preview/);
  });
});
