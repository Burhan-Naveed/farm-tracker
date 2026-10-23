// =========================================================
// Number, money, date and text formatting (pure functions, no DOM).
// =========================================================

import { CONFIG } from "../config.js";

/** Formats a number as "125,000" (commas, whole rupees, no decimals). */
export function formatNumber(n) {
  return Math.round(Number(n || 0)).toLocaleString("en-US", { maximumFractionDigits: 0 });
}

/** Formats a number as "PKR 125,000". Negative values show as "-PKR 1,000". */
export function formatMoney(n) {
  const value = Number(n || 0);
  return (value < 0 ? "-" : "") + CONFIG.currency + " " + formatNumber(Math.abs(value));
}

/** Adds money values safely (works in paisa to avoid decimal rounding errors). */
export function addMoney(a, b) {
  return (Math.round(Number(a) * 100) + Math.round(Number(b) * 100)) / 100;
}

/** Whole-number percentage of part in total ("0" when total is 0). */
export function percentOf(part, total) {
  return total ? Math.round((part / total) * 100) : 0;
}

/** Turns a byte count into "245 KB" / "1.2 MB". */
export function formatSize(bytes) {
  return bytes >= 1048576 ? (bytes / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(bytes / 1024)) + " KB";
}

/** Returns a local date as "YYYY-MM-DD" (not UTC, so it is correct in Pakistan time). */
export function toDateString(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export const todayString = () => toDateString(new Date());
export const currentMonthString = () => todayString().slice(0, 7);

/** True for a real calendar date written as "YYYY-MM-DD" (rejects "2026-02-30"). */
export function isValidDateString(text) {
  if (typeof text !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const d = new Date(text + "T00:00:00");
  return !Number.isNaN(d.getTime()) && toDateString(d) === text;
}

/** "2026-10" -> "October 2026" */
export const monthLabelOf = (month) =>
  new Date(month + "-01T00:00:00").toLocaleString("en-US", { month: "long", year: "numeric" });

const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-10-01" -> "01 Oct 2026" (same on every device; browsers differ, e.g. "Sep" / "Sept"). */
export function shortDate(d) {
  if (!isValidDateString(d)) return "";
  const [year, month, day] = d.split("-");
  return `${day} ${SHORT_MONTHS[Number(month) - 1]} ${year}`;
}

/** "2026-10" -> "Oct 2026" (short, for chart labels). */
export function shortMonthLabel(month) {
  const [year, m] = String(month).split("-");
  return `${SHORT_MONTHS[Number(m) - 1] || ""} ${year}`.trim();
}

/** Text like "01 Oct 2026 to 14 Oct 2026" for titles. */
export function rangeLabel(from, to) {
  if (from && to) return `${shortDate(from)} to ${shortDate(to)}`;
  if (from) return `from ${shortDate(from)}`;
  if (to) return `up to ${shortDate(to)}`;
  return "all dates";
}

/** "Fatehpur Farm" -> "fatehpur-farm" (safe for file names). */
export function slugify(text) {
  return String(text ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/** Trims and collapses repeated spaces: "  Misc   Expenses " -> "Misc Expenses". */
export function cleanText(text) {
  return String(text ?? "").trim().replace(/\s+/g, " ");
}

/** Normalises a name for duplicate checks: clean text, ignoring case. */
export function normalizeName(name) {
  return cleanText(name).toLowerCase();
}

/** "1 entry" / "3 entries" */
export const pluralEntries = (n) => `${n} entr${n === 1 ? "y" : "ies"}`;
