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
      outid: (params.get("outid") || "").trim(),          // '12' (Over), '13' (Under), '1'/'4' (Jugador 1), '3'/'5' (Jugador 2)
      spec: (params.get("spec") || "").trim(),            // ej: '', 'gamenr=1', 'roundnr=2'
      equipo: (params.get("equipo") || "").trim(),        // Texto descriptivo
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
    const removeBtns = document.querySelectorAll('[data-editor-id="betslipSelectionRemoveButton"], [data-cy="ic-delete"]');
    removeBtns.forEach(btn => {
      try { btn.click(); } catch (e) {}
    });
  }

  function abrirBetslipSiEstaCerrado() {
    // Si el input del monto no está visible, hacer clic en la barra verde "Betslip / Cupón de apuesta" abajo a la derecha
    const inputExistente = document.querySelector('[data-editor-id="betslipStakeInput"] input');
    if (inputExistente) return;

    const posiblesBarras = Array.from(document.querySelectorAll('[data-editor-id*="betslip"], [data-editor-id*="Betslip"], div, span, button'));
    const barraBetslip = posiblesBarras.find(el => {
      const t = (el.textContent || "").trim().toLowerCase();
      return (t === "betslip" || t === "cupón de apuesta" || t.startsWith("betslip")) && el.children.length <= 4;
    });
    if (barraBetslip) {
      try { barraBetslip.click(); } catch (e) {}
    }
  }

  function buscarBotonCuota(cfg) {
    const plates = Array.from(document.querySelectorAll('div[data-editor-id="outcomePlate"]'));
    if (plates.length === 0) return null;

    const marketCards = Array.from(document.querySelectorAll('div[data-editor-id="marketCard"]'));

    // 1. CASO OVER / UNDER (Más de / Menos de — outid 12 o 13)
    if ((cfg.tipo === "OVER" || cfg.tipo === "UNDER" || cfg.outid === "12" || cfg.outid === "13") && cfg.linea) {
      const esOver = (cfg.tipo === "OVER" || cfg.outid === "12");

      for (const card of marketCards) {
        const header = card.querySelector('div[data-editor-id="marketCardHeader"]');
        const hText = (header ? header.textContent : "").trim().toLowerCase();
        if (hText.includes("total") || hText.includes("over/under") || hText.includes("más/menos")) {
          const cardPlates = Array.from(card.querySelectorAll('div[data-editor-id="outcomePlate"]'));
          const matchingLine = cardPlates.filter(p => {
            const nameEl = p.querySelector('[data-editor-id="marketCardOutcomeName"]');
            const nameTxt = (nameEl ? nameEl.textContent : "").trim().toLowerCase();
            return (
              nameTxt === cfg.linea ||
              nameTxt === `(${cfg.linea})` ||
              nameTxt === `over ${cfg.linea}` ||
              nameTxt === `under ${cfg.linea}` ||
              nameTxt === `más de ${cfg.linea}` ||
              nameTxt === `menos de ${cfg.linea}`
            );
          });
          if (matchingLine.length >= 2) {
            return esOver ? matchingLine[0] : matchingLine[1];
          }
          if (matchingLine.length === 1) {
            return matchingLine[0];
          }
        }
      }

      // Fallback buscando en todos los outcomePlates de la página por número de línea
      const matchingAll = plates.filter(p => {
        const nameEl = p.querySelector('[data-editor-id="marketCardOutcomeName"]');
        const nameTxt = (nameEl ? nameEl.textContent : "").trim().toLowerCase();
        return nameTxt === cfg.linea || nameTxt === `over ${cfg.linea}` || nameTxt === `under ${cfg.linea}`;
      });
      if (matchingAll.length >= 2) {
        return esOver ? matchingAll[0] : matchingAll[1];
      }
      if (matchingAll.length === 1) {
        return matchingAll[0];
      }
    }

    // 2. CASO WINNER / GANADOR (En Betby los botones de Winner dicen "1" y "2", o el nombre del jugador)
    const esJugador1 = (cfg.outid === "1" || cfg.outid === "4");
    const esJugador2 = (cfg.outid === "3" || cfg.outid === "5");
    if (esJugador1 || esJugador2 || cfg.tipo === "WIN") {
      // Detectar si es de un Game o Round específico (ej: "Game 1", "Round 2")
      const gameMatch = (cfg.equipo || "").match(/\(Game\s*(\d+)\)/i) || (cfg.spec || "").match(/gamenr=(\d+)/i);
      const roundMatch = (cfg.equipo || "").match(/\(Round\s*(\d+)\)/i) || (cfg.spec || "").match(/roundnr=(\d+)/i);
      const numSub = gameMatch ? gameMatch[1] : (roundMatch ? roundMatch[1] : null);

      for (const card of marketCards) {
        const header = card.querySelector('div[data-editor-id="marketCardHeader"]');
        const hText = (header ? header.textContent : "").trim().toLowerCase();

        if (numSub) {
          // Buscar tarjeta del Game X o Round X (ej. "1st game - winner", "game 1", "round 2")
          const coincideSub = (
            hText.includes(`game ${numSub}`) ||
            hText.includes(`${numSub}st game`) ||
            hText.includes(`${numSub}nd game`) ||
            hText.includes(`${numSub}rd game`) ||
            hText.includes(`${numSub}th game`) ||
            hText.includes(`juego ${numSub}`) ||
            hText.includes(`${numSub}º juego`) ||
            hText.includes(`round ${numSub}`) ||
            hText.includes(`ronda ${numSub}`)
          );
          if (!coincideSub) continue;
        } else {
          // Buscar tarjeta principal "Winner", "Ganador", "1x2", "Match winner"
          const esWinnerPrincipal = (
            hText === "winner" ||
            hText === "ganador" ||
            hText === "1x2" ||
            hText === "match winner" ||
            hText === "ganador del partido"
          );
          if (!esWinnerPrincipal) continue;
        }

        const cardPlates = Array.from(card.querySelectorAll('div[data-editor-id="outcomePlate"]'));
        if (cardPlates.length >= 2) {
          // Buscar por texto "1" o "2"
          const targetNumTxt = esJugador1 ? "1" : "2";
          const byNum = cardPlates.find(p => {
            const nameEl = p.querySelector('[data-editor-id="marketCardOutcomeName"]');
            return (nameEl ? nameEl.textContent : "").trim() === targetNumTxt;
          });
          if (byNum) return byNum;

          // O tomar izquierda (Jugador 1) / derecha (Jugador 2)
          return esJugador1 ? cardPlates[0] : cardPlates[cardPlates.length - 1];
        }
      }

      // Fallback: si no coincidió el título exacto, buscar la primera tarjeta "Winner" / "1x2" en pantalla
      for (const card of marketCards) {
        const header = card.querySelector('div[data-editor-id="marketCardHeader"]');
        const hText = (header ? header.textContent : "").trim().toLowerCase();
        if (hText.includes("winner") || hText.includes("ganador") || hText === "1x2") {
          const cardPlates = Array.from(card.querySelectorAll('div[data-editor-id="outcomePlate"]'));
          if (cardPlates.length >= 2) {
            return esJugador1 ? cardPlates[0] : cardPlates[cardPlates.length - 1];
          }
        }
      }
    }

    // 3. Fallback por nombre de equipo si el botón tiene el nombre escrito
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

  async function ejecutarAutoApuesta() {
    const cfg = parsePolyEdgeParams();
    if (!cfg) return;

    const descJugada = cfg.linea ? `${(cfg.tipo === "OVER" || cfg.outid === "12") ? "Over / Más de" : "Under / Menos de"} ${cfg.linea}` : cfg.equipo;
    mostrarBannerEstado(`Buscando cuota «${descJugada}» para apostar $${cfg.stake}...`, "#047857");

    let botonCuota = null;
    for (let i = 0; i < 35; i++) {
      botonCuota = buscarBotonCuota(cfg);
      if (botonCuota) break;
      await new Promise(r => setTimeout(r, 400));
    }

    if (!botonCuota) {
      mostrarBannerEstado(`La cuota «${descJugada}» ya cerró o cambió en vivo. Elige otra en la pantalla.`, "#b45309");
      return;
    }

    const yaActivo = botonCuota.getAttribute("data-active") === "true";
    if (!yaActivo) {
      limpiarCuponAnterior();
      await new Promise(r => setTimeout(r, 200));
      botonCuota.scrollIntoView({ behavior: "smooth", block: "center" });
      botonCuota.style.outline = "3px solid #10b981";
      botonCuota.click();
    }

    mostrarBannerEstado(`Cuota seleccionada. Abriendo Betslip y colocando $${cfg.stake}...`, "#059669");

    // Esperar u obligar a que se despliegue el Betslip abajo a la derecha
    let inputStake = null;
    for (let i = 0; i < 22; i++) {
      inputStake = document.querySelector('[data-editor-id="betslipStakeInput"] input') || document.querySelector('input[inputmode="decimal"]');
      if (inputStake) break;
      if (i === 2 || i === 7 || i === 12) {
        abrirBetslipSiEstaCerrado();
      }
      await new Promise(r => setTimeout(r, 300));
    }

    if (!inputStake) {
      mostrarBannerEstado(`Cuota marcada en el Betslip (abajo a la derecha). Ábrelo para confirmar $${cfg.stake}.`, "#0284c7");
      return;
    }

    inputStake.focus();
    setReactInputValue(inputStake, cfg.stake);
    await new Promise(r => setTimeout(r, 450));

    const btnLogin = document.querySelector('button[data-editor-id="betSlipLoginButton"]');
    if (btnLogin) {
      mostrarBannerEstado(`¡Boleto listo con $${cfg.stake}! Inicia sesión en PlayBC para confirmar.`, "#d97706");
      return;
    }

    if (cfg.autoconfirm) {
      const posiblesBotones = Array.from(document.querySelectorAll('button[data-editor-id="betslipPlaceBetButton"], button'));
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
          txt.includes("accept")
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

    mostrarBannerEstado(`✅ ¡Boleto preparado con $${cfg.stake} en «${descJugada}»! Listo en tu Betslip.`, "#059669");
  }

  setTimeout(ejecutarAutoApuesta, 800);
  window.addEventListener("hashchange", () => setTimeout(ejecutarAutoApuesta, 400));
})();
