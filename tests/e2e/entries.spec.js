import { expect, login, openTab, readAll, readDownload, seedEntry, seedHeads, selectHead, test } from "./support.js";

/** Fills and submits the Add Entry form. */
async function addEntry(page, { date, farm = "Fatehpur Farm", head = "Transport", amount = "1500", paidBy, note } = {}) {
  if (date) await page.locator("#f-date").fill(date);
  if (farm) await page.locator("#f-farm").selectOption(farm);
  if (head) await selectHead(page.locator("#f-head"), head);
  await page.locator("#f-amount").fill(amount);
  if (paidBy) await page.locator("#f-paidby").selectOption(paidBy);
  if (note !== undefined) await page.locator("#f-note").fill(note);
  await page.locator("#expense-save-btn").click();
}

test.describe("entries", () => {
  test("first Admin login creates the 12 default heads", async ({ page, admin }) => {
    await login(page, admin.email);
    await expect(page.locator("#f-head option")).toHaveCount(13);   // 12 heads + "Select head"
    await expect(page.locator('#f-head optgroup[label="Inflow"] option')).toHaveCount(2);
    await expect.poll(async () => (await readAll("heads")).length).toBe(12);
  });

  test("validates the form before saving", async ({ page, admin }) => {
    await seedHeads(admin.uid);
    await login(page, admin.email);
    await addEntry(page, { farm: "" });
    await expect(page.locator("#expense-error")).toHaveText("Please select a farm.");
    await addEntry(page, { amount: "0" });
    await expect(page.locator("#expense-error")).toHaveText("Amount must be at least 1 rupee.");
    expect(await readAll("expenses")).toHaveLength(0);
  });

  test("adds an entry, keeps date and farm for the next one", async ({ page, admin }) => {
    await seedHeads(admin.uid);
    await login(page, admin.email);
    await addEntry(page, { date: "2026-10-13", farm: "Bhakkarpur Farm", head: "Diesel for Machinery & Tractor", amount: "15000", paidBy: "Manager", note: "Tractor diesel" });
    await expect(page.locator("#toast")).toHaveText("Saved");
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
    await expect(page.locator("#list-body tr").first()).toContainText("PKR 15,000");
    await expect(page.locator("#list-summary")).toHaveText("1 entry | Inflow PKR 0 | Outflow PKR 15,000");
  });

  test("shows notes as text, never as HTML", async ({ page, admin }) => {
    await seedHeads(admin.uid);
    await seedEntry({ date: "2026-10-01", farm: "Fatehpur Farm", headId: "default-06", headName: "Transport", type: "Outflow", amount: 10, note: `<img src=x onerror="window.hacked=1">` });
    await login(page, admin.email);
    await openTab(page, "list");
    await expect(page.locator("#list-body")).toContainText(`<img src=x onerror="window.hacked=1">`);
    expect(await page.evaluate(() => window.hacked)).toBeUndefined();
  });

  test("edits an entry", async ({ page, admin }) => {
    await seedHeads(admin.uid);
    const id = await seedEntry({ date: "2026-10-01", farm: "Fatehpur Farm", headId: "default-06", headName: "Transport", type: "Outflow", amount: 500 });
    await login(page, admin.email);
    await openTab(page, "list");
    await page.locator(`[data-edit="${id}"]`).click();
    await expect(page.locator("#expense-form-title")).toHaveText("Edit Entry");
    await expect(page.locator("#f-amount")).toHaveValue("500");
    await page.locator("#f-amount").fill("750");
    await page.locator("#expense-save-btn").click();
    await expect(page.locator("#page-list")).toBeVisible();
    await expect(page.locator("#list-body")).toContainText("PKR 750");
    await expect.poll(async () => (await readAll("expenses"))[0].amount).toBe(750);
  });

  test("cancelling an edit changes nothing", async ({ page, admin }) => {
    await seedHeads(admin.uid);
    const id = await seedEntry({ date: "2026-10-01", farm: "Fatehpur Farm", headId: "default-06", headName: "Transport", type: "Outflow", amount: 500 });
    await login(page, admin.email);
    await openTab(page, "list");
    await page.locator(`[data-edit="${id}"]`).click();
    await page.locator("#f-amount").fill("999");
    await page.locator("#expense-cancel-btn").click();
    await expect(page.locator("#list-body")).toContainText("PKR 500");
    expect((await readAll("expenses"))[0].amount).toBe(500);
  });

  test("deletes an entry only after confirmation", async ({ page, admin }) => {
    await seedHeads(admin.uid);
    const id = await seedEntry({ date: "2026-10-01", farm: "Fatehpur Farm", headId: "default-06", headName: "Transport", type: "Outflow", amount: 500 });
    await login(page, admin.email);
    await openTab(page, "list");

    page.removeAllListeners("dialog");
    page.once("dialog", (d) => d.dismiss());
    await page.locator(`[data-delete="${id}"]`).click();
    await expect(page.locator("#list-body tr")).toHaveCount(1);

    page.once("dialog", (d) => d.accept());
    await page.locator(`[data-delete="${id}"]`).click();
    await expect(page.locator("#list-empty")).toBeVisible();
    await expect.poll(async () => (await readAll("expenses")).length).toBe(0);
  });

  test("filters the list and exports the filtered rows as CSV", async ({ page, admin }) => {
    await seedHeads(admin.uid);
    await seedEntry({ date: "2026-10-01", farm: "Fatehpur Farm", headId: "default-01", headName: "Sales", type: "Inflow", amount: 9000, note: "Wheat, sold" });
    await seedEntry({ date: "2026-10-02", farm: "Rehmanbad Farm", headId: "default-06", headName: "Transport", type: "Outflow", amount: 300, note: "Truck" });
    await seedEntry({ date: "2026-10-05", farm: "Fatehpur Farm", headId: "default-06", headName: "Transport", type: "Outflow", amount: 200, note: "=cmd" });
    await login(page, admin.email);
    await openTab(page, "list");
    await expect(page.locator("#list-body tr")).toHaveCount(3);

    await page.locator("#flt-farm").selectOption("Fatehpur Farm");
    await expect(page.locator("#list-body tr")).toHaveCount(2);
    await page.locator("#flt-type").selectOption("Outflow");
    await expect(page.locator("#list-body tr")).toHaveCount(1);
    await page.locator("#flt-clear").click();
    await page.locator("#flt-search").fill("truck");
    await expect(page.locator("#list-body tr")).toHaveCount(1);
    await page.locator("#flt-clear").click();
    await page.locator("#flt-from").fill("2026-10-02");
    await page.locator("#flt-to").fill("2026-10-04");
    await expect(page.locator("#list-body tr")).toHaveCount(1);
    await page.locator("#flt-clear").click();
    await expect(page.locator("#list-body tr")).toHaveCount(3);

    await page.locator("#flt-farm").selectOption("Fatehpur Farm");
    const [download] = await Promise.all([page.waitForEvent("download"), page.locator("#export-list-btn").click()]);
    const csv = await readDownload(download);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.slice(1).split("\r\n")).toEqual([
      "Date,Farm,Head,Type,Amount (PKR),Paid By,Note,Attachment",
      "2026-10-05,Fatehpur Farm,Transport,Outflow,200,BM,'=cmd,No",
      '2026-10-01,Fatehpur Farm,Sales,Inflow,9000,BM,"Wheat, sold",No'
    ]);
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
    await login(otherPage, admin.email);
    await addEntry(otherPage, { amount: "4321" });
    await expect(page.locator("#list-body")).toContainText("PKR 4,321");
    await other.close();
  });

  test("works offline and syncs when internet returns", async ({ page, admin, context }) => {
    await seedHeads(admin.uid);
    await login(page, admin.email);
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
