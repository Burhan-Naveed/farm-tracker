// =========================================================
// PWA: offline banner, "Install App" button and the service worker.
// =========================================================

import { logError } from "../lib/errors.js";
import { $, setHidden } from "./dom.js";

function updateOnlineBanner() {
  setHidden($("offline-banner"), navigator.onLine);
}

function initInstallButton() {
  let installPrompt = null;
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    installPrompt = e;
    setHidden($("install-btn"), false);
  });
  $("install-btn").addEventListener("click", async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    await installPrompt.userChoice;
    installPrompt = null;
    setHidden($("install-btn"), true);
  });
  window.addEventListener("appinstalled", () => setHidden($("install-btn"), true));
}

/** Registers the service worker (caches the app so it opens with weak internet). */
function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js").catch((err) => logError("Service worker registration", err));
  });
}

export function initPwa() {
  window.addEventListener("online", updateOnlineBanner);
  window.addEventListener("offline", updateOnlineBanner);
  updateOnlineBanner();
  initInstallButton();
  registerServiceWorker();
}
