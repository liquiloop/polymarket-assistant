import sys
import os
import json
import re
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
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

def es_mercado_over_under(question, slug="", outcomes_list=None):
    """Verifica si un mercado es de tipo Over / Under (Totales)."""
    q = (question or "").lower()
    s = (slug or "").lower()
    outs = [str(o).lower() for o in (outcomes_list or [])]
    if "o/u" in q or "over/under" in q or "total" in q or "-total-" in s or "-totals-" in s:
        return True
    if "over" in outs and "under" in outs:
        return True
    return False

def detectar_categoria(question, slug="", tag_hint="", outcomes_list=None):
    """
    Clasifica cada oportunidad en su categoría y color de borde:
    - 'basket': Naranja Baloncesto (NBA / Basket Over/Under)
    - 'hockey': Azul Hielo / Cyan (NHL / Hockey Over/Under)
    - 'nfl': Verde Campo (NFL / Fútbol Americano Over/Under)
    - 'voleibol': Rosa / Magenta (Voleibol Over/Under)
    - 'oro': Color Oro / Dorado (Oro XAUUSD / Gold GC)
    - 'egames': Morado Neón (Counter-Strike, Dota 2, LoL, Valorant)
    - 'otros': Azul (Fútbol, Tenis, UFC, Macro)
    """
    q = (question or "").lower()
    s = (slug or "").lower()
    texto = f"{q} {s} {tag_hint}".lower()
    is_ou = es_mercado_over_under(question, slug, outcomes_list)

    # 1. Oro y Materias Primas
    if (("gold" in q and "golden" not in q) or "xauusd" in texto or "gold (gc)" in q or "silver (si)" in q or "crude oil" in q or "wti" in q):
        if "gold" in q or "xauusd" in texto:
            return "oro", "🥇 ORO (GOLD)"
        return "oro", "🛢️ MATERIAS PRIMAS"

    # 2. Voleibol (Enfocado en Under / Over)
    if tag_hint == "volleyball" or "volley" in texto or s.startswith("vb"):
        if is_ou:
            return "voleibol", "🏐 VOLEIBOL (O/U)"
        return None, None # En voleibol enfocarse solo en Over/Under

    # 3. Basket / NBA (Enfocado en Under / Over)
    if tag_hint in ["nba", "basketball", "cbb"] or s.startswith("nba-") or s.startswith("cbb-") or "nba:" in q:
        if is_ou:
            return "basket", "🏀 BASKET (O/U)"
        return None, None # En basket enfocarse solo en Over/Under

    # 4. Hockey / NHL (Enfocado en Under / Over)
    if tag_hint in ["nhl", "hockey"] or s.startswith("nhl-") or "hockey" in texto:
        if is_ou:
            return "hockey", "🏒 HOCKEY (O/U)"
        return None, None # En hockey enfocarse solo en Over/Under

    # 5. NFL / Fútbol Americano (Enfocado en Under / Over)
    if tag_hint in ["nfl", "cfb"] or s.startswith("nfl-") or s.startswith("cfb-"):
        if is_ou:
            return "nfl", "🏈 NFL (O/U)"
        return None, None # En NFL enfocarse solo en Over/Under

    # 6. eGames / Esports
    egames_keywords = [
        "counter-strike", "cs2", "cs:go", "dota 2", "dota2", "league of legends",
        "valorant", "esports", "esport", "(bo3)", "(bo5)", "map 1 winner", "map 2 winner",
        "map 3 winner", "game 1 winner", "game 2 winner", "game 3 winner", "pgl ", "dreamleague",
        "blast ", "iem ", "lck ", "lpl ", "vct ", "1win essence", "tipsport"
    ]
    if any(k in texto for k in egames_keywords):
        return "egames", "🎮 EGAMES"

    return "otros", "⚽ OTROS / MACRO"

def generar_explicacion_simple(question, outcome, price, roi, cat_key=""):
    """
    Traduce el mercado (especialmente Over / Under de Basket, Hockey, NFL y Voleibol)
    a una explicación en español súper sencilla con números enteros claros.
    """
    q_clean = (question or "").strip()
    out_clean = (outcome or "").strip()
    centavos = round(price * 100)
    cobro_10 = round(10 * (1 + roi / 100), 2)
    ganancia_10 = round(cobro_10 - 10, 2)

    # Caso Especial Principal: Mercados OVER / UNDER (O/U)
    ou_match = re.search(r"O/U\s*(\d+\.?\d*)", q_clean, re.IGNORECASE)
    if ou_match or out_clean.lower() in ["over", "under"]:
        linea_val = float(ou_match.group(1)) if ou_match else 0.0
        minimo_over = int(linea_val) + 1 if (linea_val % 1 != 0) else int(linea_val + 1)
        maximo_under = int(linea_val) if (linea_val % 1 != 0) else int(linea_val - 1)
        linea_str = f"{linea_val:g}" if linea_val > 0 else ""

        unidad = "puntos en total"
        if cat_key == "hockey":
            unidad = "goles en total"
        elif cat_key == "voleibol" or "sets" in q_clean.lower():
            unidad = "sets en total"

        # Detectar si es de un jugador específico (ej. "Jalen Brunson: Points O/U 27.5") o del partido completo
        es_jugador = ("vs." not in q_clean.lower() and "vs" not in q_clean.lower()) and (":" in q_clean)
        sujeto = "el jugador hace" if es_jugador else "entre ambos equipos suman"

        if out_clean.lower() in ["over", "yes"]:
            como_ganas = (
                f"📈 APUESTA DE MÁS DE (OVER {linea_str}): "
                f"Ganas si {sujeto} {minimo_over} o más {unidad} en el partido."
            )
            boton_txt = f"Busca la línea «O/U {linea_str}» y toca el botón «{out_clean}» (el de ~{centavos}¢)."
        else:
            como_ganas = (
                f"📉 APUESTA DE MENOS DE (UNDER {linea_str}): "
                f"Ganas si {sujeto} {maximo_under} o menos {unidad} en el partido."
            )
            boton_txt = f"Busca la línea «O/U {linea_str}» y toca el botón «{out_clean}» (el de ~{centavos}¢)."

        return {
            "como_ganas": como_ganas,
            "instruccion_boton": boton_txt,
            "centavos": centavos,
            "cobro_10": cobro_10,
            "ganancia_10": ganancia_10,
            "es_ou": True,
            "es_spread": False
        }

    # Caso 2: Spread / Hándicap
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

    # Caso 3: Preguntas de Sí o No (Yes / No)
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
        "es_ou": False,
        "es_spread": q_clean.lower().startswith("spread:")
    }

def _fetch_url_json(url, timeout=8):
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"})
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except Exception:
        return []

def get_polymarket_opportunities(custom_filters=None):
    """
    Escanea en paralelo:
    - Basket (NBA / CBB) -> Enfocado 100% en Over / Under
    - Hockey (NHL) -> Enfocado 100% en Over / Under
    - NFL (NFL / CFB) -> Enfocado 100% en Over / Under
    - Voleibol -> Enfocado 100% en Over / Under
    - Oro (XAUUSD / Gold GC) y eGames (CS2, Dota 2, LoL)
    - Quita por completo Bitcoin (BTC).
    """
    cfg = load_config()
    prob_min = custom_filters.get("prob_min", cfg.get("MIN_PROBABILITY", 0.70)) if custom_filters else cfg.get("MIN_PROBABILITY", 0.70)
    prob_max = custom_filters.get("prob_max", cfg.get("MAX_PROBABILITY", 0.98)) if custom_filters else cfg.get("MAX_PROBABILITY", 0.98)
    max_days = custom_filters.get("max_days", cfg.get("MAX_DAYS", 30)) if custom_filters else cfg.get("MAX_DAYS", 30)
    min_vol = custom_filters.get("min_vol", cfg.get("MIN_VOLUME_24H", 3000)) if custom_filters else cfg.get("MIN_VOLUME_24H", 3000)
    min_liq = custom_filters.get("min_liq", cfg.get("MIN_LIQUIDITY", 2000)) if custom_filters else cfg.get("MIN_LIQUIDITY", 2000)
    min_apr = custom_filters.get("min_apr", cfg.get("MIN_APR", 25.0)) if custom_filters else cfg.get("MIN_APR", 25.0)

    ahora = datetime.now(timezone.utc)
    now_str = ahora.strftime("%Y-%m-%dT%H:%M:%SZ")

    # Consultas en paralelo para que cargue todo en < 2 segundos
    tareas_urls = [
        ("general_0", "https://gamma-api.polymarket.com/markets?limit=250&offset=0&active=true&closed=false&order=volume24hr&ascending=false"),
        ("general_250", "https://gamma-api.polymarket.com/markets?limit=250&offset=250&active=true&closed=false&order=volume24hr&ascending=false"),
        ("tag_nba", f"https://gamma-api.polymarket.com/events?limit=35&active=true&closed=false&tag_slug=nba&end_date_min={now_str}&order=endDate&ascending=true"),
        ("tag_nhl", f"https://gamma-api.polymarket.com/events?limit=35&active=true&closed=false&tag_slug=nhl&end_date_min={now_str}&order=endDate&ascending=true"),
        ("tag_nfl", f"https://gamma-api.polymarket.com/events?limit=35&active=true&closed=false&tag_slug=nfl&end_date_min={now_str}&order=endDate&ascending=true"),
        ("tag_cfb", f"https://gamma-api.polymarket.com/events?limit=25&active=true&closed=false&tag_slug=cfb&end_date_min={now_str}&order=endDate&ascending=true"),
        ("tag_volleyball", f"https://gamma-api.polymarket.com/events?limit=40&active=true&closed=false&tag_slug=volleyball&end_date_min={now_str}&order=endDate&ascending=true"),
        ("gold_nov", "https://gamma-api.polymarket.com/events?slug=what-price-will-xauusd-hit-in-november-2026"),
        ("gold_dec", "https://gamma-api.polymarket.com/events?slug=what-will-gold-gc-hit-by-end-of-december")
    ]

    markets = []
    with ThreadPoolExecutor(max_workers=9) as executor:
        futuros = {executor.submit(_fetch_url_json, url): key for key, url in tareas_urls}
        for fut in as_completed(futuros):
            key = futuros[fut]
            data = fut.result()
            if not data:
                continue
            if key.startswith("general_"):
                markets.extend(data)
            else:
                tag_name = key.replace("tag_", "") if key.startswith("tag_") else ""
                for ev in data:
                    ev_slug = ev.get("slug")
                    ev_end = ev.get("endDate")
                    for m in (ev.get("markets") or []):
                        m["_tag_hint"] = tag_name
                        m["events"] = [{"slug": ev_slug}]
                        if not m.get("endDate"):
                            m["endDate"] = ev_end
                        markets.append(m)

    oportunidades = []
    vistos_ids = set()
    # Contador por partido/evento en deportes O/U para mostrar las 2 mejores líneas O/U de cada partido sin repetir 25 veces el mismo juego
    lineas_por_evento_ou = {}

    for m in markets:
        try:
            m_id = m.get("id")
            if not m_id or m_id in vistos_ids:
                continue

            if m.get("acceptingOrders") is False or m.get("closed") is True:
                continue

            question_text = m.get("question") or ""
            q_lower = question_text.lower()
            m_slug = (m.get("slug") or "").lower()

            # 1. REGLA DEL USUARIO: Quitar BTC / Bitcoin por completo
            if "bitcoin" in q_lower or "btc" in q_lower or "btc-" in m_slug:
                continue

            raw_prices = m.get("outcomePrices")
            raw_outcomes = m.get("outcomes")
            if not raw_prices or not raw_outcomes:
                continue

            precios = json.loads(raw_prices) if isinstance(raw_prices, str) else raw_prices
            opciones = json.loads(raw_outcomes) if isinstance(raw_outcomes, str) else raw_outcomes
            if len(precios) != len(opciones):
                continue

            events_list = m.get("events") or []
            event_slug = events_list[0].get("slug") if (isinstance(events_list, list) and len(events_list) > 0 and isinstance(events_list[0], dict)) else None
            canonical_slug = event_slug or m.get("slug") or ""
            tag_hint = m.get("_tag_hint", "")

            cat_key, cat_label = detectar_categoria(question_text, canonical_slug, tag_hint=tag_hint, outcomes_list=opciones)
            # Si devuelve None, es un mercado de Basket/Hockey/NFL/Voleibol que NO es Over/Under (ej. Moneyline o Spread), lo descartamos
            if not cat_key:
                continue

            vistos_ids.add(m_id)

            vol_24h = float(m.get("volume24hr") or m.get("volumeNum") or 0)
            liq = float(m.get("liquidityNum") or m.get("liquidity") or 0)

            # Ajustar liquidez mínima según el deporte para capturar los Over/Under activos
            if cat_key == "voleibol":
                # En voleibol las líneas Total Sets O/U 3.5 tienen liquidez más pequeña
                if liq < 50 and vol_24h < 10:
                    continue
            elif cat_key in ["basket", "hockey", "nfl"]:
                # En Basket, Hockey y NFL exigir liquidez real en el libro de órdenes O/U
                if liq < 1200:
                    continue
                # Priorizar totales del partido ("vs.") o props con volumen real
                if "vs" not in q_lower and vol_24h < 300:
                    continue
            elif cat_key == "oro":
                if vol_24h < 100 or liq < min_liq:
                    continue
            else:
                if vol_24h < min_vol or liq < min_liq:
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

            en_vivo_ahora = False
            game_start_str = m.get("gameStartTime")
            if game_start_str:
                gs_dt = parse_polymarket_date(game_start_str.replace(" ", "T"))
                if gs_dt and gs_dt <= ahora:
                    en_vivo_ahora = True
                    segundos = min(segundos, 5400)

            dias_restantes = max(segundos / 86400, 0.04)

            max_d_req = max(max_days, 50) if cat_key in ["oro", "basket", "hockey", "nfl", "voleibol"] else max_days
            if dias_restantes > max_d_req:
                continue

            link = f"https://polymarket.com/event/{canonical_slug}" if canonical_slug else "https://polymarket.com"

            # Para deportes O/U y eGames, permitir ver desde 55% en la web si están cerca, o prob_min
            prob_min_cat = min(prob_min, 0.55) if cat_key in ["voleibol", "hockey", "basket", "egames"] else prob_min

            for idx, (opcion, p_str) in enumerate(zip(opciones, precios)):
                p = float(p_str)
                if prob_min_cat <= p <= prob_max:
                    # En Basket, Hockey y NFL, evitar llenar la pantalla con 15 líneas O/U del mismo partido (máximo 2 por partido)
                    if cat_key in ["basket", "hockey", "nfl"]:
                        base_ev_key = f"{cat_key}_{canonical_slug.replace('-more-markets', '')}"
                        if lineas_por_evento_ou.get(base_ev_key, 0) >= 2:
                            continue
                        lineas_por_evento_ou[base_ev_key] = lineas_por_evento_ou.get(base_ev_key, 0) + 1

                    roi = ((1.0 - p) / p) * 100
                    apr = (roi / dias_restantes) * 365

                    min_apr_req = 10.0 if cat_key in ["oro", "egames", "basket", "hockey", "nfl", "voleibol"] else min_apr
                    if apr < min_apr_req:
                        continue

                    p_est = min(p + 0.02, 0.99)
                    b = (1.0 - p) / p
                    kelly_full = (p_est * b - (1.0 - p_est)) / b if b > 0 else 0
                    kelly_quarter = max(round(kelly_full * 0.25 * 100, 1), 0.5)

                    guia = generar_explicacion_simple(question_text, opcion, p, roi, cat_key=cat_key)

                    oportunidades.append({
                        "id": f"{m_id}_{idx}",
                        "market_id": m_id,
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
                        "es_ou": guia["es_ou"],
                        "es_spread": guia["es_spread"],
                        "slug": canonical_slug,
                        "link": link,
                        "image": m.get("icon") or m.get("image") or ""
                    })
        except Exception:
            continue

    # Ordenar priorizando los deportes Over/Under (Basket, Hockey, NFL, Voleibol) con probabilidad >= 70% y mejor APR
    oportunidades.sort(
        key=lambda x: (
            x["categoria"] in ["basket", "hockey", "nfl", "voleibol"],
            x["probability"] >= 70.0,
            not x["es_spread"],
            x["apr"]
        ),
        reverse=True
    )
    return oportunidades
