import { describe, expect, it } from "vitest";
import { buildXlsx, columnName, sheetName, xmlText } from "../../src/lib/xlsx.js";
import { crc32, createZip } from "../../src/lib/zip.js";

/** Reads a stored (uncompressed) ZIP through its central directory: { name: text }. Checks every CRC. */
function readZip(zip) {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const decoder = new TextDecoder();
  const endAt = zip.byteLength - 22;
  expect(view.getUint32(endAt, true)).toBe(0x06054b50);
  const count = view.getUint16(endAt + 10, true);
  let at = view.getUint32(endAt + 16, true);
  const files = {};
  for (let i = 0; i < count; i++) {
    expect(view.getUint32(at, true)).toBe(0x02014b50);
    const crc = view.getUint32(at + 16, true);
    const size = view.getUint32(at + 20, true);
    const nameLength = view.getUint16(at + 28, true);
    const localAt = view.getUint32(at + 42, true);
    const name = decoder.decode(zip.subarray(at + 46, at + 46 + nameLength));
    expect(view.getUint32(localAt, true)).toBe(0x04034b50);
    const dataAt = localAt + 30 + view.getUint16(localAt + 26, true);
    const data = zip.subarray(dataAt, dataAt + size);
    expect(crc32(data)).toBe(crc);
    files[name] = decoder.decode(data);
    at += 46 + nameLength;
  }
  return files;
}

describe("zip", () => {
  it("calculates the standard CRC-32", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array())).toBe(0);
  });
  it("stores files that can be read back, including UTF-8 names and text", () => {
    const zip = createZip([{ name: "a.txt", data: "hello" }, { name: "اردو.txt", data: "کھاد" }, { name: "b.bin", data: new Uint8Array([1, 2, 3]) }]);
    const files = readZip(zip);
    expect(Object.keys(files)).toEqual(["a.txt", "اردو.txt", "b.bin"]);
    expect(files["a.txt"]).toBe("hello");
    expect(files["اردو.txt"]).toBe("کھاد");
  });
});

describe("xlsx", () => {
  const rows = [
    ["Farm Tracker - Head-wise Expense Report"],
    ["Expense head", "Fatehpur Farm", "Total"],
    ["Diesel & Oil <tractor>", 12000, 12000.5],
    ["کھاد", 0, null],
    ["=SUM(A1:A2)", "", undefined]
  ];
  const files = readZip(buildXlsx(rows, { sheet: "Head-wise: report [2026]", boldRows: [0, 1] }));
  const sheet = files["xl/worksheets/sheet1.xml"];

  it("contains every part Excel needs", () => {
    expect(Object.keys(files).sort()).toEqual([
      "[Content_Types].xml", "_rels/.rels", "xl/_rels/workbook.xml.rels", "xl/styles.xml", "xl/workbook.xml", "xl/worksheets/sheet1.xml"
    ]);
  });
  it("keeps numbers as numbers and text as escaped text", () => {
    expect(sheet).toContain('<c r="B3"><v>12000</v></c>');
    expect(sheet).toContain('<c r="C3"><v>12000.5</v></c>');
    expect(sheet).toContain("Diesel &amp; Oil &lt;tractor&gt;");
    expect(sheet).toContain("<t xml:space=\"preserve\">کھاد</t>");
  });
  it("never writes a formula (text that starts with = stays text)", () => {
    expect(sheet).not.toContain("<f>");
    expect(sheet).toContain('t="inlineStr"><is><t xml:space="preserve">=SUM(A1:A2)</t>');
  });
  it("leaves empty values out and makes the chosen rows bold", () => {
    expect(sheet).not.toContain('r="C4"');
    expect(sheet).toContain('<c r="A1" s="1" t="inlineStr">');
    expect(sheet).toContain('<c r="A3" t="inlineStr">');
  });
  it("uses a sheet name Excel accepts", () => {
    expect(files["xl/workbook.xml"]).toContain('<sheet name="Head-wise  report  2026" sheetId="1"');
    expect(sheetName("x".repeat(40))).toHaveLength(31);
    expect(sheetName("")).toBe("Sheet1");
  });
  it("names columns A, Z, AA, AZ", () => {
    expect([0, 25, 26, 51, 701].map(columnName)).toEqual(["A", "Z", "AA", "AZ", "ZZ"]);
  });
  it("removes characters XML cannot hold", () => {
    expect(xmlText("a\u0001b\u0008c")).toBe("abc");
    expect(xmlText('"q"')).toBe("&quot;q&quot;");
  });
});
