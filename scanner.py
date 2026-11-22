import sys
import os
import gc
import gzip
import json
import re
import time
import threading
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone

current_dir = os.path.dirname(os.path.abspath(__file__))
if current_dir not in sys.path:
    sys.path.insert(0, current_dir)

from config import load_config

# Caché en memoria para evitar descargas repetidas cada 25s y ahorrar >90% de RAM en Render Free (512MB)
_BC_CACHE = {
    "timestamp": 0,
    "data": []
}

def obtener_egames_playbc(prob_min=0.70, prob_max=0.96):
    """
    Conecta directamente al feed en vivo de https://playbc.fun/es/sports (Betby API)
    y extrae las mejores oportunidades en vivo de eGames (eFútbol, FC 27, eBaloncesto,
    Counter-Strike, Dota 2, eLucha, eTenis, etc.) con probabilidad >= prob_min.
    """
    now_ts = time.time()
    # Caché de 25 segundos para ligereza y velocidad
    if now_ts - _BC_CACHE["timestamp"] < 25 and _BC_CACHE["data"]:
        raw_ops = _BC_CACHE["data"]
    else:
        base = "https://api-k-c7818b61-623.sptpub.com/api/v4/live/brand/2103509236163162112/es"
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
            "Origin": "https://playbc.fun",
            "Referer": "https://playbc.fun/"
        }

        def _get_bc_json(url):
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=7) as resp:
                raw = resp.read()
                if raw[:2] == b"\x1f\x8b":
                    raw = gzip.decompress(raw)
                return json.loads(raw.decode("utf-8"))

        try:
            init = _get_bc_json(f"{base}/0")
            v_top = (init.get("top_events_versions") or [0])[0]
            v_rest = (init.get("rest_events_versions") or [0])[0]
            d1 = _get_bc_json(f"{base}/{v_top}") if v_top else {}
            d2 = _get_bc_json(f"{base}/{v_rest}") if v_rest else {}

            all_evs = {**(d1.get("events") or {}), **(d2.get("events") or {})}
            sports = {**(d1.get("sports") or {}), **(d2.get("sports") or {})}
            categories = {**(d1.get("categories") or {}), **(d2.get("categories") or {})}
            tournaments = {**(d1.get("tournaments") or {}), **(d2.get("tournaments") or {})}

            egame_sports = {"109", "111", "137", "153", "300", "302", "303", "304", "305", "307", "309", "322"}
            extraidas = []

            for eid, ev in all_evs.items():
                try:
                    desc = ev.get("desc") or {}
                    sp = str(desc.get("sport", ""))
                    if sp not in egame_sports:
                        continue
                    markets = ev.get("markets") or {}
                    if not markets:
                        continue

                    sp_info = sports.get(sp) or {}
                    sp_name = sp_info.get("name", "eGames")
                    sp_slug = sp_info.get("slug", "esports")
                    c_slug = (categories.get(str(desc.get("category"))) or {}).get("slug", "all")
                    t_info = tournaments.get(str(desc.get("tournament"))) or {}
                    t_slug = t_info.get("slug", "all")
                    t_name = t_info.get("name", "")
                    ev_slug = desc.get("slug", "match")

                    comps = [c.get("name", "") for c in (desc.get("competitors") or [])]
                    if len(comps) < 2:
                        continue
                    comp1, comp2 = comps[0], comps[1]

                    sc = ev.get("score") or {}
                    hs = sc.get("home_score", "0")
                    aws = sc.get("away_score", "0")
                    marcador = f"{hs} - {aws}"
                    url_bc = f"https://playbc.fun/es/sports/{sp_slug}/{c_slug}/{t_slug}/{ev_slug}-{eid}"

                    # Elegir la mejor cuota (>= 65% prob, es decir cuota k entre 1.05 y 1.54) de esta partida
                    mejor_op_evento = None
                    mejor_prob_ev = -1.0

                    for m_type, spec_dict in markets.items():
                        if not isinstance(spec_dict, dict):
                            continue
                        for spec, outcomes_dict in spec_dict.items():
                            if not isinstance(outcomes_dict, dict):
                                continue
                            for out_id, out_data in outcomes_dict.items():
                                if not isinstance(out_data, dict) or out_data.get("b"):
                                    continue
                                k = float(out_data.get("k") or 0)
                                if k < 1.05 or k > 1.54:
                                    continue

                                p_impl = 1.0 / k
                                roi = (k - 1.0) * 100.0
                                label_boton = ""
                                como_ganas = ""
                                es_ou = False

                                # Enfocar los eGames de PlayBC 100% en Total (Over / Under)
                                if "total=" in spec and out_id in ["12", "13"]:
                                    m_tot = re.search(r"total=(\d+\.?\d*)", spec)
                                    if not m_tot:
                                        continue
                                    linea_v = float(m_tot.group(1))
                                    if round(linea_v * 100) % 50 != 0:
                                        continue
                                    es_ou = True
                                    min_over = int(linea_v) + 1 if (linea_v % 1 != 0) else int(linea_v + 1)
                                    max_under = int(linea_v) if (linea_v % 1 != 0) else int(linea_v - 1)
                                    if out_id == "12":
                                        label_boton = f"Más de {linea_v:g} / Over (Cuota {k:.2f})"
                                        como_ganas = (
                                            f"📈 APUESTA DE MÁS DE (OVER {linea_v:g}) en PlayBC [Marcador en vivo: {marcador}]: "
                                            f"Ganas si en la partida suman {min_over} o más goles/puntos/rondas."
                                        )
                                    else:
                                        label_boton = f"Menos de {linea_v:g} / Under (Cuota {k:.2f})"
                                        como_ganas = (
                                            f"📉 APUESTA DE MENOS DE (UNDER {linea_v:g}) en PlayBC [Marcador en vivo: {marcador}]: "
                                            f"Ganas si en la partida hacen {max_under} o menos goles/puntos/rondas."
                                        )
                                else:
                                    continue

                                # Priorizar probabilidades entre 70% y 92% (cuotas 1.09 a 1.43)
                                score_pref = p_impl if (0.70 <= p_impl <= 0.92) else (p_impl * 0.8)
                                if score_pref > mejor_prob_ev:
                                    mejor_prob_ev = score_pref
                                    cobro_10 = round(10.0 * k, 2)
                                    ganancia_10 = round(cobro_10 - 10.0, 2)
                                    instruccion_boton = (
                                        f"En PlayBC toca el botón «{label_boton}» "
                                        f"(Partida en vivo: {marcador})."
                                    )
                                    mejor_op_evento = {
                                        "id": f"bc_{eid}_{m_type}_{out_id}",
                                        "market_id": f"bc_{eid}",
                                        "bc_event_id": str(eid),
                                        "bc_spec": spec,
                                        "bc_out_id": str(out_id),
                                        "question": f"🎮 [BC.GAME - {sp_name}] {comp1} vs. {comp2} (En Vivo: {marcador})",
                                        "description": f"Torneo: {t_name} | Marcador en vivo: {marcador} | Plataforma: PlayBC (BC.GAME)",
                                        "resolution_source": "PlayBC / BC.GAME Oficial En Vivo",
                                        "outcome": label_boton,
                                        "probability": round(p_impl * 100, 1),
                                        "price": round(p_impl, 4),
                                        "centavos": round(p_impl * 100),
                                        "cuota_bc": round(k, 2),
                                        "roi": round(roi, 2),
                                        "days_left": 0.04,
                                        "hours_left": 1,
                                        "en_vivo_ahora": True,
                                        "es_btc_5m": False,
                                        "es_playbc": True,
                                        "categoria": "egames",
                                        "categoria_label": f"🟣 🎮 BC.GAME ({sp_name})",
                                        "apr": round((roi / 0.04) * 365, 1),
                                        "volume_24h": 25000,
                                        "liquidity": 25000,
                                        "kelly_pct": 2.5,
                                        "como_ganas": como_ganas,
                                        "instruccion_boton": instruccion_boton,
                                        "cobro_10": cobro_10,
                                        "ganancia_10": ganancia_10,
                                        "es_ou": es_ou,
                                        "es_spread": False,
                                        "slug": f"{ev_slug}-{eid}",
                                        "link": url_bc,
                                        "image": ""
                                    }

                    if mejor_op_evento:
                        extraidas.append(mejor_op_evento)
                except Exception:
                    continue

            del d1, d2, all_evs
            _BC_CACHE["timestamp"] = time.time()
            _BC_CACHE["data"] = extraidas
            raw_ops = extraidas
        except Exception as e:
            print(f"[Error escaneando PlayBC eGames]: {e}")
            raw_ops = _BC_CACHE["data"] or []

    prob_min_pct = min(prob_min, 0.65) * 100.0
    prob_max_pct = prob_max * 100.0
    filtradas = [o for o in raw_ops if prob_min_pct <= o["probability"] <= prob_max_pct]
    filtradas.sort(key=lambda x: (x["probability"] >= 70.0, x["roi"]), reverse=True)
    return filtradas[:25]

_SCAN_CACHE = {
    "timestamp": 0,
    "data": []
}
_SCAN_LOCK = threading.Lock()
CACHE_TTL_SECONDS = 40

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
    q = (question or "").lower()
    s = (slug or "").lower()
    texto = f"{q} {s} {tag_hint}".lower()
    is_ou = es_mercado_over_under(question, slug, outcomes_list)

    if (("gold" in q and "golden" not in q) or "xauusd" in texto or "gold (gc)" in q or "silver (si)" in q or "crude oil" in q or "wti" in q):
        if "gold" in q or "xauusd" in texto:
            return "oro", "🥇 ORO (GOLD)"
        return "oro", "🛢️ MATERIAS PRIMAS"

    if tag_hint == "volleyball" or "volley" in texto or s.startswith("vb"):
        if is_ou:
            return "voleibol", "🏐 VOLEIBOL (O/U)"
        return None, None

    if tag_hint in ["nba", "basketball", "cbb"] or s.startswith("nba-") or s.startswith("cbb-") or "nba:" in q:
        if is_ou:
            return "basket", "🏀 BASKET (O/U)"
        return None, None

    if tag_hint in ["nhl", "hockey"] or s.startswith("nhl-") or "hockey" in texto:
        if is_ou:
            return "hockey", "🏒 HOCKEY (O/U)"
        return None, None

    if tag_hint in ["nfl", "cfb"] or s.startswith("nfl-") or s.startswith("cfb-"):
        if is_ou:
            return "nfl", "🏈 NFL (O/U)"
        return None, None

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
    q_clean = (question or "").strip()
    out_clean = (outcome or "").strip()
    centavos = round(price * 100)
    cobro_10 = round(10 * (1 + roi / 100), 2)
    ganancia_10 = round(cobro_10 - 10, 2)

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
        "es_ou": False,
        "es_spread": q_clean.lower().startswith("spread:")
    }

def _limpiar_mercado_ligero(m, tag_name="", ev_slug=None, ev_end=None):
    """Extrae únicamente los campos necesarios para reducir en 90% el uso de memoria RAM."""
    events_list = m.get("events") or []
    e_slug = ev_slug or (events_list[0].get("slug") if (isinstance(events_list, list) and len(events_list) > 0 and isinstance(events_list[0], dict)) else None)
    return {
        "id": m.get("id"),
        "question": m.get("question") or "",
        "description": (m.get("description") or "")[:300],
        "resolutionSource": m.get("resolutionSource") or "UMA Oracle / Reglas Oficiales",
        "slug": m.get("slug") or "",
        "event_slug": e_slug or m.get("slug") or "",
        "endDate": m.get("endDate") or ev_end or m.get("endDateIso"),
        "gameStartTime": m.get("gameStartTime"),
        "outcomePrices": m.get("outcomePrices"),
        "outcomes": m.get("outcomes"),
        "volume24hr": m.get("volume24hr") or m.get("volumeNum") or 0,
        "liquidityNum": m.get("liquidityNum") or m.get("liquidity") or 0,
        "acceptingOrders": m.get("acceptingOrders"),
        "closed": m.get("closed"),
        "icon": m.get("icon") or m.get("image") or "",
        "_tag_hint": tag_name
    }

def _fetch_and_extract(key, url):
    """Descarga y filtra inmediatamente en streaming para no acumular miles de diccionarios pesados en RAM."""
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"})
        with urllib.request.urlopen(req, timeout=8) as resp:
            raw_data = json.loads(resp.read().decode("utf-8"))
        if not raw_data:
            return []

        ligeros = []
        if key.startswith("general_"):
            for m in raw_data:
                if m.get("closed") or m.get("acceptingOrders") is False:
                    continue
                ligeros.append(_limpiar_mercado_ligero(m))
        else:
            tag_name = key.replace("tag_", "") if key.startswith("tag_") else ""
            for ev in raw_data:
                ev_slug = ev.get("slug")
                ev_end = ev.get("endDate")
                for m in (ev.get("markets") or []):
                    if m.get("closed") or m.get("acceptingOrders") is False:
                        continue
                    # Si viene de un tag de deporte (nba, nhl, nfl, cfb, volleyball), guardar solo si es Over/Under
                    if tag_name in ["nba", "nhl", "nfl", "cfb", "volleyball"]:
                        q_low = (m.get("question") or "").lower()
                        s_low = (m.get("slug") or "").lower()
                        out_low = str(m.get("outcomes") or "").lower()
                        if not ("o/u" in q_low or "over" in out_low or "under" in out_low or "-total-" in s_low):
                            continue
                    ligeros.append(_limpiar_mercado_ligero(m, tag_name=tag_name, ev_slug=ev_slug, ev_end=ev_end))
        del raw_data
        return ligeros
    except Exception:
        return []

def _descargar_mercados_optimizado():
    """Usa caché de 40 segundos para que múltiples peticiones no saturen los 512MB de Render Free."""
    now_ts = time.time()
    if now_ts - _SCAN_CACHE["timestamp"] < CACHE_TTL_SECONDS and _SCAN_CACHE["data"]:
        return _SCAN_CACHE["data"]

    with _SCAN_LOCK:
        now_ts = time.time()
        if now_ts - _SCAN_CACHE["timestamp"] < CACHE_TTL_SECONDS and _SCAN_CACHE["data"]:
            return _SCAN_CACHE["data"]

        now_str = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        tareas_urls = [
            ("general_0", "https://gamma-api.polymarket.com/markets?limit=200&offset=0&active=true&closed=false&order=volume24hr&ascending=false"),
            ("general_200", "https://gamma-api.polymarket.com/markets?limit=200&offset=200&active=true&closed=false&order=volume24hr&ascending=false"),
            ("tag_nba", f"https://gamma-api.polymarket.com/events?limit=20&active=true&closed=false&tag_slug=nba&end_date_min={now_str}&order=endDate&ascending=true"),
            ("tag_nhl", f"https://gamma-api.polymarket.com/events?limit=20&active=true&closed=false&tag_slug=nhl&end_date_min={now_str}&order=endDate&ascending=true"),
            ("tag_nfl", f"https://gamma-api.polymarket.com/events?limit=20&active=true&closed=false&tag_slug=nfl&end_date_min={now_str}&order=endDate&ascending=true"),
            ("tag_cfb", f"https://gamma-api.polymarket.com/events?limit=15&active=true&closed=false&tag_slug=cfb&end_date_min={now_str}&order=endDate&ascending=true"),
            ("tag_volleyball", f"https://gamma-api.polymarket.com/events?limit=25&active=true&closed=false&tag_slug=volleyball&end_date_min={now_str}&order=endDate&ascending=true"),
            ("gold_nov", "https://gamma-api.polymarket.com/events?slug=what-price-will-xauusd-hit-in-november-2026"),
            ("gold_dec", "https://gamma-api.polymarket.com/events?slug=what-will-gold-gc-hit-by-end-of-december")
        ]

        markets = []
        # Máximo 3 hilos concurrentes para mantener pico de RAM por debajo de 60MB
        with ThreadPoolExecutor(max_workers=3) as executor:
            futuros = [executor.submit(_fetch_and_extract, key, url) for key, url in tareas_urls]
            for fut in as_completed(futuros):
                res = fut.result()
                if res:
                    markets.extend(res)

        _SCAN_CACHE["timestamp"] = time.time()
        _SCAN_CACHE["data"] = markets
        gc.collect()
        return markets

def get_polymarket_opportunities(custom_filters=None):
    cfg = load_config()
    prob_min = custom_filters.get("prob_min", cfg.get("MIN_PROBABILITY", 0.70)) if custom_filters else cfg.get("MIN_PROBABILITY", 0.70)
    prob_max = custom_filters.get("prob_max", cfg.get("MAX_PROBABILITY", 0.98)) if custom_filters else cfg.get("MAX_PROBABILITY", 0.98)
    max_days = custom_filters.get("max_days", cfg.get("MAX_DAYS", 30)) if custom_filters else cfg.get("MAX_DAYS", 30)
    min_vol = custom_filters.get("min_vol", cfg.get("MIN_VOLUME_24H", 3000)) if custom_filters else cfg.get("MIN_VOLUME_24H", 3000)
    min_liq = custom_filters.get("min_liq", cfg.get("MIN_LIQUIDITY", 2000)) if custom_filters else cfg.get("MIN_LIQUIDITY", 2000)
    min_apr = custom_filters.get("min_apr", cfg.get("MIN_APR", 25.0)) if custom_filters else cfg.get("MIN_APR", 25.0)

    ahora = datetime.now(timezone.utc)
    markets = _descargar_mercados_optimizado()
    oportunidades_bc = obtener_egames_playbc(prob_min=prob_min, prob_max=prob_max)

    oportunidades = list(oportunidades_bc)
    vistos_ids = set()
    lineas_por_evento_ou = {}

    for m in markets:
        try:
            m_id = m.get("id")
            if not m_id or m_id in vistos_ids:
                continue

            question_text = m.get("question") or ""
            q_lower = question_text.lower()
            m_slug = (m.get("slug") or "").lower()

            # Quitar BTC / Bitcoin por completo
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

            canonical_slug = m.get("event_slug") or m_slug
            tag_hint = m.get("_tag_hint", "")

            cat_key, cat_label = detectar_categoria(question_text, canonical_slug, tag_hint=tag_hint, outcomes_list=opciones)
            if not cat_key:
                continue

            vistos_ids.add(m_id)

            vol_24h = float(m.get("volume24hr") or 0)
            liq = float(m.get("liquidityNum") or 0)

            if cat_key == "voleibol":
                if liq < 50 and vol_24h < 10:
                    continue
            elif cat_key in ["basket", "hockey", "nfl"]:
                if liq < 1200:
                    continue
                if "vs" not in q_lower and vol_24h < 300:
                    continue
            elif cat_key == "oro":
                if vol_24h < 100 or liq < min_liq:
                    continue
            else:
                if vol_24h < min_vol or liq < min_liq:
                    continue

            end_date_str = m.get("endDate")
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
            prob_min_cat = min(prob_min, 0.55) if cat_key in ["voleibol", "hockey", "basket", "egames"] else prob_min

            for idx, (opcion, p_str) in enumerate(zip(opciones, precios)):
                p = float(p_str)
                if prob_min_cat <= p <= prob_max:
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
                        "image": m.get("icon") or ""
                    })
        except Exception:
            continue

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
