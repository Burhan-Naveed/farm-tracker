import { describe, expect, it } from "vitest";
import {
  BACKUP_COLLECTIONS, buildBackup, parseBackup, planRestore, restoreSummary, restoredEntry, restoredHead
} from "../../src/domain/backup.js";

/** Looks like a Firestore Timestamp. */
const timestamp = (iso) => ({ toDate: () => new Date(iso) });

const head = (id, extra = {}) => ({ id, name: "Head " + id, type: "Outflow", active: true, isDefault: false, ...extra });
const entry = (id, extra = {}) => ({
  id, date: "2026-10-01", farm: "Fatehpur Farm", headId: "h1", headName: "Head h1", type: "Outflow",
  amount: 500, paidBy: "BM", note: "", hasAttachment: true, attachmentName: "slip.jpg", attachmentType: "image/jpeg", ...extra
});

describe("buildBackup", () => {
  const backup = buildBackup({
    heads: [head("h1", { createdAt: timestamp("2026-01-01T00:00:00Z") })],
    expenses: [{ ...entry("e1"), createdMs: 123, updatedMs: 456, createdAt: timestamp("2026-10-01T05:00:00Z") }],
    users: [{ id: "u1", name: "Ali", role: "staff", status: "active" }]
  }, { createdAt: new Date("2026-10-23T10:30:00Z"), createdBy: "admin@farm.test" });

  it("records the app, version, time, creator and counts", () => {
    expect(backup).toMatchObject({
      app: "farm-tracker", version: 1, createdAt: "2026-10-23T10:30:00.000Z", createdBy: "admin@farm.test",
      counts: { heads: 1, expenses: 1, users: 1, auditLog: 0 }
    });
  });
  it("has every collection, even empty ones", () => {
    expect(Object.keys(backup.data)).toEqual(BACKUP_COLLECTIONS);
    expect(backup.data.auditLog).toEqual([]);
  });
  it("turns timestamps into ISO text and drops the app's temporary fields", () => {
    expect(backup.data.expenses[0].createdAt).toBe("2026-10-01T05:00:00.000Z");
    expect(backup.data.heads[0].createdAt).toBe("2026-01-01T00:00:00.000Z");
    expect(backup.data.expenses[0]).not.toHaveProperty("createdMs");
    expect(backup.data.expenses[0]).not.toHaveProperty("updatedMs");
  });
  it("survives a JSON round trip", () => {
    expect(parseBackup(JSON.stringify(backup))).toEqual({ ok: true, backup });
  });
});

describe("parseBackup", () => {
  const valid = { app: "farm-tracker", version: 1, data: { heads: [], expenses: [] } };
  it.each([
    ["text that is not JSON", "not json", "This file is not a Farm Tracker backup (it could not be read)."],
    ["another app's file", JSON.stringify({ app: "other", version: 1, data: {} }), "This file is not a Farm Tracker backup."],
    ["null", "null", "This file is not a Farm Tracker backup."],
    ["another version", JSON.stringify({ ...valid, version: 99 }), "This backup was made by a different app version and cannot be restored."],
    ["missing entries", JSON.stringify({ ...valid, data: { heads: [] } }), "This backup is damaged (heads or entries are missing)."]
  ])("rejects %s", (_, text, error) => {
    expect(parseBackup(text)).toEqual({ ok: false, error });
  });
});

describe("planRestore", () => {
  const backup = {
    data: {
      heads: [head("h1"), head("h2", { active: false }), head("bad", { type: "Profit" })],
      expenses: [
        entry("e1"),
        entry("e2", { headId: "h2" }),
        entry("e3", { headId: "deleted" }),           // head not in app or backup
        entry("e4", { amount: -5 }),                  // damaged
        entry("e5", { farm: "Unknown" }),             // damaged
        entry("../x")                                 // unsafe id
      ]
    }
  };

  it("restores only missing heads and entries, skipping damaged ones", () => {
    const plan = planRestore(backup, { headIds: new Set(["h1"]), entryIds: new Set(["e1"]) });
    expect(plan.heads.map((h) => h.id)).toEqual(["h2"]);
    expect(plan.entries.map((x) => x.id)).toEqual(["e2"]);
    expect(plan.skipped).toBe(5);   // 1 bad head + e3, e4, e5, "../x"
    expect(restoreSummary(plan)).toBe("1 entries, 1 heads, 5 skipped (damaged)");
  });

  it("has nothing to do when everything still exists", () => {
    const plan = planRestore({ data: { heads: [head("h1")], expenses: [entry("e1")] } }, { headIds: new Set(["h1"]), entryIds: new Set(["e1"]) });
    expect(plan).toEqual({ heads: [], entries: [], skipped: 0 });
    expect(restoreSummary(plan)).toBe("0 entries, 0 heads");
  });

  it("keeps entries whose head exists in the app but not in the backup", () => {
    const plan = planRestore({ data: { heads: [], expenses: [entry("e9", { headId: "live" })] } }, { headIds: new Set(["live"]), entryIds: new Set() });
    expect(plan.entries).toHaveLength(1);
  });
});

describe("restored records", () => {
  it("entries come back without a slip (slips are not in the backup)", () => {
    expect(restoredEntry(entry("e1", { note: undefined }))).toEqual({
      date: "2026-10-01", farm: "Fatehpur Farm", headId: "h1", headName: "Head h1", type: "Outflow",
      amount: 500, paidBy: "BM", note: "", hasAttachment: false, attachmentName: "", attachmentType: ""
    });
  });
  it("heads keep name, type, active and default flags", () => {
    expect(restoredHead(head("h2", { name: " Rent ", active: false, isDefault: true }))).toEqual({ name: "Rent", type: "Outflow", active: false, isDefault: true });
    expect(restoredHead({ ...head("h3"), isDefault: undefined }).isDefault).toBe(false);
  });
});
