// =========================================================
// Date periods used by the Dashboard and Reports filters
// ("This month", "Last month", ...). Pure functions; dates are
// "YYYY-MM-DD" text in local (Pakistan) time.
// =========================================================

/** The choices, in the order they are shown. "custom" = the user's own From / To. */
export const PERIODS = Object.freeze([
  { value: "this-month", label: "This month" },
  { value: "last-month", label: "Last month" },
  { value: "this-year", label: "This year" },
  { value: "last-year", label: "Last year" },
  { value: "all", label: "All dates" },
  { value: "custom", label: "Custom dates" }
]);

const pad = (n) => String(n).padStart(2, "0");

/** Last day of a month: lastDayOf(2026, 2) -> 28. month is 1-12. */
const lastDayOf = (year, month) => new Date(year, month, 0).getDate();

/** "2026-10" -> { from: "2026-10-01", to: "2026-10-31" } */
export function monthRange(month) {
  const [y, m] = month.split("-").map(Number);
  return { from: `${month}-01`, to: `${month}-${pad(lastDayOf(y, m))}` };
}

/** "2026-03" -> "2026-02" (and "2026-01" -> "2025-12"). */
export function previousMonth(month) {
  const [y, m] = month.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${pad(m - 1)}`;
}

/** "2026-12" -> "2027-01". */
export function nextMonth(month) {
  const [y, m] = month.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${pad(m + 1)}`;
}

/**
 * From / To of a period, for the given today ("YYYY-MM-DD").
 * "This month" and "This year" end today. "all" and "custom" return
 * empty dates (custom keeps whatever the user typed).
 */
export function periodRange(period, today) {
  const month = today.slice(0, 7);
  const year = Number(today.slice(0, 4));
  switch (period) {
    case "this-month": return { from: `${month}-01`, to: today };
    case "last-month": return monthRange(previousMonth(month));
    case "this-year": return { from: `${year}-01-01`, to: today };
    case "last-year": return { from: `${year - 1}-01-01`, to: `${year - 1}-12-31` };
    default: return { from: "", to: "" };
  }
}

/** Which period a From / To pair is (for showing the right choice), or "custom". */
export function periodOf({ from, to }, today) {
  const match = PERIODS.find((p) => p.value !== "custom" && p.value !== "all" &&
    periodRange(p.value, today).from === from && periodRange(p.value, today).to === to);
  if (match) return match.value;
  return !from && !to ? "all" : "custom";
}

/** Every month from "YYYY-MM" to "YYYY-MM", both included (empty when from is after to). */
export function monthsBetween(fromMonth, toMonth) {
  const months = [];
  for (let m = fromMonth; m <= toMonth; m = nextMonth(m)) months.push(m);
  return months;
}
