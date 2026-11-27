(function () {
  "use strict";

  const POLY_STORAGE_KEY = "polyedge_polymarket_active_cfg";

  function capturarConfigPolymarket() {
    const hash = window.location.hash || "";
    const search = window.location.search || "";
    const raw = hash.includes("polyedge_poly=1")
      ? hash.replace(/^#/, "")
      : (search.includes("polyedge_poly=1") ? search.replace(/^\?/, "") : "");

    if (raw) {
      const params = new URLSearchParams(raw);
      if (params.get("polyedge_poly") === "1") {
        const cfg = {
          ts: Date.now(),
          accion: (params.get("accion") || "BUY").toUpperCase(), // "BUY" o "SELL"
          tipo: (params.get("tipo") || "OU").toUpperCase(),      // "OU" o "ML"
          linea: (params.get("linea") || "").trim(),
          side: (params.get("side") || "OVER").toUpperCase(),
          outcome: (params.get("outcome") || "").trim(),
          stake: (params.get("stake") || "").trim(),
          cents: (params.get("cents") || "").trim(),
          q: (params.get("q") || "").trim()
        };
        try {
          sessionStorage.setItem(POLY_STORAGE_KEY, JSON.stringify(cfg));
        } catch (e) {}
        return cfg;
      }
    }

    try {
      const saved = sessionStorage.getItem(POLY_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && (Date.now() - (parsed.ts || 0) < 45000)) {
          return parsed;
        }
      }
    } catch (e) {}

    return null;
  }

  capturarConfigPolymarket();

  function mostrarBannerPoly(texto, colorBg = "#059669") {
    if (!document.body) return;
    let banner = document.getElementById("polyedge-poly-banner");
    if (!banner) {
      banner = document.createElement("div");
      banner.id = "polyedge-poly-banner";
      banner.style.cssText = [
        "position: fixed",
        "top: 14px",
        "left: 50%",
        "transform: translateX(-50%)",
        "z-index: 2147483647",
        "padding: 12px 22px",
        "border-radius: 12px",
        "color: #ffffff",
        "font-family: system-ui, -apple-system, sans-serif",
        "font-size: 14px",
        "font-weight: 700",
        "box-shadow: 0 10px 28px rgba(0,0,0,0.75)",
        "border: 2px solid #34d399",
        "display: flex",
        "align-items: center",
        "gap: 10px",
        "max-width: 94vw",
        "transition: all 0.25s ease"
      ].join(";");
      document.body.appendChild(banner);
    }
    banner.style.background = colorBg;
    banner.innerHTML = `<span>⚡ <b>PolyEdge Alpha:</b> ${texto}</span>`;
  }

  function dispararClickSinScroll(el) {
    if (!el) return;
    const opts = { bubbles: true, cancelable: true, composed: true, view: window };
    try {
      el.dispatchEvent(new PointerEvent("pointerdown", opts));
      el.dispatchEvent(new MouseEvent("mousedown", opts));
      el.dispatchEvent(new PointerEvent("pointerup", opts));
      el.dispatchEvent(new MouseEvent("mouseup", opts));
      el.click();
    } catch (e) {
      try { el.click(); } catch (e2) {}
    }
  }

  function setReactInputValue(inputEl, val) {
    if (!inputEl) return;
    const prevVal = inputEl.value;
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
    if (nativeSetter) nativeSetter.call(inputEl, String(val));
    else inputEl.value = String(val);
    const tracker = inputEl._valueTracker;
    if (tracker) {
      try { tracker.setValue(prevVal); } catch (e) {}
    }
    inputEl.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    inputEl.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
  }

  function encontrarTarjetaMoneyline() {
    const nodos = Array.from(document.querySelectorAll("h2, h3, h4, span, div, p"));
    for (const h of nodos) {
      if (h.children.length > 2) continue;
      const txt = (h.textContent || "").trim().toLowerCase();
      if (txt === "moneyline" || txt === "línea de dinero" || txt === "ganador") {
        let curr = h.parentElement;
        for (let up = 0; up < 7 && curr; up++) {
          if (curr.querySelectorAll("button.trading-button").length >= 2) {
            return curr;
          }
          curr = curr.parentElement;
        }
      }
    }
    return null;
  }

  function encontrarTarjetaTotalsCompleta() {
    const nodos = Array.from(document.querySelectorAll("h2, h3, h4, span, div, p"));
    for (const h of nodos) {
      if (h.children.length > 2) continue;
      const txt = (h.textContent || "").trim().toLowerCase();
      if (txt === "totales" || txt === "totals" || txt === "total" || txt === "game total") {
        let curr = h.parentElement;
        let mejorConBotones = null;

        for (let up = 0; up < 9 && curr; up++) {
          const textoBloque = (curr.textContent || "").toLowerCase();
          if (textoBloque.includes("moneyline") || textoBloque.includes("línea de dinero")) {
            break;
          }
          const cantTradingBtns = curr.querySelectorAll("button.trading-button").length;
          const tieneSwiper = Boolean(curr.querySelector(".swiper, .swiper-wrapper, .swiper-slide"));
          const tieneBotonesLinea = Array.from(curr.querySelectorAll("button")).some(b => /^\d+(\.5)?$/.test((b.textContent || "").trim()));

          if (cantTradingBtns >= 2 && (tieneSwiper || tieneBotonesLinea)) {
            return curr;
          }
          if (cantTradingBtns >= 2 && !mejorConBotones) {
            mejorConBotones = curr;
          }
          curr = curr.parentElement;
        }

        if (mejorConBotones) {
          const padre = mejorConBotones.parentElement;
          if (padre && !(padre.textContent || "").toLowerCase().includes("moneyline")) {
            return padre;
          }
          return mejorConBotones;
        }
      }
    }
    return null;
  }

  async function seleccionarLineaEnCarrusel(totalsCard, lineaBuscada) {
    if (!totalsCard || !lineaBuscada) return false;
    let alcanceBotones = Array.from(totalsCard.querySelectorAll("button")).filter(
      b => !b.classList.contains("trading-button")
    );
    if (alcanceBotones.length === 0 && totalsCard.parentElement) {
      alcanceBotones = Array.from(totalsCard.parentElement.querySelectorAll(".swiper-slide button, button")).filter(
        b => !b.classList.contains("trading-button")
      );
    }

    const btnExacto = alcanceBotones.find(b => (b.textContent || "").trim() === lineaBuscada);
    if (!btnExacto) return false;

    const textoHijo = btnExacto.querySelector("p, span");
    if (textoHijo) dispararClickSinScroll(textoHijo);
    dispararClickSinScroll(btnExacto);

    for (let w = 0; w < 8; w++) {
      await new Promise(r => setTimeout(r, 150));
      const btnsArriba = Array.from(totalsCard.querySelectorAll("button.trading-button"));
      const yaCambio = btnsArriba.some(tb => (tb.textContent || "").replace(/\s+/g, " ").includes(lineaBuscada));
      if (yaCambio) return true;
      if (w === 3) {
        try { btnExacto.click(); } catch (e) {}
      }
    }
    return false;
  }

  function clickBotonOverUnderEnTotals(totalsCard, cfg) {
    if (!totalsCard) return null;
    const esOver = cfg.side !== "UNDER";
    const prefijoCorto = esOver ? "o" : "u";
    const palabraIngles = esOver ? "over" : "under";
    const palabraEsp = esOver ? "más" : "menos";

    const tradingBtns = Array.from(totalsCard.querySelectorAll("button.trading-button"));
    for (const btn of tradingBtns) {
      const tNorm = (btn.textContent || "").replace(/\s+/g, " ").trim().toLowerCase();
      if (cfg.linea) {
        const coincideLinea = tNorm.includes(cfg.linea);
        const coincideLado = (
          tNorm.startsWith(`${prefijoCorto} ${cfg.linea}`) ||
          tNorm.startsWith(`${prefijoCorto}${cfg.linea}`) ||
          tNorm.startsWith(`${palabraIngles} ${cfg.linea}`) ||
          tNorm.includes(palabraEsp)
        );
        if (coincideLinea && coincideLado) {
          const innerSpan = btn.querySelector(".trading-button-text") || btn;
          dispararClickSinScroll(innerSpan);
          dispararClickSinScroll(btn);
          return btn;
        }
      }
    }
    return null;
  }

  function clickBotonEquipoEnMoneyline(mlCard, cfg) {
    if (!mlCard || !cfg.outcome) return null;
    const targetWords = cfg.outcome.toLowerCase().split(/\s+/).filter(w => w.length >= 3);
    const tradingBtns = Array.from(mlCard.querySelectorAll("button.trading-button"));

    const partesQ = (cfg.q || "").split(/\s+vs\.?\s+/i);
    const esPrimero = partesQ.length === 2 && partesQ[0].toLowerCase().includes(cfg.outcome.toLowerCase());
    const esSegundo = partesQ.length === 2 && partesQ[1].toLowerCase().includes(cfg.outcome.toLowerCase());

    for (const btn of tradingBtns) {
      const bt = (btn.textContent || "").toLowerCase();
      if (targetWords.some(w => bt.includes(w))) {
        const inner = btn.querySelector(".trading-button-text") || btn;
        dispararClickSinScroll(inner);
        dispararClickSinScroll(btn);
        return btn;
      }
    }

    if (tradingBtns.length === 2 && (esPrimero || esSegundo)) {
      const elegido = esPrimero ? tradingBtns[0] : tradingBtns[1];
      const inner = elegido.querySelector(".trading-button-text") || elegido;
      dispararClickSinScroll(inner);
      dispararClickSinScroll(elegido);
      return elegido;
    }
    return null;
  }

  async function verificarYPrepararPanelDerecho(cfg) {
    const esOver = cfg.side !== "UNDER";
    const esModoVenta = cfg.accion === "SELL";

    // 1. Seleccionar pestaña BUY (Comprar) o SELL (Vender para cobrar ganancia en vivo!)
    const valorRadioTab = esModoVenta ? "SELL" : "BUY";
    const tabObjetivo =
      document.querySelector(`button[role="radio"][value="${valorRadioTab}"]`) ||
      Array.from(document.querySelectorAll('button[role="radio"], button')).find(b => {
        const t = (b.textContent || "").trim().toLowerCase();
        return esModoVenta ? (t === "vender" || t === "sell") : (t === "comprar" || t === "buy");
      });

    if (tabObjetivo && tabObjetivo.getAttribute("aria-checked") === "false") {
      dispararClickSinScroll(tabObjetivo);
      await new Promise(r => setTimeout(r, 300));
    }

    // 2. Verificar el botón de resultado (#outcome-buttons)
    const contenedorRadios = document.getElementById("outcome-buttons");
    let verificadoPanelDerecho = false;

    if (contenedorRadios) {
      const radios = Array.from(contenedorRadios.querySelectorAll('button[role="radio"], button.trading-button'));
      if (cfg.tipo === "ML") {
        const seleccionado = radios.find(r => r.getAttribute("aria-checked") === "true" || r.getAttribute("data-selected") === "true");
        if (seleccionado) {
          seleccionado.style.outline = "3px solid #10b981";
          seleccionado.style.boxShadow = "0 0 18px rgba(16, 185, 129, 0.8)";
          verificadoPanelDerecho = true;
        }
      } else {
        const valorEsperado = esOver ? "0" : "1";
        const radioCorrecto = radios.find(r => r.getAttribute("value") === valorEsperado) || (esOver ? radios[0] : radios[1]);
        if (radioCorrecto) {
          const txtRadio = (radioCorrecto.textContent || "").replace(/\s+/g, " ").trim().toLowerCase();
          if (cfg.linea && txtRadio.includes(cfg.linea)) {
            if (radioCorrecto.getAttribute("aria-checked") === "false" || radioCorrecto.getAttribute("data-selected") === "false") {
              const inner = radioCorrecto.querySelector(".trading-button-text") || radioCorrecto;
              dispararClickSinScroll(inner);
              dispararClickSinScroll(radioCorrecto);
              await new Promise(r => setTimeout(r, 250));
            }
            radioCorrecto.style.outline = "3px solid #10b981";
            radioCorrecto.style.boxShadow = "0 0 18px rgba(16, 185, 129, 0.8)";
            verificadoPanelDerecho = true;
          }
        }
      }
    }

    // 3. Si es modo VENDER (Take-Profit), pulsar el botón "Max" / "100%" si está disponible para vender todas tus acciones
    if (esModoVenta && verificadoPanelDerecho) {
      const btnMax = Array.from(document.querySelectorAll("button")).find(b => {
        const t = (b.textContent || "").trim().toLowerCase();
        return t === "max" || t === "máx" || t === "100%";
      });
      if (btnMax) {
        dispararClickSinScroll(btnMax);
      }
      return true;
    }

    // 4. Si es modo COMPRAR, colocar el monto en dólares y enfocar
    const inputMonto =
      document.getElementById("market-order-amount-input") ||
      document.querySelector('input[inputmode="decimal"]');

    if (inputMonto && verificadoPanelDerecho) {
      const cajaInput = inputMonto.parentElement || inputMonto;
      cajaInput.style.outline = "3px solid #fbbf24";
      cajaInput.style.borderRadius = "10px";
      cajaInput.style.boxShadow = "0 0 16px rgba(251, 191, 36, 0.6)";
      try {
        inputMonto.focus();
        if (cfg.stake) {
          setReactInputValue(inputMonto, cfg.stake);
        } else {
          inputMonto.select();
        }
      } catch (e) {}
    }

    return verificadoPanelDerecho;
  }

  let ejecutandoPoly = false;

  async function ejecutarAutoSeleccionPolymarket() {
    if (ejecutandoPoly) return;
    const cfg = capturarConfigPolymarket();
    if (!cfg) return;

    ejecutandoPoly = true;
    try {
      while (!document.body) {
        await new Promise(r => setTimeout(r, 100));
      }

      const etiquetaMeta = cfg.tipo === "ML"
        ? `Ganador: ${cfg.outcome}`
        : `${cfg.side === "UNDER" ? "UNDER / U" : "OVER / O"} ${cfg.linea}`;
      const verbo = cfg.accion === "SELL" ? "Preparando VENTA (Take-Profit) de" : "Marcando COMPRA en";

      mostrarBannerPoly(`${verbo} «${etiquetaMeta}»...`, cfg.accion === "SELL" ? "#b45309" : "#047857");

      let completado = false;
      let scrolleadoUnaVez = false;

      for (let intento = 0; intento < 35; intento++) {
        if (cfg.tipo === "ML") {
          const mlCard = encontrarTarjetaMoneyline();
          if (mlCard) {
            const btn = clickBotonEquipoEnMoneyline(mlCard, cfg);
            if (btn) {
              btn.style.outline = "3px solid #10b981";
              await new Promise(r => setTimeout(r, 380));
              if (await verificarYPrepararPanelDerecho(cfg)) {
                completado = true;
                break;
              }
            }
          }
        } else {
          const totalsCard = encontrarTarjetaTotalsCompleta();
          if (totalsCard) {
            if (!scrolleadoUnaVez) {
              try { totalsCard.scrollIntoView({ behavior: "instant", block: "center" }); } catch (e) {}
              scrolleadoUnaVez = true;
              await new Promise(r => setTimeout(r, 200));
            }
            totalsCard.style.outline = "2px solid rgba(16, 185, 129, 0.65)";
            totalsCard.style.borderRadius = "14px";

            if (cfg.linea) {
              await seleccionarLineaEnCarrusel(totalsCard, cfg.linea);
            }
            const btnClicado = clickBotonOverUnderEnTotals(totalsCard, cfg);
            if (btnClicado) {
              btnClicado.style.outline = "3px solid #10b981";
              await new Promise(r => setTimeout(r, 380));
              if (await verificarYPrepararPanelDerecho(cfg)) {
                completado = true;
                break;
              }
            }
          }
        }

        await new Promise(r => setTimeout(r, 420));
      }

      try { sessionStorage.removeItem(POLY_STORAGE_KEY); } catch (e) {}

      if (completado) {
        if (cfg.accion === "SELL") {
          mostrarBannerPoly(
            `💰 ¡Modo VENDER listo en «${etiquetaMeta}»! Revisa tus acciones a la derecha y confirma la venta para asegurar tu ganancia.`,
            "#d97706"
          );
        } else {
          mostrarBannerPoly(
            `✅ ¡Listo! «${etiquetaMeta}» seleccionado${cfg.stake ? " con $" + cfg.stake : ""}. Confirma abajo a la derecha (o usa Orden Límite 1¢ abajo).`,
            "#059669"
          );
        }
      } else {
        mostrarBannerPoly(
          `⚠️ No apareció disponible «${etiquetaMeta}». Revisa manualmente antes de operar.`,
          "#d97706"
        );
      }
    } finally {
      ejecutandoPoly = false;
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => setTimeout(ejecutarAutoSeleccionPolymarket, 650));
  } else {
    setTimeout(ejecutarAutoSeleccionPolymarket, 650);
  }
  window.addEventListener("hashchange", () => setTimeout(ejecutarAutoSeleccionPolymarket, 350));
})();
