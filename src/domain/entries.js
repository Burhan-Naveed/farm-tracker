// =========================================================
// Entries (daily inflow / outflow records): validation,
// filtering and totals. Pure functions.
// =========================================================

import { CONFIG, LIMITS } from "../config.js";
import { addMoney, isValidDateString } from "../lib/format.js";
import { headTypeOf } from "./heads.js";

/**
 * Checks the Add / Edit Entry form.
 * input: { date, farm, headId, amount (text), paidBy, note }
 * allowedInactiveHeadId: while editing, the entry's own head may be inactive.
 * Returns { ok: true, value } (ready to save) or { ok: false, error }.
 */
export function validateEntry(input, { heads, allowedInactiveHeadId = null }) {
  const date = String(input.date ?? "");
  const farm = input.farm;
  const amountText = String(input.amount ?? "").trim();
  const paidBy = input.paidBy;
  const note = String(input.note ?? "").trim();
  const head = heads.find((h) => h.id === input.headId);

  if (!isValidDateString(date)) return { ok: false, error: "Please select a valid date." };
  if (!CONFIG.farms.includes(farm)) return { ok: false, error: "Please select a farm." };
  if (!head || (!head.active && head.id !== allowedInactiveHeadId)) return { ok: false, error: "Please select a head." };
  if (!/^\d+(\.\d+)?$/.test(amountText)) return { ok: false, error: "Please enter the amount as a number, for example 15000." };
  const amount = Math.round(Number(amountText));   // whole rupees only
  if (amount < 1) return { ok: false, error: "Amount must be at least 1 rupee." };
  if (amount > LIMITS.maxAmount) return { ok: false, error: "Amount is too large. Please check it." };
  if (!CONFIG.paidByOptions.includes(paidBy)) return { ok: false, error: "Please select Paid By." };
  if (note.length > LIMITS.noteMax) return { ok: false, error: `Note can be at most ${LIMITS.noteMax} characters.` };

  return { ok: true, value: { date, farm, headId: head.id, headName: head.name, type: head.type, amount, paidBy, note } };
}

/** Sort order used everywhere for lists: newest date first, then newest created first. */
export function compareNewestFirst(a, b) {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1;
  return b.createdMs - a.createdMs;
}

/** Sort order for reports: oldest date first, then oldest created first. */
export function compareOldestFirst(a, b) {
  return a.date.localeCompare(b.date) || a.createdMs - b.createdMs;
}

/**
 * Applies the Entries page filters. Empty filter values mean "any".
 * filters: { farm, headId, type, from, to, search }
 */
export function filterEntries(entries, filters, headMap) {
  const search = String(filters.search || "").trim().toLowerCase();
  return entries.filter((x) =>
    (!filters.farm || x.farm === filters.farm) &&
    (!filters.headId || x.headId === filters.headId) &&
    (!filters.type || headTypeOf(x, headMap) === filters.type) &&
    (!filters.from || x.date >= filters.from) &&
    (!filters.to || x.date <= filters.to) &&
    (!search || String(x.note || "").toLowerCase().includes(search))
  );
}

/** Totals of a list of entries: { inflow, outflow, net, count }. */
export function sumEntries(entries, headMap) {
  let inflow = 0;
  let outflow = 0;
  entries.forEach((x) => {
    if (headTypeOf(x, headMap) === "Inflow") inflow = addMoney(inflow, x.amount);
    else outflow = addMoney(outflow, x.amount);
  });
  return { inflow, outflow, net: addMoney(inflow, -outflow), count: entries.length };
}
