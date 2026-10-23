// =========================================================
// All Firestore reads and writes live here, so the rest of the
// app never talks to the database directly.
//
// Writes return the commit promise but callers do not wait for it:
// Firestore saves locally at once and syncs to the server in the
// background (offline writes only finish when internet returns).
// =========================================================

import {
  collection, doc, setDoc, updateDoc, deleteDoc, addDoc, getDoc, getDocs, getDocsFromServer, onSnapshot,
  query, where, orderBy, limit, writeBatch, serverTimestamp,
  waitForPendingWrites, terminate, clearIndexedDbPersistence
} from "https://www.gstatic.com/firebasejs/13.0.0/firebase-firestore.js";
import { db } from "../firebase.js";
import { LIMITS } from "../config.js";
import { defaultHeadRecords } from "../domain/heads.js";
import { logError } from "../lib/errors.js";

const BATCH_LIMIT = 450;   // Firestore allows 500 writes per batch; keep a safety margin

// ---------------------------------------------------------
// Offline copy on this device
// ---------------------------------------------------------

/**
 * True when some changes are still waiting to be sent to the server
 * (checked for up to waitMs; offline they never finish).
 */
export function hasUnsyncedChanges(waitMs = 2000) {
  const timeout = new Promise((resolve) => setTimeout(() => resolve(true), waitMs));
  return Promise.race([waitForPendingWrites(db).then(() => false), timeout]);
}

/**
 * Deletes the offline copy of the data from this device (on logout or
 * when access is removed). The database cannot be used afterwards,
 * so the page must be reloaded before logging in again.
 */
export async function wipeLocalData() {
  await terminate(db);
  await clearIndexedDbPersistence(db);
}

// ---------------------------------------------------------
// Live listeners. Each returns an "unsubscribe" function.
// ---------------------------------------------------------

/** Watches one user's record in "users" (decides access and role). */
export function watchProfile(uid, onChange, onError) {
  return onSnapshot(doc(db, "users", uid), (snap) => onChange(snap.exists() ? snap.data() : null), onError);
}

/**
 * Watches all heads. onChange(heads, { fromServer }):
 * fromServer is true when the list came from the server (not only the
 * offline cache), the only safe moment to decide that there are no heads.
 */
export function watchHeads(onChange, onError) {
  return onSnapshot(collection(db, "heads"), { includeMetadataChanges: true }, (snap) => {
    const fromServer = !snap.metadata.fromCache;
    // Skip metadata-only updates, except the first one confirmed by the server
    if (snap.docChanges().length === 0 && !fromServer) return;
    onChange(snap.docs.map((d) => ({ id: d.id, ...d.data() })), { fromServer });
  }, onError);
}

/**
 * Watches all entries (newest first). Each entry gets createdMs (for stable sorting)
 * and updatedMs (when it was last added or edited; 0 when unknown).
 */
export function watchExpenses(onChange, onError) {
  const q = query(collection(db, "expenses"), orderBy("date", "desc"));
  return onSnapshot(q, (snap) => {
    onChange(snap.docs.map((d) => {
      const data = d.data({ serverTimestamps: "estimate" });
      const createdMs = data.createdAt ? data.createdAt.toMillis() : 0;
      return { id: d.id, ...data, createdMs, updatedMs: data.updatedAt ? data.updatedAt.toMillis() : createdMs };
    }));
  }, onError);
}

/** Watches all user records (Admin only; the rules block this for Staff). */
export function watchUsers(onChange, onError) {
  return onSnapshot(collection(db, "users"), (snap) => {
    onChange(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  }, onError);
}

// ---------------------------------------------------------
// Audit log (best effort: a failed log never blocks the action)
// ---------------------------------------------------------

/** Records an Admin change: who did what, when. */
export function logAudit(actor, action, details) {
  addDoc(collection(db, "auditLog"), {
    action,
    details: String(details).slice(0, LIMITS.auditDetailsMax),
    byUid: actor.uid,
    byEmail: actor.email || "",
    at: serverTimestamp()
  }).catch((err) => logError("Audit log not saved", err));
}

// ---------------------------------------------------------
// Entries and their attachments
// ---------------------------------------------------------

/** The Firestore document for an attachment (same id as its entry). */
function attachmentRecord(expenseId, file, actor) {
  return {
    expenseId,
    data: file.data,
    name: file.name,
    type: file.type,
    size: file.size,
    createdBy: actor.uid,
    createdAt: serverTimestamp()
  };
}

/**
 * Saves a new entry, and its attachment in the same batch (both succeed or both fail).
 * Returns the commit promise.
 */
export function createEntry(entry, file, actor) {
  const batch = writeBatch(db);
  const ref = doc(collection(db, "expenses"));
  batch.set(ref, {
    ...entry,
    hasAttachment: !!file,
    attachmentName: file ? file.name : "",
    attachmentType: file ? file.type : "",
    createdBy: actor.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
  if (file) batch.set(doc(db, "attachments", ref.id), attachmentRecord(ref.id, file, actor));
  return batch.commit();
}

/**
 * Updates an entry. attachment: { file } to add or replace the slip,
 * { remove: true } to delete it, or {} to leave it as it is.
 */
export function updateEntry(id, entry, attachment, actor) {
  const batch = writeBatch(db);
  const changes = { ...entry, updatedAt: serverTimestamp() };
  if (attachment.file) {
    batch.set(doc(db, "attachments", id), attachmentRecord(id, attachment.file, actor));
    Object.assign(changes, { hasAttachment: true, attachmentName: attachment.file.name, attachmentType: attachment.file.type });
  } else if (attachment.remove) {
    batch.delete(doc(db, "attachments", id));
    Object.assign(changes, { hasAttachment: false, attachmentName: "", attachmentType: "" });
  }
  batch.update(doc(db, "expenses", id), changes);
  return batch.commit();
}

/** Deletes an entry and its attachment together. */
export function deleteEntry(entry) {
  const batch = writeBatch(db);
  batch.delete(doc(db, "expenses", entry.id));
  if (entry.hasAttachment) batch.delete(doc(db, "attachments", entry.id));
  return batch.commit();
}

/** Downloads one attachment. Returns its data, or null if it does not exist. */
export async function fetchAttachment(expenseId) {
  const snap = await getDoc(doc(db, "attachments", expenseId));
  return snap.exists() ? snap.data() : null;
}

// ---------------------------------------------------------
// Heads
// ---------------------------------------------------------

/** Creates the default heads with fixed IDs, so two devices can never create duplicates. */
export function seedDefaultHeads(actor) {
  const batch = writeBatch(db);
  defaultHeadRecords().forEach((h) => {
    batch.set(doc(db, "heads", h.id), {
      name: h.name, type: h.type, active: true, isDefault: true, createdBy: actor.uid, createdAt: serverTimestamp()
    });
  });
  return batch.commit();
}

export function createHead({ name, type }, actor) {
  return setDoc(doc(collection(db, "heads")), {
    name, type, active: true, isDefault: false, createdBy: actor.uid, createdAt: serverTimestamp()
  });
}

export function setHeadActive(headId, active) {
  return updateDoc(doc(db, "heads", headId), { active });
}

export function deleteHead(headId) {
  return deleteDoc(doc(db, "heads", headId));
}

/** True when at least one entry uses this head (checked on the server when online). */
export async function headHasEntries(headId) {
  const snap = await getDocs(query(collection(db, "expenses"), where("headId", "==", headId), limit(1)));
  return !snap.empty;
}

/**
 * Renames a head or changes its type, and copies the new name/type into
 * all its entries (so old entries and exports show the new name).
 * Returns { entryCount, done } where done is the promise of all commits.
 */
export async function updateHeadAndEntries(headId, { name, type }) {
  const snap = await getDocs(query(collection(db, "expenses"), where("headId", "==", headId)));
  const writes = [
    (batch) => batch.update(doc(db, "heads", headId), { name, type }),
    ...snap.docs.map((d) => (batch) => batch.update(d.ref, { headName: name, type }))
  ];
  return { entryCount: snap.size, done: commitInBatches(writes) };
}

/** Runs a list of batch writes, split into batches of at most BATCH_LIMIT, in order. */
function commitInBatches(writes) {
  const commits = [];
  for (let start = 0; start < writes.length; start += BATCH_LIMIT) {
    const batch = writeBatch(db);
    writes.slice(start, start + BATCH_LIMIT).forEach((write) => write(batch));
    commits.push(batch.commit());
  }
  return Promise.all(commits);
}

// ---------------------------------------------------------
// Backup and restore
// ---------------------------------------------------------

/** Reads whole collections from the server (not the offline copy): { name: [{ id, ...fields }] }. */
export async function fetchCollections(names) {
  const entries = await Promise.all(names.map(async (name) => {
    const snap = await getDocsFromServer(collection(db, name));
    return [name, snap.docs.map((d) => ({ id: d.id, ...d.data() }))];
  }));
  return Object.fromEntries(entries);
}

/** The newest audit-log record of an action (e.g. the last backup), or null. */
export async function latestAuditRecord(action) {
  const snap = await getDocs(query(collection(db, "auditLog"), where("action", "==", action), orderBy("at", "desc"), limit(1)));
  return snap.empty ? null : snap.docs[0].data();
}

/**
 * Adds missing heads back. Heads are always created active (the rules require it),
 * then the ones that were inactive are switched off.
 */
export async function restoreHeads(heads, actor) {
  await commitInBatches(heads.map((h) => (batch) => batch.set(doc(db, "heads", h.id), {
    name: h.name, type: h.type, active: true, isDefault: h.isDefault, createdBy: actor.uid, createdAt: serverTimestamp()
  })));
  const inactive = heads.filter((h) => !h.active);
  await commitInBatches(inactive.map((h) => (batch) => batch.update(doc(db, "heads", h.id), { active: false })));
}

/**
 * Adds missing entries back with their original ids. Entries are grouped
 * by head, so each batch checks only a few documents in the security rules.
 */
export async function restoreEntries(entries, actor) {
  const byHead = new Map();
  entries.forEach((x) => byHead.set(x.headId, [...(byHead.get(x.headId) || []), x]));
  for (const group of byHead.values()) {
    await commitInBatches(group.map(({ id, ...fields }) => (batch) => batch.set(doc(db, "expenses", id), {
      ...fields, createdBy: actor.uid, createdAt: serverTimestamp(), updatedAt: serverTimestamp()
    })));
  }
}

// ---------------------------------------------------------
// Users (the document ID must be the user's Auth UID)
// ---------------------------------------------------------

export function createUser({ uid, name, email, role }) {
  return setDoc(doc(db, "users", uid), { name, email, role, status: "active", createdAt: serverTimestamp() });
}

export function setUserRole(uid, role) {
  return updateDoc(doc(db, "users", uid), { role });
}

export function setUserStatus(uid, status) {
  return updateDoc(doc(db, "users", uid), { status });
}
