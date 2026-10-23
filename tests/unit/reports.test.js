import { describe, expect, it } from "vitest";
import { headsById } from "../../src/domain/heads.js";
import { buildExpenseAnalysis, buildTotalReport, orderedRange } from "../../src/domain/reports.js";
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

describe("buildExpenseAnalysis", () => {
  const all = [
    ...entries,
    entry({ date: "2026-10-07", farm: B, headId: "salary", amount: 4000, paidBy: "Manager" }),
    entry({ date: "2026-08-15", farm: R, headId: "salary", amount: 600 })
  ];
  const a = buildExpenseAnalysis(all, HEAD_MAP, OCT);

  it("counts only expenses (Outflow), not cash received, inside the dates", () => {
    expect(a.total).toBe(8300);
    expect(a.count).toBe(4);
    expect(a.entries.every((x) => x.headId !== "sales")).toBe(true);
  });
  it("gives farm totals with their share, in the usual farm order", () => {
    expect(a.farms).toEqual([
      { farm: F, total: 2500, count: 1, share: 30 },
      { farm: B, total: 5500, count: 2, share: 66 },
      { farm: R, total: 300, count: 1, share: 4 }
    ]);
    expect(a.highestFarm.farm).toBe(B);
  });
  it("lists heads biggest first, with farm columns and share", () => {
    expect(a.heads.map((h) => [h.name, h.total, h.count])).toEqual([["Diesel", 4000, 2], ["Salary", 4000, 1], ["Old Head", 300, 1]]);
    expect(a.heads[0].byFarm).toEqual({ [F]: 2500, [B]: 1500, [R]: 0 });
    expect(a.heads.find((h) => h.id === "old").active).toBe(false);
    expect(a.highestHead.name).toBe("Diesel");
  });
  it("groups payers with the Amjad Ali label for BM", () => {
    expect(a.payers.map((p) => [p.value, p.name, p.total])).toEqual([["BM", "Amjad Ali", 4300], ["Manager", "Manager", 4000]]);
  });
  it("never double counts: every grouping adds up to the same total", () => {
    const sum = (rows) => rows.reduce((t, r) => t + r.total, 0);
    expect(sum(a.farms)).toBe(a.total);
    expect(sum(a.heads)).toBe(a.total);
    expect(sum(a.payers)).toBe(a.total);
    expect(sum(a.months)).toBe(a.total);
    a.heads.forEach((h) => expect(Object.values(h.byFarm).reduce((t, v) => t + v, 0)).toBe(h.total));
  });
  it("filters by farm, head and payer", () => {
    expect(buildExpenseAnalysis(all, HEAD_MAP, { ...OCT, farm: B }).total).toBe(5500);
    expect(buildExpenseAnalysis(all, HEAD_MAP, { ...OCT, headId: "diesel" }).total).toBe(4000);
    expect(buildExpenseAnalysis(all, HEAD_MAP, { ...OCT, paidBy: "Manager" }).total).toBe(4000);
    expect(buildExpenseAnalysis(all, HEAD_MAP, { ...OCT, headId: "sales" }).total).toBe(0);
  });
  it("lists months from From to To with empty months filled and the change from the month before", () => {
    const m = buildExpenseAnalysis(all, HEAD_MAP, { from: "2026-08-01", to: "2026-10-31" }).months;
    expect(m.map((r) => [r.month, r.total, r.change, r.changePercent])).toEqual([
      ["2026-08", 600, null, null],
      ["2026-09", 999, 399, 67],
      ["2026-10", 8300, 7301, 731]
    ]);
    expect(m[2].byHead.get("diesel")).toBe(4000);
    expect(m[2].byFarm[B]).toBe(5500);
  });
  it("with open dates, months run from the first to the last expense", () => {
    const m = buildExpenseAnalysis(all, HEAD_MAP, {}).months;
    expect(m.map((r) => r.month)).toEqual(["2026-08", "2026-09", "2026-10"]);
  });
  it("change percent is empty after a month with no expenses", () => {
    const m = buildExpenseAnalysis([entry({ date: "2026-10-02", amount: 100 })], HEAD_MAP, { from: "2026-09-01", to: "2026-10-31" }).months;
    expect(m.map((r) => [r.month, r.change, r.changePercent])).toEqual([["2026-09", null, null], ["2026-10", 100, null]]);
  });
  it("a mistyped, very long range lists only the months that have expenses", () => {
    const m = buildExpenseAnalysis(all, HEAD_MAP, { from: "0001-01-01", to: "9999-12-31" }).months;
    expect(m.map((r) => r.month)).toEqual(["2026-08", "2026-09", "2026-10"]);
    expect(buildExpenseAnalysis([], HEAD_MAP, { from: "0001-01-01", to: "9999-12-31" }).months).toEqual([]);
  });
  it("is empty and safe when nothing matches", () => {
    const empty = buildExpenseAnalysis([], HEAD_MAP, {});
    expect(empty).toMatchObject({ total: 0, count: 0, heads: [], payers: [], months: [], highestFarm: null, highestHead: null });
    expect(empty.farms.map((f) => f.share)).toEqual([0, 0, 0]);
  });
  it("uses a renamed head's new name and keeps it as one row", () => {
    const renamed = headsById([...HEADS.filter((h) => h.id !== "diesel"), { id: "diesel", name: "Diesel & Oil", type: "Outflow", active: true }]);
    const r = buildExpenseAnalysis(all, renamed, OCT);
    expect(r.heads.filter((h) => h.id === "diesel")).toHaveLength(1);
    expect(r.heads[0].name).toBe("Diesel & Oil");
  });
  it("ignores entries of unknown farms and without a date", () => {
    const r = buildExpenseAnalysis([entry({ farm: "Unknown Farm" }), entry({ date: undefined })], HEAD_MAP, {});
    expect(r.count).toBe(0);
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
