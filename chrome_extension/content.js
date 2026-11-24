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

    // Si no viene en el hash (ej. tras redirección de idioma o salto al Partido 2/3/4 del Combo), revisar sessionStorage
    try {
      const savedCombo = sessionStorage.getItem(COMBO_STORAGE_KEY);
      if (savedCombo) {
        const parsedCombo = JSON.parse(savedCombo);
        if (parsedCombo && parsedCombo.active && (Date.now() - (parsedCombo.updatedAt || 0) < 65000)) {
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

  // Capturar de inmediato al iniciar la carga del documento
  capturarEstadoInicial();

  // ===========================================================================
  // 2. UTILIDADES DOM PROFUNDO (ATRAVIESA SHADOW DOM DE BETBY / #betby)
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

  function setReactInputValue(inputEl, val) {
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
    if (nativeSetter) {
      nativeSetter.call(inputEl, String(val));
    } else {
      inputEl.value = String(val);
    }
    inputEl.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    inputEl.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
    inputEl.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, composed: true }));
  }

  function simularClickReal(el) {
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

  function limpiarCuponAnterior() {
    const removeBtns = querySelectorAllDeep('[data-editor-id="betslipSelectionRemoveButton"], [data-cy="ic-delete"]');
    removeBtns.forEach(btn => {
      try { simularClickReal(btn); } catch (e) {}
    });
  }

  function abrirBetslipSiEstaCerrado() {
    const inputExistente = querySelectorDeep('[data-editor-id="betslipStakeInput"] input');
    if (inputExistente) return;

    const posiblesBarras = querySelectorAllDeep('[data-editor-id*="betslip"], [data-editor-id*="Betslip"], div, span, button');
    const barraBetslip = posiblesBarras.find(el => {
      const t = (el.textContent || "").trim().toLowerCase();
      return (t === "betslip" || t === "cupón de apuesta" || (t.startsWith("betslip") && !t.includes("quick"))) && el.children.length <= 5;
    });
    if (barraBetslip) {
      simularClickReal(barraBetslip);
    }
  }

  function seleccionarTabComboEnBetslip() {
    // En Betby el Betslip tiene pestañas: Single | Combo | System (o Simple | Combo / Combinada | Sistema)
    const candidatos = querySelectorAllDeep('[data-editor-id="betslipTab"], [data-editor-id*="betslip"] button, [data-editor-id*="betslip"] div, button, div[role="tab"]');
    const tabCombo = candidatos.find(el => {
      const t = (el.textContent || "").trim().toLowerCase();
      return (
        t === "combo" ||
        t === "combinada" ||
        t === "parlay" ||
        t === "múltiple" ||
        t.startsWith("combo ")
      ) && t.length <= 16 && el.children.length <= 3;
    });
    if (tabCombo) {
      simularClickReal(tabCombo);
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
      simularClickReal(tabTotals);
    }
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

  function leerCuotaDeBoton(plate) {
    if (!plate) return "";
    const oddEl = plate.querySelector('[data-editor-id="marketCardOutcomeOdds"]') || plate.lastElementChild;
    return (oddEl ? oddEl.textContent : "").trim();
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
              return esOver ? matchingLine[0] : matchingLine[1];
            }
            if (matchingLine.length === 1) {
              return matchingLine[0];
            }
          }

          if (cardPlates.length >= 2) {
            return esOver ? cardPlates[0] : cardPlates[1];
          }
        }
      }

      if (lineaBuscada) {
        const matchingAll = plates.filter(p => {
          const nameEl = p.querySelector('[data-editor-id="marketCardOutcomeName"]');
          const nameTxt = (nameEl ? nameEl.textContent : "").trim().toLowerCase();
          return (
            nameTxt === lineaBuscada ||
            nameTxt.includes(`over ${lineaBuscada}`) ||
            nameTxt.includes(`under ${lineaBuscada}`) ||
            nameTxt.includes(`más de ${lineaBuscada}`) ||
            nameTxt.includes(`menos de ${lineaBuscada}`)
          );
        });
        if (matchingAll.length >= 2) {
          return esOver ? matchingAll[0] : matchingAll[1];
        }
        if (matchingAll.length === 1) {
          return matchingAll[0];
        }
      }
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
        hText === "ganador del partido" ||
        hText.includes("winner") ||
        hText.includes("ganador")
      );
      if (!esWinner) continue;

      const cardPlates = Array.from(card.querySelectorAll('div[data-editor-id="outcomePlate"]'));
      if (cardPlates.length >= 2) {
        const byNum = cardPlates.find(p => {
          const nameEl = p.querySelector('[data-editor-id="marketCardOutcomeName"]');
          const t = (nameEl ? nameEl.textContent : "").trim();
          return t === targetNumTxt;
        });
        if (byNum) return byNum;

        return posJugador === 1 ? cardPlates[0] : cardPlates[cardPlates.length - 1];
      }
    }

    const boton1o2 = plates.find(p => {
      const nameEl = p.querySelector('[data-editor-id="marketCardOutcomeName"]');
      const t = (nameEl ? nameEl.textContent : "").trim();
      return t === targetNumTxt;
    });
    if (boton1o2) return boton1o2;

    if (cfg.equipo) {
      const cleanTarget = cfg.equipo.split("(")[0].trim().toLowerCase();
      for (const p of plates) {
        const nameEl = p.querySelector('[data-editor-id="marketCardOutcomeName"]');
        const nameTxt = (nameEl ? nameEl.textContent : "").trim().toLowerCase();
        if (nameTxt && cleanTarget.length >= 3 && (nameTxt.includes(cleanTarget) || cleanTarget.includes(nameTxt))) {
          return p;
        }
      }
    }

    return null;
  }

  function construirUrlPartidoEnMismoIdioma(relPath) {
    let pathAjustado = relPath || "";
    // Si el usuario tiene BC.GAME en inglés (/sports/...), evitar pasar por /es/sports/... para que cargue el doble de rápido
    if ((window.location.pathname || "").startsWith("/sports/") && pathAjustado.startsWith("/es/sports/")) {
      pathAjustado = pathAjustado.replace(/^\/es\/sports\//, "/sports/");
    }
    return new URL(pathAjustado, window.location.origin).href;
  }

  // ===========================================================================
  // 3. FLUJO DE ARMADO DE COMBO (2, 3, 4, 5 JUGADAS -> DEJA LISTO EN PLACE BET)
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

    // Verificar que estemos en la URL del partido actual (por si BC redirigió al lobby)
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

    const numJugadaHumana = state.addedCount + 1;
    mostrarBannerEstado(
      `🔥 Armando Combo (${numJugadaHumana} de ${state.targetCount}): Buscando «${cfgPaso.equipo || ("Línea " + cfgPaso.linea)}»...`,
      "#7c3aed",
      true
    );

    let botonCuota = null;
    for (let i = 0; i < 28; i++) {
      // Verificar si el usuario presionó "Detener"
      if (!sessionStorage.getItem(COMBO_STORAGE_KEY)) return;

      botonCuota = buscarBotonCuota(cfgPaso);
      if (botonCuota) break;

      if ((i === 6 || i === 14) && (cfgPaso.tipo === "OVER" || cfgPaso.tipo === "UNDER" || cfgPaso.outid === "12" || cfgPaso.outid === "13")) {
        abrirTabTotalsSiExiste();
      }
      await new Promise(r => setTimeout(r, 380));
    }

    if (botonCuota) {
      // SOLO en la primera jugada del combo limpiamos selecciones viejas del Betslip
      if (state.addedCount === 0) {
        limpiarCuponAnterior();
        await new Promise(r => setTimeout(r, 350));
      }

      const yaEstabaActiva = botonCuota.getAttribute("data-active") === "true";
      if (!yaEstabaActiva) {
        botonCuota.style.outline = "3px solid #fbbf24";
        simularClickReal(botonCuota);
        // Confirmar que Betby marcó la selección (reintento suave si seguía hidratando)
        await new Promise(r => setTimeout(r, 550));
        if (botonCuota.getAttribute("data-active") !== "true") {
          try { botonCuota.click(); } catch (e) {}
          await new Promise(r => setTimeout(r, 400));
        }
      }

      state.addedCount += 1;
      const cuotaLeida = leerCuotaDeBoton(botonCuota);
      mostrarBannerEstado(
        `✅ Jugada ${state.addedCount}/${state.targetCount} agregada${cuotaLeida ? " (Cuota " + cuotaLeida + ")" : ""}!`,
        "#059669",
        true
      );
    } else {
      mostrarBannerEstado(
        `⚡ Esa línea cerró en vivo, saltando a la siguiente opción del Combo...`,
        "#d97706",
        true
      );
      await new Promise(r => setTimeout(r, 450));
    }

    // ¿Faltan más jugadas para completar la cantidad pedida y quedan partidos en la cola?
    if (state.addedCount < state.targetCount && state.currentIndex + 1 < state.items.length) {
      state.currentIndex += 1;
      state.updatedAt = Date.now();
      sessionStorage.setItem(COMBO_STORAGE_KEY, JSON.stringify(state));
      await new Promise(r => setTimeout(r, 550));
      const nextItem = state.items[state.currentIndex];
      window.location.href = construirUrlPartidoEnMismoIdioma(nextItem.u);
      return;
    }

    // =========================================================================
    // FINAL DEL COMBO: ABRIR BETSLIP -> PESTAÑA COMBO -> PONER MONTO -> NO PULSAR PLACE BET
    // =========================================================================
    try { sessionStorage.removeItem(COMBO_STORAGE_KEY); } catch (e) {}

    mostrarBannerEstado(
      `🔥 ¡${state.addedCount} jugadas cargadas! Abriendo pestaña «Combo» y colocando $${state.stake}...`,
      "#059669",
      false
    );

    // 1. Abrir Betslip si está contraído abajo a la derecha
    for (let i = 0; i < 16; i++) {
      abrirBetslipSiEstaCerrado();
      await new Promise(r => setTimeout(r, 320));
      const inp = querySelectorDeep('[data-editor-id="betslipStakeInput"] input') || querySelectorDeep('input[inputmode="decimal"]');
      if (inp) break;
    }

    // 2. Asegurar que esté seleccionada la pestaña "Combo" (y no "Single")
    seleccionarTabComboEnBetslip();
    await new Promise(r => setTimeout(r, 500));

    // 3. Escribir el monto del Combo en el input de apuesta
    const inputsStake = querySelectorAllDeep('[data-editor-id="betslipStakeInput"] input, input[inputmode="decimal"]');
    const inputCombo = inputsStake.length > 0 ? inputsStake[0] : null;
    if (inputCombo) {
      inputCombo.focus();
      setReactInputValue(inputCombo, state.stake);
      await new Promise(r => setTimeout(r, 400));
    }

    // 4. Resaltar el botón "Place Bet / Realizar apuesta" SIN hacerle clic (para que el usuario solo dé Place)
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
      btnApostar.style.boxShadow = "0 0 22px rgba(251, 191, 36, 0.85)";
    }

    mostrarBannerEstado(
      `🏆 ¡Combo de ${state.addedCount} jugadas listo con $${state.stake}! Solo revisa el cupón abajo a la derecha y dale a «Place Bet».`,
      "#047857",
      false
    );
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

    mostrarBannerEstado(`Buscando cuota en vivo para «${descJugada}» ($${cfg.stake})...`, "#047857");

    let botonCuota = null;
    for (let i = 0; i < 40; i++) {
      botonCuota = buscarBotonCuota(cfg);
      if (botonCuota) break;

      if ((i === 8 || i === 16) && (cfg.tipo === "OVER" || cfg.tipo === "UNDER" || cfg.outid === "12" || cfg.outid === "13")) {
        abrirTabTotalsSiExiste();
      }
      await new Promise(r => setTimeout(r, 400));
    }

    if (!botonCuota) {
      mostrarBannerEstado(`El mercado «${descJugada}» ya cerró en este partido. Elige otro disponible.`, "#b45309");
      return;
    }

    try { sessionStorage.removeItem(SINGLE_STORAGE_KEY); } catch (e) {}

    const cuotaActualEnVivo = leerCuotaDeBoton(botonCuota);
    const txtCuotaVivo = cuotaActualEnVivo ? ` (Cuota actual en vivo: ${cuotaActualEnVivo})` : "";

    const yaActivo = botonCuota.getAttribute("data-active") === "true";
    if (!yaActivo) {
      limpiarCuponAnterior();
      await new Promise(r => setTimeout(r, 220));
      botonCuota.style.outline = "3px solid #10b981";
      simularClickReal(botonCuota);
    }

    mostrarBannerEstado(`Cuota marcada${txtCuotaVivo}. Colocando $${cfg.stake} en el Betslip...`, "#059669");

    let inputStake = null;
    for (let i = 0; i < 25; i++) {
      inputStake =
        querySelectorDeep('[data-editor-id="betslipStakeInput"] input') ||
        querySelectorDeep('input[inputmode="decimal"]');
      if (inputStake) break;
      if (i === 2 || i === 6 || i === 12 || i === 18) {
        abrirBetslipSiEstaCerrado();
      }
      await new Promise(r => setTimeout(r, 300));
    }

    if (!inputStake) {
      mostrarBannerEstado(`✅ Cuota marcada${txtCuotaVivo}. Haz clic en "Betslip" abajo a la derecha para confirmar $${cfg.stake}.`, "#0284c7");
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
        simularClickReal(btnApostar);
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
