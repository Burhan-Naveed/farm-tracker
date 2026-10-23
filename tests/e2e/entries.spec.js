import { asAdminDb, expect, login, openTab, readAll, readDownload, seedEntry, seedHeads, selectHead, serverTime, test } from "./support.js";

const TRANSPORT = { headId: "default-06", headName: "Transport", type: "Outflow" };
const SALES = { headId: "default-01", headName: "Sales", type: "Inflow" };

/** Fills and submits the Add Expense form. */
async function addEntry(page, { date, farm = "Fatehpur Farm", head = "Transport", amount = "1500", paidBy, note } = {}) {
  if (date) await page.locator("#f-date").fill(date);
  if (farm !== undefined) await page.locator("#f-farm").selectOption(farm);
  if (head) await selectHead(page.locator("#f-head"), head);
  await page.locator("#f-amount").fill(amount);
  if (paidBy) await page.locator("#f-paidby").selectOption(paidBy);
  if (note !== undefined) await page.locator("#f-note").fill(note);
  await page.locator("#expense-save-btn").click();
}

/** Logs in and opens the Add Expense form. */
async function openForm(page, admin) {
  await login(page, admin.email);
  await openTab(page, "add");
}

test.describe("add entry", () => {
  test("first Admin login creates the 12 default heads, expense heads listed first", async ({ page, admin }) => {
    await openForm(page, admin);
    await expect(page.locator("#f-head option")).toHaveCount(13);   // 12 heads + "Select head"
    await expect(page.locator("#f-head optgroup").first()).toHaveAttribute("label", "Expense");
    await expect(page.locator('#f-head optgroup[label="Cash received"] option')).toHaveCount(2);
    await expect.poll(async () => (await readAll("heads")).length).toBe(12);
  });

  test("uses today's date and Amjad Ali as the default payer", async ({ page, admin }) => {
    await seedHeads(admin.uid);
    await openForm(page, admin);
    await expect(page.locator("#f-date")).toHaveValue(await page.evaluate(() => {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    }));
    await expect(page.locator("#f-paidby option:checked")).toHaveText("Amjad Ali");
    await expect(page.locator("#f-paidby")).toHaveValue("BM");
    await expect(page.locator("#f-paidby option")).toHaveText(["Amjad Ali", "Manager", "Other"]);
  });

  test("validates the form and marks the wrong field", async ({ page, admin }) => {
    await seedHeads(admin.uid);
    await openForm(page, admin);
    await addEntry(page, { farm: "" });
    await expect(page.locator("#expense-error")).toHaveText("Please select a farm.");
    await expect(page.locator("#f-farm")).toHaveAttribute("aria-invalid", "true");
    await expect(page.locator("#f-farm")).toBeFocused();
    await addEntry(page, { amount: "" });
    await expect(page.locator("#expense-error")).toHaveText("Please enter the amount.");
    await expect(page.locator("#f-amount")).toHaveAttribute("aria-invalid", "true");
    await expect(page.locator("#f-farm")).not.toHaveAttribute("aria-invalid", "true");
    await addEntry(page, { amount: "0" });
    await expect(page.locator("#expense-error")).toHaveText("Amount must be greater than zero.");
    await addEntry(page, { amount: "-50" });
    await expect(page.locator("#expense-error")).toHaveText("Please enter the amount as a number, for example 15000.");
    expect(await readAll("expenses")).toHaveLength(0);
  });

  test("shows the typed amount in PKR under the field", async ({ page, admin }) => {
    await seedHeads(admin.uid);
    await openForm(page, admin);
    await page.locator("#f-amount").fill("125000");
    await expect(page.locator("#f-amount-hint")).toHaveText("PKR 125,000");
  });

  test("adds an expense, keeps date and farm for the next one", async ({ page, admin }) => {
    await seedHeads(admin.uid);
    await openForm(page, admin);
    await addEntry(page, { date: "2026-10-13", farm: "Bhakkarpur Farm", head: "Diesel for Machinery & Tractor", amount: "15000", paidBy: "Manager", note: "Tractor diesel" });
    await expect(page.locator("#toast")).toHaveText("Saved: Diesel for Machinery & Tractor PKR 15,000 (Bhakkarpur Farm)");
    await expect(page.locator("#f-date")).toHaveValue("2026-10-13");
    await expect(page.locator("#f-farm")).toHaveValue("Bhakkarpur Farm");
    await expect(page.locator("#f-amount")).toHaveValue("");

    await expect.poll(async () => (await readAll("expenses")).length).toBe(1);
    const [saved] = await readAll("expenses");
    expect(saved).toMatchObject({
      date: "2026-10-13", farm: "Bhakkarpur Farm", headName: "Diesel for Machinery & Tractor", type: "Outflow",
      amount: 15000, paidBy: "Manager", note: "Tractor diesel", hasAttachment: false, createdBy: admin.uid
    });

    await openTab(page, "list");
    await expect(page.locator("#list-body tr")).toHaveCount(1);
    await expect(page.locator("#list-body tr").first()).toContainText("15,000");
    await expect(page.locator("#list-summary")).toHaveText("1 entry | Total expenses PKR 15,000");
  });

  test("Amjad Ali is saved as BM, so old and new entries stay the same payer", async ({ page, admin }) => {
    await seedHeads(admin.uid);
    await seedEntry({ ...TRANSPORT, date: "2026-05-01", farm: "Fatehpur Farm", amount: 700, paidBy: "BM" });
    await openForm(page, admin);
    await addEntry(page, { amount: "300" });
    await expect.poll(async () => (await readAll("expenses")).map((x) => x.paidBy)).toEqual(["BM", "BM"]);
    await openTab(page, "list");
    await expect(page.locator("#list-body")).toContainText("Amjad Ali");
    await expect(page.locator("#list-body")).not.toContainText("BM");
    await page.locator("#flt-paidby").selectOption({ label: "Amjad Ali" });
    await expect(page.locator("#list-body tr")).toHaveCount(2);
  });
});

test.describe("entries page", () => {
  test("shows notes as text, never as HTML", async ({ page, admin }) => {
    await seedHeads(admin.uid);
    await seedEntry({ ...TRANSPORT, date: "2026-10-01", farm: "Fatehpur Farm", amount: 10, note: `<img src=x onerror="window.hacked=1">` });
    await login(page, admin.email);
    await openTab(page, "list");
    await expect(page.locator("#list-body")).toContainText(`<img src=x onerror="window.hacked=1">`);
    expect(await page.evaluate(() => window.hacked)).toBeUndefined();
  });

  test("edits an entry", async ({ page, admin }) => {
    await seedHeads(admin.uid);
    const id = await seedEntry({ ...TRANSPORT, date: "2026-10-01", farm: "Fatehpur Farm", amount: 500 });
    await login(page, admin.email);
    await openTab(page, "list");
    await page.locator(`[data-edit="${id}"]`).click();
    await expect(page.locator("#expense-form-title")).toHaveText("Edit Entry");
    await expect(page.locator("#f-amount")).toHaveValue("500");
    await page.locator("#f-amount").fill("750");
    await page.locator("#expense-save-btn").click();
    await expect(page.locator("#page-list")).toBeVisible();
    await expect(page.locator("#list-body")).toContainText("750");
    await expect.poll(async () => (await readAll("expenses"))[0].amount).toBe(750);
    const [saved] = await readAll("expenses");
    expect(saved.id).toBe(id);   // same record, not a new one
  });

  test("cancelling an edit changes nothing", async ({ page, admin }) => {
    await seedHeads(admin.uid);
    const id = await seedEntry({ ...TRANSPORT, date: "2026-10-01", farm: "Fatehpur Farm", amount: 500 });
    await login(page, admin.email);
    await openTab(page, "list");
    await page.locator(`[data-edit="${id}"]`).click();
    await page.locator("#f-amount").fill("999");
    await page.locator("#expense-cancel-btn").click();
    await expect(page.locator("#list-body")).toContainText("500");
    expect((await readAll("expenses"))[0].amount).toBe(500);
  });

  test("deletes an entry only after confirmation", async ({ page, admin }) => {
    await seedHeads(admin.uid);
    const id = await seedEntry({ ...TRANSPORT, date: "2026-10-01", farm: "Fatehpur Farm", amount: 500 });
    await login(page, admin.email);
    await openTab(page, "list");

    page.removeAllListeners("dialog");
    let message = "";
    page.once("dialog", (d) => { message = d.message(); d.dismiss(); });
    await page.locator(`[data-delete="${id}"]`).click();
    await expect(page.locator("#list-body tr")).toHaveCount(1);
    expect(message).toContain("Delete this entry?");
    expect(message).toContain("PKR 500");

    page.once("dialog", (d) => d.accept());
    await page.locator(`[data-delete="${id}"]`).click();
    await expect(page.locator("#list-empty")).toBeVisible();
    await expect.poll(async () => (await readAll("expenses")).length).toBe(0);
  });

  test("filters, sorts, totals and exports the filtered rows as CSV", async ({ page, admin }) => {
    await seedHeads(admin.uid);
    await seedEntry({ ...SALES, date: "2026-10-01", farm: "Fatehpur Farm", amount: 9000, note: "Wheat, sold" });
    await seedEntry({ ...TRANSPORT, date: "2026-10-02", farm: "Rehmanbad Farm", amount: 300, note: "Truck", paidBy: "Manager" });
    await seedEntry({ ...TRANSPORT, date: "2026-10-05", farm: "Fatehpur Farm", amount: 200, note: "=cmd" });
    await login(page, admin.email);
    await openTab(page, "list");
    await expect(page.locator("#list-body tr")).toHaveCount(3);
    await expect(page.locator("#list-totals")).toContainText("PKR 500");   // expenses only, not the 9,000 sale

    await page.locator("#flt-farm").selectOption("Fatehpur Farm");
    await expect(page.locator("#list-body tr")).toHaveCount(2);
    await page.locator("#flt-type").selectOption("Outflow");
    await expect(page.locator("#list-body tr")).toHaveCount(1);
    await page.locator("#flt-clear").click();
    await page.locator("#flt-search").fill("truck");
    await expect(page.locator("#list-body tr")).toHaveCount(1);
    await page.locator("#flt-clear").click();
    await page.locator("#flt-paidby").selectOption("Manager");
    await expect(page.locator("#list-body tr")).toHaveCount(1);
    await page.locator("#flt-clear").click();
    await page.locator("#flt-head").selectOption({ label: "Transport" });
    await expect(page.locator("#list-body tr")).toHaveCount(2);
    await expect(page.locator("#list-foot")).toContainText("500");
    await page.locator("#flt-clear").click();
    await page.locator("#flt-from").fill("2026-10-02");
    await page.locator("#flt-to").fill("2026-10-04");
    await expect(page.locator("#list-body tr")).toHaveCount(1);
    await page.locator("#flt-clear").click();
    await expect(page.locator("#list-body tr")).toHaveCount(3);

    await page.locator("#flt-sort").selectOption("amount-desc");
    await expect(page.locator("#list-body tr").first()).toContainText("9,000");
    await page.locator("#flt-sort").selectOption("amount-asc");
    await expect(page.locator("#list-body tr").first()).toContainText("200");

    await page.locator("#flt-farm").selectOption("Fatehpur Farm");
    const [download] = await Promise.all([page.waitForEvent("download"), page.locator("#export-list-btn").click()]);
    const csv = await readDownload(download);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.slice(1).split("\r\n")).toEqual([
      "Date,Farm,Expense Head,Type,Amount (PKR),Paid By,Description,Attachment",
      "2026-10-05,Fatehpur Farm,Transport,Expense,200,Amjad Ali,'=cmd,No",
      '2026-10-01,Fatehpur Farm,Sales,Cash received,9000,Amjad Ali,"Wheat, sold",No',
      "",
      "Total expenses,,,,200",
      "Cash received,,,,9000"
    ]);
  });

  test("shows a helpful empty state that clears the filters", async ({ page, admin }) => {
    await seedHeads(admin.uid);
    await seedEntry({ ...TRANSPORT, date: "2026-10-02", farm: "Fatehpur Farm", amount: 300 });
    await login(page, admin.email);
    await openTab(page, "list");
    await page.locator("#flt-search").fill("nothing like this");
    await expect(page.locator("#list-empty")).toBeVisible();
    await expect(page.locator("#list-empty")).toContainText("No entries match these filters.");
    await page.locator("#list-empty-clear").click();
    await expect(page.locator("#list-body tr")).toHaveCount(1);
  });

  test("the optional cash book shows Inflow, Outflow, running Balance and Opening balance", async ({ page, admin }) => {
    await seedHeads(admin.uid);
    await seedEntry({ ...SALES, date: "2026-09-20", farm: "Fatehpur Farm", amount: 50000 });
    await seedEntry({ ...SALES, date: "2026-10-01", farm: "Fatehpur Farm", amount: 20000 });
    await seedEntry({ ...TRANSPORT, date: "2026-10-03", farm: "Fatehpur Farm", amount: 5000, note: "Truck rent" });
    await login(page, admin.email);
    await openTab(page, "list");
    await expect(page.locator("#list-body td.balance")).toHaveCount(0);   // not the main view
    await page.locator("#flt-cashbook").check();

    const rows = page.locator("#list-body tr");
    await expect(rows).toHaveCount(3);
    // Newest first; Balance runs from the oldest entry
    await expect(rows.nth(0)).toContainText("03 Oct 2026");
    await expect(rows.nth(0).locator("td.balance")).toHaveText("65,000");
    await expect(rows.nth(0)).toContainText("Truck rent");
    await expect(rows.nth(2).locator("td.balance")).toHaveText("50,000");
    await expect(page.locator("#list-foot .ledger-total")).toHaveText(/Total\s*70,000\s*5,000\s*65,000/);
    await expect(page.locator("#list-foot .ledger-opening")).toHaveCount(0);

    await page.locator("#flt-from").fill("2026-10-01");
    await expect(rows).toHaveCount(2);
    await expect(page.locator("#list-foot .ledger-opening")).toHaveText(/Opening balance \(before 01 Oct 2026\)\s*50,000/);
    await expect(page.locator("#list-foot .ledger-total")).toHaveText(/Total\s*20,000\s*5,000\s*65,000/);
  });

  test("long lists show 100 rows at a time with Show more", async ({ page, admin }) => {
    await seedHeads(admin.uid);
    await asAdminDb(async (db) => {
      const batch = db.batch();
      for (let i = 0; i < 130; i++) {
        batch.set(db.collection("expenses").doc(), {
          ...TRANSPORT, date: "2026-10-01", farm: "Fatehpur Farm", amount: 10, paidBy: "BM", note: "",
          hasAttachment: false, attachmentName: "", attachmentType: "", createdBy: "seed", createdAt: serverTime(), updatedAt: serverTime()
        });
      }
      await batch.commit();
    });
    await login(page, admin.email);
    await openTab(page, "list");
    await expect(page.locator("#list-body tr")).toHaveCount(100);
    await expect(page.locator("#list-totals")).toContainText("PKR 1,300");   // the total covers every row
    await page.locator("#list-more").click();
    await expect(page.locator("#list-body tr")).toHaveCount(130);
    await expect(page.locator("#list-more")).toBeHidden();
  });

  test("export with no matching rows shows a message", async ({ page, admin }) => {
    await seedHeads(admin.uid);
    await login(page, admin.email);
    await openTab(page, "list");
    await page.locator("#export-list-btn").click();
    await expect(page.locator("#toast")).toHaveText("Nothing to export");
  });

  test("an entry added on one device appears on another without refreshing", async ({ page, admin, browser }) => {
    await seedHeads(admin.uid);
    await login(page, admin.email);
    await openTab(page, "list");

    const other = await browser.newContext({ serviceWorkers: "block" });
    const otherPage = await other.newPage();
    await openForm(otherPage, admin);
    await addEntry(otherPage, { amount: "4321" });
    await expect(page.locator("#list-body")).toContainText("4,321");
    await other.close();
  });

  test("works offline and syncs when internet returns", async ({ page, admin, context }) => {
    await seedHeads(admin.uid);
    await openForm(page, admin);
    await expect(page.locator("#f-head option")).toHaveCount(13);
    await context.setOffline(true);
    await expect(page.locator("#offline-banner")).toBeVisible();
    await addEntry(page, { amount: "2222" });
    await expect(page.locator("#toast")).toHaveText("Saved offline - will sync when online");
    await context.setOffline(false);
    await expect(page.locator("#offline-banner")).toBeHidden();
    await expect.poll(async () => (await readAll("expenses")).map((x) => x.amount), { timeout: 30000 }).toEqual([2222]);
  });
});
