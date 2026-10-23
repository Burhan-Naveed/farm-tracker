// Security rules tests (run inside the Firestore emulator: npm run test:rules).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import { assertFails, assertSucceeds, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import {
  addDoc, collection, deleteDoc, doc, getDoc, getDocs, serverTimestamp, setDoc, updateDoc, writeBatch, Timestamp
} from "firebase/firestore";

const ADMIN = "adminUid000000000000000001";
const ADMIN2 = "adminUid000000000000000002";
const STAFF = "staffUid000000000000000001";
const DISABLED = "disabledUid0000000000000001";
const NO_RECORD = "strangerUid0000000000000001";

let env;

const asUser = (uid) => env.authenticatedContext(uid, { email: uid.toLowerCase() + "@farm.test" }).firestore();
const asGuest = () => env.unauthenticatedContext().firestore();

/** A valid new entry, as the app writes it. */
const newEntry = (uid, changes = {}) => ({
  date: "2026-10-13", farm: "Fatehpur Farm", headId: "diesel", headName: "Diesel", type: "Outflow",
  amount: 15000, paidBy: "BM", note: "Tractor diesel",
  hasAttachment: false, attachmentName: "", attachmentType: "",
  createdBy: uid, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  ...changes
});

/** A valid attachment, as the app writes it. */
const newAttachment = (uid, expenseId, changes = {}) => ({
  expenseId, data: "data:image/jpeg;base64,QUJD", name: "slip.jpg", type: "image/jpeg", size: 3,
  createdBy: uid, createdAt: serverTimestamp(), ...changes
});

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-farm-tracker",
    firestore: { rules: readFileSync(join(import.meta.dirname, "..", "..", "firestore.rules"), "utf8"), host: "127.0.0.1", port: 8080 }
  });
});

afterAll(async () => { await env.cleanup(); });

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    const createdAt = Timestamp.fromDate(new Date("2026-01-01"));
    await setDoc(doc(db, "users", ADMIN), { name: "Admin", email: "admin@farm.test", role: "admin", status: "active", createdAt });
    await setDoc(doc(db, "users", ADMIN2), { name: "Admin 2", email: "admin2@farm.test", role: "admin", status: "active", createdAt });
    await setDoc(doc(db, "users", STAFF), { name: "Staff", email: "staff@farm.test", role: "staff", status: "active", createdAt });
    await setDoc(doc(db, "users", DISABLED), { name: "Gone", email: "gone@farm.test", role: "admin", status: "disabled", createdAt });
    await setDoc(doc(db, "heads", "diesel"), { name: "Diesel", type: "Outflow", active: true, isDefault: false, createdBy: ADMIN, createdAt });
    await setDoc(doc(db, "heads", "sales"), { name: "Sales", type: "Inflow", active: true, isDefault: true, createdBy: ADMIN, createdAt });
    await setDoc(doc(db, "expenses", "e1"), { ...newEntry(ADMIN), createdAt, updatedAt: createdAt });
    await setDoc(doc(db, "attachments", "e1"), { ...newAttachment(ADMIN, "e1"), createdAt });
    await setDoc(doc(db, "auditLog", "a1"), { action: "head-add", details: "x", byUid: ADMIN, byEmail: "admin@farm.test", at: createdAt });
  });
});

describe("who can read", () => {
  it("guests and logins without an active record cannot read anything", async () => {
    for (const db of [asGuest(), asUser(NO_RECORD), asUser(DISABLED)]) {
      await assertFails(getDocs(collection(db, "expenses")));
      await assertFails(getDocs(collection(db, "heads")));
      await assertFails(getDoc(doc(db, "attachments", "e1")));
      await assertFails(getDocs(collection(db, "users")));
    }
  });

  it("every user can read their own record (also when disabled), but nobody else's", async () => {
    await assertSucceeds(getDoc(doc(asUser(DISABLED), "users", DISABLED)));
    await assertSucceeds(getDoc(doc(asUser(NO_RECORD), "users", NO_RECORD)));   // shows "not found"
    await assertSucceeds(getDoc(doc(asUser(STAFF), "users", STAFF)));
    await assertFails(getDoc(doc(asUser(STAFF), "users", ADMIN)));
    await assertFails(getDocs(collection(asUser(STAFF), "users")));
    await assertFails(getDoc(doc(asGuest(), "users", STAFF)));
  });

  it("Staff can read entries, heads and attachments (for reports)", async () => {
    const db = asUser(STAFF);
    await assertSucceeds(getDocs(collection(db, "expenses")));
    await assertSucceeds(getDocs(collection(db, "heads")));
    await assertSucceeds(getDoc(doc(db, "attachments", "e1")));
  });

  it("only Admins can read all users and the audit log", async () => {
    await assertSucceeds(getDocs(collection(asUser(ADMIN), "users")));
    await assertSucceeds(getDocs(collection(asUser(ADMIN), "auditLog")));
    await assertFails(getDocs(collection(asUser(STAFF), "auditLog")));
  });
});

describe("entries", () => {
  it("an Admin can add a valid entry", async () => {
    await assertSucceeds(setDoc(doc(asUser(ADMIN), "expenses", "new"), newEntry(ADMIN)));
  });

  it("Staff, disabled users and guests cannot add, edit or delete entries", async () => {
    for (const [uid, db] of [[STAFF, asUser(STAFF)], [DISABLED, asUser(DISABLED)], [NO_RECORD, asUser(NO_RECORD)]]) {
      await assertFails(setDoc(doc(db, "expenses", "new"), newEntry(uid)));
      await assertFails(updateDoc(doc(db, "expenses", "e1"), { amount: 1 }));
      await assertFails(deleteDoc(doc(db, "expenses", "e1")));
    }
    await assertFails(setDoc(doc(asGuest(), "expenses", "new"), newEntry("x")));
  });

  it.each([
    ["an unknown farm", { farm: "Other Farm" }],
    ["a bad date", { date: "13-10-2026" }],
    ["an impossible month", { date: "2026-13-01" }],
    ["a zero amount", { amount: 0 }],
    ["a negative amount", { amount: -5 }],
    ["an amount over the limit", { amount: 1000000001 }],
    ["an amount as text", { amount: "15000" }],
    ["an unknown Paid By", { paidBy: "Boss" }],
    ["a note over 200 characters", { note: "x".repeat(201) }],
    ["a head that does not exist", { headId: "missing" }],
    ["an unknown type", { type: "Profit" }],
    ["an extra field", { isApproved: true }],
    ["a missing field", { paidBy: undefined }],
    ["someone else as creator", { createdBy: STAFF }],
    ["a made-up created time", { createdAt: Timestamp.fromDate(new Date("2020-01-01")) }],
    ["an attachment type that is not allowed", { attachmentType: "text/html" }]
  ])("rejects an entry with %s", async (_, changes) => {
    const data = newEntry(ADMIN, changes);
    Object.keys(data).forEach((k) => data[k] === undefined && delete data[k]);
    await assertFails(setDoc(doc(asUser(ADMIN), "expenses", "bad"), data));
  });

  it("an Admin can edit an entry but cannot change who created it or when", async () => {
    const db = asUser(ADMIN);
    await assertSucceeds(updateDoc(doc(db, "expenses", "e1"), { amount: 999, note: "fixed", updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(doc(db, "expenses", "e1"), { createdBy: ADMIN2 }));
    await assertFails(updateDoc(doc(db, "expenses", "e1"), { createdAt: serverTimestamp() }));
    await assertFails(updateDoc(doc(db, "expenses", "e1"), { updatedAt: Timestamp.fromDate(new Date("2020-01-01")) }));
    await assertFails(updateDoc(doc(db, "expenses", "e1"), { amount: -1 }));
  });

  it("an Admin can delete an entry", async () => {
    await assertSucceeds(deleteDoc(doc(asUser(ADMIN), "expenses", "e1")));
  });

  it("renaming a head can update many entries in one batch", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      const batch = writeBatch(ctx.firestore());
      for (let i = 0; i < 40; i++) batch.set(doc(ctx.firestore(), "expenses", "bulk" + i), { ...newEntry(ADMIN), createdAt: Timestamp.now(), updatedAt: Timestamp.now() });
      await batch.commit();
    });
    const db = asUser(ADMIN);
    const batch = writeBatch(db);
    batch.update(doc(db, "heads", "diesel"), { name: "Diesel & Oil", type: "Outflow" });
    for (let i = 0; i < 40; i++) batch.update(doc(db, "expenses", "bulk" + i), { headName: "Diesel & Oil", type: "Outflow" });
    await assertSucceeds(batch.commit());
  });
});

describe("attachments", () => {
  it("an Admin can save an entry and its attachment in one batch", async () => {
    const db = asUser(ADMIN);
    const batch = writeBatch(db);
    batch.set(doc(db, "expenses", "withSlip"), newEntry(ADMIN, { hasAttachment: true, attachmentName: "slip.jpg", attachmentType: "image/jpeg" }));
    batch.set(doc(db, "attachments", "withSlip"), newAttachment(ADMIN, "withSlip"));
    await assertSucceeds(batch.commit());
  });

  it("a file at the size limit is accepted", async () => {
    const prefix = "data:application/pdf;base64,";
    const data = prefix + "A".repeat(900000 - prefix.length);
    await assertSucceeds(setDoc(doc(asUser(ADMIN), "attachments", "e1"), newAttachment(ADMIN, "e1", { data, type: "application/pdf", name: "a.pdf" })));
  });

  it.each([
    ["no matching entry", "orphan", {}],
    ["a different entry id inside", "e1", { expenseId: "other" }],
    ["a file over the size limit", "e1", { data: "data:image/jpeg;base64," + "A".repeat(900000) }],
    ["an HTML file", "e1", { data: "data:text/html;base64,PHNjcmlwdD4=", type: "text/html" }],
    ["data that is not base64", "e1", { data: "data:image/jpeg;base64,<script>" }],
    ["an empty name", "e1", { name: "  " }],
    ["someone else as creator", "e1", { createdBy: ADMIN2 }]
  ])("rejects an attachment with %s", async (_, id, changes) => {
    await assertFails(setDoc(doc(asUser(ADMIN), "attachments", id), newAttachment(ADMIN, id, changes)));
  });

  it("Staff cannot add or delete attachments", async () => {
    await assertFails(setDoc(doc(asUser(STAFF), "attachments", "e1"), newAttachment(STAFF, "e1")));
    await assertFails(deleteDoc(doc(asUser(STAFF), "attachments", "e1")));
  });
});

describe("heads", () => {
  const newHead = (uid, changes = {}) => ({ name: "Seeds", type: "Outflow", active: true, isDefault: false, createdBy: uid, createdAt: serverTimestamp(), ...changes });

  it("an Admin can add, rename, deactivate and delete heads", async () => {
    const db = asUser(ADMIN);
    await assertSucceeds(setDoc(doc(db, "heads", "seeds"), newHead(ADMIN)));
    await assertSucceeds(updateDoc(doc(db, "heads", "seeds"), { name: "Seeds & Fertilizer", type: "Outflow" }));
    await assertSucceeds(updateDoc(doc(db, "heads", "seeds"), { active: false }));
    await assertSucceeds(deleteDoc(doc(db, "heads", "seeds")));
  });

  it.each([
    ["an empty name", { name: "   " }],
    ["a name over 50 characters", { name: "x".repeat(51) }],
    ["an unknown type", { type: "Both" }],
    ["active as text", { active: "yes" }],
    ["an extra field", { color: "red" }],
    ["someone else as creator", { createdBy: ADMIN2 }]
  ])("rejects a head with %s", async (_, changes) => {
    await assertFails(setDoc(doc(asUser(ADMIN), "heads", "bad"), newHead(ADMIN, changes)));
  });

  it("an update cannot change who created a head", async () => {
    await assertFails(updateDoc(doc(asUser(ADMIN), "heads", "diesel"), { createdBy: ADMIN2 }));
  });

  it("Staff cannot change heads", async () => {
    await assertFails(setDoc(doc(asUser(STAFF), "heads", "seeds"), newHead(STAFF)));
    await assertFails(updateDoc(doc(asUser(STAFF), "heads", "diesel"), { active: false }));
    await assertFails(deleteDoc(doc(asUser(STAFF), "heads", "diesel")));
  });
});

describe("users", () => {
  const NEW_UID = "newUid00000000000000000001";
  const newUser = (changes = {}) => ({ name: "Ali", email: "ali@farm.test", role: "staff", status: "active", createdAt: serverTimestamp(), ...changes });

  it("an Admin can add a user", async () => {
    await assertSucceeds(setDoc(doc(asUser(ADMIN), "users", NEW_UID), newUser()));
  });

  it.each([
    ["an unknown role", { role: "owner" }],
    ["a disabled status", { status: "disabled" }],
    ["a bad email", { email: "ali-at-farm" }],
    ["an empty name", { name: "" }],
    ["an extra field", { isSuperAdmin: true }]
  ])("rejects a new user with %s", async (_, changes) => {
    await assertFails(setDoc(doc(asUser(ADMIN), "users", NEW_UID), newUser(changes)));
  });

  it("an Admin can change another user's role and status", async () => {
    await assertSucceeds(updateDoc(doc(asUser(ADMIN), "users", STAFF), { role: "admin" }));
    await assertSucceeds(updateDoc(doc(asUser(ADMIN), "users", STAFF), { status: "disabled" }));
  });

  it("an Admin cannot change their own record (no self lock-out)", async () => {
    await assertFails(updateDoc(doc(asUser(ADMIN), "users", ADMIN), { role: "staff" }));
    await assertFails(updateDoc(doc(asUser(ADMIN), "users", ADMIN), { status: "disabled" }));
  });

  it("an Admin cannot change a user's email or name, or set unknown values", async () => {
    await assertFails(updateDoc(doc(asUser(ADMIN), "users", STAFF), { email: "other@farm.test" }));
    await assertFails(updateDoc(doc(asUser(ADMIN), "users", STAFF), { role: "owner" }));
  });

  it("users cannot be deleted (disable them instead)", async () => {
    await assertFails(deleteDoc(doc(asUser(ADMIN), "users", STAFF)));
  });

  it("Staff cannot add users or promote themselves", async () => {
    await assertFails(setDoc(doc(asUser(STAFF), "users", NEW_UID), newUser()));
    await assertFails(updateDoc(doc(asUser(STAFF), "users", STAFF), { role: "admin" }));
  });

  it("a login without a record cannot create its own record", async () => {
    await assertFails(setDoc(doc(asUser(NO_RECORD), "users", NO_RECORD), newUser({ role: "admin" })));
  });
});

describe("audit log", () => {
  const logEntry = (uid, changes = {}) => ({ action: "head-add", details: "Seeds (Outflow)", byUid: uid, byEmail: uid.toLowerCase() + "@farm.test", at: serverTimestamp(), ...changes });

  it("an Admin can add a log entry in their own name", async () => {
    await assertSucceeds(addDoc(collection(asUser(ADMIN), "auditLog"), logEntry(ADMIN)));
  });

  it("log entries cannot be faked, edited or deleted", async () => {
    const db = asUser(ADMIN);
    await assertFails(addDoc(collection(db, "auditLog"), logEntry(ADMIN, { byUid: ADMIN2 })));
    await assertFails(addDoc(collection(db, "auditLog"), logEntry(ADMIN, { byEmail: "someone@else.test" })));
    await assertFails(addDoc(collection(db, "auditLog"), logEntry(ADMIN, { at: Timestamp.fromDate(new Date("2020-01-01")) })));
    await assertFails(addDoc(collection(db, "auditLog"), logEntry(ADMIN, { details: "x".repeat(501) })));
    await assertFails(updateDoc(doc(db, "auditLog", "a1"), { details: "changed" }));
    await assertFails(deleteDoc(doc(db, "auditLog", "a1")));
  });

  it("Staff cannot write to the audit log", async () => {
    await assertFails(addDoc(collection(asUser(STAFF), "auditLog"), logEntry(STAFF)));
  });
});
