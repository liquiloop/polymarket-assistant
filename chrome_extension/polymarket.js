(function () {
  "use strict";

  const POLY_STORAGE_KEY = "polyedge_polymarket_active_cfg";

  // 1. Capturar parámetros inmediatamente en document_start antes de que Polymarket redirija de /event/... a /sports/...
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
          linea: (params.get("linea") || "").trim(),       // ej: "4.5", "224.5"
          side: (params.get("side") || "OVER").toUpperCase(), // "OVER" o "UNDER"
          outcome: (params.get("outcome") || "").trim(),   // "Over" / "Under"
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
    banner.innerHTML = `<span>🎯 <b>PolyEdge Polymarket:</b> ${texto}</span>`;
  }

  function clickSeguro(el) {
    if (!el) return;
    try {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    } catch (e) {}
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

  // Encontrar la tarjeta "Totals" en la vista deportiva de Polymarket (/sports/nba/... o /sports/nhl/...)
  function encontrarTarjetaTotals() {
    const headings = Array.from(document.querySelectorAll("h2, h3, h4, span, div"));
    for (const h of headings) {
      if (h.children.length > 1) continue;
      const txt = (h.textContent || "").trim().toLowerCase();
      if (txt === "totals" || txt === "total" || txt === "totales" || txt === "game total") {
        let curr = h.parentElement;
        for (let up = 0; up < 7 && curr; up++) {
          const tieneBotones = curr.querySelectorAll("button.trading-button").length >= 2;
          const tieneSwiper = Boolean(curr.querySelector(".swiper"));
          if (tieneBotones || tieneSwiper) {
            return curr;
          }
          curr = curr.parentElement;
        }
      }
    }
    return null;
  }

  // Seleccionar el número exacto (ej. "4.5" o "224.5") en el carrusel Swiper de Totals
  async function seleccionarLineaEnCarrusel(totalsCard, lineaBuscada) {
    if (!totalsCard || !lineaBuscada) return false;
    const botonesSlide = Array.from(totalsCard.querySelectorAll(".swiper-slide button, button")).filter(
      b => !b.classList.contains("trading-button")
    );
    const btnExacto = botonesSlide.find(b => (b.textContent || "").trim() === lineaBuscada);
    if (!btnExacto) return false;

    const slidePadre = btnExacto.closest(".swiper-slide");
    const yaActivo = slidePadre && slidePadre.classList.contains("swiper-slide-active");
    if (!yaActivo) {
      clickSeguro(btnExacto);
      const pHijo = btnExacto.querySelector("p, span");
      if (pHijo) {
        try { pHijo.click(); } catch (e) {}
      }
      await new Promise(r => setTimeout(r, 450));
    }
    return true;
  }

  // Hacer clic en el botón "O <linea>" (Over) o "U <linea>" (Under) dentro de la tarjeta Totals
  function clickBotonOverUnderEnTotals(totalsCard, cfg) {
    if (!totalsCard) return null;
    const esOver = cfg.side !== "UNDER";
    const prefijoCorto = esOver ? "o" : "u";
    const palabraLarga = esOver ? "over" : "under";

    const tradingBtns = Array.from(totalsCard.querySelectorAll("button.trading-button"));
    for (const btn of tradingBtns) {
      const tNorm = (btn.textContent || "").replace(/\s+/g, " ").trim().toLowerCase();
      if (cfg.linea) {
        if (
          tNorm.startsWith(`${prefijoCorto} ${cfg.linea}`) ||
          tNorm.startsWith(`${palabraLarga} ${cfg.linea}`) ||
          (tNorm.includes(cfg.linea) && (tNorm.startsWith(prefijoCorto + " ") || tNorm.includes(palabraLarga)))
        ) {
          const innerSpan = btn.querySelector(".trading-button-text") || btn;
          clickSeguro(innerSpan);
          clickSeguro(btn);
          return btn;
        }
      }
    }
    return null;
  }

  // Respaldo para vista clásica de Polymarket (/event/...) donde cada línea O/U es una fila separada
  function intentarSeleccionVistaClasica(cfg) {
    if (!cfg.linea) return false;
    const esOver = cfg.side !== "UNDER";
    const bloques = Array.from(document.querySelectorAll("div, li, section"));
    for (const b of bloques) {
      const t = (b.textContent || "").toLowerCase();
      if (!t.includes(`o/u ${cfg.linea}`) && !t.includes(`total ${cfg.linea}`)) continue;
      const botones = Array.from(b.querySelectorAll("button"));
      if (botones.length < 2 || botones.length > 8) continue;
      const targetBtn = botones.find(btn => {
        const bt = (btn.textContent || "").trim().toLowerCase();
        return esOver
          ? (bt.includes("over") || bt.includes("yes") || bt.startsWith(`o ${cfg.linea}`))
          : (bt.includes("under") || bt.includes("no") || bt.startsWith(`u ${cfg.linea}`));
      });
      if (targetBtn) {
        clickSeguro(targetBtn);
        return true;
      }
    }
    return false;
  }

  // Verificar al 100% en el panel derecho de compra (#outcome-buttons + pestaña Buy + #market-order-amount-input)
  async function verificarYPrepararPanelCompra(cfg) {
    const esOver = cfg.side !== "UNDER";

    // 1. Asegurar que la pestaña "Buy" esté activa (y NUNCA "Sell")
    const tabBuy = document.querySelector('button[role="radio"][value="BUY"]');
    if (tabBuy && tabBuy.getAttribute("aria-checked") !== "true") {
      clickSeguro(tabBuy);
      await new Promise(r => setTimeout(r, 250));
    }

    // 2. Verificar los botones del panel derecho (#outcome-buttons)
    const contenedorRadios = document.getElementById("outcome-buttons");
    let verificadoPanelDerecho = false;

    if (contenedorRadios) {
      const radios = Array.from(contenedorRadios.querySelectorAll('button[role="radio"]'));
      const valorEsperado = esOver ? "0" : "1";
      const radioCorrecto = radios.find(r => r.getAttribute("value") === valorEsperado) || (esOver ? radios[0] : radios[1]);

      if (radioCorrecto) {
        const txtRadio = (radioCorrecto.textContent || "").replace(/\s+/g, " ").trim().toLowerCase();
        const prefijo = esOver ? "o" : "u";
        const palabra = esOver ? "over" : "under";

        // Confirmar que el panel derecho NO se quedó en Moneyline, sino en la línea exacta (ej. "o 4.5" / "over 4.5")
        if (!cfg.linea || txtRadio.includes(cfg.linea)) {
          if (radioCorrecto.getAttribute("aria-checked") !== "true") {
            const inner = radioCorrecto.querySelector(".trading-button-text") || radioCorrecto;
            clickSeguro(inner);
            clickSeguro(radioCorrecto);
            await new Promise(r => setTimeout(r, 300));
          }
          if (
            txtRadio.startsWith(`${prefijo} ${cfg.linea}`) ||
            txtRadio.includes(`${palabra} ${cfg.linea}`) ||
            (cfg.linea && txtRadio.includes(cfg.linea))
          ) {
            radioCorrecto.style.outline = "3px solid #10b981";
            radioCorrecto.style.boxShadow = "0 0 18px rgba(16, 185, 129, 0.75)";
            verificadoPanelDerecho = true;
          }
        }
      }
    }

    // 3. Enfocar la cajita de monto en dólares (#market-order-amount-input) y resaltar el botón Trade / Buy SIN presionarlo
    const inputMonto =
      document.getElementById("market-order-amount-input") ||
      document.querySelector('input[inputmode="decimal"][placeholder*="$"]');

    if (inputMonto && verificadoPanelDerecho) {
      const cajaInput = inputMonto.parentElement || inputMonto;
      cajaInput.style.outline = "3px solid #fbbf24";
      cajaInput.style.borderRadius = "10px";
      cajaInput.style.boxShadow = "0 0 16px rgba(251, 191, 36, 0.55)";
      try {
        inputMonto.focus();
      } catch (e) {}
    }

    const btnTrade = Array.from(document.querySelectorAll('button.trading-button[data-color="blue"], button')).find(b => {
      const t = (b.textContent || "").trim().toLowerCase();
      return t === "trade" || t === "buy" || t.startsWith("buy over") || t.startsWith("buy under");
    });
    if (btnTrade && verificadoPanelDerecho) {
      btnTrade.style.outline = "3px solid #34d399";
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

      const etiquetaMeta = `${cfg.side === "UNDER" ? "UNDER (Menos de)" : "OVER (Más de)"} ${cfg.linea}`;
      mostrarBannerPoly(`Buscando y marcando «${etiquetaMeta}» para que no haya error...`, "#047857");

      let completado = false;

      for (let intento = 0; intento < 35; intento++) {
        const totalsCard = encontrarTarjetaTotals();
        if (totalsCard) {
          totalsCard.style.outline = "2px solid rgba(16, 185, 129, 0.6)";
          totalsCard.style.borderRadius = "14px";

          if (cfg.linea) {
            await seleccionarLineaEnCarrusel(totalsCard, cfg.linea);
          }

          const btnClicado = clickBotonOverUnderEnTotals(totalsCard, cfg);
          if (btnClicado) {
            btnClicado.style.outline = "3px solid #10b981";
            await new Promise(r => setTimeout(r, 400));
            const okDerecha = await verificarYPrepararPanelCompra(cfg);
            if (okDerecha) {
              completado = true;
              break;
            }
          }
        } else if (intento >= 6) {
          if (intentarSeleccionVistaClasica(cfg)) {
            await new Promise(r => setTimeout(r, 450));
            const okDerecha = await verificarYPrepararPanelCompra(cfg);
            if (okDerecha) {
              completado = true;
              break;
            }
          }
        }

        await new Promise(r => setTimeout(r, 420));
      }

      try { sessionStorage.removeItem(POLY_STORAGE_KEY); } catch (e) {}

      if (completado) {
        mostrarBannerPoly(
          `✅ ¡Listo y verificado! Quedó marcado «${etiquetaMeta}» en modo BUY a la derecha. Solo escribe tu monto en $ y dale a «Trade / Buy».`,
          "#059669"
        );
      } else {
        mostrarBannerPoly(
          `⚠️ No se pudo marcar automáticamente «${etiquetaMeta}» (puede haber cerrado esa línea). Revisa bien la tarjeta Totals antes de comprar.`,
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
