import { createUser, expect, login, readAll, seedEntry, seedHeads, test } from "./support.js";

const SALES = { headId: "default-01", headName: "Sales", type: "Inflow" };
const SALARY = { headId: "default-03", headName: "Salary", type: "Outflow" };
const DIESEL = { headId: "default-08", headName: "Diesel for Machinery & Tractor", type: "Outflow" };

const pad = (n) => String(n).padStart(2, "0");
const dateText = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Dates relative to today, so "This month" and "Last month" always have data. */
const today = new Date();
const THIS_MONTH = dateText(new Date(today.getFullYear(), today.getMonth(), 1));
const LAST_MONTH = dateText(new Date(today.getFullYear(), today.getMonth() - 1, 15));

/** This month: 30,000 expenses; last month: 10,000 expenses; plus cash received that is not an expense. */
async function seedData(admin) {
  await seedHeads(admin.uid);
  await seedEntry({ ...DIESEL, date: THIS_MONTH, farm: "Bhakkarpur Farm", amount: 20000 });
  await seedEntry({ ...SALARY, date: THIS_MONTH, farm: "Fatehpur Farm", amount: 10000 });
  await seedEntry({ ...SALES, date: THIS_MONTH, farm: "Fatehpur Farm", amount: 99000 });
  await seedEntry({ ...SALARY, date: LAST_MONTH, farm: "Rehmanbad Farm", amount: 10000 });
}

const tile = (page, n) => page.locator("#dash-kpis .stat-tile").nth(n);

test.describe("dashboard", () => {
  test("is the home page and shows expense totals from the real entries", async ({ page, admin }) => {
    await seedData(admin);
    await login(page, admin.email);
    await expect(page.locator("#page-dashboard")).toBeVisible();
    await page.locator('#dash-period button[data-period="this-month"]').click();
    await expect(tile(page, 0)).toContainText("PKR 30,000");          // total expenses (cash received not counted)
    await expect(tile(page, 0)).toContainText("2 entries");
    await expect(tile(page, 1)).toContainText("PKR 30,000");          // this month
    await expect(tile(page, 1)).toContainText("Up 200% from last month");
    await expect(tile(page, 2)).toContainText("Diesel for Machinery & Tractor");
    await expect(tile(page, 2)).toContainText("67% of expenses");
    await expect(tile(page, 3)).toContainText("Bhakkarpur Farm");
    await expect(page.locator("#dash-farms")).toContainText("Fatehpur Farm");
    await expect(page.locator("#dash-farms")).toContainText("PKR 10,000");
    await expect(page.locator("#dash-heads li")).toHaveCount(2);
  });

  test("the figures change with the period", async ({ page, admin }) => {
    await seedData(admin);
    await login(page, admin.email);
    await page.locator('#dash-period button[data-period="last-month"]').click();
    await expect(page.locator('#dash-period button[data-period="last-month"]')).toHaveAttribute("aria-pressed", "true");
    await expect(tile(page, 0)).toContainText("PKR 10,000");
    await expect(tile(page, 2)).toContainText("Salary");
    await expect(tile(page, 3)).toContainText("Rehmanbad Farm");
    await expect(tile(page, 1)).toContainText("PKR 30,000");          // "this month" does not follow the period

    await page.locator('#dash-period button[data-period="all"]').click();
    await expect(tile(page, 0)).toContainText("PKR 40,000");
    await expect(page.locator("#dash-custom")).toBeHidden();

    await page.locator('#dash-period button[data-period="custom"]').click();
    await expect(page.locator("#dash-custom")).toBeVisible();
    await page.locator("#dash-from").fill("2000-01-01");
    await page.locator("#dash-to").fill("2000-01-31");
    await expect(tile(page, 0)).toContainText("PKR 0");
    await expect(page.locator("#dash-heads")).toContainText("No expenses in this period");
    await expect(tile(page, 2)).toContainText("-");
  });

  test("the totals match the database and the Reports page", async ({ page, admin }) => {
    await seedData(admin);
    await login(page, admin.email);
    await page.locator('#dash-period button[data-period="all"]').click();
    const expenses = (await readAll("expenses")).filter((x) => x.type === "Outflow").reduce((sum, x) => sum + x.amount, 0);
    await expect(tile(page, 0)).toContainText(`PKR ${expenses.toLocaleString("en-US")}`);
    await page.locator('#tabs button[data-page="reports"]').click();
    await page.locator("#rpt-period").selectOption("all");
    await expect(page.locator("#report-kpis")).toContainText(`PKR ${expenses.toLocaleString("en-US")}`);
  });

  test("draws the farm and monthly trend charts", async ({ page, admin }) => {
    await seedData(admin);
    await login(page, admin.email);
    await expect.poll(() => page.evaluate(() => typeof window.Chart)).toBe("function");
    for (const id of ["dash-farm-chart", "dash-trend-chart"]) {
      await expect.poll(() => page.evaluate((canvasId) => !!window.Chart.getChart(document.getElementById(canvasId)), id)).toBe(true);
    }
  });

  test("keeps cash received and balance in an optional section", async ({ page, admin }) => {
    await seedData(admin);
    await login(page, admin.email);
    await page.locator('#dash-period button[data-period="this-month"]').click();
    await expect(page.locator("#dash-cash")).toBeHidden();
    await page.locator(".cash-details summary").click();
    await expect(page.locator("#dash-cash")).toContainText("PKR 99,000");
    await expect(page.locator("#dash-cash")).toContainText("PKR 69,000");
  });

  test("Staff can see the Dashboard", async ({ page, admin }) => {
    await seedData(admin);
    const staff = await createUser({ email: "staff@farm.test", name: "Staff", role: "staff" });
    await login(page, staff.email);
    await expect(page.locator("#page-dashboard")).toBeVisible();
    await page.locator('#dash-period button[data-period="all"]').click();
    await expect(tile(page, 0)).toContainText("PKR 40,000");
  });
});
