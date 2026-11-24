(function () {
  "use strict";

  const STORAGE_KEY = "polyedge_autobet_active_cfg";

  // 1. Capturar parámetros inmediatamente (incluso antes de que playbc.fun redireccione de /es/sports a /sports)
  function capturarYGuardarParams() {
    const hash = window.location.hash || "";
    const search = window.location.search || "";
    const raw = hash.includes("polyedge_auto=1")
      ? hash.replace(/^#/, "")
      : (search.includes("polyedge_auto=1") ? search.replace(/^\?/, "") : "");

    if (raw) {
      const params = new URLSearchParams(raw);
      if (params.get("polyedge_auto") === "1") {
        const cfg = {
          ts: Date.now(),
          pathKey: (window.location.pathname || "").split("-").pop() || "",
          tipo: (params.get("tipo") || "").toUpperCase(),     // 'OVER', 'UNDER', 'WIN'
          linea: (params.get("linea") || "").trim(),          // ej: '2.5', '83.5'
          outid: (params.get("outid") || "").trim(),          // '12' (Over), '13' (Under), '1'/'4' (Jugador 1), '3'/'5' (Jugador 2)
          spec: (params.get("spec") || "").trim(),            // ej: '', 'gamenr=1', 'roundnr=2'
          equipo: (params.get("equipo") || "").trim(),        // Texto descriptivo
          stake: (params.get("stake") || "1").trim(),         // Monto en USD
          autoconfirm: params.get("autoconfirm") === "1"      // true = presionar botón de apostar
        };
        try {
          sessionStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
        } catch (e) {}
        return cfg;
      }
    }

    // Si playbc.fun redireccionó y limpió el hash, recuperar de sessionStorage si fue hace menos de 35 segundos
    try {
      const saved = sessionStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && (Date.now() - (parsed.ts || 0) < 35000)) {
          return parsed;
        }
      }
    } catch (e) {}

    return null;
  }

  // Capturar apenas arranca el script
  capturarYGuardarParams();

  // 2. Buscador profundo que atraviesa tanto el DOM normal como cualquier Shadow DOM (#betby / bt-renderer)
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

  function mostrarBannerEstado(texto, colorBg = "#059669") {
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
        "box-shadow: 0 10px 25px rgba(0,0,0,0.65)",
        "border: 2px solid #34d399",
        "display: flex",
        "align-items: center",
        "gap: 10px",
        "transition: all 0.25s ease",
        "max-width: 92vw"
      ].join(";");
      document.body.appendChild(banner);
    }
    banner.style.background = colorBg;
    banner.innerHTML = `<span>🤖 <b>PolyEdge Auto-Bet:</b> ${texto}</span>`;
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

  // Si buscamos un Over/Under y no está desplegado en la vista actual, hacer clic en la pestaña "Totals"
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

  // Determinar si el jugador objetivo es el Jugador 1 (izquierda, botón "1") o Jugador 2 (derecha, botón "2")
  function detectarPosicionJugador(cfg) {
    if (cfg.outid === "1" || cfg.outid === "4") return 1;
    if (cfg.outid === "3" || cfg.outid === "5") return 2;

    // Si no vino outid, deducir comparando el nombre del jugador en cfg.equipo con la URL o con los nombres en pantalla
    const nombreLimpio = (cfg.equipo || "").split("(")[0].trim().toLowerCase();
    if (!nombreLimpio) return 1;

    // 1. Comparar contra el slug de la URL (ej: kvitova-petra-raducanu-emma-2737...)
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

    // =========================================================================
    // 1. CASO OVER / UNDER (Más de / Menos de — outid 12 o 13)
    // =========================================================================
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

      // Buscar dentro de tarjetas "Total" / "Over/Under"
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

          // Si la línea exacta (ej. 2.5) se movió medio punto en vivo, tomar la primera fila de Total disponible
          if (cardPlates.length >= 2) {
            return esOver ? cardPlates[0] : cardPlates[1];
          }
        }
      }

      // Fallback buscando la línea en todos los botones de la pantalla
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

    // =========================================================================
    // 2. CASO WINNER / GANADOR (En Betby los botones dicen "1" y "2")
    // =========================================================================
    const posJugador = detectarPosicionJugador(cfg); // 1 (izquierda) o 2 (derecha)
    const targetNumTxt = posJugador === 1 ? "1" : "2";

    // Primero buscar en la tarjeta principal "Winner" / "Ganador" / "1x2" (que siempre permanece abierta todo el partido)
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

    // Si las tarjetas no tienen header "Winner" separado pero los botones "1" y "2" están en pantalla:
    const boton1o2 = plates.find(p => {
      const nameEl = p.querySelector('[data-editor-id="marketCardOutcomeName"]');
      const t = (nameEl ? nameEl.textContent : "").trim();
      return t === targetNumTxt;
    });
    if (boton1o2) return boton1o2;

    // 3. Fallback por nombre del jugador o equipo si algún botón lo tiene escrito
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

  let ejecucionEnCurso = false;

  async function ejecutarAutoApuesta() {
    if (ejecucionEnCurso) return;
    const cfg = capturarYGuardarParams();
    if (!cfg) return;

    ejecucionEnCurso = true;

    try {
      // Esperar a que exista document.body
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

        // Si en el intento 8 o 16 es una jugada Over/Under y no aparece, pulsar la pestaña "Totals"
        if ((i === 8 || i === 16) && (cfg.tipo === "OVER" || cfg.tipo === "UNDER" || cfg.outid === "12" || cfg.outid === "13")) {
          abrirTabTotalsSiExiste();
        }
        await new Promise(r => setTimeout(r, 400));
      }

      if (!botonCuota) {
        mostrarBannerEstado(`El mercado «${descJugada}» ya cerró en este partido. Elige otro disponible.`, "#b45309");
        ejecucionEnCurso = false;
        return;
      }

      // Limpiar de sessionStorage para que no se vuelva a disparar si el usuario navega a otro partido manualmente
      try { sessionStorage.removeItem(STORAGE_KEY); } catch (e) {}

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

      // Esperar u obligar a que se despliegue el Betslip abajo a la derecha
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
        mostrarBannerEstado(`✅ Cuota marcada${txtCuotaVivo}. Haz clic en "Betslip" abajo a la derecha (o activa QUICK BET ⚡) para confirmar $${cfg.stake}.`, "#0284c7");
        ejecucionEnCurso = false;
        return;
      }

      inputStake.focus();
      setReactInputValue(inputStake, cfg.stake);
      await new Promise(r => setTimeout(r, 450));

      const btnLogin = querySelectorDeep('button[data-editor-id="betSlipLoginButton"]');
      if (btnLogin) {
        mostrarBannerEstado(`¡Boleto listo con $${cfg.stake}${txtCuotaVivo}! Inicia sesión en BC.GAME para confirmar.`, "#d97706");
        ejecucionEnCurso = false;
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
          mostrarBannerEstado(`✅ ¡Apuesta de $${cfg.stake} enviada${txtCuotaVivo}!`, "#059669");
          setTimeout(() => {
            const b = document.getElementById("polyedge-autobet-banner");
            if (b) b.style.opacity = "0.2";
          }, 6000);
          ejecucionEnCurso = false;
          return;
        }
      }

      mostrarBannerEstado(`✅ ¡Boleto preparado con $${cfg.stake}${txtCuotaVivo}! Listo en tu Betslip.`, "#059669");
    } finally {
      ejecucionEnCurso = false;
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => setTimeout(ejecutarAutoApuesta, 500));
  } else {
    setTimeout(ejecutarAutoApuesta, 500);
  }
  window.addEventListener("hashchange", () => setTimeout(ejecutarAutoApuesta, 300));
})();
