const STORAGE_KEY = "snl-member-registry-v2";
const LEGACY_STORAGE_KEY = "snl-member-registry-v1";
const DEFAULT_PIN = "1234";
const SCOUT_ID_START = 31000;

const state = loadState();
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
  adminSignInPanel: document.querySelector("#adminSignInPanel"),
  adminPin: document.querySelector("#adminPin"),
  adminLoginMessage: document.querySelector("#adminLoginMessage"),
  memberCountPublic: document.querySelector("#memberCountPublic"),
  unusedCodeCountPublic: document.querySelector("#unusedCodeCountPublic"),
  codeForm: document.querySelector("#codeForm"),
  codeQuantity: document.querySelector("#codeQuantity"),
  codeList: document.querySelector("#codeList"),
  memberCountAdmin: document.querySelector("#memberCountAdmin"),
  unusedCodeCount: document.querySelector("#unusedCodeCount"),
  usedCodeCount: document.querySelector("#usedCodeCount"),
  membersTable: document.querySelector("#membersTable"),
  memberSearch: document.querySelector("#memberSearch"),
  exportCsv: document.querySelector("#exportCsv"),
  exportJson: document.querySelector("#exportJson"),
  importJson: document.querySelector("#importJson"),
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

elements.authTabs.forEach((tab) => {
  tab.addEventListener("click", () => showAuthPanel(tab.dataset.authPanel));
});

elements.memberSignInPanel.addEventListener("submit", (event) => {
  event.preventDefault();
  const scoutId = normalizeScoutId(elements.signInScoutId.value);
  const member = state.members.find((item) => item.scoutId === scoutId);

  if (!member || member.password !== elements.signInPassword.value) {
    showMessage(elements.signInMessage, "Scout ID or password is incorrect.", true);
    return;
  }

  session = { type: "member", memberId: member.id };
  elements.memberSignInPanel.reset();
  showMessage(elements.signInMessage, "");
  render();
});

elements.memberSignUpPanel.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(elements.memberSignUpPanel);
  const accessCode = normalizeCode(form.get("accessCode"));
  const code = state.codes.find((item) => item.code === accessCode);

  if (!code) {
    showMessage(elements.registerMessage, "This access code does not exist.", true);
    return;
  }

  if (code.usedBy) {
    showMessage(elements.registerMessage, "This access code has already been used.", true);
    return;
  }

  const firstName = cleanName(form.get("firstName"));
  const lastName = cleanName(form.get("lastName"));
  const dateOfBirth = form.get("dateOfBirth");
  const bloodType = form.get("bloodType");
  const password = String(form.get("password") || "");
  const [photoFile] = document.querySelector("#profilePhoto").files;

  if (!firstName || !lastName || !dateOfBirth || !bloodType || password.length < 4) {
    showMessage(elements.registerMessage, "Please complete every field. Password must be at least 4 characters.", true);
    return;
  }

  if (new Date(dateOfBirth) > new Date()) {
    showMessage(elements.registerMessage, "Date of birth cannot be in the future.", true);
    return;
  }

  const member = {
    id: crypto.randomUUID(),
    scoutId: createScoutId(),
    firstName,
    lastName,
    dateOfBirth,
    bloodType,
    password,
    photoDataUrl: photoFile ? await fileToDataUrl(photoFile) : "",
    accessCode,
    registeredAt: new Date().toISOString(),
  };

  state.members.push(member);
  code.usedBy = member.id;
  code.usedAt = member.registeredAt;
  saveState();
  session = { type: "member", memberId: member.id };
  elements.memberSignUpPanel.reset();
  render();
});

elements.adminSignInPanel.addEventListener("submit", (event) => {
  event.preventDefault();
  if (elements.adminPin.value === state.adminPin) {
    session = { type: "admin", memberId: null };
    elements.adminSignInPanel.reset();
    showMessage(elements.adminLoginMessage, "");
    render();
    return;
  }

  showMessage(elements.adminLoginMessage, "Incorrect admin PIN.", true);
});

elements.signOutButton.addEventListener("click", () => {
  session = { type: null, memberId: null };
  render();
});

elements.codeForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const quantity = Math.min(Math.max(Number(elements.codeQuantity.value) || 1, 1), 1000);
  for (let index = 0; index < quantity; index += 1) {
    state.codes.unshift({
      code: createAccessCode(),
      createdAt: new Date().toISOString(),
      usedBy: null,
      usedAt: null,
    });
  }
  saveState();
  showMessage(elements.adminMessage, `${quantity} access code${quantity === 1 ? "" : "s"} generated.`);
  renderCountsAndLists();
});

elements.memberSearch.addEventListener("input", renderMembers);

elements.exportCsv.addEventListener("click", () => {
  const rows = [
    ["Scout ID", "First name", "Last name", "Date of birth", "Age", "Blood type", "Access code", "Registered at"],
    ...state.members.map((member) => [
      member.scoutId,
      member.firstName,
      member.lastName,
      member.dateOfBirth,
      calculateAge(member.dateOfBirth),
      member.bloodType,
      member.accessCode,
      formatDateTime(member.registeredAt),
    ]),
  ];
  downloadFile(`members-${todayStamp()}.csv`, toCsv(rows), "text/csv;charset=utf-8");
});

elements.exportJson.addEventListener("click", () => {
  downloadFile(`registry-backup-${todayStamp()}.json`, JSON.stringify(state, null, 2), "application/json");
});

elements.importJson.addEventListener("change", async (event) => {
  const [file] = event.target.files;
  if (!file) return;

  try {
    const imported = JSON.parse(await file.text());
    if (!Array.isArray(imported.members) || !Array.isArray(imported.codes)) {
      throw new Error("Invalid backup");
    }

    state.members = imported.members.map(normalizeMember);
    state.codes = imported.codes;
    state.adminPin = String(imported.adminPin || state.adminPin || DEFAULT_PIN);
    saveState();
    showMessage(elements.adminMessage, "Backup imported.");
    render();
  } catch (error) {
    showMessage(elements.adminMessage, "Could not import that JSON backup.", true);
  } finally {
    elements.importJson.value = "";
  }
});

elements.copyUnusedCodes.addEventListener("click", async () => {
  const codes = getUnusedCodes().map((item) => item.code).join("\n");
  if (!codes) {
    showMessage(elements.adminMessage, "There are no unused codes to copy.", true);
    return;
  }

  await navigator.clipboard.writeText(codes);
  showMessage(elements.adminMessage, "Unused codes copied.");
});

elements.downloadUnusedCodes.addEventListener("click", () => {
  const codes = getUnusedCodes().map((item) => item.code).join("\n");
  if (!codes) {
    showMessage(elements.adminMessage, "There are no unused codes to download.", true);
    return;
  }

  downloadFile(`unused-access-codes-${todayStamp()}.txt`, codes, "text/plain;charset=utf-8");
});

elements.pinForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const nextPin = elements.newPin.value.trim();
  if (nextPin.length < 4) {
    showMessage(elements.adminMessage, "Use at least 4 characters for the PIN.", true);
    return;
  }

  state.adminPin = nextPin;
  elements.newPin.value = "";
  saveState();
  showMessage(elements.adminMessage, "Admin PIN changed.");
});

elements.printCardButton.addEventListener("click", () => window.print());

elements.photoForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const member = state.members.find((item) => item.id === session.memberId);
  const [photoFile] = elements.profilePhotoUpdate.files;

  if (!member || !photoFile) {
    showMessage(elements.profileMessage, "Choose an image first.", true);
    return;
  }

  member.photoDataUrl = await fileToDataUrl(photoFile);
  elements.profilePhotoUpdate.value = "";
  saveState();
  renderMemberProfile(member);
  showMessage(elements.profileMessage, "Profile photo updated.");
});

function loadState() {
  const fallback = { members: [], codes: [], adminPin: DEFAULT_PIN };
  const saved = readStoredState(STORAGE_KEY) || readStoredState(LEGACY_STORAGE_KEY) || fallback;
  const migrated = {
    ...fallback,
    ...saved,
    members: Array.isArray(saved.members) ? saved.members.map(normalizeMember) : [],
    codes: Array.isArray(saved.codes) ? saved.codes : [],
    adminPin: String(saved.adminPin || DEFAULT_PIN),
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
  return migrated;
}

function readStoredState(key) {
  try {
    return JSON.parse(localStorage.getItem(key));
  } catch (error) {
    return null;
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function showAuthPanel(panelId) {
  elements.authTabs.forEach((tab) => tab.classList.toggle("active", tab.dataset.authPanel === panelId));
  elements.authPanels.forEach((panel) => panel.classList.toggle("active", panel.id === panelId));
}

function render() {
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
  elements.memberCountPublic.textContent = state.members.length;
  elements.unusedCodeCountPublic.textContent = getUnusedCodes().length;
  elements.memberCountAdmin.textContent = state.members.length;
  elements.unusedCodeCount.textContent = getUnusedCodes().length;
  elements.usedCodeCount.textContent = state.codes.filter((code) => code.usedBy).length;
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
  elements.cardDateOfBirth.textContent = member.dateOfBirth;
  elements.cardBloodType.textContent = member.bloodType;
  elements.cardQr.src = createQrUrl(member);
}

function createQrUrl(member) {
  const payload = [
    `Scout ID: ${member.scoutId}`,
    `Name: ${member.firstName} ${member.lastName}`,
    `Date of birth: ${member.dateOfBirth}`,
    `Blood type: ${member.bloodType}`,
  ].join("\n");
  return `https://api.qrserver.com/v1/create-qr-code/?size=110x110&margin=8&data=${encodeURIComponent(payload)}`;
}

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
    elements.membersTable.innerHTML = '<tr><td colspan="8">No members found.</td></tr>';
    return;
  }

  elements.membersTable.innerHTML = members
    .map(
      (member) => `
        <tr>
          <td>${escapeHtml(member.scoutId)}</td>
          <td>${escapeHtml(member.firstName)}</td>
          <td>${escapeHtml(member.lastName)}</td>
          <td>${escapeHtml(member.dateOfBirth)}</td>
          <td>${calculateAge(member.dateOfBirth)}</td>
          <td>${escapeHtml(member.bloodType)}</td>
          <td>${escapeHtml(member.accessCode)}</td>
          <td>${formatDateTime(member.registeredAt)}</td>
        </tr>
      `
    )
    .join("");
}

function normalizeMember(member, index) {
  return {
    ...member,
    id: member.id || crypto.randomUUID(),
    scoutId: member.scoutId || String(SCOUT_ID_START + index + 1).padStart(8, "0"),
    password: member.password || member.accessCode || "1234",
    photoDataUrl: member.photoDataUrl || "",
  };
}

function fileToDataUrl(file) {
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

function createScoutId(seed) {
  if (seed) {
    const existing = state?.members || [];
    const legacyIndex = existing.findIndex((member) => member.id === seed);
    const numeric = SCOUT_ID_START + Math.max(legacyIndex, 0) + 1;
    return String(numeric).padStart(8, "0");
  }

  let nextNumber = SCOUT_ID_START + state.members.length + 1;
  let scoutId = String(nextNumber).padStart(8, "0");
  while (state.members.some((member) => member.scoutId === scoutId)) {
    nextNumber += 1;
    scoutId = String(nextNumber).padStart(8, "0");
  }
  return scoutId;
}

function createAccessCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code;
  do {
    code = "SNL-";
    for (let index = 0; index < 6; index += 1) {
      code += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
  } while (state.codes.some((item) => item.code === code));
  return code;
}

function getUnusedCodes() {
  return state.codes.filter((code) => !code.usedBy);
}

function normalizeCode(value) {
  return String(value || "").trim().toUpperCase();
}

function normalizeScoutId(value) {
  return String(value || "").trim().replace(/\D/g, "").padStart(8, "0");
}

function cleanName(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
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
        .map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`)
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

render();
