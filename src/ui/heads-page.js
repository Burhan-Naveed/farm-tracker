// =========================================================
// HEADS page (Admin): add, rename, change type, activate /
// deactivate and delete account heads.
// =========================================================

import { headUsageCounts, sortedHeads, validateHead } from "../domain/heads.js";
import { escapeHtml, tableRowsHtml } from "../lib/html.js";
import {
  createHead, deleteHead, headHasEntries, logAudit, setHeadActive, updateHeadAndEntries
} from "../services/data.js";
import { currentActor, isAdmin, state } from "../state.js";
import { typeClass } from "./components.js";
import { $, readInputs, setHidden, showFormError } from "./dom.js";
import { onWriteError, reportError, showToast } from "./feedback.js";
import { registerPage } from "./navigation.js";

let editingHeadId = null;

/** Table columns of the Heads list. Rows are { head, used }. */
const COLUMNS = [
  { label: "Head", cell: ({ head }) => escapeHtml(head.name) },
  { label: "Type", className: ({ head }) => typeClass(head.type), cell: ({ head }) => escapeHtml(head.type) },
  { label: "Status", cell: ({ head }) => `<span class="badge ${head.active ? "" : "off"}">${head.active ? "Active" : "Inactive"}</span>` },
  { label: "Entries", className: "num", cell: ({ used }) => String(used) },
  {
    className: "actions",
    cell: ({ head, used }) => `
      <button type="button" class="btn btn-light btn-small" data-head-edit="${escapeHtml(head.id)}">Edit</button>
      <button type="button" class="btn btn-light btn-small" data-head-toggle="${escapeHtml(head.id)}">${head.active ? "Deactivate" : "Activate"}</button>
      ${used === 0 ? `<button type="button" class="btn btn-danger btn-small" data-head-delete="${escapeHtml(head.id)}">Delete</button>` : ""}`
  }
];

function renderHeads() {
  const counts = headUsageCounts(state.expenses);
  $("heads-body").innerHTML = tableRowsHtml(COLUMNS, sortedHeads(state.heads).map((head) => ({ head, used: counts[head.id] || 0 })));
}

/** Clears the Add/Edit Head form. */
function resetHeadForm() {
  $("head-form").reset();
  editingHeadId = null;
  $("head-form-title").textContent = "Add Head";
  $("head-save-btn").textContent = "Add Head";
  setHidden($("head-cancel-btn"), true);
  showFormError("head-error", "");
}

/** Saves a new head, or renames / changes the type of an existing one. */
async function handleSubmit(e) {
  e.preventDefault();
  if (!isAdmin()) return;
  const result = validateHead(readInputs({ name: "h-name", type: "h-type" }), { heads: state.heads, editingId: editingHeadId });
  if (!result.ok) { showFormError("head-error", result.error); return; }
  showFormError("head-error", "");
  const { name, type } = result.value;
  const actor = currentActor();

  if (!editingHeadId) {
    createHead({ name, type }, actor).catch(onWriteError("Adding head " + name));
    logAudit(actor, "head-add", `${name} (${type})`);
    showToast("Head added");
    resetHeadForm();
    return;
  }

  const id = editingHeadId;
  const old = state.headMap.get(id);
  if (!old) { showToast("This head was deleted on another device.", true); resetHeadForm(); return; }
  if (old.name === name && old.type === type) { resetHeadForm(); return; }

  // Editing: update the head, then copy the new name/type into all its entries
  $("head-save-btn").disabled = true;
  try {
    const { entryCount, done } = await updateHeadAndEntries(id, { name, type });
    done.catch(onWriteError("Updating head " + id));
    logAudit(actor, "head-edit", `${old.name} (${old.type}) -> ${name} (${type}), ${entryCount} entries updated`);
    showToast(`Head updated (${entryCount} entries updated)`);
    resetHeadForm();
  } catch (err) {
    reportError("Loading entries of head " + id, err, "Could not update the head. Please check your internet and try again.");
  } finally {
    $("head-save-btn").disabled = false;
  }
}

function startEditing(head) {
  editingHeadId = head.id;
  $("h-name").value = head.name;
  $("h-type").value = head.type;
  $("head-form-title").textContent = "Edit Head";
  $("head-save-btn").textContent = "Update Head";
  setHidden($("head-cancel-btn"), false);
  showFormError("head-error", "");
  window.scrollTo(0, 0);
  $("h-name").focus();
}

function toggleActive(head) {
  setHeadActive(head.id, !head.active).catch(onWriteError("Changing head status " + head.id));
  logAudit(currentActor(), head.active ? "head-deactivate" : "head-activate", head.name);
  showToast(head.active ? "Head deactivated" : "Head activated");
}

/** Deletes a head that has no entries (double-checked on the server). */
async function confirmDelete(head) {
  let used;
  try {
    used = await headHasEntries(head.id);
  } catch (err) {
    reportError("Checking entries of head " + head.id, err, "Could not check this head. Please check your internet and try again.");
    return;
  }
  if (used) { showToast("This head has entries. Deactivate it instead.", true); return; }
  if (!confirm(`Delete head "${head.name}"? This cannot be undone.`)) return;
  deleteHead(head.id).catch(onWriteError("Deleting head " + head.id));
  logAudit(currentActor(), "head-delete", head.name);
  if (editingHeadId === head.id) resetHeadForm();
  showToast("Head deleted");
}

export function initHeadsPage() {
  $("head-form").addEventListener("submit", handleSubmit);
  $("head-cancel-btn").addEventListener("click", resetHeadForm);
  $("heads-body").addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    const head = state.headMap.get(btn.dataset.headEdit || btn.dataset.headToggle || btn.dataset.headDelete);
    if (!head) return;
    if (btn.dataset.headEdit) startEditing(head);
    if (btn.dataset.headToggle) toggleActive(head);
    if (btn.dataset.headDelete) confirmDelete(head);
  });
  registerPage("heads", { render: renderHeads });
}
