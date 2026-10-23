// =========================================================
// DASHBOARD page (Admin and Staff): where the money is spent.
// Every figure comes from buildExpenseAnalysis on the live
// entries, so it always matches the Reports page.
// =========================================================

import { CONFIG } from "../config.js";
import { filterEntries, sumEntries } from "../domain/entries.js";
import { monthRange, monthsBetween, periodRange, previousMonth } from "../domain/periods.js";
import { buildExpenseAnalysis } from "../domain/reports.js";
import { formatMoney, pluralEntries, rangeLabel, shortMonthLabel, todayString } from "../lib/format.js";
import { state } from "../state.js";
import { farmColor, renderBarChart } from "./chart.js";
import { barListHtml, cardHtml, statTileHtml } from "./components.js";
import { $, setHidden } from "./dom.js";
import { getCurrentPage, registerPage } from "./navigation.js";
import { bindPeriodFilter } from "./period-filter.js";

const TREND_MIN_MONTHS = 3;    // a shorter period shows the last TREND_MONTHS months instead
const TREND_MONTHS = 6;

let period = null;   // the period filter (see period-filter.js)

const analysis = (range) => buildExpenseAnalysis(state.expenses, state.headMap, range);

/** "Up 12% from last month" style text. */
function comparedText(now, before, beforeName) {
  if (!before) return now ? `Nothing spent in ${beforeName}` : "";
  const percent = Math.round(((now - before) / before) * 100);
  if (percent === 0) return `Same as ${beforeName}`;
  return `${percent > 0 ? "Up" : "Down"} ${Math.abs(percent)}% from ${beforeName}`;
}

/** The four headline tiles. */
function kpisHtml(a, range) {
  const month = todayString().slice(0, 7);
  const thisMonth = analysis(periodRange("this-month", todayString())).total;
  const lastMonth = analysis(monthRange(previousMonth(month))).total;
  const head = a.highestHead;
  const farm = a.highestFarm;
  return [
    statTileHtml({
      label: "Total expenses", value: formatMoney(a.total), tone: "expense", primary: true,
      sub: `${pluralEntries(a.count)} · ${rangeLabel(range.from, range.to)}`
    }),
    statTileHtml({
      label: "This month's expenses", value: formatMoney(thisMonth), tone: "expense",
      sub: comparedText(thisMonth, lastMonth, "last month")
    }),
    statTileHtml({
      label: "Highest expense head",
      value: head ? head.name : "-",
      sub: head ? `${formatMoney(head.total)} · ${head.share}% of expenses` : "No expenses in this period"
    }),
    statTileHtml({
      label: "Highest-spending farm",
      value: farm ? farm.farm : "-",
      sub: farm ? `${formatMoney(farm.total)} · ${farm.share}% of expenses` : "No expenses in this period"
    })
  ].join("");
}

/**
 * Months for the trend chart: the chosen period, or (when it is shorter
 * than TREND_MIN_MONTHS) the last TREND_MONTHS months up to its end.
 */
function trendRange(range, a) {
  const months = a.months.map((m) => m.month);
  if (months.length >= TREND_MIN_MONTHS) return { range, analysis: a };
  const endMonth = (range.to || todayString()).slice(0, 7);
  let startMonth = endMonth;
  for (let i = 1; i < TREND_MONTHS; i++) startMonth = previousMonth(startMonth);
  const wider = { from: monthRange(startMonth).from, to: range.to || todayString() };
  return { range: wider, analysis: analysis(wider) };
}

function renderTrend(range, a) {
  const trend = trendRange(range, a);
  const months = trend.analysis.months;
  const first = months[0];
  const last = months[months.length - 1];
  $("dash-trend-note").textContent = first
    ? `${shortMonthLabel(first.month)} to ${shortMonthLabel(last.month)}, stacked by farm` +
      (trend.range !== range ? ` (last ${monthsBetween(first.month, last.month).length} months)` : "")
    : "No expenses yet.";
  renderBarChart("dash-trend-chart", {
    labels: months.map((m) => shortMonthLabel(m.month)),
    datasets: CONFIG.farms.map((farm) => ({ label: farm, data: months.map((m) => m.byFarm[farm]), color: farmColor(farm) })),
    stacked: true
  });
}

/** The optional cash book figures for the same period (all entries, not only expenses). */
function cashHtml(range) {
  const known = filterEntries(state.expenses, range, state.headMap).filter((x) => CONFIG.farms.includes(x.farm));
  const sums = sumEntries(known, state.headMap);
  return cardHtml("Cash book for this period", [
    { label: "Cash received (Inflow)", value: formatMoney(sums.inflow), className: "type-inflow" },
    { label: "Expenses (Outflow)", value: formatMoney(sums.outflow), className: "type-outflow" },
    { label: "Balance (received - spent)", value: formatMoney(sums.net) }
  ], { extraClass: "flat" }) +
    `<p class="muted small">A negative balance only means less cash received has been recorded than spent. ` +
    `Expenses are valid even when no cash received is entered.</p>`;
}

function renderDashboard() {
  const range = period.range();
  const a = analysis(range);
  $("dash-range-label").textContent = `Showing ${rangeLabel(range.from, range.to)}`;
  $("dash-kpis").innerHTML = kpisHtml(a, range);
  $("dash-farms").innerHTML = barListHtml(
    a.farms.map((f) => ({ name: f.farm, total: f.total, share: f.share, color: farmColor(f.farm) })),
    "No expenses in this period."
  );
  $("dash-heads").innerHTML = barListHtml(
    a.heads.map((h) => ({ name: h.name + (h.active ? "" : " (inactive)"), total: h.total, share: h.share })),
    "No expenses in this period. Choose another period above."
  );
  renderBarChart("dash-farm-chart", {
    labels: a.farms.map((f) => f.farm),
    datasets: [{ label: "Expenses", data: a.farms.map((f) => f.total), color: a.farms.map((f) => farmColor(f.farm)) }]
  });
  renderTrend(range, a);
  $("dash-cash").innerHTML = cashHtml(range);
}

export function initDashboard() {
  period = bindPeriodFilter({
    control: $("dash-period"),
    fromInput: $("dash-from"),
    toInput: $("dash-to"),
    initial: "this-year",
    onChange: renderDashboard,
    onPeriodShown: (p) => setHidden($("dash-custom"), p !== "custom")
  });
  // Chart.js loads with "defer"; draw the charts once it is ready
  window.addEventListener("load", () => { if (getCurrentPage() === "dashboard") renderDashboard(); });
  registerPage("dashboard", { render: renderDashboard });
}

