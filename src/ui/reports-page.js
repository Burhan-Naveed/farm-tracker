// =========================================================
// REPORTS page: three report types, each with CSV export and print.
// - Total: all farms for a date range
// - Farm-wise: one farm in a date range, with all its transactions
// - Head-wise: one head over any date range
// =========================================================

import { CONFIG, TYPES } from "../config.js";
import { buildFarmReport, buildHeadReport, buildTotalReport, orderedRange } from "../domain/reports.js";
import { headNameOf, headTypeOf } from "../domain/heads.js";
import { downloadCsv } from "../lib/csv.js";
import {
  formatMoney, formatNumber, monthLabelOf, percentOf, rangeLabel, slugify, todayString
} from "../lib/format.js";
import { escapeHtml, tableRowsHtml } from "../lib/html.js";
import { state } from "../state.js";
import { renderFarmChart } from "./chart.js";
import { cardHtml, farmOptions, headGroupsHtml, moneySummaryCardHtml, slipButtonHtml, typeClass } from "./components.js";
import { $, fillSelect, setHidden } from "./dom.js";
import { showToast } from "./feedback.js";
import { getCurrentPage, registerPage } from "./navigation.js";
import { handleSlipClicks } from "./viewer.js";

let reportView = "total";   // "total", "farm" or "head"

// ---------------------------------------------------------
// Reading the filters
// ---------------------------------------------------------

/** The chosen From / To dates (swapped if entered the wrong way round). Empty = open ended. */
const selectedRange = () => orderedRange($("rpt-from").value, $("rpt-to").value);

/** "from-to" part of export file names, e.g. "2026-01-01_to_2026-10-23". */
const rangeFilePart = ({ from, to }) => `${from || "start"}_to_${to || "today"}`;

const selectedFarm = () => (CONFIG.farms.includes($("rpt-farm").value) ? $("rpt-farm").value : CONFIG.farms[0]);

/** Head-wise filters. From/To are swapped if entered the wrong way round. */
function headFilters() {
  return { headId: $("rpt-head").value, farm: $("rpt-hfarm").value, ...selectedRange() };
}

// ---------------------------------------------------------
// Shared table pieces
// ---------------------------------------------------------

/** Rows of a group table: "Inflow" header row, the rows, then a "Total Inflow" row; same for Outflow. */
function groupedRowsHtml({ colspan, rowsOf, rowHtml, emptyText, subtotalHtml }) {
  return TYPES.map((type) => {
    const rows = rowsOf(type);
    return `<tr class="group-row"><td colspan="${colspan}">${type}</td></tr>` +
      (rows.length ? rows.map(rowHtml).join("") : `<tr><td class="muted" colspan="${colspan}">${escapeHtml(emptyText(type))}</td></tr>`) +
      `<tr class="subtotal-row"><td>Total ${type}</td>${subtotalHtml(type)}</tr>`;
  }).join("");
}

const numCell = (n, extraClass = "") => `<td class="num ${extraClass}">${formatNumber(n)}</td>`;

/** Columns shared by the transaction tables of the Farm-wise and Head-wise reports. */
const TX_COLUMNS = {
  date: { label: "Date", cell: (x) => escapeHtml(x.date) },
  farm: { label: "Farm", cell: (x) => escapeHtml(x.farm) },
  head: { label: "Head", cell: (x) => escapeHtml(headNameOf(x, state.headMap)) },
  type: { label: "Type", className: (x) => typeClass(headTypeOf(x, state.headMap)), cell: (x) => escapeHtml(headTypeOf(x, state.headMap)) },
  amount: { label: "Amount", className: (x) => "num " + typeClass(headTypeOf(x, state.headMap)), cell: (x) => escapeHtml(formatMoney(x.amount)) },
  paidBy: { label: "Paid By", cell: (x) => escapeHtml(x.paidBy) },
  note: { label: "Note", cell: (x) => escapeHtml(x.note) },
  slip: { className: "actions no-print", cell: (x) => slipButtonHtml(x) }
};

/** CSV rows of a transaction list: the given column titles, then one row per entry. */
function transactionCsvRows(entries, columns) {
  const values = {
    Date: (x) => x.date,
    Farm: (x) => x.farm,
    Head: (x) => headNameOf(x, state.headMap),
    Type: (x) => headTypeOf(x, state.headMap),
    "Amount (PKR)": (x) => Number(x.amount),
    "Paid By": (x) => x.paidBy,
    Note: (x) => x.note || "",
    Attachment: (x) => (x.hasAttachment ? "Yes" : "No")
  };
  return [columns, ...entries.map((x) => columns.map((c) => values[c](x)))];
}

// ---------------------------------------------------------
// Total Report (all farms)
// ---------------------------------------------------------

function renderTotalReport() {
  const range = selectedRange();
  const report = buildTotalReport(state.expenses, state.heads, state.headMap, range);
  const farms = CONFIG.farms;
  const label = rangeLabel(range.from, range.to);
  $("report-title").textContent = "Farm Report - " + label;

  $("summary-cards").innerHTML =
    moneySummaryCardHtml("All Farms - " + label, report.totals.Inflow.total, report.totals.Outflow.total, report.net.total, "overall") +
    farms.map((f) => moneySummaryCardHtml(f, report.totals.Inflow.byFarm[f], report.totals.Outflow.byFarm[f], report.net.byFarm[f])).join("");

  const cells = (byFarm, total) => farms.map((f) => numCell(byFarm[f])).join("") + numCell(total);
  $("report-table").innerHTML =
    `<thead><tr><th>Head</th>${farms.map((f) => `<th class="num">${escapeHtml(f)}</th>`).join("")}<th class="num">Total</th></tr></thead><tbody>` +
    groupedRowsHtml({
      colspan: farms.length + 2,
      rowsOf: (type) => report.rows.filter((r) => r.type === type),
      rowHtml: (r) => `<tr><td class="${r.active ? "" : "inactive"}">${escapeHtml(r.name)}${r.active ? "" : " (inactive)"}</td>${cells(r.byFarm, r.total)}</tr>`,
      emptyText: (type) => `No ${type.toLowerCase()} heads`,
      subtotalHtml: (type) => cells(report.totals[type].byFarm, report.totals[type].total)
    }) +
    `<tr class="net-row"><td>Net (Inflow - Outflow)</td>${cells(report.net.byFarm, report.net.total)}</tr></tbody>`;

  renderFarmChart(report);
}

function exportTotalReport() {
  const range = selectedRange();
  const report = buildTotalReport(state.expenses, state.heads, state.headMap, range);
  const farms = CONFIG.farms;
  const rows = [["Head", "Type", ...farms.map((f) => f + " (PKR)"), "Total (PKR)"]];
  TYPES.forEach((type) => {
    report.rows.filter((r) => r.type === type).forEach((r) => rows.push([r.name, type, ...farms.map((f) => r.byFarm[f]), r.total]));
    const t = report.totals[type];
    rows.push(["Total " + type, type, ...farms.map((f) => t.byFarm[f]), t.total]);
  });
  rows.push(["Net (Inflow - Outflow)", "", ...farms.map((f) => report.net.byFarm[f]), report.net.total]);
  downloadCsv(`farm-report-${rangeFilePart(range)}.csv`, rows);
}

// ---------------------------------------------------------
// Farm-wise report (one farm, a date range)
// ---------------------------------------------------------

function renderFarmReport() {
  const range = selectedRange();
  const farm = selectedFarm();
  const r = buildFarmReport(state.expenses, state.headMap, range, farm);
  const title = `${farm} - ${rangeLabel(range.from, range.to)}`;
  $("report-title").textContent = title;

  $("farm-summary").innerHTML =
    moneySummaryCardHtml(title, r.totals.Inflow, r.totals.Outflow, r.net, "overall") +
    cardHtml("These dates", [
      { label: "Transactions", value: String(r.entries.length) },
      { label: "Inflow entries", value: String(r.inflowCount) },
      { label: "Outflow entries", value: String(r.entries.length - r.inflowCount) },
      { label: "With slip 📎", value: String(r.slipCount) }
    ], { extraClass: "stat-card" });

  $("farm-head-table").innerHTML =
    `<thead><tr><th>Head</th><th class="num">Entries</th><th class="num">Amount</th></tr></thead><tbody>` +
    groupedRowsHtml({
      colspan: 3,
      rowsOf: (type) => r.heads.filter((h) => h.type === type),
      rowHtml: (h) => `<tr><td>${escapeHtml(h.name)}</td><td class="num">${h.count}</td>${numCell(h.total)}</tr>`,
      emptyText: (type) => `No ${type.toLowerCase()} in these dates`,
      subtotalHtml: (type) => `<td></td>${numCell(r.totals[type])}`
    }) +
    `<tr class="net-row"><td>Net (Inflow - Outflow)</td><td></td>${numCell(r.net)}</tr></tbody>`;

  $("farm-tx-title").textContent = `Transactions (${r.entries.length})`;
  setHidden($("farm-tx-empty"), r.entries.length > 0);
  const c = TX_COLUMNS;
  $("farm-tx-body").innerHTML = tableRowsHtml([c.date, c.head, c.type, c.amount, c.paidBy, c.note, c.slip], r.entries);
}

function exportFarmReport() {
  const range = selectedRange();
  const farm = selectedFarm();
  const r = buildFarmReport(state.expenses, state.headMap, range, farm);
  const rows = [[farm + " - " + rangeLabel(range.from, range.to)], [], ["Head", "Type", "Amount (PKR)"]];
  TYPES.forEach((type) => {
    r.heads.filter((h) => h.type === type).forEach((h) => rows.push([h.name, type, h.total]));
    rows.push(["Total " + type, type, r.totals[type]]);
  });
  rows.push(["Net (Inflow - Outflow)", "", r.net], [], ["Transactions"]);
  rows.push(...transactionCsvRows(r.entries, ["Date", "Head", "Type", "Amount (PKR)", "Paid By", "Note", "Attachment"]));
  downloadCsv(`${slugify(farm)}-report-${rangeFilePart(range)}.csv`, rows);
}

// ---------------------------------------------------------
// Head-wise report (one head, any farm, any date range)
// ---------------------------------------------------------

function renderHeadReport() {
  const f = headFilters();
  const head = state.headMap.get(f.headId);
  if (!head) {
    $("report-title").textContent = "";
    $("head-summary").innerHTML = `<div class="card"><p class="muted">Please select a head.</p></div>`;
    ["head-farm-table", "head-month-table", "head-tx-body"].forEach((id) => { $(id).innerHTML = ""; });
    setHidden($("head-tx-empty"), true);
    return;
  }
  const r = buildHeadReport(state.expenses, f);
  const amountClass = typeClass(head.type);
  const where = f.farm || "All farms";
  const range = rangeLabel(f.from, f.to);
  $("report-title").textContent = `${head.name} - ${where} - ${range}`;

  $("head-summary").innerHTML =
    cardHtml(`${head.name} (${head.type})`, [
      { label: where, value: escapeHtml(range) },
      { label: "Total", value: formatMoney(r.total) }
    ], { extraClass: "overall" }) +
    cardHtml("Details", [
      { label: "Transactions", value: String(r.entries.length) },
      { label: "Average per entry", value: formatMoney(r.average) },
      { label: "Largest entry", value: formatMoney(r.largest) },
      { label: "With slip 📎", value: String(r.slipCount) }
    ], { extraClass: "stat-card" });

  // Farm-wise breakdown (only useful when all farms are selected)
  setHidden($("head-farm-card"), !!f.farm);
  $("head-farm-table").innerHTML =
    `<thead><tr><th>Farm</th><th class="num">Amount</th><th class="num">Share</th></tr></thead><tbody>` +
    CONFIG.farms.map((farm) =>
      `<tr><td>${escapeHtml(farm)}</td>${numCell(r.byFarm[farm], amountClass)}<td class="num">${percentOf(r.byFarm[farm], r.total)}%</td></tr>`
    ).join("") +
    `<tr class="net-row"><td>Total</td>${numCell(r.total)}<td class="num">${r.total ? "100%" : "0%"}</td></tr></tbody>`;

  const months = [...r.byMonth.entries()];
  $("head-month-table").innerHTML =
    `<thead><tr><th>Month</th><th class="num">Amount</th></tr></thead><tbody>` +
    (months.length
      ? months.map(([m, amount]) => `<tr><td>${escapeHtml(monthLabelOf(m))}</td>${numCell(amount, amountClass)}</tr>`).join("")
      : `<tr><td class="muted" colspan="2">No entries</td></tr>`) +
    `<tr class="net-row"><td>Total</td>${numCell(r.total)}</tr></tbody>`;

  $("head-tx-title").textContent = `Transactions (${r.entries.length})`;
  setHidden($("head-tx-empty"), r.entries.length > 0);
  const c = TX_COLUMNS;
  $("head-tx-body").innerHTML = tableRowsHtml([c.date, c.farm, c.amount, c.paidBy, c.note, c.slip], r.entries);
}

function exportHeadReport() {
  const f = headFilters();
  const head = state.headMap.get(f.headId);
  if (!head) { showToast("Please select a head.", true); return; }
  const r = buildHeadReport(state.expenses, f);
  const rows = [
    [`${head.name} (${head.type})`], ["Farm", f.farm || "All farms"], ["Dates", rangeLabel(f.from, f.to)],
    ["Total (PKR)", r.total], ["Transactions", r.entries.length], []
  ];
  if (!f.farm) rows.push(["Farm", "Amount (PKR)"], ...CONFIG.farms.map((farm) => [farm, r.byFarm[farm]]), []);
  rows.push(["Month", "Amount (PKR)"], ...[...r.byMonth.entries()].map(([m, a]) => [monthLabelOf(m), a]), []);
  rows.push(...transactionCsvRows(r.entries, ["Date", "Farm", "Amount (PKR)", "Paid By", "Note", "Attachment"]));
  downloadCsv(`${slugify(head.name)}-${slugify(f.farm || "all-farms")}-${rangeFilePart(f)}.csv`, rows);
}

// ---------------------------------------------------------
// Page setup
// ---------------------------------------------------------

const VIEWS = {
  total: { sectionId: "report-total", render: renderTotalReport, exportCsv: exportTotalReport },
  farm: { sectionId: "report-farm", render: renderFarmReport, exportCsv: exportFarmReport },
  head: { sectionId: "report-head", render: renderHeadReport, exportCsv: exportHeadReport }
};

/** Shows only the section and filters of the chosen report type, then draws it. */
function renderReports() {
  Object.entries(VIEWS).forEach(([name, view]) => setHidden($(view.sectionId), name !== reportView));
  document.querySelectorAll(".report-filters [data-views]").forEach((el) =>
    setHidden(el, !el.dataset.views.split(" ").includes(reportView))
  );
  document.querySelectorAll("#rpt-view button").forEach((b) => b.classList.toggle("active", b.dataset.view === reportView));
  VIEWS[reportView].render();
}

/** Fills the Head dropdown of the Head-wise report (all heads; inactive ones still have entries). */
export function refreshReportHeadOptions() {
  const select = $("rpt-head");
  const keep = select.value;
  select.innerHTML = headGroupsHtml(state.heads, ["Outflow", "Inflow"]);
  if (state.headMap.has(keep)) select.value = keep;
}

export function initReportsPage() {
  fillSelect($("rpt-farm"), farmOptions(), CONFIG.farms[0]);
  fillSelect($("rpt-hfarm"), farmOptions("All farms (total)"), "");
  // Reports start with this year so far
  $("rpt-from").value = todayString().slice(0, 4) + "-01-01";
  $("rpt-to").value = todayString();

  ["rpt-farm", "rpt-head", "rpt-hfarm", "rpt-from", "rpt-to"].forEach((id) =>
    $(id).addEventListener("input", renderReports)
  );
  $("rpt-view").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-view]");
    if (!btn || !VIEWS[btn.dataset.view] || btn.dataset.view === reportView) return;
    reportView = btn.dataset.view;
    renderReports();
  });
  $("export-report-btn").addEventListener("click", () => VIEWS[reportView].exportCsv());
  $("print-report-btn").addEventListener("click", () => window.print());
  handleSlipClicks($("farm-tx-body"));
  handleSlipClicks($("head-tx-body"));

  // Chart.js loads with "defer"; draw the chart once it is ready
  window.addEventListener("load", () => { if (getCurrentPage() === "reports") renderReports(); });

  registerPage("reports", { render: renderReports });
}
