import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { randomBytes, randomUUID } from 'node:crypto';
import { hashPassword } from './security.js';
import { defaultUsername, availableUsername } from './member-identifiers.js';
import { cardPlan, advanceCardSerial } from './card-numbering.js';
import { cardCatalog } from '../card-numbering-config.js';

export const workbookColumns = [
  ['id', 'Record ID'], ['revision', 'Revision'], ['cardId', 'Card ID'], ['username', 'Username (automatic, read-only)'],
  ['firstName', 'First name'], ['lastName', 'Last name'], ['fatherName', "Father's name"],
  ['dateOfBirth', 'Date of birth'], ['bloodType', 'Blood type'], ['password', 'Initial password'], ['scoutId', 'Login ID'],
  ['cardIdMode', 'Card ID mode'], ['regionCode', 'Region code'], ['groupCode', 'Group code'], ['roleCode', 'Role code'], ['cardSerial', 'Card serial'],
];
const maxRows = 200;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const fail = (status, message) => Object.assign(new Error(message), { status });
const normalizeHeader = value => String(value).toLowerCase().replace(/[^a-z0-9]/g, '');
const headerKeys = new Map(workbookColumns.flatMap(([key, label]) => [[normalizeHeader(key), key], [normalizeHeader(label), key]]));
headerKeys.set('password', 'password');
headerKeys.set('username', 'username');
headerKeys.set('dob', 'dateOfBirth');
headerKeys.set('scoutid', 'cardId'); // Accept the previous template's editable-ID heading.
headerKeys.set('loginid', 'scoutId');

export async function memberWorkbook(members = []) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Members');
  sheet.columns = workbookColumns.map(([key, header]) => ({ key, header, width: key === 'id' ? 40 : 22, style: { numFmt: '@' } }));
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  for (const member of members) sheet.addRow(Object.fromEntries(workbookColumns.map(([key]) => [key, key === 'password' ? '' : member[key] ?? ''])));
  const notes = workbook.addWorksheet('Instructions');
  for (const line of [
    'Use the Members sheet. Import at most 200 records per file. Only .xlsx files are supported.',
    'New records: leave Record ID and Revision blank. First name, Last name, Father\'s name, Date of birth and Blood type are required.',
    'Card ID: generated from the code columns in structured mode. In manual mode, enter up to 60 characters in your own format. Leading zeros are preserved.',
    'Numbering: region + group + role + four-digit serial. Example: 02 + 03 + 1 + 0001 = 020310001. Group 027 uses three digits: 02 + 027 + 2 + 0001 = 0202720001.',
    'Card ID mode: structured (generate from the code columns) or manual (keep the Card ID column). Existing exports preserve their mode. New rows default to structured unless a manual Card ID is supplied.',
    'Region code 00–05; role code 1 (leadership) or 2 (member); group 00–19 uses two digits, groups 20–100 use three digits (020–100). See Codes sheet.',
    'Blank serial on a new structured record is allocated automatically from a global sequence (0001–9999). Blank codes default to region 00, group 00, role 2. Review the preview before saving.',
    'Username: automatic and read-only. Generated as firstname-lastname with -2, -3, etc. for duplicates. Any supplied username is ignored. Existing usernames are preserved.',
    'Login ID: generated automatically and read-only. Leave blank for new records. Edit Card ID to change the ID printed on the card.',
    'Date of birth: YYYY-MM-DD text or an Excel date. Blood type: A+, A-, B+, B-, AB+, AB-, O+, O- or Unknown.',
    'Initial password: optional for NEW records, 12–128 characters. Blank means generate an individual temporary password.',
    'After first login, new records must redeem an unused access code and choose a new password before opening their profile.',
    'Bulk editing: export members, keep Record ID, Revision and Login ID unchanged, edit details or Card ID, then preview and confirm.',
    'For existing records, leave Initial password blank. Use Edit member to reset passwords. Missing rows are never deleted.',
    'All rows save together, or none do. Duplicate IDs, usernames and stale revisions are rejected.',
  ]) notes.addRow([line]);
  notes.getColumn(1).width = 130;
  const codes = workbook.addWorksheet('Codes');
  codes.columns = [{ header: 'Category', key: 'category', width: 18 }, { header: 'Code', key: 'code', width: 12, style: { numFmt: '@' } }, { header: 'Meaning', key: 'meaning', width: 65 }];
  for (const [category, values] of Object.entries(cardCatalog)) for (const [code, meaning] of values) codes.addRow({ category, code, meaning });
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

export async function credentialsWorkbook(credentials) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Credentials');
  sheet.columns = [['scoutId', 'Login ID'], ['cardId', 'Card ID'], ['username', 'Username'], ['initialPassword', 'Initial password']]
    .map(([key, header]) => ({ key, header, width: 32, style: { numFmt: '@' } }));
  sheet.getRow(1).font = { bold: true };
  for (const row of credentials) sheet.addRow(row);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

async function readWorkbook(base64) {
  if (typeof base64 !== 'string' || !base64.length || base64.length > 700000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) throw fail(400, 'Choose an .xlsx file smaller than 500 KB.');
  const buffer = Buffer.from(base64, 'base64');
  if (buffer.length > 500000) throw fail(400, 'Choose an .xlsx file smaller than 500 KB.');
  let workbook;
  try {
    const zip = await JSZip.loadAsync(buffer);
    const entries = Object.values(zip.files).filter(entry => !entry.dir);
    // Check declared ZIP sizes before ExcelJS decompresses XML or embedded media.
    if (entries.length > 200 || entries.reduce((sum, entry) => sum + (entry._data?.uncompressedSize ?? Infinity), 0) > 10000000) throw new Error('Workbook is too large');
    workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
  } catch { throw fail(400, 'Cannot read this workbook. Use the .xlsx template, with no embedded pictures and at most 200 records.'); }
  const sheet = workbook.getWorksheet('Members') || workbook.worksheets[0];
  if (!sheet || sheet.rowCount > maxRows + 1 || sheet.columnCount > 30) throw fail(400, 'Use a Members sheet with at most 200 records and 30 columns.');
  const columns = new Map();
  sheet.getRow(1).eachCell((cell, index) => {
    const key = headerKeys.get(normalizeHeader(cell.text));
    if (!key) throw fail(400, `Unknown column "${cell.text}". Use the downloadable template.`);
    if ([...columns.values()].includes(key)) throw fail(400, `Duplicate column "${cell.text}".`);
    columns.set(index, key);
  });
  for (const required of ['firstName', 'lastName', 'fatherName', 'dateOfBirth', 'bloodType']) {
    if (![...columns.values()].includes(required)) throw fail(400, `Missing column: ${workbookColumns.find(([key]) => key === required)[1]}.`);
  }
  const rows = [];
  sheet.eachRow((row, number) => {
    if (number === 1) return;
    const record = {};
    for (const [index, key] of columns) {
      const cell = row.getCell(index);
      if (cell.type === ExcelJS.ValueType.Formula || cell.type === ExcelJS.ValueType.Error) throw fail(400, `Row ${number}: replace formulas or error cells with plain values.`);
      record[key] = cell.value instanceof Date ? cell.value.toISOString().slice(0, 10) : key === 'password' ? cell.text : cell.text.trim();
    }
    if (Object.values(record).some(Boolean)) rows.push({ ...record, sourceRow: number });
  });
  return rows;
}

export function installMemberImport(app, db, { requireAdmin, profile, memberFields }) {
  async function validate(input, client = db) {
    if (!Array.isArray(input) || !input.length || input.length > maxRows) throw fail(400, 'Import between 1 and 200 records at a time.');
    const errors = [], rows = [];
    const originals = (await client.query(`SELECT ${memberFields} FROM members WHERE id=ANY($1::uuid[])`,
      [input.map(row => row?.id).filter(id => typeof id === 'string' && uuid.test(id))])).rows;
    input.forEach((row, index) => {
      const sourceRow = Number.isInteger(row?.sourceRow) && row.sourceRow >= 2 && row.sourceRow <= maxRows + 1 ? row.sourceRow : index + 2;
      try {
        if (!row || typeof row !== 'object' || Array.isArray(row)) throw fail(400, 'Invalid record.');
        const id = String(row.id || '').trim().toLowerCase();
        if (id && !uuid.test(id)) throw fail(400, 'Keep the original Record ID from the exported workbook.');
        const original = originals.find(member => member.id === id);
        const sourceRevision = row.revision;
        row = { ...original, ...row };
        const revision = sourceRevision === '' || sourceRevision === undefined || sourceRevision === null ? null : Number(sourceRevision);
        if (id && (!Number.isInteger(revision) || revision < 0)) throw fail(400, 'Keep the original Revision from the exported workbook.');
        if (!id && revision !== null) throw fail(400, 'New records must have a blank Record ID and Revision.');
        const loginId = String(row.scoutId || '').trim();
        if ((!id && loginId) || (original && loginId !== original.scoutId)) throw fail(400, 'Login ID is read-only. Edit Card ID instead.');
        const numbering = cardPlan(row, original);
        if (id && row.password) throw fail(400, 'Leave Initial password blank for existing records; use Edit member to reset it.');
        const preserveMissingFather = Boolean(original && !original.fatherName && !row.fatherName);
        const fields = profile({ ...row, photoDataUrl: undefined, fatherName: preserveMissingFather ? 'Legacy' : row.fatherName }, { passwordRequired: false });
        rows.push({ id: id || null, revision, scoutId: original?.scoutId || null, ...numbering,
          autoSerial: numbering.cardIdMode === 'structured' && (!numbering.cardSerial || row.autoSerial === true), username: original?.username || null,
          firstName: fields.firstName, lastName: fields.lastName, fatherName: preserveMissingFather ? null : fields.fatherName, dateOfBirth: fields.date,
          bloodType: row.bloodType, password: row.password || '', sourceRow });
      } catch (error) { errors.push({ row: sourceRow, message: error.message }); }
    });
    const allocationRows = rows.filter(row => row.autoSerial);
    if (allocationRows.length) {
      const sequence = (await client.query('SELECT last_value,is_called FROM card_serial_seq')).rows[0];
      let serial = Number(sequence.last_value) + (sequence.is_called ? 1 : 0);
      const existing = (await client.query('SELECT card_id,card_serial FROM members')).rows;
      for (const row of allocationRows.filter(row => row.cardSerial && !row.id)) {
        if (existing.some(member => member.card_serial === row.cardSerial)) errors.push({ row: row.sourceRow, message: 'This automatic serial was allocated after preview. Preview the original workbook again.' });
      }
      const usedSerials = new Set([...existing.map(row => row.card_serial), ...rows.map(row => row.cardSerial)].filter(Boolean));
      const usedIds = new Set([...existing.map(row => row.card_id), ...rows.map(row => row.cardId)].filter(Boolean));
      for (const row of allocationRows.filter(row => !row.cardSerial)) {
        let numbering;
        while (serial <= 9999) {
          numbering = cardPlan({ ...row, cardSerial: String(serial++) });
          if (!usedSerials.has(numbering.cardSerial) && !usedIds.has(numbering.cardId)) break;
          numbering = null;
        }
        if (!numbering) { errors.push({ row: row.sourceRow, message: 'All four-digit serial numbers have been allocated.' }); continue; }
        Object.assign(row, numbering);
        usedSerials.add(numbering.cardSerial); usedIds.add(numbering.cardId);
      }
    }
    const defaults = rows.filter(row => !row.username);
    if (defaults.length) {
      const bases = defaults.map(row => `${defaultUsername(row.firstName, row.lastName).slice(0, 20)}%`);
      const existing = (await client.query('SELECT username FROM members WHERE username LIKE ANY($1::text[])', [bases])).rows;
      const taken = new Set([...existing.map(row => row.username), ...rows.map(row => row.username).filter(Boolean)]);
      for (const row of defaults) row.username = availableUsername(defaultUsername(row.firstName, row.lastName), taken);
    }
    for (const key of ['id', 'cardId', 'username']) {
      const seen = new Set();
      for (const row of rows) {
        if (row[key] && seen.has(row[key])) errors.push({ row: row.sourceRow, message: `Duplicate ${key} in this file.` });
        if (row[key]) seen.add(row[key]);
      }
    }
    const found = (await client.query(`SELECT id,revision,card_id,username FROM members
      WHERE id=ANY($1::uuid[]) OR card_id=ANY($2::text[]) OR username=ANY($3::text[])`,
    [rows.filter(row => row.id).map(row => row.id), rows.map(row => row.cardId).filter(Boolean), rows.map(row => row.username).filter(Boolean)])).rows;
    const updates = new Map(rows.filter(row => row.id).map(row => [row.id, row]));
    for (const row of rows) {
      const existing = found.find(member => member.id === row.id);
      if (row.id && !existing) errors.push({ row: row.sourceRow, message: 'Record no longer exists. Export a fresh workbook.' });
      if (existing && existing.revision !== row.revision) errors.push({ row: row.sourceRow, message: 'Record changed since export. Export a fresh workbook.' });
      for (const [key, column] of [['cardId', 'card_id'], ['username', 'username']]) {
        const conflict = found.find(member => row[key] && member[column] === row[key] && member.id !== row.id);
        if (conflict && (key === 'username' || updates.get(conflict.id)?.[key] === row[key] || !updates.has(conflict.id))) {
          errors.push({ row: row.sourceRow, message: `${key} is already assigned to another member.` });
        }
      }
    }
    return { rows, errors, summary: { added: rows.filter(row => !row.id).length, updated: rows.filter(row => row.id).length } };
  }

  app.get('/api/admin/members-workbook', requireAdmin, async (req, res) => {
    const members = req.query.template === '1' ? [] : (await db.query(`SELECT ${memberFields} FROM members ORDER BY scout_id`)).rows;
    res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').attachment(req.query.template === '1' ? 'member-template.xlsx' : 'members-bulk-edit.xlsx');
    res.send(await memberWorkbook(members));
  });
  app.post('/api/admin/credentials-workbook', requireAdmin, async (req, res) => {
    const rows = req.body.credentials;
    if (!Array.isArray(rows) || !rows.length || rows.length > 1000 || rows.some(row => !row ||
      ['scoutId', 'cardId', 'username', 'initialPassword'].some(key => typeof row[key] !== 'string' || row[key].length > 128))) throw fail(400, 'Provide between 1 and 1000 new-member credentials.');
    res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').attachment('member-credentials.xlsx');
    res.send(await credentialsWorkbook(rows.map(row => Object.fromEntries(['scoutId', 'cardId', 'username', 'initialPassword'].map(key => [key, row[key]])))));
  });
  app.post('/api/admin/import/preview', requireAdmin, async (req, res) => {
    const rows = req.body.rows === undefined ? await readWorkbook(req.body.fileData) : req.body.rows;
    res.json({ ...await validate(rows), requestId: randomUUID() });
  });
  app.post('/api/admin/import', requireAdmin, async (req, res) => {
    const requestId = req.body.requestId;
    if (typeof requestId !== 'string' || !uuid.test(requestId)) throw fail(400, 'Preview the records before saving.');
    const previous = (await db.query('SELECT added,updated FROM member_import_batches WHERE id=$1', [requestId])).rows[0];
    if (previous) return res.json({ ok: true, alreadyApplied: true, ...previous, credentials: [] });
    const preview = await validate(req.body.rows);
    if (preview.errors.length) throw fail(400, `Row ${preview.errors[0].row}: ${preview.errors[0].message} No changes were saved.`);
    // Hash outside the transaction, with bounded concurrency.
    const newRows = preview.rows.filter(row => !row.id);
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(4, newRows.length) }, async () => {
      while (next < newRows.length) {
        const row = newRows[next++];
        row.initialPassword = row.password || randomBytes(18).toString('base64url');
        row.hash = await hashPassword(row.initialPassword);
      }
    }));
    const client = await db.connect();
    const credentials = [];
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(31002)');
      const saved = (await client.query('SELECT added,updated FROM member_import_batches WHERE id=$1', [requestId])).rows[0];
      if (saved) {
        await client.query('COMMIT');
        return res.json({ ok: true, alreadyApplied: true, ...saved, credentials: [] });
      }
      await client.query('SELECT id FROM members WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE', [preview.rows.filter(row => row.id).map(row => row.id)]);
      const checked = await validate(req.body.rows, client);
      if (checked.errors.length) throw fail(409, `Row ${checked.errors[0].row}: ${checked.errors[0].message} No changes were saved.`);
      await client.query('SET CONSTRAINTS members_card_id_key DEFERRED');
      for (const row of preview.rows.filter(row => row.id)) {
        await client.query(`UPDATE members SET card_id=$1,username=$2,first_name=$3,last_name=$4,father_name=$5,
          date_of_birth=$6,blood_type=$7,region_code=$9,group_code=$10,role_code=$11,card_serial=$12,revision=revision+1 WHERE id=$8`,
        [row.cardId, row.username, row.firstName, row.lastName, row.fatherName, row.dateOfBirth, row.bloodType, row.id, row.regionCode, row.groupCode, row.roleCode, row.cardSerial]);
      }
      // Reserve explicitly requested card IDs before assigning automatic IDs.
      for (const row of newRows.sort((a, b) => Number(Boolean(b.cardId)) - Number(Boolean(a.cardId)))) {
        const result = await client.query(`INSERT INTO members (id,card_id,username,first_name,last_name,father_name,date_of_birth,blood_type,password_hash,access_code,region_code,group_code,role_code,card_serial)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NULL,$10,$11,$12,$13) RETURNING scout_id AS "scoutId",card_id AS "cardId"`,
        [randomUUID(), row.cardId, row.username, row.firstName, row.lastName, row.fatherName, row.dateOfBirth, row.bloodType, row.hash, row.regionCode, row.groupCode, row.roleCode, row.cardSerial]);
        credentials.push({ ...result.rows[0], username: row.username, initialPassword: row.initialPassword });
      }
      if (preview.rows.some(row => row.cardSerial)) await advanceCardSerial(client);
      await client.query('INSERT INTO member_import_batches (id,added,updated) VALUES ($1,$2,$3)', [requestId, preview.summary.added, preview.summary.updated]);
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
    res.json({ ok: true, ...preview.summary, credentials });
  });
}
