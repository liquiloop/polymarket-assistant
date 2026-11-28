// PolyEdge ALPHA v2.0 — Bridge Content Script on PolyEdge Dashboard
(function () {
  "use strict";

  const EXT_VERSION = "2.0.0";

  function marcarExtensionActiva() {
    if (document.documentElement) {
      document.documentElement.setAttribute("data-polyedge-ext", EXT_VERSION);
    }
    window.postMessage({ source: "POLYEDGE_EXT", type: "POLYEDGE_EXT_READY", version: EXT_VERSION }, "*");
  }

  marcarExtensionActiva();
  document.addEventListener("DOMContentLoaded", marcarExtensionActiva);
  setTimeout(marcarExtensionActiva, 1000);

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== "POLYEDGE_WEB" || !data.type) return;

    if (data.type === "POLYEDGE_CHECK_EXT") {
      marcarExtensionActiva();
      return;
    }

    try {
      chrome.runtime.sendMessage(data, (resp) => {
        const lastErr = chrome.runtime.lastError;
        window.postMessage(
          {
            source: "POLYEDGE_EXT",
            type: "POLYEDGE_BRIDGE_RESP",
            reqType: data.type,
            orderId: data.orderId || null,
            resp: lastErr ? { ok: false, error: lastErr.message } : (resp || { ok: true })
          },
          "*"
        );
      });
    } catch (e) {
      window.postMessage(
        {
          source: "POLYEDGE_EXT",
          type: "POLYEDGE_BRIDGE_RESP",
          reqType: data.type,
          orderId: data.orderId || null,
          resp: { ok: false, error: String(e) }
        },
        "*"
      );
    }
  });

  chrome.runtime.onMessage.addListener((msg) => {
    if (!msg || !msg.type) return;
    window.postMessage(Object.assign({ source: "POLYEDGE_EXT" }, msg), "*");
  });
})();
