// =========================================================
// Backup file format and restore planning. Pure functions.
//
// A backup is one JSON file with every collection except the
// attachment files (slips). Restore only adds records that are
// missing; it never changes or deletes existing data.
// =========================================================

import { CONFIG, LIMITS, TYPES } from "../config.js";
import { isValidDateString } from "../lib/format.js";

export const BACKUP_APP = "farm-tracker";
export const BACKUP_VERSION = 1;
export const BACKUP_COLLECTIONS = ["heads", "expenses", "users", "auditLog"];

/** Firestore Timestamps (and Dates) become ISO text, so the file is plain JSON. */
function toPlain(value) {
  if (value && typeof value.toDate === "function") return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(toPlain);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, toPlain(v)]));
  return value;
}

/**
 * Builds the backup object. collections: { heads: [{ id, ...fields }], ... }.
 * The temporary "createdMs" field the app adds to entries is left out.
 */
export function buildBackup(collections, { createdAt, createdBy }) {
  const data = Object.fromEntries(BACKUP_COLLECTIONS.map((name) => [
    name,
    (collections[name] || []).map(({ createdMs, ...doc }) => toPlain(doc))
  ]));
  const counts = Object.fromEntries(BACKUP_COLLECTIONS.map((name) => [name, data[name].length]));
  return { app: BACKUP_APP, version: BACKUP_VERSION, createdAt: createdAt.toISOString(), createdBy, counts, data };
}

const isText = (v, max) => typeof v === "string" && v.length <= max;
const isId = (v) => typeof v === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(v);

/** A head from a backup that can be restored as it is. */
function isRestorableHead(h) {
  return isId(h.id) && isText(h.name, LIMITS.headNameMax) && h.name.trim() !== "" &&
    TYPES.includes(h.type) && typeof h.active === "boolean";
}

/** An entry from a backup that passes the same checks as the security rules. */
function isRestorableEntry(x) {
  return isId(x.id) && isValidDateString(x.date) && CONFIG.farms.includes(x.farm) && isId(x.headId) &&
    isText(x.headName, LIMITS.headNameMax) && TYPES.includes(x.type) &&
    typeof x.amount === "number" && x.amount > 0 && x.amount <= LIMITS.maxAmount &&
    CONFIG.paidByOptions.includes(x.paidBy) && isText(x.note ?? "", LIMITS.noteMax);
}

/**
 * Reads and checks a backup file's text.
 * Returns { ok: true, backup } or { ok: false, error }.
 */
export function parseBackup(text) {
  let backup;
  try {
    backup = JSON.parse(text);
  } catch {
    return { ok: false, error: "This file is not a Farm Tracker backup (it could not be read)." };
  }
  if (!backup || backup.app !== BACKUP_APP || !backup.data) {
    return { ok: false, error: "This file is not a Farm Tracker backup." };
  }
  if (backup.version !== BACKUP_VERSION) {
    return { ok: false, error: "This backup was made by a different app version and cannot be restored." };
  }
  if (!Array.isArray(backup.data.heads) || !Array.isArray(backup.data.expenses)) {
    return { ok: false, error: "This backup is damaged (heads or entries are missing)." };
  }
  return { ok: true, backup };
}

/**
 * Works out what a restore would add: heads and entries whose ids no longer
 * exist. Entries whose head is missing (and not in the backup) or that are
 * damaged are skipped and counted. Users and the audit log are not restored
 * (users are added again on the Users page).
 * existing: { headIds: Set, entryIds: Set }
 */
export function planRestore(backup, existing) {
  const heads = backup.data.heads.filter(isRestorableHead);
  const headIdsAfter = new Set([...existing.headIds, ...heads.map((h) => h.id)]);
  const missingHeads = heads.filter((h) => !existing.headIds.has(h.id));

  const missingEntries = [];
  let skipped = backup.data.heads.length - heads.length;
  backup.data.expenses.forEach((x) => {
    if (existing.entryIds.has(x.id)) return;
    if (isRestorableEntry(x) && headIdsAfter.has(x.headId)) missingEntries.push(x);
    else skipped++;
  });

  return { heads: missingHeads, entries: missingEntries, skipped };
}

/** The fields of a head to write back (who/when become the restoring Admin and now). */
export const restoredHead = (h) => ({ name: h.name.trim(), type: h.type, active: h.active, isDefault: h.isDefault === true });

/** The fields of an entry to write back. Slips are not in the backup, so the entry is saved without one. */
export const restoredEntry = (x) => ({
  date: x.date, farm: x.farm, headId: x.headId, headName: x.headName, type: x.type,
  amount: x.amount, paidBy: x.paidBy, note: x.note ?? "",
  hasAttachment: false, attachmentName: "", attachmentType: ""
});

/** Short text like "12 entries, 2 heads, 0 skipped" for messages. */
export function restoreSummary(plan) {
  return `${plan.entries.length} entries, ${plan.heads.length} heads` + (plan.skipped ? `, ${plan.skipped} skipped (damaged)` : "");
}
