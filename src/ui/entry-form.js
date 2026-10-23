// =========================================================
// ADD / EDIT ENTRY page, including the optional attachment
// (payment slip / online receipt / bill).
// =========================================================

import { CONFIG } from "../config.js";
import { attachmentError, dataUrlBytes, fileKind, storedFileName } from "../domain/attachments.js";
import { validateEntry } from "../domain/entries.js";
import { headNameOf } from "../domain/heads.js";
import { formatMoney, formatSize, todayString } from "../lib/format.js";
import { optionsHtml } from "../lib/html.js";
import { compressImage, readAsDataUrl } from "../lib/image.js";
import { logError } from "../lib/errors.js";
import { createEntry, updateEntry } from "../services/data.js";
import { currentActor, isAdmin, state } from "../state.js";
import { farmOptions, headGroupsHtml, paidByOptions } from "./components.js";
import { $, fillSelect, readInputs, setHidden, showFormError } from "./dom.js";
import { onWriteError, showToast } from "./feedback.js";
import { registerPage, showPage } from "./navigation.js";
import { openAttachment } from "./viewer.js";

const form = {
  editingId: null,        // id of the entry being edited, or null when adding
  attachment: null,       // prepared file: { data, name, type, size }
  attachmentRemoved: false, // true when a saved attachment is removed while editing
  pickToken: 0            // changes when the attachment is cleared, so a slow file read is ignored
};

/** Form field ids, by the field names used in validateEntry. */
const FIELD_IDS = { date: "f-date", farm: "f-farm", headId: "f-head", amount: "f-amount", paidBy: "f-paidby", note: "f-note" };

const editingEntry = () => (form.editingId ? state.expenses.find((x) => x.id === form.editingId) : null);

/** Fills the dropdowns that never change (farms and Paid By). */
function fillStaticSelects() {
  fillSelect($("f-farm"), farmOptions("Select farm"), "");
  fillSelect($("f-paidby"), paidByOptions(), CONFIG.defaultPaidBy);
}

/** Shows the form error and marks (and focuses) the field it belongs to. Empty message = clear. */
function showFieldError(field, message) {
  Object.values(FIELD_IDS).forEach((id) => $(id).removeAttribute("aria-invalid"));
  showFormError("expense-error", message);
  if (message && FIELD_IDS[field]) {
    $(FIELD_IDS[field]).setAttribute("aria-invalid", "true");
    $(FIELD_IDS[field]).focus();
  }
}

/** Shows the typed amount as "PKR 15,000" under the field, so mistakes are easy to see. */
function updateAmountHint() {
  const value = Number($("f-amount").value);
  $("f-amount-hint").textContent = value > 0 ? formatMoney(value) : "";
}

/** Fills the Head dropdown: active heads, expenses first (plus the edited entry's own head). */
export function refreshHeadOptions() {
  const select = $("f-head");
  const keep = select.value;
  const editing = editingEntry();
  const usable = state.heads.filter((h) => h.active || (editing && h.id === editing.headId));
  select.innerHTML = optionsHtml([{ value: "", label: "Select head" }]) + headGroupsHtml(usable);
  if (usable.some((h) => h.id === keep)) select.value = keep;
}

/** Clears the form. Date and Farm are kept for quick repeat entry, unless reset fully. */
export function resetEntryForm(keepDateAndFarm = false) {
  const { date, farm } = readInputs({ date: "f-date", farm: "f-farm" });
  $("expense-form").reset();
  $("f-date").value = keepDateAndFarm && date ? date : todayString();
  $("f-farm").value = keepDateAndFarm ? farm : "";
  $("f-paidby").value = CONFIG.defaultPaidBy;
  form.editingId = null;
  $("expense-form-title").textContent = "Add Expense";
  $("expense-save-btn").textContent = "Save Expense";
  setHidden($("expense-cancel-btn"), true);
  showFieldError("", "");
  updateAmountHint();
  clearAttachment();
  refreshHeadOptions();
}

/** Opens an entry in the form for editing. */
export function startEditing(id) {
  const entry = state.expenses.find((x) => x.id === id);
  if (!entry) return;
  form.editingId = id;
  refreshHeadOptions();
  $("f-date").value = entry.date;
  $("f-farm").value = entry.farm;
  $("f-head").value = entry.headId;
  $("f-amount").value = entry.amount;
  $("f-paidby").value = entry.paidBy;
  $("f-note").value = entry.note || "";
  $("expense-form-title").textContent = "Edit Entry";
  $("expense-save-btn").textContent = "Update Entry";
  setHidden($("expense-cancel-btn"), false);
  showFieldError("", "");
  updateAmountHint();
  clearAttachment();
  if (entry.hasAttachment) showSavedAttachment(entry);
  showPage("add");
  window.scrollTo(0, 0);
}

/** Saves a new entry or updates the one being edited. */
function handleSubmit(e) {
  e.preventDefault();
  if (!isAdmin()) return;
  const input = readInputs(FIELD_IDS);
  const editing = editingEntry();
  if (form.editingId && !editing) {
    showToast("This entry was deleted on another device.", true);
    resetEntryForm();
    return;
  }
  const result = validateEntry(input, { heads: state.heads, allowedInactiveHeadId: editing ? editing.headId : null });
  if (!result.ok) { showFieldError(result.field, result.error); return; }
  showFieldError("", "");
  const saved = `${headNameOf(result.value, state.headMap)} ${formatMoney(result.value.amount)} (${result.value.farm})`;

  if (editing) {
    const attachment = form.attachment ? { file: form.attachment } : { remove: form.attachmentRemoved };
    updateEntry(editing.id, result.value, attachment, currentActor()).catch(onWriteError("Updating entry " + editing.id));
    showToast("Updated: " + saved);
    resetEntryForm();
    showPage("list");
  } else {
    createEntry(result.value, form.attachment, currentActor()).catch(onWriteError("Saving new entry"));
    showToast(navigator.onLine ? "Saved: " + saved : "Saved offline - will sync when online");
    resetEntryForm(true);
    $("f-head").focus();
  }
}

// ---------------------------------------------------------
// Attachment part of the form
// ---------------------------------------------------------

/** Shows the chosen (or already saved) file in the form. */
function showAttachmentPreview({ name, sizeText, thumb, isPdf, canView }) {
  setHidden($("attach-pick-btn"), true);
  setHidden($("attach-preview"), false);
  $("attach-name").textContent = name;
  $("attach-size").textContent = sizeText;
  setHidden($("attach-thumb"), !thumb);
  if (thumb) $("attach-thumb").src = thumb;
  $("attach-pdf-icon").textContent = isPdf ? "PDF" : "IMG";
  setHidden($("attach-pdf-icon"), !!thumb);
  setHidden($("attach-view-btn"), !canView);
}

/** Empties the attachment part of the form. */
function clearAttachment() {
  form.attachment = null;
  form.attachmentRemoved = false;
  form.pickToken++;
  $("f-attach").value = "";
  $("attach-thumb").removeAttribute("src");
  setHidden($("attach-preview"), true);
  setHidden($("attach-pick-btn"), false);
}

/** While editing: shows that the entry already has an attachment. */
function showSavedAttachment(entry) {
  showAttachmentPreview({
    name: entry.attachmentName || "Attachment",
    sizeText: "Already attached",
    thumb: null,
    isPdf: entry.attachmentType === "application/pdf",
    canView: true
  });
}

/** Turns or restores the "Preparing…" state of the attachment button. */
function setPreparing(preparing) {
  $("attach-pick-btn").disabled = preparing;
  $("attach-pick-btn").querySelector("span").textContent = preparing ? "Preparing…" : "Add photo or PDF";
  $("expense-save-btn").disabled = preparing;
}

/** Reads, compresses and checks the picked file, then shows it in the form. */
async function handleFilePicked() {
  const file = $("f-attach").files[0];
  if (!file) return;
  const kind = fileKind(file.type);
  if (!kind) {
    showToast("Please choose a photo or a PDF file.", true);
    $("f-attach").value = "";
    return;
  }

  const token = form.pickToken;
  setPreparing(true);
  try {
    const data = kind === "pdf" ? await readAsDataUrl(file) : await compressImage(file);
    if (token !== form.pickToken) return;   // the form was cleared while the file was being read
    const error = attachmentError(data, file.size);
    if (error) throw new Error(error);
    const name = storedFileName(file.name, kind);
    form.attachment = { data, name, type: kind === "pdf" ? "application/pdf" : "image/jpeg", size: dataUrlBytes(data) };
    showAttachmentPreview({
      name,
      sizeText: formatSize(form.attachment.size) + (kind === "image" && file.size > form.attachment.size ? " (compressed)" : ""),
      thumb: kind === "image" ? data : null,
      isPdf: kind === "pdf",
      canView: false
    });
  } catch (err) {
    logError("Preparing attachment", err);
    showToast(err.message || "Could not read this file.", true);
    $("f-attach").value = "";
  } finally {
    setPreparing(false);
  }
}

function handleRemoveAttachment() {
  // While editing, the saved attachment is deleted only when the entry is updated
  const editing = editingEntry();
  clearAttachment();
  form.attachmentRemoved = !!(editing && editing.hasAttachment);
}

export function initEntryForm() {
  fillStaticSelects();
  $("expense-form").addEventListener("submit", handleSubmit);
  $("f-amount").addEventListener("input", updateAmountHint);
  $("expense-cancel-btn").addEventListener("click", () => {
    resetEntryForm();
    showPage("list");
  });
  $("attach-pick-btn").addEventListener("click", () => $("f-attach").click());
  $("f-attach").addEventListener("change", handleFilePicked);
  $("attach-remove-btn").addEventListener("click", handleRemoveAttachment);
  $("attach-view-btn").addEventListener("click", () => { if (form.editingId) openAttachment(form.editingId); });

  registerPage("add", {
    render() {
      // The entry being edited was deleted on another device
      if (form.editingId && !editingEntry()) {
        showToast("This entry was deleted on another device.", true);
        resetEntryForm();
      }
    }
  });
}
