// =========================================================
// Switching between top-level screens (loading, login, denied,
// app) and between pages inside the app (Add, Entries, Reports,
// Heads, Users). Pages register themselves, so this module does
// not need to know about them.
// =========================================================

import { isAdmin } from "../state.js";
import { $, setHidden } from "./dom.js";

const pages = new Map();     // page name -> { render() }
let currentPage = null;

/** Adds a page. page.render() is called when it is opened and when data changes. */
export function registerPage(name, page) {
  pages.set(name, page);
}

export const getCurrentPage = () => currentPage;

/** Shows only one of the top-level screens. */
export function showView(name) {
  ["loading-view", "login-view", "denied-view", "app-view"].forEach((id) => setHidden($(id), id !== name + "-view"));
}

/** Opens a page inside the app. Staff can only open Reports. */
export function showPage(name) {
  const page = isAdmin() || name === "reports" ? name : "reports";
  currentPage = page;
  document.querySelectorAll(".page").forEach((p) => setHidden(p, p.id !== "page-" + page));
  document.querySelectorAll("#tabs button").forEach((b) => b.classList.toggle("active", b.dataset.page === page));
  renderCurrentPage();
}

/** Redraws only the page on screen (hidden pages are drawn when opened). */
export function renderCurrentPage() {
  const page = pages.get(currentPage);
  if (page) page.render();
}

/** Redraws every page, e.g. to remove all data from the screen after access is removed. */
export function renderAllPages() {
  pages.forEach((page) => page.render());
}
