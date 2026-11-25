import { startApp } from "./app.js";

startApp();

// The service worker caches the shell and the built-in bundle; a new worker waits so that code
// never swaps in the middle of a session (ARCHITECTURE §8).
if ("serviceWorker" in navigator && location.protocol !== "file:") {
  window.addEventListener("load", () => {
    void navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .then((registration) => {
        const announce = (): void => {
          window.dispatchEvent(new Event("aitqr:update"));
        };
        if (registration.waiting) announce();
        registration.addEventListener("updatefound", () => {
          const installing = registration.installing;
          if (!installing) return;
          installing.addEventListener("statechange", () => {
            if (installing.state === "installed" && navigator.serviceWorker.controller) announce();
          });
        });
      })
      .catch(() => {
        // Offline support is best-effort; the tool still works while the page is open.
      });
  });
}
