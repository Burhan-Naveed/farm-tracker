// The security rules cannot import src/config.js, so the same lists and
// limits are written in both places. This test fails if they drift apart.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ATTACHMENT, CONFIG, LIMITS } from "../../src/config.js";

const rules = readFileSync(join(import.meta.dirname, "..", "..", "firestore.rules"), "utf8");

/** Reads the value returned by a rules helper function, e.g. function farms() { return [...]; } */
function rulesValue(name) {
  const match = rules.match(new RegExp(`function ${name}\\(\\)\\s*\\{\\s*return ([^;]+);`));
  if (!match) throw new Error(`function ${name}() not found in firestore.rules`);
  return JSON.parse(match[1].replace(/'/g, '"'));
}

describe("firestore.rules matches src/config.js", () => {
  it("farms", () => expect(rulesValue("farms")).toEqual(CONFIG.farms));
  it("Paid By options", () => expect(rulesValue("paidByOptions")).toEqual(CONFIG.paidByOptions));
  it("limits", () => {
    expect(rulesValue("maxAmount")).toBe(LIMITS.maxAmount);
    expect(rulesValue("noteMax")).toBe(LIMITS.noteMax);
    expect(rulesValue("headNameMax")).toBe(LIMITS.headNameMax);
    expect(rulesValue("userNameMax")).toBe(LIMITS.userNameMax);
    expect(rulesValue("fileNameMax")).toBe(LIMITS.fileNameMax);
    expect(rulesValue("auditDetailsMax")).toBe(LIMITS.auditDetailsMax);
    expect(rulesValue("attachmentMaxChars")).toBe(ATTACHMENT.maxChars);
  });
});
