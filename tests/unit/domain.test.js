import { describe, expect, it } from "vitest";
import { CONFIG, LIMITS } from "../../src/config.js";
import {
  defaultHeadRecords, headNameOf, headTypeOf, headUsageCounts, headsById, sortedHeads, validateHead
} from "../../src/domain/heads.js";
import { compareNewestFirst, compareOldestFirst, filterEntries, sumEntries, validateEntry } from "../../src/domain/entries.js";
import { sortedUsers, validateUser } from "../../src/domain/users.js";
import { HEADS, HEAD_MAP, entry } from "./fixtures.js";

describe("heads", () => {
  it("sorts Inflow first, then Outflow, each alphabetical", () => {
    expect(sortedHeads(HEADS).map((h) => h.id)).toEqual(["sales", "diesel", "old", "salary"]);
  });
  it("does not change the original list when sorting", () => {
    const copy = [...HEADS];
    sortedHeads(HEADS);
    expect(HEADS).toEqual(copy);
  });
  it("uses the current head name and type, with the saved ones as fallback", () => {
    const renamed = headsById([{ id: "diesel", name: "Diesel & Oil", type: "Outflow", active: true }]);
    expect(headNameOf(entry({ headId: "diesel" }), renamed)).toBe("Diesel & Oil");
    expect(headNameOf(entry({ headId: "gone", headName: "Deleted" }), renamed)).toBe("Deleted");
    expect(headNameOf(entry({ headId: "gone", headName: "" }), renamed)).toBe("Unknown head");
    expect(headTypeOf(entry({ headId: "gone", type: "Inflow" }), renamed)).toBe("Inflow");
    expect(headTypeOf(entry({ headId: "gone", type: "strange" }), renamed)).toBe("Outflow");
  });
  it("counts entries per head", () => {
    expect(headUsageCounts([entry({ headId: "a" }), entry({ headId: "a" }), entry({ headId: "b" })])).toEqual({ a: 2, b: 1 });
  });
  it("creates the 12 default heads with fixed ids", () => {
    const records = defaultHeadRecords();
    expect(records).toHaveLength(12);
    expect(records[0]).toEqual({ id: "default-01", name: "Sales", type: "Inflow" });
    expect(records[11].id).toBe("default-12");
  });

  describe("validateHead", () => {
    const ctx = { heads: HEADS };
    it("accepts a valid head and cleans the name", () => {
      expect(validateHead({ name: "  Seeds   & Fertilizer ", type: "Outflow" }, ctx))
        .toEqual({ ok: true, value: { name: "Seeds & Fertilizer", type: "Outflow" } });
    });
    it("rejects an empty name", () => {
      expect(validateHead({ name: "   ", type: "Outflow" }, ctx).error).toBe("Please enter a head name.");
    });
    it("rejects a name that is too long", () => {
      expect(validateHead({ name: "x".repeat(LIMITS.headNameMax + 1), type: "Outflow" }, ctx).ok).toBe(false);
      expect(validateHead({ name: "x".repeat(LIMITS.headNameMax), type: "Outflow" }, ctx).ok).toBe(true);
    });
    it("rejects a missing or unknown type", () => {
      expect(validateHead({ name: "Seeds", type: "" }, ctx).error).toBe("Please select a type.");
      expect(validateHead({ name: "Seeds", type: "Other" }, ctx).ok).toBe(false);
    });
    it("blocks duplicates ignoring case and spaces", () => {
      expect(validateHead({ name: " sALES ", type: "Inflow" }, ctx).error).toBe("A head with this name already exists.");
    });
    it("lets a head keep its own name while editing", () => {
      expect(validateHead({ name: "Sales", type: "Outflow" }, { heads: HEADS, editingId: "sales" }).ok).toBe(true);
    });
  });
});

describe("validateEntry", () => {
  const valid = { date: "2026-10-13", farm: "Fatehpur Farm", headId: "diesel", amount: "15000", paidBy: "BM", note: "  Tractor diesel " };
  const ctx = { heads: HEADS };

  it("accepts a valid entry and copies the head name and type", () => {
    expect(validateEntry(valid, ctx)).toEqual({
      ok: true,
      value: { date: "2026-10-13", farm: "Fatehpur Farm", headId: "diesel", headName: "Diesel", type: "Outflow", amount: 15000, paidBy: "BM", note: "Tractor diesel" }
    });
  });
  it("rounds the amount to whole rupees", () => {
    expect(validateEntry({ ...valid, amount: "99.6" }, ctx).value.amount).toBe(100);
  });
  it.each([
    ["missing date", { date: "" }, "Please select a valid date."],
    ["impossible date", { date: "2026-02-30" }, "Please select a valid date."],
    ["unknown farm", { farm: "Other Farm" }, "Please select a farm."],
    ["missing head", { headId: "" }, "Please select a head."],
    ["deleted head", { headId: "nope" }, "Please select a head."],
    ["inactive head", { headId: "old" }, "Please select a head."],
    ["empty amount", { amount: "" }, "Please enter the amount as a number, for example 15000."],
    ["text amount", { amount: "12abc" }, "Please enter the amount as a number, for example 15000."],
    ["negative amount", { amount: "-5" }, "Please enter the amount as a number, for example 15000."],
    ["scientific notation", { amount: "1e5" }, "Please enter the amount as a number, for example 15000."],
    ["zero amount", { amount: "0" }, "Amount must be at least 1 rupee."],
    ["amount that rounds to zero", { amount: "0.4" }, "Amount must be at least 1 rupee."],
    ["huge amount", { amount: String(LIMITS.maxAmount + 1) }, "Amount is too large. Please check it."],
    ["unknown Paid By", { paidBy: "Someone" }, "Please select Paid By."],
    ["note too long", { note: "x".repeat(LIMITS.noteMax + 1) }, `Note can be at most ${LIMITS.noteMax} characters.`]
  ])("rejects %s", (_, change, error) => {
    expect(validateEntry({ ...valid, ...change }, ctx)).toEqual({ ok: false, error });
  });
  it("accepts the largest allowed amount and the longest note", () => {
    expect(validateEntry({ ...valid, amount: String(LIMITS.maxAmount), note: "x".repeat(LIMITS.noteMax) }, ctx).ok).toBe(true);
  });
  it("allows the entry's own inactive head while editing", () => {
    expect(validateEntry({ ...valid, headId: "old" }, { heads: HEADS, allowedInactiveHeadId: "old" }).ok).toBe(true);
  });
  it("accepts every configured farm and Paid By option", () => {
    CONFIG.farms.forEach((farm) => expect(validateEntry({ ...valid, farm }, ctx).ok).toBe(true));
    CONFIG.paidByOptions.forEach((paidBy) => expect(validateEntry({ ...valid, paidBy }, ctx).ok).toBe(true));
  });
});

describe("entry sorting, filtering and totals", () => {
  const a = entry({ date: "2026-10-01", farm: "Fatehpur Farm", headId: "sales", type: "Inflow", amount: 5000, note: "Wheat sold" });
  const b = entry({ date: "2026-10-03", farm: "Bhakkarpur Farm", headId: "diesel", amount: 1200, note: "Tractor DIESEL" });
  const c = entry({ date: "2026-10-03", farm: "Rehmanbad Farm", headId: "salary", amount: 800 });
  const all = [a, b, c];

  it("sorts newest first, and newest created first on the same date", () => {
    expect([a, b, c].sort(compareNewestFirst).map((x) => x.id)).toEqual([c.id, b.id, a.id]);
  });
  it("sorts oldest first for reports", () => {
    expect([c, b, a].sort(compareOldestFirst).map((x) => x.id)).toEqual([a.id, b.id, c.id]);
  });
  it("returns everything with empty filters", () => {
    expect(filterEntries(all, {}, HEAD_MAP)).toHaveLength(3);
  });
  it("filters by farm, head, type, dates and note search (case-insensitive)", () => {
    expect(filterEntries(all, { farm: "Fatehpur Farm" }, HEAD_MAP)).toEqual([a]);
    expect(filterEntries(all, { headId: "salary" }, HEAD_MAP)).toEqual([c]);
    expect(filterEntries(all, { type: "Inflow" }, HEAD_MAP)).toEqual([a]);
    expect(filterEntries(all, { type: "Outflow" }, HEAD_MAP)).toEqual([b, c]);
    expect(filterEntries(all, { from: "2026-10-02" }, HEAD_MAP)).toEqual([b, c]);
    expect(filterEntries(all, { to: "2026-10-01" }, HEAD_MAP)).toEqual([a]);
    expect(filterEntries(all, { search: " diesel " }, HEAD_MAP)).toEqual([b]);
  });
  it("combines filters", () => {
    expect(filterEntries(all, { type: "Outflow", from: "2026-10-03", search: "tractor" }, HEAD_MAP)).toEqual([b]);
  });
  it("uses the head's current type for the type filter", () => {
    const changed = headsById([{ id: "diesel", name: "Diesel", type: "Inflow", active: true }]);
    expect(filterEntries([b], { type: "Inflow" }, changed)).toEqual([b]);
  });
  it("sums inflow, outflow and net", () => {
    expect(sumEntries(all, HEAD_MAP)).toEqual({ inflow: 5000, outflow: 2000, net: 3000, count: 3 });
    expect(sumEntries([], HEAD_MAP)).toEqual({ inflow: 0, outflow: 0, net: 0, count: 0 });
  });
});

describe("validateUser", () => {
  const users = [{ id: "A".repeat(28), email: "admin@farm.pk", name: "Admin" }];
  const valid = { name: " Ali  Khan ", email: " Ali@Farm.PK ", uid: "b".repeat(28), role: "staff" };

  it("accepts a valid user, cleans the name and lowercases the email", () => {
    expect(validateUser(valid, { users })).toEqual({ ok: true, value: { uid: "b".repeat(28), name: "Ali Khan", email: "ali@farm.pk", role: "staff" } });
  });
  it.each([
    ["empty name", { name: " " }, "Please enter a name."],
    ["long name", { name: "x".repeat(LIMITS.userNameMax + 1) }, `Name can be at most ${LIMITS.userNameMax} characters.`],
    ["bad email", { email: "ali@farm" }, "Please enter a valid email."],
    ["short UID", { uid: "abc" }, "Please paste the User UID exactly as shown in Firebase Console."],
    ["UID with symbols", { uid: "a".repeat(20) + "/../x" }, "Please paste the User UID exactly as shown in Firebase Console."],
    ["unknown role", { role: "owner" }, "Please select a role."],
    ["existing UID", { uid: "A".repeat(28) }, "A user with this UID already exists."],
    ["existing email", { email: "ADMIN@farm.pk" }, "A user with this email already exists."]
  ])("rejects %s", (_, change, error) => {
    expect(validateUser({ ...valid, ...change }, { users })).toEqual({ ok: false, error });
  });
  it("sorts users by name, even with missing names", () => {
    expect(sortedUsers([{ name: "Zed" }, {}, { name: "Ali" }]).map((u) => u.name)).toEqual([undefined, "Ali", "Zed"]);
  });
});
