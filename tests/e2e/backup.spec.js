// Backup / restore with Google Drive. Google sign-in and the Drive API are
// replaced by a small fake (in this test), so no real Drive is touched.
import { asAdminDb, expect, login, openTab, readAll, seedEntry, seedHeads, test } from "./support.js";

const BACKUP_ACCOUNT = "farmexpensestracker@gmail.com";
const FOLDER_TYPE = "application/vnd.google-apps.folder";

/** Fake Google Identity Services: grants a token, or fails like a closed popup. */
const fakeGis = (mode) => `
  window.google = { accounts: { oauth2: { initTokenClient(cfg) {
    return { requestAccessToken() {
      setTimeout(() => ${mode === "closed"
        ? `cfg.error_callback({ type: "popup_closed" })`
        : `cfg.callback({ access_token: "fake-token", expires_in: 3600 })`}, 10);
    } };
  } } } };`;

/** An in-memory Google Drive that answers the few calls the app makes. */
function fakeDrive({ account = BACKUP_ACCOUNT } = {}) {
  const files = new Map();   // id -> { id, name, mimeType, parents, modifiedTime, content }
  let next = 1;
  const save = (file) => {
    file.modifiedTime = new Date(Date.now() + next++ * 1000).toISOString();
    files.set(file.id, file);
    return file;
  };
  /** Reads the two parts (details, content) of a multipart upload. */
  const parts = (text) => text.split(/--farm-tracker-[a-z0-9]+/).filter((p) => p.includes("\r\n\r\n"))
    .map((p) => p.slice(p.indexOf("\r\n\r\n") + 4).replace(/\r\n$/, ""));

  return {
    files,
    backupFiles: () => [...files.values()].filter((f) => f.mimeType !== FOLDER_TYPE),
    async handle(route) {
      const request = route.request();
      const url = new URL(request.url());
      const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
      if (request.headers().authorization !== "Bearer fake-token") return json({ error: "no token" }, 401);

      if (url.pathname.endsWith("/about")) return json({ user: { emailAddress: account } });
      if (url.pathname.startsWith("/upload/")) {
        const [meta, content] = parts(request.postData());
        const id = url.pathname.split("/files/")[1];
        const file = id ? files.get(id) : { id: "f" + next, parents: [], ...JSON.parse(meta) };
        file.content = content;
        save(file);
        return json({ id: file.id, name: file.name, modifiedTime: file.modifiedTime });
      }
      const id = url.pathname.split("/files/")[1];
      if (id) {
        const file = files.get(decodeURIComponent(id));
        return file ? route.fulfill({ status: 200, contentType: "application/json", body: file.content }) : json({}, 404);
      }
      if (request.method() === "POST") {
        const file = save({ id: "f" + next, parents: [], ...JSON.parse(request.postData()) });
        return json({ id: file.id });
      }
      const q = url.searchParams.get("q");
      const parent = (q.match(/'([^']+)' in parents/) || [])[1];
      const list = [...files.values()].filter((f) =>
        q.includes(`name = '${f.name}'`) &&
        (q.includes(`mimeType = '${FOLDER_TYPE}'`) ? f.mimeType === FOLDER_TYPE : f.parents.includes(parent)));
      return json({ files: list.map(({ id: fileId, modifiedTime }) => ({ id: fileId, modifiedTime })) });
    }
  };
}

/** Sets up the fakes and opens the Users page as Admin. */
async function openBackupCard(page, admin, { gis = "ok", drive = fakeDrive() } = {}) {
  await page.route("https://accounts.google.com/gsi/client", (route) =>
    route.fulfill({ status: 200, contentType: "text/javascript", body: fakeGis(gis) }));
  await page.route(/https:\/\/www\.googleapis\.com\/(upload\/)?drive\/v3\/(files|about).*/, (route) => drive.handle(route));
  await login(page, admin.email);
  await openTab(page, "users");
  await expect(page.locator("#backup-card")).toBeVisible();
  return drive;
}

async function backupNow(page) {
  await page.locator("#backup-btn").click();
  await expect(page.locator("#backup-msg")).toContainText("Backup saved to Google Drive");
}

const SALES = { headId: "default-01", headName: "Sales", type: "Inflow", farm: "Fatehpur Farm" };

test.describe("backup to Google Drive", () => {
  test("saves all data in the backup file", async ({ page, admin }) => {
    await seedHeads(admin.uid);
    await seedEntry({ ...SALES, date: "2026-10-01", amount: 1000, note: "Wheat" });
    await seedEntry({ ...SALES, date: "2026-10-02", amount: 2000 });
    const drive = await openBackupCard(page, admin);
    await expect(page.locator("#backup-last")).toHaveText("Last backup: never");

    await backupNow(page);
    await expect(page.locator("#backup-msg")).toHaveText("Backup saved to Google Drive (2 entries, 12 heads, 1 users).");

    const [folder] = [...drive.files.values()].filter((f) => f.mimeType === FOLDER_TYPE);
    expect(folder.name).toBe("Farm Tracker Backups");
    const [file] = drive.backupFiles();
    expect(file).toMatchObject({ name: "farm-tracker-backup.json", parents: [folder.id] });
    const backup = JSON.parse(file.content);
    expect(backup).toMatchObject({ app: "farm-tracker", version: 1, createdBy: admin.email, counts: { expenses: 2, heads: 12, users: 1 } });
    expect(backup.data.expenses.map((x) => x.note).sort()).toEqual(["", "Wheat"]);

    await expect(page.locator("#backup-last")).toContainText("by " + admin.email);
    await expect.poll(async () => (await readAll("auditLog")).map((a) => a.action)).toContain("backup-drive");
  });

  test("a new backup replaces the same file", async ({ page, admin }) => {
    await seedHeads(admin.uid);
    const drive = await openBackupCard(page, admin);
    await backupNow(page);
    await seedEntry({ ...SALES, date: "2026-10-03", amount: 300 });
    await backupNow(page);
    expect([...drive.files.values()].filter((f) => f.mimeType === FOLDER_TYPE)).toHaveLength(1);
    expect(drive.backupFiles()).toHaveLength(1);
    expect(JSON.parse(drive.backupFiles()[0].content).counts.expenses).toBe(1);
  });

  test("restores deleted entries and heads, and leaves existing data alone", async ({ page, admin }) => {
    await seedHeads(admin.uid);
    const keepId = await seedEntry({ ...SALES, date: "2026-10-01", amount: 1000 });
    const lostId = await seedEntry({ headId: "default-04", headName: "Rent", type: "Outflow", farm: "Rehmanbad Farm", date: "2026-10-05", amount: 3000, note: "Land rent" });
    await openBackupCard(page, admin);
    await backupNow(page);

    // Data is lost after the backup: one entry and its head deleted, one entry changed
    await asAdminDb(async (db) => {
      await db.doc(`expenses/${lostId}`).delete();
      await db.doc("heads/default-04").delete();
      await db.doc(`expenses/${keepId}`).update({ amount: 1111 });
    });

    const dialog = page.waitForEvent("dialog");
    await page.locator("#restore-btn").click();
    expect((await dialog).message()).toContain("This adds back 1 entries, 1 heads.");
    await expect(page.locator("#backup-msg")).toHaveText("Restore finished: 1 entries, 1 heads added back.");

    const entries = await readAll("expenses");
    expect(entries.find((x) => x.id === lostId)).toMatchObject({ amount: 3000, note: "Land rent", createdBy: admin.uid, hasAttachment: false });
    expect(entries.find((x) => x.id === keepId).amount).toBe(1111);   // existing data not overwritten
    expect((await readAll("heads")).find((h) => h.id === "default-04")).toMatchObject({ name: "Rent", active: true });
    await expect.poll(async () => (await readAll("auditLog")).map((a) => a.action)).toContain("restore-drive");
    await openTab(page, "list");
    await expect(page.locator("#list-body")).toContainText("Land rent");
  });

  test("restoring when nothing is missing changes nothing", async ({ page, admin }) => {
    await seedHeads(admin.uid);
    await openBackupCard(page, admin);
    await backupNow(page);
    await page.locator("#restore-btn").click();
    await expect(page.locator("#backup-msg")).toHaveText("Nothing to restore: everything in the backup is already in the app.");
  });

  test("restores an inactive head as inactive", async ({ page, admin }) => {
    await seedHeads(admin.uid);
    await asAdminDb((db) => db.doc("heads/default-12").update({ active: false }));
    await openBackupCard(page, admin);
    await backupNow(page);
    await asAdminDb((db) => db.doc("heads/default-12").delete());
    await page.locator("#restore-btn").click();
    await expect(page.locator("#backup-msg")).toContainText("Restore finished");
    expect((await readAll("heads")).find((h) => h.id === "default-12").active).toBe(false);
  });

  test("says so when there is no backup yet", async ({ page, admin }) => {
    await openBackupCard(page, admin);
    await page.locator("#restore-btn").click();
    await expect(page.locator("#backup-msg")).toHaveText("There is no backup in Google Drive yet.");
  });

  test("refuses a damaged backup file", async ({ page, admin }) => {
    const drive = await openBackupCard(page, admin);
    await backupNow(page);
    drive.backupFiles()[0].content = "{ broken";
    await page.locator("#restore-btn").click();
    await expect(page.locator("#backup-msg")).toHaveText("This file is not a Farm Tracker backup (it could not be read).");
  });

  test("refuses a Google account other than the backup account", async ({ page, admin }) => {
    const drive = await openBackupCard(page, admin, { drive: fakeDrive({ account: "someone.else@gmail.com" }) });
    await page.locator("#backup-btn").click();
    await expect(page.locator("#backup-msg")).toHaveText(
      `Backups are kept in ${BACKUP_ACCOUNT}. You chose someone.else@gmail.com; please try again and choose ${BACKUP_ACCOUNT}.`);
    expect(drive.files.size).toBe(0);
  });

  test("shows a clear message when Google sign-in is closed", async ({ page, admin }) => {
    await openBackupCard(page, admin, { gis: "closed" });
    await page.locator("#backup-btn").click();
    await expect(page.locator("#backup-msg")).toHaveText("Google sign-in was closed before it finished.");
    await expect(page.locator("#backup-btn")).toBeEnabled();
  });

  test("shows a clear message when Google Drive fails", async ({ page, admin }) => {
    await openBackupCard(page, admin, { drive: { handle: (route) => route.fulfill({ status: 500, body: "{}" }) } });
    await page.locator("#backup-btn").click();
    await expect(page.locator("#backup-msg")).toHaveText("Google Drive error (500). Please try again.");
    await expect.poll(async () => (await readAll("auditLog")).map((a) => a.action)).not.toContain("backup-drive");
  });
});
