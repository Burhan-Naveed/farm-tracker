// =========================================================
// Farm Tracker - entry point.
// Plain JavaScript modules + Firebase 13 (no build step).
//
// Flow: login -> watch the user's own "users" record (decides access
// and role) -> start live listeners -> draw the open page whenever
// data changes on any device.
// =========================================================

import { compareNewestFirst } from "./domain/entries.js";
import { logError } from "./lib/errors.js";
import { watchAuth } from "./services/auth.js";
import { seedDefaultHeads, watchExpenses, watchHeads, watchProfile, watchUsers, wipeLocalData } from "./services/data.js";
import { clearData, currentActor, isAdmin, setHeads, state } from "./state.js";
import { initBackupPanel } from "./ui/backup-panel.js";
import { initDashboard } from "./ui/dashboard-page.js";
import { $, setHidden } from "./ui/dom.js";
import { initEntriesPage, refreshEntryFilters } from "./ui/entries-page.js";
import { initEntryForm, refreshHeadOptions, resetEntryForm } from "./ui/entry-form.js";
import { onWriteError, reportError } from "./ui/feedback.js";
import { initHeadsPage } from "./ui/heads-page.js";
import { HOME_PAGE, getCurrentPage, renderAllPages, renderCurrentPage, showPage, showView } from "./ui/navigation.js";
import { initPwa } from "./ui/pwa.js";
import { initReportsPage, refreshReportHeadOptions } from "./ui/reports-page.js";
import { initSession } from "./ui/session.js";
import { initUsersPage } from "./ui/users-page.js";
import { initViewer } from "./ui/viewer.js";

const ACCESS_DENIED = "Your account does not have access to this app. Please contact the Admin.";
const ACCOUNT_DISABLED = "Your account has been disabled. Please contact the Admin.";

let dataListeners = [];      // Firestore unsubscribe functions
let profileUnsub = null;

function stopDataListeners() {
  dataListeners.forEach((unsub) => unsub());
  dataListeners = [];
}

function stopAllListeners() {
  if (profileUnsub) { profileUnsub(); profileUnsub = null; }
  stopDataListeners();
}

/** Deletes the offline copy of the data from this device (errors are only logged). */
async function wipeDeviceData() {
  try {
    await wipeLocalData();
  } catch (err) {
    // Usually another open tab still uses the data; it is cleared when that tab logs out
    logError("Clearing offline data", err);
  }
}

/** After logout: remove all data from this device and start fresh. */
async function endSession() {
  stopAllListeners();
  clearData();
  await wipeDeviceData();
  location.reload();
}

// ---------------------------------------------------------
// Live data
// ---------------------------------------------------------

/**
 * A listener error: log it and tell the user. "permission-denied" means access
 * was just removed; the profile listener then shows the Access denied screen.
 */
const onListenError = (context) => (err) => {
  if (!state.profile || err.code === "permission-denied") { logError(context, err); return; }
  reportError(context, err, "Could not load data. Please check your internet connection.");
};

function startDataListeners() {
  let headsCheckedOnServer = false;
  dataListeners.push(watchHeads((heads, { fromServer }) => {
    // Seed the default heads the first time, but only when the server
    // (not just an empty offline cache) confirms there are none
    if (fromServer && !headsCheckedOnServer) {
      headsCheckedOnServer = true;
      if (heads.length === 0 && isAdmin()) seedDefaultHeads(currentActor()).catch(onWriteError("Creating default heads"));
    }
    setHeads(heads);
    refreshHeadOptions();
    refreshEntryFilters();
    refreshReportHeadOptions();
    renderCurrentPage();
  }, onListenError("Loading heads")));

  dataListeners.push(watchExpenses((expenses) => {
    state.expenses = expenses.sort(compareNewestFirst);
    renderCurrentPage();
  }, onListenError("Loading entries")));

  if (isAdmin()) {
    dataListeners.push(watchUsers((users) => {
      state.users = users;
      renderCurrentPage();
    }, onListenError("Loading users")));
  }
}

// ---------------------------------------------------------
// Access and roles
// ---------------------------------------------------------

/** Shows or hides Admin-only elements based on the user's role. */
function applyRole() {
  document.querySelectorAll(".admin-only").forEach((el) => setHidden(el, !isAdmin()));
  $("user-label").textContent = `${state.profile.name || state.user.email} (${isAdmin() ? "Admin" : "Staff"})`;
}

/** Starts (or restarts, after a role change) the main app. */
function startApp() {
  stopDataListeners();
  applyRole();
  showView("app");
  resetEntryForm();
  startDataListeners();
  showPage(getCurrentPage() || HOME_PAGE);
}

/**
 * Shows the "Access denied" screen, removes all data from the screen and
 * deletes the offline copy, so a disabled user cannot read it offline.
 */
function denyAccess(message) {
  stopAllListeners();
  clearData();
  renderAllPages();
  $("denied-msg").textContent = message;
  showView("denied");
  wipeDeviceData();
}

/** Called whenever the user's own record changes. */
function handleProfile(profile) {
  const allowed = profile && profile.status === "active" && ["admin", "staff"].includes(profile.role);
  if (!allowed) {
    denyAccess(profile && profile.status === "disabled" ? ACCOUNT_DISABLED : ACCESS_DENIED);
    return;
  }
  const roleChanged = !state.profile || state.profile.role !== profile.role;
  state.profile = profile;
  if (roleChanged) startApp();
  else applyRole();
}

/** Runs whenever the login state changes. */
function handleAuthChange(user) {
  stopAllListeners();

  if (!user) {
    // Logged out (here or in another tab): clear everything
    if (state.user) { endSession(); return; }
    showView("login");
    return;
  }

  state.user = user;
  state.profile = null;
  showView("loading");
  profileUnsub = watchProfile(user.uid, handleProfile, (err) => {
    // The rules block reading for users without a record
    if (err.code !== "permission-denied") reportError("Loading user profile", err);
    denyAccess(ACCESS_DENIED);
  });
}

// ---------------------------------------------------------
// Start
// ---------------------------------------------------------

initSession();
initViewer();
initDashboard();
initEntryForm();
initEntriesPage();
initReportsPage();
initHeadsPage();
initUsersPage();
initBackupPanel();
initPwa();
$("tabs").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-page]");
  if (btn) showPage(btn.dataset.page);
});
watchAuth(handleAuthChange);
