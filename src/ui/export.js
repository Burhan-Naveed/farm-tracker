// =========================================================
// Export buttons shared by the Entries and Reports pages:
// PDF (the browser's "Save as PDF", so Urdu text prints correctly),
// Excel (.xlsx) and CSV. Excel and CSV get exactly the same rows.
// =========================================================

import { downloadCsv } from "../lib/csv.js";
import { downloadXlsx } from "../lib/xlsx.js";
import { showToast } from "./feedback.js";

/**
 * Saves rows as Excel or CSV.
 * table: { fileBase (name without extension), sheet, rows, boldRows }
 */
export function downloadTable(format, { fileBase, sheet, rows, boldRows = [] }) {
  if (format === "excel") downloadXlsx(fileBase + ".xlsx", rows, { sheet, boldRows });
  else downloadCsv(fileBase + ".csv", rows);
}

/**
 * Opens the print window (choose "Save as PDF" there).
 * prepare() runs first, e.g. to draw every row instead of the first page.
 */
export function printAsPdf(prepare) {
  prepare();
  showToast('In the print window, choose "Save as PDF"');
  // Let the page draw the full list before the print window opens
  setTimeout(() => window.print(), 50);
}

/**
 * Makes the PDF / Excel / CSV buttons inside a group work.
 * handlers: { pdf(), table(format) } - table(format) handles "excel" and "csv".
 */
export function bindExportButtons(group, { pdf, table }) {
  group.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-export]");
    if (!btn) return;
    if (btn.dataset.export === "pdf") pdf();
    else table(btn.dataset.export);
  });
}
