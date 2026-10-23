// =========================================================
// ENTRIES page (Admin): list with filters, edit, delete and CSV export.
// =========================================================

import { filterEntries } from "../domain/entries.js";
import { headNameOf, headTypeOf, sortedHeads } from "../domain/heads.js";
import { buildLedger } from "../domain/ledger.js";
import { downloadCsv } from "../lib/csv.js";
import { currentMonthString, formatMoney, formatNumber, pluralEntries, shortDate } from "../lib/format.js";
import { escapeHtml, tableRowsHtml } from "../lib/html.js";
import { deleteEntry } from "../services/data.js";
import { state } from "../state.js";
import { farmOptions, slipButtonHtml } from "./components.js";
import { $, fillSelect, readInputs, setHidden } from "./dom.js";
import { onWriteError, showToast } from "./feedback.js";
import { registerPage } from "./navigation.js";
import { startEditing } from "./entry-form.js";
import { openAttachment } from "./viewer.js";

const FILTER_IDS = { farm: "flt-farm", headId: "flt-head", type: "flt-type", from: "flt-from", to: "flt-to", search: "flt-search" };

const readFilters = () => readInputs(FILTER_IDS);
const filteredEntries = () => filterEntries(state.expenses, readFilters(), state.headMap);

/** An amount cell of the ledger: empty when 0, red when negative. */
const amountCell = (value, className) => (value ? `<span class="${className}">${formatNumber(value)}</span>` : "");
const balanceHtml = (value) => `<span class="${value < 0 ? "type-outflow" : ""}">${formatNumber(value)}</span>`;

/** Ledger columns. Rows are { entry, inflow, outflow, balance } from buildLedger. */
const COLUMNS = [
  { label: "Date", className: "nowrap", cell: ({ entry }) => escapeHtml(shortDate(entry.date)) },
  { label: "Farm", className: "nowrap", cell: ({ entry }) => escapeHtml(entry.farm) },
  {
    label: "Head / Note",
    cell: ({ entry }) => `<b>${escapeHtml(headNameOf(entry, state.headMap))}</b>` +
      (entry.note ? `<span class="ledger-note">${escapeHtml(entry.note)}</span>` : "")
  },
  { label: "Paid By", cell: ({ entry }) => escapeHtml(entry.paidBy) },
  { label: "Inflow", className: "num", cell: ({ inflow }) => amountCell(inflow, "type-inflow") },
  { label: "Outflow", className: "num", cell: ({ outflow }) => amountCell(outflow, "type-outflow") },
  { label: "Balance", className: "num balance", cell: ({ balance }) => balanceHtml(balance) },
  {
    className: "actions",
    cell: ({ entry }) => `${slipButtonHtml(entry, { dashWhenNone: false })}
      <button type="button" class="btn btn-light btn-small" data-edit="${escapeHtml(entry.id)}">Edit</button>
      <button type="button" class="btn btn-danger btn-small" data-delete="${escapeHtml(entry.id)}">Delete</button>`
  }
];

/** Footer: opening balance (when From is set) and the totals row. */
function ledgerFootHtml(ledger) {
  const opening = ledger.hasOpening
    ? `<tr class="ledger-opening"><td colspan="6">Opening balance (before ${escapeHtml(shortDate(readFilters().from))})</td>` +
      `<td class="num">${balanceHtml(ledger.opening)}</td><td></td></tr>`
    : "";
  return opening +
    `<tr class="ledger-total"><td colspan="4">Total</td>` +
    `<td class="num type-inflow">${formatNumber(ledger.totals.inflow)}</td>` +
    `<td class="num type-outflow">${formatNumber(ledger.totals.outflow)}</td>` +
    `<td class="num">${balanceHtml(ledger.closing)}</td><td></td></tr>`;
}

/** Fills the Farm and Head filters (called when heads change). */
export function refreshEntryFilters() {
  fillSelect($("flt-farm"), farmOptions("All farms"), "");
  fillSelect($("flt-head"), [{ value: "", label: "All heads" }, ...sortedHeads(state.heads).map((h) => ({ value: h.id, label: h.name }))], "");
}

/** Draws the ledger and its summary line. */
function renderEntries() {
  const ledger = buildLedger(state.expenses, readFilters(), state.headMap);
  $("list-summary").textContent =
    `${pluralEntries(ledger.rows.length)} | Inflow ${formatMoney(ledger.totals.inflow)} | ` +
    `Outflow ${formatMoney(ledger.totals.outflow)} | Balance ${formatMoney(ledger.closing)}`;
  setHidden($("list-empty"), ledger.rows.length > 0);
  $("list-body").innerHTML = tableRowsHtml(COLUMNS, ledger.rows);
  $("list-foot").innerHTML = ledger.rows.length || ledger.hasOpening ? ledgerFootHtml(ledger) : "";
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
