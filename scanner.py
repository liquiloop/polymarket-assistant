import sys
import os
import json
import re
import time
import math
import urllib.request
from datetime import datetime, timezone

current_dir = os.path.dirname(os.path.abspath(__file__))
if current_dir not in sys.path:
    sys.path.insert(0, current_dir)

from config import load_config

def parse_polymarket_date(date_str):
    if not date_str:
        return None
    try:
        cleaned = date_str.replace("Z", "+00:00")
        if "T" not in cleaned and "+" not in cleaned:
            cleaned += "T23:59:59+00:00"
        elif "+" not in cleaned:
            cleaned += "+00:00"
        return datetime.fromisoformat(cleaned)
    except Exception:
        return None

def _calc_ema(vals, span):
    if not vals:
        return 0.0
    k = 2.0 / (span + 1.0)
    ema = vals[0]
    for v in vals[1:]:
        ema = v * k + ema * (1.0 - k)
    return ema

def _calc_rsi(vals, period=7):
    if len(vals) < period + 1:
        return 50.0
    gains, losses = [], []
    for i in range(1, len(vals)):
        d = vals[i] - vals[i - 1]
        gains.append(max(d, 0.0))
        losses.append(max(-d, 0.0))
    avg_g = sum(gains[-period:]) / period
    avg_l = sum(losses[-period:]) / period
    if avg_l == 0:
        return 100.0
    rs = avg_g / avg_l
    return 100.0 - (100.0 / (1.0 + rs))

def obtener_precios_clob_en_vivo(clob_token_ids, fallback_prices):
    """
    Consulta directamente el motor de órdenes en tiempo real (CLOB) de Polymarket
    para obtener el precio al milisegundo sin el retraso de 45s de Gamma API.
    """
    if not clob_token_ids or len(clob_token_ids) < 2:
        return [float(p) for p in fallback_prices]
    precios_reales = []
    try:
        for i, tid in enumerate(clob_token_ids):
            url = f"https://clob.polymarket.com/midpoint?token_id={tid}"
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=4) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                mid = float(data.get("mid", fallback_prices[i]))
                precios_reales.append(mid)
        if len(precios_reales) == len(clob_token_ids):
            return precios_reales
    except Exception:
        pass
    return [float(p) for p in fallback_prices]

def analizar_mercado_btc_en_vivo(slot_ts, clob_prob_up=None):
    """
    Analiza en tiempo real:
    1. El precio instantáneo al segundo (Live Trades de Coinbase) + velas de 1m.
    2. La pendiente inmediata de la gráfica (últimos 30-60 segundos) para detectar giros en V al instante.
    3. La posición frente al 'Price To Beat' (Apertura de los 5m).
    4. El flujo en tiempo real del libro de órdenes CLOB de Polymarket (conectado a Chainlink).
    """
    try:
        # 1. Obtener velas de 1m
        url_candles = "https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=60"
        req_c = urllib.request.Request(url_candles, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req_c, timeout=5) as resp:
            candles = json.loads(resp.read().decode("utf-8"))
        if not candles:
            return None

        candles.sort(key=lambda x: x[0])
        closes = [float(c[4]) for c in candles[-20:]]
        current_btc = closes[-1]

        # 2. Obtener los últimos trades al segundo para medir la pendiente inmediata de la gráfica
        micro_slope = 0.0
        buy_pressure = 0.0
        try:
            url_trades = "https://api.exchange.coinbase.com/products/BTC-USD/trades?limit=60"
            req_t = urllib.request.Request(url_trades, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req_t, timeout=4) as resp_t:
                trades = json.loads(resp_t.read().decode("utf-8"))
            if trades and len(trades) >= 10:
                current_btc = float(trades[0]["price"])
                oldest_recent_btc = float(trades[-1]["price"])
                micro_slope = current_btc - oldest_recent_btc
                vol_b = sum(float(t["size"]) for t in trades if t.get("side") == "buy")
                vol_s = sum(float(t["size"]) for t in trades if t.get("side") == "sell")
                buy_pressure = (vol_b - vol_s) / max(vol_b + vol_s, 0.001)
        except Exception:
            pass

        closes[-1] = current_btc

        # Velas dentro del bloque actual de 5 minutos [slot_ts, slot_ts + 300)
        window = [c for c in candles if slot_ts <= c[0] < slot_ts + 300]
        if window:
            open_5m = float(window[0][3])
            twap_btc = (sum((float(c[1]) + float(c[2]) + float(c[3]) + float(c[4])) / 4.0 for c in window) + current_btc) / (len(window) + 1)
        else:
            open_5m = closes[-2] if len(closes) >= 2 else current_btc
            twap_btc = (open_5m + current_btc) / 2.0

        diff_spot = current_btc - open_5m
        diff_twap = twap_btc - open_5m

        # Pendiente del último minuto (1m) y micro-pendiente en segundos
        mom_1m = current_btc - float(candles[-1][3]) # Cambio dentro de la vela de 1m actual
        mom_2m = current_btc - closes[-3] if len(closes) >= 3 else mom_1m
        ema3 = _calc_ema(closes, 3)
        ema7 = _calc_ema(closes, 7)
        rsi7 = _calc_rsi(closes, 7)

        # Velocidad instantánea de la gráfica (lo que el usuario ve subir o bajar en pantalla ahora mismo)
        impulso_inmediato = mom_1m * 0.6 + micro_slope * 0.4

        escala_usd = max(current_btc * 0.00035, 18.0)
        spot_vs_target_score = math.tanh(diff_spot / escala_usd)
        slope_score = math.tanh((impulso_inmediato * 1.4 + (ema3 - ema7) * 0.5) / (escala_usd * 0.7))

        # Combinar posición frente al Price To Beat + pendiente inmediata + flujo CLOB en vivo
        tech_prob_up = 0.50 + 0.42 * math.tanh(spot_vs_target_score * 0.55 + slope_score * 0.65 + buy_pressure * 0.20)
        tech_prob_up = max(min(tech_prob_up, 0.95), 0.05)

        if clob_prob_up is not None and 0.04 <= clob_prob_up <= 0.96:
            # El CLOB en vivo de Polymarket refleja el feed de Chainlink al segundo;
            # fusionamos 65% CLOB en vivo + 35% nuestra pendiente inmediata para total precisión con la gráfica.
            prob_up_final = clob_prob_up * 0.65 + tech_prob_up * 0.35
        else:
            prob_up_final = tech_prob_up

        prob_up_final = max(min(prob_up_final, 0.96), 0.04)
        prob_down_final = 1.0 - prob_up_final

        # Explicación precisa de lo que está haciendo la gráfica en este instante
        partes_razon = []
        if abs(impulso_inmediato) >= 2.0:
            sube_baja = "SUBIENDO con fuerza 📈" if impulso_inmediato > 0 else "BAJANDO con fuerza 📉"
            partes_razon.append(f"La gráfica en vivo está {sube_baja} ({impulso_inmediato:+.1f} USD en el último minuto)")
        if abs(diff_spot) >= 1.0:
            pos_txt = "ARRIBA" if diff_spot >= 0 else "ABAJO"
            partes_razon.append(f"Precio actual ${abs(diff_spot):,.1f} USD {pos_txt} del Price To Beat (${open_5m:,.2f})")

        return {
            "open_5m": round(open_5m, 2),
            "current_btc": round(current_btc, 2),
            "twap_btc": round(twap_btc, 2),
            "diff_usd": round(diff_spot, 2),
            "diff_twap": round(diff_twap, 2),
            "ema5": round(ema3, 2),
            "ema12": round(ema7, 2),
            "rsi7": round(rsi7, 1),
            "mom_1m": round(impulso_inmediato, 2),
            "mom_3m": round(impulso_inmediato, 2), # Mostramos el impulso inmediato de 1m en la UI
            "prob_up_model": round(prob_up_final, 4),
            "prob_down_model": round(prob_down_final, 4),
            "razones": " + ".join(partes_razon) if partes_razon else "Movimiento en tiempo real sincronizado con gráfica"
        }
    except Exception as e:
        print(f"[Error en análisis técnico BTC]: {e}")
        return None

def get_btc_5m_opportunities(prob_min=0.70, prob_max=0.95, include_warming_up=False):
    """
    Escanea la vela de 5 minutos ACTUAL EN JUEGO en Polymarket consultando el libro
    de órdenes CLOB al milisegundo y la pendiente en vivo de los últimos segundos.
    """
    now_ts = int(time.time())
    slot_ts = (now_ts // 300) * 300
    secs_left = (slot_ts + 300) - now_ts

    # Si quedan menos de 15 segundos en la vela actual, pasar a la siguiente vela que está por arrancar
    if secs_left >= 15:
        slots_to_check = [(slot_ts, "ACTUAL EN JUEGO")]
    else:
        slots_to_check = [(slot_ts + 300, "EMPEZANDO AHORA")]

    candidatos = []

    for s_ts, etiqueta_vela in slots_to_check:
        slug = f"btc-updown-5m-{s_ts}"
        url = f"https://gamma-api.polymarket.com/events?slug={slug}"
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        try:
            with urllib.request.urlopen(req, timeout=7) as resp:
                data = json.loads(resp.read().decode("utf-8"))
            if not data:
                continue
            ev = data[0]
            markets = ev.get("markets") or []
            if not markets:
                continue
            m = markets[0]
            if m.get("closed") or m.get("acceptingOrders") is False:
                continue

            raw_prices = m.get("outcomePrices")
            raw_outcomes = m.get("outcomes")
            fallback_precios = json.loads(raw_prices) if isinstance(raw_prices, str) else raw_prices
            opciones = json.loads(raw_outcomes) if isinstance(raw_outcomes, str) else raw_outcomes
            if not fallback_precios or not opciones or len(fallback_precios) != len(opciones):
                continue

            # Obtener precios EN VIVO al segundo desde CLOB API (sin retraso de caché)
            raw_clob_ids = m.get("clobTokenIds")
            clob_ids = json.loads(raw_clob_ids) if isinstance(raw_clob_ids, str) else (raw_clob_ids or [])
            precios_vivos = obtener_precios_clob_en_vivo(clob_ids, fallback_precios)

            s_left = max((s_ts + 300) - int(time.time()), 5)
            if not include_warming_up and s_left < 35:
                continue

            mins = s_left // 60
            secs = s_left % 60
            tiempo_corto = f"{mins:02d}m {secs:02d}s"
            dias_restantes = max(s_left / 86400.0, 0.0005)
            liq = float(m.get("liquidityNum") or m.get("liquidity") or 0)
            vol = float(m.get("volumeNum") or m.get("volume") or 0)
            link = f"https://polymarket.com/event/{slug}"

            # Identificar precio CLOB de Up
            clob_up = None
            for op_name, p_val in zip(opciones, precios_vivos):
                if op_name.lower() == "up":
                    clob_up = p_val
                    break

            btc_analysis = analizar_mercado_btc_en_vivo(s_ts, clob_prob_up=clob_up)

            # Seleccionar la dirección dominante sincronizada con el CLOB en vivo y la pendiente inmediata
            mejor_candidato_vela = None
            mejor_prob = -1.0

            for idx, (opcion, p_market) in enumerate(zip(opciones, precios_vivos)):
                if p_market <= 0.02 or p_market >= 0.98:
                    continue
                es_up = opcion.lower() == "up"
                if btc_analysis:
                    p_model = btc_analysis["prob_up_model"] if es_up else btc_analysis["prob_down_model"]
                else:
                    p_model = p_market

                # Sincronización estricta: la dirección ganadora es la que domina el CLOB en vivo + pendiente 1m
                p_combinada = p_market * 0.65 + p_model * 0.35
                if p_combinada > mejor_prob:
                    mejor_prob = p_combinada
                    roi = ((1.0 - p_market) / p_market) * 100.0
                    ev_ratio = p_combinada * (1.0 / p_market) - 1.0
                    mejor_candidato_vela = (idx, opcion, p_market, p_model, p_combinada, roi, ev_ratio)

            if not mejor_candidato_vela:
                continue

            idx, mejor_opcion, p_market, p_model, p_combinada, roi, ev_ratio = mejor_candidato_vela
            prob_mostrar = round(max(p_market, p_combinada) * 100, 1)
            centavos = round(p_market * 100)

            cumple_umbral = (prob_mostrar >= prob_min * 100) and (p_market <= prob_max)
            if cumple_umbral or include_warming_up:
                apr = (roi / dias_restantes) * 365
                cobro_10 = round(10 * (1 + roi / 100), 2)
                ganancia_10 = round(cobro_10 - 10, 2)

                es_up = mejor_opcion.lower() == "up"
                direccion_es = "SUBE (Up 📈)" if es_up else "BAJA (Down 📉)"
                color_boton = "verde «Up»" if es_up else "rojo «Down»"

                razon_analisis = btc_analysis["razones"] if btc_analysis else "Flujo de órdenes en tiempo real a favor"
                como_ganas = (
                    f"🏆 DIRECCIÓN EN VIVO: {direccion_es}. "
                    f"Ganas si al terminar el reloj ({tiempo_corto}) Bitcoin cierra "
                    f"{'ARRIBA' if es_up else 'ABAJO'} del Price To Beat. "
                    f"📊 {razon_analisis}."
                )
                instruccion_boton = (
                    f"En Polymarket toca el botón {color_boton} de {centavos}¢ "
                    f"(Quedan {tiempo_corto} en el reloj)."
                )

                candidatos.append({
                    "id": f"btc5m_{m.get('id')}_{idx}",
                    "market_id": m.get("id"),
                    "question": f"⚡ [BITCOIN 5 MIN - {etiqueta_vela}] {ev.get('title')}",
                    "description": ev.get("description", ""),
                    "resolution_source": "CLOB Polymarket en Vivo + Pendiente 1m",
                    "outcome": f"{mejor_opcion} ➔ {direccion_es}",
                    "raw_outcome": mejor_opcion,
                    "probability": prob_mostrar,
                    "market_probability": round(p_market * 100, 1),
                    "model_probability": round(p_model * 100, 1),
                    "price": round(p_market, 4),
                    "centavos": centavos,
                    "roi": round(roi, 2),
                    "ev_pct": round(ev_ratio * 100, 1),
                    "days_left": round(dias_restantes, 3),
                    "hours_left": round(s_left / 3600.0, 2),
                    "seconds_left": s_left,
                    "end_timestamp": s_ts + 300,
                    "tiempo_exacto": tiempo_corto,
                    "etiqueta_vela": etiqueta_vela,
                    "es_btc_5m": True,
                    "btc_live": btc_analysis,
                    "apr": round(apr, 1),
                    "volume_24h": round(vol, 2),
                    "liquidity": round(liq, 2),
                    "kelly_pct": 2.5,
                    "como_ganas": como_ganas,
                    "instruccion_boton": instruccion_boton,
                    "cobro_10": cobro_10,
                    "ganancia_10": ganancia_10,
                    "es_spread": False,
                    "slug": slug,
                    "link": link,
                    "image": ev.get("icon") or ev.get("image") or "",
                    "cumple_70": cumple_umbral
                })
        except Exception as e:
            print(f"[Error escaneando BTC 5m]: {e}")
            continue

    if not include_warming_up:
        return [c for c in candidatos if c["cumple_70"]]
    return candidatos

def generar_explicacion_simple(question, outcome, price, roi):
    q_clean = (question or "").strip()
    out_clean = (outcome or "").strip()
    centavos = round(price * 100)
    cobro_10 = round(10 * (1 + roi / 100), 2)
    ganancia_10 = round(cobro_10 - 10, 2)

    if q_clean.lower().startswith("spread:"):
        match = re.search(r"Spread:\s*(.+?)\s*\(([+-]?\d+\.?\d*)\)", q_clean, re.IGNORECASE)
        if match:
            fav_team = match.group(1).strip()
            pts = abs(float(match.group(2)))
            pts_entero = int(pts)
            if out_clean.lower() == fav_team.lower():
                como_ganas = f"Ganas si {out_clean} gana el partido por {pts_entero + 1} puntos/goles o más de diferencia."
                boton_txt = f"Busca la sección 'Spread' y toca el botón '{out_clean} -{pts}' (de ~{centavos}¢)."
            else:
                como_ganas = f"Ventaja para {out_clean}: Ganas si {out_clean} gana el partido, empata, o incluso si pierde por máximo {pts_entero} puntos/goles."
                boton_txt = f"Busca la sección 'Spread' y toca el botón de '{out_clean} +{pts}' (el que cuesta ~{centavos}¢)."
        else:
            como_ganas = f"Apuesta con ventaja de puntos a favor de '{out_clean}'."
            boton_txt = f"En la sección 'Spread', toca el botón '{out_clean}' que cuesta ~{centavos}¢."

    elif out_clean.lower() in ["yes", "no"]:
        win_match = re.search(r"Will (.+?) win on", q_clean, re.IGNORECASE)
        draw_match = re.search(r"Will (.+?) end in a draw", q_clean, re.IGNORECASE)
        if win_match:
            equipo = win_match.group(1).strip()
            if out_clean.lower() == "yes":
                como_ganas = f"Ganas si {equipo} gana su partido."
                boton_txt = f"Toca el botón a favor de '{equipo}' (o 'Yes') que cuesta ~{centavos}¢."
            else:
                como_ganas = f"Ganas si {equipo} NO gana el partido (es decir, si empata o pierde)."
                boton_txt = f"Toca el botón 'No' en la fila de {equipo} (el que cuesta ~{centavos}¢)."
        elif draw_match:
            partido = draw_match.group(1).strip()
            if out_clean.lower() == "no":
                como_ganas = f"Ganas si el partido ({partido}) NO termina en empate (ganas si cualquiera de los dos equipos gana)."
                boton_txt = f"En la opción de Empate (Draw), toca el botón 'No' que cuesta ~{centavos}¢."
            else:
                como_ganas = f"Ganas si el partido ({partido}) termina en empate."
                boton_txt = f"Toca el botón 'Draw / Yes' que cuesta ~{centavos}¢."
        else:
            if out_clean.lower() == "yes":
                como_ganas = f"Ganas si SE CUMPLE esto: «{q_clean}»."
                boton_txt = f"Toca el botón verde 'Yes' (el que cuesta ~{centavos}¢)."
            else:
                como_ganas = f"Ganas si NO ocurre esto: «{q_clean}»."
                boton_txt = f"Toca el botón 'No' (el que cuesta ~{centavos}¢)."
    else:
        como_ganas = f"¡Súper simple! Ganas si «{out_clean}» gana el partido o evento."
        boton_txt = f"Toca directamente el botón con el nombre «{out_clean}» (el que cuesta ~{centavos}¢)."

    return {
        "como_ganas": como_ganas,
        "instruccion_boton": boton_txt,
        "centavos": centavos,
        "cobro_10": cobro_10,
        "ganancia_10": ganancia_10,
        "es_spread": q_clean.lower().startswith("spread:")
    }

def get_polymarket_opportunities(custom_filters=None):
    cfg = load_config()
    prob_min = custom_filters.get("prob_min", cfg.get("MIN_PROBABILITY", 0.70)) if custom_filters else cfg.get("MIN_PROBABILITY", 0.70)
    prob_max = custom_filters.get("prob_max", cfg.get("MAX_PROBABILITY", 0.98)) if custom_filters else cfg.get("MAX_PROBABILITY", 0.98)
    max_days = custom_filters.get("max_days", cfg.get("MAX_DAYS", 30)) if custom_filters else cfg.get("MAX_DAYS", 30)
    min_vol = custom_filters.get("min_vol", cfg.get("MIN_VOLUME_24H", 3000)) if custom_filters else cfg.get("MIN_VOLUME_24H", 3000)
    min_liq = custom_filters.get("min_liq", cfg.get("MIN_LIQUIDITY", 2000)) if custom_filters else cfg.get("MIN_LIQUIDITY", 2000)
    min_apr = custom_filters.get("min_apr", cfg.get("MIN_APR", 25.0)) if custom_filters else cfg.get("MIN_APR", 25.0)
    ocultar_spreads = custom_filters.get("hide_spreads", False) if custom_filters else False

    oportunidades_btc_5m = get_btc_5m_opportunities(prob_min=prob_min, prob_max=prob_max, include_warming_up=True)

    url = "https://gamma-api.polymarket.com/markets?limit=250&active=true&closed=false&order=volume24hr&ascending=false"
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"})
    
    try:
        with urllib.request.urlopen(req, timeout=12) as response:
            markets = json.loads(response.read().decode("utf-8"))
    except Exception as e:
        print(f"[Error de conexión con Polymarket API]: {e}")
        return oportunidades_btc_5m

    ahora = datetime.now(timezone.utc)
    oportunidades = []

    for m in markets:
        try:
            if m.get("acceptingOrders") is False:
                continue

            question_text = m.get("question") or ""
            q_lower = question_text.lower()
            m_slug = (m.get("slug") or "").lower()

            if ("bitcoin" in q_lower or "btc" in q_lower) and ("btc-updown-5m" not in m_slug):
                continue

            if ocultar_spreads and q_lower.startswith("spread:"):
                continue

            vol_24h = float(m.get("volume24hr") or m.get("volumeNum") or 0)
            liq = float(m.get("liquidityNum") or m.get("liquidity") or 0)

            if vol_24h < min_vol or liq < min_liq:
                continue

            raw_prices = m.get("outcomePrices")
            raw_outcomes = m.get("outcomes")
            if not raw_prices or not raw_outcomes:
                continue

            precios = json.loads(raw_prices) if isinstance(raw_prices, str) else raw_prices
            opciones = json.loads(raw_outcomes) if isinstance(raw_outcomes, str) else raw_outcomes

            if len(precios) != len(opciones):
                continue

            end_date_str = m.get("endDateIso") or m.get("endDate")
            if not end_date_str:
                continue

            end_date = parse_polymarket_date(end_date_str)
            if not end_date:
                continue

            segundos = (end_date - ahora).total_seconds()
            if segundos <= 0:
                continue

            dias_restantes = max(segundos / 86400, 0.04)

            if dias_restantes > max_days:
                continue

            events_list = m.get("events") or []
            event_slug = events_list[0].get("slug") if (isinstance(events_list, list) and len(events_list) > 0 and isinstance(events_list[0], dict)) else None
            market_slug = m.get("slug") or ""
            canonical_slug = event_slug or market_slug

            link = f"https://polymarket.com/event/{canonical_slug}" if canonical_slug else "https://polymarket.com"

            for idx, (opcion, p_str) in enumerate(zip(opciones, precios)):
                p = float(p_str)
                if prob_min <= p <= prob_max:
                    roi = ((1.0 - p) / p) * 100
                    apr = (roi / dias_restantes) * 365

                    if apr < min_apr:
                        continue

                    p_est = min(p + 0.02, 0.99)
                    b = (1.0 - p) / p
                    kelly_full = (p_est * b - (1.0 - p_est)) / b if b > 0 else 0
                    kelly_quarter = max(round(kelly_full * 0.25 * 100, 1), 0.5)

                    guia = generar_explicacion_simple(question_text, opcion, p, roi)

                    oportunidades.append({
                        "id": f"{m.get('id')}_{idx}",
                        "market_id": m.get("id"),
                        "question": question_text,
                        "description": m.get("description", ""),
                        "resolution_source": m.get("resolutionSource", "UMA Oracle / Reglas Oficiales"),
                        "outcome": opcion,
                        "probability": round(p * 100, 1),
                        "price": round(p, 4),
                        "centavos": guia["centavos"],
                        "roi": round(roi, 2),
                        "days_left": round(dias_restantes, 1),
                        "hours_left": max(round(dias_restantes * 24, 0), 1),
                        "es_btc_5m": False,
                        "apr": round(apr, 1),
                        "volume_24h": round(vol_24h, 2),
                        "liquidity": round(liq, 2),
                        "kelly_pct": kelly_quarter,
                        "como_ganas": guia["como_ganas"],
                        "instruccion_boton": guia["instruccion_boton"],
                        "cobro_10": guia["cobro_10"],
                        "ganancia_10": guia["ganancia_10"],
                        "es_spread": guia["es_spread"],
                        "slug": canonical_slug,
                        "link": link,
                        "image": m.get("icon") or m.get("image") or ""
                    })
        except Exception:
            continue

    oportunidades.sort(key=lambda x: (not x["es_spread"], x["apr"]), reverse=True)
    return oportunidades_btc_5m + oportunidades
