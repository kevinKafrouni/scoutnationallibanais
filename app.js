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
handle(elements.codeForm, elements.adminMessage, async () => {
  const quantity = Number(elements.codeQuantity.value);
  await api('/codes', 'POST', { quantity });
  await refresh();
  showMessage(elements.adminMessage, `${quantity} access codes generated.`);
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

const memberEditor = document.querySelector('#memberEditor');
const manageMessage = document.querySelector('#memberManageMessage');
let editingMemberId = null;
function openMemberEditor(member = null) {
  editingMemberId = member?.id || null;
  document.querySelector('#memberEditorTitle').textContent = member ? 'Edit member' : 'Add member';
  const fields = [
    ['username', 'Username', 'text'], ['firstName', 'First name', 'text'],
    ['lastName', 'Last name', 'text'], ['fatherName', "Father’s name", 'text'],
    ['dateOfBirth', 'Date of birth', 'date'], ['password', member ? 'New password (optional)' : 'Password', 'password'],
  ];
  document.querySelector('#memberEditorFields').innerHTML = fields.map(([name, label, type]) =>
    `<label><span>${label}</span><input name="${name}" type="${type}" ${name === 'password' ? `minlength="12" maxlength="128" autocomplete="new-password" ${member ? '' : 'required'}` : name === 'username' ? 'maxlength="30" autocapitalize="none"' : 'required maxlength="60"'} value="${name === 'password' ? '' : escapeHtml(member?.[name] || '')}"></label>`
  ).join('') + `<label><span>Blood type</span><select name="bloodType" required>${['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-', 'Unknown'].map(type => `<option ${member?.bloodType === type ? 'selected' : ''}>${type}</option>`).join('')}</select></label>`;
  memberEditor.classList.remove('hidden');
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
      ['Scout ID', 'First name', 'Last name', "Father's name", 'Date of birth' , 'Age', 'Blood type', 'Access code', 'Registered at'],
      ...state.members.map(m => [m.scoutId, m.firstName, m.lastName, m.fatherName || "", m.dateOfBirth, calculateAge(m.dateOfBirth), m.bloodType, m.accessCode, formatDateTime(m.registeredAt)]),
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
  }
  elements.authView.classList.toggle("hidden", Boolean(session.type));
  elements.memberView.classList.toggle("hidden", session.type !== "member");
  elements.adminView.classList.toggle("hidden", session.type !== "admin");
  elements.sessionActions.classList.toggle("hidden", !session.type);

  if (session.type === "member") {
    const member = state.members.find((item) => item.id === session.memberId);
    elements.sessionName.textContent = member ? `${member.firstName} ${member.lastName}` : "";
    renderMemberProfile(member);
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
  elements.profileScoutId.textContent = member.scoutId;
  elements.profileDateOfBirth.textContent = member.dateOfBirth;
  elements.profileAge.textContent = calculateAge(member.dateOfBirth);
  elements.profileBloodType.textContent = member.bloodType;
  elements.cardInitials.textContent = `${member.firstName[0] || ""}${member.lastName[0] || ""}`.toUpperCase();
  elements.cardPhoto.src = member.photoDataUrl || "";
  elements.cardPhoto.classList.toggle("visible", Boolean(member.photoDataUrl));
  elements.cardInitials.classList.toggle("hidden", Boolean(member.photoDataUrl));
  elements.cardScoutId.textContent = member.scoutId;
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
    .map((code) => `<div class="code-chip ${code.usedBy ? "used" : ""}">${escapeHtml(code.code)}</div>`)
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
    elements.membersTable.innerHTML = '<tr><td colspan="11">No members found.</td></tr>';
    return;
  }

  elements.membersTable.innerHTML = members
    .map(
      (member) => `
        <tr>
          <td>${escapeHtml(member.scoutId)}</td>
          <td>${escapeHtml(member.username || '-')}</td>
          <td>${escapeHtml(member.firstName)}</td>
          <td>${escapeHtml(member.lastName)}</td>
          <td>${escapeHtml(member.fatherName || "-")}</td>
          <td>${escapeHtml(member.dateOfBirth)}</td>
          <td>${calculateAge(member.dateOfBirth)}</td>
          <td>${escapeHtml(member.bloodType)}</td>
          <td>${escapeHtml(member.accessCode)}</td>
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
