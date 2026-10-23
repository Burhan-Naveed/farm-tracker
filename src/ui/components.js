// =========================================================
// Pieces of HTML used on more than one screen: summary cards,
// stat tiles, bar lists, head / farm / Paid By options and cells.
// =========================================================

import { CONFIG, TYPE_LABELS } from "../config.js";
import { sortedHeads } from "../domain/heads.js";
import { formatMoney, formatNumber } from "../lib/format.js";
import { escapeHtml } from "../lib/html.js";

/** CSS class for an Inflow / Outflow value. */
export const typeClass = (type) => (type === "Inflow" ? "type-inflow" : "type-outflow");

/**
 * A summary card with a title and lines. Each line: { label, value (safe HTML), className? }.
 * The last line is drawn as the bold "net" line when emphasizeLast is true.
 */
export function cardHtml(title, lines, { extraClass = "", emphasizeLast = true } = {}) {
  return `
    <div class="card summary-card ${escapeHtml(extraClass)}">
      <h3>${escapeHtml(title)}</h3>
      ${lines.map((line, i) => `
        <div class="summary-line${emphasizeLast && i === lines.length - 1 ? " net" : ""}">
          <span>${escapeHtml(line.label)}</span><b class="${escapeHtml(line.className || "")}">${line.value}</b>
        </div>`).join("")}
    </div>`;
}

/**
 * A stat tile: a label, one big value and a small line under it.
 * tile: { label, value (text), sub? (text), tone?: "expense" | "good" | "", primary?: bool }
 */
export function statTileHtml({ label, value, sub = "", tone = "", primary = false }) {
  return `
    <div class="card stat-tile${primary ? " primary" : ""}">
      <span class="stat-label">${escapeHtml(label)}</span>
      <b class="stat-value${tone ? " tone-" + escapeHtml(tone) : ""}">${escapeHtml(value)}</b>
      ${sub ? `<span class="stat-sub">${escapeHtml(sub)}</span>` : ""}
    </div>`;
}

/**
 * A list of rows, each with a bar showing its size compared with the biggest row.
 * rows: [{ name, total, share, color? }]
 */
export function barListHtml(rows, emptyText) {
  if (!rows.length) return `<p class="empty-state">${escapeHtml(emptyText)}</p>`;
  const max = Math.max(...rows.map((r) => r.total), 1);
  const colorStyle = (r) => (r.color ? `background:${escapeHtml(r.color)}` : "");
  return `<ul class="bar-list">${rows.map((r) => `
    <li>
      <div class="bar-row">
        <span class="bar-name">${r.color ? `<i class="dot" style="${colorStyle(r)}"></i>` : ""}${escapeHtml(r.name)}</span>
        <span class="bar-value"><b>${escapeHtml(formatMoney(r.total))}</b> <span class="muted">${escapeHtml(String(r.share))}%</span></span>
      </div>
      <div class="bar-track"><span style="width:${Math.max(1, Math.round((r.total / max) * 100))}%;${colorStyle(r)}"></span></div>
    </li>`).join("")}</ul>`;
}

/**
 * <optgroup>s of heads: expense heads first, then cash received.
 * Inactive heads are marked "(inactive)".
 */
export function headGroupsHtml(heads, typeOrder = ["Outflow", "Inflow"]) {
  return typeOrder.map((type) => {
    const group = sortedHeads(heads.filter((h) => h.type === type));
    if (!group.length) return "";
    return `<optgroup label="${escapeHtml(TYPE_LABELS[type])}">` +
      group.map((h) => `<option value="${escapeHtml(h.id)}">${escapeHtml(h.name)}${h.active ? "" : " (inactive)"}</option>`).join("") +
      `</optgroup>`;
  }).join("");
}

/** Farm options for a <select>. With allLabel, an "all farms" option (value "") comes first. */
export function farmOptions(allLabel) {
  const farms = CONFIG.farms.map((f) => ({ value: f, label: f }));
  return allLabel ? [{ value: "", label: allLabel }, ...farms] : farms;
}

/** Paid By options for a <select> (saved value, shown label). With allLabel, an "anyone" option comes first. */
export function paidByOptions(allLabel) {
  const options = CONFIG.paidBy.map((p) => ({ value: p.value, label: p.label }));
  return allLabel ? [{ value: "", label: allLabel }, ...options] : options;
}

/** An amount in a list: red for an expense, green with "+" for cash received. */
export function amountHtml(amount, type) {
  return type === "Inflow"
    ? `<span class="type-inflow">+${escapeHtml(formatNumber(amount))}</span>`
    : `<span class="type-outflow">${escapeHtml(formatNumber(amount))}</span>`;
}

/** "📎 Slip" button for an entry with an attachment, or a dash. */
export function slipButtonHtml(entry, { dashWhenNone = true } = {}) {
  if (entry.hasAttachment) {
    return `<button type="button" class="btn btn-light btn-small" data-view="${escapeHtml(entry.id)}" title="View attachment">📎 Slip</button>`;
  }
  return dashWhenNone ? `<span class="muted">-</span>` : "";
}
