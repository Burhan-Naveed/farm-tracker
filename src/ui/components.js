// =========================================================
// Pieces of HTML used on more than one screen: summary cards,
// head dropdown groups, farm options and table cells.
// =========================================================

import { CONFIG, TYPES } from "../config.js";
import { sortedHeads } from "../domain/heads.js";
import { formatMoney } from "../lib/format.js";
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

/** The standard card: Total Inflow, Total Outflow and Net. */
export function moneySummaryCardHtml(title, inflow, outflow, net, extraClass = "") {
  return cardHtml(title, [
    { label: "Total Inflow", value: formatMoney(inflow), className: "type-inflow" },
    { label: "Total Outflow", value: formatMoney(outflow), className: "type-outflow" },
    { label: "Net", value: formatMoney(net), className: net < 0 ? "type-outflow" : "type-inflow" }
  ], { extraClass });
}

/**
 * <optgroup>s of heads, one per type, in the given order.
 * Inactive heads are marked "(inactive)".
 */
export function headGroupsHtml(heads, typeOrder = TYPES) {
  return typeOrder.map((type) => {
    const group = sortedHeads(heads.filter((h) => h.type === type));
    if (!group.length) return "";
    return `<optgroup label="${escapeHtml(type)}">` +
      group.map((h) => `<option value="${escapeHtml(h.id)}">${escapeHtml(h.name)}${h.active ? "" : " (inactive)"}</option>`).join("") +
      `</optgroup>`;
  }).join("");
}

/** Farm options for a <select>. With allLabel, an "all farms" option (value "") comes first. */
export function farmOptions(allLabel) {
  const farms = CONFIG.farms.map((f) => ({ value: f, label: f }));
  return allLabel ? [{ value: "", label: allLabel }, ...farms] : farms;
}

/** "📎 Slip" button for an entry with an attachment, or a dash. */
export function slipButtonHtml(entry, { dashWhenNone = true } = {}) {
  if (entry.hasAttachment) {
    return `<button type="button" class="btn btn-light btn-small" data-view="${escapeHtml(entry.id)}" title="View attachment">📎 Slip</button>`;
  }
  return dashWhenNone ? `<span class="muted">-</span>` : "";
}
