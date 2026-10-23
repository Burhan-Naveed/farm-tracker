// =========================================================
// Period filter shared by the Dashboard and Reports: a choice
// like "This month" fills the From / To dates; typing dates by
// hand switches the choice to "Custom dates".
// =========================================================

import { PERIODS, periodOf, periodRange } from "../domain/periods.js";
import { todayString } from "../lib/format.js";
import { orderedRange } from "../domain/reports.js";
import { optionsHtml } from "../lib/html.js";

/**
 * Connects a period control to two date inputs.
 * control: a <select>, or an element holding <button data-period="..."> buttons.
 * onChange() runs after every change. Returns { range(), period(), set(period) }.
 */
export function bindPeriodFilter({ control, fromInput, toInput, initial, onChange, onPeriodShown = () => {} }) {
  const isSelect = control.tagName === "SELECT";
  if (isSelect) control.innerHTML = optionsHtml(PERIODS);

  let current = initial;

  /** Shows the chosen period on the control. */
  function show(period) {
    current = period;
    if (isSelect) control.value = period;
    else control.querySelectorAll("button[data-period]").forEach((b) => {
      const active = b.dataset.period === period;
      b.classList.toggle("active", active);
      b.setAttribute("aria-pressed", String(active));
    });
    onPeriodShown(period);
  }

  /** Picks a period: fills the dates (custom keeps the typed dates). */
  function set(period) {
    if (period !== "custom") {
      const { from, to } = periodRange(period, todayString());
      fromInput.value = from;
      toInput.value = to;
    }
    show(period);
  }

  if (isSelect) {
    control.addEventListener("change", () => { set(control.value); onChange(); });
  } else {
    control.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-period]");
      if (!btn) return;
      set(btn.dataset.period);
      onChange();
    });
  }
  [fromInput, toInput].forEach((input) => input.addEventListener("input", () => {
    const typed = periodOf({ from: fromInput.value, to: toInput.value }, todayString());
    // Keep "Custom dates" selected while typing, even when the dates happen to match a period
    show(current === "custom" ? "custom" : typed);
    onChange();
  }));

  set(initial);
  return {
    /** The chosen dates, swapped if entered the wrong way round. Empty = open ended. */
    range: () => orderedRange(fromInput.value, toInput.value),
    period: () => current,
    set
  };
}
