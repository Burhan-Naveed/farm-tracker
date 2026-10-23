import { createUser, expect, login, openTab, readDownload, readDownloadBytes, seedEntry, seedHeads, test } from "./support.js";

const SALES = { headId: "default-01", headName: "Sales", type: "Inflow" };
const DIESEL = { headId: "default-08", headName: "Diesel for Machinery & Tractor", type: "Outflow" };
const TRANSPORT = { headId: "default-06", headName: "Transport", type: "Outflow" };

/**
 * October 2026: expenses 12,000 (Fatehpur) + 8,000 (Bhakkarpur) + 2,000 (Rehmanbad, paid by Manager) = 22,000,
 * plus 50,000 cash received that is NOT an expense. One September expense must not count in October.
 */
async function seedData(admin) {
  await seedHeads(admin.uid);
  await seedEntry({ ...SALES, date: "2026-10-01", farm: "Fatehpur Farm", amount: 50000 });
  await seedEntry({ ...DIESEL, date: "2026-10-03", farm: "Fatehpur Farm", amount: 12000, hasAttachment: true, note: "Tractor diesel" });
  await seedEntry({ ...DIESEL, date: "2026-10-04", farm: "Bhakkarpur Farm", amount: 8000 });
  await seedEntry({ ...TRANSPORT, date: "2026-10-20", farm: "Rehmanbad Farm", amount: 2000, paidBy: "Manager", note: "Truck" });
  await seedEntry({ ...DIESEL, date: "2026-09-28", farm: "Rehmanbad Farm", amount: 3000 });
}

async function setRange(page, from, to) {
  await page.locator("#rpt-from").fill(from);
  await page.locator("#rpt-to").fill(to);
}

/** Opens one report type for October 2026. */
async function openReport(page, view, from = "2026-10-01", to = "2026-10-31") {
  await openTab(page, "reports");
  await page.locator(`#rpt-view button[data-view="${view}"]`).click();
  await setRange(page, from, to);
}

const kpis = (page) => page.locator("#report-kpis");
const table = (page) => page.locator("#report-tables table").first();

/** Clicks Export CSV and returns the file name and its lines (without the BOM). */
async function exportCsv(page) {
  const [download] = await Promise.all([page.waitForEvent("download"), page.locator('#export-report [data-export="csv"]').click()]);
  return { name: download.suggestedFilename(), lines: (await readDownload(download)).slice(1).split("\r\n") };
}

test.describe("reports", () => {
  test("Farm-wise report: totals, share and highest farm; cash received is not an expense", async ({ page, admin }) => {
    await seedData(admin);
    await login(page, admin.email);
    await openReport(page, "farm");
    await expect(page.locator("#report-title")).toHaveText("Farm-wise Expense Report");
    await expect(page.locator("#report-meta")).toContainText("Dates: 01 Oct 2026 to 31 Oct 2026");
    await expect(page.locator("#rpt-period")).toHaveValue("custom");
    await expect(kpis(page)).toContainText("PKR 22,000");
    await expect(kpis(page)).toContainText("Fatehpur Farm");
    await expect(table(page).locator("tbody tr").nth(0)).toHaveText(/Fatehpur Farm\s*12,000\s*55%\s*1/);
    await expect(table(page).locator("tfoot")).toHaveText(/Total\s*22,000\s*100%\s*3/);

    const csv = await exportCsv(page);
    expect(csv.name).toBe("farm-wise-expense-report-2026-10-01_to_2026-10-31.csv");
    expect(csv.lines.slice(0, 4)).toEqual([
      "Farm Tracker - Farm-wise Expense Report",
      "Dates,01 Oct 2026 to 31 Oct 2026",
      "Expense head,All expense heads",
      "Paid by,Anyone"
    ]);
    expect(csv.lines.slice(6)).toEqual([
      "Farm-wise expenses",
      "Farm,Expenses (PKR),Share (%),Entries",
      "Fatehpur Farm,12000,55,1",
      "Bhakkarpur Farm,8000,36,1",
      "Rehmanbad Farm,2000,9,1",
      "Total,22000,100,3",
      ""
    ]);
  });

  test("Excel and PDF exports of a report", async ({ page, admin }) => {
    await seedData(admin);
    await login(page, admin.email);
    await openReport(page, "farm");
    await expect(kpis(page)).toContainText("PKR 22,000");
    const [download] = await Promise.all([page.waitForEvent("download"), page.locator('#export-report [data-export="excel"]').click()]);
    expect(download.suggestedFilename()).toBe("farm-wise-expense-report-2026-10-01_to_2026-10-31.xlsx");
    const text = (await readDownloadBytes(download)).toString("utf8");
    expect(text).toContain("Farm Tracker - Farm-wise Expense Report");
    expect(text).toContain("<v>22000</v>");
    expect(text).toContain('s="1"');   // titles, headings and totals are bold

    await page.evaluate(() => { window.print = () => { window.printed = true; }; });
    await page.locator('#export-report [data-export="pdf"]').click();
    await expect.poll(() => page.evaluate(() => window.printed)).toBe(true);
  });

  test("the chart library loads (passes its integrity check) and draws the chart", async ({ page, admin }) => {
    await seedData(admin);
    await login(page, admin.email);
    await openReport(page, "farm");
    await expect.poll(() => page.evaluate(() => typeof window.Chart)).toBe("function");
    await expect.poll(() => page.evaluate(() => !!window.Chart.getChart(document.getElementById("report-chart")))).toBe(true);
  });

  test("Head-wise report: each head per farm, highest first, filtered by farm", async ({ page, admin }) => {
    await seedData(admin);
    await login(page, admin.email);
    await openReport(page, "head");
    const rows = table(page).locator("tbody tr");
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toHaveText(/Diesel for Machinery & Tractor\s*12,000\s*8,000\s*0\s*20,000\s*91%\s*2/);
    await expect(rows.nth(1)).toHaveText(/Transport\s*0\s*0\s*2,000\s*2,000\s*9%\s*1/);

    await page.locator("#rpt-farm").selectOption("Bhakkarpur Farm");
    await expect(rows).toHaveCount(1);
    await expect(table(page).locator("thead")).toHaveText(/Expense head\s*Bhakkarpur Farm\s*Share\s*Entries/);
    await expect(kpis(page)).toContainText("PKR 8,000");
    const csv = await exportCsv(page);
    expect(csv.lines).toContain("Farm,Bhakkarpur Farm");
    expect(csv.lines).toContain("Diesel for Machinery & Tractor,8000,100,1");
  });

  test("Monthly report: months with change, and comparison by expense head", async ({ page, admin }) => {
    await seedData(admin);
    await login(page, admin.email);
    await openReport(page, "monthly", "2026-09-01", "2026-10-31");
    const rows = table(page).locator("tbody tr");
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toHaveText(/September 2026\s*0\s*0\s*3,000\s*3,000\s*–\s*–/);
    await expect(rows.nth(1)).toHaveText(/October 2026\s*12,000\s*8,000\s*2,000\s*22,000\s*\+19,000\s*\+633%/);
    await expect(rows.nth(1).locator(".change-up")).toHaveCount(2);   // spending went up: red

    await page.locator("#rpt-compare").selectOption("head");
    await expect(table(page).locator("thead")).toContainText("Diesel for Machinery & Tractor");
    await expect(rows.nth(1)).toHaveText(/October 2026\s*20,000\s*2,000\s*22,000/);

    await page.locator("#rpt-head").selectOption({ label: "Transport" });
    await expect(kpis(page)).toContainText("PKR 2,000");
  });

  test("Expense Details: every expense with filters, sorting, slip and an accurate total", async ({ page, admin }) => {
    await seedData(admin);
    await login(page, admin.email);
    await openReport(page, "details");
    const rows = table(page).locator("tbody tr");
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0)).toContainText("20 Oct 2026");   // newest first
    await expect(table(page).locator("tbody [data-view]")).toHaveCount(1);
    await expect(table(page).locator("tfoot")).toContainText("22,000");

    await page.locator("#rpt-sort").selectOption("amount-desc");
    await expect(rows.nth(0)).toContainText("12,000");
    await page.locator("#rpt-search").fill("truck");
    await expect(rows).toHaveCount(1);
    await expect(rows.nth(0)).toContainText("Manager");
    await page.locator("#rpt-search").fill("");
    await page.locator("#rpt-paidby").selectOption({ label: "Amjad Ali" });
    await expect(rows).toHaveCount(2);
    await expect(table(page).locator("tfoot")).toContainText("20,000");

    const csv = await exportCsv(page);
    expect(csv.lines).toContain("Paid by,Amjad Ali");
    expect(csv.lines).toContain("Date,Farm,Expense head,Description,Paid by,Amount (PKR),Attachment");
    expect(csv.lines).toContain("2026-10-03,Fatehpur Farm,Diesel for Machinery & Tractor,Tractor diesel,Amjad Ali,12000,Yes");
    expect(csv.lines).toContain("Total,,,,,20000,");
  });

  test("Paid By report shows Amjad Ali (saved as BM) and the other payers", async ({ page, admin }) => {
    await seedData(admin);
    await login(page, admin.email);
    await openReport(page, "payer");
    await expect(kpis(page)).toContainText("Paid by Amjad Ali");
    await expect(kpis(page)).toContainText("PKR 20,000");
    const rows = table(page).locator("tbody tr");
    await expect(rows.nth(0)).toHaveText(/Amjad Ali\s*12,000\s*8,000\s*0\s*20,000\s*91%\s*2/);
    await expect(rows.nth(1)).toHaveText(/Manager\s*0\s*0\s*2,000\s*2,000\s*9%\s*1/);
    await expect(page.locator("#report-tables")).not.toContainText("BM");
  });

  test("Cash Book keeps the old Inflow / Outflow / Net view as an optional report", async ({ page, admin }) => {
    await seedData(admin);
    await login(page, admin.email);
    await openReport(page, "cash");
    await expect(kpis(page)).toContainText("PKR 50,000");
    await expect(kpis(page)).toContainText("PKR 22,000");
    await expect(kpis(page)).toContainText("PKR 28,000");
    await expect(page.locator("#report-note")).toContainText("negative balance");
    await expect(table(page).locator("tfoot")).toHaveText(/Balance \(received - spent\)\s*38,000\s*-8,000\s*-2,000\s*28,000/);
  });

  test("period choices fill the dates; dates entered the wrong way round are swapped", async ({ page, admin }) => {
    await seedData(admin);
    await login(page, admin.email);
    await openTab(page, "reports");
    const year = new Date().getFullYear();
    await expect(page.locator("#rpt-period")).toHaveValue("this-year");
    await expect(page.locator("#rpt-from")).toHaveValue(`${year}-01-01`);
    await page.locator("#rpt-period").selectOption("last-year");
    await expect(page.locator("#rpt-from")).toHaveValue(`${year - 1}-01-01`);
    await expect(page.locator("#rpt-to")).toHaveValue(`${year - 1}-12-31`);
    await page.locator("#rpt-period").selectOption("all");
    await expect(page.locator("#report-meta")).toContainText("Dates: all dates");
    await expect(kpis(page)).toContainText("PKR 25,000");   // October + September

    await setRange(page, "2026-10-31", "2026-09-01");
    await expect(page.locator("#report-meta")).toContainText("01 Sep 2026 to 31 Oct 2026");
    await expect(kpis(page)).toContainText("PKR 25,000");
  });

  test("hidden filters are not applied when switching report", async ({ page, admin }) => {
    await seedData(admin);
    await login(page, admin.email);
    await openReport(page, "head");
    await page.locator("#rpt-farm").selectOption("Bhakkarpur Farm");
    await expect(kpis(page)).toContainText("PKR 8,000");
    await page.locator('#rpt-view button[data-view="farm"]').click();   // the Farm filter is hidden here
    await expect(page.locator("#rpt-farm")).toBeHidden();
    await expect(kpis(page)).toContainText("PKR 22,000");
  });

  test("shows an empty state when nothing matches", async ({ page, admin }) => {
    await seedData(admin);
    await login(page, admin.email);
    await openReport(page, "details", "2025-01-01", "2025-01-31");
    await expect(page.locator("#report-tables")).toContainText("No expenses match these filters.");
    await page.locator('#export-report [data-export="csv"]').click();
    await expect(page.locator("#toast")).toHaveText("Nothing to export");
  });

  test("Staff can view every report type, without export buttons", async ({ page, admin }) => {
    await seedData(admin);
    const staff = await createUser({ email: "staff@farm.test", name: "Staff", role: "staff" });
    await login(page, staff.email);
    for (const view of ["farm", "head", "monthly", "details", "payer", "cash"]) {
      await openReport(page, view);
      await expect(page.locator("#report-kpis .stat-tile").first()).toBeVisible();
    }
    await openReport(page, "farm");
    await expect(kpis(page)).toContainText("PKR 22,000");
    await expect(page.locator("#export-report")).toBeHidden();
  });
});
