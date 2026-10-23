// =========================================================
// Heads (account categories): sorting, lookups and validation.
// Pure functions: they take data in and return results.
// =========================================================

import { CONFIG, LIMITS, TYPES } from "../config.js";
import { cleanText, normalizeName } from "../lib/format.js";

/**
 * Key for "same meaning" checks: case, spaces and punctuation are ignored
 * and "&" counts as "and", so "Misc. Expenses" equals "misc expenses".
 */
export function headKey(name) {
  return normalizeName(name).replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "");
}

/** Returns heads sorted: Inflow first, then Outflow, each alphabetical. */
export function sortedHeads(heads) {
  return [...heads].sort((a, b) =>
    a.type === b.type ? a.name.localeCompare(b.name) : (a.type === "Inflow" ? -1 : 1)
  );
}

/** Builds a Map of head id -> head for fast lookups in reports. */
export const headsById = (heads) => new Map(heads.map((h) => [h.id, h]));

/** The head's current name (falls back to the name saved in the entry). */
export function headNameOf(entry, headMap) {
  const head = headMap.get(entry.headId);
  return head ? head.name : (entry.headName || "Unknown head");
}

/** The head's current type, always "Inflow" or "Outflow" (falls back to the entry's saved type). */
export function headTypeOf(entry, headMap) {
  const head = headMap.get(entry.headId);
  return (head ? head.type : entry.type) === "Inflow" ? "Inflow" : "Outflow";
}

/** Counts how many entries use each head: { headId: count }. */
export function headUsageCounts(entries) {
  const counts = {};
  entries.forEach((x) => { counts[x.headId] = (counts[x.headId] || 0) + 1; });
  return counts;
}

/**
 * Checks the Add / Edit Head form.
 * Returns { ok: true, value: { name, type } } or { ok: false, error }.
 */
export function validateHead(input, { heads, editingId = null }) {
  const name = cleanText(input.name);
  const type = input.type;
  if (!name) return { ok: false, error: "Please enter a head name." };
  if (name.length > LIMITS.headNameMax) return { ok: false, error: `Head name can be at most ${LIMITS.headNameMax} characters.` };
  if (!TYPES.includes(type)) return { ok: false, error: "Please select a type." };
  const duplicate = heads.find((h) => h.id !== editingId && headKey(h.name) === headKey(name));
  if (duplicate) return { ok: false, error: `A head with this name already exists: "${duplicate.name}".` };
  return { ok: true, value: { name, type } };
}

/** The default heads with fixed IDs ("default-01"...), so two devices can never create duplicates. */
export function defaultHeadRecords() {
  return CONFIG.defaultHeads.map((h, i) => ({ id: "default-" + String(i + 1).padStart(2, "0"), name: h.name, type: h.type }));
}

/**
 * Head renames from CONFIG.headRenames that are still to be done.
 * Returns [{ head, to, conflict }]: conflict is the head that already has the
 * new name (then the rename is not offered, so no duplicate is created).
 */
export function pendingHeadRenames(heads, renames = CONFIG.headRenames) {
  const result = [];
  renames.forEach(({ from, to }) => {
    const conflict = heads.find((h) => headKey(h.name) === headKey(to)) || null;
    heads.filter((h) => headKey(h.name) === headKey(from)).forEach((head) => result.push({ head, to, conflict }));
  });
  return result;
}
