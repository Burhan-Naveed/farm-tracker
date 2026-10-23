// =========================================================
// Excel (.xlsx) export without any library: one worksheet,
// numbers stay numbers (so Excel can add them up), text is
// UTF-8 (Urdu shows correctly), chosen rows are bold.
// =========================================================

import { createZip } from "./zip.js";
import { downloadBlob } from "./download.js";

const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const MAX_COLUMN_WIDTH = 60;

/** Escapes text for XML and removes characters XML cannot hold. */
export function xmlText(value) {
  return String(value ?? "")
    .replace(/[^\x09\x0A\x0D\x20-퟿-�\u{10000}-\u{10FFFF}]/gu, "")
    .replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

/** Column letters: 0 -> "A", 25 -> "Z", 26 -> "AA". */
export function columnName(index) {
  let name = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}

/** A sheet name Excel accepts: at most 31 characters, none of : \ / ? * [ ]. */
export const sheetName = (name) => (String(name || "Sheet1").replace(/[:\\/?*[\]]/g, " ").trim().slice(0, 31) || "Sheet1");

/** One cell. Empty values are left out (the cell stays empty). */
function cellXml(value, ref, bold) {
  const style = bold ? ' s="1"' : "";
  if (typeof value === "number") return Number.isFinite(value) ? `<c r="${ref}"${style}><v>${value}</v></c>` : "";
  if (value === null || value === undefined || value === "") return "";
  // Text is always stored as text, never as a formula
  return `<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${xmlText(value)}</t></is></c>`;
}

/** Column widths that fit the longest value of each column (within limits). */
function colsXml(rows) {
  const widths = [];
  rows.forEach((row) => row.forEach((value, i) => {
    const text = typeof value === "number" ? value.toLocaleString("en-US") : String(value ?? "");
    widths[i] = Math.max(widths[i] || 8, Math.min(MAX_COLUMN_WIDTH, text.length + 2));
  }));
  // A title in the first column should not make that column very wide
  if (widths.length > 1) widths[0] = Math.min(widths[0], 40);
  return widths.length ? `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols>` : "";
}

/** The worksheet XML. boldRows: row numbers (from 0) to show in bold. */
function sheetXml(rows, boldRows) {
  const body = rows.map((row, r) => {
    const bold = boldRows.has(r);
    const cells = row.map((value, c) => cellXml(value, columnName(c) + (r + 1), bold)).join("");
    return `<row r="${r + 1}">${cells}</row>`;
  }).join("");
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    colsXml(rows) + `<sheetData>${body}</sheetData></worksheet>`;
}

/**
 * Builds an .xlsx file from rows (array of arrays of text / numbers).
 * Returns the file as a Uint8Array.
 */
export function buildXlsx(rows, { sheet = "Sheet1", boldRows = [] } = {}) {
  const name = xmlText(sheetName(sheet));
  return createZip([
    {
      name: "[Content_Types].xml",
      data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        "</Types>"
    },
    {
      name: "_rels/.rels",
      data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
        "</Relationships>"
    },
    {
      name: "xl/workbook.xml",
      data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        `<sheets><sheet name="${name}" sheetId="1" r:id="rId1"/></sheets></workbook>`
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
        "</Relationships>"
    },
    {
      // Style 0 = normal, style 1 = bold (for titles, column headings and totals)
      name: "xl/styles.xml",
      data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
        '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
        '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
        '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
        '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
        '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
        '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>' +
        '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
        "</styleSheet>"
    },
    { name: "xl/worksheets/sheet1.xml", data: sheetXml(rows, new Set(boldRows)) }
  ]);
}

/** Downloads rows as an .xlsx file in the browser. */
export function downloadXlsx(filename, rows, options) {
  downloadBlob(filename, new Blob([buildXlsx(rows, options)], { type: XLSX_TYPE }));
}
