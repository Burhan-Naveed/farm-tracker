// =========================================================
// Report tables. A report builds a table MODEL once; the same
// model is drawn on screen and written to the CSV file, so the
// exported figures always match the screen.
//
// model: {
//   title, emptyText,
//   columns: [{ label, kind }],
//   rows:    [{ cells: [...], className? }],
//   footer:  [{ cells: [...], className? }]   (totals)
// }
// kinds: text, date, money, count, percent, change, changePercent, expense, slip
// =========================================================

import { formatNumber, shortDate } from "../lib/format.js";
import { escapeHtml } from "../lib/html.js";
import { slipButtonHtml } from "./components.js";

const MONEY = new Set(["money", "change", "expense"]);
const NUMERIC = new Set([...MONEY, "count", "percent", "changePercent"]);

/** "+1,200" / "-300" for a change; "-" when there is nothing to compare with. */
function signed(value, suffix = "") {
  if (value === null || value === undefined) return "–";
  return (value > 0 ? "+" : value < 0 ? "-" : "") + formatNumber(Math.abs(value)) + suffix;
}

/** Spending going up is shown red, going down green. */
const changeClass = (value) => (value > 0 ? "change-up" : value < 0 ? "change-down" : "");

/** One cell as safe HTML. */
function cellHtml(kind, value) {
  if (value === "" || value === undefined || value === null) {
    return kind === "change" || kind === "changePercent" ? "–" : "";
  }
  switch (kind) {
    case "date": return escapeHtml(shortDate(value));
    case "money": return escapeHtml(formatNumber(value));
    case "expense": return `<span class="type-outflow">${escapeHtml(formatNumber(value))}</span>`;
    case "count": return escapeHtml(String(value));
    case "percent": return escapeHtml(`${value}%`);
    case "change": return `<span class="${changeClass(value)}">${escapeHtml(signed(value))}</span>`;
    case "changePercent": return `<span class="${changeClass(value)}">${escapeHtml(signed(value, "%"))}</span>`;
    case "slip": return slipButtonHtml(value);
    default: return escapeHtml(value);
  }
}

/** One cell for the CSV file: numbers stay numbers so Excel can add them up. */
function cellCsv(kind, value) {
  if (value === undefined || value === null) return "";
  if (kind === "slip") return value && value.hasAttachment ? "Yes" : "No";
  return value;
}

const cssClass = (kind) => (NUMERIC.has(kind) ? "num" : kind === "slip" ? "actions no-print" : "");

function rowHtml(model, row, tag) {
  const cls = row.className ? ` class="${escapeHtml(row.className)}"` : "";
  return `<tr${cls}>` + model.columns.map((col, i) => {
    const label = col.label && col.kind !== "slip" ? ` data-label="${escapeHtml(col.label)}"` : "";
    const c = cssClass(col.kind);
    return `<${tag}${label}${c ? ` class="${c}"` : ""}>${cellHtml(col.kind, row.cells[i])}</${tag}>`;
  }).join("") + "</tr>";
}

/**
 * The model as a <table>. limit: how many rows to show (the footer
 * totals always cover every row). Returns { html, shown, total }.
 */
export function modelTableHtml(model, limit = Infinity) {
  const rows = model.rows.slice(0, limit);
  const head = "<thead><tr>" + model.columns.map((col) =>
    `<th class="${cssClass(col.kind)}">${escapeHtml(col.kind === "slip" ? "" : col.label)}</th>`).join("") + "</tr></thead>";
  const body = rows.length
    ? rows.map((r) => rowHtml(model, r, "td")).join("")
    : `<tr class="empty-row"><td colspan="${model.columns.length}"><p class="empty-state">${escapeHtml(model.emptyText || "No records match these filters.")}</p></td></tr>`;
  const foot = model.rows.length && model.footer && model.footer.length
    ? "<tfoot>" + model.footer.map((r) => rowHtml(model, { ...r, className: ["total-row", r.className].filter(Boolean).join(" ") }, "td")).join("") + "</tfoot>"
    : "";
  return {
    html: `<table class="data-table report-table responsive-table">${head}<tbody>${body}</tbody>${foot}</table>`,
    shown: rows.length,
    total: model.rows.length
  };
}

/** The model as CSV rows: a title row, the column titles, every row, then the totals. */
export function modelCsvRows(model) {
  const columns = model.columns;
  const label = (col) => {
    if (col.kind === "slip") return "Attachment";
    if (col.kind === "percent" || col.kind === "changePercent") return `${col.label} (%)`;
    return MONEY.has(col.kind) ? `${col.label} (PKR)` : col.label;
  };
  const values = (r) => columns.map((col, i) => cellCsv(col.kind, r.cells[i]));
  return [
    [model.title],
    columns.map(label),
    ...model.rows.map(values),
    ...(model.footer || []).map(values)
  ];
}
