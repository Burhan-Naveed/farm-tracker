// =========================================================
// Report calculations. Pure functions: entries and heads in,
// numbers out.
// - buildExpenseAnalysis: the ONE calculation behind the Dashboard,
//   every expense report and its export (so figures always match)
// - buildTotalReport: the cash book (Inflow / Outflow / Net)
// =========================================================

import { CONFIG, TYPES } from "../config.js";
import { addMoney, percentOf } from "../lib/format.js";
import { compareNewestFirst, filterEntries, paidByLabel } from "./entries.js";
import { headNameOf, headTypeOf, sortedHeads } from "./heads.js";
import { monthsBetween } from "./periods.js";

/** Makes an object like { "Fatehpur Farm": 0, ... } */
export const zeroByFarm = () => Object.fromEntries(CONFIG.farms.map((f) => [f, 0]));

const isKnownFarm = (farm) => CONFIG.farms.includes(farm);

/** True when the entry's date is inside the range (empty from / to = open ended). */
const inRange = (entry, { from, to }) =>
  typeof entry.date === "string" && (!from || entry.date >= from) && (!to || entry.date <= to);

/**
 * Total Report: all farms for a date range ({ from, to }, "YYYY-MM-DD").
 * Rows = heads (active heads always, inactive heads only if they have entries),
 * with Inflow / Outflow subtotals and Net, per farm and in total.
 */
export function buildTotalReport(entries, heads, headMap, range) {
  const rangeEntries = entries.filter((x) => inRange(x, range) && isKnownFarm(x.farm));
  const rowMap = new Map();

  // Start with every active head so the table always shows the full list
  heads.filter((h) => h.active).forEach((h) => {
    rowMap.set(h.id, { id: h.id, name: h.name, type: h.type, active: true, byFarm: zeroByFarm(), total: 0 });
  });

  const totals = Object.fromEntries(TYPES.map((t) => [t, { byFarm: zeroByFarm(), total: 0 }]));

  rangeEntries.forEach((x) => {
    const type = headTypeOf(x, headMap);
    if (!rowMap.has(x.headId)) {
      const head = headMap.get(x.headId);
      rowMap.set(x.headId, {
        id: x.headId, name: headNameOf(x, headMap), type,
        active: head ? head.active : false, byFarm: zeroByFarm(), total: 0
      });
    }
    const row = rowMap.get(x.headId);
    row.byFarm[x.farm] = addMoney(row.byFarm[x.farm], x.amount);
    row.total = addMoney(row.total, x.amount);
    totals[type].byFarm[x.farm] = addMoney(totals[type].byFarm[x.farm], x.amount);
    totals[type].total = addMoney(totals[type].total, x.amount);
  });

  const net = { byFarm: zeroByFarm(), total: addMoney(totals.Inflow.total, -totals.Outflow.total) };
  CONFIG.farms.forEach((f) => { net.byFarm[f] = addMoney(totals.Inflow.byFarm[f], -totals.Outflow.byFarm[f]); });

  return { rows: sortedHeads([...rowMap.values()]), totals, net, count: rangeEntries.length };
}

/** Puts From / To in the right order if they were entered the wrong way round. */
export function orderedRange(from, to) {
  return from && to && from > to ? { from: to, to: from } : { from, to };
}


/** Longest month list filled with empty months (20 years). */
const MAX_MONTHS = 240;

/** Biggest amount first; equal amounts by name, so the order never jumps around. */
const byAmountThenName = (a, b) => b.total - a.total || String(a.name).localeCompare(String(b.name));

/** Adds one expense to a group row ({ byFarm, total, count }). */
function addTo(row, x) {
  row.byFarm[x.farm] = addMoney(row.byFarm[x.farm], x.amount);
  row.total = addMoney(row.total, x.amount);
  row.count++;
}

/**
 * Expense analysis for a set of filters ({ from, to, farm, headId, paidBy, search }, empty = any).
 * Only expenses count (heads of type Outflow); cash received is left out.
 * Every expense is counted exactly once in each grouping, so
 * total = sum of farms = sum of heads = sum of payers = sum of months.
 *
 * Returns:
 *  entries      the matching expenses, newest first
 *  total, count
 *  farms        [{ farm, total, count, share }] in the usual farm order
 *  heads        [{ id, name, active, byFarm, total, count, share }] biggest first
 *  payers       [{ value, name, byFarm, total, count, share }] biggest first
 *  months       [{ month, byFarm, byHead (Map id -> amount), total, count, change, changePercent }] oldest first
 *  highestFarm, highestHead: the biggest row, or null when there are no expenses
 */
export function buildExpenseAnalysis(entries, headMap, filters = {}) {
  const expenses = filterEntries(entries, { ...filters, type: "Outflow" }, headMap)
    .filter((x) => isKnownFarm(x.farm) && inRange(x, filters))
    .sort(compareNewestFirst);

  const farmRows = new Map(CONFIG.farms.map((farm) => [farm, { farm, byFarm: zeroByFarm(), total: 0, count: 0 }]));
  const headRows = new Map();
  const payerRows = new Map();
  const monthRows = new Map();
  let total = 0;

  expenses.forEach((x) => {
    total = addMoney(total, x.amount);
    addTo(farmRows.get(x.farm), x);

    if (!headRows.has(x.headId)) {
      const head = headMap.get(x.headId);
      headRows.set(x.headId, { id: x.headId, name: headNameOf(x, headMap), active: head ? head.active : false, byFarm: zeroByFarm(), total: 0, count: 0 });
    }
    addTo(headRows.get(x.headId), x);

    if (!payerRows.has(x.paidBy)) payerRows.set(x.paidBy, { value: x.paidBy, name: paidByLabel(x.paidBy), byFarm: zeroByFarm(), total: 0, count: 0 });
    addTo(payerRows.get(x.paidBy), x);

    const month = x.date.slice(0, 7);
    if (!monthRows.has(month)) monthRows.set(month, { month, byFarm: zeroByFarm(), byHead: new Map(), total: 0, count: 0 });
    const monthRow = monthRows.get(month);
    addTo(monthRow, x);
    monthRow.byHead.set(x.headId, addMoney(monthRow.byHead.get(x.headId) || 0, x.amount));
  });

  const withShare = (row) => ({ ...row, share: percentOf(row.total, total) });
  const farms = [...farmRows.values()].map(({ byFarm, ...row }) => withShare(row));
  const heads = [...headRows.values()].sort(byAmountThenName).map(withShare);
  const payers = [...payerRows.values()].sort(byAmountThenName).map(withShare);
  const months = monthList(monthRows, filters);
  const highest = (rows) => (total > 0 ? rows.reduce((best, r) => (r.total > best.total ? r : best)) : null);

  return {
    entries: expenses,
    total,
    count: expenses.length,
    farms,
    heads,
    payers,
    months,
    highestFarm: highest(farms),
    highestHead: heads.length ? heads[0] : null
  };
}

/**
 * Month rows from the first to the last month (the From / To dates when given,
 * otherwise the first and last expense), with empty months filled in, plus
 * the change from the month before.
 */
function monthList(monthRows, { from, to }) {
  const dataMonths = [...monthRows.keys()].sort();
  let first = from ? from.slice(0, 7) : dataMonths[0];
  let last = to ? to.slice(0, 7) : dataMonths[dataMonths.length - 1];
  if (!first || !last) return [];
  // A very long range (e.g. a mistyped year 0001) would list thousands of empty
  // months: then only the months that have expenses (and the gaps between them) are listed
  if (monthsBetween(first, last).length > MAX_MONTHS) {
    if (!dataMonths.length) return [];
    first = dataMonths[0];
    last = dataMonths[dataMonths.length - 1];
  }

  let previous = null;
  return monthsBetween(first, last).map((month) => {
    const row = monthRows.get(month) || { month, byFarm: zeroByFarm(), byHead: new Map(), total: 0, count: 0 };
    const change = previous === null ? null : addMoney(row.total, -previous);
    const changePercent = previous ? Math.round((change / previous) * 100) : null;
    previous = row.total;
    return { ...row, change, changePercent };
  });
}
