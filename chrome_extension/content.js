(function () {
  "use strict";

  const SINGLE_STORAGE_KEY = "polyedge_autobet_active_cfg";
  const COMBO_STORAGE_KEY = "polyedge_combo_active_state";

  // ===========================================================================
  // 1. CAPTURA TEMPRANA DE PARÁMETROS (INDIVIDUAL Y COMBO) EN DOCUMENT_START
  // ===========================================================================
  function extraerRawParams() {
    const hash = window.location.hash || "";
    const search = window.location.search || "";
    if (hash.includes("polyedge_auto=1") || hash.includes("polyedge_combo=1")) {
      return hash.replace(/^#/, "");
    }
    if (search.includes("polyedge_auto=1") || search.includes("polyedge_combo=1")) {
      return search.replace(/^\?/, "");
    }
    return "";
  }

  function capturarEstadoInicial() {
    const raw = extraerRawParams();
    if (raw) {
      const params = new URLSearchParams(raw);

      // CASO A: COMBO MULTI-JUGADA (#polyedge_combo=1...)
      if (params.get("polyedge_combo") === "1") {
        const cid = params.get("cid") || String(Date.now());
        try {
          sessionStorage.removeItem(SINGLE_STORAGE_KEY);
          const prevRaw = sessionStorage.getItem(COMBO_STORAGE_KEY);
          if (prevRaw) {
            const prev = JSON.parse(prevRaw);
            if (prev && prev.cid === cid && prev.active) {
              return { modo: "COMBO", state: prev };
            }
          }

          const qBase64 = params.get("q") || "";
          const jsonStr = decodeURIComponent(escape(atob(qBase64)));
          const items = JSON.parse(jsonStr);
          if (Array.isArray(items) && items.length >= 2) {
            const comboState = {
              active: true,
              cid: cid,
              updatedAt: Date.now(),
              targetCount: Math.max(2, parseInt(params.get("target") || "3", 10) || 3),
              addedCount: 0,
              currentIndex: 0,
              stake: (params.get("stake") || "2").trim(),
              items: items
            };
            sessionStorage.setItem(COMBO_STORAGE_KEY, JSON.stringify(comboState));
            return { modo: "COMBO", state: comboState };
          }
        } catch (e) {}
      }

      // CASO B: APUESTA INDIVIDUAL (#polyedge_auto=1...)
      if (params.get("polyedge_auto") === "1") {
        try { sessionStorage.removeItem(COMBO_STORAGE_KEY); } catch (e) {}
        const singleCfg = {
          ts: Date.now(),
          tipo: (params.get("tipo") || "").toUpperCase(),
          linea: (params.get("linea") || "").trim(),
          outid: (params.get("outid") || "").trim(),
          spec: (params.get("spec") || "").trim(),
          equipo: (params.get("equipo") || "").trim(),
          stake: (params.get("stake") || "1").trim(),
          autoconfirm: params.get("autoconfirm") === "1"
        };
        try {
          sessionStorage.setItem(SINGLE_STORAGE_KEY, JSON.stringify(singleCfg));
        } catch (e) {}
        return { modo: "SINGLE", cfg: singleCfg };
      }
    }

    try {
      const savedCombo = sessionStorage.getItem(COMBO_STORAGE_KEY);
      if (savedCombo) {
        const parsedCombo = JSON.parse(savedCombo);
        if (parsedCombo && parsedCombo.active && (Date.now() - (parsedCombo.updatedAt || 0) < 75000)) {
          return { modo: "COMBO", state: parsedCombo };
        }
      }
    } catch (e) {}

    try {
      const savedSingle = sessionStorage.getItem(SINGLE_STORAGE_KEY);
      if (savedSingle) {
        const parsedSingle = JSON.parse(savedSingle);
        if (parsedSingle && (Date.now() - (parsedSingle.ts || 0) < 35000)) {
          return { modo: "SINGLE", cfg: parsedSingle };
        }
      }
    } catch (e) {}

    return null;
  }

  capturarEstadoInicial();

  // ===========================================================================
  // 2. UTILIDADES DOM Y REACT (COMPATIBLE CON BETBY LIGHT DOM Y SHADOW DOM)
  // ===========================================================================
  function querySelectorAllDeep(selector, root = document) {
    const results = [];
    try {
      const direct = root.querySelectorAll(selector);
      for (let i = 0; i < direct.length; i++) {
        results.push(direct[i]);
      }
    } catch (e) {}

    let allNodes = [];
    try {
      allNodes = root.querySelectorAll("*");
    } catch (e) {}

    for (let i = 0; i < allNodes.length; i++) {
      const el = allNodes[i];
      if (el.shadowRoot) {
        const nested = querySelectorAllDeep(selector, el.shadowRoot);
        for (let j = 0; j < nested.length; j++) {
          results.push(nested[j]);
        }
      }
    }
    return results;
  }

  function querySelectorDeep(selector, root = document) {
    const all = querySelectorAllDeep(selector, root);
    return all.length > 0 ? all[0] : null;
  }

  function mostrarBannerEstado(texto, colorBg = "#059669", mostrarCancelarCombo = false) {
    if (!document.body) return;
    let banner = document.getElementById("polyedge-autobet-banner");
    if (!banner) {
      banner = document.createElement("div");
      banner.id = "polyedge-autobet-banner";
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
        "box-shadow: 0 10px 25px rgba(0,0,0,0.7)",
        "border: 2px solid #34d399",
        "display: flex",
        "align-items: center",
        "gap: 12px",
        "transition: all 0.25s ease",
        "max-width: 94vw"
      ].join(";");
      document.body.appendChild(banner);
    }
    banner.style.background = colorBg;
    banner.style.opacity = "1";
    banner.innerHTML = `<span>🤖 <b>PolyEdge:</b> ${texto}</span>`;

    if (mostrarCancelarCombo) {
      const btnCancel = document.createElement("button");
      btnCancel.textContent = "✕ Detener";
      btnCancel.style.cssText = "background:rgba(0,0,0,0.35);border:1px solid rgba(255,255,255,0.4);color:#fff;padding:4px 9px;border-radius:7px;font-size:12px;cursor:pointer;font-weight:700;";
      btnCancel.onclick = () => {
        try { sessionStorage.removeItem(COMBO_STORAGE_KEY); } catch (e) {}
        banner.style.background = "#4b5563";
        banner.innerHTML = `<span>⏹️ <b>PolyEdge:</b> Armado de Combo detenido por el usuario.</span>`;
      };
      banner.appendChild(btnCancel);
    }
  }

  // Setter especial para React 17/18 (_valueTracker) para que SIEMPRE reemplace el 0.50 por el monto elegido
  function setReactInputValue(inputEl, val) {
    if (!inputEl) return;
    const prevVal = inputEl.value;
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
    if (nativeSetter) {
      nativeSetter.call(inputEl, String(val));
    } else {
      inputEl.value = String(val);
    }
    const tracker = inputEl._valueTracker;
    if (tracker) {
      try { tracker.setValue(prevVal); } catch (e) {}
    }
    inputEl.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    inputEl.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
    inputEl.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, composed: true }));
  }

  function clickElemento(el) {
    if (!el) return;
    try {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    } catch (e) {}
    try {
      el.click();
    } catch (e) {
      const opts = { bubbles: true, cancelable: true, composed: true, view: window };
      el.dispatchEvent(new MouseEvent("click", opts));
    }
  }

  function estaAbiertoElBetslip() {
    const sel = querySelectorDeep('[data-editor-id="betslipSelection"]');
    const inp = querySelectorDeep('[data-editor-id="betslipStakeInput"] input');
    const del = querySelectorDeep('[data-cy="ic-delete"]');
    return Boolean(sel || inp || del);
  }

  function abrirBetslipSiEstaCerrado() {
    if (estaAbiertoElBetslip()) return true;

    // Buscar el texto "Betslip" o "Cupón de apuesta" en la barra flotante verde abajo a la derecha (sin tocar QUICK BET)
    const nodos = querySelectorAllDeep('div, span, button');
    for (const el of nodos) {
      const t = (el.textContent || "").replace(/\s+/g, " ").trim().toLowerCase();
      if (!t || t.includes("quick") || t.includes("rápida")) continue;
      const coincide = (
        t === "betslip" ||
        t === "cupón de apuesta" ||
        /^betslip\s*\d*$/.test(t) ||
        /^\d+\s*betslip$/.test(t) ||
        /^cupón de apuesta\s*\d*$/.test(t)
      );
      if (coincide && el.children.length <= 4) {
        // Hacer clic tanto en el elemento como en su contenedor izquierdo (sin incluir QUICK BET)
        clickElemento(el);
        const padre = el.parentElement;
        if (padre) {
          const tp = (padre.textContent || "").toLowerCase();
          if (!tp.includes("quick") && !tp.includes("rápida")) {
            try { padre.click(); } catch (e) {}
          }
        }
        return true;
      }
    }
    return false;
  }

  function contarSeleccionesRealesEnBetslip() {
    return querySelectorAllDeep('[data-editor-id="betslipSelection"]').length;
  }

  // Elimina del Betslip cualquier selección que se haya bloqueado/cerrado mientras se armaba el combo
  function limpiarSeleccionesBloqueadasEnBetslip() {
    let removidas = 0;
    const items = querySelectorAllDeep('[data-editor-id="betslipSelection"]');
    for (const item of items) {
      const oddEl = item.querySelector('[data-editor-id="betslipSelectionOdd"]');
      const oddVal = oddEl ? parseFloat((oddEl.textContent || "").replace(",", ".").trim()) : NaN;
      const textoItem = (item.textContent || "").toLowerCase();
      const bloqueada = (
        !oddEl ||
        isNaN(oddVal) ||
        oddVal <= 1.0 ||
        textoItem.includes("suspended") ||
        textoItem.includes("closed") ||
        textoItem.includes("suspendido") ||
        textoItem.includes("cerrado")
      );
      if (bloqueada) {
        const rmBtn = item.querySelector('[data-editor-id="betslipSelectionRemoveButton"]');
        if (rmBtn) {
          clickElemento(rmBtn);
          removidas += 1;
        }
      }
    }
    return removidas;
  }

  async function vaciarBetslipPorCompleto() {
    abrirBetslipSiEstaCerrado();
    await new Promise(r => setTimeout(r, 250));
    const trash = querySelectorDeep('[data-cy="ic-delete"]');
    if (trash) {
      clickElemento(trash);
      await new Promise(r => setTimeout(r, 250));
    }
    const removeBtns = querySelectorAllDeep('[data-editor-id="betslipSelectionRemoveButton"]');
    for (const btn of removeBtns) {
      clickElemento(btn);
      await new Promise(r => setTimeout(r, 120));
    }
  }

  function seleccionarTabComboEnBetslip() {
    const candidatos = querySelectorAllDeep('[data-editor-id="betslipTab"], [data-editor-id*="betslip"] button, [data-editor-id*="betslip"] div, button, div[role="tab"], span');
    const tabCombo = candidatos.find(el => {
      const t = (el.textContent || "").trim().toLowerCase();
      return (
        t === "combo" ||
        t === "combinada" ||
        t === "parlay" ||
        t === "múltiple"
      ) && el.children.length <= 2;
    });
    if (tabCombo) {
      clickElemento(tabCombo);
      if (tabCombo.parentElement && tabCombo.parentElement.children.length <= 3) {
        try { tabCombo.parentElement.click(); } catch (e) {}
      }
      return true;
    }
    return false;
  }

  function abrirTabTotalsSiExiste() {
    const pills = querySelectorAllDeep('[data-editor-id="tableMarketPill"], button, div');
    const tabTotals = pills.find(el => {
      const t = (el.textContent || "").trim().toLowerCase();
      return (t.startsWith("totals") || t.startsWith("totales")) && t.length <= 16 && el.children.length <= 3;
    });
    if (tabTotals) {
      clickElemento(tabTotals);
    }
  }

  function leerCuotaDeBoton(plate) {
    if (!plate) return "";
    // En Betby, el nombre está en marketCardOutcomeName y la cuota numérica está en el otro hijo / último span
    const nameEl = plate.querySelector('[data-editor-id="marketCardOutcomeName"]');
    const spans = Array.from(plate.querySelectorAll("span, div"));
    for (let i = spans.length - 1; i >= 0; i--) {
      const s = spans[i];
      if (nameEl && (s === nameEl || nameEl.contains(s))) continue;
      if (s.children.length === 0) {
        const txt = (s.textContent || "").trim().replace(",", ".");
        if (/^\d+(\.\d+)?$/.test(txt)) {
          return txt;
        }
      }
    }
    return "";
  }

  // CRÍTICO: Verifica que el botón NO tenga candado (que tenga una cuota numérica viva > 1.01)
  function esBotonDisponible(plate) {
    if (!plate) return false;
    const c = parseFloat(leerCuotaDeBoton(plate));
    return !isNaN(c) && c > 1.01;
  }

  function detectarPosicionJugador(cfg) {
    if (cfg.outid === "1" || cfg.outid === "4") return 1;
    if (cfg.outid === "3" || cfg.outid === "5") return 2;

    const nombreLimpio = (cfg.equipo || "").split("(")[0].trim().toLowerCase();
    if (!nombreLimpio) return 1;

    const pathSlug = (window.location.pathname || "").split("/").pop() || "";
    const partesNombre = nombreLimpio.replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(w => w.length >= 3);
    if (pathSlug && partesNombre.length > 0) {
      const idx = pathSlug.indexOf(partesNombre[0]);
      const mitad = Math.floor(pathSlug.length * 0.38);
      if (idx >= 0) {
        return idx < mitad ? 1 : 2;
      }
    }
    return 1;
  }

  function buscarBotonCuota(cfg) {
    const plates = querySelectorAllDeep('div[data-editor-id="outcomePlate"]');
    if (plates.length === 0) return null;

    const marketCards = querySelectorAllDeep('div[data-editor-id="marketCard"]');

    // 1. CASO OVER / UNDER (Más de / Menos de — outid 12 o 13)
    const esJugadaOU = (
      cfg.tipo === "OVER" ||
      cfg.tipo === "UNDER" ||
      cfg.outid === "12" ||
      cfg.outid === "13" ||
      /más de|menos de|\bover\b|\bunder\b/i.test(cfg.equipo || "")
    );

    if (esJugadaOU) {
      const esOver = (cfg.tipo === "OVER" || cfg.outid === "12" || /más de|\bover\b/i.test(cfg.equipo || ""));
      let lineaBuscada = cfg.linea;
      if (!lineaBuscada && cfg.equipo) {
        const mLin = cfg.equipo.match(/(\d+(?:\.\d+)?)/);
        if (mLin) lineaBuscada = mLin[1];
      }

      for (const card of marketCards) {
        const header = card.querySelector('div[data-editor-id="marketCardHeader"]');
        const hText = (header ? header.textContent : "").trim().toLowerCase();
        // Solo tarjetas de Total general del partido (evitando mitades cerradas si hay principal)
        if (hText.includes("total") || hText.includes("over/under") || hText.includes("más/menos")) {
          const cardPlates = Array.from(card.querySelectorAll('div[data-editor-id="outcomePlate"]'));
          if (lineaBuscada) {
            const matchingLine = cardPlates.filter(p => {
              const nameEl = p.querySelector('[data-editor-id="marketCardOutcomeName"]');
              const nameTxt = (nameEl ? nameEl.textContent : p.textContent || "").trim().toLowerCase();
              return (
                nameTxt === lineaBuscada ||
                nameTxt === `(${lineaBuscada})` ||
                nameTxt.includes(`over ${lineaBuscada}`) ||
                nameTxt.includes(`under ${lineaBuscada}`) ||
                nameTxt.includes(`más de ${lineaBuscada}`) ||
                nameTxt.includes(`menos de ${lineaBuscada}`)
              );
            });
            if (matchingLine.length >= 2) {
              const candidato = esOver ? matchingLine[0] : matchingLine[1];
              if (esBotonDisponible(candidato)) return candidato;
            }
            if (matchingLine.length === 1 && esBotonDisponible(matchingLine[0])) {
              return matchingLine[0];
            }
          }

          // Si la línea exacta se movió medio punto en vivo (ej. 2.5 -> 3.5), buscar la primera fila disponible (sin candado)
          for (let r = 0; r + 1 < cardPlates.length; r += 2) {
            const candFila = esOver ? cardPlates[r] : cardPlates[r + 1];
            if (esBotonDisponible(candFila)) {
              const cVal = parseFloat(leerCuotaDeBoton(candFila));
              if (cVal >= 1.08 && cVal <= 2.15) {
                return candFila;
              }
            }
          }
        }
      }
      return null;
    }

    // 2. CASO WINNER / GANADOR (Botones "1" y "2")
    const posJugador = detectarPosicionJugador(cfg);
    const targetNumTxt = posJugador === 1 ? "1" : "2";

    for (const card of marketCards) {
      const header = card.querySelector('div[data-editor-id="marketCardHeader"]');
      const hText = (header ? header.textContent : "").trim().toLowerCase();
      const esWinner = (
        hText === "winner" ||
        hText === "ganador" ||
        hText === "1x2" ||
        hText === "match winner" ||
        hText === "ganador del partido"
      );
      if (!esWinner) continue;

      const cardPlates = Array.from(card.querySelectorAll('div[data-editor-id="outcomePlate"]'));
      if (cardPlates.length >= 2) {
        const byNum = cardPlates.find(p => {
          const nameEl = p.querySelector('[data-editor-id="marketCardOutcomeName"]');
          const t = (nameEl ? nameEl.textContent : "").trim();
          return t === targetNumTxt;
        });
        if (byNum && esBotonDisponible(byNum)) return byNum;

        const posCand = posJugador === 1 ? cardPlates[0] : cardPlates[cardPlates.length - 1];
        if (esBotonDisponible(posCand)) return posCand;
      }
    }

    const boton1o2 = plates.find(p => {
      const nameEl = p.querySelector('[data-editor-id="marketCardOutcomeName"]');
      const t = (nameEl ? nameEl.textContent : "").trim();
      return t === targetNumTxt && esBotonDisponible(p);
    });
    if (boton1o2) return boton1o2;

    return null;
  }

  function construirUrlPartidoEnMismoIdioma(relPath) {
    let pathAjustado = relPath || "";
    if ((window.location.pathname || "").startsWith("/sports/") && pathAjustado.startsWith("/es/sports/")) {
      pathAjustado = pathAjustado.replace(/^\/es\/sports\//, "/sports/");
    }
    return new URL(pathAjustado, window.location.origin).href;
  }

  // ===========================================================================
  // 3. FLUJO DE ARMADO DE COMBO VERIFICADO (GARANTIZA N SELECCIONES REALES EN EL BETSLIP)
  // ===========================================================================
  async function ejecutarPasoCombo(state) {
    while (!document.body) {
      await new Promise(r => setTimeout(r, 100));
    }

    const itemActual = state.items[state.currentIndex];
    if (!itemActual) {
      try { sessionStorage.removeItem(COMBO_STORAGE_KEY); } catch (e) {}
      return;
    }

    const pathActual = window.location.pathname || "";
    if (itemActual.eid && !pathActual.includes(itemActual.eid)) {
      state.updatedAt = Date.now();
      sessionStorage.setItem(COMBO_STORAGE_KEY, JSON.stringify(state));
      window.location.href = construirUrlPartidoEnMismoIdioma(itemActual.u);
      return;
    }

    const cfgPaso = {
      tipo: (itemActual.t || "").toUpperCase(),
      linea: (itemActual.l || "").trim(),
      outid: (itemActual.o || "").trim(),
      equipo: (itemActual.e || "").trim()
    };

    const numIntentoHumano = Math.min(state.addedCount + 1, state.targetCount);
    mostrarBannerEstado(
      `🔥 Armando Combo (${numIntentoHumano} de ${state.targetCount}): Buscando cuota activa «${cfgPaso.equipo || ("Línea " + cfgPaso.linea)}»...`,
      "#7c3aed",
      true
    );

    // Esperar a que carguen las cuotas y verificar que el botón NO tenga candado
    let botonCuota = null;
    for (let i = 0; i < 22; i++) {
      if (!sessionStorage.getItem(COMBO_STORAGE_KEY)) return;
      botonCuota = buscarBotonCuota(cfgPaso);
      if (botonCuota) break;

      if ((i === 5 || i === 12) && (cfgPaso.tipo === "OVER" || cfgPaso.tipo === "UNDER" || cfgPaso.outid === "12" || cfgPaso.outid === "13")) {
        abrirTabTotalsSiExiste();
      }
      await new Promise(r => setTimeout(r, 380));
    }

    if (botonCuota) {
      // En la primera jugada del combo, abrir el Betslip y limpiarlo por completo primero
      if (state.addedCount === 0) {
        await vaciarBetslipPorCompleto();
        await new Promise(r => setTimeout(r, 350));
      } else {
        abrirBetslipSiEstaCerrado();
        await new Promise(r => setTimeout(r, 200));
      }

      const conteoAntes = contarSeleccionesRealesEnBetslip();
      const yaEstabaActiva = botonCuota.getAttribute("data-active") === "true";

      if (!yaEstabaActiva) {
        botonCuota.style.outline = "3px solid #fbbf24";
        clickElemento(botonCuota);
      }

      // Esperar hasta confirmar que data-active === "true" y que realmente entró al Betslip
      let confirmadaEnBetslip = false;
      for (let w = 0; w < 10; w++) {
        await new Promise(r => setTimeout(r, 250));
        const ahoraActiva = botonCuota.getAttribute("data-active") === "true";
        const conteoAhora = contarSeleccionesRealesEnBetslip();
        if (ahoraActiva || conteoAhora > conteoAntes) {
          confirmadaEnBetslip = true;
          break;
        }
      }

      if (confirmadaEnBetslip) {
        // Pausa extra de seguridad para que Betby guarde la selección en su localStorage antes de cambiar de página
        await new Promise(r => setTimeout(r, 750));
        limpiarSeleccionesBloqueadasEnBetslip();
        const conteoVerificado = contarSeleccionesRealesEnBetslip();
        state.addedCount = conteoVerificado > 0 ? conteoVerificado : (state.addedCount + 1);

        const cuotaLeida = leerCuotaDeBoton(botonCuota);
        mostrarBannerEstado(
          `✅ Jugada ${state.addedCount}/${state.targetCount} dentro del Betslip${cuotaLeida ? " (Cuota " + cuotaLeida + ")" : ""}!`,
          "#059669",
          true
        );
      } else {
        mostrarBannerEstado(
          `⚡ Esa cuota se bloqueó justo ahora, buscando el respaldo para completar tus ${state.targetCount}...`,
          "#d97706",
          true
        );
        await new Promise(r => setTimeout(r, 400));
      }
    } else {
      mostrarBannerEstado(
        `⚡ Partido bloqueado/cerrado en vivo, pasando al respaldo para completar tus ${state.targetCount}...`,
        "#d97706",
        true
      );
      await new Promise(r => setTimeout(r, 400));
    }

    // Antes de dar por terminado, verificar el conteo REAL dentro del Betslip
    abrirBetslipSiEstaCerrado();
    await new Promise(r => setTimeout(r, 350));
    limpiarSeleccionesBloqueadasEnBetslip();
    const realesEnCupon = contarSeleccionesRealesEnBetslip();
    if (realesEnCupon > 0) {
      state.addedCount = realesEnCupon;
    }

    // Si aún faltan jugadas para llegar a targetCount (ej. 3) y hay más partidos de respaldo en la cola, seguir al siguiente!
    if (state.addedCount < state.targetCount && state.currentIndex + 1 < state.items.length) {
      state.currentIndex += 1;
      state.updatedAt = Date.now();
      sessionStorage.setItem(COMBO_STORAGE_KEY, JSON.stringify(state));
      await new Promise(r => setTimeout(r, 450));
      const nextItem = state.items[state.currentIndex];
      window.location.href = construirUrlPartidoEnMismoIdioma(nextItem.u);
      return;
    }

    // =========================================================================
    // FINAL DEL COMBO: ABRIR BETSLIP -> PESTAÑA COMBO -> ESCRIBIR MONTO REAL -> RESALTAR PLACE BET
    // =========================================================================
    try { sessionStorage.removeItem(COMBO_STORAGE_KEY); } catch (e) {}

    // 1. Asegurar que el Betslip esté desplegado y visible
    for (let i = 0; i < 15; i++) {
      abrirBetslipSiEstaCerrado();
      await new Promise(r => setTimeout(r, 300));
      if (estaAbiertoElBetslip()) break;
    }

    // 2. Cambiar a la pestaña "Combo" (y no "Directa" / "Single")
    seleccionarTabComboEnBetslip();
    await new Promise(r => setTimeout(r, 550));

    // 3. Colocar el monto exacto ($5, $2, etc.) sobreescribiendo el 0.50 por defecto de BC.GAME
    for (let intentoMonto = 0; intentoMonto < 3; intentoMonto++) {
      const inputsStake = querySelectorAllDeep('[data-editor-id="betslipStakeInput"] input, input[inputmode="decimal"]');
      const inputCombo = inputsStake.length > 0 ? inputsStake[0] : null;
      if (inputCombo) {
        inputCombo.focus();
        setReactInputValue(inputCombo, state.stake);
        await new Promise(r => setTimeout(r, 350));
        if (String(inputCombo.value).trim() === String(state.stake).trim()) {
          break;
        }
      } else {
        abrirBetslipSiEstaCerrado();
        seleccionarTabComboEnBetslip();
        await new Promise(r => setTimeout(r, 350));
      }
    }

    const totalFinalReal = contarSeleccionesRealesEnBetslip() || state.addedCount;

    // 4. Resaltar el botón "Place Bet / Realizar apuesta" SIN hacerle clic
    const posiblesBotones = querySelectorAllDeep('button[data-editor-id="betslipPlaceBetButton"], button');
    const btnApostar = posiblesBotones.find(b => {
      const idEd = b.getAttribute("data-editor-id") || "";
      const txt = (b.textContent || "").trim().toLowerCase();
      if (idEd === "betslipPlaceBetButton") return true;
      return (
        txt === "place bet" ||
        txt === "realizar apuesta" ||
        txt.includes("place bet") ||
        txt.includes("realizar apuesta")
      );
    });

    if (btnApostar) {
      btnApostar.style.outline = "4px solid #fbbf24";
      btnApostar.style.boxShadow = "0 0 22px rgba(251, 191, 36, 0.9)";
    }

    if (totalFinalReal < state.targetCount) {
      mostrarBannerEstado(
        `⚠️ Atención: Cerraron líneas en vivo y quedaron ${totalFinalReal} de ${state.targetCount} jugadas en tu Betslip con $${state.stake}. Revísalo antes de dar a «Place Bet».`,
        "#d97706",
        false
      );
    } else {
      mostrarBannerEstado(
        `🏆 ¡Combo de ${totalFinalReal}/${state.targetCount} jugadas verificado en tu Betslip con $${state.stake}! Solo dale clic a «Place Bet».`,
        "#047857",
        false
      );
    }
  }

  // ===========================================================================
  // 4. FLUJO DE APUESTA INDIVIDUAL (1 JUGADA)
  // ===========================================================================
  async function ejecutarIndividual(cfg) {
    while (!document.body) {
      await new Promise(r => setTimeout(r, 100));
    }

    const descJugada = cfg.linea
      ? `${(cfg.tipo === "OVER" || cfg.outid === "12") ? "Over / Más de" : "Under / Menos de"} ${cfg.linea}`
      : (cfg.equipo || "Seleccionada");

    mostrarBannerEstado(`Buscando cuota activa para «${descJugada}» ($${cfg.stake})...`, "#047857");

    let botonCuota = null;
    for (let i = 0; i < 35; i++) {
      botonCuota = buscarBotonCuota(cfg);
      if (botonCuota) break;

      if ((i === 7 || i === 15) && (cfg.tipo === "OVER" || cfg.tipo === "UNDER" || cfg.outid === "12" || cfg.outid === "13")) {
        abrirTabTotalsSiExiste();
      }
      await new Promise(r => setTimeout(r, 400));
    }

    if (!botonCuota) {
      mostrarBannerEstado(`El mercado «${descJugada}» ya cerró o está bloqueado con candado. Elige otro disponible.`, "#b45309");
      return;
    }

    try { sessionStorage.removeItem(SINGLE_STORAGE_KEY); } catch (e) {}

    const cuotaActualEnVivo = leerCuotaDeBoton(botonCuota);
    const txtCuotaVivo = cuotaActualEnVivo ? ` (Cuota actual en vivo: ${cuotaActualEnVivo})` : "";

    const yaActivo = botonCuota.getAttribute("data-active") === "true";
    if (!yaActivo) {
      await vaciarBetslipPorCompleto();
      await new Promise(r => setTimeout(r, 220));
      botonCuota.style.outline = "3px solid #10b981";
      clickElemento(botonCuota);
    }

    mostrarBannerEstado(`Cuota marcada${txtCuotaVivo}. Colocando $${cfg.stake} en el Betslip...`, "#059669");

    let inputStake = null;
    for (let i = 0; i < 25; i++) {
      abrirBetslipSiEstaCerrado();
      inputStake =
        querySelectorDeep('[data-editor-id="betslipStakeInput"] input') ||
        querySelectorDeep('input[inputmode="decimal"]');
      if (inputStake) break;
      await new Promise(r => setTimeout(r, 300));
    }

    if (!inputStake) {
      mostrarBannerEstado(`✅ Cuota marcada${txtCuotaVivo}. Abre el Betslip abajo a la derecha para confirmar $${cfg.stake}.`, "#0284c7");
      return;
    }

    inputStake.focus();
    setReactInputValue(inputStake, cfg.stake);
    await new Promise(r => setTimeout(r, 450));

    const btnLogin = querySelectorDeep('button[data-editor-id="betSlipLoginButton"]');
    if (btnLogin) {
      mostrarBannerEstado(`¡Boleto listo con $${cfg.stake}${txtCuotaVivo}! Inicia sesión en BC.GAME para confirmar.`, "#d97706");
      return;
    }

    if (cfg.autoconfirm) {
      const posiblesBotones = querySelectorAllDeep('button[data-editor-id="betslipPlaceBetButton"], button');
      const btnApostar = posiblesBotones.find(b => {
        const idEd = b.getAttribute("data-editor-id") || "";
        const txt = (b.textContent || "").trim().toLowerCase();
        if (idEd === "betslipPlaceBetButton") return true;
        return (
          txt === "place bet" ||
          txt === "realizar apuesta" ||
          txt === "apostar" ||
          txt.includes("place bet") ||
          txt.includes("realizar apuesta") ||
          txt.includes("accept all odds") ||
          txt.includes("aceptar")
        );
      });

      if (btnApostar && !btnApostar.disabled) {
        btnApostar.style.outline = "3px solid #34d399";
        clickElemento(btnApostar);
        mostrarBannerEstado(`✅ ¡Apuesta individual de $${cfg.stake} enviada${txtCuotaVivo}!`, "#059669");
        setTimeout(() => {
          const b = document.getElementById("polyedge-autobet-banner");
          if (b) b.style.opacity = "0.2";
        }, 6000);
        return;
      }
    }

    mostrarBannerEstado(`✅ ¡Boleto individual preparado con $${cfg.stake}${txtCuotaVivo}! Listo en tu Betslip.`, "#059669");
  }

  let ejecucionEnCurso = false;

  async function iniciarOrquestador() {
    if (ejecucionEnCurso) return;
    const accion = capturarEstadoInicial();
    if (!accion) return;

    ejecucionEnCurso = true;
    try {
      if (accion.modo === "COMBO") {
        await ejecutarPasoCombo(accion.state);
      } else if (accion.modo === "SINGLE") {
        await ejecutarIndividual(accion.cfg);
      }
    } finally {
      ejecucionEnCurso = false;
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => setTimeout(iniciarOrquestador, 550));
  } else {
    setTimeout(iniciarOrquestador, 550);
  }
  window.addEventListener("hashchange", () => setTimeout(iniciarOrquestador, 300));
})();
