// =========================================================
// Attachment (slip / bill) checks. Files are stored in Firestore
// as data URLs, because Firebase Storage needs the paid plan.
// =========================================================

import { ATTACHMENT, LIMITS } from "../config.js";
import { formatSize } from "../lib/format.js";

const DATA_URL_PATTERN = /^data:(image\/jpeg|application\/pdf);base64,[A-Za-z0-9+/=]+$/;

/** Which kind of file the user picked: "pdf", "image" or null (not allowed). */
export function fileKind(mimeType) {
  if (mimeType === "application/pdf") return "pdf";
  if (String(mimeType || "").startsWith("image/")) return "image";
  return null;
}

/** Approximate file size in bytes of a base64 data URL. */
export const dataUrlBytes = (dataUrl) => Math.round((dataUrl.length - dataUrl.indexOf(",") - 1) * 0.75);

/** File name to store: photos are converted to JPEG, names are shortened to the limit. */
export function storedFileName(originalName, kind) {
  const base = String(originalName || "attachment").trim() || "attachment";
  const name = kind === "pdf" ? base : base.replace(/\.[^.]+$/, "") + ".jpg";
  return name.length > LIMITS.fileNameMax ? name.slice(name.length - LIMITS.fileNameMax) : name;
}

/** Checks a prepared data URL. Returns an error message, or "" when it can be saved. */
export function attachmentError(dataUrl, originalBytes) {
  if (typeof dataUrl !== "string" || !DATA_URL_PATTERN.test(dataUrl)) return "This file could not be read. Please choose another file.";
  if (dataUrl.length > ATTACHMENT.maxChars) {
    return `This file is ${formatSize(originalBytes || dataUrlBytes(dataUrl))}. The limit is about 650 KB. Please attach a photo or screenshot instead.`;
  }
  return "";
}

/** Turns a data URL back into a Blob (for viewing or downloading). */
export function dataUrlToBlob(dataUrl) {
  const comma = dataUrl.indexOf(",");
  const mimeType = dataUrl.slice(5, dataUrl.indexOf(";"));
  const binary = atob(dataUrl.slice(comma + 1));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mimeType });
}
