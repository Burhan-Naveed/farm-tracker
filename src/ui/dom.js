// =========================================================
// Small DOM helpers shared by every screen.
// =========================================================

import { optionsHtml } from "../lib/html.js";

/** Finds an element by id. */
export const $ = (id) => document.getElementById(id);

/** Shows or hides an element. */
export const setHidden = (el, hidden) => el.classList.toggle("hidden", hidden);

/**
 * Fills a <select> with options ({ value, label }) and keeps the
 * current choice when it still exists (otherwise selects `fallback`).
 */
export function fillSelect(select, options, fallback) {
  const keep = select.value;
  select.innerHTML = optionsHtml(options);
  const values = options.map((o) => String(o.value));
  if (values.includes(keep)) select.value = keep;
  else if (fallback !== undefined) select.value = fallback;
}

/** Shows (or hides, when message is empty) an error box under a form. */
export function showFormError(elementId, message) {
  const el = $(elementId);
  el.textContent = message || "";
  setHidden(el, !message);
}

/** Reads the values of several inputs at once: { key: value }. */
export function readInputs(ids) {
  return Object.fromEntries(Object.entries(ids).map(([key, id]) => [key, $(id).value]));
}
