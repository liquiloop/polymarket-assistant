import sys
import os
import json
import re
import time
import math
import urllib.request
from datetime import datetime, timezone

# Asegurar importación de config independientemente de cómo se invoque el script
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

def analizar_mercado_btc_en_vivo(slot_ts):
    """
    Analiza las velas de 1 minuto de BTC-USD en tiempo real (Coinbase)
    y calcula:
    - Apertura exacta de la vela de 5m, precio actual y TWAP acumulado.
    - Indicadores técnicos (EMA 5, EMA 12, RSI 7, Momentum 1m/3m, Presión de volumen).
    - Probabilidad Real Estimada por el Algoritmo para UP (Sube) y DOWN (Baja).
    """
    try:
        url = "https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=60"
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=6) as resp:
            candles = json.loads(resp.read().decode("utf-8"))
        if not candles:
            return None

        # Ordenar cronológicamente [time, low, high, open, close, volume]
        candles.sort(key=lambda x: x[0])
        closes = [float(c[4]) for c in candles[-35:]]
        opens = [float(c[3]) for c in candles[-35:]]
        vols = [float(c[5]) for c in candles[-35:]]
        current_btc = closes[-1]

        # Velas dentro del bloque actual de 5 minutos [slot_ts, slot_ts + 300)
        window = [c for c in candles if slot_ts <= c[0] < slot_ts + 300]
        if window:
            open_5m = float(window[0][3])
            twap_btc = sum((float(c[1]) + float(c[2]) + float(c[3]) + float(c[4])) / 4.0 for c in window) / len(window)
        else:
            open_5m = current_btc
            twap_btc = current_btc

        diff_spot = current_btc - open_5m
        diff_twap = twap_btc - open_5m

        # Indicadores técnicos de corto plazo
        ema5 = _calc_ema(closes, 5)
        ema12 = _calc_ema(closes, 12)
        rsi7 = _calc_rsi(closes, 7)
        mom_1m = closes[-1] - closes[-2] if len(closes) >= 2 else 0.0
        mom_3m = closes[-1] - closes[-4] if len(closes) >= 4 else 0.0

        # Presión de volumen en los últimos 5 minutos
        vol_up = sum(vols[i] for i in range(-5, 0) if closes[i] >= opens[i])
        vol_down = sum(vols[i] for i in range(-5, 0) if closes[i] < opens[i])
        vol_bias = (vol_up - vol_down) / max(vol_up + vol_down, 0.01) # Entre -1 y +1

        # Segundos transcurridos en la vela actual de 5m
        now_ts = int(time.time())
        elapsed = max(min(now_ts - slot_ts, 295), 0)
        progress = elapsed / 300.0 # 0.0 al inicio, 1.0 al final

        # Puntaje direccional (-1.0 = Fuertemente Bajista, +1.0 = Fuertemente Alcista)
        # 1. Ventaja acumulada en la vela de 5m (TWAP + Spot respecto a apertura)
        # En Polymarket gana UP si TWAP >= Apertura. Cuanto más avanzada la vela, más pesa el TWAP ya acumulado.
        escala_usd = max(current_btc * 0.00045, 22.0) # ~28-30 USD de movimiento base en 5m
        twap_score = math.tanh((diff_twap * 0.65 + diff_spot * 0.35) / escala_usd)

        # 2. Puntaje de tendencia e impulso (EMA + Momentum + Volumen)
        ema_diff = ema5 - ema12
        trend_score = math.tanh((ema_diff * 0.5 + mom_3m * 0.35 + mom_1m * 0.4) / escala_usd)
        vol_score = vol_bias * 0.4

        # Ajuste por RSI (si está en tendencia fuerte acompaña, pero si pasa de 82 o baja de 18 avisa rebote)
        if 52 <= rsi7 <= 76:
            rsi_score = 0.25
        elif 24 <= rsi7 <= 48:
            rsi_score = -0.25
        elif rsi7 > 80:
            rsi_score = -0.20 # Sobrecompra extrema
        elif rsi7 < 20:
            rsi_score = 0.20  # Sobreventa extrema
        else:
            rsi_score = 0.0

        tech_combined = max(min(trend_score * 0.65 + vol_score * 0.20 + rsi_score * 0.15, 0.95), -0.95)

        # Combinar peso: al inicio de los 5m manda la técnica (75%), a mitad/final manda la ventaja TWAP (75%)
        peso_twap = 0.25 + 0.55 * progress
        peso_tech = 1.0 - peso_twap
        raw_signal = twap_score * peso_twap + tech_combined * peso_tech

        # Convertir señal a probabilidad real estimada (entre 50% y 94%)
        prob_up_model = 0.50 + 0.44 * math.tanh(raw_signal * 1.45)
        prob_up_model = max(min(prob_up_model, 0.94), 0.06)
        prob_down_model = 1.0 - prob_up_model

        # Generar razones técnicas legibles en español
        razones = []
        if abs(diff_spot) >= 3:
            dir_txt = "arriba" if diff_spot > 0 else "abajo"
            razones.append(f"BTC está ${abs(diff_spot):,.1f} USD {dir_txt} de la apertura de los 5m (${open_5m:,.2f})")
        if (ema5 > ema12 and prob_up_model >= 0.5) or (ema5 < ema12 and prob_down_model > 0.5):
            razones.append(f"Tendencia EMA 5/12 y Momentum 3m (${mom_3m:+.1f}) confirmados")
        if abs(vol_bias) > 0.25:
            razones.append("Fuerte presión de volumen " + ("comprador" if vol_bias > 0 else "vendedor"))

        return {
            "open_5m": round(open_5m, 2),
            "current_btc": round(current_btc, 2),
            "twap_btc": round(twap_btc, 2),
            "diff_usd": round(diff_spot, 2),
            "diff_twap": round(diff_twap, 2),
            "ema5": round(ema5, 2),
            "ema12": round(ema12, 2),
            "rsi7": round(rsi7, 1),
            "mom_3m": round(mom_3m, 2),
            "prob_up_model": round(prob_up_model, 4),
            "prob_down_model": round(prob_down_model, 4),
            "razones": " + ".join(razones) if razones else "Impulso técnico de corto plazo en velas de 1m"
        }
    except Exception as e:
        print(f"[Error en análisis técnico BTC]: {e}")
        return None

def get_btc_5m_opportunities(prob_min=0.70, prob_max=0.95, include_warming_up=False):
    """
    Evalúa los periodos de 5 minutos de Bitcoin (vela actual en juego y próxima vela de 5 min),
    combina la probabilidad del libro de órdenes de Polymarket con nuestro Algoritmo Técnico (TWAP + EMA + Momentum),
    y selecciona cuál dirección (SUBE / Up o BAJA / Down) y cuál ventana es la MEJOR oportunidad.
    """
    now_ts = int(time.time())
    slot_ts = (now_ts // 300) * 300
    secs_left = (slot_ts + 300) - now_ts

    # Revisar siempre la vela actual (si quedan >= 35s) y la próxima vela de 5m
    slots_to_check = []
    if secs_left >= 35:
        slots_to_check.append((slot_ts, "ACTUAL EN JUEGO"))
    slots_to_check.append((slot_ts + 300, "PRÓXIMA VELA 5M"))

    btc_analysis = analizar_mercado_btc_en_vivo(slot_ts)
    candidatos = []

    for s_ts, etiqueta_vela in slots_to_check:
        slug = f"btc-updown-5m-{s_ts}"
        url = f"https://gamma-api.polymarket.com/events?slug={slug}"
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        try:
            with urllib.request.urlopen(req, timeout=8) as resp:
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
            precios = json.loads(raw_prices) if isinstance(raw_prices, str) else raw_prices
            opciones = json.loads(raw_outcomes) if isinstance(raw_outcomes, str) else raw_outcomes
            if not precios or not opciones or len(precios) != len(opciones):
                continue

            s_left = max((s_ts + 300) - int(time.time()), 5)
            # Para alertas de Telegram en la vela actual, asegurar al menos 45s para entrar cómodamente
            if not include_warming_up and s_ts == slot_ts and s_left < 45:
                continue

            mins = s_left // 60
            secs = s_left % 60
            tiempo_corto = f"{mins}m {secs:02d}s" if mins > 0 else f"{secs}s"
            dias_restantes = max(s_left / 86400.0, 0.0005)
            liq = float(m.get("liquidityNum") or m.get("liquidity") or 0)
            vol = float(m.get("volumeNum") or m.get("volume") or 0)
            link = f"https://polymarket.com/event/{slug}"

            # Evaluar tanto UP como DOWN para encontrar cuál tiene la mejor relación Probabilidad Real vs Precio
            mejor_candidato_vela = None
            mejor_score = -999.0

            for idx, (opcion, p_str) in enumerate(zip(opciones, precios)):
                p_market = float(p_str)
                if p_market <= 0.03 or p_market >= 0.96:
                    continue

                es_up = opcion.lower() == "up"
                if btc_analysis:
                    p_model = btc_analysis["prob_up_model"] if es_up else btc_analysis["prob_down_model"]
                    # Si es la vela actual, combinamos la lectura del mercado con nuestro modelo TWAP+Técnico
                    if s_ts == slot_ts:
                        p_efectiva = max(p_market, p_model * 0.65 + p_market * 0.35)
                    else:
                        # Para la próxima vela (que en Polymarket abre a ~50.5¢), guía 100% el modelo técnico
                        p_efectiva = p_model
                else:
                    p_model = p_market
                    p_efectiva = p_market

                roi = ((1.0 - p_market) / p_market) * 100.0
                # Valor esperado (EV) por cada dólar invertido según probabilidad efectiva
                ev_ratio = p_efectiva * (1.0 / p_market) - 1.0
                # Score que prioriza alta probabilidad de acierto + buen retorno
                score = (p_efectiva * 100.0) + (ev_ratio * 25.0)

                if score > mejor_score:
                    mejor_score = score
                    mejor_candidato_vela = (idx, opcion, p_market, p_model, p_efectiva, roi, ev_ratio)

            if not mejor_candidato_vela:
                continue

            idx, mejor_opcion, p_market, p_model, p_efectiva, roi, ev_ratio = mejor_candidato_vela
            prob_mostrar = round(max(p_efectiva, p_market) * 100, 1)

            # Verificar si cumple el umbral de probabilidad (>= 70%) o si estamos mostrando en vivo en la web
            cumple_umbral = (prob_mostrar >= prob_min * 100) and (p_market <= prob_max)
            if cumple_umbral or include_warming_up:
                apr = (roi / dias_restantes) * 365
                centavos = round(p_market * 100)
                cobro_10 = round(10 * (1 + roi / 100), 2)
                ganancia_10 = round(cobro_10 - 10, 2)

                es_up = mejor_opcion.lower() == "up"
                direccion_es = "SUBE (Up 📈)" if es_up else "BAJA (Down 📉)"
                color_boton = "verde «Up»" if es_up else "rojo «Down»"

                razon_analisis = btc_analysis["razones"] if btc_analysis else "Flujo de órdenes a favor"
                como_ganas = (
                    f"🏆 MEJOR DIRECCIÓN: {direccion_es}. "
                    f"Ganas si al cerrar esta vela ({tiempo_corto}) el promedio de Bitcoin termina "
                    f"{'ARRIBA' if es_up else 'ABAJO'} de su apertura. "
                    f"📊 Motivo: {razon_analisis}."
                )
                instruccion_boton = (
                    f"Entra al enlace y toca el botón {color_boton} que cuesta ~{centavos}¢ "
                    f"(Probabilidad estimada: {prob_mostrar}% | Precio mercado: {centavos}¢)."
                )

                candidatos.append({
                    "id": f"btc5m_{m.get('id')}_{idx}",
                    "market_id": m.get("id"),
                    "question": f"⚡ [BITCOIN 5 MIN - {etiqueta_vela}] {ev.get('title')}",
                    "description": ev.get("description", ""),
                    "resolution_source": "Chainlink BTC/USD TWAP + Algoritmo Técnico 1m/5m",
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

    # Ordenar candidatos de BTC 5m poniendo primero el de mayor probabilidad efectiva y ventaja
    candidatos.sort(key=lambda x: (x["cumple_70"], x["probability"], x["ev_pct"]), reverse=True)
    if not include_warming_up:
        return [c for c in candidatos if c["cumple_70"]]
    return candidatos

def generar_explicacion_simple(question, outcome, price, roi):
    """
    Traduce el mercado de Polymarket a una explicación en español súper sencilla,
    indicando qué tiene que pasar para ganar y qué botón tocar.
    """
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
    """
    Escanea la API pública de Polymarket:
    1. Incluye en primer lugar el predictor cuantitativo de BITCOIN 5 MINUTOS.
    2. Descarta cualquier mercado de Bitcoin de largo plazo.
    3. Incluye el resto de oportunidades de alta probabilidad (>= 70%).
    """
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
