// =========================================================
// Safe HTML building helpers. Every value placed inside HTML
// must go through escapeHtml (prevents broken layout and XSS).
// =========================================================

/** Escapes text before putting it inside HTML. */
export function escapeHtml(text) {
  return String(text ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

/** Builds <option> tags. Each option is { value, label }. */
export function optionsHtml(options) {
  return options
    .map((o) => `<option value="${escapeHtml(o.value)}">${escapeHtml(o.label)}</option>`)
    .join("");
}

/**
 * Builds a table body from column definitions, so every table in the
 * app is drawn the same way (and turns into cards on phones).
 * Column: { label, className?, cell(row) -> safe HTML string }.
 * A column without a label (e.g. Actions) shows no label on phones.
 */
export function tableRowsHtml(columns, rows) {
  return rows.map((row) =>
    "<tr>" +
    columns.map((col) => {
      const label = col.label ? ` data-label="${escapeHtml(col.label)}"` : "";
      const cls = col.className ? ` class="${escapeHtml(typeof col.className === "function" ? col.className(row) : col.className)}"` : "";
      return `<td${label}${cls}>${col.cell(row)}</td>`;
    }).join("") +
    "</tr>"
  ).join("");
}
