(function () {
  "use strict";

  const SINGLE_STORAGE_KEY = "polyedge_autobet_active_cfg";

  function capturarEstadoBC() {
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
          tipo: (params.get("tipo") || "").toUpperCase(),
          linea: (params.get("linea") || "").trim(),
          outid: (params.get("outid") || "").trim(),
          spec: (params.get("spec") || "").trim(),
          cuota: parseFloat(params.get("cuota") || "0") || 0,
          min_k: parseFloat(params.get("min_k") || "0") || 0,
          equipo: (params.get("equipo") || "").trim(),
          stake: (params.get("stake") || "5").trim(),
          autoconfirm: params.get("autoconfirm") === "1"
        };
        try {
          sessionStorage.setItem(SINGLE_STORAGE_KEY, JSON.stringify(cfg));
        } catch (e) {}
        return cfg;
      }
    }

    try {
      const saved = sessionStorage.getItem(SINGLE_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && (Date.now() - (parsed.ts || 0) < 35000)) {
          return parsed;
        }
      }
    } catch (e) {}

    return null;
  }

  capturarEstadoBC();

  function querySelectorAllDeep(selector, root = document) {
    const results = [];
    try {
      const direct = root.querySelectorAll(selector);
      for (let i = 0; i < direct.length; i++) results.push(direct[i]);
    } catch (e) {}
    let allNodes = [];
    try { allNodes = root.querySelectorAll("*"); } catch (e) {}
    for (let i = 0; i < allNodes.length; i++) {
      if (allNodes[i].shadowRoot) {
        const nested = querySelectorAllDeep(selector, allNodes[i].shadowRoot);
        for (let j = 0; j < nested.length; j++) results.push(nested[j]);
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
        "box-shadow: 0 10px 25px rgba(0,0,0,0.75)",
        "border: 2px solid #34d399",
        "display: flex",
        "align-items: center",
        "gap: 12px",
        "max-width: 94vw"
      ].join(";");
      document.body.appendChild(banner);
    }
    banner.style.background = colorBg;
    banner.innerHTML = `<span>🛡️ <b>PolyEdge Pro:</b> ${texto}</span>`;
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
    inputEl.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, composed: true }));
  }

  function clickElemento(el) {
    if (!el) return;
    try { el.scrollIntoView({ behavior: "smooth", block: "center" }); } catch (e) {}
    try { el.click(); } catch (e) {}
  }

  function estaAbiertoElBetslip() {
    return Boolean(
      querySelectorDeep('[data-editor-id="betslipSelection"]') ||
      querySelectorDeep('[data-editor-id="betslipStakeInput"] input') ||
      querySelectorDeep('[data-cy="ic-delete"]')
    );
  }

  function abrirBetslipSiEstaCerrado() {
    if (estaAbiertoElBetslip()) return true;
    const nodos = querySelectorAllDeep("div, span, button");
    for (const el of nodos) {
      const t = (el.textContent || "").replace(/\s+/g, " ").trim().toLowerCase();
      if (!t || t.includes("quick") || t.includes("rápida")) continue;
      if ((t === "betslip" || t === "cupón de apuesta" || /^betslip\s*\d*$/.test(t)) && el.children.length <= 4) {
        clickElemento(el);
        if (el.parentElement && !(el.parentElement.textContent || "").toLowerCase().includes("quick")) {
          try { el.parentElement.click(); } catch (e) {}
        }
        return true;
      }
    }
    return false;
  }

  async function vaciarBetslipPorCompleto() {
    abrirBetslipSiEstaCerrado();
    await new Promise(r => setTimeout(r, 220));
    const trash = querySelectorDeep('[data-cy="ic-delete"]');
    if (trash) {
      clickElemento(trash);
      await new Promise(r => setTimeout(r, 220));
    }
    const removeBtns = querySelectorAllDeep('[data-editor-id="betslipSelectionRemoveButton"]');
    for (const btn of removeBtns) {
      clickElemento(btn);
      await new Promise(r => setTimeout(r, 100));
    }
  }

  function abrirTabTotalsSiExiste() {
    const pills = querySelectorAllDeep('[data-editor-id="tableMarketPill"], button, div');
    const tabTotals = pills.find(el => {
      const t = (el.textContent || "").trim().toLowerCase();
      return (t.startsWith("totals") || t.startsWith("totales")) && t.length <= 16 && el.children.length <= 3;
    });
    if (tabTotals) clickElemento(tabTotals);
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
        if (/^\d+(\.\d+)?$/.test(txt)) return txt;
      }
    }
    return "";
  }

  // Verifica que la cuota en BC.GAME siga teniendo ventaja matemática (+EV / Arbitraje) y no haya caído por debajo de min_k
  function verificarVentajaViva(plate, cfg) {
    if (!plate) return { ok: false, motivo: "candado" };
    const kViva = parseFloat(leerCuotaDeBoton(plate));
    if (isNaN(kViva) || kViva <= 1.01) return { ok: false, motivo: "candado" };
    if (cfg.min_k > 1.01 && kViva < cfg.min_k - 0.02) {
      return { ok: false, motivo: `BC ya bajó la cuota a ${kViva} (mínimo rentable era ${cfg.min_k})` };
    }
    return { ok: true, kViva };
  }

  function buscarBotonExactoBC(cfg) {
    const marketCards = querySelectorAllDeep('div[data-editor-id="marketCard"]');
    if (marketCards.length === 0) return { btn: null, motivo: "" };

    let ultimoMotivo = "";

    // CASO 1: TOTALS (OVER / UNDER)
    if ((cfg.tipo === "OVER" || cfg.tipo === "UNDER" || cfg.outid === "12" || cfg.outid === "13") && cfg.linea) {
      const esOver = cfg.tipo === "OVER" || cfg.outid === "12";
      for (const card of marketCards) {
        const header = card.querySelector('div[data-editor-id="marketCardHeader"]');
        const hText = (header ? header.textContent : "").trim().toLowerCase();
        const esTotal = (
          hText === "total" ||
          hText === "total (incl. overtime)" ||
          hText === "total (incl. overtime and penalties)" ||
          hText === "total (prórroga incl.)" ||
          hText === "total (incl. prórroga)" ||
          hText === "over/under" ||
          hText === "más/menos"
        );
        if (!esTotal) continue;

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
          const cand = esOver ? matchingLine[0] : matchingLine[1];
          const ev = verificarVentajaViva(cand, cfg);
          if (ev.ok) return { btn: cand, motivo: "" };
          ultimoMotivo = ev.motivo;
        }
      }
      return { btn: null, motivo: ultimoMotivo };
    }

    // CASO 2: GANADOR INCLUYENDO PRÓRROGA (NBA 219 / NHL 406: outid 4 = Local/Izquierda, outid 5 = Visitante/Derecha)
    if (cfg.tipo === "WIN" || cfg.outid === "4" || cfg.outid === "5") {
      const esLocal = cfg.outid === "4" || cfg.outid === "1";
      for (const card of marketCards) {
        const header = card.querySelector('div[data-editor-id="marketCardHeader"]');
        const hText = (header ? header.textContent : "").trim().toLowerCase();
        const esWinnerOT = (
          hText.includes("winner (incl. overtime") ||
          hText.includes("ganador (incl. prórroga") ||
          hText.includes("ganador (prórroga incl") ||
          hText === "winner" ||
          hText === "ganador"
        );
        if (!esWinnerOT) continue;

        const cardPlates = Array.from(card.querySelectorAll('div[data-editor-id="outcomePlate"]'));
        if (cardPlates.length === 2) {
          const cand = esLocal ? cardPlates[0] : cardPlates[1];
          const ev = verificarVentajaViva(cand, cfg);
          if (ev.ok) return { btn: cand, motivo: "" };
          ultimoMotivo = ev.motivo;
        }
      }
    }

    return { btn: null, motivo: ultimoMotivo };
  }

  let ejecutando = false;

  async function iniciarBC() {
    if (ejecutando) return;
    const cfg = capturarEstadoBC();
    if (!cfg) return;

    ejecutando = true;
    try {
      while (!document.body) {
        await new Promise(r => setTimeout(r, 100));
      }

      mostrarBannerEstado(`Verificando si sigue viva la ventaja en «${cfg.equipo}»...`, "#047857");

      let boton = null;
      let motivoFallo = "";
      for (let i = 0; i < 30; i++) {
        const res = buscarBotonExactoBC(cfg);
        if (res.btn) {
          boton = res.btn;
          break;
        }
        if (res.motivo) motivoFallo = res.motivo;
        if (i === 6 || i === 14) {
          if (cfg.linea) abrirTabTotalsSiExiste();
        }
        await new Promise(r => setTimeout(r, 400));
      }

      try { sessionStorage.removeItem(SINGLE_STORAGE_KEY); } catch (e) {}

      if (!boton) {
        const det = motivoFallo && motivoFallo !== "candado"
          ? motivoFallo
          : "la línea exacta no está abierta o tiene candado";
        mostrarBannerEstado(`⚠️ NO APOSTAR: ${det}. Tu saldo está protegido.`, "#b45309");
        return;
      }

      const cuotaViva = leerCuotaDeBoton(boton);
      if (boton.getAttribute("data-active") !== "true") {
        await vaciarBetslipPorCompleto();
        await new Promise(r => setTimeout(r, 220));
        boton.style.outline = "3px solid #10b981";
        clickElemento(boton);
      }

      let inputStake = null;
      for (let i = 0; i < 22; i++) {
        abrirBetslipSiEstaCerrado();
        inputStake =
          querySelectorDeep('[data-editor-id="betslipStakeInput"] input') ||
          querySelectorDeep('input[inputmode="decimal"]');
        if (inputStake) break;
        await new Promise(r => setTimeout(r, 300));
      }

      if (inputStake) {
        inputStake.focus();
        setReactInputValue(inputStake, cfg.stake);
        await new Promise(r => setTimeout(r, 400));
      }

      const posiblesBotones = querySelectorAllDeep('button[data-editor-id="betslipPlaceBetButton"], button');
      const btnApostar = posiblesBotones.find(b => {
        const idEd = b.getAttribute("data-editor-id") || "";
        const txt = (b.textContent || "").trim().toLowerCase();
        return idEd === "betslipPlaceBetButton" || txt.includes("place bet") || txt.includes("realizar apuesta");
      });

      if (btnApostar) {
        btnApostar.style.outline = "4px solid #fbbf24";
        btnApostar.style.boxShadow = "0 0 20px rgba(251, 191, 36, 0.85)";
        if (cfg.autoconfirm && !btnApostar.disabled) {
          clickElemento(btnApostar);
          mostrarBannerEstado(`✅ ¡Apuesta con ventaja (+EV) enviada a cuota ${cuotaViva} con $${cfg.stake}!`, "#059669");
          return;
        }
      }

      mostrarBannerEstado(
        `✅ ¡Ventaja confirmada! Cuota ${cuotaViva} lista en tu Betslip con $${cfg.stake}. Revisa y dale a «Place Bet».`,
        "#059669"
      );
    } finally {
      ejecutando = false;
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => setTimeout(iniciarBC, 550));
  } else {
    setTimeout(iniciarBC, 550);
  }
  window.addEventListener("hashchange", () => setTimeout(iniciarBC, 300));
})();
