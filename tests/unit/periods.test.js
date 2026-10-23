import { describe, expect, it } from "vitest";
import { monthRange, monthsBetween, nextMonth, periodOf, periodRange, previousMonth } from "../../src/domain/periods.js";

const TODAY = "2026-10-23";

describe("periods", () => {
  it("this month and this year end today", () => {
    expect(periodRange("this-month", TODAY)).toEqual({ from: "2026-10-01", to: "2026-10-23" });
    expect(periodRange("this-year", TODAY)).toEqual({ from: "2026-01-01", to: "2026-10-23" });
  });
  it("last month and last year are complete", () => {
    expect(periodRange("last-month", TODAY)).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(periodRange("last-month", "2026-01-10")).toEqual({ from: "2025-12-01", to: "2025-12-31" });
    expect(periodRange("last-month", "2024-03-05")).toEqual({ from: "2024-02-01", to: "2024-02-29" });   // leap year
    expect(periodRange("last-year", TODAY)).toEqual({ from: "2025-01-01", to: "2025-12-31" });
  });
  it("all and custom have no fixed dates", () => {
    expect(periodRange("all", TODAY)).toEqual({ from: "", to: "" });
    expect(periodRange("custom", TODAY)).toEqual({ from: "", to: "" });
  });
  it("recognises the period of a date pair", () => {
    expect(periodOf({ from: "2026-09-01", to: "2026-09-30" }, TODAY)).toBe("last-month");
    expect(periodOf({ from: "", to: "" }, TODAY)).toBe("all");
    expect(periodOf({ from: "2026-09-05", to: "2026-09-30" }, TODAY)).toBe("custom");
  });
  it("moves between months across years", () => {
    expect(previousMonth("2026-01")).toBe("2025-12");
    expect(nextMonth("2026-12")).toBe("2027-01");
    expect(monthRange("2026-02")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(monthsBetween("2025-11", "2026-02")).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
    expect(monthsBetween("2026-03", "2026-02")).toEqual([]);
  });
});
