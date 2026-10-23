// =========================================================
// ENTRIES page (Admin): list with filters, edit, delete and CSV export.
// =========================================================

import { filterEntries, sumEntries } from "../domain/entries.js";
import { headNameOf, headTypeOf, sortedHeads } from "../domain/heads.js";
import { downloadCsv } from "../lib/csv.js";
import { currentMonthString, formatMoney, pluralEntries } from "../lib/format.js";
import { escapeHtml, tableRowsHtml } from "../lib/html.js";
import { deleteEntry } from "../services/data.js";
import { state } from "../state.js";
import { farmOptions, slipButtonHtml, typeClass } from "./components.js";
import { $, fillSelect, readInputs, setHidden } from "./dom.js";
import { onWriteError, showToast } from "./feedback.js";
import { registerPage } from "./navigation.js";
import { startEditing } from "./entry-form.js";
import { openAttachment } from "./viewer.js";

const FILTER_IDS = { farm: "flt-farm", headId: "flt-head", type: "flt-type", from: "flt-from", to: "flt-to", search: "flt-search" };

const readFilters = () => readInputs(FILTER_IDS);
const filteredEntries = () => filterEntries(state.expenses, readFilters(), state.headMap);

/** Table columns of the Entries list. */
const COLUMNS = [
  { label: "Date", cell: (x) => escapeHtml(x.date) },
  { label: "Farm", cell: (x) => escapeHtml(x.farm) },
  { label: "Head", cell: (x) => escapeHtml(headNameOf(x, state.headMap)) },
  { label: "Type", className: (x) => typeClass(headTypeOf(x, state.headMap)), cell: (x) => escapeHtml(headTypeOf(x, state.headMap)) },
  { label: "Amount", className: "num", cell: (x) => escapeHtml(formatMoney(x.amount)) },
  { label: "Paid By", cell: (x) => escapeHtml(x.paidBy) },
  { label: "Note", cell: (x) => escapeHtml(x.note) },
  {
    className: "actions",
    cell: (x) => `${slipButtonHtml(x, { dashWhenNone: false })}
      <button type="button" class="btn btn-light btn-small" data-edit="${escapeHtml(x.id)}">Edit</button>
      <button type="button" class="btn btn-danger btn-small" data-delete="${escapeHtml(x.id)}">Delete</button>`
  }
];

/** Fills the Farm and Head filters (called when heads change). */
export function refreshEntryFilters() {
  fillSelect($("flt-farm"), farmOptions("All farms"), "");
  fillSelect($("flt-head"), [{ value: "", label: "All heads" }, ...sortedHeads(state.heads).map((h) => ({ value: h.id, label: h.name }))], "");
}

/** Draws the Entries table and its summary line. */
function renderEntries() {
  const rows = filteredEntries();
  const sums = sumEntries(rows, state.headMap);
  $("list-summary").textContent =
    `${pluralEntries(rows.length)} | Inflow ${formatMoney(sums.inflow)} | Outflow ${formatMoney(sums.outflow)}`;
  setHidden($("list-empty"), rows.length > 0);
  $("list-body").innerHTML = tableRowsHtml(COLUMNS, rows);
}

/** Deletes an entry after confirmation. */
function confirmDelete(id) {
  const x = state.expenses.find((e) => e.id === id);
  if (!x) return;
  const summary = `${x.date} - ${x.farm}\n${headNameOf(x, state.headMap)}: ${formatMoney(x.amount)}`;
  if (!confirm(`Delete this entry?\n\n${summary}`)) return;
  deleteEntry(x).catch(onWriteError("Deleting entry " + id));
  showToast("Entry deleted");
}

/** Exports the filtered list as CSV. */
function exportEntries() {
  const rows = filteredEntries();
  if (!rows.length) { showToast("Nothing to export", true); return; }
  const { from, to } = readFilters();
  const name = from || to ? `farm-expenses-${from || "start"}_to_${to || "today"}` : "farm-expenses-" + currentMonthString();
  downloadCsv(name + ".csv", [
    ["Date", "Farm", "Head", "Type", "Amount (PKR)", "Paid By", "Note", "Attachment"],
    ...rows.map((x) => [
      x.date, x.farm, headNameOf(x, state.headMap), headTypeOf(x, state.headMap),
      Number(x.amount), x.paidBy, x.note || "", x.hasAttachment ? "Yes" : "No"
    ])
  ]);
}

export function initEntriesPage() {
  Object.values(FILTER_IDS).forEach((id) => $(id).addEventListener("input", renderEntries));
  $("flt-clear").addEventListener("click", () => {
    Object.values(FILTER_IDS).forEach((id) => { $(id).value = ""; });
    renderEntries();
  });
  $("export-list-btn").addEventListener("click", exportEntries);

  // One listener for the buttons of all rows
  $("list-body").addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    if (btn.dataset.view) openAttachment(btn.dataset.view);
    if (btn.dataset.edit) startEditing(btn.dataset.edit);
    if (btn.dataset.delete) confirmDelete(btn.dataset.delete);
  });

  registerPage("list", { render: renderEntries });
}
