(function () {
  "use strict";

  const POLY_STORAGE_KEY = "polyedge_polymarket_active_cfg";
  const EXECUTED_VAULT_KEY = "polyedge_master_executed_orders_v1";

  function yaFueEjecutadaOrden(oid) {
    if (!oid) return false;
    try {
      const vault = JSON.parse(localStorage.getItem(EXECUTED_VAULT_KEY) || "{}");
      return Boolean(vault[oid]);
    } catch (e) {
      return false;
    }
  }

  function marcarOrdenEjecutada(oid) {
    if (!oid) return;
    try {
      const vault = JSON.parse(localStorage.getItem(EXECUTED_VAULT_KEY) || "{}");
      const keys = Object.keys(vault);
      if (keys.length > 200) {
        keys.slice(0, 80).forEach(k => delete vault[k]);
      }
      vault[oid] = Date.now();
      localStorage.setItem(EXECUTED_VAULT_KEY, JSON.stringify(vault));
    } catch (e) {}
  }

  function reportarResultadoMaster(payload) {
    try {
      if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage(Object.assign({ type: "POLYEDGE_MASTER_ACK" }, payload));
      }
    } catch (e) {}
  }

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
          master: params.get("master") === "1",
          oid: (params.get("oid") || "").trim(),
          max_c: parseFloat(params.get("max_c") || "0") || 0,
          accion: (params.get("accion") || "BUY").toUpperCase(),
          tipo: (params.get("tipo") || "OU").toUpperCase(),
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
    banner.innerHTML = `<span>🤖 <b>PolyEdge v2.0:</b> ${texto}</span>`;
  }

  function dispararClickLimpioUnico(el) {
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
    inputEl.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true, data: String(val), inputType: "insertText" }));
    inputEl.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
  }

  function leerEfectivoVisible() {
    try {
      const textoHeader = (document.querySelector("header")?.innerText || document.body.innerText.slice(0, 800)).replace(/\s+/g, " ");
      const m = textoHeader.match(/(?:Efectivo|Cash)\s*\$?\s*([\d.,]+)/i);
      return m ? m[1] : "";
    } catch (e) {
      return "";
    }
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

    dispararClickLimpioUnico(btnExacto);

    for (let w = 0; w < 8; w++) {
      await new Promise(r => setTimeout(r, 160));
      const btnsArriba = Array.from(totalsCard.querySelectorAll("button.trading-button"));
      const yaCambio = btnsArriba.some(tb => (tb.innerText || tb.textContent || "").replace(/\s+/g, " ").includes(lineaBuscada));
      if (yaCambio) return true;
      if (w === 3) {
        const textoHijo = btnExacto.querySelector("p, span");
        if (textoHijo) textoHijo.click();
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
      const tNorm = (btn.innerText || btn.textContent || "").replace(/\s+/g, " ").trim().toLowerCase();
      if (cfg.linea) {
        const coincideLinea = tNorm.includes(cfg.linea);
        const coincideLado = (
          tNorm.startsWith(`${prefijoCorto} ${cfg.linea}`) ||
          tNorm.startsWith(`${prefijoCorto}${cfg.linea}`) ||
          tNorm.startsWith(`${palabraIngles} ${cfg.linea}`) ||
          tNorm.includes(palabraEsp)
        );
        if (coincideLinea && coincideLado) {
          dispararClickLimpioUnico(btn);
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
      const bt = (btn.innerText || btn.textContent || "").toLowerCase();
      if (targetWords.some(w => bt.includes(w))) {
        dispararClickLimpioUnico(btn);
        return btn;
      }
    }

    if (tradingBtns.length === 2 && (esPrimero || esSegundo)) {
      const elegido = esPrimero ? tradingBtns[0] : tradingBtns[1];
      dispararClickLimpioUnico(elegido);
      return elegido;
    }
    return null;
  }

  function extraerCentavosDeRadio(radioEl) {
    if (!radioEl) return 0;
    const m = (radioEl.innerText || radioEl.textContent || "").match(/(\d+(?:\.\d+)?)\s*¢/);
    return m ? parseFloat(m[1]) : 0;
  }

  function encontrarWidgetDerecho() {
    const ancla =
      document.getElementById("market-order-amount-input") ||
      document.getElementById("outcome-buttons");
    if (!ancla) return null;
    let curr = ancla.parentElement;
    let mejor = null;
    for (let i = 0; i < 9 && curr; i++) {
      const btns = curr.querySelectorAll('button.trading-button:not([role="radio"])');
      if (btns.length >= 1) {
        mejor = curr;
        break;
      }
      curr = curr.parentElement;
    }
    return mejor;
  }

  async function verificarYPrepararPanelDerecho(cfg) {
    const esOver = cfg.side !== "UNDER";
    const esModoVenta = cfg.accion === "SELL";

    const valorRadioTab = esModoVenta ? "SELL" : "BUY";
    const tabObjetivo =
      document.querySelector(`button[role="radio"][value="${valorRadioTab}"]`) ||
      Array.from(document.querySelectorAll('button[role="radio"], button')).find(b => {
        const t = (b.innerText || b.textContent || "").trim().toLowerCase();
        return esModoVenta ? (t === "vender" || t === "sell") : (t === "comprar" || t === "buy");
      });

    if (tabObjetivo && tabObjetivo.getAttribute("aria-checked") === "false") {
      dispararClickLimpioUnico(tabObjetivo);
      await new Promise(r => setTimeout(r, 320));
    }

    const contenedorRadios = document.getElementById("outcome-buttons");
    let verificadoPanelDerecho = false;
    let centavosVivos = 0;

    if (contenedorRadios) {
      const radios = Array.from(contenedorRadios.querySelectorAll('button[role="radio"], button.trading-button'));
      if (cfg.tipo === "ML") {
        const seleccionado = radios.find(r => r.getAttribute("aria-checked") === "true" || r.getAttribute("data-selected") === "true");
        if (seleccionado) {
          seleccionado.style.outline = "3px solid #10b981";
          centavosVivos = extraerCentavosDeRadio(seleccionado);
          verificadoPanelDerecho = true;
        }
      } else {
        const valorEsperado = esOver ? "0" : "1";
        const radioCorrecto = radios.find(r => r.getAttribute("value") === valorEsperado) || (esOver ? radios[0] : radios[1]);
        if (radioCorrecto) {
          const txtRadio = (radioCorrecto.innerText || radioCorrecto.textContent || "").replace(/\s+/g, " ").trim().toLowerCase();
          if (cfg.linea && txtRadio.includes(cfg.linea)) {
            if (radioCorrecto.getAttribute("aria-checked") === "false" || radioCorrecto.getAttribute("data-selected") === "false") {
              dispararClickLimpioUnico(radioCorrecto);
              await new Promise(r => setTimeout(r, 250));
            }
            radioCorrecto.style.outline = "3px solid #10b981";
            centavosVivos = extraerCentavosDeRadio(radioCorrecto);
            verificadoPanelDerecho = true;
          }
        }
      }
    }

    if (!verificadoPanelDerecho) return { ok: false, motivo: "no_verificado" };

    if (cfg.master && !esModoVenta && cfg.max_c > 0 && centavosVivos > cfg.max_c + 2.0) {
      return { ok: false, motivo: `precio subió a ${centavosVivos}¢ (tope seguro ${cfg.max_c}¢)`, fatal: false };
    }

    if (esModoVenta) {
      const widget = encontrarWidgetDerecho() || document;
      const btnMax = Array.from(widget.querySelectorAll("button")).find(b => {
        const t = (b.innerText || b.textContent || "").trim().toLowerCase();
        return t === "max" || t === "máx" || t === "100%";
      });
      if (btnMax) {
        dispararClickLimpioUnico(btnMax);
        await new Promise(r => setTimeout(r, 400));
      }
      return { ok: true, centavosVivos };
    }

    const inputMonto =
      document.getElementById("market-order-amount-input") ||
      document.querySelector('input[inputmode="decimal"]');

    if (inputMonto && cfg.stake) {
      const cajaInput = inputMonto.parentElement || inputMonto;
      cajaInput.style.outline = "3px solid #fbbf24";
      cajaInput.style.borderRadius = "10px";

      inputMonto.focus();
      setReactInputValue(inputMonto, "");
      await new Promise(r => setTimeout(r, 120));
      setReactInputValue(inputMonto, cfg.stake);
      await new Promise(r => setTimeout(r, 450));

      // Verificar que el monto realmente quedó puesto; si sigue vacío y el monto es entero (ej. $1 o $5), usar botón rápido +$1 / +$5
      const limpioActual = (inputMonto.value || "").replace(/[^0-9.]/g, "");
      if (!limpioActual || parseFloat(limpioActual) <= 0) {
        const widget = encontrarWidgetDerecho() || document;
        const btnRapido = Array.from(widget.querySelectorAll("button")).find(
          b => (b.innerText || "").trim() === `+$${cfg.stake}`
        );
        if (btnRapido) {
          dispararClickLimpioUnico(btnRapido);
          await new Promise(r => setTimeout(r, 400));
        }
      }
    }

    return { ok: true, centavosVivos };
  }

  // En modo FULL AUTOMATIC MASTER: hacer clic limpio y VERIFICAR que Polymarket ejecutó realmente la orden!
  async function confirmarOrdenAutomaticaMaster(cfg, etiquetaMeta, centavosVivos) {
    if (cfg.oid && yaFueEjecutadaOrden(cfg.oid)) {
      mostrarBannerPoly(`🛡️ Orden ya ejecutada anteriormente.`, "#0284c7");
      reportarResultadoMaster({ ok: true, orderId: cfg.oid, accion: cfg.accion, duplicate: true });
      return;
    }

    await new Promise(r => setTimeout(r, 450));

    // Buscar el botón de envío directamente dentro del widget derecho (funciona en Español e Inglés: Comprar, Operar, Intercambiar, Trade, Buy, Vender, Sell)
    const widget = encontrarWidgetDerecho();
    const candidatosSubmit = widget
      ? Array.from(widget.querySelectorAll('button.trading-button:not([role="radio"])'))
      : Array.from(document.querySelectorAll('button.trading-button[data-color="blue"]:not([role="radio"]), button.trading-button[data-color="red"]:not([role="radio"]), button.trading-button[data-color="green"]:not([role="radio"])'));

    const btnAccion = candidatosSubmit[candidatosSubmit.length - 1] || null;

    if (!btnAccion) {
      const msg = "No se encontró el botón azul de envío en el panel derecho de Polymarket.";
      mostrarBannerPoly(`⚠️ ${msg}`, "#d97706");
      reportarResultadoMaster({ ok: false, fatal: true, orderId: cfg.oid, accion: cfg.accion, error: msg });
      return;
    }

    // IMPORTANTE: Usar innerText (NO textContent) para ignorar spans ocultos de animación!
    const txtVisible = (btnAccion.innerText || "").replace(/\s+/g, " ").trim().toLowerCase();

    if (txtVisible.includes("depósito") || txtVisible.includes("deposit")) {
      const msg = `Saldo Efectivo insuficiente en Polymarket para cubrir $${cfg.stake} (si ganaste apuestas anteriores, entra a Cartera y dale a «Reclamar» para pasarlo a Efectivo).`;
      mostrarBannerPoly(`⚠️ ${msg}`, "#dc2626");
      reportarResultadoMaster({ ok: false, fatal: true, orderId: cfg.oid, accion: cfg.accion, error: msg });
      return;
    }

    if (txtVisible.includes("iniciar") || txtVisible.includes("log in") || txtVisible.includes("sign in") || txtVisible.includes("conectar") || txtVisible.includes("connect")) {
      const msg = "No has iniciado sesión en Polymarket en este navegador.";
      mostrarBannerPoly(`⚠️ ${msg}`, "#dc2626");
      reportarResultadoMaster({ ok: false, fatal: true, orderId: cfg.oid, accion: cfg.accion, error: msg });
      return;
    }

    if (btnAccion.disabled) {
      const msg = `El botón «${btnAccion.innerText.trim() || "Operar"}» está deshabilitado (monto mínimo en Polymarket suele ser $1.00 o sin liquidez).`;
      mostrarBannerPoly(`⚠️ ${msg}`, "#d97706");
      reportarResultadoMaster({ ok: false, fatal: false, orderId: cfg.oid, accion: cfg.accion, error: msg });
      return;
    }

    const efectivoAntes = leerEfectivoVisible();
    btnAccion.style.outline = "4px solid #34d399";

    // UN SOLO clic limpio sobre el botón de acción (sin doble disparo que pueda cancelar estados)
    try {
      btnAccion.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, view: window }));
      await new Promise(r => setTimeout(r, 60));
      btnAccion.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true, view: window }));
      btnAccion.click();
    } catch (e) {
      btnAccion.click();
    }

    // Vigilar hasta 6.5 segundos confirmaciones modales y prueba real de ejecución
    let confirmadaReal = false;
    let errorDetectado = "";

    for (let step = 0; step < 11; step++) {
      await new Promise(r => setTimeout(r, 600));

      // Si aparece un modal de Confirmar / Aprobar de Polymarket, darle clic una vez
      if (step === 1 || step === 3) {
        const btnModal = Array.from(document.querySelectorAll('[role="dialog"] button, button')).find(b => {
          if (b === btnAccion) return false;
          const t = (b.innerText || "").trim().toLowerCase();
          return t === "confirm" || t === "confirmar" || t === "approve" || t === "aprobar" || t === "buy now" || t === "comprar ahora";
        });
        if (btnModal && !btnModal.disabled) {
          btnModal.click();
        }
      }

      // Revisar toasts / notificaciones visibles
      const toastsTxt = Array.from(document.querySelectorAll('[data-sonner-toast], [role="status"], [role="alert"]'))
        .map(el => (el.innerText || "").toLowerCase())
        .join(" | ");

      if (
        toastsTxt.includes("insufficient") ||
        toastsTxt.includes("insuficiente") ||
        toastsTxt.includes("rejected") ||
        toastsTxt.includes("rechazad") ||
        toastsTxt.includes("failed") ||
        toastsTxt.includes("falló") ||
        toastsTxt.includes("minimum") ||
        toastsTxt.includes("mínimo")
      ) {
        errorDetectado = `Polymarket rechazó la orden (${toastsTxt.slice(0, 90)})`;
        break;
      }

      if (
        toastsTxt.includes("bought") ||
        toastsTxt.includes("comprad") ||
        toastsTxt.includes("sold") ||
        toastsTxt.includes("vendid") ||
        toastsTxt.includes("placed") ||
        toastsTxt.includes("filled") ||
        toastsTxt.includes("matched") ||
        toastsTxt.includes("ejecutad") ||
        toastsTxt.includes("éxito") ||
        toastsTxt.includes("success")
      ) {
        confirmadaReal = true;
        break;
      }

      // Verificar si el campo #market-order-amount-input se limpió tras enviarse o si cambió el saldo Efectivo
      const inpNow = document.getElementById("market-order-amount-input");
      const valNow = inpNow ? (inpNow.value || "").replace(/[^0-9.]/g, "") : "";
      const efectivoAhora = leerEfectivoVisible();

      if (step >= 2 && cfg.accion === "BUY" && (!valNow || parseFloat(valNow) === 0)) {
        confirmadaReal = true;
        break;
      }
      if (efectivoAntes && efectivoAhora && efectivoAntes !== efectivoAhora) {
        confirmadaReal = true;
        break;
      }
    }

    if (errorDetectado) {
      mostrarBannerPoly(`❌ ${errorDetectado}`, "#dc2626");
      reportarResultadoMaster({ ok: false, fatal: true, orderId: cfg.oid, accion: cfg.accion, error: errorDetectado });
      return;
    }

    if (!confirmadaReal) {
      const msg = "La orden quedó pendiente de firma o confirmación en Polymarket (revisa la pestaña de Polymarket; si usas billetera externa como MetaMask debes aprobar la firma).";
      mostrarBannerPoly(`⚠️ ${msg}`, "#d97706");
      reportarResultadoMaster({ ok: false, fatal: true, orderId: cfg.oid, accion: cfg.accion, error: msg });
      return;
    }

    marcarOrdenEjecutada(cfg.oid);

    if (cfg.accion === "SELL") {
      mostrarBannerPoly(`💰 ¡VENTA CONFIRMADA EN POLYMARKET («${etiquetaMeta}»)!`, "#d97706");
    } else {
      mostrarBannerPoly(`✅ ¡COMPRA REAL CONFIRMADA ($${cfg.stake}) EN «${etiquetaMeta}»!`, "#059669");
    }

    reportarResultadoMaster({
      ok: true,
      orderId: cfg.oid,
      accion: cfg.accion,
      fillCents: centavosVivos || parseFloat(cfg.cents) || 0,
      cashAfter: leerEfectivoVisible()
    });
  }

  // Escáner real de https://polymarket.com/portfolio cuando el usuario pide auditar sus apuestas reales
  async function escanearCarteraRealSiSolicitado() {
    if (!window.location.pathname.includes("/portfolio")) return;
    if (!window.location.search.includes("polyedge_scan_portfolio=1")) return;

    while (!document.body) {
      await new Promise(r => setTimeout(r, 100));
    }
    mostrarBannerPoly("🔎 Leyendo tus posiciones y resultados reales en Polymarket...", "#0284c7");

    await new Promise(r => setTimeout(r, 3800));

    try {
      const bodyTxt = (document.body.innerText || "").replace(/\r/g, "");
      const mCartera = bodyTxt.match(/(?:Cartera|Portfolio)\s*\n?\s*(\$[\d.,]+)/i);
      const mEfectivo = bodyTxt.match(/(?:Efectivo|Cash)\s*\n?\s*(\$[\d.,]+)/i);

      // Buscar filas o enlaces a /event/ o /sports/ dentro del portafolio
      const links = Array.from(document.querySelectorAll('a[href*="/event/"], a[href*="/sports/"]'));
      const posiciones = [];
      const vistos = new Set();

      for (const a of links) {
        let fila = a.parentElement;
        for (let up = 0; up < 5 && fila; up++) {
          const t = (fila.innerText || "").replace(/\s+/g, " ").trim();
          if (t.length > 18 && (t.includes("$") || t.includes("¢"))) break;
          fila = fila.parentElement;
        }
        if (!fila || vistos.has(fila)) continue;
        vistos.add(fila);

        const rowText = (fila.innerText || "").replace(/\s+/g, " ").trim();
        if (rowText.length < 10 || rowText.length > 360) continue;

        const tieneClaim = /\b(claim|reclamar|redeem|canjear)\b/i.test(rowText);
        posiciones.push({
          titulo: (a.innerText || "").trim() || rowText.slice(0, 70),
          resumen: rowText,
          href: a.href,
          ganadaParaReclamar: tieneClaim
        });
      }

      const hayBotonClaimGlobal = Array.from(document.querySelectorAll("button")).some(b =>
        /\b(claim|reclamar|redeem)\b/i.test((b.innerText || "").trim())
      );

      chrome.runtime.sendMessage({
        type: "POLYEDGE_PORTFOLIO_DATA",
        ok: true,
        cartera: mCartera ? mCartera[1] : "",
        efectivo: mEfectivo ? mEfectivo[1] : "",
        hayPremiosPorReclamar: hayBotonClaimGlobal,
        posiciones: posiciones.slice(0, 20)
      });

      mostrarBannerPoly(`✅ Cartera sincronizada con PolyEdge (${posiciones.length} posiciones detectadas).`, "#059669");
    } catch (e) {
      chrome.runtime.sendMessage({
        type: "POLYEDGE_PORTFOLIO_DATA",
        ok: false,
        error: String(e)
      });
    }
  }

  let ejecutandoPoly = false;

  async function ejecutarAutoSeleccionPolymarket() {
    escanearCarteraRealSiSolicitado();

    if (ejecutandoPoly) return;
    const cfg = capturarConfigPolymarket();
    if (!cfg) return;

    ejecutandoPoly = true;
    try {
      while (!document.body) {
        await new Promise(r => setTimeout(r, 100));
      }

      if (cfg.master && cfg.oid && yaFueEjecutadaOrden(cfg.oid)) {
        try { sessionStorage.removeItem(POLY_STORAGE_KEY); } catch (e) {}
        mostrarBannerPoly(`🛡️ Jugada Master ya ejecutada.`, "#047857");
        reportarResultadoMaster({ ok: true, orderId: cfg.oid, accion: cfg.accion, duplicate: true });
        return;
      }

      const etiquetaMeta = cfg.tipo === "ML"
        ? `Ganador: ${cfg.outcome}`
        : `${cfg.side === "UNDER" ? "UNDER / U" : "OVER / O"} ${cfg.linea}`;

      mostrarBannerPoly(
        `${cfg.master ? "🚀 [MASTER v2.0] Ejecutando" : "Marcando"} «${etiquetaMeta}»...`,
        "#047857"
      );

      let completado = false;
      let motivoAborto = "";
      let centavosFinales = 0;
      let scrolleadoUnaVez = false;

      for (let intento = 0; intento < 32; intento++) {
        if (cfg.tipo === "ML") {
          const mlCard = encontrarTarjetaMoneyline();
          if (mlCard) {
            const btn = clickBotonEquipoEnMoneyline(mlCard, cfg);
            if (btn) {
              btn.style.outline = "3px solid #10b981";
              await new Promise(r => setTimeout(r, 400));
              const resVerif = await verificarYPrepararPanelDerecho(cfg);
              if (resVerif.ok) {
                completado = true;
                centavosFinales = resVerif.centavosVivos || 0;
                break;
              } else if (resVerif.motivo && resVerif.motivo !== "no_verificado") {
                motivoAborto = resVerif.motivo;
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
              await new Promise(r => setTimeout(r, 400));
              const resVerif = await verificarYPrepararPanelDerecho(cfg);
              if (resVerif.ok) {
                completado = true;
                centavosFinales = resVerif.centavosVivos || 0;
                break;
              } else if (resVerif.motivo && resVerif.motivo !== "no_verificado") {
                motivoAborto = resVerif.motivo;
                break;
              }
            }
          }
        }

        await new Promise(r => setTimeout(r, 420));
      }

      try { sessionStorage.removeItem(POLY_STORAGE_KEY); } catch (e) {}

      if (motivoAborto) {
        mostrarBannerPoly(`🛡️ Escudo Master saltó esta compra (${motivoAborto}).`, "#d97706");
        if (cfg.master) {
          reportarResultadoMaster({ ok: false, fatal: false, orderId: cfg.oid, accion: cfg.accion, error: motivoAborto });
        }
        return;
      }

      if (!completado) {
        const msgNo = `No apareció abierta la línea «${etiquetaMeta}» en Polymarket.`;
        mostrarBannerPoly(`⚠️ ${msgNo}`, "#d97706");
        if (cfg.master) {
          reportarResultadoMaster({ ok: false, fatal: false, orderId: cfg.oid, accion: cfg.accion, error: msgNo });
        }
        return;
      }

      if (cfg.master) {
        await confirmarOrdenAutomaticaMaster(cfg, etiquetaMeta, centavosFinales);
      } else if (cfg.accion === "SELL") {
        mostrarBannerPoly(`💰 ¡Modo VENDER listo en «${etiquetaMeta}»! Confirma la venta a la derecha.`, "#d97706");
      } else {
        mostrarBannerPoly(`✅ ¡Listo! «${etiquetaMeta}» seleccionado${cfg.stake ? " con $" + cfg.stake : ""}. Dale al botón azul.`, "#059669");
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
