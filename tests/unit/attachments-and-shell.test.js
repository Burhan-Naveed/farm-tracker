import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { ATTACHMENT, LIMITS } from "../../src/config.js";
import { attachmentError, dataUrlBytes, dataUrlToBlob, fileKind, storedFileName } from "../../src/domain/attachments.js";

const ROOT = join(import.meta.dirname, "..", "..");

describe("attachments", () => {
  it("recognises photos and PDFs only", () => {
    expect(fileKind("application/pdf")).toBe("pdf");
    expect(fileKind("image/png")).toBe("image");
    expect(fileKind("image/heic")).toBe("image");
    expect(fileKind("text/html")).toBe(null);
    expect(fileKind("")).toBe(null);
    expect(fileKind(undefined)).toBe(null);
  });
  it("renames photos to .jpg and keeps PDF names", () => {
    expect(storedFileName("slip.png", "image")).toBe("slip.jpg");
    expect(storedFileName("bill.pdf", "pdf")).toBe("bill.pdf");
    expect(storedFileName("", "image")).toBe("attachment.jpg");
  });
  it("shortens very long names to the limit", () => {
    const name = storedFileName("a".repeat(500) + ".pdf", "pdf");
    expect(name).toHaveLength(LIMITS.fileNameMax);
    expect(name.endsWith(".pdf")).toBe(true);
  });
  it("estimates the file size of a data URL", () => {
    expect(dataUrlBytes("data:application/pdf;base64,QUJD")).toBe(3);
  });
  it("accepts a small JPEG or PDF data URL", () => {
    expect(attachmentError("data:image/jpeg;base64,QUJD", 3)).toBe("");
    expect(attachmentError("data:application/pdf;base64,QUJD", 3)).toBe("");
  });
  it("rejects other file types and broken data", () => {
    expect(attachmentError("data:text/html;base64,QUJD")).toMatch(/could not be read/);
    expect(attachmentError("not a data url")).toMatch(/could not be read/);
    expect(attachmentError(null)).toMatch(/could not be read/);
  });
  it("rejects files over the size limit with the file size in the message", () => {
    const big = "data:application/pdf;base64," + "A".repeat(ATTACHMENT.maxChars);
    expect(attachmentError(big, 2 * 1048576)).toBe("This file is 2.0 MB. The limit is about 650 KB. Please attach a photo or screenshot instead.");
  });
  it("turns a data URL back into a file", async () => {
    const blob = dataUrlToBlob("data:application/pdf;base64,QUJD");
    expect(blob.type).toBe("application/pdf");
    expect(await blob.text()).toBe("ABC");
  });
  it("throws on damaged base64 data", () => {
    expect(() => dataUrlToBlob("data:image/jpeg;base64,***")).toThrow();
  });
});

describe("service worker app shell", () => {
  /** Lists every file in a folder, recursively. */
  const listFiles = (dir) => readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? listFiles(path) : [path];
  });

  it("caches every app module, so the app opens offline", () => {
    const worker = readFileSync(join(ROOT, "service-worker.js"), "utf8");
    const missing = listFiles(join(ROOT, "src"))
      .map((path) => "./" + relative(ROOT, path).replace(/\\/g, "/"))
      .filter((path) => !worker.includes(`"${path}"`));
    expect(missing).toEqual([]);
  });
  it("only lists files that exist", () => {
    const worker = readFileSync(join(ROOT, "service-worker.js"), "utf8");
    const localFiles = [...worker.matchAll(/"(\.\/[^"]+\.[a-z]+)"/g)].map((m) => m[1]);
    expect(localFiles.length).toBeGreaterThan(10);
    localFiles.forEach((path) => expect(statSync(join(ROOT, path)).isFile()).toBe(true));
  });
  it("index.html loads the app from src/main.js", () => {
    expect(readFileSync(join(ROOT, "index.html"), "utf8")).toContain('src="./src/main.js"');
  });
});
