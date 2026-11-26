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
          linea: (params.get("linea") || "").trim(),          // ej: "5.5", "4.5", "224.5"
          side: (params.get("side") || "OVER").toUpperCase(), // "OVER" o "UNDER"
          outcome: (params.get("outcome") || "").trim(),
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

  // Encontrar el contenedor COMPLETO de "Totales" / "Totals" (incluyendo la barra inferior de números 4.5, 5.5, 6.5, 7.5)
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
          // No subir tan alto que abarque Moneyline o Spreads/Hándicap
          if (textoBloque.includes("moneyline") || textoBloque.includes("línea de dinero")) {
            break;
          }

          const cantTradingBtns = curr.querySelectorAll("button.trading-button").length;
          const tieneSwiper = Boolean(curr.querySelector(".swiper, .swiper-wrapper, .swiper-slide"));
          const tieneBotonesLinea = Array.from(curr.querySelectorAll("button")).some(b => /^\d+(\.5)?$/.test((b.textContent || "").trim()));

          if (cantTradingBtns >= 2 && (tieneSwiper || tieneBotonesLinea)) {
            return curr; // ¡Este contenedor tiene TANTO los botones O/U COMO el carrusel inferior de números!
          }
          if (cantTradingBtns >= 2 && !mejorConBotones) {
            mejorConBotones = curr;
          }
          curr = curr.parentElement;
        }

        if (mejorConBotones) {
          // Revisar si el padre inmediato contiene el carrusel sin incluir Moneyline
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

  // Seleccionar el número exacto (ej. "5.5" o "4.5") en la barra inferior de Totales
  async function seleccionarLineaEnCarrusel(totalsCard, lineaBuscada) {
    if (!totalsCard || !lineaBuscada) return false;

    // Buscar primero dentro de totalsCard y, por seguridad, también en cualquier carrusel cercano
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

    // Hacer clic tanto en el botón como en el texto interno (<p>5.5</p>) y en el slide
    const textoHijo = btnExacto.querySelector("p, span");
    if (textoHijo) dispararClickSinScroll(textoHijo);
    dispararClickSinScroll(btnExacto);

    // Esperar a que los botones superiores cambien a "O <linea>" / "U <linea>"
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

  // Hacer clic en "O <linea>" (Over / Más de) o "U <linea>" (Under / Menos de) en la tarjeta Totales
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

  // Verificar en el panel derecho (funciona tanto en Español "Comprar / Importe" como en Inglés "Buy / Amount")
  async function verificarYPrepararPanelCompra(cfg) {
    const esOver = cfg.side !== "UNDER";

    // 1. Asegurar que esté seleccionada la pestaña "Comprar" / "Buy" (y NO "Vender" / "Sell")
    const tabBuy =
      document.querySelector('button[role="radio"][value="BUY"]') ||
      Array.from(document.querySelectorAll('button[role="radio"], button')).find(b => {
        const t = (b.textContent || "").trim().toLowerCase();
        return t === "comprar" || t === "buy";
      });

    if (tabBuy && tabBuy.getAttribute("aria-checked") === "false") {
      dispararClickSinScroll(tabBuy);
      await new Promise(r => setTimeout(r, 250));
    }

    // 2. Verificar que los dos botones del panel derecho ya NO digan los equipos (Moneyline), sino "O 5.5" / "U 5.5"
    const contenedorRadios = document.getElementById("outcome-buttons");
    let verificadoPanelDerecho = false;

    if (contenedorRadios) {
      const radios = Array.from(contenedorRadios.querySelectorAll('button[role="radio"], button.trading-button'));
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

    // Si Polymarket en otro tamaño de pantalla no usa #outcome-buttons pero el encabezado derecho ya dice "Over 5.5" / "Más de 5.5"
    if (!verificadoPanelDerecho && cfg.linea) {
      const spansDerecha = Array.from(document.querySelectorAll("span, div"));
      const yaMuestraJugada = spansDerecha.some(s => {
        if (s.children.length > 1) return false;
        const t = (s.textContent || "").trim().toLowerCase();
        return esOver
          ? (t === `over ${cfg.linea}` || t === `más de ${cfg.linea}` || t === `o ${cfg.linea}`)
          : (t === `under ${cfg.linea}` || t === `menos de ${cfg.linea}` || t === `u ${cfg.linea}`);
      });
      if (yaMuestraJugada) verificadoPanelDerecho = true;
    }

    // 3. Enfocar la cajita de Importe ($10 / $0) para que el usuario solo escriba su monto y presione Comprar / Trade
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
        inputMonto.select();
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

      const etiquetaMeta = `${cfg.side === "UNDER" ? "UNDER / U" : "OVER / O"} ${cfg.linea}`;
      mostrarBannerPoly(`Buscando «Totales ${cfg.linea}» y marcando «${etiquetaMeta}»...`, "#047857");

      let completado = false;
      let scrolleadoUnaVez = false;

      for (let intento = 0; intento < 35; intento++) {
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
          `✅ ¡Verificado! Quedó seleccionado «${etiquetaMeta}» en «Comprar» a la derecha. Solo pon tu Importe en $ y dale al botón azul.`,
          "#059669"
        );
      } else {
        mostrarBannerPoly(
          `⚠️ La línea exacta «${cfg.linea}» no apareció disponible en Totales. Revisa los números debajo de Totales antes de comprar.`,
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
