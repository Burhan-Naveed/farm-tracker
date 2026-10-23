// =========================================================
// Backup card on the Users page (Admin): save the backup file
// to Google Drive, and restore missing data from it.
// =========================================================

import { GOOGLE_DRIVE } from "../config.js";
import {
  BACKUP_COLLECTIONS, buildBackup, parseBackup, planRestore, restoreSummary, restoredEntry, restoredHead
} from "../domain/backup.js";
import { logError, userMessage } from "../lib/errors.js";
import { fetchCollections, latestAuditRecord, logAudit, restoreEntries, restoreHeads } from "../services/data.js";
import { DriveError, connectDrive, loadGoogleSignIn, readBackupFile, saveBackupFile } from "../services/drive.js";
import { currentActor, isAdmin, state } from "../state.js";
import { $, setHidden } from "./dom.js";
import { showToast } from "./feedback.js";

const BACKUP_ACTION = "backup-drive";
const RESTORE_ACTION = "restore-drive";

let lastBackupLoaded = false;   // the "Last backup" line is read once per session, then after each backup

/** "23 Oct 2026, 15:30" */
const dateTimeText = (date) => date.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });

/** Shows a message inside the card (error = red). */
function showMessage(text, isError = false) {
  const el = $("backup-msg");
  el.textContent = text;
  el.classList.toggle("error", isError);
  el.classList.toggle("ok", !isError);
  setHidden(el, !text);
}

/** Logs the error for developers and shows a clear message in the card. */
function showFailure(context, err, fallback) {
  logError(context, err);
  showMessage(err instanceof DriveError ? err.message : userMessage(err, fallback), true);
}

/** Disables the buttons while something is running. */
function setBusy(busy) {
  ["backup-btn", "restore-btn"].forEach((id) => { $(id).disabled = busy; });
}

/** Shows when the last backup was made (read from the change history). */
async function showLastBackup() {
  try {
    const last = await latestAuditRecord(BACKUP_ACTION);
    $("backup-last").textContent = last && last.at
      ? `Last backup: ${dateTimeText(last.at.toDate())} by ${last.byEmail}`
      : "Last backup: never";
  } catch (err) {
    logError("Reading last backup", err);
    $("backup-last").textContent = "Last backup: unknown (offline?)";
  }
}

/** Reads all data from the server and saves it over the backup file in Google Drive. */
async function backupNow() {
  if (!isAdmin()) return;
  setBusy(true);
  showMessage("Connecting to Google Drive…");
  try {
    await connectDrive();   // first, so the Google popup opens straight from the click
    showMessage("Preparing backup…");
    const collections = await fetchCollections(BACKUP_COLLECTIONS);
    const backup = buildBackup(collections, { createdAt: new Date(), createdBy: state.user.email });
    showMessage("Saving to Google Drive…");
    await saveBackupFile(JSON.stringify(backup));
    const summary = `${backup.counts.expenses} entries, ${backup.counts.heads} heads, ${backup.counts.users} users`;
    logAudit(currentActor(), BACKUP_ACTION, summary);
    showMessage(`Backup saved to Google Drive (${summary}).`);
    showToast("Backup saved");
    setTimeout(showLastBackup, 1500);
  } catch (err) {
    showFailure("Backup to Google Drive", err, "Backup failed. Please check your internet connection and try again.");
  } finally {
    setBusy(false);
  }
}

/** Reads the backup file and adds back whatever is missing. */
async function restoreFromBackup() {
  if (!isAdmin()) return;
  setBusy(true);
  showMessage("Connecting to Google Drive…");
  try {
    await connectDrive();
    showMessage("Reading backup…");
    const file = await readBackupFile();
    if (!file) { showMessage("There is no backup in Google Drive yet.", true); return; }
    const parsed = parseBackup(file.text);
    if (!parsed.ok) { showMessage(parsed.error, true); return; }
    const backupDate = dateTimeText(new Date(parsed.backup.createdAt));

    // Compare with the data on the server, not only the offline copy
    const current = await fetchCollections(["heads", "expenses"]);
    const plan = planRestore(parsed.backup, {
      headIds: new Set(current.heads.map((h) => h.id)),
      entryIds: new Set(current.expenses.map((x) => x.id))
    });
    if (!plan.heads.length && !plan.entries.length) {
      showMessage("Nothing to restore: everything in the backup is already in the app." +
        (plan.skipped ? ` (${plan.skipped} damaged records were skipped.)` : ""));
      return;
    }
    if (!confirm(`Restore from the backup of ${backupDate}?\n\nThis adds back ${restoreSummary(plan)}.\nExisting data is not changed.`)) {
      showMessage("");
      return;
    }

    showMessage("Restoring…");
    const actor = currentActor();
    await restoreHeads(plan.heads.map((h) => ({ id: h.id, ...restoredHead(h) })), actor);
    await restoreEntries(plan.entries.map((x) => ({ id: x.id, ...restoredEntry(x) })), actor);
    logAudit(actor, RESTORE_ACTION, `Backup of ${backupDate}: ${restoreSummary(plan)}`);
    showMessage(`Restore finished: ${restoreSummary(plan)} added back.`);
  } catch (err) {
    showFailure("Restoring from Google Drive", err, "Restore stopped. Part of the data may have been added; you can safely run it again.");
  } finally {
    setBusy(false);
  }
}

/** Called when the Users page is drawn. */
export function renderBackupPanel() {
  const enabled = !!GOOGLE_DRIVE.clientId && isAdmin();
  setHidden($("backup-card"), !enabled);
  if (!enabled) return;
  // Load Google sign-in early, so the permission popup opens straight from the click
  loadGoogleSignIn().catch((err) => logError("Loading Google sign-in", err));
  if (!lastBackupLoaded) {
    lastBackupLoaded = true;
    showLastBackup();
  }
}

export function initBackupPanel() {
  $("backup-btn").addEventListener("click", backupNow);
  $("restore-btn").addEventListener("click", restoreFromBackup);
}
