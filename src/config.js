// =========================================================
// App settings. Change these lists here if anything changes later.
// IMPORTANT: farms, Paid By options, MAX_AMOUNT and the attachment
// limit are also checked in firestore.rules. Keep both in sync
// (a unit test fails if they differ).
// =========================================================

export const CONFIG = Object.freeze({
  farms: ["Fatehpur Farm", "Bhakkarpur Farm", "Rehmanbad Farm"],
  currency: "PKR",
  paidByOptions: ["BM", "Manager", "Other"],
  defaultPaidBy: "BM",
  // Used ONLY to fill the "heads" collection the first time;
  // after that heads are always read from Firestore.
  defaultHeads: [
    { name: "Sales", type: "Inflow" },
    { name: "Purchase", type: "Outflow" },
    { name: "Salary", type: "Outflow" },
    { name: "Rent", type: "Outflow" },
    { name: "Bijli / Electric / Utilities", type: "Outflow" },
    { name: "Transport", type: "Outflow" },
    { name: "Operating Expenses", type: "Outflow" },
    { name: "Diesel for Machinery & Tractor", type: "Outflow" },
    { name: "Misc. Expenses", type: "Outflow" },
    { name: "Machinery Repairing & Maint.", type: "Outflow" },
    { name: "Cash by Owner (Amjad Ali)", type: "Inflow" },
    { name: "Petty Cash Paid", type: "Outflow" }
  ]
});

/** Entry types. Every head is one of these. */
export const TYPES = Object.freeze(["Inflow", "Outflow"]);

/** User roles and statuses stored in the "users" collection. */
export const ROLES = Object.freeze(["admin", "staff"]);
export const STATUSES = Object.freeze(["active", "disabled"]);

/** Field limits (the same numbers are enforced in firestore.rules). */
export const LIMITS = Object.freeze({
  maxAmount: 1000000000,       // 100 crore rupees per entry
  noteMax: 200,
  headNameMax: 50,
  userNameMax: 60,
  fileNameMax: 200,
  auditDetailsMax: 500
});

/**
 * Google Drive backups. The OAuth client ID is a public identifier (not a secret);
 * it only works on the web addresses allowed in Google Cloud Console.
 * Leave clientId empty to hide Drive backups.
 */
export const GOOGLE_DRIVE = Object.freeze({
  clientId: "89212496483-42lapkqen0mbe5l4oo3eeiih9pg9iptp.apps.googleusercontent.com",
  accountEmail: "farmexpensestracker@gmail.com",           // backups go only to this Google account's Drive
  scope: "https://www.googleapis.com/auth/drive.file",   // only files this app creates
  folderName: "Farm Tracker Backups",
  fileName: "farm-tracker-backup.json"                       // one file, replaced by every backup
});

/** Attachment (slip / bill) limits. Firestore documents can be at most 1 MB. */
export const ATTACHMENT = Object.freeze({
  maxChars: 900000,            // max length of the stored data URL (about 650 KB of file)
  maxSide: 1600,               // photos are resized so the longest side is at most this many pixels
  types: ["image/jpeg", "application/pdf"]
});
