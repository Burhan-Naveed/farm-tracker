import { expect, login, openTab, readAll, seedHeads, selectHead, test } from "./support.js";

// A real 1x1 pixel PNG
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const PDF = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");

async function fillEntry(page, amount = "800") {
  await page.locator("#f-farm").selectOption("Fatehpur Farm");
  await selectHead(page.locator("#f-head"), "Purchase");
  await page.locator("#f-amount").fill(amount);
}

test.describe("attachments", () => {
  test.beforeEach(async ({ page, admin }) => {
    await seedHeads(admin.uid);
    await login(page, admin.email);
    await openTab(page, "add");
    await expect(page.locator("#f-head option")).toHaveCount(13);
  });

  test("saves a photo with the entry and shows it in the viewer", async ({ page }) => {
    await fillEntry(page);
    await page.locator("#f-attach").setInputFiles({ name: "slip.png", mimeType: "image/png", buffer: PNG });
    await expect(page.locator("#attach-name")).toHaveText("slip.jpg");
    await expect(page.locator("#attach-thumb")).toBeVisible();
    await page.locator("#expense-save-btn").click();
    await expect(page.locator("#attach-pick-btn")).toBeVisible();   // form cleared

    await expect.poll(async () => (await readAll("attachments")).length).toBe(1);
    const [entry] = await readAll("expenses");
    const [file] = await readAll("attachments");
    expect(entry).toMatchObject({ hasAttachment: true, attachmentName: "slip.jpg", attachmentType: "image/jpeg" });
    expect(file).toMatchObject({ expenseId: entry.id, type: "image/jpeg", name: "slip.jpg" });
    expect(file.data.startsWith("data:image/jpeg;base64,")).toBe(true);

    await openTab(page, "list");
    await page.locator(`#list-body [data-view="${entry.id}"]`).click();
    await expect(page.locator("#viewer")).toBeVisible();
    await expect(page.locator("#viewer-body img")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator("#viewer")).toBeHidden();
  });

  test("saves a small PDF", async ({ page }) => {
    await fillEntry(page);
    await page.locator("#f-attach").setInputFiles({ name: "bill.pdf", mimeType: "application/pdf", buffer: PDF });
    await expect(page.locator("#attach-pdf-icon")).toHaveText("PDF");
    await page.locator("#expense-save-btn").click();
    await expect.poll(async () => (await readAll("attachments")).map((a) => a.name)).toEqual(["bill.pdf"]);
  });

  test("rejects files that are not a photo or PDF", async ({ page }) => {
    await page.locator("#f-attach").setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello") });
    await expect(page.locator("#toast")).toHaveText("Please choose a photo or a PDF file.");
    await expect(page.locator("#attach-preview")).toBeHidden();
  });

  test("rejects a PDF over the size limit", async ({ page }) => {
    const big = Buffer.concat([PDF, Buffer.alloc(800 * 1024, 65)]);
    await page.locator("#f-attach").setInputFiles({ name: "big.pdf", mimeType: "application/pdf", buffer: big });
    await expect(page.locator("#toast")).toContainText("The limit is about 650 KB");
    await expect(page.locator("#attach-preview")).toBeHidden();
    await expect(page.locator("#expense-save-btn")).toBeEnabled();
  });

  test("removing the attachment while editing deletes it on update", async ({ page }) => {
    await fillEntry(page);
    await page.locator("#f-attach").setInputFiles({ name: "bill.pdf", mimeType: "application/pdf", buffer: PDF });
    await page.locator("#expense-save-btn").click();
    await expect.poll(async () => (await readAll("attachments")).length).toBe(1);
    const [entry] = await readAll("expenses");

    await openTab(page, "list");
    await page.locator(`[data-edit="${entry.id}"]`).click();
    await expect(page.locator("#attach-size")).toHaveText("Already attached");
    await page.locator("#attach-remove-btn").click();
    await page.locator("#expense-save-btn").click();
    await expect.poll(async () => (await readAll("attachments")).length).toBe(0);
    expect((await readAll("expenses"))[0]).toMatchObject({ hasAttachment: false, attachmentName: "" });
  });

  test("deleting an entry also deletes its attachment", async ({ page }) => {
    await fillEntry(page);
    await page.locator("#f-attach").setInputFiles({ name: "bill.pdf", mimeType: "application/pdf", buffer: PDF });
    await page.locator("#expense-save-btn").click();
    await expect.poll(async () => (await readAll("attachments")).length).toBe(1);
    const [entry] = await readAll("expenses");
    await openTab(page, "list");
    await page.locator(`[data-delete="${entry.id}"]`).click();
    await expect.poll(async () => (await readAll("attachments")).length + (await readAll("expenses")).length).toBe(0);
  });
});
