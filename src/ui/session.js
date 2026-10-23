// =========================================================
// Login screen, "Forgot password?", "Change password" and Logout.
// =========================================================

import { isValidEmail } from "../domain/users.js";
import { logError, userMessage } from "../lib/errors.js";
import { sendPasswordEmail, signIn, signOutUser } from "../services/auth.js";
import { hasUnsyncedChanges } from "../services/data.js";
import { state } from "../state.js";
import { $, showFormError } from "./dom.js";
import { reportError, showToast } from "./feedback.js";

async function handleLogin(e) {
  e.preventDefault();
  const email = $("login-email").value.trim();
  const password = $("login-password").value;
  if (!email || !password) { showFormError("login-error", "Please enter email and password."); return; }
  if (!isValidEmail(email)) { showFormError("login-error", "Please enter a valid email address."); return; }
  showFormError("login-error", "");
  $("login-btn").disabled = true;
  try {
    await signIn(email, password);
    $("login-password").value = "";
  } catch (err) {
    logError("Sign in", err);
    showFormError("login-error", userMessage(err, "Sign in failed. Please try again."));
  } finally {
    $("login-btn").disabled = false;
  }
}

/** "Forgot password?" sends a reset email to the typed address. */
async function handleForgotPassword() {
  const email = $("login-email").value.trim();
  if (!isValidEmail(email)) {
    showFormError("login-error", "Type your email above first, then click 'Forgot password?'.");
    return;
  }
  try {
    await sendPasswordEmail(email);
    showFormError("login-error", "");
    alert("If this email has an account, a password reset link has been sent to " + email + ".");
  } catch (err) {
    logError("Password reset email", err);
    showFormError("login-error", userMessage(err, "Could not send the email. Please try again."));
  }
}

/** "Change password" in the header sends a reset email to the logged-in user. */
async function handleChangePassword() {
  if (!confirm("Send a password change link to " + state.user.email + "?")) return;
  try {
    await sendPasswordEmail(state.user.email);
    showToast("Password change link sent to " + state.user.email);
  } catch (err) {
    reportError("Password change email", err, "Could not send the email. Please try again.");
  }
}

/**
 * Logout. Logging out deletes the offline copy of the data, so first make
 * sure no saved entry is still waiting for internet (it would be lost).
 */
async function handleLogout(button) {
  button.disabled = true;
  try {
    let unsynced = false;
    try {
      unsynced = await hasUnsyncedChanges();
    } catch (err) {
      logError("Checking unsynced changes", err);   // database already closed (access removed)
    }
    const message = "Some saved entries have not reached the server yet (no internet?).\n" +
      "If you log out now, they will be lost.\n\nLog out anyway?";
    if (unsynced && !confirm(message)) return;
    await signOutUser();
  } catch (err) {
    reportError("Sign out", err, "Could not log out. Please try again.");
  } finally {
    button.disabled = false;
  }
}

export function initSession() {
  $("login-form").addEventListener("submit", handleLogin);
  $("forgot-btn").addEventListener("click", handleForgotPassword);
  $("change-pass-btn").addEventListener("click", handleChangePassword);
  document.querySelectorAll('[data-action="logout"]').forEach((btn) =>
    btn.addEventListener("click", () => handleLogout(btn))
  );
}
