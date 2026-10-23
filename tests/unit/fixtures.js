// Shared test data for unit tests.
import { headsById } from "../../src/domain/heads.js";

export const HEADS = [
  { id: "sales", name: "Sales", type: "Inflow", active: true },
  { id: "diesel", name: "Diesel", type: "Outflow", active: true },
  { id: "salary", name: "Salary", type: "Outflow", active: true },
  { id: "old", name: "Old Head", type: "Outflow", active: false }
];

export const HEAD_MAP = headsById(HEADS);

let counter = 0;

/** Builds an entry with sensible defaults. */
export function entry(overrides = {}) {
  counter++;
  return {
    id: "e" + counter,
    date: "2026-10-05",
    farm: "Fatehpur Farm",
    headId: "diesel",
    headName: "Diesel",
    type: "Outflow",
    amount: 1000,
    paidBy: "BM",
    note: "",
    hasAttachment: false,
    createdMs: counter,
    ...overrides
  };
}
