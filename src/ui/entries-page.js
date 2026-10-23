// =========================================================
// ENTRIES page (Admin): every record with search, filters,
// sorting, edit, delete and CSV export.
// - Normal view: one amount column (expenses in red), filtered totals
// - Cash book view (optional): Inflow / Outflow / running Balance
// - Export: PDF (print window), Excel and CSV of the filtered list
// =========================================================

import { TYPE_LABELS } from "../config.js";
import { filterEntries, lastUpdatedEntry, paidByLabel, sortEntries, sumEntries } from "../domain/entries.js";
import { headNameOf, headTypeOf } from "../domain/heads.js";
import { buildLedger } from "../domain/ledger.js";
import { orderedRange } from "../domain/reports.js";
import { dateTimeText, formatMoney, formatNumber, pluralEntries, rangeLabel, shortDate, todayString } from "../lib/format.js";
import { escapeHtml, tableRowsHtml } from "../lib/html.js";
import { deleteEntry } from "../services/data.js";
import { state } from "../state.js";
import { amountHtml, farmOptions, headGroupsHtml, paidByOptions, slipButtonHtml, statTileHtml } from "./components.js";
import { $, fillSelect, readInputs, setHidden } from "./dom.js";
import { onWriteError, showToast } from "./feedback.js";
import { registerPage } from "./navigation.js";
import { startEditing } from "./entry-form.js";
import { bindExportButtons, downloadTable, printAsPdf } from "./export.js";
import { openAttachment } from "./viewer.js";

const FILTER_IDS = {
  farm: "flt-farm", headId: "flt-head", paidBy: "flt-paidby", type: "flt-type",
  from: "flt-from", to: "flt-to", search: "flt-search"
};
const PAGE_SIZE = 100;   // rows drawn at a time ("Show more" adds the next ones), so big lists stay fast

let rowLimit = PAGE_SIZE;

/** The filters, with From / To swapped if entered the wrong way round. */
function readFilters() {
  const f = readInputs(FILTER_IDS);
  return { ...f, ...orderedRange(f.from, f.to) };
}

const isCashBook = () => $("flt-cashbook").checked;
const sortChoice = () => $("flt-sort").value;

/** The filtered entries in the chosen order (the same list is shown and exported). */
const shownEntries = () => sortEntries(filterEntries(state.expenses, readFilters(), state.headMap), sortChoice());

const actionsCell = (entry) => `${slipButtonHtml(entry, { dashWhenNone: false })}
  <button type="button" class="btn btn-light btn-small" data-edit="${escapeHtml(entry.id)}">Edit</button>
  <button type="button" class="btn btn-danger btn-small" data-delete="${escapeHtml(entry.id)}">Delete</button>`;

const headAndNoteCell = (entry) => `<b>${escapeHtml(headNameOf(entry, state.headMap))}</b>` +
  (entry.note ? `<span class="ledger-note">${escapeHtml(entry.note)}</span>` : "");

// ---------------------------------------------------------
// Normal view
// ---------------------------------------------------------

/** Columns of the normal view. Rows are entries. */
const COLUMNS = [
  { label: "Date", className: "nowrap", cell: (x) => escapeHtml(shortDate(x.date)) },
  { label: "Farm", className: "nowrap", cell: (x) => escapeHtml(x.farm) },
  { label: "Expense head / Description", cell: headAndNoteCell },
  { label: "Paid by", cell: (x) => escapeHtml(paidByLabel(x.paidBy)) },
  { label: "Amount (PKR)", className: "num", cell: (x) => amountHtml(x.amount, headTypeOf(x, state.headMap)) },
  { className: "actions", cell: actionsCell }
];

function renderNormal(entries) {
  const sums = sumEntries(entries, state.headMap);
  const rows = entries.slice(0, rowLimit);
  $("list-table").className = "data-table entries-table responsive-table";
  $("list-head").innerHTML = "<tr>" + COLUMNS.map((c) => `<th class="${c.className === "num" ? "num" : ""}">${escapeHtml(c.label || "")}</th>`).join("") + "</tr>";
  $("list-body").innerHTML = tableRowsHtml(COLUMNS, rows);
  $("list-foot").innerHTML = entries.length
    ? `<tr class="total-row"><td colspan="4">Total expenses</td><td class="num type-outflow">${formatNumber(sums.outflow)}</td><td></td></tr>` +
      (sums.inflow ? `<tr class="total-row secondary"><td colspan="4">Cash received</td><td class="num type-inflow">+${formatNumber(sums.inflow)}</td><td></td></tr>` : "")
    : "";
  return { shown: rows.length, sums };
}

// ---------------------------------------------------------
// Cash book view (running balance, always newest first)
// ---------------------------------------------------------

const ledgerAmount = (value, className) => (value ? `<span class="${className}">${formatNumber(value)}</span>` : "");
const balanceHtml = (value) => `<span class="${value < 0 ? "type-outflow" : ""}">${formatNumber(value)}</span>`;

/** Cash book columns. Rows are { entry, inflow, outflow, balance } from buildLedger. */
const LEDGER_COLUMNS = [
  { label: "Date", className: "nowrap", cell: ({ entry }) => escapeHtml(shortDate(entry.date)) },
  { label: "Farm", className: "nowrap", cell: ({ entry }) => escapeHtml(entry.farm) },
  { label: "Head / Note", cell: ({ entry }) => headAndNoteCell(entry) },
  { label: "Paid by", cell: ({ entry }) => escapeHtml(paidByLabel(entry.paidBy)) },
  { label: "Inflow", className: "num", cell: ({ inflow }) => ledgerAmount(inflow, "type-inflow") },
  { label: "Outflow", className: "num", cell: ({ outflow }) => ledgerAmount(outflow, "type-outflow") },
  { label: "Balance", className: "num balance", cell: ({ balance }) => balanceHtml(balance) },
  { className: "actions", cell: ({ entry }) => actionsCell(entry) }
];

function renderCashBook(filters) {
  const ledger = buildLedger(state.expenses, filters, state.headMap);
  const rows = ledger.rows.slice(0, rowLimit);
  $("list-table").className = "data-table ledger-table";
  $("list-head").innerHTML = "<tr>" + LEDGER_COLUMNS.map((c) => `<th class="${c.className && c.className.startsWith("num") ? "num" : ""}">${escapeHtml(c.label || "")}</th>`).join("") + "</tr>";
  $("list-body").innerHTML = tableRowsHtml(LEDGER_COLUMNS, rows);
  const opening = ledger.hasOpening
    ? `<tr class="ledger-opening"><td colspan="6">Opening balance (before ${escapeHtml(shortDate(filters.from))})</td>` +
      `<td class="num">${balanceHtml(ledger.opening)}</td><td></td></tr>`
    : "";
  $("list-foot").innerHTML = ledger.rows.length || ledger.hasOpening
    ? opening +
      `<tr class="ledger-total"><td colspan="4">Total</td>` +
      `<td class="num type-inflow">${formatNumber(ledger.totals.inflow)}</td>` +
      `<td class="num type-outflow">${formatNumber(ledger.totals.outflow)}</td>` +
      `<td class="num">${balanceHtml(ledger.closing)}</td><td></td></tr>`
    : "";
  return { shown: rows.length, closing: ledger.closing };
}

// ---------------------------------------------------------
// Page
// ---------------------------------------------------------

/** Fills the Farm, Head and Paid By filters (called when heads change). */
export function refreshEntryFilters() {
  fillSelect($("flt-farm"), farmOptions("All farms"), "");
  fillSelect($("flt-paidby"), paidByOptions("Anyone"), "");
  const select = $("flt-head");
  const keep = select.value;
  select.innerHTML = `<option value="">All heads</option>` + headGroupsHtml(state.heads);
  select.value = state.headMap.has(keep) ? keep : "";
}

/** "Entries last updated: 23 Oct 2026, 03:45 PM · Transport PKR 1,500 (Fatehpur Farm)" (all entries, not only the filtered ones). */
function renderLastUpdate() {
  const last = lastUpdatedEntry(state.expenses);
  $("list-last-update").innerHTML = last
    ? `Entries last updated: <b>${escapeHtml(dateTimeText(last.updatedMs))}</b>` +
      `<span class="muted"> · ${escapeHtml(headNameOf(last, state.headMap))} ${escapeHtml(formatMoney(last.amount))} (${escapeHtml(last.farm)})</span>`
    : "Entries last updated: <b>no entries yet</b>";
}

function renderEntries() {
  renderLastUpdate();
  const filters = readFilters();
  const entries = shownEntries();
  const sums = sumEntries(entries, state.headMap);
  const cashBook = isCashBook();
  $("flt-sort").disabled = cashBook;   // the running balance only makes sense newest first

  const result = cashBook ? renderCashBook(filters) : renderNormal(entries);

  $("list-totals").innerHTML =
    statTileHtml({ label: "Total expenses", value: formatMoney(sums.outflow), tone: "expense", primary: true, sub: rangeLabel(filters.from, filters.to) }) +
    statTileHtml({ label: "Entries", value: String(entries.length), sub: entries.length > result.shown ? `Showing ${result.shown}` : "All shown" }) +
    (sums.inflow || cashBook ? statTileHtml({ label: "Cash received", value: formatMoney(sums.inflow), tone: "good" }) : "") +
    (cashBook ? statTileHtml({ label: "Balance (received - spent)", value: formatMoney(result.closing) }) : "");
  $("list-summary").textContent = `${pluralEntries(entries.length)} | Total expenses ${formatMoney(sums.outflow)}` +
    (sums.inflow ? ` | Cash received ${formatMoney(sums.inflow)}` : "");

  setHidden($("list-empty"), entries.length > 0);
  setHidden($("list-table"), entries.length === 0 && !(cashBook && filters.from));
  const more = $("list-more");
  setHidden(more, entries.length <= result.shown);
  more.textContent = `Show more (${entries.length - result.shown} more)`;
}

/** Re-draws from the first page (after any filter change). */
function renderFromTop() {
  rowLimit = PAGE_SIZE;
  renderEntries();
}

function clearFilters() {
  Object.values(FILTER_IDS).forEach((id) => { $(id).value = ""; });
  $("flt-sort").value = "date-desc";
  renderFromTop();
}

/** Deletes an entry after confirmation. */
function confirmDelete(id) {
  const x = state.expenses.find((e) => e.id === id);
  if (!x) return;
  const summary = `${shortDate(x.date)} - ${x.farm}\n${headNameOf(x, state.headMap)}: ${formatMoney(x.amount)}` + (x.note ? `\n${x.note}` : "");
  if (!confirm(`Delete this entry? This cannot be undone.\n\n${summary}`)) return;
  deleteEntry(x).catch(onWriteError("Deleting entry " + id));
  showToast("Entry deleted");
}

/** The chosen filters as text, e.g. "Dates: all dates · Farm: All farms · ..." (printed above the list). */
function filterSummary() {
  const f = readFilters();
  const typeText = { "": "All entries", Outflow: "Expenses only", Inflow: "Cash received only" }[f.type] || "All entries";
  return [
    `Dates: ${rangeLabel(f.from, f.to)}`,
    `Farm: ${f.farm || "All farms"}`,
    `Expense head: ${f.headId ? headNameOf({ headId: f.headId }, state.headMap) : "All heads"}`,
    `Paid by: ${f.paidBy ? paidByLabel(f.paidBy) : "Anyone"}`,
    `Show: ${typeText}`,
    ...(f.search ? [`Search: ${f.search}`] : [])
  ].join("  ·  ");
}

/** Exports the filtered list (in the chosen order) as Excel or CSV, with the totals at the end. */
function exportEntries(format) {
  const rows = shownEntries();
  if (!rows.length) { showToast("Nothing to export", true); return; }
  const { from, to } = readFilters();
  const sums = sumEntries(rows, state.headMap);
  const fileBase = from || to ? `farm-entries-${from || "start"}_to_${to || "today"}` : "farm-entries-all-" + todayString();
  const table = [
    ["Date", "Farm", "Expense Head", "Type", "Amount (PKR)", "Paid By", "Description", "Attachment"],
    ...rows.map((x) => [
      x.date, x.farm, headNameOf(x, state.headMap), TYPE_LABELS[headTypeOf(x, state.headMap)],
      Number(x.amount), paidByLabel(x.paidBy), x.note || "", x.hasAttachment ? "Yes" : "No"
    ]),
    [],
    ["Total expenses", "", "", "", sums.outflow],
    ...(sums.inflow ? [["Cash received", "", "", "", sums.inflow]] : [])
  ];
  const totalsFrom = rows.length + 2;   // the heading row, the entries, one empty row
  downloadTable(format, {
    fileBase,
    sheet: "Entries",
    rows: table,
    boldRows: [0, ...table.slice(totalsFrom).map((_, i) => totalsFrom + i)]
  });
}

/** PDF: draws every row (not only the first page) with the filters on top, then opens the print window. */
function printEntries() {
  if (!shownEntries().length) { showToast("Nothing to export", true); return; }
  printAsPdf(() => {
    rowLimit = Infinity;
    renderEntries();
    $("list-print-title").textContent = isCashBook() ? "Farm Entries - Cash Book" : "Farm Entries";
    $("list-print-meta").textContent = filterSummary();
  });
}

export function initEntriesPage() {
  [...Object.values(FILTER_IDS), "flt-sort"].forEach((id) => $(id).addEventListener("input", renderFromTop));
  $("flt-cashbook").addEventListener("change", renderFromTop);
  $("flt-clear").addEventListener("click", clearFilters);
  $("list-empty-clear").addEventListener("click", clearFilters);
  bindExportButtons($("export-list"), { pdf: printEntries, table: exportEntries });
  $("list-more").addEventListener("click", () => {
    rowLimit += PAGE_SIZE;
    renderEntries();
  });

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
