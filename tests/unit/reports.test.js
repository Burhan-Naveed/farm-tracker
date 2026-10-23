import { describe, expect, it } from "vitest";
import { buildFarmReport, buildHeadReport, buildTotalReport, orderedRange, zeroByFarm } from "../../src/domain/reports.js";
import { HEADS, HEAD_MAP, entry } from "./fixtures.js";

const F = "Fatehpur Farm";
const B = "Bhakkarpur Farm";
const R = "Rehmanbad Farm";
const OCT = { from: "2026-10-01", to: "2026-10-31" };

const entries = [
  entry({ date: "2026-10-01", farm: F, headId: "sales", type: "Inflow", amount: 10000, hasAttachment: true }),
  entry({ date: "2026-10-02", farm: F, headId: "diesel", amount: 2500 }),
  entry({ date: "2026-10-02", farm: B, headId: "diesel", amount: 1500 }),
  entry({ date: "2026-10-20", farm: R, headId: "old", headName: "Old Head", amount: 300 }),
  entry({ date: "2026-09-30", farm: F, headId: "diesel", amount: 999 }),       // other month
  entry({ date: "2026-10-05", farm: "Unknown Farm", headId: "diesel", amount: 50 }) // ignored farm
];

describe("buildTotalReport", () => {
  const report = buildTotalReport(entries, HEADS, HEAD_MAP, OCT);

  it("totals inflow and outflow per farm and overall for the month only", () => {
    expect(report.totals.Inflow.total).toBe(10000);
    expect(report.totals.Outflow.total).toBe(4300);
    expect(report.totals.Outflow.byFarm).toEqual({ [F]: 2500, [B]: 1500, [R]: 300 });
    expect(report.count).toBe(4);
  });
  it("calculates net per farm and overall (can be negative)", () => {
    expect(report.net.total).toBe(5700);
    expect(report.net.byFarm).toEqual({ [F]: 7500, [B]: -1500, [R]: -300 });
  });
  it("shows every active head, plus inactive heads that have entries", () => {
    expect(report.rows.map((r) => r.id)).toEqual(["sales", "diesel", "old", "salary"]);
    expect(report.rows.find((r) => r.id === "salary").total).toBe(0);
    expect(report.rows.find((r) => r.id === "old").active).toBe(false);
  });
  it("hides inactive heads without entries", () => {
    const quiet = buildTotalReport([], HEADS, HEAD_MAP, OCT);
    expect(quiet.rows.some((r) => r.id === "old")).toBe(false);
    expect(quiet.net.total).toBe(0);
  });
  it("keeps entries of deleted heads using their saved name and type", () => {
    const r = buildTotalReport([entry({ date: "2026-10-01", headId: "gone", headName: "Gone", type: "Inflow", amount: 70 })], HEADS, HEAD_MAP, OCT);
    const row = r.rows.find((x) => x.id === "gone");
    expect(row).toMatchObject({ name: "Gone", type: "Inflow", active: false, total: 70 });
    expect(r.totals.Inflow.total).toBe(70);
  });
  it("ignores entries with a missing date", () => {
    expect(buildTotalReport([entry({ date: undefined })], HEADS, HEAD_MAP, OCT).count).toBe(0);
  });
});

describe("date ranges in Total Report", () => {
  it("covers several months, and an open range covers everything", () => {
    expect(buildTotalReport(entries, HEADS, HEAD_MAP, { from: "2026-09-01", to: "2026-10-31" }).count).toBe(5);
    expect(buildTotalReport(entries, HEADS, HEAD_MAP, { from: "", to: "" }).count).toBe(5);
  });
  it("includes both end dates", () => {
    expect(buildTotalReport(entries, HEADS, HEAD_MAP, { from: "2026-10-02", to: "2026-10-02" }).count).toBe(2);
  });
});

describe("buildFarmReport", () => {
  const r = buildFarmReport(entries, HEAD_MAP, OCT, F);

  it("only includes the farm's entries of the month, oldest first", () => {
    expect(r.entries.map((x) => x.date)).toEqual(["2026-10-01", "2026-10-02"]);
  });
  it("totals per type and net", () => {
    expect(r.totals).toEqual({ Inflow: 10000, Outflow: 2500 });
    expect(r.net).toBe(7500);
  });
  it("lists used heads, biggest first, with counts", () => {
    expect(r.heads).toEqual([
      { name: "Sales", type: "Inflow", total: 10000, count: 1 },
      { name: "Diesel", type: "Outflow", total: 2500, count: 1 }
    ]);
  });
  it("counts inflow entries and slips", () => {
    expect(r.inflowCount).toBe(1);
    expect(r.slipCount).toBe(1);
  });
  it("is empty for a month without entries", () => {
    const empty = buildFarmReport(entries, HEAD_MAP, { from: "2025-01-01", to: "2025-01-31" }, F);
    expect(empty).toMatchObject({ entries: [], heads: [], net: 0, inflowCount: 0, slipCount: 0 });
  });
});

describe("buildHeadReport", () => {
  it("totals one head across all farms, by farm and by month", () => {
    const r = buildHeadReport(entries, { headId: "diesel", farm: "", from: "", to: "" });
    expect(r.total).toBe(5049);
    expect(r.byFarm).toEqual({ [F]: 3499, [B]: 1500, [R]: 0 });
    expect([...r.byMonth.entries()]).toEqual([["2026-09", 999], ["2026-10", 4050]]);
    expect(r.largest).toBe(2500);
    expect(r.average).toBeCloseTo(5049 / 4);
  });
  it("filters by farm and date range (inclusive)", () => {
    const r = buildHeadReport(entries, { headId: "diesel", farm: F, from: "2026-10-01", to: "2026-10-02" });
    expect(r.entries).toHaveLength(1);
    expect(r.total).toBe(2500);
  });
  it("returns zeros when nothing matches", () => {
    const r = buildHeadReport(entries, { headId: "salary", farm: "", from: "", to: "" });
    expect(r).toMatchObject({ total: 0, largest: 0, average: 0, slipCount: 0 });
    expect(r.byFarm).toEqual(zeroByFarm());
  });
});

describe("orderedRange", () => {
  it("swaps dates entered the wrong way round", () => {
    expect(orderedRange("2026-10-31", "2026-10-01")).toEqual({ from: "2026-10-01", to: "2026-10-31" });
  });
  it("keeps a correct or open range as it is", () => {
    expect(orderedRange("2026-10-01", "2026-10-31")).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    expect(orderedRange("", "2026-10-01")).toEqual({ from: "", to: "2026-10-01" });
  });
});
