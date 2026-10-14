// =========================================================
// Farm Tracker - main application code
// Plain JavaScript + Firebase v13 (modular SDK from the CDN).
// =========================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/13.0.0/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut, sendPasswordResetEmail
} from "https://www.gstatic.com/firebasejs/13.0.0/firebase-auth.js";
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, setDoc, updateDoc, deleteDoc, addDoc, getDoc, getDocs, onSnapshot,
  query, where, orderBy, limit, writeBatch, serverTimestamp
} from "https://www.gstatic.com/firebasejs/13.0.0/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

// ---------------------------------------------------------
// CONFIG: farm names, currency, Paid By options, default heads.
// Change these lists here if anything changes later.
// Default heads are used ONLY to fill the "heads" collection the
// first time; after that heads are always read from Firestore.
// ---------------------------------------------------------
const CONFIG = {
  farms: ["Fatehpur Farm", "Bhakkarpur Farm", "Rehmanbad Farm"],
  currency: "PKR",
  paidByOptions: ["BM", "Manager", "Other"],
  defaultPaidBy: "BM",
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
};

// ---------------------------------------------------------
// Firebase setup. Offline persistence keeps a local copy of the
// data, so the app works with weak internet and syncs later.
// ---------------------------------------------------------
const firebaseApp = initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);
const db = initializeFirestore(firebaseApp, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
});

// ---------------------------------------------------------
// App state (kept in memory, updated live from Firestore)
// ---------------------------------------------------------
const state = {
  user: null,          // Firebase Auth user
  profile: null,       // matching document from the "users" collection
  heads: [],           // all heads (active and inactive)
  expenses: [],        // all entries, newest first
  users: [],           // all users (Admin only)
  editingExpenseId: null,
  attachment: null,    // file chosen in the entry form: { data, name, type, size }
  attachmentRemoved: false, // true when a saved attachment is removed while editing
  reportView: "total", // Reports page: "total" (all farms) or "farm" (one farm with its transactions)
  editingHeadId: null,
  currentPage: null,
  listeners: [],       // Firestore unsubscribe functions
  chart: null
};

// Short helper to find an element by id
const $ = (id) => document.getElementById(id);

const isAdmin = () => state.profile && state.profile.role === "admin";

// =========================================================
// SMALL HELPERS
// =========================================================

/** Formats a number as "125,000" (commas, whole rupees, no decimals). */
function formatNumber(n) {
  return Math.round(Number(n || 0)).toLocaleString("en-US", { maximumFractionDigits: 0 });
}

/** Formats a number as "PKR 125,000". Negative values show as "-PKR 1,000". */
function formatMoney(n) {
  const value = Number(n || 0);
  return (value < 0 ? "-" : "") + CONFIG.currency + " " + formatNumber(Math.abs(value));
}

/** Adds money values safely (works in paisa to avoid decimal rounding errors). */
function addMoney(a, b) {
  return (Math.round(a * 100) + Math.round(b * 100)) / 100;
}

/** Returns a local date as "YYYY-MM-DD" (not UTC, so it is correct in Pakistan time). */
function toDateString(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
const todayString = () => toDateString(new Date());
const currentMonthString = () => todayString().slice(0, 7);

/** Escapes text before putting it inside HTML (prevents broken layout or script injection). */
function escapeHtml(text) {
  return String(text ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

/** Normalises a head name for duplicate checks: trims, collapses spaces, ignores case. */
function normalizeName(name) {
  return String(name || "").trim().replace(/\s+/g, " ").toLowerCase();
}

/** Shows a short message at the bottom of the screen. */
let toastTimer = null;
function showToast(message, isError = false) {
  const toast = $("toast");
  toast.textContent = message;
  toast.classList.toggle("error", isError);
  toast.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.add("hidden"), isError ? 5000 : 2500);
}

/** Shows (or hides, when message is empty) an error box under a form. */
function showFormError(elementId, message) {
  const el = $(elementId);
  el.textContent = message || "";
  el.classList.toggle("hidden", !message);
}

/**
 * Called when a Firestore write is rejected by the server
 * (for example, no permission). Writes are not awaited because
 * offline writes only finish when internet returns.
 */
function onWriteError(err) {
  console.error(err);
  const msg = err && err.code === "permission-denied"
    ? "You do not have permission for this action."
    : "Could not save to the server: " + (err && err.message ? err.message : err);
  showToast(msg, true);
}

/** Fills a <select> with options. Each option is { value, label }. */
function fillSelect(select, options, selectedValue) {
  select.innerHTML = options
    .map((o) => `<option value="${escapeHtml(o.value)}">${escapeHtml(o.label)}</option>`)
    .join("");
  if (selectedValue !== undefined) select.value = selectedValue;
}

/** Returns heads sorted: Inflow first, then Outflow, each alphabetical. */
function sortedHeads(heads) {
  return [...heads].sort((a, b) =>
    a.type === b.type ? a.name.localeCompare(b.name) : (a.type === "Inflow" ? -1 : 1)
  );
}

/** Logs an admin change to the "auditLog" collection (best effort, errors only go to the console). */
function logAudit(action, details) {
  addDoc(collection(db, "auditLog"), {
    action,
    details,
    byUid: state.user.uid,
    byEmail: state.user.email,
    at: serverTimestamp()
  }).catch((err) => console.warn("Audit log not saved:", err.message));
}

// =========================================================
// VIEWS: switch between loading, login, denied and the main app
// =========================================================

/** Shows only one of the top-level screens. */
function showView(name) {
  ["loading-view", "login-view", "denied-view", "app-view"].forEach((id) => {
    $(id).classList.toggle("hidden", id !== name + "-view");
  });
}

/** Opens a page inside the app (Add, Entries, Reports, Heads, Users). */
function showPage(page) {
  // Staff can only open Reports
  if (!isAdmin() && page !== "reports") page = "reports";
  state.currentPage = page;
  document.querySelectorAll(".page").forEach((p) => p.classList.toggle("hidden", p.id !== "page-" + page));
  document.querySelectorAll("#tabs button").forEach((b) => b.classList.toggle("active", b.dataset.page === page));
  if (page === "reports") renderReports();
}

/** Shows or hides Admin-only elements based on the user's role. */
function applyRole() {
  document.querySelectorAll(".admin-only").forEach((el) => el.classList.toggle("hidden", !isAdmin()));
  const roleText = isAdmin() ? "Admin" : "Staff";
  $("user-label").textContent = `${state.profile.name || state.user.email} (${roleText})`;
}

// =========================================================
// LOGIN / LOGOUT
// =========================================================

/** Turns Firebase login error codes into simple messages. */
function loginErrorMessage(code) {
  switch (code) {
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
    case "auth/invalid-email":
      return "Wrong email or password.";
    case "auth/user-disabled":
      return "This account has been disabled.";
    case "auth/too-many-requests":
      return "Too many attempts. Please wait a few minutes and try again.";
    case "auth/network-request-failed":
      return "No internet connection. Please check your connection.";
    default:
      return "Sign in failed (" + code + ").";
  }
}

/** Handles the login form. */
$("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = $("login-email").value.trim();
  const password = $("login-password").value;
  if (!email || !password) {
    showFormError("login-error", "Please enter email and password.");
    return;
  }
  showFormError("login-error", "");
  $("login-btn").disabled = true;
  try {
    await signInWithEmailAndPassword(auth, email, password);
    $("login-password").value = "";
  } catch (err) {
    showFormError("login-error", loginErrorMessage(err.code));
  } finally {
    $("login-btn").disabled = false;
  }
});

/** "Forgot password?" sends a reset email to the typed address. */
$("forgot-btn").addEventListener("click", async () => {
  const email = $("login-email").value.trim();
  if (!email) {
    showFormError("login-error", "Type your email above first, then click 'Forgot password?'.");
    return;
  }
  try {
    await sendPasswordResetEmail(auth, email);
    showFormError("login-error", "");
    alert("If this email has an account, a password reset link has been sent to " + email + ".");
  } catch (err) {
    showFormError("login-error", loginErrorMessage(err.code));
  }
});

/** "Change password" in the header sends a reset email to the logged-in user. */
$("change-pass-btn").addEventListener("click", async () => {
  if (!confirm("Send a password change link to " + state.user.email + "?")) return;
  try {
    await sendPasswordResetEmail(auth, state.user.email);
    showToast("Password change link sent to " + state.user.email);
  } catch (err) {
    showToast("Could not send email: " + err.message, true);
  }
});

/** All Logout buttons. */
document.querySelectorAll('[data-action="logout"]').forEach((btn) =>
  btn.addEventListener("click", () => signOut(auth))
);

/** Stops all live Firestore listeners (on logout or role change). */
function stopListeners() {
  state.listeners.forEach((unsub) => unsub());
  state.listeners = [];
}

/**
 * Runs whenever the login state changes.
 * After login we watch the user's own "users" document: it decides
 * if they may use the app and which role they have.
 */
let profileUnsub = null;
onAuthStateChanged(auth, (user) => {
  if (profileUnsub) { profileUnsub(); profileUnsub = null; }
  stopListeners();
  state.user = user;
  state.profile = null;

  if (!user) {
    showView("login");
    return;
  }

  showView("loading");
  profileUnsub = onSnapshot(
    doc(db, "users", user.uid),
    (snap) => {
      const profile = snap.exists() ? snap.data() : null;
      if (!profile || profile.status !== "active" || !["admin", "staff"].includes(profile.role)) {
        denyAccess(profile && profile.status === "disabled"
          ? "Your account has been disabled. Please contact the Admin."
          : "Your account does not have access to this app. Please contact the Admin.");
        return;
      }
      const roleChanged = !state.profile || state.profile.role !== profile.role;
      state.profile = profile;
      if (roleChanged) startApp();
      else applyRole();
    },
    // Rules block reading for users without an active record
    () => denyAccess("Your account does not have access to this app. Please contact the Admin.")
  );
});

/** Shows the "Access denied" screen and clears any loaded data. */
function denyAccess(message) {
  stopListeners();
  state.profile = null;
  state.expenses = [];
  state.heads = [];
  state.users = [];
  $("denied-msg").textContent = message;
  showView("denied");
}

/** Starts the main app after a successful role check: loads data and opens the first page. */
function startApp() {
  stopListeners();
  applyRole();
  showView("app");
  setupStaticSelects();
  resetExpenseForm();
  $("rpt-month").value = $("rpt-month").value || currentMonthString();

  listenToHeads();
  listenToExpenses();
  if (isAdmin()) listenToUsers();

  showPage(isAdmin() ? (state.currentPage || "add") : "reports");
}

// =========================================================
// LIVE DATA (Firestore listeners)
// =========================================================

/** Watches the "heads" collection. Seeds the 12 default heads the first time (Admin only). */
function listenToHeads() {
  let seedChecked = false;
  const unsub = onSnapshot(collection(db, "heads"), { includeMetadataChanges: true }, (snap) => {
    // Only seed when we are sure the server really has no heads (not just an empty offline cache)
    if (!seedChecked && !snap.metadata.fromCache) {
      seedChecked = true;
      if (snap.empty && isAdmin()) seedDefaultHeads();
    }
    if (snap.metadata.hasPendingWrites && snap.docChanges().length === 0) return;
    state.heads = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderHeadOptions();
    renderList();
    renderHeads();
    renderReports();
  }, (err) => console.error("Heads listener:", err));
  state.listeners.push(unsub);
}

/** Creates the default heads with fixed IDs, so two devices can never create duplicates. */
function seedDefaultHeads() {
  const batch = writeBatch(db);
  CONFIG.defaultHeads.forEach((h, i) => {
    const id = "default-" + String(i + 1).padStart(2, "0");
    batch.set(doc(db, "heads", id), {
      name: h.name,
      type: h.type,
      active: true,
      isDefault: true,
      createdBy: state.user.uid,
      createdAt: serverTimestamp()
    });
  });
  batch.commit().catch(onWriteError);
}

/** Watches all entries, newest first. Every screen updates live when data changes on any device. */
function listenToExpenses() {
  const q = query(collection(db, "expenses"), orderBy("date", "desc"));
  const unsub = onSnapshot(q, (snap) => {
    state.expenses = snap.docs.map((d) => {
      const data = d.data({ serverTimestamps: "estimate" });
      return { id: d.id, ...data, createdMs: data.createdAt ? data.createdAt.toMillis() : 0 };
    });
    // Same date: newest created first
    state.expenses.sort((a, b) => (a.date === b.date ? b.createdMs - a.createdMs : (a.date < b.date ? 1 : -1)));
    renderList();
    renderHeads();
    renderReports();
  }, (err) => console.error("Expenses listener:", err));
  state.listeners.push(unsub);
}

/** Watches the "users" collection (Admin only). */
function listenToUsers() {
  const unsub = onSnapshot(collection(db, "users"), (snap) => {
    state.users = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderUsers();
  }, (err) => console.error("Users listener:", err));
  state.listeners.push(unsub);
}

// =========================================================
// ADD / EDIT ENTRY
// =========================================================

/** Fills the dropdowns that never change (farms, Paid By, filter farms). */
function setupStaticSelects() {
  fillSelect($("f-farm"), [{ value: "", label: "Select farm" }, ...CONFIG.farms.map((f) => ({ value: f, label: f }))]);
  fillSelect($("f-paidby"), CONFIG.paidByOptions.map((p) => ({ value: p, label: p })), CONFIG.defaultPaidBy);
  const keepFarm = $("flt-farm").value;
  fillSelect($("flt-farm"), [{ value: "", label: "All farms" }, ...CONFIG.farms.map((f) => ({ value: f, label: f }))], keepFarm);
  fillSelect($("rpt-farm"), CONFIG.farms.map((f) => ({ value: f, label: f })), $("rpt-farm").value || CONFIG.farms[0]);
}

/**
 * Fills the Head dropdown (active heads, grouped by Inflow / Outflow)
 * and the Head filter on the Entries page (all heads).
 */
function renderHeadOptions() {
  const select = $("f-head");
  const selected = select.value;
  // While editing, keep the entry's head in the list even if it is now inactive
  const editing = state.editingExpenseId ? state.expenses.find((x) => x.id === state.editingExpenseId) : null;
  const usable = state.heads.filter((h) => h.active || (editing && h.id === editing.headId));

  let html = `<option value="">Select head</option>`;
  ["Inflow", "Outflow"].forEach((type) => {
    const group = sortedHeads(usable.filter((h) => h.type === type));
    if (group.length) {
      html += `<optgroup label="${type}">` +
        group.map((h) => `<option value="${escapeHtml(h.id)}">${escapeHtml(h.name)}${h.active ? "" : " (inactive)"}</option>`).join("") +
        `</optgroup>`;
    }
  });
  select.innerHTML = html;
  if (usable.some((h) => h.id === selected)) select.value = selected;

  const filter = $("flt-head");
  const keep = filter.value;
  fillSelect(filter, [{ value: "", label: "All heads" }, ...sortedHeads(state.heads).map((h) => ({ value: h.id, label: h.name }))]);
  if (state.heads.some((h) => h.id === keep)) filter.value = keep;
}

/** Clears the entry form. Date and Farm are kept for quick repeat entry, unless reset fully. */
function resetExpenseForm(keepDateAndFarm = false) {
  const date = $("f-date").value;
  const farm = $("f-farm").value;
  $("expense-form").reset();
  $("f-date").value = keepDateAndFarm && date ? date : todayString();
  $("f-farm").value = keepDateAndFarm ? farm : "";
  $("f-paidby").value = CONFIG.defaultPaidBy;
  state.editingExpenseId = null;
  $("expense-form-title").textContent = "Add Entry";
  $("expense-save-btn").textContent = "Save";
  $("expense-cancel-btn").classList.add("hidden");
  showFormError("expense-error", "");
  clearAttachment();
  renderHeadOptions();
}

/** Validates the entry form and returns the data, or shows an error and returns null. */
function readExpenseForm() {
  const date = $("f-date").value;
  const farm = $("f-farm").value;
  const headId = $("f-head").value;
  const amountText = $("f-amount").value.trim();
  const amount = Math.round(parseFloat(amountText));   // whole rupees only
  const paidBy = $("f-paidby").value;
  const note = $("f-note").value.trim();
  const head = state.heads.find((h) => h.id === headId);

  if (!date) return showFormError("expense-error", "Please select a date."), null;
  if (!CONFIG.farms.includes(farm)) return showFormError("expense-error", "Please select a farm."), null;
  if (!head) return showFormError("expense-error", "Please select a head."), null;
  if (!amountText || !isFinite(amount) || amount < 1) return showFormError("expense-error", "Amount must be at least 1 rupee."), null;
  if (!CONFIG.paidByOptions.includes(paidBy)) return showFormError("expense-error", "Please select Paid By."), null;
  if (note.length > 200) return showFormError("expense-error", "Note can be at most 200 characters."), null;

  showFormError("expense-error", "");
  return { date, farm, headId: head.id, headName: head.name, type: head.type, amount, paidBy, note };
}

/** Saves a new entry or updates the one being edited. */
$("expense-form").addEventListener("submit", (e) => {
  e.preventDefault();
  if (!isAdmin()) return;
  const data = readExpenseForm();
  if (!data) return;

  // The entry and its attachment are written in one batch (both succeed or both fail).
  // Not awaited: the batch is saved locally right away and syncs to the server in the background.
  const batch = writeBatch(db);
  const file = state.attachment;

  if (state.editingExpenseId) {
    const id = state.editingExpenseId;
    const changes = { ...data, updatedAt: serverTimestamp() };
    if (file) {
      batch.set(doc(db, "attachments", id), attachmentDoc(id, file));
      Object.assign(changes, { hasAttachment: true, attachmentName: file.name, attachmentType: file.type });
    } else if (state.attachmentRemoved) {
      batch.delete(doc(db, "attachments", id));
      Object.assign(changes, { hasAttachment: false, attachmentName: "", attachmentType: "" });
    }
    batch.update(doc(db, "expenses", id), changes);
    batch.commit().catch(onWriteError);
    showToast("Entry updated");
    resetExpenseForm();
    showPage("list");
  } else {
    const ref = doc(collection(db, "expenses"));
    batch.set(ref, {
      ...data,
      hasAttachment: !!file,
      attachmentName: file ? file.name : "",
      attachmentType: file ? file.type : "",
      createdBy: state.user.uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    if (file) batch.set(doc(db, "attachments", ref.id), attachmentDoc(ref.id, file));
    batch.commit().catch(onWriteError);
    showToast(navigator.onLine ? "Saved" : "Saved offline - will sync when online");
    resetExpenseForm(true);
    $("f-head").focus();
  }
});

$("expense-cancel-btn").addEventListener("click", () => {
  resetExpenseForm();
  showPage("list");
});

/** Opens an entry in the form for editing. */
function editExpense(id) {
  const x = state.expenses.find((e) => e.id === id);
  if (!x) return;
  state.editingExpenseId = id;
  renderHeadOptions();
  $("f-date").value = x.date;
  $("f-farm").value = x.farm;
  $("f-head").value = x.headId;
  $("f-amount").value = x.amount;
  $("f-paidby").value = x.paidBy;
  $("f-note").value = x.note || "";
  $("expense-form-title").textContent = "Edit Entry";
  $("expense-save-btn").textContent = "Update";
  $("expense-cancel-btn").classList.remove("hidden");
  showFormError("expense-error", "");
  clearAttachment();
  if (x.hasAttachment) showExistingAttachment(x);
  showPage("add");
  window.scrollTo(0, 0);
}

/** Deletes an entry after confirmation. */
function deleteExpense(id) {
  const x = state.expenses.find((e) => e.id === id);
  if (!x) return;
  if (!confirm(`Delete this entry?\n\n${x.date} - ${x.farm}\n${x.headName}: ${formatMoney(x.amount)}`)) return;
  const batch = writeBatch(db);
  batch.delete(doc(db, "expenses", id));
  if (x.hasAttachment) batch.delete(doc(db, "attachments", id));
  batch.commit().catch(onWriteError);
  showToast("Entry deleted");
}

// =========================================================
// ATTACHMENTS (payment slip / online receipt / bill)
// Firebase Storage needs the paid plan, so files are kept in
// Firestore instead: one document per entry in "attachments",
// with the same id as the entry. Photos are shrunk to fit the
// 1 MB Firestore document limit; PDFs must already be small.
// =========================================================

const ATTACH_MAX_CHARS = 900000;   // max length of the stored file text (about 650 KB of file)
const ATTACH_MAX_SIDE = 1600;      // photos are resized so the longest side is at most this many pixels

/** Turns a byte count into "245 KB" / "1.2 MB". */
function formatSize(bytes) {
  return bytes >= 1048576 ? (bytes / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(bytes / 1024)) + " KB";
}

/** Approximate file size of a base64 data URL. */
const dataUrlBytes = (dataUrl) => Math.round((dataUrl.length - dataUrl.indexOf(",") - 1) * 0.75);

/** Reads a file as a data URL ("data:application/pdf;base64,..."). */
function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

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

/** Shrinks a photo to a JPEG that fits in Firestore, keeping the text on the slip readable. */
async function compressImage(file) {
  const img = await loadImage(file);
  let side = ATTACH_MAX_SIDE;
  let quality = 0.82;
  for (let attempt = 0; attempt < 8; attempt++) {
    const scale = Math.min(1, side / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";   // transparent screenshots get a white background
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/jpeg", quality);
    if (dataUrl.length <= ATTACH_MAX_CHARS) return dataUrl;
    // Still too big: lower the quality first, then the size
    if (quality > 0.55) quality -= 0.12; else side = Math.round(side * 0.8);
  }
  throw new Error("This photo is too large. Please take a closer photo of the slip.");
}

/** Builds the Firestore document for an attachment. */
function attachmentDoc(expenseId, file) {
  return {
    expenseId,
    data: file.data,
    name: file.name,
    type: file.type,
    size: file.size,
    createdBy: state.user.uid,
    createdAt: serverTimestamp()
  };
}

/** Shows the chosen (or already saved) file in the entry form. */
function renderAttachmentPreview({ name, sizeText, thumb, isPdf, canView }) {
  $("attach-pick-btn").classList.add("hidden");
  $("attach-preview").classList.remove("hidden");
  $("attach-name").textContent = name;
  $("attach-size").textContent = sizeText;
  $("attach-thumb").classList.toggle("hidden", !thumb);
  if (thumb) $("attach-thumb").src = thumb;
  $("attach-pdf-icon").textContent = isPdf ? "PDF" : "IMG";
  $("attach-pdf-icon").classList.toggle("hidden", !!thumb);
  $("attach-view-btn").classList.toggle("hidden", !canView);
}

/** Empties the attachment part of the entry form. */
function clearAttachment() {
  state.attachment = null;
  state.attachmentRemoved = false;
  $("f-attach").value = "";
  $("attach-thumb").removeAttribute("src");
  $("attach-preview").classList.add("hidden");
  $("attach-pick-btn").classList.remove("hidden");
}

/** While editing: shows that the entry already has an attachment. */
function showExistingAttachment(entry) {
  renderAttachmentPreview({
    name: entry.attachmentName || "Attachment",
    sizeText: "Already attached",
    thumb: null,
    isPdf: entry.attachmentType === "application/pdf",
    canView: true
  });
}

$("attach-pick-btn").addEventListener("click", () => $("f-attach").click());

$("f-attach").addEventListener("change", async () => {
  const file = $("f-attach").files[0];
  if (!file) return;
  const isPdf = file.type === "application/pdf";
  const isImage = file.type.startsWith("image/");
  if (!isPdf && !isImage) {
    showToast("Please choose a photo or a PDF file.", true);
    $("f-attach").value = "";
    return;
  }

  const pickLabel = $("attach-pick-btn").querySelector("span");
  $("attach-pick-btn").disabled = true;
  pickLabel.textContent = "Preparing…";
  $("expense-save-btn").disabled = true;
  try {
    const data = isPdf ? await readAsDataUrl(file) : await compressImage(file);
    if (data.length > ATTACH_MAX_CHARS) {
      throw new Error(`This PDF is ${formatSize(file.size)}. The limit is about 650 KB. Please attach a photo or screenshot instead.`);
    }
    const name = isPdf ? file.name : file.name.replace(/\.[^.]+$/, "") + ".jpg";
    state.attachment = { data, name, type: isPdf ? "application/pdf" : "image/jpeg", size: dataUrlBytes(data) };
    renderAttachmentPreview({
      name,
      sizeText: formatSize(state.attachment.size) + (isImage && file.size > state.attachment.size ? " (compressed)" : ""),
      thumb: isPdf ? null : data,
      isPdf,
      canView: false
    });
  } catch (err) {
    console.error(err);
    showToast(err.message || "Could not read this file.", true);
    $("f-attach").value = "";
  } finally {
    $("attach-pick-btn").disabled = false;
    pickLabel.textContent = "Add photo or PDF";
    $("expense-save-btn").disabled = false;
  }
});

$("attach-remove-btn").addEventListener("click", () => {
  // While editing, the saved attachment is deleted only when the entry is updated
  const entry = state.editingExpenseId && state.expenses.find((e) => e.id === state.editingExpenseId);
  clearAttachment();
  state.attachmentRemoved = !!(entry && entry.hasAttachment);
});

$("attach-view-btn").addEventListener("click", () => {
  if (state.editingExpenseId) viewAttachment(state.editingExpenseId);
});

let viewerUrl = null;

/** Downloads the attachment of an entry and shows it in the viewer. */
async function viewAttachment(expenseId) {
  const entry = state.expenses.find((e) => e.id === expenseId);
  showToast("Opening attachment…");
  let file;
  try {
    const snap = await getDoc(doc(db, "attachments", expenseId));
    if (!snap.exists()) { showToast("Attachment not found.", true); return; }
    file = snap.data();
  } catch (err) {
    console.error(err);
    showToast(navigator.onLine ? "Could not open the attachment." : "This attachment is not available offline.", true);
    return;
  }

  if (viewerUrl) URL.revokeObjectURL(viewerUrl);
  viewerUrl = URL.createObjectURL(await (await fetch(file.data)).blob());
  $("viewer-title").textContent = entry ? `${entry.date} · ${headNameOf(entry)} · ${formatMoney(entry.amount)}` : file.name;
  $("viewer-download").href = viewerUrl;
  $("viewer-download").download = file.name || "attachment";

  if (file.type === "application/pdf") {
    $("viewer-body").innerHTML = `
      <div class="viewer-pdf">
        <div class="attach-pdf-icon big">PDF</div>
        <p><b>${escapeHtml(file.name)}</b><br><span class="muted small">${formatSize(file.size || 0)}</span></p>
        <a class="btn btn-light" href="${viewerUrl}" target="_blank" rel="noopener">Open PDF</a>
      </div>`;
  } else {
    $("viewer-body").innerHTML = `<img src="${viewerUrl}" alt="Attachment">`;
  }
  $("toast").classList.add("hidden");
  $("viewer").classList.remove("hidden");
}

function closeViewer() {
  $("viewer").classList.add("hidden");
  $("viewer-body").innerHTML = "";
}
$("viewer-close-btn").addEventListener("click", closeViewer);
$("viewer").addEventListener("click", (e) => { if (e.target.id === "viewer") closeViewer(); });
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !$("viewer").classList.contains("hidden")) closeViewer();
});

// =========================================================
// ENTRIES LIST + FILTERS
// =========================================================

/** Returns the head's current name (falls back to the name saved in the entry). */
function headNameOf(entry) {
  const head = state.heads.find((h) => h.id === entry.headId);
  return head ? head.name : entry.headName;
}

/** Applies the filters on the Entries page and returns matching entries. */
function getFilteredExpenses() {
  const farm = $("flt-farm").value;
  const headId = $("flt-head").value;
  const type = $("flt-type").value;
  const from = $("flt-from").value;
  const to = $("flt-to").value;
  const search = $("flt-search").value.trim().toLowerCase();

  return state.expenses.filter((x) =>
    (!farm || x.farm === farm) &&
    (!headId || x.headId === headId) &&
    (!type || x.type === type) &&
    (!from || x.date >= from) &&
    (!to || x.date <= to) &&
    (!search || (x.note || "").toLowerCase().includes(search))
  );
}

/** Draws the Entries table. */
function renderList() {
  if (!isAdmin()) return;
  const rows = getFilteredExpenses();
  let inflow = 0, outflow = 0;
  rows.forEach((x) => { if (x.type === "Inflow") inflow = addMoney(inflow, x.amount); else outflow = addMoney(outflow, x.amount); });

  $("list-summary").textContent =
    `${rows.length} entr${rows.length === 1 ? "y" : "ies"} | Inflow ${formatMoney(inflow)} | Outflow ${formatMoney(outflow)}`;
  $("list-empty").classList.toggle("hidden", rows.length > 0);

  $("list-body").innerHTML = rows.map((x) => `
    <tr>
      <td data-label="Date">${escapeHtml(x.date)}</td>
      <td data-label="Farm">${escapeHtml(x.farm)}</td>
      <td data-label="Head">${escapeHtml(headNameOf(x))}</td>
      <td data-label="Type" class="type-${x.type === "Inflow" ? "inflow" : "outflow"}">${escapeHtml(x.type)}</td>
      <td data-label="Amount" class="num">${formatMoney(x.amount)}</td>
      <td data-label="Paid By">${escapeHtml(x.paidBy)}</td>
      <td data-label="Note">${escapeHtml(x.note)}</td>
      <td class="actions">
        ${x.hasAttachment ? `<button class="btn btn-light btn-small" data-view="${x.id}" title="View attachment">📎 Slip</button>` : ""}
        <button class="btn btn-light btn-small" data-edit="${x.id}">Edit</button>
        <button class="btn btn-danger btn-small" data-delete="${x.id}">Delete</button>
      </td>
    </tr>`).join("");
}

// Re-draw the list whenever a filter changes
["flt-farm", "flt-head", "flt-type", "flt-from", "flt-to", "flt-search"].forEach((id) =>
  $(id).addEventListener("input", renderList)
);
$("flt-clear").addEventListener("click", () => {
  ["flt-farm", "flt-head", "flt-type", "flt-from", "flt-to", "flt-search"].forEach((id) => { $(id).value = ""; });
  renderList();
});

// Edit / Delete buttons in the table (one listener for all rows)
$("list-body").addEventListener("click", (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;
  if (btn.dataset.view) viewAttachment(btn.dataset.view);
  if (btn.dataset.edit) editExpense(btn.dataset.edit);
  if (btn.dataset.delete) deleteExpense(btn.dataset.delete);
});

// =========================================================
// CSV EXPORT (opens correctly in Excel)
// =========================================================

/** Prepares one CSV cell: quotes text with commas/quotes/line breaks and doubles inner quotes. */
function csvCell(value) {
  if (typeof value === "number") return String(value);
  let text = String(value ?? "");
  // Stop Excel from treating text like "=SUM(...)" as a formula
  if (/^[=+@]/.test(text)) text = "'" + text;
  return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}

/** Downloads rows (array of arrays) as a UTF-8 CSV file with BOM, so Urdu text shows correctly in Excel. */
function downloadCsv(filename, rows) {
  const content = "﻿" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Exports the filtered Entries list. */
$("export-list-btn").addEventListener("click", () => {
  const rows = getFilteredExpenses();
  if (!rows.length) { showToast("Nothing to export", true); return; }
  const from = $("flt-from").value;
  const to = $("flt-to").value;
  let name = "farm-expenses-" + currentMonthString();
  if (from || to) name = `farm-expenses-${from || "start"}_to_${to || "today"}`;

  downloadCsv(name + ".csv", [
    ["Date", "Farm", "Head", "Type", "Amount (PKR)", "Paid By", "Note", "Attachment"],
    ...rows.map((x) => [x.date, x.farm, headNameOf(x), x.type, Number(x.amount), x.paidBy, x.note || "", x.hasAttachment ? "Yes" : "No"])
  ]);
});

/** Exports the report on screen: all farms together, or one farm with its transactions. */
$("export-report-btn").addEventListener("click", () => {
  const month = $("rpt-month").value || currentMonthString();
  if (state.reportView === "farm") { exportFarmReport(month, $("rpt-farm").value); return; }
  const report = buildReport(month);
  const farms = CONFIG.farms;
  const rows = [["Head", "Type", ...farms.map((f) => f + " (PKR)"), "Total (PKR)"]];

  ["Inflow", "Outflow"].forEach((type) => {
    report.rows.filter((r) => r.type === type).forEach((r) =>
      rows.push([r.name, type, ...farms.map((f) => r.byFarm[f]), r.total])
    );
    const t = report.totals[type];
    rows.push(["Total " + type, type, ...farms.map((f) => t.byFarm[f]), t.total]);
  });
  rows.push(["Net (Inflow - Outflow)", "", ...farms.map((f) => report.net.byFarm[f]), report.net.total]);

  downloadCsv(`farm-report-${month}.csv`, rows);
});

/** Exports one farm's month: head-wise totals, then every transaction. */
function exportFarmReport(month, farm) {
  const r = buildFarmReport(month, farm);
  const rows = [[farm + " - " + month], [], ["Head", "Type", "Amount (PKR)"]];
  ["Inflow", "Outflow"].forEach((type) => {
    r.heads.filter((h) => h.type === type).forEach((h) => rows.push([h.name, type, h.total]));
    rows.push(["Total " + type, type, r.totals[type]]);
  });
  rows.push(["Net (Inflow - Outflow)", "", r.net], [], ["Transactions"]);
  rows.push(["Date", "Head", "Type", "Amount (PKR)", "Paid By", "Note", "Attachment"]);
  r.entries.forEach((x) =>
    rows.push([x.date, headNameOf(x), x.type, Number(x.amount), x.paidBy, x.note || "", x.hasAttachment ? "Yes" : "No"])
  );
  const fileFarm = farm.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  downloadCsv(`${fileFarm}-report-${month}.csv`, rows);
}

// =========================================================
// REPORTS / DASHBOARD
// =========================================================

/** Makes an object like { "Fatehpur Farm": 0, ... } */
const zeroByFarm = () => Object.fromEntries(CONFIG.farms.map((f) => [f, 0]));

/**
 * Calculates the monthly report.
 * Rows = heads (active heads always, inactive heads only if they have entries).
 * Returns rows plus Inflow / Outflow subtotals and Net, per farm and total.
 */
function buildReport(month) {
  const entries = state.expenses.filter((x) => x.date && x.date.startsWith(month));
  const rowMap = new Map();

  // Start with every active head so the table always shows the full list
  state.heads.filter((h) => h.active).forEach((h) => {
    rowMap.set(h.id, { id: h.id, name: h.name, type: h.type, active: true, byFarm: zeroByFarm(), total: 0 });
  });

  const totals = {
    Inflow:  { byFarm: zeroByFarm(), total: 0 },
    Outflow: { byFarm: zeroByFarm(), total: 0 }
  };

  entries.forEach((x) => {
    const head = state.heads.find((h) => h.id === x.headId);
    const type = head ? head.type : x.type;
    if (!rowMap.has(x.headId)) {
      rowMap.set(x.headId, {
        id: x.headId, name: head ? head.name : x.headName, type,
        active: head ? head.active : false, byFarm: zeroByFarm(), total: 0
      });
    }
    const row = rowMap.get(x.headId);
    if (!(x.farm in row.byFarm)) return; // ignore unknown farm names
    row.byFarm[x.farm] = addMoney(row.byFarm[x.farm], x.amount);
    row.total = addMoney(row.total, x.amount);
    const t = totals[type === "Inflow" ? "Inflow" : "Outflow"];
    t.byFarm[x.farm] = addMoney(t.byFarm[x.farm], x.amount);
    t.total = addMoney(t.total, x.amount);
  });

  const net = { byFarm: zeroByFarm(), total: addMoney(totals.Inflow.total, -totals.Outflow.total) };
  CONFIG.farms.forEach((f) => { net.byFarm[f] = addMoney(totals.Inflow.byFarm[f], -totals.Outflow.byFarm[f]); });

  return { rows: sortedHeads([...rowMap.values()]), totals, net, count: entries.length };
}

/** "2026-10" -> "October 2026" */
const monthLabelOf = (month) => new Date(month + "-01T00:00:00").toLocaleString("en-US", { month: "long", year: "numeric" });

/** One summary card: Total Inflow, Total Outflow and Net. */
function summaryCard(title, inflow, outflow, net, extraClass = "", footer = "") {
  return `
    <div class="card summary-card ${extraClass}">
      <h3>${escapeHtml(title)}</h3>
      <div class="summary-line"><span>Total Inflow</span><b class="type-inflow">${formatMoney(inflow)}</b></div>
      <div class="summary-line"><span>Total Outflow</span><b class="type-outflow">${formatMoney(outflow)}</b></div>
      <div class="summary-line net"><span>Net</span><b class="${net < 0 ? "type-outflow" : "type-inflow"}">${formatMoney(net)}</b></div>
      ${footer}
    </div>`;
}

/**
 * Calculates one farm's month: totals, head-wise totals (only heads used)
 * and the list of transactions, oldest first.
 */
function buildFarmReport(month, farm) {
  const entries = state.expenses
    .filter((x) => x.farm === farm && x.date && x.date.startsWith(month))
    .sort((a, b) => a.date.localeCompare(b.date) || a.createdMs - b.createdMs);

  const totals = { Inflow: 0, Outflow: 0 };
  const headMap = new Map();
  entries.forEach((x) => {
    const head = state.heads.find((h) => h.id === x.headId);
    const type = (head ? head.type : x.type) === "Inflow" ? "Inflow" : "Outflow";
    if (!headMap.has(x.headId)) headMap.set(x.headId, { name: headNameOf(x), type, total: 0, count: 0 });
    const row = headMap.get(x.headId);
    row.total = addMoney(row.total, x.amount);
    row.count++;
    totals[type] = addMoney(totals[type], x.amount);
  });

  const heads = [...headMap.values()].sort((a, b) => b.total - a.total);
  return { entries, heads, totals, net: addMoney(totals.Inflow, -totals.Outflow) };
}

/** Draws the Farm-wise view: farm summary, head-wise totals and all transactions. */
function renderFarmReport(month, farm) {
  const r = buildFarmReport(month, farm);
  const monthLabel = monthLabelOf(month);
  $("report-title").textContent = `${farm} - ${monthLabel}`;

  const slips = r.entries.filter((x) => x.hasAttachment).length;
  $("farm-summary").innerHTML =
    summaryCard(`${farm} - ${monthLabel}`, r.totals.Inflow, r.totals.Outflow, r.net, "overall") +
    `<div class="card summary-card stat-card">
      <h3>This month</h3>
      <div class="summary-line"><span>Transactions</span><b>${r.entries.length}</b></div>
      <div class="summary-line"><span>Inflow entries</span><b>${r.entries.filter((x) => x.type === "Inflow").length}</b></div>
      <div class="summary-line"><span>Outflow entries</span><b>${r.entries.filter((x) => x.type !== "Inflow").length}</b></div>
      <div class="summary-line net"><span>With slip 📎</span><b>${slips}</b></div>
    </div>`;

  // Head-wise totals (only heads that have entries this month)
  let html = `<thead><tr><th>Head</th><th class="num">Entries</th><th class="num">Amount</th></tr></thead><tbody>`;
  ["Inflow", "Outflow"].forEach((type) => {
    html += `<tr class="group-row"><td colspan="3">${type}</td></tr>`;
    const rows = r.heads.filter((h) => h.type === type);
    if (!rows.length) html += `<tr><td class="muted" colspan="3">No ${type.toLowerCase()} this month</td></tr>`;
    rows.forEach((h) => {
      html += `<tr><td>${escapeHtml(h.name)}</td><td class="num">${h.count}</td><td class="num">${formatNumber(h.total)}</td></tr>`;
    });
    html += `<tr class="subtotal-row"><td>Total ${type}</td><td></td><td class="num">${formatNumber(r.totals[type])}</td></tr>`;
  });
  html += `<tr class="net-row"><td>Net (Inflow - Outflow)</td><td></td><td class="num">${formatNumber(r.net)}</td></tr></tbody>`;
  $("farm-head-table").innerHTML = html;

  // All transactions of this farm in the month
  $("farm-tx-title").textContent = `Transactions (${r.entries.length})`;
  $("farm-tx-empty").classList.toggle("hidden", r.entries.length > 0);
  $("farm-tx-body").innerHTML = r.entries.map((x) => `
    <tr>
      <td data-label="Date">${escapeHtml(x.date)}</td>
      <td data-label="Head">${escapeHtml(headNameOf(x))}</td>
      <td data-label="Type" class="type-${x.type === "Inflow" ? "inflow" : "outflow"}">${escapeHtml(x.type)}</td>
      <td data-label="Amount" class="num">${formatMoney(x.amount)}</td>
      <td data-label="Paid By">${escapeHtml(x.paidBy)}</td>
      <td data-label="Note">${escapeHtml(x.note)}</td>
      <td class="actions no-print">${x.hasAttachment ? `<button class="btn btn-light btn-small" data-view="${x.id}">📎 Slip</button>` : `<span class="muted">-</span>`}</td>
    </tr>`).join("");
}

// Report type tabs (Total Report / Farm-wise)
$("rpt-view").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-view]");
  if (!btn || btn.dataset.view === state.reportView) return;
  state.reportView = btn.dataset.view;
  renderReports();
});
$("rpt-farm").addEventListener("input", renderReports);
$("farm-tx-body").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-view]");
  if (btn) viewAttachment(btn.dataset.view);
});

/** Draws the summary cards, the farm-wise table and the chart for the selected month. */
function renderReports() {
  if (state.currentPage !== "reports" || !state.profile) return;
  const month = $("rpt-month").value || currentMonthString();
  const report = buildReport(month);
  const farms = CONFIG.farms;
  const monthLabel = monthLabelOf(month);

  const farmView = state.reportView === "farm";
  $("report-total").classList.toggle("hidden", farmView);
  $("report-farm").classList.toggle("hidden", !farmView);
  $("rpt-farm-wrap").classList.toggle("hidden", !farmView);
  document.querySelectorAll("#rpt-view button").forEach((b) => b.classList.toggle("active", b.dataset.view === state.reportView));
  if (farmView) { renderFarmReport(month, $("rpt-farm").value || farms[0]); return; }

  $("report-title").textContent = "Farm Report - " + monthLabel;

  // ----- Summary cards: overall + each farm -----
  $("summary-cards").innerHTML =
    summaryCard("All Farms - " + monthLabel, report.totals.Inflow.total, report.totals.Outflow.total, report.net.total, "overall") +
    farms.map((f) => summaryCard(f, report.totals.Inflow.byFarm[f], report.totals.Outflow.byFarm[f], report.net.byFarm[f])).join("");

  // ----- Farm-wise table -----
  const cells = (byFarm, total) =>
    farms.map((f) => `<td class="num">${formatNumber(byFarm[f])}</td>`).join("") + `<td class="num">${formatNumber(total)}</td>`;

  let html = `<thead><tr><th>Head</th>${farms.map((f) => `<th class="num">${escapeHtml(f)}</th>`).join("")}<th class="num">Total</th></tr></thead><tbody>`;
  ["Inflow", "Outflow"].forEach((type) => {
    html += `<tr class="group-row"><td colspan="${farms.length + 2}">${type}</td></tr>`;
    report.rows.filter((r) => r.type === type).forEach((r) => {
      html += `<tr><td class="${r.active ? "" : "inactive"}">${escapeHtml(r.name)}${r.active ? "" : " (inactive)"}</td>${cells(r.byFarm, r.total)}</tr>`;
    });
    html += `<tr class="subtotal-row"><td>Total ${type}</td>${cells(report.totals[type].byFarm, report.totals[type].total)}</tr>`;
  });
  html += `<tr class="net-row"><td>Net (Inflow - Outflow)</td>${cells(report.net.byFarm, report.net.total)}</tr></tbody>`;
  $("report-table").innerHTML = html;

  renderChart(report);
}

/** Draws (or updates) the bar chart of Inflow and Outflow per farm. */
function renderChart(report) {
  if (!window.Chart) return; // Chart.js not loaded (e.g. offline on first visit)
  const data = {
    labels: CONFIG.farms,
    datasets: [
      { label: "Inflow", data: CONFIG.farms.map((f) => report.totals.Inflow.byFarm[f]), backgroundColor: "#6c5ce7", borderRadius: 8, maxBarThickness: 46 },
      { label: "Outflow", data: CONFIG.farms.map((f) => report.totals.Outflow.byFarm[f]), backgroundColor: "#7fb0ff", borderRadius: 8, maxBarThickness: 46 }
    ]
  };
  if (state.chart) {
    state.chart.data = data;
    state.chart.update();
    return;
  }
  state.chart = new window.Chart($("report-chart"), {
    type: "bar",
    data,
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { usePointStyle: true, pointStyle: "circle", color: "#55557a", font: { family: "Inter", weight: "600" } } },
        tooltip: {
          backgroundColor: "rgba(28, 28, 46, 0.9)", padding: 12, cornerRadius: 12,
          callbacks: { label: (ctx) => `${ctx.dataset.label}: ${formatMoney(ctx.parsed.y)}` }
        }
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: "#8a8aa3", font: { family: "Inter" } } },
        y: {
          beginAtZero: true, border: { display: false }, grid: { color: "#efedf8" },
          ticks: { color: "#8a8aa3", font: { family: "Inter" }, callback: (v) => Number(v).toLocaleString("en-US") }
        }
      }
    }
  });
}

$("rpt-month").addEventListener("input", renderReports);
$("print-report-btn").addEventListener("click", () => window.print());

// Chart.js loads with "defer"; draw the chart once it is ready
window.addEventListener("load", renderReports);

// =========================================================
// HEADS PAGE (Admin)
// =========================================================

/** Counts how many entries use each head. */
function headUsageCounts() {
  const counts = {};
  state.expenses.forEach((x) => { counts[x.headId] = (counts[x.headId] || 0) + 1; });
  return counts;
}

/** Draws the Heads table. */
function renderHeads() {
  if (!isAdmin()) return;
  const counts = headUsageCounts();
  $("heads-body").innerHTML = sortedHeads(state.heads).map((h) => {
    const used = counts[h.id] || 0;
    return `
    <tr>
      <td data-label="Head">${escapeHtml(h.name)}</td>
      <td data-label="Type" class="type-${h.type === "Inflow" ? "inflow" : "outflow"}">${escapeHtml(h.type)}</td>
      <td data-label="Status"><span class="badge ${h.active ? "" : "off"}">${h.active ? "Active" : "Inactive"}</span></td>
      <td data-label="Entries" class="num">${used}</td>
      <td class="actions">
        <button class="btn btn-light btn-small" data-head-edit="${h.id}">Edit</button>
        <button class="btn btn-light btn-small" data-head-toggle="${h.id}">${h.active ? "Deactivate" : "Activate"}</button>
        ${used === 0 ? `<button class="btn btn-danger btn-small" data-head-delete="${h.id}">Delete</button>` : ""}
      </td>
    </tr>`;
  }).join("");
}

/** Clears the Add/Edit Head form. */
function resetHeadForm() {
  $("head-form").reset();
  state.editingHeadId = null;
  $("head-form-title").textContent = "Add Head";
  $("head-save-btn").textContent = "Add Head";
  $("head-cancel-btn").classList.add("hidden");
  showFormError("head-error", "");
}

/** Saves a new head, or renames / changes the type of an existing one. */
$("head-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!isAdmin()) return;
  const name = $("h-name").value.trim().replace(/\s+/g, " ");
  const type = $("h-type").value;

  if (!name) return showFormError("head-error", "Please enter a head name.");
  if (name.length > 50) return showFormError("head-error", "Head name can be at most 50 characters.");
  if (!["Inflow", "Outflow"].includes(type)) return showFormError("head-error", "Please select a type.");
  const duplicate = state.heads.some((h) => h.id !== state.editingHeadId && normalizeName(h.name) === normalizeName(name));
  if (duplicate) return showFormError("head-error", "A head with this name already exists.");
  showFormError("head-error", "");

  if (!state.editingHeadId) {
    setDoc(doc(collection(db, "heads")), {
      name, type, active: true, isDefault: false, createdBy: state.user.uid, createdAt: serverTimestamp()
    }).catch(onWriteError);
    logAudit("head-add", `${name} (${type})`);
    showToast("Head added");
    resetHeadForm();
    return;
  }

  // Editing: update the head, then copy the new name/type into all its entries
  const id = state.editingHeadId;
  const old = state.heads.find((h) => h.id === id);
  if (old && old.name === name && old.type === type) { resetHeadForm(); return; }
  $("head-save-btn").disabled = true;
  try {
    const snap = await getDocs(query(collection(db, "expenses"), where("headId", "==", id)));
    const batches = [];
    let batch = writeBatch(db);
    let ops = 0;
    batch.update(doc(db, "heads", id), { name, type });
    ops++;
    snap.docs.forEach((d) => {
      if (ops === 450) { batches.push(batch); batch = writeBatch(db); ops = 0; } // Firestore limit is 500 per batch
      batch.update(d.ref, { headName: name, type });
      ops++;
    });
    batches.push(batch);
    batches.forEach((b) => b.commit().catch(onWriteError));
    logAudit("head-edit", `${old ? old.name + " (" + old.type + ")" : id} -> ${name} (${type}), ${snap.size} entries updated`);
    showToast(`Head updated (${snap.size} entries updated)`);
    resetHeadForm();
  } catch (err) {
    onWriteError(err);
  } finally {
    $("head-save-btn").disabled = false;
  }
});

$("head-cancel-btn").addEventListener("click", resetHeadForm);

// Edit / Activate / Delete buttons in the Heads table
$("heads-body").addEventListener("click", async (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;

  if (btn.dataset.headEdit) {
    const h = state.heads.find((x) => x.id === btn.dataset.headEdit);
    if (!h) return;
    state.editingHeadId = h.id;
    $("h-name").value = h.name;
    $("h-type").value = h.type;
    $("head-form-title").textContent = "Edit Head";
    $("head-save-btn").textContent = "Update Head";
    $("head-cancel-btn").classList.remove("hidden");
    showFormError("head-error", "");
    window.scrollTo(0, 0);
    $("h-name").focus();
  }

  if (btn.dataset.headToggle) {
    const h = state.heads.find((x) => x.id === btn.dataset.headToggle);
    if (!h) return;
    updateDoc(doc(db, "heads", h.id), { active: !h.active }).catch(onWriteError);
    logAudit(h.active ? "head-deactivate" : "head-activate", h.name);
    showToast(h.active ? "Head deactivated" : "Head activated");
  }

  if (btn.dataset.headDelete) {
    const h = state.heads.find((x) => x.id === btn.dataset.headDelete);
    if (!h) return;
    // Double-check on the server that no entry uses this head
    const used = await getDocs(query(collection(db, "expenses"), where("headId", "==", h.id), limit(1)));
    if (!used.empty) { showToast("This head has entries. Deactivate it instead.", true); return; }
    if (!confirm(`Delete head "${h.name}"? This cannot be undone.`)) return;
    deleteDoc(doc(db, "heads", h.id)).catch(onWriteError);
    logAudit("head-delete", h.name);
    showToast("Head deleted");
  }
});

// =========================================================
// USERS PAGE (Admin)
// =========================================================

/** Draws the Users table. The Admin's own row cannot be demoted or disabled. */
function renderUsers() {
  if (!isAdmin()) return;
  const users = [...state.users].sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  $("users-body").innerHTML = users.map((u) => {
    const isSelf = u.id === state.user.uid;
    const created = u.createdAt && u.createdAt.toDate ? toDateString(u.createdAt.toDate()) : "-";
    const active = u.status === "active";
    return `
    <tr>
      <td data-label="Name">${escapeHtml(u.name)}${isSelf ? " <span class='muted'>(you)</span>" : ""}</td>
      <td data-label="Email">${escapeHtml(u.email)}</td>
      <td data-label="Role">
        <select data-role-for="${u.id}" ${isSelf ? "disabled title='You cannot change your own role'" : ""}>
          <option value="admin" ${u.role === "admin" ? "selected" : ""}>Admin</option>
          <option value="staff" ${u.role === "staff" ? "selected" : ""}>Staff</option>
        </select>
      </td>
      <td data-label="Status"><span class="badge ${active ? "" : "off"}">${active ? "Active" : "Disabled"}</span></td>
      <td data-label="Created">${created}</td>
      <td class="actions">
        ${isSelf ? "" : `<button class="btn ${active ? "btn-danger" : "btn-light"} btn-small" data-status-for="${u.id}">${active ? "Disable" : "Enable"}</button>`}
      </td>
    </tr>`;
  }).join("");
}

/** Adds a user record. The document ID must be the user's Auth UID. */
$("user-form").addEventListener("submit", (e) => {
  e.preventDefault();
  if (!isAdmin()) return;
  const name = $("u-name").value.trim();
  const email = $("u-email").value.trim().toLowerCase();
  const uid = $("u-uid").value.trim();
  const role = $("u-role").value;

  if (!name) return showFormError("user-error", "Please enter a name.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return showFormError("user-error", "Please enter a valid email.");
  if (!/^[A-Za-z0-9]{20,128}$/.test(uid)) return showFormError("user-error", "Please paste the User UID exactly as shown in Firebase Console.");
  if (state.users.some((u) => u.id === uid)) return showFormError("user-error", "A user with this UID already exists.");
  if (state.users.some((u) => (u.email || "").toLowerCase() === email)) return showFormError("user-error", "A user with this email already exists.");
  showFormError("user-error", "");

  setDoc(doc(db, "users", uid), { name, email, role, status: "active", createdAt: serverTimestamp() }).catch(onWriteError);
  logAudit("user-add", `${name} <${email}> as ${role}`);
  showToast("User added");
  $("user-form").reset();
});

// Change role
$("users-body").addEventListener("change", (e) => {
  const uid = e.target.dataset.roleFor;
  if (!uid || uid === state.user.uid) return;
  const u = state.users.find((x) => x.id === uid);
  updateDoc(doc(db, "users", uid), { role: e.target.value }).catch(onWriteError);
  logAudit("user-role", `${u ? u.email : uid} -> ${e.target.value}`);
  showToast("Role updated");
});

// Enable / Disable
$("users-body").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-status-for]");
  if (!btn) return;
  const uid = btn.dataset.statusFor;
  if (uid === state.user.uid) return;
  const u = state.users.find((x) => x.id === uid);
  if (!u) return;
  const newStatus = u.status === "active" ? "disabled" : "active";
  if (newStatus === "disabled" && !confirm(`Disable ${u.name || u.email}? They will not be able to see any data.`)) return;
  updateDoc(doc(db, "users", uid), { status: newStatus }).catch(onWriteError);
  logAudit("user-status", `${u.email} -> ${newStatus}`);
  showToast(newStatus === "active" ? "User enabled" : "User disabled");
});

// =========================================================
// NAVIGATION, OFFLINE BANNER, PWA INSTALL
// =========================================================

$("tabs").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-page]");
  if (btn) showPage(btn.dataset.page);
});

/** Shows a yellow banner when the device is offline. */
function updateOnlineBanner() {
  $("offline-banner").classList.toggle("hidden", navigator.onLine);
}
window.addEventListener("online", updateOnlineBanner);
window.addEventListener("offline", updateOnlineBanner);
updateOnlineBanner();

/** "Install App" button: shown only when the browser allows installing. */
let installPrompt = null;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  installPrompt = e;
  $("install-btn").classList.remove("hidden");
});
$("install-btn").addEventListener("click", async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  await installPrompt.userChoice;
  installPrompt = null;
  $("install-btn").classList.add("hidden");
});
window.addEventListener("appinstalled", () => $("install-btn").classList.add("hidden"));

/** Registers the service worker (caches the app so it opens with weak internet). */
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js").catch((err) => console.warn("Service worker failed:", err));
  });
}
