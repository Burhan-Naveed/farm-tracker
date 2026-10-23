import { asAdminDb, createLogin, createUser, expect, login, openTab, readAll, seedEntry, seedHeads, serverTime, test } from "./support.js";

const headRow = (page, name) => page.locator("#heads-body tr", { has: page.getByText(name, { exact: true }) });

test.describe("heads page", () => {
  test.beforeEach(async ({ page, admin }) => {
    await seedHeads(admin.uid);
    await login(page, admin.email);
    await openTab(page, "heads");
    await expect(page.locator("#heads-body tr")).toHaveCount(12);
  });

  test("adds a head that appears in the entry form", async ({ page }) => {
    await page.locator("#h-name").fill("  Seeds   and Fertilizer ");
    await page.locator("#h-type").selectOption("Outflow");
    await page.locator("#head-save-btn").click();
    await expect(page.locator("#heads-body tr")).toHaveCount(13);
    await expect(headRow(page, "Seeds and Fertilizer")).toBeVisible();
    await openTab(page, "add");
    await expect(page.locator("#f-head")).toContainText("Seeds and Fertilizer");
    await expect.poll(async () => (await readAll("auditLog")).map((a) => a.action)).toContain("head-add");
  });

  test("blocks duplicate and invalid heads", async ({ page }) => {
    await page.locator("#h-name").fill("sales");
    await page.locator("#h-type").selectOption("Inflow");
    await page.locator("#head-save-btn").click();
    await expect(page.locator("#head-error")).toHaveText('A head with this name already exists: "Sales".');
    await page.locator("#h-name").fill("Misc Expenses");   // same as "Misc. Expenses" apart from the dot
    await page.locator("#h-type").selectOption("Outflow");
    await page.locator("#head-save-btn").click();
    await expect(page.locator("#head-error")).toHaveText('A head with this name already exists: "Misc. Expenses".');
    await page.locator("#h-name").fill("New head");
    await page.locator("#h-type").selectOption("");
    await page.locator("#head-save-btn").click();
    await expect(page.locator("#head-error")).toHaveText("Please select a type.");
    await expect(page.locator("#heads-body tr")).toHaveCount(12);
  });

  test("renaming a head updates its entries", async ({ page }) => {
    await seedEntry({ date: "2026-10-01", farm: "Fatehpur Farm", headId: "default-06", headName: "Transport", type: "Outflow", amount: 100 });
    await headRow(page, "Transport").locator("[data-head-edit]").click();
    await expect(page.locator("#head-form-title")).toHaveText("Rename / Edit Head");
    await expect(page.locator("#head-edit-hint")).toContainText("all 1 old entries");
    await page.locator("#h-name").fill("Transport & Freight");
    await page.locator("#head-save-btn").click();
    await expect(page.locator("#toast")).toHaveText("Head updated (1 entries updated)");
    await expect.poll(async () => (await readAll("expenses"))[0].headName).toBe("Transport & Freight");
  });

  test("an inactive head is hidden from the entry form but kept in reports", async ({ page }) => {
    await headRow(page, "Rent").locator("[data-head-toggle]").click();
    await expect(headRow(page, "Rent")).toContainText("Inactive");
    await openTab(page, "add");
    await expect(page.locator("#f-head")).not.toContainText("Rent");
    await openTab(page, "reports");
    await page.locator('#rpt-view button[data-view="head"]').click();
    await expect(page.locator("#rpt-head")).toContainText("Rent (inactive)");
  });

  test("a head with entries cannot be deleted; an unused head can", async ({ page }) => {
    await seedEntry({ date: "2026-10-01", farm: "Fatehpur Farm", headId: "default-04", headName: "Rent", type: "Outflow", amount: 100 });
    await expect(headRow(page, "Rent").locator("[data-head-delete]")).toHaveCount(0);
    await headRow(page, "Salary").locator("[data-head-delete]").click();
    await expect(page.locator("#heads-body tr")).toHaveCount(11);
    await expect.poll(async () => (await readAll("heads")).length).toBe(11);
  });
});

test.describe("users page", () => {
  test("adds a user who can then log in as Staff", async ({ page, admin, browser }) => {
    await seedHeads(admin.uid);
    const uid = await createLogin("new.staff@farm.test");
    await login(page, admin.email);
    await openTab(page, "users");
    await page.locator("#u-name").fill("New Staff");
    await page.locator("#u-email").fill("New.Staff@farm.test");
    await page.locator("#u-uid").fill(uid);
    await page.locator("#u-role").selectOption("staff");
    await page.locator("#user-save-btn").click();
    await expect(page.locator("#users-body tr")).toHaveCount(2);
    await expect.poll(async () => (await readAll("users")).find((u) => u.id === uid)).toMatchObject({ email: "new.staff@farm.test", role: "staff", status: "active" });

    const other = await browser.newContext({ serviceWorkers: "block" });
    const staffPage = await other.newPage();
    await login(staffPage, "new.staff@farm.test");
    await expect(staffPage.locator("#page-dashboard")).toBeVisible();
    await expect(staffPage.locator("#user-label")).toHaveText("New Staff (Staff)");
    await other.close();
  });

  test("validates the Add User form", async ({ page, admin }) => {
    await login(page, admin.email);
    await openTab(page, "users");
    await page.locator("#u-name").fill("Someone");
    await page.locator("#u-email").fill(admin.email);
    await page.locator("#u-uid").fill("x".repeat(28));
    await page.locator("#user-save-btn").click();
    await expect(page.locator("#user-error")).toHaveText("A user with this email already exists.");
    await page.locator("#u-email").fill("someone@farm.test");
    await page.locator("#u-uid").fill("short");
    await page.locator("#user-save-btn").click();
    await expect(page.locator("#user-error")).toHaveText("Please paste the User UID exactly as shown in Firebase Console.");
  });

  test("the Admin cannot change their own role or disable themselves", async ({ page, admin }) => {
    await login(page, admin.email);
    await openTab(page, "users");
    const row = page.locator("#users-body tr").first();
    await expect(row).toContainText("(you)");
    await expect(row.locator("select")).toBeDisabled();
    await expect(row.locator("[data-status-for]")).toHaveCount(0);
  });

  test("changing a role and disabling a user take effect on their device at once", async ({ page, admin, browser }) => {
    const staff = await createUser({ email: "staff@farm.test", name: "Staff", role: "staff" });
    await login(page, admin.email);
    await openTab(page, "users");

    const other = await browser.newContext({ serviceWorkers: "block" });
    const staffPage = await other.newPage();
    await login(staffPage, staff.email);
    await expect(staffPage.locator("#page-dashboard")).toBeVisible();
    await expect(staffPage.locator('#tabs button[data-page="add"]')).toBeHidden();

    await page.locator(`select[data-role-for="${staff.uid}"]`).selectOption("admin");
    await expect(staffPage.locator('#tabs button[data-page="add"]')).toBeVisible();

    await page.locator(`[data-status-for="${staff.uid}"]`).click();
    await expect(staffPage.locator("#app-view")).toBeHidden();
    await expect(staffPage.locator("#denied-view")).toBeVisible();
    await expect(staffPage.locator("#denied-msg")).toHaveText("Your account has been disabled. Please contact the Admin.");
    // The offline copy is deleted, so the data cannot be opened offline either
    await expect.poll(() => staffPage.evaluate(async () =>
      (await indexedDB.databases()).filter((d) => d.name.startsWith("firestore/") && d.name.includes("main")).length
    )).toBe(0);
    await staffPage.reload();
    await expect(staffPage.locator("#denied-view")).toBeVisible();
    await expect.poll(async () => (await readAll("auditLog")).map((a) => a.action).sort()).toEqual(["user-role", "user-status"]);
    await other.close();
  });
});

test.describe("one-time head rename (Cash by BM -> Paid by Amjad Ali)", () => {
  const addBmHead = () => asAdminDb((db) => db.doc("heads/bm-head").set({
    name: "Cash by BM", type: "Inflow", active: true, isDefault: false, createdBy: "seed", createdAt: serverTime()
  }));

  test("renames the head after confirmation; ids, amounts and dates stay the same", async ({ page, admin }) => {
    await seedHeads(admin.uid);
    await addBmHead();
    const id = await seedEntry({ date: "2026-06-10", farm: "Bhakkarpur Farm", headId: "bm-head", headName: "Cash by BM", type: "Inflow", amount: 25000 });
    await login(page, admin.email);
    await openTab(page, "heads");
    const card = page.locator("#head-rename-card");
    await expect(card).toContainText("Cash by BM");
    await expect(card).toContainText("Paid by Amjad Ali");
    await expect(card).toContainText("1 entries");

    // Cancelling the confirmation changes nothing
    page.removeAllListeners("dialog");
    page.once("dialog", (d) => d.dismiss());
    await card.locator("[data-rename]").click();
    expect((await readAll("heads")).find((h) => h.id === "bm-head").name).toBe("Cash by BM");

    page.once("dialog", (d) => d.accept());
    await card.locator("[data-rename]").click();
    await expect(card).toBeHidden();
    await expect.poll(async () => (await readAll("heads")).find((h) => h.id === "bm-head").name).toBe("Paid by Amjad Ali");
    await expect.poll(async () => (await readAll("expenses")).find((x) => x.id === id).headName).toBe("Paid by Amjad Ali");
    const [entry] = await readAll("expenses");
    expect(entry).toMatchObject({ id, headId: "bm-head", amount: 25000, date: "2026-06-10", farm: "Bhakkarpur Farm", type: "Inflow" });
    expect((await readAll("heads")).filter((h) => /amjad ali/i.test(h.name))).toHaveLength(2);   // with "Cash by Owner (Amjad Ali)", no duplicate
    await expect.poll(async () => (await readAll("auditLog")).map((a) => a.details).join()).toContain("Cash by BM (Inflow) -> Paid by Amjad Ali (Inflow)");
  });

  test("does not offer the rename when a head with the new name already exists", async ({ page, admin }) => {
    await seedHeads(admin.uid);
    await addBmHead();
    await asAdminDb((db) => db.doc("heads/amjad").set({
      name: "Paid by Amjad Ali", type: "Outflow", active: true, isDefault: false, createdBy: "seed", createdAt: serverTime()
    }));
    await login(page, admin.email);
    await openTab(page, "heads");
    await expect(page.locator("#head-rename-card")).toContainText("already exists");
    await expect(page.locator("#head-rename-card [data-rename]")).toHaveCount(0);
  });

  test("shows nothing when there is no Cash by BM head", async ({ page, admin }) => {
    await seedHeads(admin.uid);
    await login(page, admin.email);
    await openTab(page, "heads");
    await expect(page.locator("#heads-body tr")).toHaveCount(12);
    await expect(page.locator("#head-rename-card")).toBeHidden();
  });
});
