// =========================================================
// CSV export that opens correctly in Excel (UTF-8 with BOM,
// commas, quoted text, numbers kept as numbers).
// =========================================================

/** Prepares one CSV cell: quotes text with commas/quotes/line breaks and doubles inner quotes. */
export function csvCell(value) {
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  let text = String(value ?? "");
  // Stop Excel from treating text like "=SUM(...)" as a formula (CSV injection)
  if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
  return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}

/** Turns rows (array of arrays) into CSV text with a BOM, so Urdu text shows correctly in Excel. */
export function buildCsv(rows) {
  return "﻿" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
}

/** Downloads rows as a .csv file in the browser. */
export function downloadCsv(filename, rows) {
  const blob = new Blob([buildCsv(rows)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
