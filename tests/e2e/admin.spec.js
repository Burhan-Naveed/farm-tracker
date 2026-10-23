import { createLogin, createUser, expect, login, openTab, readAll, seedEntry, seedHeads, test } from "./support.js";

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
    await expect(page.locator("#head-error")).toHaveText("A head with this name already exists.");
    await page.locator("#h-name").fill("New head");
    await page.locator("#h-type").selectOption("");
    await page.locator("#head-save-btn").click();
    await expect(page.locator("#head-error")).toHaveText("Please select a type.");
    await expect(page.locator("#heads-body tr")).toHaveCount(12);
  });

  test("renaming a head updates its entries", async ({ page }) => {
    await seedEntry({ date: "2026-10-01", farm: "Fatehpur Farm", headId: "default-06", headName: "Transport", type: "Outflow", amount: 100 });
    await headRow(page, "Transport").locator("[data-head-edit]").click();
    await expect(page.locator("#head-form-title")).toHaveText("Edit Head");
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
    await expect(staffPage.locator("#page-reports")).toBeVisible();
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
    await expect(staffPage.locator("#page-reports")).toBeVisible();
    await expect(staffPage.locator('#tabs button[data-page="add"]')).toBeHidden();

    await page.locator(`select[data-role-for="${staff.uid}"]`).selectOption("admin");
    await expect(staffPage.locator('#tabs button[data-page="add"]')).toBeVisible();

    await page.locator(`[data-status-for="${staff.uid}"]`).click();
    await expect(staffPage.locator("#app-view")).toBeHidden();
    await expect(staffPage.locator("#denied-view")).toBeVisible();
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
