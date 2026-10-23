// Helpers for end-to-end tests: reset the emulators, create logins and
// records directly (bypassing the rules), and log in through the real UI.
import { test as base, expect } from "@playwright/test";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import firebase from "firebase/compat/app";
import "firebase/compat/firestore";

export const PROJECT_ID = "demo-farm-tracker";
const AUTH_URL = "http://127.0.0.1:9099";
const FIRESTORE_HOST = "127.0.0.1";
const FIRESTORE_PORT = 8080;
export const PASSWORD = "Secret#123";

export const APP_URL = "/index.html?emulator";

let testEnv = null;

/** One test environment per worker, used to read and write data with the rules turned off. */
async function getTestEnv() {
  if (!testEnv) {
    testEnv = await initializeTestEnvironment({ projectId: PROJECT_ID, firestore: { host: FIRESTORE_HOST, port: FIRESTORE_PORT } });
  }
  return testEnv;
}

/** Runs fn(db) with full access (compat Firestore API). */
export async function asAdminDb(fn) {
  const env = await getTestEnv();
  let result;
  await env.withSecurityRulesDisabled(async (ctx) => { result = await fn(ctx.firestore()); });
  return result;
}

export const serverTime = () => firebase.firestore.FieldValue.serverTimestamp();

/** Deletes every login and every document. */
export async function resetEmulators() {
  const env = await getTestEnv();
  await env.clearFirestore();
  const res = await fetch(`${AUTH_URL}/emulator/v1/projects/${PROJECT_ID}/accounts`, { method: "DELETE" });
  if (!res.ok) throw new Error("Could not clear the Auth emulator: " + res.status);
}

/** Creates a login in the Auth emulator and returns its UID. */
export async function createLogin(email, password = PASSWORD) {
  const res = await fetch(`${AUTH_URL}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-key`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, returnSecureToken: true })
  });
  const body = await res.json();
  if (!res.ok) throw new Error("Could not create login: " + JSON.stringify(body));
  return body.localId;
}

/** Creates a login plus its "users" record. */
export async function createUser({ email, name, role = "staff", status = "active" }) {
  const uid = await createLogin(email);
  await asAdminDb((db) => db.doc(`users/${uid}`).set({ name, email, role, status, createdAt: serverTime() }));
  return { uid, email, name, role, status };
}

/** The 12 default heads, created the same way the app creates them. */
export async function seedHeads(createdBy) {
  const { CONFIG } = await import("../../src/config.js");
  await asAdminDb(async (db) => {
    const batch = db.batch();
    CONFIG.defaultHeads.forEach((h, i) => {
      batch.set(db.doc(`heads/default-${String(i + 1).padStart(2, "0")}`), {
        name: h.name, type: h.type, active: true, isDefault: true, createdBy, createdAt: serverTime()
      });
    });
    await batch.commit();
  });
}

/** Adds an entry directly (fast setup for report tests). */
export async function seedEntry(fields) {
  return asAdminDb(async (db) => {
    const ref = db.collection("expenses").doc();
    await ref.set({
      paidBy: "BM", note: "", hasAttachment: false, attachmentName: "", attachmentType: "",
      createdBy: "seed", createdAt: serverTime(), updatedAt: serverTime(), ...fields
    });
    return ref.id;
  });
}

/** Reads all documents of a collection. */
export const readAll = (name) => asAdminDb(async (db) => (await db.collection(name).get()).docs.map((d) => ({ id: d.id, ...d.data() })));

/** Opens the app and logs in through the login form. */
export async function login(page, email, password = PASSWORD) {
  await page.goto(APP_URL);
  await page.locator("#login-email").fill(email);
  await page.locator("#login-password").fill(password);
  await page.locator("#login-btn").click();
}

/** Opens a page using the tab bar. */
export async function openTab(page, name) {
  await page.locator(`#tabs button[data-page="${name}"]`).click();
  await expect(page.locator(`#page-${name}`)).toBeVisible();
}

/** Picks a head in a <select> by its visible name. */
export const selectHead = (select, name) => select.selectOption({ label: name });

/** Reads a downloaded CSV file (without the BOM). */
export async function readDownload(download) {
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * Test with a clean database and a logged-in-ready Admin.
 * Fails the test on any uncaught page error or Content-Security-Policy violation.
 */
export const test = base.extend({
  admin: async ({}, use) => {
    await resetEmulators();
    await use(await createUser({ email: "admin@farm.test", name: "Admin User", role: "admin" }));
  },
  page: async ({ page }, use) => {
    const errors = [];
    page.on("pageerror", (err) => errors.push(err.message));
    page.on("console", (msg) => {
      if (msg.type() === "error" && /Content Security Policy|integrity/i.test(msg.text())) errors.push(msg.text());
    });
    page.on("dialog", (dialog) => dialog.accept());
    await use(page);
    expect(errors, "uncaught errors or blocked resources in the page").toEqual([]);
  }
});

export { expect };
