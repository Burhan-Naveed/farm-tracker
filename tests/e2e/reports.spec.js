import { createUser, expect, login, openTab, readDownload, seedEntry, seedHeads, test } from "./support.js";

const SALES = { headId: "default-01", headName: "Sales", type: "Inflow" };
const DIESEL = { headId: "default-08", headName: "Diesel for Machinery & Tractor", type: "Outflow" };

/** Some entries in October 2026 (plus one in September that must not count). */
async function seedMonth(admin) {
  await seedHeads(admin.uid);
  await seedEntry({ ...SALES, date: "2026-10-01", farm: "Fatehpur Farm", amount: 50000 });
  await seedEntry({ ...DIESEL, date: "2026-10-03", farm: "Fatehpur Farm", amount: 12000, hasAttachment: true });
  await seedEntry({ ...DIESEL, date: "2026-10-04", farm: "Bhakkarpur Farm", amount: 8000 });
  await seedEntry({ ...DIESEL, date: "2026-09-28", farm: "Rehmanbad Farm", amount: 3000 });
}

async function openReports(page, month = "2026-10") {
  await openTab(page, "reports");
  await page.locator("#rpt-month").fill(month);
}

const summary = (page, n) => page.locator("#summary-cards .summary-card").nth(n);

test.describe("reports", () => {
  test("Total Report shows totals and net per farm for the month", async ({ page, admin }) => {
    await seedMonth(admin);
    await login(page, admin.email);
    await openReports(page);
    await expect(page.locator("#report-title")).toHaveText("Farm Report - October 2026");
    await expect(summary(page, 0)).toContainText("PKR 50,000");
    await expect(summary(page, 0)).toContainText("PKR 20,000");
    await expect(summary(page, 0)).toContainText("PKR 30,000");
    await expect(summary(page, 2)).toContainText("-PKR 8,000");   // Bhakkarpur: outflow only
    await expect(page.locator("#report-table .net-row")).toHaveText(/Net \(Inflow - Outflow\)\s*38,000\s*-8,000\s*0\s*30,000/);
  });

  test("the chart library loads (passes its integrity check) and draws the chart", async ({ page, admin }) => {
    await seedMonth(admin);
    await login(page, admin.email);
    await openReports(page);
    await expect.poll(() => page.evaluate(() => typeof window.Chart)).toBe("function");
    await expect.poll(() => page.evaluate(() => !!window.Chart.getChart(document.getElementById("report-chart")))).toBe(true);
  });

  test("Total Report exports CSV", async ({ page, admin }) => {
    await seedMonth(admin);
    await login(page, admin.email);
    await openReports(page);
    await expect(summary(page, 0)).toContainText("PKR 50,000");   // data has loaded
    const [download] = await Promise.all([page.waitForEvent("download"), page.locator("#export-report-btn").click()]);
    expect(download.suggestedFilename()).toBe("farm-report-2026-10.csv");
    const lines = (await readDownload(download)).slice(1).split("\r\n");
    expect(lines[0]).toBe("Head,Type,Fatehpur Farm (PKR),Bhakkarpur Farm (PKR),Rehmanbad Farm (PKR),Total (PKR)");
    expect(lines).toContain("Total Inflow,Inflow,50000,0,0,50000");
    expect(lines).toContain("Total Outflow,Outflow,12000,8000,0,20000");
    expect(lines.at(-1)).toBe("Net (Inflow - Outflow),,38000,-8000,0,30000");
  });

  test("Farm-wise report shows one farm with its transactions", async ({ page, admin }) => {
    await seedMonth(admin);
    await login(page, admin.email);
    await openReports(page);
    await page.locator('#rpt-view button[data-view="farm"]').click();
    await page.locator("#rpt-farm").selectOption("Fatehpur Farm");
    await expect(page.locator("#report-title")).toHaveText("Fatehpur Farm - October 2026");
    await expect(page.locator("#farm-tx-title")).toHaveText("Transactions (2)");
    await expect(page.locator("#farm-summary")).toContainText("PKR 38,000");
    await expect(page.locator("#farm-tx-body [data-view]")).toHaveCount(1);

    const [download] = await Promise.all([page.waitForEvent("download"), page.locator("#export-report-btn").click()]);
    expect(download.suggestedFilename()).toBe("fatehpur-farm-report-2026-10.csv");
    const csv = await readDownload(download);
    expect(csv).toContain("2026-10-03,Diesel for Machinery & Tractor,Outflow,12000,BM,,Yes");
  });

  test("Farm-wise report says when a farm has no transactions", async ({ page, admin }) => {
    await seedMonth(admin);
    await login(page, admin.email);
    await openReports(page);
    await page.locator('#rpt-view button[data-view="farm"]').click();
    await page.locator("#rpt-farm").selectOption("Rehmanbad Farm");
    await expect(page.locator("#farm-tx-empty")).toBeVisible();
  });

  test("Head-wise report covers any date range and all farms", async ({ page, admin }) => {
    await seedMonth(admin);
    await login(page, admin.email);
    await openTab(page, "reports");
    await page.locator('#rpt-view button[data-view="head"]').click();
    await page.locator("#rpt-head").selectOption({ label: "Diesel for Machinery & Tractor" });
    // Dates entered the wrong way round are swapped
    await page.locator("#rpt-from").fill("2026-10-31");
    await page.locator("#rpt-to").fill("2026-09-01");
    await expect(page.locator("#head-tx-title")).toHaveText("Transactions (3)");
    await expect(page.locator("#head-summary")).toContainText("PKR 23,000");
    await expect(page.locator("#head-month-table")).toContainText("September 2026");
    await expect(page.locator("#head-farm-card")).toBeVisible();

    await page.locator("#rpt-hfarm").selectOption("Bhakkarpur Farm");
    await expect(page.locator("#head-tx-title")).toHaveText("Transactions (1)");
    await expect(page.locator("#head-farm-card")).toBeHidden();

    const [download] = await Promise.all([page.waitForEvent("download"), page.locator("#export-report-btn").click()]);
    expect(download.suggestedFilename()).toBe("diesel-for-machinery-tractor-bhakkarpur-farm-2026-09-01_to_2026-10-31.csv");
  });

  test("Staff can view every report type", async ({ page, admin }) => {
    await seedMonth(admin);
    const staff = await createUser({ email: "staff@farm.test", name: "Staff", role: "staff" });
    await login(page, staff.email);
    await expect(page.locator("#page-reports")).toBeVisible();
    await page.locator("#rpt-month").fill("2026-10");
    await expect(summary(page, 0)).toContainText("PKR 30,000");
    await page.locator('#rpt-view button[data-view="farm"]').click();
    await expect(page.locator("#report-farm")).toBeVisible();
    await page.locator('#rpt-view button[data-view="head"]').click();
    await expect(page.locator("#report-head")).toBeVisible();
  });
});
