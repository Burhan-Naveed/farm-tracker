// =========================================================
// Bar chart of Inflow and Outflow per farm (Chart.js from the CDN).
// =========================================================

import { CONFIG } from "../config.js";
import { formatMoney } from "../lib/format.js";
import { $ } from "./dom.js";

let chart = null;

/** Draws (or updates) the chart from a Total Report. */
export function renderFarmChart(report) {
  if (!window.Chart) return; // Chart.js not loaded yet (or offline on the first visit)
  const data = {
    labels: CONFIG.farms,
    datasets: [
      { label: "Inflow", data: CONFIG.farms.map((f) => report.totals.Inflow.byFarm[f]), backgroundColor: "#6c5ce7", borderRadius: 8, maxBarThickness: 46 },
      { label: "Outflow", data: CONFIG.farms.map((f) => report.totals.Outflow.byFarm[f]), backgroundColor: "#7fb0ff", borderRadius: 8, maxBarThickness: 46 }
    ]
  };
  if (chart) {
    chart.data = data;
    chart.update();
    return;
  }
  chart = new window.Chart($("report-chart"), {
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
