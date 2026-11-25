(function () {
  "use strict";

  const SINGLE_STORAGE_KEY = "polyedge_autobet_active_cfg";
  const COMBO_STORAGE_KEY = "polyedge_combo_active_state";

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

      if (params.get("polyedge_auto") === "1") {
        try { sessionStorage.removeItem(COMBO_STORAGE_KEY); } catch (e) {}
        const singleCfg = {
          ts: Date.now(),
          tipo: (params.get("tipo") || "").toUpperCase(),
          linea: (params.get("linea") || "").trim(),
          outid: (params.get("outid") || "").trim(),
          spec: (params.get("spec") || "").trim(),
          cuota: parseFloat(params.get("cuota") || "0") || 0,
          contra: params.get("contra") === "1",
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
    banner.innerHTML = `<span>🛡️ <b>PolyEdge:</b> ${texto}</span>`;

    if (mostrarCancelarCombo) {
      const btnCancel = document.createElement("button");
      btnCancel.textContent = "✕ Detener";
      btnCancel.style.cssText = "background:rgba(0,0,0,0.35);border:1px solid rgba(255,255,255,0.4);color:#fff;padding:4px 9px;border-radius:7px;font-size:12px;cursor:pointer;font-weight:700;";
      btnCancel.onclick = () => {
        try { sessionStorage.removeItem(COMBO_STORAGE_KEY); } catch (e) {}
        banner.style.background = "#4b5563";
        banner.innerHTML = `<span>⏹️ <b>PolyEdge:</b> Operación detenida por el usuario.</span>`;
      };
      banner.appendChild(btnCancel);
    }
  }

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

  // ESCUDO PROTECTOR DE CUOTA: jamás permite entrar si la cuota cayó a miseria (<1.22) o si disparó el riesgo demasiado
  function pasaEscudoDeCuota(plate, cfg) {
    if (!plate) return { ok: false, motivo: "candado" };
    const kViva = parseFloat(leerCuotaDeBoton(plate));
    if (isNaN(kViva) || kViva <= 1.01) {
      return { ok: false, motivo: "candado" };
    }
    const kEsp = parseFloat(cfg.cuota || 0);
    if (cfg.contra || kEsp >= 1.80) {
      // Modo Contra-Cebo (~2.05x): exigir que pague mínimo 1.80 y no se haya disparado a >2.60
      if (kViva < 1.80 || kViva > 2.65) {
        return { ok: false, motivo: `cuota fuera de rango Contra-Cebo (${kViva})` };
      }
      return { ok: true, kViva };
    }
    // Modo Francotirador: prohibir cuotas basura <1.22 y prohibir saltos bruscos de riesgo (>1.58 o +0.22 sobre la esperada)
    const topeMax = kEsp > 0 ? Math.min(kEsp + 0.20, 1.58) : 1.56;
    if (kViva < 1.22) {
      return { ok: false, motivo: `cuota bajó demasiado (${kViva} paga muy poco)` };
    }
    if (kViva > topeMax) {
      return { ok: false, motivo: `cuota subió a zona de riesgo (${kViva})` };
    }
    return { ok: true, kViva };
  }

  // BÚSQUEDA ESTRICTA SIN SALTO DE LÍNEA (NUNCA CAMBIA 2.5 POR 3.5 NI AGARRA TOTAL DE 1ª MITAD O EQUIPO)
  function buscarBotonCuotaEstricto(cfg) {
    const plates = querySelectorAllDeep('div[data-editor-id="outcomePlate"]');
    if (plates.length === 0) return { btn: null, motivoRechazo: "" };

    const marketCards = querySelectorAllDeep('div[data-editor-id="marketCard"]');
    let ultimoMotivo = "";

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
      if (!lineaBuscada) return { btn: null, motivoRechazo: "sin línea exacta" };

      for (const card of marketCards) {
        const header = card.querySelector('div[data-editor-id="marketCardHeader"]');
        const hText = (header ? header.textContent : "").trim().toLowerCase();
        // Solo aceptar la tarjeta de Total principal del partido (NO half total, NO team total)
        const esTotalPrincipal = (
          hText === "total" ||
          hText === "total (incl. overtime)" ||
          hText === "total (prórroga incl.)" ||
          hText === "total (incl. prórroga)" ||
          hText === "over/under" ||
          hText === "más/menos" ||
          hText === "total goals" ||
          hText === "total de goles"
        );
        if (!esTotalPrincipal) continue;

        const cardPlates = Array.from(card.querySelectorAll('div[data-editor-id="outcomePlate"]'));
        // COINCIDENCIA 100% EXACTA DE LA LÍNEA (JAMÁS SALTAR A OTRA FILA)
        const matchingLine = cardPlates.filter(p => {
          const nameEl = p.querySelector('[data-editor-id="marketCardOutcomeName"]');
          const nameTxt = (nameEl ? nameEl.textContent : "").trim().toLowerCase();
          return (
            nameTxt === lineaBuscada ||
            nameTxt === `(${lineaBuscada})` ||
            nameTxt === `over ${lineaBuscada}` ||
            nameTxt === `under ${lineaBuscada}` ||
            nameTxt === `más de ${lineaBuscada}` ||
            nameTxt === `menos de ${lineaBuscada}`
          );
        });

        if (matchingLine.length >= 2) {
          const candidato = esOver ? matchingLine[0] : matchingLine[1];
          const evalEscudo = pasaEscudoDeCuota(candidato, cfg);
          if (evalEscudo.ok) return { btn: candidato, motivoRechazo: "" };
          ultimoMotivo = evalEscudo.motivo;
        }
      }
      return { btn: null, motivoRechazo: ultimoMotivo };
    }

    return { btn: null, motivoRechazo: ultimoMotivo };
  }

  function construirUrlPartidoEnMismoIdioma(relPath) {
    let pathAjustado = relPath || "";
    if ((window.location.pathname || "").startsWith("/sports/") && pathAjustado.startsWith("/es/sports/")) {
      pathAjustado = pathAjustado.replace(/^\/es\/sports\//, "/sports/");
    }
    return new URL(pathAjustado, window.location.origin).href;
  }

  // ===========================================================================
  // FLUJO COMBO CON ESCUDO PROTECTOR
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
      cuota: parseFloat(itemActual.k || "0") || 0,
      equipo: (itemActual.e || "").trim()
    };

    const numIntentoHumano = Math.min(state.addedCount + 1, state.targetCount);
    mostrarBannerEstado(
      `🔥 Armando Combo Seguro (${numIntentoHumano}/${state.targetCount}): Verificando «${cfgPaso.equipo || ("Línea " + cfgPaso.linea)}»...`,
      "#7c3aed",
      true
    );

    let botonCuota = null;
    for (let i = 0; i < 20; i++) {
      if (!sessionStorage.getItem(COMBO_STORAGE_KEY)) return;
      const res = buscarBotonCuotaEstricto(cfgPaso);
      if (res.btn) {
        botonCuota = res.btn;
        break;
      }
      if (i === 5 || i === 12) abrirTabTotalsSiExiste();
      await new Promise(r => setTimeout(r, 380));
    }

    if (botonCuota) {
      if (state.addedCount === 0) {
        await vaciarBetslipPorCompleto();
        await new Promise(r => setTimeout(r, 350));
      } else {
        abrirBetslipSiEstaCerrado();
        await new Promise(r => setTimeout(r, 200));
      }

      const conteoAntes = contarSeleccionesRealesEnBetslip();
      if (botonCuota.getAttribute("data-active") !== "true") {
        botonCuota.style.outline = "3px solid #fbbf24";
        clickElemento(botonCuota);
      }

      let confirmada = false;
      for (let w = 0; w < 10; w++) {
        await new Promise(r => setTimeout(r, 250));
        if (botonCuota.getAttribute("data-active") === "true" || contarSeleccionesRealesEnBetslip() > conteoAntes) {
          confirmada = true;
          break;
        }
      }

      if (confirmada) {
        await new Promise(r => setTimeout(r, 750));
        limpiarSeleccionesBloqueadasEnBetslip();
        const conteoVerif = contarSeleccionesRealesEnBetslip();
        state.addedCount = conteoVerif > 0 ? conteoVerif : (state.addedCount + 1);
      }
    } else {
      mostrarBannerEstado(
        `🛡️ Escudo descartó esa línea (cambió en vivo o tenía candado), pasando al respaldo...`,
        "#d97706",
        true
      );
      await new Promise(r => setTimeout(r, 400));
    }

    abrirBetslipSiEstaCerrado();
    await new Promise(r => setTimeout(r, 350));
    limpiarSeleccionesBloqueadasEnBetslip();
    const realesEnCupon = contarSeleccionesRealesEnBetslip();
    if (realesEnCupon > 0) state.addedCount = realesEnCupon;

    if (state.addedCount < state.targetCount && state.currentIndex + 1 < state.items.length) {
      state.currentIndex += 1;
      state.updatedAt = Date.now();
      sessionStorage.setItem(COMBO_STORAGE_KEY, JSON.stringify(state));
      await new Promise(r => setTimeout(r, 450));
      window.location.href = construirUrlPartidoEnMismoIdioma(state.items[state.currentIndex].u);
      return;
    }

    try { sessionStorage.removeItem(COMBO_STORAGE_KEY); } catch (e) {}

    for (let i = 0; i < 15; i++) {
      abrirBetslipSiEstaCerrado();
      await new Promise(r => setTimeout(r, 300));
      if (estaAbiertoElBetslip()) break;
    }

    seleccionarTabComboEnBetslip();
    await new Promise(r => setTimeout(r, 550));

    for (let intentoMonto = 0; intentoMonto < 3; intentoMonto++) {
      const inputsStake = querySelectorAllDeep('[data-editor-id="betslipStakeInput"] input, input[inputmode="decimal"]');
      const inputCombo = inputsStake.length > 0 ? inputsStake[0] : null;
      if (inputCombo) {
        inputCombo.focus();
        setReactInputValue(inputCombo, state.stake);
        await new Promise(r => setTimeout(r, 350));
        if (String(inputCombo.value).trim() === String(state.stake).trim()) break;
      } else {
        abrirBetslipSiEstaCerrado();
        seleccionarTabComboEnBetslip();
        await new Promise(r => setTimeout(r, 350));
      }
    }

    const totalFinalReal = contarSeleccionesRealesEnBetslip() || state.addedCount;
    const posiblesBotones = querySelectorAllDeep('button[data-editor-id="betslipPlaceBetButton"], button');
    const btnApostar = posiblesBotones.find(b => {
      const idEd = b.getAttribute("data-editor-id") || "";
      const txt = (b.textContent || "").trim().toLowerCase();
      return idEd === "betslipPlaceBetButton" || txt.includes("place bet") || txt.includes("realizar apuesta");
    });

    if (btnApostar) {
      btnApostar.style.outline = "4px solid #fbbf24";
      btnApostar.style.boxShadow = "0 0 22px rgba(251, 191, 36, 0.9)";
    }

    mostrarBannerEstado(
      `🏆 ¡Combo verificado (${totalFinalReal} jugadas) con $${state.stake}! Revisa la cuota y dale a «Place Bet».`,
      "#047857",
      false
    );
  }

  // ===========================================================================
  // FLUJO INDIVIDUAL CON ESCUDO PROTECTOR DE SALDO (CANCELA SI LA LÍNEA SALTÓ)
  // ===========================================================================
  async function ejecutarIndividual(cfg) {
    while (!document.body) {
      await new Promise(r => setTimeout(r, 100));
    }

    const descJugada = cfg.linea
      ? `${(cfg.tipo === "OVER" || cfg.outid === "12") ? "Over / Más de" : "Under / Menos de"} ${cfg.linea}`
      : (cfg.equipo || "Seleccionada");

    mostrarBannerEstado(`Verificando línea exacta «${descJugada}» con Escudo Protector...`, "#047857");

    let botonCuota = null;
    let motivoBloqueo = "";
    for (let i = 0; i < 30; i++) {
      const res = buscarBotonCuotaEstricto(cfg);
      if (res.btn) {
        botonCuota = res.btn;
        break;
      }
      if (res.motivoRechazo) motivoBloqueo = res.motivoRechazo;
      if (i === 6 || i === 14) abrirTabTotalsSiExiste();
      await new Promise(r => setTimeout(r, 400));
    }

    try { sessionStorage.removeItem(SINGLE_STORAGE_KEY); } catch (e) {}

    if (!botonCuota) {
      const detalle = motivoBloqueo && motivoBloqueo !== "candado"
        ? `(${motivoBloqueo})`
        : "(la línea exacta cerró o se puso candado)";
      mostrarBannerEstado(
        `🛡️ Apuesta CANCELADA para proteger tu saldo: «${descJugada}» ya no es segura ${detalle}. ¡No se metió dinero!`,
        "#b45309"
      );
      return;
    }

    const cuotaActualEnVivo = leerCuotaDeBoton(botonCuota);
    const txtCuotaVivo = cuotaActualEnVivo ? ` (Cuota verificada: ${cuotaActualEnVivo})` : "";

    if (botonCuota.getAttribute("data-active") !== "true") {
      await vaciarBetslipPorCompleto();
      await new Promise(r => setTimeout(r, 220));
      botonCuota.style.outline = "3px solid #10b981";
      clickElemento(botonCuota);
    }

    mostrarBannerEstado(`Línea segura verificada${txtCuotaVivo}. Colocando $${cfg.stake}...`, "#059669");

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
      mostrarBannerEstado(`✅ Cuota marcada${txtCuotaVivo}. Abre el Betslip para confirmar $${cfg.stake}.`, "#0284c7");
      return;
    }

    inputStake.focus();
    setReactInputValue(inputStake, cfg.stake);
    await new Promise(r => setTimeout(r, 450));

    const btnLogin = querySelectorDeep('button[data-editor-id="betSlipLoginButton"]');
    if (btnLogin) {
      mostrarBannerEstado(`¡Boleto listo con $${cfg.stake}${txtCuotaVivo}! Inicia sesión en BC.GAME.`, "#d97706");
      return;
    }

    if (cfg.autoconfirm) {
      const posiblesBotones = querySelectorAllDeep('button[data-editor-id="betslipPlaceBetButton"], button');
      const btnApostar = posiblesBotones.find(b => {
        const idEd = b.getAttribute("data-editor-id") || "";
        const txt = (b.textContent || "").trim().toLowerCase();
        return idEd === "betslipPlaceBetButton" || txt === "place bet" || txt === "realizar apuesta" || txt.includes("place bet") || txt.includes("realizar apuesta");
      });

      if (btnApostar && !btnApostar.disabled) {
        btnApostar.style.outline = "3px solid #34d399";
        clickElemento(btnApostar);
        mostrarBannerEstado(`✅ ¡Apuesta segura de $${cfg.stake} enviada${txtCuotaVivo}!`, "#059669");
        setTimeout(() => {
          const b = document.getElementById("polyedge-autobet-banner");
          if (b) b.style.opacity = "0.2";
        }, 6000);
        return;
      }
    }

    mostrarBannerEstado(`✅ ¡Boleto seguro preparado con $${cfg.stake}${txtCuotaVivo}!`, "#059669");
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
