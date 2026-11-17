import sys
import os
import json
import re
import time
import math
import urllib.request
from datetime import datetime, timezone, timedelta
from email.utils import parsedate_to_datetime

current_dir = os.path.dirname(os.path.abspath(__file__))
if current_dir not in sys.path:
    sys.path.insert(0, current_dir)

from config import load_config

def obtener_utc_real():
    """Obtiene el timestamp UTC exacto del servidor de Polymarket para evitar desfases de reloj local."""
    try:
        req = urllib.request.Request("https://gamma-api.polymarket.com/events?limit=1", headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=5) as resp:
            date_hdr = resp.headers.get("Date")
            if date_hdr:
                return int(parsedate_to_datetime(date_hdr).timestamp())
    except Exception:
        pass
    return int(time.time())

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

def detectar_categoria(question, slug="", es_btc_5m=False):
    """
    Clasifica cada oportunidad en una categoría visual con su color de borde:
    - 'btc': Naranja (Bitcoin 15m / 1h)
    - 'oro': Color Oro / Dorado (Oro XAUUSD / Gold GC / Plata / Petróleo)
    - 'egames': Morado Neón (Counter-Strike, Dota 2, LoL, Valorant, Esports)
    - 'deportes': Azul Cielo (Fútbol, NBA, NFL, NHL, Tenis, UFC)
    - 'otros': Verde Esmeralda (Política, FED, Economía, Geopolítica)
    """
    if es_btc_5m:
        return "btc", "₿ BITCOIN"

    q = (question or "").lower()
    s = (slug or "").lower()
    texto = f"{q} {s}"

    # 1. Oro y Materias Primas
    if (("gold" in q and "golden" not in q) or "xauusd" in texto or "gold (gc)" in q or "silver (si)" in q or "crude oil" in q or "wti" in q):
        if "gold" in q or "xauusd" in texto:
            return "oro", "🥇 ORO (GOLD)"
        return "oro", "🛢️ MATERIAS PRIMAS"

    # 2. eGames / Esports
    egames_keywords = [
        "counter-strike", "cs2", "cs:go", "dota 2", "dota2", "league of legends",
        "valorant", "esports", "esport", "(bo3)", "(bo5)", "map 1 winner", "map 2 winner",
        "map 3 winner", "game 1 winner", "game 2 winner", "game 3 winner", "pgl ", "dreamleague",
        "blast ", "iem ", "lck ", "lpl ", "vct ", "1win essence", "tipsport"
    ]
    if any(k in texto for k in egames_keywords):
        return "egames", "🎮 EGAMES"

    # 3. Deportes tradicionales
    sports_keywords = [
        " vs. ", " vs ", "nba-", "nfl-", "nhl-", "mlb-", "atp-", "wta-", "ufc-", "unl-",
        "epl-", "ucl-", "laliga", "serie-a", "bundesliga", "spread:", "win on 2026"
    ]
    if any(k in texto for k in sports_keywords):
        return "deportes", "⚽ DEPORTES"

    return "otros", "🌍 MACRO / OTROS"

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

def analizar_btc_15m_y_1h(true_ts):
    try:
        req_1m = urllib.request.Request("https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=60", headers={"User-Agent": "Mozilla/5.0"})
        req_5m = urllib.request.Request("https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=300", headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req_1m, timeout=6) as r1:
            candles_1m = json.loads(r1.read().decode("utf-8"))
        with urllib.request.urlopen(req_5m, timeout=6) as r5:
            candles_5m = json.loads(r5.read().decode("utf-8"))

        if not candles_1m or not candles_5m:
            return None

        candles_1m.sort(key=lambda x: x[0])
        candles_5m.sort(key=lambda x: x[0])

        current_btc = float(candles_1m[-1][4])
        closes_5m = [float(c[4]) for c in candles_5m[-40:]]
        opens_5m = [float(c[3]) for c in candles_5m[-40:]]
        vols_5m = [float(c[5]) for c in candles_5m[-40:]]

        slot_15m = (true_ts // 900) * 900
        slot_1h = (true_ts // 3600) * 3600

        # --- 1. CÁLCULO PARA 15 MINUTOS (15M) ---
        w_15m = [c for c in candles_1m if slot_15m <= c[0] < slot_15m + 900]
        if w_15m:
            open_15m = float(w_15m[0][3])
            twap_15m = sum((float(c[1]) + float(c[2]) + float(c[3]) + float(c[4])) / 4.0 for c in w_15m) / len(w_15m)
        else:
            open_15m = current_btc
            twap_15m = current_btc

        diff_spot_15m = current_btc - open_15m
        diff_twap_15m = twap_15m - open_15m
        mom_15m = current_btc - float(candles_1m[-15][4]) if len(candles_1m) >= 15 else diff_spot_15m

        ema5_5m = _calc_ema(closes_5m, 5)
        ema12_5m = _calc_ema(closes_5m, 12)
        rsi_5m = _calc_rsi(closes_5m, 7)

        vol_up_15m = sum(vols_5m[i] for i in range(-4, 0) if closes_5m[i] >= opens_5m[i])
        vol_dn_15m = sum(vols_5m[i] for i in range(-4, 0) if closes_5m[i] < opens_5m[i])
        vol_bias_15m = (vol_up_15m - vol_dn_15m) / max(vol_up_15m + vol_dn_15m, 0.01)

        elapsed_15m = max(min(true_ts - slot_15m, 890), 0)
        prog_15m = elapsed_15m / 900.0
        escala_15m = max(current_btc * 0.0008, 45.0)

        twap_score_15m = math.tanh((diff_twap_15m * 0.60 + diff_spot_15m * 0.40) / escala_15m)
        trend_score_15m = math.tanh(((ema5_5m - ema12_5m) * 0.6 + mom_15m * 0.4) / escala_15m)
        raw_15m = twap_score_15m * (0.35 + 0.45 * prog_15m) + (trend_score_15m * 0.75 + vol_bias_15m * 0.25) * (0.65 - 0.45 * prog_15m)
        prob_up_15m = max(min(0.50 + 0.44 * math.tanh(raw_15m * 1.4), 0.94), 0.06)

        # --- 2. CÁLCULO PARA 1 HORA (1H) ---
        w_1h = [c for c in candles_1m if slot_1h <= c[0] < slot_1h + 3600]
        if w_1h:
            open_1h = float(w_1h[0][3])
            twap_1h = sum((float(c[1]) + float(c[2]) + float(c[3]) + float(c[4])) / 4.0 for c in w_1h) / len(w_1h)
        else:
            open_1h = current_btc
            twap_1h = current_btc

        diff_spot_1h = current_btc - open_1h
        mom_1h = current_btc - float(candles_5m[-12][4]) if len(candles_5m) >= 12 else diff_spot_1h
        ema8_5m = _calc_ema(closes_5m, 8)
        ema21_5m = _calc_ema(closes_5m, 21)
        rsi_1h = _calc_rsi(closes_5m, 12)

        elapsed_1h = max(min(true_ts - slot_1h, 3590), 0)
        prog_1h = elapsed_1h / 3600.0
        escala_1h = max(current_btc * 0.0015, 90.0)

        pos_score_1h = math.tanh(diff_spot_1h / escala_1h)
        trend_score_1h = math.tanh(((ema8_5m - ema21_5m) * 0.6 + mom_1h * 0.4) / escala_1h)
        raw_1h = pos_score_1h * (0.35 + 0.50 * prog_1h) + trend_score_1h * (0.65 - 0.50 * prog_1h)
        prob_up_1h = max(min(0.50 + 0.44 * math.tanh(raw_1h * 1.4), 0.95), 0.05)

        dir_15m = "UP" if prob_up_15m >= 0.5 else "DOWN"
        dir_1h = "UP" if prob_up_1h >= 0.5 else "DOWN"
        doble_confirmacion = (dir_15m == dir_1h)

        if doble_confirmacion:
            if dir_15m == "UP":
                prob_up_15m = min(prob_up_15m + 0.03, 0.95)
                prob_up_1h = min(prob_up_1h + 0.03, 0.95)
            else:
                prob_up_15m = max(prob_up_15m - 0.03, 0.05)
                prob_up_1h = max(prob_up_1h - 0.03, 0.05)

        return {
            "doble_confirmacion": doble_confirmacion,
            "direccion_alineada": dir_15m if doble_confirmacion else None,
            "15m": {
                "open_5m": round(open_15m, 2),
                "current_btc": round(current_btc, 2),
                "twap_btc": round(twap_15m, 2),
                "diff_usd": round(diff_spot_15m, 2),
                "rsi7": round(rsi_5m, 1),
                "mom_3m": round(mom_15m, 2),
                "prob_up_model": round(prob_up_15m, 4),
                "prob_down_model": round(1.0 - prob_up_15m, 4),
                "doble_confirmacion": doble_confirmacion,
                "razones": (
                    f"{'🔥 DOBLE CONFIRMACIÓN (15m y 1h alineados) + ' if doble_confirmacion else ''}"
                    f"BTC está ${abs(diff_spot_15m):,.1f} USD {'arriba' if diff_spot_15m >= 0 else 'abajo'} de la apertura de 15m (${open_15m:,.2f}) "
                    f"con Impulso 15m de ${mom_15m:+.1f} USD"
                )
            },
            "1h": {
                "open_5m": round(open_1h, 2),
                "current_btc": round(current_btc, 2),
                "twap_btc": round(twap_1h, 2),
                "diff_usd": round(diff_spot_1h, 2),
                "rsi7": round(rsi_1h, 1),
                "mom_3m": round(mom_1h, 2),
                "prob_up_model": round(prob_up_1h, 4),
                "prob_down_model": round(1.0 - prob_up_1h, 4),
                "doble_confirmacion": doble_confirmacion,
                "razones": (
                    f"{'🔥 DOBLE CONFIRMACIÓN (15m y 1h alineados) + ' if doble_confirmacion else ''}"
                    f"BTC está ${abs(diff_spot_1h):,.1f} USD {'arriba' if diff_spot_1h >= 0 else 'abajo'} de la apertura de 1 Hora (${open_1h:,.2f}) "
                    f"con Impulso horario de ${mom_1h:+.1f} USD"
                )
            }
        }
    except Exception as e:
        print(f"[Error en análisis BTC 15m/1h]: {e}")
        return None

def _procesar_evento_btc(ev, true_ts, etiqueta_periodo, datos_tecnicos, prob_min, prob_max, include_warming_up, min_secs_alert):
    markets = ev.get("markets") or []
    if not markets:
        return None
    m = markets[0]
    if m.get("closed") or m.get("acceptingOrders") is False:
        return None

    raw_prices = m.get("outcomePrices")
    raw_outcomes = m.get("outcomes")
    precios = json.loads(raw_prices) if isinstance(raw_prices, str) else raw_prices
    opciones = json.loads(raw_outcomes) if isinstance(raw_outcomes, str) else raw_outcomes
    if not precios or not opciones or len(precios) != len(opciones):
        return None

    end_dt = parse_polymarket_date(m.get("endDate") or ev.get("endDate"))
    if not end_dt:
        return None
    s_left = int(end_dt.timestamp()) - true_ts
    if s_left <= 15:
        return None
    if not include_warming_up and s_left < min_secs_alert:
        return None

    mins = s_left // 60
    secs = s_left % 60
    tiempo_corto = f"{mins}m {secs:02d}s" if mins > 0 else f"{secs}s"
    dias_restantes = max(s_left / 86400.0, 0.001)
    liq = float(m.get("liquidityNum") or m.get("liquidity") or 0)
    vol = float(m.get("volumeNum") or m.get("volume") or 0)
    slug = ev.get("slug") or m.get("slug") or ""
    link = f"https://polymarket.com/event/{slug}"

    mejor_candidato = None
    mejor_score = -999.0

    for idx, (opcion, p_str) in enumerate(zip(opciones, precios)):
        p_market = float(p_str)
        if not include_warming_up and (p_market <= 0.03 or p_market >= 0.96):
            continue
        p_safe = max(min(p_market, 0.99), 0.01)
        es_up = opcion.lower() == "up"
        if datos_tecnicos:
            p_model = datos_tecnicos["prob_up_model"] if es_up else datos_tecnicos["prob_down_model"]
            p_efectiva = max(p_safe, p_model * 0.60 + p_safe * 0.40) if p_safe <= 0.95 else p_model
        else:
            p_model = p_safe
            p_efectiva = p_safe

        roi = ((1.0 - p_safe) / p_safe) * 100.0
        ev_ratio = p_efectiva * (1.0 / p_safe) - 1.0
        score = (p_efectiva * 100.0) + (ev_ratio * 25.0)
        if score > mejor_score:
            mejor_score = score
            mejor_candidato = (idx, opcion, p_safe, p_model, p_efectiva, roi, ev_ratio)

    if not mejor_candidato:
        return None

    idx, mejor_opcion, p_market, p_model, p_efectiva, roi, ev_ratio = mejor_candidato
    prob_mostrar = round(max(p_efectiva, p_market) * 100, 1)
    cumple_umbral = (prob_mostrar >= prob_min * 100) and (p_market <= prob_max)

    if not (cumple_umbral or include_warming_up):
        return None

    apr = (roi / dias_restantes) * 365
    centavos = round(p_market * 100)
    cobro_10 = round(10 * (1 + roi / 100), 2)
    ganancia_10 = round(cobro_10 - 10, 2)

    es_up = mejor_opcion.lower() == "up"
    direccion_es = "SUBE (Up 📈)" if es_up else "BAJA (Down 📉)"
    color_boton = "verde «Up»" if es_up else "rojo «Down»"
    doble_conf = datos_tecnicos.get("doble_confirmacion", False) if datos_tecnicos else False
    badge_doble = " 🔥 [DOBLE CONFIRMACIÓN 15M+1H]" if doble_conf else ""

    razon_analisis = datos_tecnicos["razones"] if datos_tecnicos else "Tendencia confirmada"
    open_ref = datos_tecnicos["open_5m"] if datos_tecnicos else 0
    como_ganas = (
        f"🏆 MEJOR DIRECCIÓN: {direccion_es}{badge_doble}. "
        f"Ganas si al cerrar este periodo ({tiempo_corto}) Bitcoin termina "
        f"{'ARRIBA' if es_up else 'ABAJO'} de su apertura (${open_ref:,.2f}). "
        f"📊 {razon_analisis}."
    )
    instruccion_boton = (
        f"Entra con calma al enlace y toca el botón {color_boton} que cuesta ~{centavos}¢ "
        f"(Confianza: {prob_mostrar}% | Tiempo restante: {tiempo_corto})."
    )

    return {
        "id": f"btc_{etiqueta_periodo}_{m.get('id')}_{idx}",
        "market_id": m.get("id"),
        "question": f"⚡ [{etiqueta_periodo}]{badge_doble} {ev.get('title')}",
        "description": ev.get("description", ""),
        "resolution_source": "Polymarket BTC 15m / 1h Oficial",
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
        "etiqueta_vela": etiqueta_periodo + (" 🔥 ALINEADO" if doble_conf else ""),
        "es_btc_5m": True,
        "categoria": "btc",
        "categoria_label": "₿ BITCOIN",
        "doble_confirmacion": doble_conf,
        "btc_live": datos_tecnicos,
        "apr": round(apr, 1),
        "volume_24h": round(vol, 2),
        "liquidity": round(liq, 2),
        "kelly_pct": 3.0 if doble_conf else 2.0,
        "como_ganas": como_ganas,
        "instruccion_boton": instruccion_boton,
        "cobro_10": cobro_10,
        "ganancia_10": ganancia_10,
        "es_spread": False,
        "slug": slug,
        "link": link,
        "image": ev.get("icon") or ev.get("image") or "",
        "cumple_70": cumple_umbral
    }

def get_btc_5m_opportunities(prob_min=0.70, prob_max=0.95, include_warming_up=False):
    true_ts = obtener_utc_real()
    analisis = analizar_btc_15m_y_1h(true_ts)
    datos_15m = analisis["15m"] if analisis else None
    datos_1h = analisis["1h"] if analisis else None

    resultados = []

    # 1. BITCOIN 15 MINUTOS (btc-updown-15m-{slot_15m})
    slot_15m = (true_ts // 900) * 900
    slots_15m = [slot_15m, slot_15m + 900] if include_warming_up else [slot_15m]

    for s_15 in slots_15m:
        slug_15 = f"btc-updown-15m-{s_15}"
        try:
            req = urllib.request.Request(f"https://gamma-api.polymarket.com/events?slug={slug_15}", headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=7) as resp:
                data = json.loads(resp.read().decode("utf-8"))
            if data:
                op_15 = _procesar_evento_btc(
                    data[0], true_ts, "BITCOIN 15 MIN", datos_15m,
                    prob_min, prob_max, include_warming_up, min_secs_alert=120
                )
                if op_15:
                    resultados.append(op_15)
                    break # Quedarnos con la primera vela de 15m activa válida
        except Exception as e:
            print(f"[Error escaneando BTC 15m]: {e}")

    # 2. BITCOIN 1 HORA (construir el slug determinístico en hora ET: bitcoin-up-or-down-{mes}-{dia}-{año}-{hora}{am/pm}-et)
    slot_1h = (true_ts // 3600) * 3600
    for h_ts in [slot_1h, slot_1h + 3600]:
        try:
            et_dt = datetime.fromtimestamp(h_ts, tz=timezone(timedelta(hours=-5)))
            mes = et_dt.strftime("%B").lower()
            dia = et_dt.day
            anio = et_dt.year
            hora12 = et_dt.strftime("%I").lstrip("0")
            ampm = et_dt.strftime("%p").lower()
            slug_1h = f"bitcoin-up-or-down-{mes}-{dia}-{anio}-{hora12}{ampm}-et"
            req_1h = urllib.request.Request(f"https://gamma-api.polymarket.com/events?slug={slug_1h}", headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req_1h, timeout=7) as resp_1h:
                data_1h = json.loads(resp_1h.read().decode("utf-8"))
            if data_1h:
                op_1h = _procesar_evento_btc(
                    data_1h[0], true_ts, "BITCOIN 1 HORA", datos_1h,
                    prob_min, prob_max, include_warming_up, min_secs_alert=300
                )
                if op_1h:
                    resultados.append(op_1h)
                    break
        except Exception as e:
            print(f"[Error escaneando BTC 1h]: {e}")

    if not include_warming_up:
        return [r for r in resultados if r["cumple_70"]]
    return resultados

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
        como_ganas = f"¡Súper simple! Ganas si «{out_clean}» gana el partido o la partida."
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

    # 1. Obtener oportunidades de BITCOIN 15 MINUTOS y 1 HORA
    oportunidades_btc = get_btc_5m_opportunities(prob_min=prob_min, prob_max=prob_max, include_warming_up=True)

    # 2. Escanear top 500 mercados + eventos de Oro (XAUUSD / GC) y Petróleo (WTI)
    markets = []
    for offset in [0, 250]:
        url = f"https://gamma-api.polymarket.com/markets?limit=250&offset={offset}&active=true&closed=false&order=volume24hr&ascending=false"
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"})
        try:
            with urllib.request.urlopen(req, timeout=10) as response:
                markets.extend(json.loads(response.read().decode("utf-8")))
        except Exception as e:
            print(f"[Error de conexión con Polymarket API offset {offset}]: {e}")

    # Incluir directamente los eventos oficiales de Oro (XAUUSD noviembre y Gold GC diciembre)
    for g_slug in ["what-price-will-xauusd-hit-in-november-2026", "what-will-gold-gc-hit-by-end-of-december"]:
        try:
            r_g = urllib.request.Request(f"https://gamma-api.polymarket.com/events?slug={g_slug}", headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(r_g, timeout=5) as resp_g:
                ev_g = json.loads(resp_g.read().decode("utf-8"))
                if ev_g and ev_g[0].get("markets"):
                    for mg in ev_g[0]["markets"]:
                        mg["events"] = [{"slug": ev_g[0].get("slug")}]
                        if not mg.get("endDate"):
                            mg["endDate"] = ev_g[0].get("endDate")
                        markets.append(mg)
        except Exception:
            pass

    ahora = datetime.now(timezone.utc)
    oportunidades = []
    vistos_ids = set()

    for m in markets:
        try:
            m_id = m.get("id")
            if m_id in vistos_ids:
                continue
            vistos_ids.add(m_id)

            if m.get("acceptingOrders") is False or m.get("closed") is True:
                continue

            question_text = m.get("question") or ""
            q_lower = question_text.lower()

            if "bitcoin" in q_lower or "btc" in q_lower:
                continue

            if ocultar_spreads and q_lower.startswith("spread:"):
                continue

            events_list = m.get("events") or []
            event_slug = events_list[0].get("slug") if (isinstance(events_list, list) and len(events_list) > 0 and isinstance(events_list[0], dict)) else None
            market_slug = m.get("slug") or ""
            canonical_slug = event_slug or market_slug

            cat_key, cat_label = detectar_categoria(question_text, canonical_slug, es_btc_5m=False)

            vol_24h = float(m.get("volume24hr") or m.get("volumeNum") or 0)
            liq = float(m.get("liquidityNum") or m.get("liquidity") or 0)

            min_v_req = 100 if cat_key == "oro" else min_vol
            if vol_24h < min_v_req or liq < min_liq:
                continue

            raw_prices = m.get("outcomePrices")
            raw_outcomes = m.get("outcomes")
            if not raw_prices or not raw_outcomes:
                continue

            precios = json.loads(raw_prices) if isinstance(raw_prices, str) else raw_prices
            opciones = json.loads(raw_outcomes) if isinstance(raw_outcomes, str) else raw_outcomes

            if len(precios) != len(opciones):
                continue

            end_date_str = m.get("endDate") or m.get("endDateIso")
            if not end_date_str:
                continue

            end_date = parse_polymarket_date(end_date_str)
            if not end_date:
                continue

            segundos = (end_date - ahora).total_seconds()
            if segundos <= 0:
                continue

            # Verificar si el partido/partida ya comenzó en vivo (gameStartTime)
            en_vivo_ahora = False
            game_start_str = m.get("gameStartTime")
            if game_start_str:
                gs_dt = parse_polymarket_date(game_start_str.replace(" ", "T"))
                if gs_dt and gs_dt <= ahora:
                    en_vivo_ahora = True
                    # Si ya está en vivo, una partida BO3 o partido suele resolverse en ~1 a 2 horas
                    segundos = min(segundos, 5400)

            dias_restantes = max(segundos / 86400, 0.04)

            max_d_req = max(max_days, 50) if cat_key == "oro" else max_days
            if dias_restantes > max_d_req:
                continue

            link = f"https://polymarket.com/event/{canonical_slug}" if canonical_slug else "https://polymarket.com"

            for idx, (opcion, p_str) in enumerate(zip(opciones, precios)):
                p = float(p_str)
                prob_min_cat = min(prob_min, 0.55) if cat_key == "egames" else prob_min
                if prob_min_cat <= p <= prob_max:
                    roi = ((1.0 - p) / p) * 100
                    apr = (roi / dias_restantes) * 365

                    min_apr_req = 10.0 if cat_key in ["oro", "egames"] else min_apr
                    if apr < min_apr_req:
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
                        "en_vivo_ahora": en_vivo_ahora,
                        "es_btc_5m": False,
                        "categoria": cat_key,
                        "categoria_label": cat_label,
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
    return oportunidades_btc + oportunidades
