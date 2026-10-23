// =========================================================
// Users: validation of the Add User form. Pure functions.
// =========================================================

import { LIMITS, ROLES } from "../config.js";
import { cleanText } from "../lib/format.js";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UID_PATTERN = /^[A-Za-z0-9]{20,128}$/;   // Firebase Auth UIDs are letters and digits

export const isValidEmail = (email) => EMAIL_PATTERN.test(String(email ?? ""));

/**
 * Checks the Add User form.
 * input: { name, email, uid, role }
 * Returns { ok: true, value } or { ok: false, error }.
 */
export function validateUser(input, { users }) {
  const name = cleanText(input.name);
  const email = String(input.email ?? "").trim().toLowerCase();
  const uid = String(input.uid ?? "").trim();
  const role = input.role;

  if (!name) return { ok: false, error: "Please enter a name." };
  if (name.length > LIMITS.userNameMax) return { ok: false, error: `Name can be at most ${LIMITS.userNameMax} characters.` };
  if (!isValidEmail(email)) return { ok: false, error: "Please enter a valid email." };
  if (!UID_PATTERN.test(uid)) return { ok: false, error: "Please paste the User UID exactly as shown in Firebase Console." };
  if (!ROLES.includes(role)) return { ok: false, error: "Please select a role." };
  if (users.some((u) => u.id === uid)) return { ok: false, error: "A user with this UID already exists." };
  if (users.some((u) => String(u.email || "").toLowerCase() === email)) return { ok: false, error: "A user with this email already exists." };

  return { ok: true, value: { uid, name, email, role } };
}

/** Users sorted by name, for the Users table. */
export const sortedUsers = (users) => [...users].sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
