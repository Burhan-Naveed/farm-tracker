// =========================================================
// Charts (Chart.js from the CDN). One helper draws every chart
// in the app; each <canvas> keeps its own chart, which is
// updated in place when the data changes.
// Farm colours are fixed per farm (they never change with filters).
// =========================================================

import { CONFIG } from "../config.js";
import { formatMoney } from "../lib/format.js";
import { $ } from "./dom.js";

/** Colour-blind safe series colours (validated set); farm 1, 2, 3 always get the same one. */
const SERIES_COLORS = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#6250d6"];
const OTHER_COLOR = "#a3a29b";   // "Other" (everything outside the top series)
const INK = "#52514e";
const MUTED_INK = "#8a8984";
const GRID = "#ecebe7";

/** The fixed colour of a farm. */
export const farmColor = (farm) => SERIES_COLORS[CONFIG.farms.indexOf(farm) % SERIES_COLORS.length];

/** Colour of the n-th series (n from 0); "Other" is grey. */
export const seriesColor = (n, label) => (label === "Other" ? OTHER_COLOR : SERIES_COLORS[n % SERIES_COLORS.length]);

/** The colour used when a chart has one series (total expenses). */
export const SINGLE_COLOR = SERIES_COLORS[0];

const charts = new Map();   // canvas id -> Chart

/**
 * Draws (or updates) a bar chart.
 * spec: { labels, datasets: [{ label, data, color }], stacked?, horizontal? }
 * A legend is shown only when there is more than one series.
 */
export function renderBarChart(canvasId, { labels, datasets, stacked = false, horizontal = false }) {
  if (!window.Chart) return;   // Chart.js not loaded yet (or offline on the first visit)
  const data = {
    labels,
    datasets: datasets.map((d) => ({
      label: d.label,
      data: d.data,
      backgroundColor: d.color,
      borderColor: "#ffffff",
      borderWidth: stacked ? 1 : 0,   // thin gap between stacked parts
      borderRadius: 4,
      maxBarThickness: 44
    }))
  };
  const valueAxis = {
    beginAtZero: true, stacked, border: { display: false }, grid: { color: GRID },
    ticks: { color: MUTED_INK, font: { family: "Inter" }, callback: (v) => Number(v).toLocaleString("en-US") }
  };
  const labelAxis = { stacked, grid: { display: false }, ticks: { color: INK, font: { family: "Inter" } } };
  const indexAxis = horizontal ? "y" : "x";

  const existing = charts.get(canvasId);
  if (existing && existing.options.indexAxis === indexAxis) {
    existing.data = data;
    existing.options.plugins.legend.display = datasets.length > 1;
    existing.options.scales.x.stacked = stacked;
    existing.options.scales.y.stacked = stacked;
    existing.update();
    return;
  }
  if (existing) existing.destroy();

  charts.set(canvasId, new window.Chart($(canvasId), {
    type: "bar",
    data,
    options: {
      indexAxis,
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: {
          display: datasets.length > 1,
          labels: { usePointStyle: true, pointStyle: "rectRounded", color: INK, font: { family: "Inter", weight: "600" } }
        },
        tooltip: {
          backgroundColor: "rgba(28, 28, 30, 0.92)", padding: 10, cornerRadius: 8,
          callbacks: { label: (ctx) => `${ctx.dataset.label}: ${formatMoney(horizontal ? ctx.parsed.x : ctx.parsed.y)}` }
        }
      },
      scales: horizontal ? { x: valueAxis, y: labelAxis } : { x: labelAxis, y: valueAxis }
    }
  }));
}
