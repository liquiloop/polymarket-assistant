(function () {
  "use strict";

  function parsePolyEdgeParams() {
    const hash = window.location.hash || "";
    const search = window.location.search || "";
    const raw = hash.includes("polyedge_auto=1")
      ? hash.replace(/^#/, "")
      : (search.includes("polyedge_auto=1") ? search.replace(/^\?/, "") : "");
    if (!raw) return null;

    const params = new URLSearchParams(raw);
    if (params.get("polyedge_auto") !== "1") return null;

    return {
      tipo: (params.get("tipo") || "").toUpperCase(),     // 'OVER', 'UNDER', 'WIN'
      linea: (params.get("linea") || "").trim(),          // ej: '2.5', '83.5'
      outid: (params.get("outid") || "").trim(),          // '12' (Over), '13' (Under)
      equipo: (params.get("equipo") || "").trim(),        // Texto del botón
      stake: (params.get("stake") || "1").trim(),         // Monto en USD
      autoconfirm: params.get("autoconfirm") === "1"      // true = presionar botón de apostar
    };
  }

  function mostrarBannerEstado(texto, colorBg = "#059669") {
    let banner = document.getElementById("polyedge-autobet-banner");
    if (!banner) {
      banner = document.createElement("div");
      banner.id = "polyedge-autobet-banner";
      banner.style.cssText = [
        "position: fixed",
        "top: 14px",
        "left: 50%",
        "transform: translateX(-50%)",
        "z-index: 999999",
        "padding: 12px 22px",
        "border-radius: 12px",
        "color: #ffffff",
        "font-family: system-ui, -apple-system, sans-serif",
        "font-size: 14px",
        "font-weight: 700",
        "box-shadow: 0 10px 25px rgba(0,0,0,0.5)",
        "border: 2px solid #34d399",
        "display: flex",
        "align-items: center",
        "gap: 10px",
        "transition: all 0.25s ease"
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
    inputEl.dispatchEvent(new Event("input", { bubbles: true }));
    inputEl.dispatchEvent(new Event("change", { bubbles: true }));
    inputEl.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true }));
  }

  function limpiarCuponAnterior() {
    // Si hay selecciones viejas en el cupón, limpiarlas para no armar combinada por error
    const removeBtns = document.querySelectorAll('[data-editor-id="betslipSelectionRemoveButton"], [data-cy="ic-delete"]');
    removeBtns.forEach(btn => {
      try { btn.click(); } catch (e) {}
    });
  }

  function buscarBotonCuota(cfg) {
    const plates = Array.from(document.querySelectorAll('div[data-editor-id="outcomePlate"]'));
    if (plates.length === 0) return null;

    // 1. Si es OVER / UNDER (línea numérica ej. 2.5)
    if ((cfg.tipo === "OVER" || cfg.tipo === "UNDER") && cfg.linea) {
      // Buscar dentro de tarjetas cuyo título sea "Total"
      const marketCards = Array.from(document.querySelectorAll('div[data-editor-id="marketCard"]'));
      let platesEnTotal = [];

      for (const card of marketCards) {
        const header = card.querySelector('div[data-editor-id="marketCardHeader"]');
        const hText = (header ? header.textContent : "").trim().toLowerCase();
        if (hText === "total" || hText.includes("total")) {
          const cardPlates = Array.from(card.querySelectorAll('div[data-editor-id="outcomePlate"]'));
          const matchingLine = cardPlates.filter(p => {
            const nameEl = p.querySelector('[data-editor-id="marketCardOutcomeName"]');
            const nameTxt = (nameEl ? nameEl.textContent : "").trim();
            return nameTxt === cfg.linea || nameTxt === `(${cfg.linea})`;
          });
          if (matchingLine.length >= 2) {
            // En Betby la columna izquierda (índice 0) es "más de" (OVER) y la derecha (índice 1) es "menos de" (UNDER)
            return cfg.tipo === "OVER" ? matchingLine[0] : matchingLine[1];
          }
          platesEnTotal.push(...matchingLine);
        }
      }

      // Fallback general en todos los outcomePlates con ese número de línea
      const matchingAll = plates.filter(p => {
        const nameEl = p.querySelector('[data-editor-id="marketCardOutcomeName"]');
        const nameTxt = (nameEl ? nameEl.textContent : "").trim();
        return nameTxt === cfg.linea;
      });
      if (matchingAll.length >= 2) {
        return cfg.tipo === "OVER" ? matchingAll[0] : matchingAll[1];
      }
      if (matchingAll.length === 1) {
        return matchingAll[0];
      }
    }

    // 2. Búsqueda para Ganador (eFighting / eTennis)
    if (cfg.equipo) {
      const cleanTarget = cfg.equipo.split("(")[0].trim().toLowerCase();
      for (const p of plates) {
        const nameEl = p.querySelector('[data-editor-id="marketCardOutcomeName"]');
        const nameTxt = (nameEl ? nameEl.textContent : "").trim().toLowerCase();
        if (nameTxt && (nameTxt.includes(cleanTarget) || cleanTarget.includes(nameTxt))) {
          return p;
        }
      }
    }

    return null;
  }

  async function ejecutarAutoApuesta() {
    const cfg = parsePolyEdgeParams();
    if (!cfg) return;

    const descJugada = cfg.linea ? `${cfg.tipo === "OVER" ? "Más de" : "Menos de"} ${cfg.linea}` : cfg.equipo;
    mostrarBannerEstado(`Buscando cuota «${descJugada}» para apostar $${cfg.stake}...`, "#047857");

    // Esperar a que cargue el widget de Betby y los mercados de la partida (hasta 14 segundos)
    let botonCuota = null;
    for (let i = 0; i < 35; i++) {
      botonCuota = buscarBotonCuota(cfg);
      if (botonCuota) break;
      await new Promise(r => setTimeout(r, 400));
    }

    if (!botonCuota) {
      mostrarBannerEstado(`No se encontró la línea «${descJugada}» (puede haber cambiado en vivo). Selecciónala manualmente.`, "#b45309");
      return;
    }

    // Limpiar cupón previo si tenía otra selección distinta
    const yaActivo = botonCuota.getAttribute("data-active") === "true";
    if (!yaActivo) {
      limpiarCuponAnterior();
      await new Promise(r => setTimeout(r, 250));
      botonCuota.scrollIntoView({ behavior: "smooth", block: "center" });
      botonCuota.style.outline = "3px solid #10b981";
      botonCuota.click();
    }

    mostrarBannerEstado(`Cuota «${descJugada}» seleccionada. Colocando monto $${cfg.stake}...`, "#059669");

    // Esperar a que se abra el cupón de apuesta (Betslip) y aparezca el input del monto
    let inputStake = null;
    for (let i = 0; i < 20; i++) {
      inputStake = document.querySelector('[data-editor-id="betslipStakeInput"] input') || document.querySelector('input[inputmode="decimal"]');
      if (inputStake) break;
      await new Promise(r => setTimeout(r, 300));
    }

    if (!inputStake) {
      mostrarBannerEstado(`Cuota marcada en el boleto. Ingresa el monto ($${cfg.stake}) en el cupón.`, "#0284c7");
      return;
    }

    inputStake.focus();
    setReactInputValue(inputStake, cfg.stake);
    await new Promise(r => setTimeout(r, 450));

    // Verificar si el usuario no ha iniciado sesión en PlayBC
    const btnLogin = document.querySelector('button[data-editor-id="betSlipLoginButton"]');
    if (btnLogin) {
      mostrarBannerEstado(`¡Boleto listo con $${cfg.stake}! Inicia sesión en tu cuenta de PlayBC para confirmar.`, "#d97706");
      return;
    }

    if (cfg.autoconfirm) {
      // Buscar el botón de confirmar/realizar apuesta en el cupón
      const posiblesBotones = Array.from(document.querySelectorAll('button[data-editor-id="betslipPlaceBetButton"], button'));
      const btnApostar = posiblesBotones.find(b => {
        const idEd = b.getAttribute("data-editor-id") || "";
        const txt = (b.textContent || "").trim().toLowerCase();
        if (idEd === "betslipPlaceBetButton") return true;
        return (
          txt === "realizar apuesta" ||
          txt === "apostar" ||
          txt === "place bet" ||
          txt.includes("realizar apuesta") ||
          txt.includes("aceptar y apostar")
        );
      });

      if (btnApostar && !btnApostar.disabled) {
        btnApostar.style.outline = "3px solid #34d399";
        btnApostar.click();
        mostrarBannerEstado(`✅ ¡Apuesta de $${cfg.stake} en «${descJugada}» enviada automáticamente!`, "#059669");
        setTimeout(() => {
          const b = document.getElementById("polyedge-autobet-banner");
          if (b) b.style.opacity = "0.2";
        }, 6000);
        return;
      }
    }

    mostrarBannerEstado(`✅ ¡Boleto preparado con $${cfg.stake} en «${descJugada}»! Listo en tu cupón.`, "#059669");
  }

  // Ejecutar al cargar y si cambia el hash
  setTimeout(ejecutarAutoApuesta, 800);
  window.addEventListener("hashchange", () => setTimeout(ejecutarAutoApuesta, 400));
})();
