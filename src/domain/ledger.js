// =========================================================
// Ledger view of entries: Inflow / Outflow columns with a
// running balance. Pure functions.
// =========================================================

import { addMoney } from "../lib/format.js";
import { compareOldestFirst, filterEntries } from "./entries.js";
import { headTypeOf } from "./heads.js";

/**
 * Builds the ledger for the Entries page.
 * filters: the Entries page filters ({ farm, headId, type, from, to, search }).
 * The opening balance is the net of the entries that match the same
 * filters but are dated before "from" (0 when there is no "from").
 * Returns rows newest first, each { entry, inflow, outflow, balance }
 * (balance = after this entry), plus opening, totals and closing balance.
 */
export function buildLedger(entries, filters, headMap) {
  const shown = filterEntries(entries, filters, headMap);
  const earlier = filters.from
    ? filterEntries(entries, { ...filters, from: "", to: "" }, headMap).filter((x) => x.date < filters.from)
    : [];

  const netOf = (x) => (headTypeOf(x, headMap) === "Inflow" ? Number(x.amount) : -Number(x.amount));
  const opening = earlier.reduce((sum, x) => addMoney(sum, netOf(x)), 0);

  // Work out the balance in date order, then show the newest first
  let balance = opening;
  let inflowTotal = 0;
  let outflowTotal = 0;
  const rows = [...shown].sort(compareOldestFirst).map((entry) => {
    const isInflow = headTypeOf(entry, headMap) === "Inflow";
    const amount = Number(entry.amount);
    balance = addMoney(balance, isInflow ? amount : -amount);
    if (isInflow) inflowTotal = addMoney(inflowTotal, amount);
    else outflowTotal = addMoney(outflowTotal, amount);
    return { entry, inflow: isInflow ? amount : 0, outflow: isInflow ? 0 : amount, balance };
  });

  return {
    rows: rows.reverse(),
    opening,
    hasOpening: !!filters.from,
    totals: { inflow: inflowTotal, outflow: outflowTotal },
    closing: balance
  };
}
