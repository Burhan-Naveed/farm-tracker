// =========================================================
// Entries (daily expense / cash received records): validation,
// filtering, sorting and totals. Pure functions.
// =========================================================

import { CONFIG, LIMITS, PAID_BY_VALUES } from "../config.js";
import { addMoney, isValidDateString } from "../lib/format.js";
import { headNameOf, headTypeOf } from "./heads.js";

/** The name shown for a Paid By value, e.g. "BM" -> "Amjad Ali". Unknown values are shown as saved. */
export function paidByLabel(value) {
  const option = CONFIG.paidBy.find((p) => p.value === value);
  return option ? option.label : String(value ?? "");
}

/** A failed check: the message and the form field it belongs to. */
const fail = (field, error) => ({ ok: false, field, error });

/**
 * Checks the Add / Edit Entry form.
 * input: { date, farm, headId, amount (text), paidBy, note }
 * allowedInactiveHeadId: while editing, the entry's own head may be inactive.
 * Returns { ok: true, value } (ready to save) or { ok: false, field, error }.
 */
export function validateEntry(input, { heads, allowedInactiveHeadId = null }) {
  const date = String(input.date ?? "");
  const farm = input.farm;
  const amountText = String(input.amount ?? "").trim().replace(/,/g, "");
  const paidBy = input.paidBy;
  const note = String(input.note ?? "").trim();
  const head = heads.find((h) => h.id === input.headId);

  if (!isValidDateString(date)) return fail("date", "Please select a valid expense date.");
  if (!CONFIG.farms.includes(farm)) return fail("farm", "Please select a farm.");
  if (!head || (!head.active && head.id !== allowedInactiveHeadId)) return fail("headId", "Please select an expense head.");
  if (!amountText) return fail("amount", "Please enter the amount.");
  if (!/^\d+(\.\d+)?$/.test(amountText)) return fail("amount", "Please enter the amount as a number, for example 15000.");
  if (Number(amountText) <= 0) return fail("amount", "Amount must be greater than zero.");
  const amount = Math.round(Number(amountText));   // whole rupees only
  if (amount < 1) return fail("amount", "Amount must be at least PKR 1.");
  if (amount > LIMITS.maxAmount) return fail("amount", "Amount is too large. Please check it.");
  if (!PAID_BY_VALUES.includes(paidBy)) return fail("paidBy", "Please select who paid.");
  if (note.length > LIMITS.noteMax) return fail("note", `Description can be at most ${LIMITS.noteMax} characters.`);

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

/** Sort choices of the Entries page and the Expense Details report. */
export const SORTS = Object.freeze({
  "date-desc": compareNewestFirst,
  "date-asc": compareOldestFirst,
  "amount-desc": (a, b) => b.amount - a.amount || compareNewestFirst(a, b),
  "amount-asc": (a, b) => a.amount - b.amount || compareNewestFirst(a, b)
});

/** A sorted copy of the entries (unknown sort = newest first). */
export const sortEntries = (entries, sort) => [...entries].sort(SORTS[sort] || compareNewestFirst);

/**
 * Applies filters. Empty filter values mean "any".
 * filters: { farm, headId, paidBy, type, from, to, search }
 * search looks in the description (note) and the head name, ignoring case.
 */
export function filterEntries(entries, filters, headMap) {
  const search = String(filters.search || "").trim().toLowerCase();
  return entries.filter((x) =>
    (!filters.farm || x.farm === filters.farm) &&
    (!filters.headId || x.headId === filters.headId) &&
    (!filters.paidBy || x.paidBy === filters.paidBy) &&
    (!filters.type || headTypeOf(x, headMap) === filters.type) &&
    (!filters.from || x.date >= filters.from) &&
    (!filters.to || x.date <= filters.to) &&
    (!search ||
      String(x.note || "").toLowerCase().includes(search) ||
      headNameOf(x, headMap).toLowerCase().includes(search))
  );
}

/** Totals of a list of entries: { inflow, outflow, net, count }. Outflow = expenses. */
export function sumEntries(entries, headMap) {
  let inflow = 0;
  let outflow = 0;
  entries.forEach((x) => {
    if (headTypeOf(x, headMap) === "Inflow") inflow = addMoney(inflow, x.amount);
    else outflow = addMoney(outflow, x.amount);
  });
  return { inflow, outflow, net: addMoney(inflow, -outflow), count: entries.length };
}
