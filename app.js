import { cardCatalog, formatCardParts } from './card-numbering-config.js';

const state = { members: [], codes: [], counts: { members: "...", unused: "..." } };
let session = { type: null, memberId: null };

const elements = {
  authView: document.querySelector("#authView"),
  memberView: document.querySelector("#memberView"),
  adminView: document.querySelector("#adminView"),
  sessionActions: document.querySelector("#sessionActions"),
  sessionName: document.querySelector("#sessionName"),
  signOutButton: document.querySelector("#signOutButton"),
  authTabs: document.querySelectorAll(".auth-tab"),
  authPanels: document.querySelectorAll(".auth-panel"),
  memberSignInPanel: document.querySelector("#memberSignInPanel"),
  signInScoutId: document.querySelector("#signInScoutId"),
  signInPassword: document.querySelector("#signInPassword"),
  signInMessage: document.querySelector("#signInMessage"),
  memberSignUpPanel: document.querySelector("#memberSignUpPanel"),
  registerMessage: document.querySelector("#registerMessage"),
  memberCountPublic: document.querySelector("#memberCountPublic"),
  codeForm: document.querySelector("#codeForm"),
  codeQuantity: document.querySelector("#codeQuantity"),
  codeList: document.querySelector("#codeList"),
  memberCountAdmin: document.querySelector("#memberCountAdmin"),
  membersTable: document.querySelector("#membersTable"),
  memberSearch: document.querySelector("#memberSearch"),
  exportCsv: document.querySelector("#exportCsv"),
  exportJson: document.querySelector("#exportJson"),
  copyUnusedCodes: document.querySelector("#copyUnusedCodes"),
  downloadUnusedCodes: document.querySelector("#downloadUnusedCodes"),
  pinForm: document.querySelector("#pinForm"),
  newPin: document.querySelector("#newPin"),
  adminMessage: document.querySelector("#adminMessage"),
  printCardButton: document.querySelector("#printCardButton"),
  cardInitials: document.querySelector("#cardInitials"),
  cardPhoto: document.querySelector("#cardPhoto"),
  cardQr: document.querySelector("#cardQr"),
  cardScoutId: document.querySelector("#cardScoutId"),
  cardFirstName: document.querySelector("#cardFirstName"),
  cardFatherName: document.querySelector("#cardFatherName"),
  cardLastName: document.querySelector("#cardLastName"),
  cardDateOfBirth: document.querySelector("#cardDateOfBirth"),
  cardBloodType: document.querySelector("#cardBloodType"),
  profileName: document.querySelector("#profileName"),
  profileScoutId: document.querySelector("#profileScoutId"),
  profileDateOfBirth: document.querySelector("#profileDateOfBirth"),
  profileAge: document.querySelector("#profileAge"),
  profileBloodType: document.querySelector("#profileBloodType"),
  photoForm: document.querySelector("#photoForm"),
  profilePhotoUpdate: document.querySelector("#profilePhotoUpdate"),
  profileMessage: document.querySelector("#profileMessage"),
};

async function api(path, method = 'GET', body) {
  let response;
  try {
    response = await fetch(`/api${path}`, {
      method, credentials: 'same-origin', cache: 'no-store',
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch { throw new Error('Cannot reach the server. Check your connection and try again.'); }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'The request could not be completed.');
  return data;
}

async function refresh() {
  const data = await api('/state');
  state.members = data.members;
  state.codes = data.codes;
  state.counts = data.counts;
  session = data.session;
  render();
}

function handle(form, message, action) {
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    showMessage(message, '');
    try { await action(); }
    catch (error) { showMessage(message, error.message || 'Could not process this request.', true); }
    finally { button.disabled = false; }
  });
}

elements.authTabs.forEach((tab) => tab.addEventListener('click', () => showAuthPanel(tab.dataset.authPanel)));
handle(elements.memberSignInPanel, elements.signInMessage, async () => {
  const username = elements.signInScoutId.value.trim();
  await api('/login', 'POST', { type: username.toLowerCase() === 'admin' ? 'admin' : 'member', scoutId: username, password: elements.signInPassword.value });
  elements.memberSignInPanel.reset();
  await refresh();
});
handle(elements.memberSignUpPanel, elements.registerMessage, async () => {
  const form = new FormData(elements.memberSignUpPanel);
  const body = Object.fromEntries(form);
  await api('/register', 'POST', body);
  elements.memberSignUpPanel.reset();
  await refresh();
});
elements.signOutButton.addEventListener('click', async () => {
  elements.signOutButton.disabled = true;
  try {
    await api('/logout', 'POST', {});
    state.members = []; state.codes = [];
    session = { type: null, memberId: null };
    elements.cardPhoto.removeAttribute('src');
    elements.cardQr.removeAttribute('src');
    document.querySelectorAll('#memberView strong, #memberView dd, #profileName, #cardInitials').forEach(node => { node.textContent = ''; });
    render();
    await refresh();
  } catch (error) { window.alert(error.message); }
  finally { elements.signOutButton.disabled = false; }
});
for (const [selector, values, selected] of [
  ['#codeGroup', cardCatalog.groups, ''], ['#codeRegion', cardCatalog.regions, '00'], ['#codeRole', cardCatalog.roles, '2'],
]) {
  const select = document.querySelector(selector);
  for (const [value, label] of values) select.add(new Option(`${value} — ${label}`, value, false, value === selected));
}
handle(elements.codeForm, elements.adminMessage, async () => {
  const quantity = Number(elements.codeQuantity.value);
  const groupCode = document.querySelector('#codeGroup').value;
  const regionCode = document.querySelector('#codeRegion').value;
  const roleCode = document.querySelector('#codeRole').value;
  await api('/codes', 'POST', { quantity, groupCode, regionCode, roleCode });
  await refresh();
  showMessage(elements.adminMessage, `${quantity} access codes generated for group ${groupCode}, region ${regionCode}, role ${roleCode}.`);
});
handle(elements.pinForm, elements.adminMessage, async () => {
  await api('/admin/password', 'PUT', { password: elements.newPin.value, currentPassword: document.querySelector('#currentAdminPassword').value });
  elements.pinForm.reset();
  showMessage(elements.adminMessage, 'Admin password changed. Other admin sessions have been signed out.');
});
handle(elements.photoForm, elements.profileMessage, async () => {
  const [file] = elements.profilePhotoUpdate.files;
  if (!file) throw new Error('Choose an image first.');
  await api('/photo', 'PUT', { photoDataUrl: await fileToDataUrl(file) });
  elements.photoForm.reset();
  await refresh();
  showMessage(elements.profileMessage, 'Profile photo updated.');
});
elements.memberSearch.addEventListener('input', renderMembers);
handle(document.querySelector('#activationForm'), document.querySelector('#activationMessage'), async () => {
  await api('/activate', 'POST', Object.fromEntries(new FormData(document.querySelector('#activationForm'))));
  document.querySelector('#activationForm').reset();
  await refresh();
});

const memberEditor = document.querySelector('#memberEditor');
const manageMessage = document.querySelector('#memberManageMessage');
let editingMemberId = null;
function numberingFields(member = null) {
  const mode = member?.cardIdMode || 'structured';
  const options = (values, selected) => values.map(([value, label]) => `<option value="${value}" ${value === selected ? 'selected' : ''}>${value} — ${escapeHtml(label)}</option>`).join('');
  return `<label><span>Card ID mode</span><select name="cardIdMode"><option value="structured" ${mode === 'structured' ? 'selected' : ''}>Generate from region / group / role / serial</option><option value="manual" ${mode === 'manual' ? 'selected' : ''}>Keep a manual Card ID</option></select></label>
    <label data-card-part><span>Region</span><select name="regionCode">${options(cardCatalog.regions, member?.regionCode || '00')}</select></label>
    <label data-card-part><span>Group</span><select name="groupCode">${options(cardCatalog.groups, member?.groupCode || '00')}</select></label>
    <label data-card-part><span>Role</span><select name="roleCode">${options(cardCatalog.roles, member?.roleCode || '2')}</select></label>
    <label data-card-part><span>Serial (blank = automatic)</span><input name="cardSerial" inputmode="numeric" pattern="[0-9]{1,4}" maxlength="4" value="${escapeHtml(member?.cardSerial || '')}"></label>
    <label><span>Card ID (printed on card)</span><input name="cardId" maxlength="60" value="${escapeHtml(member?.cardId || '')}"></label>`;
}
function setupNumberingEditor(root) {
  function update() {
    const manual = root.querySelector('[name="cardIdMode"]').value === 'manual';
    const card = root.querySelector('[name="cardId"]');
    for (const label of root.querySelectorAll('[data-card-part]')) {
      label.classList.toggle('hidden', manual);
      label.querySelector('input,select').disabled = manual;
    }
    card.readOnly = !manual;
    card.required = manual;
    card.placeholder = manual ? 'Enter Card ID' : 'Automatically assigned on save';
    if (!manual) {
      const values = Object.fromEntries([...root.querySelectorAll('[name]')].map(input => [input.name, input.value]));
      card.value = values.cardSerial ? formatCardParts(values) : '';
    }
  }
  root.querySelector('[name="cardIdMode"]').addEventListener('change', update);
  for (const input of root.querySelectorAll('[data-card-part] input,[data-card-part] select')) input.addEventListener('input', update);
  update();
}
function openMemberEditor(member = null) {
  editingMemberId = member?.id || null;
  document.querySelector('#memberEditorTitle').textContent = member ? 'Edit member' : 'Add member';
  document.querySelector('#memberEditorLoginId').textContent = member ? `Login ID: ${member.scoutId} (read-only)` : 'A login ID is generated automatically.';
  const fields = [
    ['firstName', 'First name', 'text'],
    ['lastName', 'Last name', 'text'], ['fatherName', "Father’s name", 'text'],
    ['dateOfBirth', 'Date of birth', 'date'], ['password', member ? 'New password (optional)' : 'Password', 'password'],
  ];
  document.querySelector('#memberEditorFields').innerHTML = fields.map(([name, label, type]) =>
    `<label><span>${label}</span><input name="${name}" type="${type}" ${name === 'password' ? `minlength="12" maxlength="128" autocomplete="new-password" ${member ? '' : 'required'}` : name === 'cardId' ? `maxlength="60" ${member ? 'required' : ''}` : name === 'username' ? 'maxlength="30" autocapitalize="none"' : 'required maxlength="60"'} value="${name === 'password' ? '' : escapeHtml(member?.[name] || '')}"></label>`
  ).join('') + `<label><span>Blood type</span><select name="bloodType" required>${['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-', 'Unknown'].map(type => `<option ${member?.bloodType === type ? 'selected' : ''}>${type}</option>`).join('')}</select></label>` + numberingFields(member);
  memberEditor.classList.remove('hidden');
  setupNumberingEditor(memberEditor);
  memberEditor.querySelector('input').focus();
}
document.querySelector('#addMember').addEventListener('click', () => openMemberEditor());
document.querySelector('#cancelMemberEdit').addEventListener('click', () => { memberEditor.classList.add('hidden'); editingMemberId = null; memberEditor.reset(); });
handle(memberEditor, manageMessage, async () => {
  await api(editingMemberId ? `/admin/members/${editingMemberId}` : '/admin/members', editingMemberId ? 'PUT' : 'POST', Object.fromEntries(new FormData(memberEditor)));
  memberEditor.reset();
  memberEditor.classList.add('hidden');
  editingMemberId = null;
  await refresh();
  showMessage(manageMessage, 'Member saved.');
});
elements.membersTable.addEventListener('click', async event => {
  const button = event.target.closest('button[data-member-id]');
  if (!button) return;
  const member = state.members.find(item => item.id === button.dataset.memberId);
  if (!member) return;
  if (button.dataset.action === 'edit') return openMemberEditor(member);
  if (!window.confirm(`Remove ${member.firstName} ${member.lastName} (${member.scoutId})? This permanently deletes their account and signs them out.`)) return;
  button.disabled = true;
  try {
    await api(`/admin/members/${member.id}`, 'DELETE', {});
    await refresh();
    showMessage(manageMessage, 'Member removed.');
  } catch (error) { showMessage(manageMessage, error.message, true); }
  finally { button.disabled = false; }
});
elements.printCardButton.addEventListener('click', () => window.print());
elements.exportCsv.addEventListener('click', async () => {
  try {
    await refresh();
    if (session.type !== 'admin') throw new Error('Please sign in as admin.');
    const rows = [
      ['Card ID', 'Login ID', 'Username', 'First name', 'Last name', "Father's name", 'Date of birth' , 'Age', 'Blood type', 'Access code', 'Registered at'],
      ...state.members.map(m => [m.cardId, m.scoutId, m.username, m.firstName, m.lastName, m.fatherName || "", m.dateOfBirth, calculateAge(m.dateOfBirth), m.bloodType, m.accessCode, formatDateTime(m.registeredAt)]),
    ];
    downloadFile(`members-${todayStamp()}.csv`, toCsv(rows), 'text/csv;charset=utf-8');
  } catch (error) { showMessage(elements.adminMessage, error.message, true); }
});
elements.exportJson.addEventListener('click', async () => {
  try {
    await refresh();
    if (session.type !== 'admin') throw new Error('Please sign in as admin.');
    downloadFile(`registry-export-${todayStamp()}.json`, JSON.stringify({ members: state.members, codes: state.codes }, null, 2), 'application/json');
  } catch (error) { showMessage(elements.adminMessage, error.message, true); }
});
elements.copyUnusedCodes.addEventListener('click', async () => {
  try {
    await refresh();
    const codes = getUnusedCodes().map(item => item.code).join('\n');
    if (!codes) throw new Error('There are no unused codes to copy.');
    await navigator.clipboard.writeText(codes);
    showMessage(elements.adminMessage, 'Unused codes copied.');
  } catch (error) { showMessage(elements.adminMessage, error.message, true); }
});
elements.downloadUnusedCodes.addEventListener('click', async () => {
  try {
    await refresh();
    const codes = getUnusedCodes().map(item => item.code).join('\n');
    if (!codes) throw new Error('There are no unused codes to download.');
    downloadFile(`unused-access-codes-${todayStamp()}.txt`, codes, 'text/plain;charset=utf-8');
  } catch (error) { showMessage(elements.adminMessage, error.message, true); }
});

let importRows = null;
let importRequestId = null;
let importedCredentials = [];
let bulkIdMembers = [];
const importMessage = document.querySelector('#importMessage');
async function downloadWorkbook(path, filename, body) {
  const response = await fetch(`/api${path}`, {
    method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const mime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  if (!response.ok || !response.headers.get('content-type')?.includes(mime)) {
    const data = await response.json().catch(() => ({}));
    if (response.status === 404 && data.error === 'Unknown API endpoint.') {
      throw new Error(['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)
        ? 'The local server is running an older API. Stop it with Ctrl+C, run npm start again, then refresh this page.'
        : 'The deployed API does not include Excel exports yet. Deploy the current server functions and refresh this page.');
    }
    throw new Error(data.error || 'Excel download is unavailable. Refresh the page and sign in again.');
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes[0] !== 80 || bytes[1] !== 75 || bytes[2] !== 3 || bytes[3] !== 4) throw new Error('The server returned an invalid Excel file. Please try again.');
  downloadFile(filename, bytes, mime);
}
for (const [id, path, filename] of [
  ['downloadExcelTemplate', '/admin/members-workbook?template=1', 'member-template.xlsx'],
  ['exportMembersWorkbook', '/admin/members-workbook', 'members-bulk-edit.xlsx'],
]) document.querySelector(`#${id}`).addEventListener('click', async event => {
  event.currentTarget.disabled = true;
  try { await downloadWorkbook(path, filename); showMessage(importMessage, 'Excel download ready.'); }
  catch (error) { showMessage(importMessage, error.message, true); }
  finally { document.querySelector(`#${id}`).disabled = false; }
});
function clearPreview() {
  importRows = null;
  importRequestId = null;
  document.querySelector('#importPreview').classList.add('hidden');
  document.querySelector('#importPreviewRows').replaceChildren();
  document.querySelector('#importErrors').replaceChildren();
}
function clearImportData() {
  clearPreview();
  importedCredentials = [];
  bulkIdMembers = [];
  document.querySelector('#importForm').reset();
  document.querySelector('#bulkIdForm').classList.add('hidden');
  document.querySelector('#bulkIdRows').replaceChildren();
  document.querySelector('#downloadImportCredentials').classList.add('hidden');
  document.querySelector('#credentialsNotice').classList.add('hidden');
}
function renderImportPreview(preview) {
  importRows = preview.errors.length ? null : preview.rows;
  importRequestId = preview.requestId;
  document.querySelector('#importSummary').textContent = `${preview.summary.added} new records, ${preview.summary.updated} records to update. ${preview.errors.length ? 'Fix the errors and preview again.' : 'Review the rows, then confirm to save all changes.'}`;
  document.querySelector('#importErrors').innerHTML = preview.errors.map(error => `<li>Row ${error.row}: ${escapeHtml(error.message)}</li>`).join('');
  document.querySelector('#importPreviewRows').innerHTML = preview.rows.map(row => `<tr><td>${row.sourceRow}</td><td>${row.id ? 'Update' : 'Add'}</td><td>${escapeHtml(row.cardId || 'Automatic')}</td><td>${escapeHtml(row.username || '-')}</td><td>${escapeHtml(`${row.firstName} ${row.lastName}`)}</td><td>${escapeHtml(row.fatherName || '-')}</td><td>${escapeHtml(row.dateOfBirth)}</td><td>${escapeHtml(row.bloodType)}</td></tr>`).join('');
  document.querySelector('#confirmImport').disabled = !importRows;
  document.querySelector('#importPreview').classList.remove('hidden');
}
document.querySelector('#importFile').addEventListener('change', clearPreview);
document.querySelector('#cancelImport').addEventListener('click', clearPreview);
handle(document.querySelector('#importForm'), importMessage, async () => {
  clearPreview();
  const file = document.querySelector('#importFile').files[0];
  if (!file || !/\.xlsx$/i.test(file.name) || file.size > 500000) throw new Error('Choose an .xlsx file smaller than 500 KB.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  renderImportPreview(await api('/admin/import/preview', 'POST', { fileData: btoa(binary) }));
});
document.querySelector('#confirmImport').addEventListener('click', async () => {
  if (!importRows) return;
  const button = document.querySelector('#confirmImport');
  button.disabled = true;
  try {
    const result = await api('/admin/import', 'POST', { rows: importRows, requestId: importRequestId });
    importedCredentials.push(...result.credentials);
    clearPreview();
    document.querySelector('#bulkIdForm').classList.add('hidden');
    document.querySelector('#bulkIdRows').replaceChildren();
    document.querySelector('#importForm').reset();
    document.querySelector('#downloadImportCredentials').classList.toggle('hidden', !importedCredentials.length);
    document.querySelector('#credentialsNotice').classList.toggle('hidden', !importedCredentials.length);
    showMessage(importMessage, result.alreadyApplied ? 'This import was already saved. If you missed the credentials download, reset the new members’ passwords using Edit member.' : `Saved ${result.added} new records and updated ${result.updated} records.`);
    await refresh().catch(() => showMessage(importMessage, 'Changes were saved. Refresh the page to see the latest records.'));
  } catch (error) { showMessage(importMessage, error.message, true); }
  finally { button.disabled = !importRows; }
});
document.querySelector('#downloadImportCredentials').addEventListener('click', async () => {
  const button = document.querySelector('#downloadImportCredentials');
  button.disabled = true;
  try { await downloadWorkbook('/admin/credentials-workbook', `member-credentials-${todayStamp()}.xlsx`, { credentials: importedCredentials }); }
  catch (error) { showMessage(importMessage, error.message, true); }
  finally { button.disabled = false; }
});
document.querySelector('#bulkEditIds').addEventListener('click', () => {
  clearPreview();
  const query = elements.memberSearch.value.trim().toLowerCase();
  bulkIdMembers = state.members.filter(member => Object.values(member).join(' ').toLowerCase().includes(query));
  if (!bulkIdMembers.length || bulkIdMembers.length > 200) return showMessage(importMessage, 'Use member search to choose between 1 and 200 records.', true);
  document.querySelector('#bulkIdRows').innerHTML = bulkIdMembers.map(member => `<tr data-record-id="${escapeHtml(member.id)}"><td>${escapeHtml(`${member.firstName} ${member.lastName}`)}</td><td>${escapeHtml(member.cardId)}</td><td><div class="profile-grid">${numberingFields(member)}</div></td></tr>`).join('');
  for (const row of document.querySelectorAll('#bulkIdRows tr')) setupNumberingEditor(row);
  document.querySelector('#bulkIdForm').classList.remove('hidden');
  document.querySelector('#bulkIdForm').scrollIntoView({ block: 'start', behavior: 'smooth' });
});
document.querySelector('#cancelBulkIds').addEventListener('click', () => { document.querySelector('#bulkIdForm').classList.add('hidden'); clearPreview(); });
handle(document.querySelector('#bulkIdForm'), importMessage, async () => {
  const rows = [...document.querySelectorAll('#bulkIdRows tr')].map(row => {
    const member = bulkIdMembers.find(member => member.id === row.dataset.recordId);
    return { id: member.id, revision: member.revision, ...Object.fromEntries([...row.querySelectorAll('[name]')].filter(input => !input.disabled).map(input => [input.name, input.value.trim()])) };
  }).filter(row => {
    const member = bulkIdMembers.find(member => member.id === row.id);
    return ['cardIdMode','cardId','regionCode','groupCode','roleCode','cardSerial'].some(key => row[key] !== undefined && row[key] !== (member[key] || ''));
  });
  clearPreview();
  if (!rows.length) throw new Error('Change at least one Card ID to preview.');
  renderImportPreview(await api('/admin/import/preview', 'POST', { rows }));
});

function showAuthPanel(panelId) {
  elements.authTabs.forEach((tab) => tab.classList.toggle("active", tab.dataset.authPanel === panelId));
  elements.authPanels.forEach((panel) => panel.classList.toggle("active", panel.id === panelId));
}

function render() {
  if (session.type !== 'admin') {
    memberEditor.reset();
    memberEditor.classList.add('hidden');
    editingMemberId = null;
    showMessage(manageMessage, '');
    clearImportData();
  }
  elements.authView.classList.toggle("hidden", Boolean(session.type));
  const pending = session.type === 'member' && session.needsAccessCode;
  document.querySelector('#activationView').classList.toggle('hidden', !pending);
  elements.memberView.classList.toggle("hidden", session.type !== "member" || pending);
  elements.adminView.classList.toggle("hidden", session.type !== "admin");
  elements.sessionActions.classList.toggle("hidden", !session.type);

  if (session.type === "member") {
    const member = state.members.find((item) => item.id === session.memberId);
    elements.sessionName.textContent = member ? `${member.firstName} ${member.lastName}` : 'Account activation';
    if (!pending) renderMemberProfile(member);
  } else if (session.type === "admin") {
    elements.sessionName.textContent = "Admin";
  } else {
    elements.sessionName.textContent = "";
  }

  renderCountsAndLists();
}

function renderCountsAndLists() {
  elements.memberCountPublic.textContent = state.counts.members;
  elements.memberCountAdmin.textContent = state.members.length;
  renderCodes();
  renderMembers();
}

function renderMemberProfile(member) {
  if (!member) return;
  const fullName = `${member.firstName} ${member.lastName}`;
  elements.profileName.textContent = fullName;
  elements.profileScoutId.textContent = member.cardId;
  document.querySelector('#profileLoginId').textContent = member.scoutId;
  document.querySelector('#profileUsername').textContent = member.username;
  elements.profileDateOfBirth.textContent = member.dateOfBirth;
  elements.profileAge.textContent = calculateAge(member.dateOfBirth);
  elements.profileBloodType.textContent = member.bloodType;
  elements.cardInitials.textContent = `${member.firstName[0] || ""}${member.lastName[0] || ""}`.toUpperCase();
  elements.cardPhoto.src = member.photoDataUrl || "";
  elements.cardPhoto.classList.toggle("visible", Boolean(member.photoDataUrl));
  elements.cardInitials.classList.toggle("hidden", Boolean(member.photoDataUrl));
  elements.cardScoutId.textContent = member.cardId;
  elements.cardFirstName.textContent = member.firstName;
  elements.cardLastName.textContent = member.lastName;
  elements.cardFatherName.textContent = member.fatherName || "-";
  elements.cardDateOfBirth.textContent = member.dateOfBirth;
  elements.cardBloodType.textContent = member.bloodType;
  elements.cardQr.src = createQrUrl(member);
}

function createQrUrl() { return "/api/card/qr"; }

function renderCodes() {
  if (!state.codes.length) {
    elements.codeList.innerHTML = '<p class="muted">No access codes generated yet.</p>';
    return;
  }

  elements.codeList.innerHTML = state.codes
    .slice(0, 300)
    .map((code) => `<div class="code-item"><div class="code-chip ${code.usedBy ? "used" : ""}">${escapeHtml(code.code)}</div><small>${code.groupCode ? `${escapeHtml(cardCatalog.groups.find(([value]) => value === code.groupCode)?.[1] || code.groupCode)} · Region ${escapeHtml(code.regionCode)} · Role ${escapeHtml(code.roleCode)}` : 'Legacy code'}</small></div>`)
    .join("");
}

function renderMembers() {
  const query = elements.memberSearch.value.trim().toLowerCase();
  const members = state.members
    .filter((member) => {
      const haystack = Object.values(member).join(" ").toLowerCase();
      return haystack.includes(query);
    })
    .sort((a, b) => a.scoutId.localeCompare(b.scoutId));

  if (!members.length) {
    elements.membersTable.innerHTML = '<tr><td colspan="12">No members found.</td></tr>';
    return;
  }

  elements.membersTable.innerHTML = members
    .map(
      (member) => `
        <tr>
          <td>${escapeHtml(member.cardId)}</td>
          <td>${escapeHtml(member.scoutId)}</td>
          <td>${escapeHtml(member.username || '-')}</td>
          <td>${escapeHtml(member.firstName)}</td>
          <td>${escapeHtml(member.lastName)}</td>
          <td>${escapeHtml(member.fatherName || "-")}</td>
          <td>${escapeHtml(member.dateOfBirth)}</td>
          <td>${calculateAge(member.dateOfBirth)}</td>
          <td>${escapeHtml(member.bloodType)}</td>
          <td>${member.accessCode ? escapeHtml(member.accessCode) : 'Awaiting activation'}</td>
          <td>${formatDateTime(member.registeredAt)}</td>
          <td><button type="button" class="secondary" data-action="edit" data-member-id="${escapeHtml(member.id)}">Edit</button> <button type="button" class="secondary" data-action="remove" data-member-id="${escapeHtml(member.id)}">Remove</button></td>
        </tr>
      `
    )
    .join("");
}

function fileToDataUrl(file) {
  if (!file.type.startsWith("image/") || file.size > 10 * 1024 * 1024) return Promise.reject(new Error("Choose an image smaller than 10 MB."));
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      const image = new Image();
      image.addEventListener("load", () => {
        const canvas = document.createElement("canvas");
        const maxSize = 520;
        const scale = Math.min(maxSize / image.width, maxSize / image.height, 1);
        canvas.width = Math.round(image.width * scale);
        canvas.height = Math.round(image.height * scale);
        const context = canvas.getContext("2d");
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.82));
      });
      image.addEventListener("error", reject);
      image.src = reader.result;
    });
    reader.addEventListener("error", reject);
    reader.readAsDataURL(file);
  });
}

function getUnusedCodes() {
  return state.codes.filter((code) => !code.usedBy);
}

function showMessage(element, text, isError = false) {
  element.textContent = text;
  element.classList.toggle("error", isError);
}

function calculateAge(dateString) {
  const birth = new Date(dateString);
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const monthDiff = today.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
    age -= 1;
  }
  return Number.isFinite(age) ? age : "";
}

function formatDateTime(value) {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function todayStamp() {
  return new Date().toISOString().slice(0, 10);
}

function toCsv(rows) {
  return rows
    .map((row) =>
      row
        .map((cell) => `"${String(cell ?? "").replace(/^[=+@\-\t\r]/, "' $&").replace(/"/g, '""')}"`)
        .join(",")
    )
    .join("\n");
}

function downloadFile(filename, content, type) {
  const blob = new Blob([content], { type });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => {
    const replacements = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    };
    return replacements[character];
  });
}

if (location.hash === "#register") showAuthPanel("memberSignUpPanel");
render();
refresh().catch((error) => showMessage(elements.signInMessage, error.message, true));
