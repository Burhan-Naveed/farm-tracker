// =========================================================
// Google Drive: sign in with Google (Google Identity Services)
// and save / list / download backup files.
//
// The "drive.file" permission only lets the app see files it
// created itself, never the rest of the user's Drive.
// =========================================================

import { GOOGLE_DRIVE } from "../config.js";

const GIS_SCRIPT = "https://accounts.google.com/gsi/client";
const DRIVE_API = "https://www.googleapis.com/drive/v3/files";
const UPLOAD_API = "https://www.googleapis.com/upload/drive/v3/files";
const ABOUT_API = "https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)";
const FOLDER_TYPE = "application/vnd.google-apps.folder";

/** An error with a message that can be shown to the user as it is. */
export class DriveError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = "DriveError";
    this.cause = cause;
  }
}

let gisLoading = null;
let token = null;          // { value, expiresAt }

/** Loads the Google sign-in library once (call early, so the click opens the popup at once). */
export function loadGoogleSignIn() {
  if (!gisLoading) {
    gisLoading = new Promise((resolve, reject) => {
      if (window.google?.accounts?.oauth2) { resolve(); return; }
      const script = document.createElement("script");
      script.src = GIS_SCRIPT;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => {
        gisLoading = null;   // allow a retry later
        reject(new DriveError("Google sign-in could not be loaded. Please check your internet connection."));
      };
      document.head.appendChild(script);
    });
  }
  return gisLoading;
}

/** Asks Google for a token (a popup the first time). selectAccount shows the account chooser. */
async function requestToken(selectAccount) {
  await loadGoogleSignIn();
  return new Promise((resolve, reject) => {
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_DRIVE.clientId,
      scope: GOOGLE_DRIVE.scope,
      login_hint: GOOGLE_DRIVE.accountEmail,
      callback: (response) => {
        if (response.error || !response.access_token) {
          reject(new DriveError("Google Drive permission was not given.", response));
          return;
        }
        resolve({ value: response.access_token, expiresAt: Date.now() + Number(response.expires_in || 3600) * 1000 });
      },
      error_callback: (err) => reject(new DriveError(
        err && err.type === "popup_failed_to_open"
          ? "The Google window was blocked. Please allow pop-ups for this site and try again."
          : "Google sign-in was closed before it finished.", err))
    });
    client.requestAccessToken({ prompt: selectAccount ? "select_account" : "" });
  });
}

/** The email of the Google account a token belongs to. */
async function accountEmailOf(accessToken) {
  let response;
  try {
    response = await fetch(ABOUT_API, { headers: { Authorization: "Bearer " + accessToken } });
  } catch (err) {
    throw new DriveError("Google Drive cannot be reached. Please check your internet connection.", err);
  }
  if (!response.ok) throw new DriveError(`Google Drive error (${response.status}). Please try again.`);
  const about = await response.json();
  return String(about.user?.emailAddress || "").toLowerCase();
}

let chooseAccountNext = false;   // after a wrong account, show the account chooser next time

/**
 * Returns an access token for the backup account only. A token for any
 * other Google account is refused, so backups never go to the wrong Drive.
 */
async function getAccessToken() {
  if (token && token.expiresAt > Date.now() + 60000) return token.value;
  const granted = await requestToken(chooseAccountNext);
  const email = await accountEmailOf(granted.value);
  if (email !== GOOGLE_DRIVE.accountEmail) {
    chooseAccountNext = true;
    window.google.accounts.oauth2.revoke?.(granted.value, () => {});
    throw new DriveError(`Backups are kept in ${GOOGLE_DRIVE.accountEmail}. You chose ${email || "another account"}; please try again and choose ${GOOGLE_DRIVE.accountEmail}.`);
  }
  chooseAccountNext = false;
  token = granted;
  return token.value;
}

/** Asks for Google Drive permission now (call first in a click handler, so the popup is not blocked). */
export const connectDrive = () => getAccessToken();

/** Calls the Drive API with the token; turns HTTP errors into clear messages. */
async function driveFetch(url, options = {}) {
  const accessToken = await getAccessToken();
  let response;
  try {
    response = await fetch(url, { ...options, headers: { ...options.headers, Authorization: "Bearer " + accessToken } });
  } catch (err) {
    throw new DriveError("Google Drive cannot be reached. Please check your internet connection.", err);
  }
  if (response.status === 401) {
    token = null;   // expired or revoked: ask again next time
    throw new DriveError("Google Drive sign-in has expired. Please try again.");
  }
  if (response.status === 403) throw new DriveError("Google Drive refused access. Please check the Google account and try again.");
  if (response.status === 404) throw new DriveError("This backup file no longer exists in Google Drive.");
  if (!response.ok) throw new DriveError(`Google Drive error (${response.status}). Please try again.`);
  return response;
}

/** Escapes a value for a Drive search query. */
const quoted = (text) => "'" + String(text).replace(/\\/g, "\\\\").replace(/'/g, "\\'") + "'";

/** Finds the backup folder (created by this app), or creates it. */
async function backupFolderId() {
  const q = `name = ${quoted(GOOGLE_DRIVE.folderName)} and mimeType = '${FOLDER_TYPE}' and trashed = false`;
  const found = await (await driveFetch(`${DRIVE_API}?q=${encodeURIComponent(q)}&fields=files(id)&pageSize=1`)).json();
  if (found.files && found.files.length) return found.files[0].id;
  const created = await (await driveFetch(`${DRIVE_API}?fields=id`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: GOOGLE_DRIVE.folderName, mimeType: FOLDER_TYPE })
  })).json();
  return created.id;
}

/** Finds the backup file in the backup folder: { id, modifiedTime } or null. */
async function findBackupFile(folderId) {
  const q = `name = ${quoted(GOOGLE_DRIVE.fileName)} and ${quoted(folderId)} in parents and trashed = false`;
  const found = await (await driveFetch(`${DRIVE_API}?q=${encodeURIComponent(q)}&fields=files(id,modifiedTime)&pageSize=1`)).json();
  return found.files && found.files.length ? found.files[0] : null;
}

/** A multipart body (file details + file content) for the Drive upload API. */
function multipartBody(metadata, jsonText) {
  const boundary = "farm-tracker-" + Math.random().toString(36).slice(2);
  const body =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${jsonText}\r\n--${boundary}--`;
  return { body, contentType: `multipart/related; boundary=${boundary}` };
}

/**
 * Saves the backup: replaces the content of the one backup file, or creates
 * it the first time. (Google Drive keeps older versions for about 30 days.)
 * Returns { id, name, modifiedTime }.
 */
export async function saveBackupFile(jsonText) {
  const folderId = await backupFolderId();
  const existing = await findBackupFile(folderId);
  const { body, contentType } = existing
    ? multipartBody({ mimeType: "application/json" }, jsonText)
    : multipartBody({ name: GOOGLE_DRIVE.fileName, parents: [folderId], mimeType: "application/json" }, jsonText);
  const url = existing
    ? `${UPLOAD_API}/${encodeURIComponent(existing.id)}?uploadType=multipart&fields=id,name,modifiedTime`
    : `${UPLOAD_API}?uploadType=multipart&fields=id,name,modifiedTime`;
  const response = await driveFetch(url, { method: existing ? "PATCH" : "POST", headers: { "Content-Type": contentType }, body });
  return response.json();
}

/** Reads the backup file: { text, modifiedTime }, or null when there is no backup yet. */
export async function readBackupFile() {
  const file = await findBackupFile(await backupFolderId());
  if (!file) return null;
  const response = await driveFetch(`${DRIVE_API}/${encodeURIComponent(file.id)}?alt=media`);
  return { text: await response.text(), modifiedTime: file.modifiedTime };
}
