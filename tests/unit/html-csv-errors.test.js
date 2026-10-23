import { afterEach, describe, expect, it, vi } from "vitest";
import { escapeHtml, optionsHtml, tableRowsHtml } from "../../src/lib/html.js";
import { buildCsv, csvCell } from "../../src/lib/csv.js";
import { logError, userMessage } from "../../src/lib/errors.js";

describe("escapeHtml", () => {
  it("escapes every HTML special character", () => {
    expect(escapeHtml(`<img src=x onerror="alert('x')">&`))
      .toBe("&lt;img src=x onerror=&quot;alert(&#39;x&#39;)&quot;&gt;&amp;");
  });
  it("turns null and undefined into empty text", () => {
    expect(escapeHtml(null)).toBe("");
    expect(escapeHtml(undefined)).toBe("");
  });
  it("converts numbers to text", () => {
    expect(escapeHtml(42)).toBe("42");
  });
});

describe("optionsHtml", () => {
  it("escapes values and labels", () => {
    expect(optionsHtml([{ value: `a"b`, label: "<x>" }])).toBe(`<option value="a&quot;b">&lt;x&gt;</option>`);
  });
});

describe("tableRowsHtml", () => {
  const columns = [
    { label: "Name", cell: (r) => escapeHtml(r.name) },
    { label: "Amount", className: "num", cell: (r) => String(r.amount) },
    { className: (r) => (r.amount > 5 ? "big" : "small"), cell: () => "x" }
  ];
  it("adds phone labels and classes", () => {
    const html = tableRowsHtml(columns, [{ name: "A", amount: 10 }]);
    expect(html).toBe(`<tr><td data-label="Name">A</td><td data-label="Amount" class="num">10</td><td class="big">x</td></tr>`);
  });
  it("returns nothing for no rows", () => {
    expect(tableRowsHtml(columns, [])).toBe("");
  });
});

describe("csvCell / buildCsv", () => {
  it("keeps numbers as plain numbers", () => {
    expect(csvCell(15000)).toBe("15000");
    expect(csvCell(-250)).toBe("-250");
  });
  it("writes non-finite numbers as empty cells", () => {
    expect(csvCell(NaN)).toBe("");
    expect(csvCell(Infinity)).toBe("");
  });
  it("quotes text with commas, quotes or line breaks", () => {
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("line1\nline2")).toBe('"line1\nline2"');
  });
  it("blocks spreadsheet formulas (CSV injection)", () => {
    expect(csvCell("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(csvCell("+1")).toBe("'+1");
    expect(csvCell("-2")).toBe("'-2");
    expect(csvCell("@cmd")).toBe("'@cmd");
    expect(csvCell("\tx")).toBe("'\tx");
  });
  it("writes empty values as empty cells", () => {
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
  });
  it("starts with a BOM and uses Windows line endings", () => {
    const text = buildCsv([["Date", "Note"], ["2026-10-13", "ڈیزل"]]);
    expect(text.charCodeAt(0)).toBe(0xfeff);
    expect(text.slice(1)).toBe("Date,Note\r\n2026-10-13,ڈیزل");
  });
});

describe("errors", () => {
  afterEach(() => vi.restoreAllMocks());

  it("maps known Firebase codes to clear messages", () => {
    expect(userMessage({ code: "auth/invalid-credential" })).toBe("Wrong email or password.");
    expect(userMessage({ code: "permission-denied" })).toBe("You do not have permission for this action.");
  });
  it("uses the fallback for unknown errors", () => {
    expect(userMessage({ code: "weird" }, "Fallback")).toBe("Fallback");
    expect(userMessage(null)).toBe("Something went wrong. Please try again.");
  });
  it("logs with context for developers", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const err = new Error("boom");
    logError("Saving entry", err);
    expect(spy).toHaveBeenCalledWith("[Farm Tracker] Saving entry:", err);
  });
});
