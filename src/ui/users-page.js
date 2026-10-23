// =========================================================
// USERS page (Admin): add user records, change role, enable /
// disable. The Admin's own row cannot be demoted or disabled.
// =========================================================

import { sortedUsers, validateUser } from "../domain/users.js";
import { toDateString } from "../lib/format.js";
import { escapeHtml, tableRowsHtml } from "../lib/html.js";
import { createUser, logAudit, setUserRole, setUserStatus } from "../services/data.js";
import { currentActor, isAdmin, state } from "../state.js";
import { $, readInputs, showFormError } from "./dom.js";
import { onWriteError, showToast } from "./feedback.js";
import { registerPage } from "./navigation.js";

const isSelf = (u) => u.id === state.user.uid;
const createdText = (u) => (u.createdAt && u.createdAt.toDate ? toDateString(u.createdAt.toDate()) : "-");

const roleSelectHtml = (u) => `
  <select data-role-for="${escapeHtml(u.id)}" aria-label="Role" ${isSelf(u) ? "disabled title='You cannot change your own role'" : ""}>
    <option value="admin" ${u.role === "admin" ? "selected" : ""}>Admin</option>
    <option value="staff" ${u.role === "staff" ? "selected" : ""}>Staff</option>
  </select>`;

/** Table columns of the Users list. */
const COLUMNS = [
  { label: "Name", cell: (u) => escapeHtml(u.name) + (isSelf(u) ? " <span class='muted'>(you)</span>" : "") },
  { label: "Email", cell: (u) => escapeHtml(u.email) },
  { label: "Role", cell: roleSelectHtml },
  { label: "Status", cell: (u) => `<span class="badge ${u.status === "active" ? "" : "off"}">${u.status === "active" ? "Active" : "Disabled"}</span>` },
  { label: "Created", cell: (u) => escapeHtml(createdText(u)) },
  {
    className: "actions",
    cell: (u) => (isSelf(u) ? "" :
      `<button type="button" class="btn ${u.status === "active" ? "btn-danger" : "btn-light"} btn-small" data-status-for="${escapeHtml(u.id)}">${u.status === "active" ? "Disable" : "Enable"}</button>`)
  }
];

function renderUsers() {
  $("users-body").innerHTML = tableRowsHtml(COLUMNS, sortedUsers(state.users));
}

/** Adds a user record. The document ID must be the user's Auth UID. */
function handleSubmit(e) {
  e.preventDefault();
  if (!isAdmin()) return;
  const result = validateUser(readInputs({ name: "u-name", email: "u-email", uid: "u-uid", role: "u-role" }), { users: state.users });
  if (!result.ok) { showFormError("user-error", result.error); return; }
  showFormError("user-error", "");
  const user = result.value;
  createUser(user).catch(onWriteError("Adding user " + user.uid));
  logAudit(currentActor(), "user-add", `${user.name} <${user.email}> as ${user.role}`);
  showToast("User added");
  $("user-form").reset();
}

function changeRole(select) {
  const u = state.users.find((x) => x.id === select.dataset.roleFor);
  if (!u || isSelf(u)) return;
  setUserRole(u.id, select.value).catch(onWriteError("Changing role of " + u.id));
  logAudit(currentActor(), "user-role", `${u.email} -> ${select.value}`);
  showToast("Role updated");
}

function toggleStatus(uid) {
  const u = state.users.find((x) => x.id === uid);
  if (!u || isSelf(u)) return;
  const newStatus = u.status === "active" ? "disabled" : "active";
  if (newStatus === "disabled" && !confirm(`Disable ${u.name || u.email}? They will not be able to see any data.`)) return;
  setUserStatus(uid, newStatus).catch(onWriteError("Changing status of " + uid));
  logAudit(currentActor(), "user-status", `${u.email} -> ${newStatus}`);
  showToast(newStatus === "active" ? "User enabled" : "User disabled");
}

export function initUsersPage() {
  $("user-form").addEventListener("submit", handleSubmit);
  $("users-body").addEventListener("change", (e) => { if (e.target.dataset.roleFor) changeRole(e.target); });
  $("users-body").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-status-for]");
    if (btn) toggleStatus(btn.dataset.statusFor);
  });
  registerPage("users", { render: renderUsers });
}
