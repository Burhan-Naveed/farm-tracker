import { APP_URL, PASSWORD, createLogin, createUser, expect, login, openTab, seedEntry, seedHeads, test } from "./support.js";

test.describe("login and access", () => {
  test("shows the login screen when logged out", async ({ page, admin }) => {
    await page.goto(APP_URL);
    await expect(page.locator("#login-view")).toBeVisible();
    await expect(page.locator("#app-view")).toBeHidden();
  });

  test("asks for email and password", async ({ page, admin }) => {
    await page.goto(APP_URL);
    await page.locator("#login-btn").click();
    await expect(page.locator("#login-error")).toHaveText("Please enter email and password.");
  });

  test("rejects an invalid email before contacting the server", async ({ page, admin }) => {
    await login(page, "not-an-email", PASSWORD);
    await expect(page.locator("#login-error")).toHaveText("Please enter a valid email address.");
  });

  test("shows a clear message for a wrong password", async ({ page, admin }) => {
    await login(page, admin.email, "wrong-password");
    await expect(page.locator("#login-error")).toHaveText("Wrong email or password.");
    await expect(page.locator("#login-btn")).toBeEnabled();
  });

  test("Admin logs in and sees every page", async ({ page, admin }) => {
    await login(page, admin.email);
    await expect(page.locator("#app-view")).toBeVisible();
    await expect(page.locator("#page-dashboard")).toBeVisible();   // the Dashboard is the home page
    for (const name of ["dashboard", "add", "list", "reports", "heads", "users"]) {
      await expect(page.locator(`#tabs button[data-page="${name}"]`)).toBeVisible();
    }
  });

  test("Staff sees only the Dashboard and Reports, without export buttons", async ({ page, admin }) => {
    const staff = await createUser({ email: "staff@farm.test", name: "Staff User", role: "staff" });
    await login(page, staff.email);
    await expect(page.locator("#page-dashboard")).toBeVisible();
    for (const name of ["add", "list", "heads", "users"]) {
      await expect(page.locator(`#tabs button[data-page="${name}"]`)).toBeHidden();
    }
    await openTab(page, "reports");
    await expect(page.locator("#export-report-btn")).toBeHidden();
    await expect(page.locator("#print-report-btn")).toBeHidden();
  });

  test("a login without a users record sees Access denied", async ({ page, admin }) => {
    const email = "stranger@farm.test";
    await createLogin(email);
    await login(page, email);
    await expect(page.locator("#denied-view")).toBeVisible();
    await expect(page.locator("#denied-msg")).toHaveText("Your account does not have access to this app. Please contact the Admin.");
    await expect(page.locator("#app-view")).toBeHidden();
  });

  test("logout returns to the login screen and deletes the offline copy", async ({ page, admin }) => {
    await seedHeads(admin.uid);
    await seedEntry({ date: "2026-10-01", farm: "Fatehpur Farm", headId: "default-06", headName: "Transport", type: "Outflow", amount: 10 });
    await login(page, admin.email);
    await openTab(page, "list");
    await expect(page.locator("#list-body tr")).toHaveCount(1);
    // Firestore keeps its offline copy in an IndexedDB database named "firestore/.../main"
    const offlineCopies = () => page.evaluate(async () =>
      (await indexedDB.databases()).filter((d) => d.name.startsWith("firestore/") && d.name.includes("main")).length
    );
    expect(await offlineCopies()).toBe(1);
    await page.locator('#app-view [data-action="logout"]').click();
    await expect(page.locator("#login-view")).toBeVisible();
    await expect(page.locator("#list-body tr")).toHaveCount(0);
    await expect.poll(offlineCopies).toBe(0);
  });

  test("logout warns when saved entries have not reached the server", async ({ page, admin, context }) => {
    await seedHeads(admin.uid);
    await login(page, admin.email);
    await openTab(page, "add");
    await expect(page.locator("#f-head option")).toHaveCount(13);
    await context.setOffline(true);
    await page.locator("#f-farm").selectOption("Fatehpur Farm");
    await page.locator("#f-head").selectOption({ label: "Rent" });
    await page.locator("#f-amount").fill("100");
    await page.locator("#expense-save-btn").click();

    page.removeAllListeners("dialog");
    const dialog = page.waitForEvent("dialog");
    await page.locator('#app-view [data-action="logout"]').click();
    const warning = await dialog;
    expect(warning.message()).toContain("have not reached the server yet");
    await warning.dismiss();
    await expect(page.locator("#app-view")).toBeVisible();
    await context.setOffline(false);
  });

  test("a disabled user sees a clear message", async ({ page, admin }) => {
    const user = await createUser({ email: "old@farm.test", name: "Old", role: "staff", status: "disabled" });
    await login(page, user.email);
    await expect(page.locator("#denied-view")).toBeVisible();
    await expect(page.locator("#denied-msg")).toHaveText("Your account has been disabled. Please contact the Admin.");
    await expect(page.locator("#app-view")).toBeHidden();
  });

  test("Forgot password needs an email first", async ({ page, admin }) => {
    await page.goto(APP_URL);
    await page.locator("#forgot-btn").click();
    await expect(page.locator("#login-error")).toHaveText("Type your email above first, then click 'Forgot password?'.");
  });

  test("Forgot password sends a reset email", async ({ page, admin }) => {
    await page.goto(APP_URL);
    await page.locator("#login-email").fill(admin.email);
    const dialog = page.waitForEvent("dialog");
    await page.locator("#forgot-btn").click();
    expect((await dialog).message()).toContain("a password reset link has been sent to " + admin.email);
  });
});
