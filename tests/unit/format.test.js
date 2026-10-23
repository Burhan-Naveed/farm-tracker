import { describe, expect, it } from "vitest";
import {
  addMoney, cleanText, formatMoney, formatNumber, formatSize, isValidDateString, isValidMonthString,
  monthLabelOf, normalizeName, percentOf, pluralEntries, rangeLabel, shortDate, slugify, toDateString
} from "../../src/lib/format.js";

describe("formatNumber / formatMoney", () => {
  it("adds thousands separators and rounds to whole rupees", () => {
    expect(formatNumber(125000)).toBe("125,000");
    expect(formatNumber(999.5)).toBe("1,000");
  });
  it("treats empty values as zero", () => {
    expect(formatNumber(undefined)).toBe("0");
    expect(formatNumber(null)).toBe("0");
    expect(formatMoney("")).toBe("PKR 0");
  });
  it("puts the minus sign before the currency", () => {
    expect(formatMoney(1500)).toBe("PKR 1,500");
    expect(formatMoney(-1000)).toBe("-PKR 1,000");
  });
});

describe("addMoney", () => {
  it("avoids floating point errors", () => {
    expect(addMoney(0.1, 0.2)).toBe(0.3);
  });
  it("subtracts with a negative value", () => {
    expect(addMoney(500, -750)).toBe(-250);
  });
  it("accepts numeric strings", () => {
    expect(addMoney("10", 5)).toBe(15);
  });
});

describe("percentOf", () => {
  it("returns a whole percentage", () => {
    expect(percentOf(1, 3)).toBe(33);
  });
  it("returns 0 when the total is 0", () => {
    expect(percentOf(5, 0)).toBe(0);
  });
});

describe("formatSize", () => {
  it("shows KB below 1 MB and never 0 KB", () => {
    expect(formatSize(1)).toBe("1 KB");
    expect(formatSize(250 * 1024)).toBe("250 KB");
  });
  it("shows MB with one decimal", () => {
    expect(formatSize(1.5 * 1048576)).toBe("1.5 MB");
  });
});

describe("dates", () => {
  it("formats a local date as YYYY-MM-DD", () => {
    expect(toDateString(new Date(2026, 0, 5))).toBe("2026-01-05");
  });
  it("accepts only real calendar dates", () => {
    expect(isValidDateString("2026-10-13")).toBe(true);
    expect(isValidDateString("2024-02-29")).toBe(true);
    expect(isValidDateString("2026-02-30")).toBe(false);
    expect(isValidDateString("2026-13-01")).toBe(false);
    expect(isValidDateString("13-10-2026")).toBe(false);
    expect(isValidDateString("")).toBe(false);
    expect(isValidDateString(undefined)).toBe(false);
  });
  it("accepts only YYYY-MM months", () => {
    expect(isValidMonthString("2026-10")).toBe(true);
    expect(isValidMonthString("2026-00")).toBe(false);
    expect(isValidMonthString("2026-1")).toBe(false);
    expect(isValidMonthString(null)).toBe(false);
  });
  it("builds readable labels", () => {
    expect(monthLabelOf("2026-10")).toBe("October 2026");
    expect(shortDate("2026-10-01")).toBe("01 Oct 2026");
    expect(shortDate("")).toBe("");
  });
  it("describes every kind of date range", () => {
    expect(rangeLabel("2026-10-01", "2026-10-14")).toBe("01 Oct 2026 to 14 Oct 2026");
    expect(rangeLabel("2026-10-01", "")).toBe("from 01 Oct 2026");
    expect(rangeLabel("", "2026-10-14")).toBe("up to 14 Oct 2026");
    expect(rangeLabel("", "")).toBe("all dates");
  });
});

describe("text helpers", () => {
  it("slugify makes safe file names", () => {
    expect(slugify("Fatehpur Farm")).toBe("fatehpur-farm");
    expect(slugify("  Diesel for Machinery & Tractor! ")).toBe("diesel-for-machinery-tractor");
    expect(slugify(undefined)).toBe("");
  });
  it("cleanText trims and collapses spaces", () => {
    expect(cleanText("  Misc   Expenses ")).toBe("Misc Expenses");
  });
  it("normalizeName ignores case and extra spaces", () => {
    expect(normalizeName(" SALES  Tax")).toBe(normalizeName("sales tax"));
  });
  it("pluralEntries", () => {
    expect(pluralEntries(1)).toBe("1 entry");
    expect(pluralEntries(0)).toBe("0 entries");
    expect(pluralEntries(3)).toBe("3 entries");
  });
});
