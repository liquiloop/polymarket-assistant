// PolyEdge ALPHA v2.0 — Background Service Worker (Zero Popup Block + Real Execution Relay)
let polyWorkerTabId = null;
let bcWorkerTabId = null;

async function abrirOActualizarWorkerTab(targetUrl, kind, focusTab = false) {
  let currentId = kind === "bc" ? bcWorkerTabId : polyWorkerTabId;

  if (currentId !== null) {
    try {
      const existing = await chrome.tabs.get(currentId);
      if (existing && existing.id) {
        const updated = await chrome.tabs.update(existing.id, {
          url: targetUrl,
          active: Boolean(focusTab)
        });
        return updated.id;
      }
    } catch (e) {
      currentId = null;
    }
  }

  const created = await chrome.tabs.create({
    url: targetUrl,
    active: Boolean(focusTab)
  });

  if (kind === "bc") bcWorkerTabId = created.id;
  else polyWorkerTabId = created.id;
  return created.id;
}

async function difundirADashboardsPolyEdge(payload) {
  try {
    const tabs = await chrome.tabs.query({});
    for (const t of tabs) {
      const u = t.url || "";
      if (
        u.includes("polyedge-ai.onrender.com") ||
        u.includes("localhost:") ||
        u.includes("127.0.0.1:")
      ) {
        try {
          await chrome.tabs.sendMessage(t.id, payload);
        } catch (e) {}
      }
    }
  } catch (e) {}
}

chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === polyWorkerTabId) polyWorkerTabId = null;
  if (tabId === bcWorkerTabId) bcWorkerTabId = null;
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.type) return false;

  if (msg.type === "POLYEDGE_PING") {
    sendResponse({ ok: true, version: "2.0.0" });
    return false;
  }

  if (msg.type === "POLYEDGE_DISPATCH_POLY_MASTER") {
    abrirOActualizarWorkerTab(msg.url, "poly", Boolean(msg.focusTab))
      .then((tabId) => sendResponse({ ok: true, tabId }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }

  if (msg.type === "POLYEDGE_DISPATCH_BC_MASTER") {
    abrirOActualizarWorkerTab(msg.url, "bc", Boolean(msg.focusTab))
      .then((tabId) => sendResponse({ ok: true, tabId }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }

  if (msg.type === "POLYEDGE_SCAN_PORTFOLIO") {
    const scanUrl = "https://polymarket.com/portfolio?polyedge_scan_portfolio=1&ts=" + Date.now();
    abrirOActualizarWorkerTab(scanUrl, "poly", Boolean(msg.focusTab))
      .then((tabId) => sendResponse({ ok: true, tabId }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }

  if (msg.type === "POLYEDGE_MASTER_ACK" || msg.type === "POLYEDGE_PORTFOLIO_DATA") {
    difundirADashboardsPolyEdge(msg);
    sendResponse({ ok: true });
    return false;
  }

  return false;
});
