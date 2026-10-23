// =========================================================
// A small ZIP file writer (files are stored, not compressed).
// An Excel .xlsx file is a ZIP of XML files; writing it here
// means no extra library has to be downloaded.
// =========================================================

/** CRC-32 table (the checksum every ZIP entry needs). */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** CRC-32 of some bytes. */
export function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** Date and time in the old MS-DOS format that ZIP uses. */
function dosDateTime(date) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
}

/**
 * Builds a ZIP file. files: [{ name, data }] where data is text (saved as UTF-8)
 * or a Uint8Array. Returns the ZIP as a Uint8Array.
 */
export function createZip(files, date = new Date()) {
  const encoder = new TextEncoder();
  const { time, day } = dosDateTime(date);
  const parts = [];
  const central = [];
  let offset = 0;

  files.forEach(({ name, data }) => {
    const nameBytes = encoder.encode(name);
    const bytes = typeof data === "string" ? encoder.encode(data) : data;
    const crc = crc32(bytes);

    // Local file header + the file itself
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);   // signature
    local.setUint16(4, 20, true);           // version needed
    local.setUint16(6, 0x0800, true);       // names are UTF-8
    local.setUint16(8, 0, true);            // method: stored
    local.setUint16(10, time, true);
    local.setUint16(12, day, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, bytes.length, true);
    local.setUint32(22, bytes.length, true);
    local.setUint16(26, nameBytes.length, true);
    local.setUint16(28, 0, true);
    parts.push(new Uint8Array(local.buffer), nameBytes, bytes);

    // Matching entry for the central directory at the end
    const entry = new DataView(new ArrayBuffer(46));
    entry.setUint32(0, 0x02014b50, true);
    entry.setUint16(4, 20, true);
    entry.setUint16(6, 20, true);
    entry.setUint16(8, 0x0800, true);
    entry.setUint16(10, 0, true);
    entry.setUint16(12, time, true);
    entry.setUint16(14, day, true);
    entry.setUint32(16, crc, true);
    entry.setUint32(20, bytes.length, true);
    entry.setUint32(24, bytes.length, true);
    entry.setUint16(28, nameBytes.length, true);
    entry.setUint32(42, offset, true);      // where the local header starts
    central.push(new Uint8Array(entry.buffer), nameBytes);

    offset += 30 + nameBytes.length + bytes.length;
  });

  const centralSize = central.reduce((sum, part) => sum + part.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);

  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const zip = new Uint8Array(all.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  all.forEach((part) => { zip.set(part, at); at += part.length; });
  return zip;
}
