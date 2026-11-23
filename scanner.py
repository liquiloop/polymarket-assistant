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
    """
    Solo conserva Basket (NBA O/U) y Hockey (NHL O/U) de Polymarket.
    Eliminados: BTC, NFL, Voleibol y Oro.
    """
    q = (question or "").lower()
    s = (slug or "").lower()
    texto = f"{q} {s} {tag_hint}".lower()
    is_ou = es_mercado_over_under(question, slug, outcomes_list)

    if not is_ou:
        return None, None

    if tag_hint in ["nba", "basketball", "cbb"] or s.startswith("nba-") or s.startswith("cbb-") or "nba:" in q:
        return "basket", "🏀 BASKET NBA (O/U)"

    if tag_hint in ["nhl", "hockey"] or s.startswith("nhl-") or "hockey" in texto:
        return "hockey", "🏒 HOCKEY NHL (O/U)"

    return None, None

def generar_explicacion_simple(question, outcome, price, roi, cat_key=""):
    q_clean = (question or "").strip()
    out_clean = (outcome or "").strip()
    centavos = round(price * 100)
    cobro_10 = round(10 * (1 + roi / 100), 2)
    ganancia_10 = round(cobro_10 - 10, 2)

    ou_match = re.search(r"O/U\s*(\d+\.?\d*)", q_clean, re.IGNORECASE)
    linea_val = float(ou_match.group(1)) if ou_match else 0.0
    minimo_over = int(linea_val) + 1 if (linea_val % 1 != 0) else int(linea_val + 1)
    maximo_under = int(linea_val) if (linea_val % 1 != 0) else int(linea_val - 1)
    linea_str = f"{linea_val:g}" if linea_val > 0 else ""

    unidad = "goles en total" if cat_key == "hockey" else "puntos en total"
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

def _limpiar_mercado_ligero(m, tag_name="", ev_slug=None, ev_end=None):
    events_list = m.get("events") or []
    e_slug = ev_slug or (events_list[0].get("slug") if (isinstance(events_list, list) and len(events_list) > 0 and isinstance(events_list[0], dict)) else None)
    return {
        "id": m.get("id"),
        "question": m.get("question") or "",
        "description": (m.get("description") or "")[:250],
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
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"})
        with urllib.request.urlopen(req, timeout=8) as resp:
            raw_data = json.loads(resp.read().decode("utf-8"))
        if not raw_data:
            return []

        ligeros = []
        tag_name = key.replace("tag_", "")
        for ev in raw_data:
            ev_slug = ev.get("slug")
            ev_end = ev.get("endDate")
            for m in (ev.get("markets") or []):
                if m.get("closed") or m.get("acceptingOrders") is False:
                    continue
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
    """Solo descarga NBA y NHL de Polymarket (ultraligero: < 30MB de RAM)."""
    now_ts = time.time()
    if now_ts - _SCAN_CACHE["timestamp"] < CACHE_TTL_SECONDS and _SCAN_CACHE["data"]:
        return _SCAN_CACHE["data"]

    with _SCAN_LOCK:
        now_ts = time.time()
        if now_ts - _SCAN_CACHE["timestamp"] < CACHE_TTL_SECONDS and _SCAN_CACHE["data"]:
            return _SCAN_CACHE["data"]

        now_str = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        tareas_urls = [
            ("tag_nba", f"https://gamma-api.polymarket.com/events?limit=20&active=true&closed=false&tag_slug=nba&end_date_min={now_str}&order=endDate&ascending=true"),
            ("tag_nhl", f"https://gamma-api.polymarket.com/events?limit=20&active=true&closed=false&tag_slug=nhl&end_date_min={now_str}&order=endDate&ascending=true")
        ]

        markets = []
        with ThreadPoolExecutor(max_workers=2) as executor:
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
    min_apr = custom_filters.get("min_apr", cfg.get("MIN_APR", 25.0)) if custom_filters else cfg.get("MIN_APR", 25.0)

    ahora = datetime.now(timezone.utc)
    markets = _descargar_mercados_optimizado()

    oportunidades = []
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
            if liq < 1200:
                continue
            if "vs" not in q_lower and vol_24h < 300:
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
            if dias_restantes > max(max_days, 50):
                continue

            link = f"https://polymarket.com/event/{canonical_slug}" if canonical_slug else "https://polymarket.com"
            prob_min_cat = min(prob_min, 0.55)

            for idx, (opcion, p_str) in enumerate(zip(opciones, precios)):
                p = float(p_str)
                if prob_min_cat <= p <= prob_max:
                    base_ev_key = f"{cat_key}_{canonical_slug.replace('-more-markets', '')}"
                    if lineas_por_evento_ou.get(base_ev_key, 0) >= 2:
                        continue
                    lineas_por_evento_ou[base_ev_key] = lineas_por_evento_ou.get(base_ev_key, 0) + 1

                    roi = ((1.0 - p) / p) * 100
                    apr = (roi / dias_restantes) * 365
                    if apr < 10.0:
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

    oportunidades.sort(key=lambda x: (x["probability"] >= 70.0, x["apr"]), reverse=True)
    return oportunidades
