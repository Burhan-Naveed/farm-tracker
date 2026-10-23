import { describe, expect, it } from "vitest";
import { buildLedger } from "../../src/domain/ledger.js";
import { HEAD_MAP, entry } from "./fixtures.js";

const sale = (date, amount, extra = {}) => entry({ date, headId: "sales", type: "Inflow", amount, ...extra });
const cost = (date, amount, extra = {}) => entry({ date, headId: "diesel", type: "Outflow", amount, ...extra });

describe("buildLedger", () => {
  const entries = [
    sale("2026-09-20", 50000),
    cost("2026-09-25", 10000),
    sale("2026-10-01", 20000),
    cost("2026-10-03", 5000, { farm: "Rehmanbad Farm" }),
    cost("2026-10-05", 12000)
  ];

  it("shows newest first with a running balance from oldest to newest", () => {
    const l = buildLedger(entries, {}, HEAD_MAP);
    expect(l.rows.map((r) => [r.entry.date, r.inflow, r.outflow, r.balance])).toEqual([
      ["2026-10-05", 0, 12000, 43000],
      ["2026-10-03", 0, 5000, 55000],
      ["2026-10-01", 20000, 0, 60000],
      ["2026-09-25", 0, 10000, 40000],
      ["2026-09-20", 50000, 0, 50000]
    ]);
    expect(l).toMatchObject({ opening: 0, hasOpening: false, totals: { inflow: 70000, outflow: 27000 }, closing: 43000 });
  });

  it("starts from the opening balance of earlier entries when From is set", () => {
    const l = buildLedger(entries, { from: "2026-10-01" }, HEAD_MAP);
    expect(l.opening).toBe(40000);
    expect(l.hasOpening).toBe(true);
    expect(l.rows.map((r) => r.balance)).toEqual([43000, 55000, 60000]);
    expect(l.closing).toBe(43000);
    expect(l.totals).toEqual({ inflow: 20000, outflow: 17000 });
  });

  it("applies the other filters to the opening balance too", () => {
    const l = buildLedger(entries, { from: "2026-10-01", farm: "Fatehpur Farm" }, HEAD_MAP);
    expect(l.opening).toBe(40000);
    expect(l.rows.map((r) => r.entry.date)).toEqual(["2026-10-05", "2026-10-01"]);
    expect(l.closing).toBe(48000);
  });

  it("ignores the To date for the opening balance and drops later entries", () => {
    const l = buildLedger(entries, { from: "2026-10-01", to: "2026-10-01" }, HEAD_MAP);
    expect(l.rows).toHaveLength(1);
    expect(l.closing).toBe(60000);
  });

  it("can go negative", () => {
    const l = buildLedger([cost("2026-10-01", 700)], {}, HEAD_MAP);
    expect(l.closing).toBe(-700);
  });

  it("orders entries of the same day by when they were created", () => {
    const first = cost("2026-10-01", 100, { createdMs: 1 });
    const second = sale("2026-10-01", 300, { createdMs: 2 });
    const l = buildLedger([second, first], {}, HEAD_MAP);
    expect(l.rows.map((r) => r.balance)).toEqual([200, -100]);
  });

  it("is empty with no entries", () => {
    expect(buildLedger([], { from: "2026-10-01" }, HEAD_MAP)).toEqual({
      rows: [], opening: 0, hasOpening: true, totals: { inflow: 0, outflow: 0 }, closing: 0
    });
  });
});
