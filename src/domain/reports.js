// =========================================================
// Report calculations (Total, Farm-wise and Head-wise).
// Pure functions: entries and heads in, numbers out.
// =========================================================

import { CONFIG, TYPES } from "../config.js";
import { addMoney } from "../lib/format.js";
import { compareOldestFirst, sumEntries } from "./entries.js";
import { headNameOf, headTypeOf, sortedHeads } from "./heads.js";

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

/**
 * Farm-wise report: one farm for a date range ({ from, to }).
 * Returns totals, head-wise totals (only heads used, biggest first)
 * and the list of transactions, oldest first.
 */
export function buildFarmReport(entries, headMap, range, farm) {
  const farmEntries = entries
    .filter((x) => x.farm === farm && inRange(x, range))
    .sort(compareOldestFirst);

  const headRows = new Map();
  farmEntries.forEach((x) => {
    if (!headRows.has(x.headId)) {
      headRows.set(x.headId, { name: headNameOf(x, headMap), type: headTypeOf(x, headMap), total: 0, count: 0 });
    }
    const row = headRows.get(x.headId);
    row.total = addMoney(row.total, x.amount);
    row.count++;
  });

  const sums = sumEntries(farmEntries, headMap);
  return {
    entries: farmEntries,
    heads: [...headRows.values()].sort((a, b) => b.total - a.total),
    totals: { Inflow: sums.inflow, Outflow: sums.outflow },
    net: sums.net,
    inflowCount: farmEntries.filter((x) => headTypeOf(x, headMap) === "Inflow").length,
    slipCount: farmEntries.filter((x) => x.hasAttachment).length
  };
}

/** Puts From / To in the right order if they were entered the wrong way round. */
export function orderedRange(from, to) {
  return from && to && from > to ? { from: to, to: from } : { from, to };
}

/**
 * Head-wise report: one head, all farms ("") or one farm, any date range.
 * Returns the total, per farm, per month (oldest first) and every transaction.
 */
export function buildHeadReport(entries, { headId, farm, from, to }) {
  const headEntries = entries
    .filter((x) => x.headId === headId && (!farm || x.farm === farm) && inRange(x, { from, to }))
    .sort(compareOldestFirst);

  const byFarm = zeroByFarm();
  const byMonth = new Map();
  let total = 0;
  let largest = 0;
  headEntries.forEach((x) => {
    total = addMoney(total, x.amount);
    largest = Math.max(largest, Number(x.amount));
    if (isKnownFarm(x.farm)) byFarm[x.farm] = addMoney(byFarm[x.farm], x.amount);
    const month = x.date.slice(0, 7);
    byMonth.set(month, addMoney(byMonth.get(month) || 0, x.amount));
  });

  return {
    entries: headEntries,
    total,
    byFarm,
    byMonth,
    largest,
    average: headEntries.length ? total / headEntries.length : 0,
    slipCount: headEntries.filter((x) => x.hasAttachment).length
  };
}
