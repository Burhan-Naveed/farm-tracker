// =========================================================
// REPORTS page (Admin and Staff). Every expense report is built
// from buildExpenseAnalysis, so all reports, the Dashboard and the
// exports use the same numbers:
// - Farm-wise:  each farm's expenses and share, highest farm
// - Head-wise:  each expense head per farm, biggest first
// - Monthly:    month by month per farm (or per head), with change
// - Details:    every expense with date, farm, head, description
// - Paid By:    who paid (Amjad Ali, Manager, Other)
// - Cash Book:  the optional Inflow / Outflow / Net view
// Each report returns table models; the same models are drawn on
// screen and exported to Excel / CSV (see report-table.js); PDF
// is the print window of the same page.
// =========================================================

import { CONFIG, TYPE_LABELS, TYPES } from "../config.js";
import { paidByLabel, sortEntries } from "../domain/entries.js";
import { headNameOf } from "../domain/heads.js";
import { buildExpenseAnalysis, buildTotalReport } from "../domain/reports.js";
import { addMoney, formatMoney, monthLabelOf, rangeLabel, slugify, todayString } from "../lib/format.js";
import { escapeHtml } from "../lib/html.js";
import { state } from "../state.js";
import { SINGLE_COLOR, farmColor, renderBarChart, seriesColor } from "./chart.js";
import { farmOptions, headGroupsHtml, paidByOptions, statTileHtml } from "./components.js";
import { $, fillSelect, setHidden } from "./dom.js";
import { bindExportButtons, downloadTable, printAsPdf } from "./export.js";
import { showToast } from "./feedback.js";
import { getCurrentPage, registerPage } from "./navigation.js";
import { bindPeriodFilter } from "./period-filter.js";
import { modelCsvRows, modelTableHtml } from "./report-table.js";
import { handleSlipClicks } from "./viewer.js";

const PAGE_SIZE = 200;        // Expense Details rows drawn at a time ("Show more" / Print show the rest)
const TOP_HEADS_IN_CHART = 10;
const HEADS_STACKED = 5;      // Monthly "compare heads" chart: the top heads, the rest as "Other"

/** The filters each report shows and uses (dates are always used). Hidden filters are ignored. */
const VIEW_FILTERS = {
  farm: ["headId", "paidBy"],
  head: ["farm", "paidBy"],
  monthly: ["farm", "headId", "paidBy", "compare"],
  details: ["farm", "headId", "paidBy", "search", "sort"],
  payer: ["farm", "headId"],
  cash: []
};
const FILTER_INPUTS = { farm: "rpt-farm", headId: "rpt-head", paidBy: "rpt-paidby", search: "rpt-search", compare: "rpt-compare", sort: "rpt-sort" };
const FILTER_DEFAULTS = { farm: "", headId: "", paidBy: "", search: "", compare: "farm", sort: "date-desc" };

let reportView = "farm";
let rowLimit = PAGE_SIZE;
let period = null;   // the period filter (see period-filter.js)

// ---------------------------------------------------------
// Filters
// ---------------------------------------------------------

/** The filters of the open report: dates, plus only the filters this report shows. */
function readFilters() {
  const used = VIEW_FILTERS[reportView];
  const values = Object.fromEntries(Object.entries(FILTER_INPUTS).map(([name, id]) =>
    [name, used.includes(name) ? $(id).value : FILTER_DEFAULTS[name]]));
  return { ...values, ...period.range() };
}

const headName = (id) => headNameOf({ headId: id }, state.headMap);

/** The filter lines printed under the title and at the top of the CSV: [[label, value]]. */
function filterLines(f) {
  const used = VIEW_FILTERS[reportView];
  const lines = [["Dates", rangeLabel(f.from, f.to)]];
  if (used.includes("farm")) lines.push(["Farm", f.farm || "All farms"]);
  if (used.includes("headId")) lines.push(["Expense head", f.headId ? headName(f.headId) : "All expense heads"]);
  if (used.includes("paidBy")) lines.push(["Paid by", f.paidBy ? paidByLabel(f.paidBy) : "Anyone"]);
  if (used.includes("search") && f.search) lines.push(["Search", f.search]);
  return lines;
}

/** Farm columns of a table: the chosen farm only, or all three. */
const farmsShown = (f) => (f.farm ? [f.farm] : CONFIG.farms);

const money = (label) => ({ label, kind: "money" });
const analyse = (f) => buildExpenseAnalysis(state.expenses, state.headMap, f);

/** Standard headline tile with the total expenses. */
const totalTile = (a, f) => statTileHtml({
  label: "Total expenses", value: formatMoney(a.total), tone: "expense", primary: true, sub: rangeLabel(f.from, f.to)
});

const countTile = (a) => statTileHtml({ label: "Entries", value: String(a.count) });

// ---------------------------------------------------------
// Reports. Each returns { title, kpis, tables, chart?, note? }.
// ---------------------------------------------------------

function farmWise(f) {
  const a = analyse(f);
  const top = a.highestFarm;
  return {
    title: "Farm-wise Expense Report",
    kpis: [
      totalTile(a, f),
      statTileHtml({ label: "Highest-spending farm", value: top ? top.farm : "-", sub: top ? `${formatMoney(top.total)} · ${top.share}%` : "No expenses" }),
      countTile(a)
    ],
    chart: {
      title: "Expenses per farm",
      spec: { labels: CONFIG.farms, datasets: [{ label: "Expenses", data: a.farms.map((r) => r.total), color: CONFIG.farms.map(farmColor) }] }
    },
    tables: [{
      title: "Farm-wise expenses",
      columns: [{ label: "Farm", kind: "text" }, money("Expenses"), { label: "Share", kind: "percent" }, { label: "Entries", kind: "count" }],
      rows: a.farms.map((r) => ({ cells: [r.farm, r.total, r.share, r.count] })),
      footer: [{ cells: ["Total", a.total, a.total ? 100 : 0, a.count] }],
      emptyText: "No expenses match these filters."
    }]
  };
}

/** Columns and footer for "one row per X, one column per farm" tables (heads, payers). */
function perFarmTable(title, firstLabel, rows, a, f, emptyText) {
  const farms = farmsShown(f);
  const many = farms.length > 1;
  return {
    title,
    columns: [{ label: firstLabel, kind: "text" }, ...farms.map(money), ...(many ? [money("Total")] : []),
      { label: "Share", kind: "percent" }, { label: "Entries", kind: "count" }],
    rows: rows.map((r) => ({ cells: [r.label, ...farms.map((farm) => r.byFarm[farm]), ...(many ? [r.total] : []), r.share, r.count] })),
    footer: [{
      cells: ["Total", ...farms.map((farm) => a.farms.find((x) => x.farm === farm).total), ...(many ? [a.total] : []), a.total ? 100 : 0, a.count]
    }],
    emptyText
  };
}

function headWise(f) {
  const a = analyse(f);
  const top = a.highestHead;
  const top10 = a.heads.slice(0, TOP_HEADS_IN_CHART);
  return {
    title: "Head-wise Expense Report",
    kpis: [
      totalTile(a, f),
      statTileHtml({ label: "Highest expense head", value: top ? top.name : "-", sub: top ? `${formatMoney(top.total)} · ${top.share}%` : "No expenses" }),
      statTileHtml({ label: "Expense heads used", value: String(a.heads.length) })
    ],
    chart: a.heads.length ? {
      title: a.heads.length > TOP_HEADS_IN_CHART ? `Top ${TOP_HEADS_IN_CHART} expense heads` : "Expenses per head",
      spec: { labels: top10.map((h) => h.name), datasets: [{ label: "Expenses", data: top10.map((h) => h.total), color: SINGLE_COLOR }], horizontal: true }
    } : null,
    tables: [perFarmTable(
      "Expenses by head (highest first)", "Expense head",
      a.heads.map((h) => ({ ...h, label: h.name + (h.active ? "" : " (inactive)") })),
      a, f, "No expenses match these filters."
    )]
  };
}

function monthly(f) {
  const a = analyse(f);
  const byHead = f.compare === "head";
  const groups = byHead
    ? a.heads.map((h) => ({ label: h.name, value: (m) => m.byHead.get(h.id) || 0 }))
    : farmsShown(f).map((farm) => ({ label: farm, value: (m) => m.byFarm[farm] }));
  const busiest = a.months.reduce((best, m) => (!best || m.total > best.total ? m : best), null);

  // Chart: farms stacked, or the top heads stacked with the rest as "Other"
  const stacked = byHead ? groups.slice(0, HEADS_STACKED) : groups;
  const datasets = stacked.map((g, i) => ({
    label: g.label, data: a.months.map(g.value), color: byHead ? seriesColor(i, g.label) : farmColor(g.label)
  }));
  if (byHead && groups.length > HEADS_STACKED) {
    datasets.push({ label: "Other", color: seriesColor(0, "Other"),
      data: a.months.map((m) => stacked.reduce((rest, g) => addMoney(rest, -g.value(m)), m.total)) });
  }

  return {
    title: "Monthly Expense Report",
    kpis: [
      totalTile(a, f),
      statTileHtml({ label: "Average per month", value: formatMoney(a.months.length ? a.total / a.months.length : 0), sub: `${a.months.length} months` }),
      statTileHtml({ label: "Highest month", value: busiest && busiest.total ? monthLabelOf(busiest.month) : "-", sub: busiest && busiest.total ? formatMoney(busiest.total) : "" })
    ],
    chart: a.months.length ? { title: byHead ? "Monthly expenses by head" : "Monthly expenses by farm", spec: { labels: a.months.map((m) => monthLabelOf(m.month)), datasets, stacked: true } } : null,
    tables: [{
      title: byHead ? "Month by month, per expense head" : "Month by month, per farm",
      columns: [{ label: "Month", kind: "text" }, ...groups.map((g) => money(g.label)),
        ...(groups.length > 1 ? [money("Total")] : []),
        { label: "Change", kind: "change" }, { label: "Change", kind: "changePercent" }],
      rows: a.months.map((m) => ({
        cells: [monthLabelOf(m.month), ...groups.map((g) => g.value(m)), ...(groups.length > 1 ? [m.total] : []), m.change, m.changePercent]
      })),
      footer: [{
        cells: ["Total", ...groups.map((g) => a.months.reduce((sum, m) => addMoney(sum, g.value(m)), 0)), ...(groups.length > 1 ? [a.total] : []), null, null]
      }],
      emptyText: "No expenses match these filters."
    }],
    note: "Change = difference from the month before (a rise in spending is red, a fall is green)."
  };
}

function details(f) {
  const a = analyse(f);
  const rows = sortEntries(a.entries, f.sort);
  const largest = rows.reduce((max, x) => Math.max(max, Number(x.amount)), 0);
  return {
    title: "Expense Details Report",
    kpis: [
      totalTile(a, f),
      countTile(a),
      statTileHtml({ label: "Largest expense", value: formatMoney(largest) })
    ],
    tables: [{
      title: "Expenses",
      paged: true,
      columns: [
        { label: "Date", kind: "date" }, { label: "Farm", kind: "text" }, { label: "Expense head", kind: "text" },
        { label: "Description", kind: "text" }, { label: "Paid by", kind: "text" }, { label: "Amount", kind: "expense" }, { label: "Slip", kind: "slip" }
      ],
      rows: rows.map((x) => ({
        cells: [x.date, x.farm, headNameOf(x, state.headMap), x.note || "", paidByLabel(x.paidBy), Number(x.amount), x]
      })),
      footer: [{ cells: ["Total", "", "", "", "", a.total, null] }],
      emptyText: "No expenses match these filters. Try a wider date range or clear the filters."
    }]
  };
}

function payerWise(f) {
  const a = analyse(f);
  const amjad = a.payers.find((p) => p.value === CONFIG.defaultPaidBy);
  return {
    title: "Paid By Report",
    kpis: [
      totalTile(a, f),
      statTileHtml({
        label: `Paid by ${paidByLabel(CONFIG.defaultPaidBy)}`, value: formatMoney(amjad ? amjad.total : 0),
        sub: `${amjad ? amjad.share : 0}% of expenses`
      }),
      countTile(a)
    ],
    chart: a.payers.length ? {
      title: "Expenses per payer",
      spec: { labels: a.payers.map((p) => p.name), datasets: [{ label: "Expenses", data: a.payers.map((p) => p.total), color: SINGLE_COLOR }] }
    } : null,
    tables: [perFarmTable("Expenses by who paid", "Paid by", a.payers.map((p) => ({ ...p, label: p.name })), a, f, "No expenses match these filters.")]
  };
}

function cashBook(f) {
  const report = buildTotalReport(state.expenses, state.heads, state.headMap, f);
  const farms = CONFIG.farms;
  const order = ["Outflow", "Inflow"].filter((t) => TYPES.includes(t));
  const rows = [];
  order.forEach((type) => {
    report.rows.filter((r) => r.type === type).forEach((r) => rows.push({
      cells: [r.name + (r.active ? "" : " (inactive)"), TYPE_LABELS[type], ...farms.map((farm) => r.byFarm[farm]), r.total]
    }));
    const t = report.totals[type];
    rows.push({ className: "subtotal-row", cells: [`Total ${TYPE_LABELS[type].toLowerCase()}`, TYPE_LABELS[type], ...farms.map((farm) => t.byFarm[farm]), t.total] });
  });
  return {
    title: "Cash Book (Inflow and Outflow)",
    kpis: [
      statTileHtml({ label: "Cash received", value: formatMoney(report.totals.Inflow.total), tone: "good" }),
      statTileHtml({ label: "Expenses", value: formatMoney(report.totals.Outflow.total), tone: "expense" }),
      statTileHtml({ label: "Balance (received - spent)", value: formatMoney(report.net.total) })
    ],
    note: "Optional view. A negative balance only means less cash received has been recorded than spent; the expenses themselves are still correct.",
    chart: {
      title: "Cash received and expenses per farm",
      spec: {
        labels: farms,
        datasets: [
          { label: "Cash received", data: farms.map((farm) => report.totals.Inflow.byFarm[farm]), color: seriesColor(0) },
          { label: "Expenses", data: farms.map((farm) => report.totals.Outflow.byFarm[farm]), color: seriesColor(1) }
        ]
      }
    },
    tables: [{
      title: "Heads per farm",
      columns: [{ label: "Head", kind: "text" }, { label: "Type", kind: "text" }, ...farms.map(money), money("Total")],
      rows,
      footer: [{ className: "net-row", cells: ["Balance (received - spent)", "", ...farms.map((farm) => report.net.byFarm[farm]), report.net.total] }],
      emptyText: "No heads yet."
    }]
  };
}

const VIEWS = { farm: farmWise, head: headWise, monthly, details, payer: payerWise, cash: cashBook };

// ---------------------------------------------------------
// Drawing, export and print
// ---------------------------------------------------------

function renderReports() {
  document.querySelectorAll("#rpt-view button").forEach((b) => {
    const active = b.dataset.view === reportView;
    b.classList.toggle("active", active);
    b.setAttribute("aria-selected", String(active));
  });
  document.querySelectorAll(".report-filters [data-filter]").forEach((el) =>
    setHidden(el, !VIEW_FILTERS[reportView].includes(el.dataset.filter))
  );

  const f = readFilters();
  const report = VIEWS[reportView](f);
  $("report-title").textContent = report.title;
  $("report-meta").textContent = filterLines(f).map(([label, value]) => `${label}: ${value}`).join("  ·  ");
  $("report-note").textContent = report.note || "";
  setHidden($("report-note"), !report.note);
  $("report-kpis").innerHTML = report.kpis.join("");

  setHidden($("report-chart-card"), !report.chart);
  if (report.chart) {
    $("report-chart-title").textContent = report.chart.title;
    renderBarChart("report-chart", report.chart.spec);
  }

  $("report-tables").innerHTML = report.tables.map((model) => {
    const table = modelTableHtml(model, model.paged ? rowLimit : Infinity);
    const more = table.shown < table.total
      ? `<div class="more-row no-print"><button type="button" class="btn btn-light" data-more>Show more (${table.total - table.shown} more)</button></div>`
      : "";
    return `<div class="card table-wrap"><h3>${escapeHtml(model.title)}</h3>${table.html}${more}</div>`;
  }).join("");
}

/** Re-draws from the first page of rows (after any filter change). */
function renderFromTop() {
  rowLimit = PAGE_SIZE;
  renderReports();
}

/** The open report with nothing in it (then there is nothing to export). */
const isEmptyReport = (report) => report.tables.every((t) => !t.rows.length);

/**
 * Downloads the open report exactly as shown, as Excel or CSV: filters at the
 * top, then every table with its totals. Titles, headings and totals are bold in Excel.
 */
function exportReport(format) {
  const f = readFilters();
  const report = VIEWS[reportView](f);
  if (isEmptyReport(report)) { showToast("Nothing to export", true); return; }
  const rows = [
    ["Farm Tracker - " + report.title],
    ...filterLines(f),
    ["Exported on", todayString()],
    []
  ];
  const boldRows = [0];
  report.tables.forEach((model) => {
    const start = rows.length;
    const part = modelCsvRows(model);
    const footerCount = (model.footer || []).length;
    boldRows.push(start, start + 1, ...part.slice(part.length - footerCount).map((_, i) => start + part.length - footerCount + i));
    rows.push(...part, []);
  });
  downloadTable(format, {
    fileBase: `${slugify(report.title)}-${f.from || "start"}_to_${f.to || "today"}`,
    sheet: report.title,
    rows,
    boldRows
  });
}

/** PDF: draws every row (not only the first page), then opens the print window. */
function printReport() {
  if (isEmptyReport(VIEWS[reportView](readFilters()))) { showToast("Nothing to export", true); return; }
  printAsPdf(() => {
    rowLimit = Infinity;
    renderReports();
  });
}

/** Fills the Head dropdown: expense heads only (inactive ones too, they still have entries). */
export function refreshReportHeadOptions() {
  const select = $("rpt-head");
  const keep = select.value;
  select.innerHTML = `<option value="">All expense heads</option>` + headGroupsHtml(state.heads, ["Outflow"]);
  select.value = state.headMap.has(keep) ? keep : "";
}

function clearFilters() {
  Object.entries(FILTER_INPUTS).forEach(([name, id]) => { $(id).value = FILTER_DEFAULTS[name]; });
  period.set("this-year");
  renderFromTop();
}

export function initReportsPage() {
  fillSelect($("rpt-farm"), farmOptions("All farms"), "");
  fillSelect($("rpt-paidby"), paidByOptions("Anyone"), "");
  period = bindPeriodFilter({
    control: $("rpt-period"),
    fromInput: $("rpt-from"),
    toInput: $("rpt-to"),
    initial: "this-year",
    onChange: renderFromTop
  });

  Object.values(FILTER_INPUTS).forEach((id) => $(id).addEventListener("input", renderFromTop));
  $("rpt-view").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-view]");
    if (!btn || !VIEWS[btn.dataset.view] || btn.dataset.view === reportView) return;
    reportView = btn.dataset.view;
    renderFromTop();
  });
  $("rpt-clear").addEventListener("click", clearFilters);
  bindExportButtons($("export-report"), { pdf: printReport, table: exportReport });
  $("report-tables").addEventListener("click", (e) => {
    if (!e.target.closest("button[data-more]")) return;
    rowLimit += PAGE_SIZE;
    renderReports();
  });
  handleSlipClicks($("report-tables"));

  // Chart.js loads with "defer"; draw the chart once it is ready
  window.addEventListener("load", () => { if (getCurrentPage() === "reports") renderReports(); });

  registerPage("reports", { render: renderReports });
}
