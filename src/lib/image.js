// =========================================================
// Photo compression in the browser, so slips fit in Firestore.
// =========================================================

import { ATTACHMENT } from "../config.js";

/** Loads an image file so it can be drawn on a canvas. */
function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("This image could not be opened.")); };
    img.src = url;
  });
}

/** Reads a file as a data URL ("data:application/pdf;base64,..."). */
export function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/** Shrinks a photo to a JPEG data URL that fits in Firestore, keeping the text on the slip readable. */
export async function compressImage(file) {
  const img = await loadImage(file);
  let side = ATTACHMENT.maxSide;
  let quality = 0.82;
  for (let attempt = 0; attempt < 8; attempt++) {
    const scale = Math.min(1, side / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";   // transparent screenshots get a white background
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/jpeg", quality);
    if (dataUrl.length <= ATTACHMENT.maxChars) return dataUrl;
    // Still too big: lower the quality first, then the size
    if (quality > 0.55) quality -= 0.12; else side = Math.round(side * 0.8);
  }
  throw new Error("This photo is too large. Please take a closer photo of the slip.");
}
