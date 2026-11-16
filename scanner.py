import sys
import os
import json
import re
import time
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

def obtener_datos_btc_coinbase(slot_ts):
    """
    Obtiene las velas de 1 minuto de BTC-USD en Coinbase para calcular
    el precio de apertura exacto del bloque de 5 minutos, el precio actual y el TWAP.
    """
    try:
        url = "https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=60"
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=6) as resp:
            candles = json.loads(resp.read().decode("utf-8"))
        # candles: [time, low, high, open, close, volume]
        window = [c for c in candles if slot_ts <= c[0] < slot_ts + 300]
        window.sort(key=lambda x: x[0])
        if window:
            open_5m = float(window[0][3])
            current_btc = float(window[-1][4])
            twap_btc = sum((float(c[1]) + float(c[2]) + float(c[3]) + float(c[4])) / 4.0 for c in window) / len(window)
            diff_usd = current_btc - open_5m
            return {
                "open_5m": round(open_5m, 2),
                "current_btc": round(current_btc, 2),
                "twap_btc": round(twap_btc, 2),
                "diff_usd": round(diff_usd, 2)
            }
        elif candles:
            p = float(candles[0][4])
            return {"open_5m": round(p, 2), "current_btc": round(p, 2), "twap_btc": round(p, 2), "diff_usd": 0.0}
    except Exception:
        pass
    return None

def get_btc_5m_opportunities(prob_min=0.70, prob_max=0.95, include_warming_up=False):
    """
    Escanea específicamente el mercado de Bitcoin de 5 minutos activo en Polymarket
    (btc-updown-5m-{slot_ts}).
    - Para Telegram (include_warming_up=False): Solo devuelve señal cuando la probabilidad >= prob_min (70%+)
      y quedan al menos 45 segundos para poder comprar a tiempo.
    - Para el Dashboard Web (include_warming_up=True): Muestra la vela actual de 5 minutos en vivo.
    """
    now_ts = int(time.time())
    slot_ts = (now_ts // 300) * 300
    secs_left = (slot_ts + 300) - now_ts

    # Si quedan menos de 35 segundos en la vela actual, mirar también la siguiente si es para el dashboard
    slots_to_check = [slot_ts]
    if secs_left < 35 and include_warming_up:
        slots_to_check.append(slot_ts + 300)

    resultados = []
    btc_live = obtener_datos_btc_coinbase(slot_ts)

    for s_ts in slots_to_check:
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
            # Para alertas de Telegram, exigir al menos 45 segundos restantes para que dé tiempo de entrar
            if not include_warming_up and s_left < 45:
                continue

            mins = s_left // 60
            secs = s_left % 60
            tiempo_corto = f"{mins}m {secs:02d}s" if mins > 0 else f"{secs}s"
            dias_restantes = max(s_left / 86400.0, 0.0005)
            liq = float(m.get("liquidityNum") or m.get("liquidity") or 0)
            vol = float(m.get("volumeNum") or m.get("volume") or 0)
            link = f"https://polymarket.com/event/{slug}"

            # Elegir el lado dominante (mayor probabilidad)
            pares = [(opciones[i], float(precios[i]), i) for i in range(len(opciones))]
            pares.sort(key=lambda x: x[1], reverse=True)
            mejor_opcion, p, idx = pares[0]

            if (prob_min <= p <= prob_max) or (include_warming_up and p >= 0.50):
                roi = ((1.0 - p) / p) * 100 if p > 0 else 0
                apr = (roi / dias_restantes) * 365
                centavos = round(p * 100)
                cobro_10 = round(10 * (1 + roi / 100), 2)
                ganancia_10 = round(cobro_10 - 10, 2)

                direccion_es = "SUBE (Up 📈)" if mejor_opcion.lower() == "up" else "BAJA (Down 📉)"
                color_boton = "verde «Up»" if mejor_opcion.lower() == "up" else "rojo «Down»"

                info_precio_btc = ""
                if btc_live and s_ts == slot_ts:
                    signo = "+" if btc_live["diff_usd"] >= 0 else ""
                    info_precio_btc = f" (Apertura 5m: ${btc_live['open_5m']:,.2f} ➔ Actual: ${btc_live['current_btc']:,.2f} [{signo}${btc_live['diff_usd']:,.2f}])"

                como_ganas = (
                    f"⚡ VELA DE 5 MINUTOS: Ganas si al terminar el reloj ({tiempo_corto}) Bitcoin cierra "
                    f"en dirección {direccion_es} respecto al inicio de los 5 minutos{info_precio_btc}."
                )
                instruccion_boton = (
                    f"Entra rápido y toca el botón {color_boton} que cuesta ~{centavos}¢ (Faltan {tiempo_corto})."
                )

                resultados.append({
                    "id": f"btc5m_{m.get('id')}_{idx}",
                    "market_id": m.get("id"),
                    "question": f"⚡ [BITCOIN 5 MIN] {ev.get('title')}",
                    "description": ev.get("description", ""),
                    "resolution_source": "Chainlink BTC/USD TWAP 60s Stream",
                    "outcome": f"{mejor_opcion} ({direccion_es})",
                    "raw_outcome": mejor_opcion,
                    "probability": round(p * 100, 1),
                    "price": round(p, 4),
                    "centavos": centavos,
                    "roi": round(roi, 2),
                    "days_left": round(dias_restantes, 3),
                    "hours_left": round(s_left / 3600.0, 2),
                    "seconds_left": s_left,
                    "tiempo_exacto": tiempo_corto,
                    "es_btc_5m": True,
                    "btc_live": btc_live if s_ts == slot_ts else None,
                    "apr": round(apr, 1),
                    "volume_24h": round(vol, 2),
                    "liquidity": round(liq, 2),
                    "kelly_pct": 2.0,
                    "como_ganas": como_ganas,
                    "instruccion_boton": instruccion_boton,
                    "cobro_10": cobro_10,
                    "ganancia_10": ganancia_10,
                    "es_spread": False,
                    "slug": slug,
                    "link": link,
                    "image": ev.get("icon") or ev.get("image") or ""
                })
        except Exception as e:
            print(f"[Error escaneando BTC 5m]: {e}")
            continue

    return resultados

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
    1. Incluye en primer lugar el escáner especial de BITCOIN 5 MINUTOS.
    2. Filtra y descarta cualquier mercado de Bitcoin de largo plazo (mensual/semanal/anual).
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

    # 1. Obtener oportunidades de BITCOIN 5 MINUTOS (en la web siempre mostramos la vela activa)
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

            # REGLA DEL USUARIO: Para Bitcoin, enfocarse EXCLUSIVAMENTE en el periodo de 5 minutos.
            # Descartar cualquier mercado de Bitcoin/BTC que no sea de 5 minutos (btc-updown-5m).
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
                        "ganancia_10": ganancia_10 if "ganancia_10" in guia else guia["ganancia_10"],
                        "es_spread": guia["es_spread"],
                        "slug": canonical_slug,
                        "link": link,
                        "image": m.get("icon") or m.get("image") or ""
                    })
        except Exception:
            continue

    # Priorizar apuestas directas simples (no spreads) y luego ordenar por APR
    oportunidades.sort(key=lambda x: (not x["es_spread"], x["apr"]), reverse=True)
    # Colocar siempre Bitcoin 5m al inicio
    return oportunidades_btc_5m + oportunidades

if __name__ == "__main__":
    ops = get_polymarket_opportunities()
    print(f"Total encontradas: {len(ops)}")
    for op in ops[:5]:
        print(f"[{op['probability']}%] {op['outcome']} | {op['question']}")
