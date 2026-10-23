// =========================================================
// Attachment viewer (slip / bill), shown as a bottom sheet.
// =========================================================

import { dataUrlToBlob } from "../domain/attachments.js";
import { headNameOf } from "../domain/heads.js";
import { formatMoney, formatSize } from "../lib/format.js";
import { escapeHtml } from "../lib/html.js";
import { logError } from "../lib/errors.js";
import { fetchAttachment } from "../services/data.js";
import { state } from "../state.js";
import { $, setHidden } from "./dom.js";
import { hideToast, reportError, showToast } from "./feedback.js";

let viewerUrl = null;   // blob URL of the file on screen (freed when replaced)

/** Downloads the attachment of an entry and shows it in the viewer. */
export async function openAttachment(expenseId) {
  const entry = state.expenses.find((e) => e.id === expenseId);
  showToast("Opening attachment…");

  let file;
  try {
    file = await fetchAttachment(expenseId);
  } catch (err) {
    const fallback = navigator.onLine ? "Could not open the attachment." : "This attachment is not available offline.";
    reportError("Opening attachment " + expenseId, err, fallback);
    return;
  }
  if (!file) { showToast("Attachment not found. It may have been removed.", true); return; }

  let blob;
  try {
    blob = dataUrlToBlob(file.data);
  } catch (err) {
    logError("Attachment data is damaged " + expenseId, err);
    showToast("This attachment is damaged and cannot be opened.", true);
    return;
  }

  if (viewerUrl) URL.revokeObjectURL(viewerUrl);
  viewerUrl = URL.createObjectURL(blob);
  $("viewer-title").textContent = entry
    ? `${entry.date} · ${headNameOf(entry, state.headMap)} · ${formatMoney(entry.amount)}`
    : (file.name || "Attachment");
  $("viewer-download").href = viewerUrl;
  $("viewer-download").download = file.name || "attachment";

  if (file.type === "application/pdf") {
    $("viewer-body").innerHTML = `
      <div class="viewer-pdf">
        <div class="attach-pdf-icon big">PDF</div>
        <p><b>${escapeHtml(file.name)}</b><br><span class="muted small">${escapeHtml(formatSize(file.size || 0))}</span></p>
        <a class="btn btn-light" href="${escapeHtml(viewerUrl)}" target="_blank" rel="noopener">Open PDF</a>
      </div>`;
  } else {
    $("viewer-body").innerHTML = `<img src="${escapeHtml(viewerUrl)}" alt="Attachment">`;
  }
  hideToast();
  setHidden($("viewer"), false);
}

function closeViewer() {
  setHidden($("viewer"), true);
  $("viewer-body").innerHTML = "";
}

/** Makes every "📎 Slip" button inside an element open the viewer. */
export function handleSlipClicks(element) {
  element.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-view]");
    if (btn) openAttachment(btn.dataset.view);
  });
}

export function initViewer() {
  $("viewer-close-btn").addEventListener("click", closeViewer);
  $("viewer").addEventListener("click", (e) => { if (e.target.id === "viewer") closeViewer(); });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !$("viewer").classList.contains("hidden")) closeViewer();
  });
}
