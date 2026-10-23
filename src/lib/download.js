// =========================================================
// Saves a file from the browser (used by the CSV and Excel exports).
// =========================================================

/** Downloads a Blob as a file with the given name. */
export function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
