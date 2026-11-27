import sys
import os
import gc
import json
import re
import time
import threading
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone, timedelta

current_dir = os.path.dirname(os.path.abspath(__file__))
if current_dir not in sys.path:
    sys.path.insert(0, current_dir)

from config import load_config

_SCAN_CACHE = {
    "timestamp": 0,
    "data": []
}
_SCAN_LOCK = threading.Lock()
CACHE_TTL_SECONDS = 30

def parse_polymarket_date(date_str):
    if not date_str:
        return None
    try:
        cleaned = str(date_str).strip().replace(" ", "T").replace("Z", "+00:00")
        if "T" not in cleaned and "+" not in cleaned:
            cleaned += "T23:59:59+00:00"
        elif "+" not in cleaned and "-" not in cleaned[10:]:
            cleaned += "+00:00"
        return datetime.fromisoformat(cleaned)
    except Exception:
        return None

def _safe_float(val, default=None):
    try:
        if val is None or val == "":
            return default
        return float(val)
    except Exception:
        return default

def _limpiar_mercado_cruzado(m, tag_name="", ev_title="", ev_slug="", ev_end=""):
    return {
        "id": str(m.get("id") or ""),
        "question": (m.get("question") or "").strip(),
        "event_title": (ev_title or "").replace(" - More Markets", "").strip(),
        "slug": m.get("slug") or "",
        "event_slug": (ev_slug or m.get("slug") or "").replace("-more-markets", ""),
        "endDate": m.get("endDate") or ev_end or m.get("endDateIso") or "",
        "gameStartTime": m.get("gameStartTime") or "",
        "outcomePrices": m.get("outcomePrices"),
        "outcomes": m.get("outcomes"),
        "bestBid": _safe_float(m.get("bestBid")),
        "bestAsk": _safe_float(m.get("bestAsk")),
        "spread": _safe_float(m.get("spread"), 0.01),
        "oneHourPriceChange": _safe_float(m.get("oneHourPriceChange"), 0.0),
        "oneDayPriceChange": _safe_float(m.get("oneDayPriceChange"), 0.0),
        "volume24hr": _safe_float(m.get("volume24hr") or m.get("volumeNum"), 0.0),
        "liquidityNum": _safe_float(m.get("liquidityNum") or m.get("liquidity"), 0.0),
        "_tag": tag_name
    }

def _fetch_tag_events(tag_name, url):
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"})
        with urllib.request.urlopen(req, timeout=8) as resp:
            raw_data = json.loads(resp.read().decode("utf-8"))
        if not raw_data:
            return []

        extraidos = []
        bad_substrings = ("1h", "half", "quarter", "period", "1st", "2nd", "3rd", "both teams", "btts", "spread", "margin", "exact", "set ")

        for ev in raw_data:
            ev_title = ev.get("title") or ""
            if " vs" not in ev_title.lower():
                continue
            ev_slug = ev.get("slug") or ""
            ev_end = ev.get("endDate") or ""

            for m in (ev.get("markets") or []):
                if m.get("closed") or m.get("acceptingOrders") is False:
                    continue
                q = (m.get("question") or "").strip()
                ql = q.lower()
                if " vs" not in ql:
                    continue
                if any(b in ql for b in bad_substrings):
                    continue

                es_ou_full = bool(re.search(r":\s*O/U\s*(\d+\.?\d*)\s*$", q, re.IGNORECASE))
                es_ml_2way = (tag_name in ("nba", "nhl", "tennis", "ufc") and ":" not in ql)

                if not (es_ou_full or es_ml_2way):
                    continue

                extraidos.append(_limpiar_mercado_cruzado(m, tag_name=tag_name, ev_title=ev_title, ev_slug=ev_slug, ev_end=ev_end))

        del raw_data
        return extraidos
    except Exception:
        return []

def _descargar_mercados_deportes_reales():
    now_ts = time.time()
    if now_ts - _SCAN_CACHE["timestamp"] < CACHE_TTL_SECONDS and _SCAN_CACHE["data"]:
        return _SCAN_CACHE["data"]

    with _SCAN_LOCK:
        now_ts = time.time()
        if now_ts - _SCAN_CACHE["timestamp"] < CACHE_TTL_SECONDS and _SCAN_CACHE["data"]:
            return _SCAN_CACHE["data"]

        min_dt_str = (datetime.now(timezone.utc) - timedelta(hours=5)).strftime("%Y-%m-%dT%H:%M:%SZ")
        tags = ["nba", "nhl", "epl", "ucl", "bundesliga", "serie-a", "ligue-1", "tennis"]
        tareas = [
            (t, f"https://gamma-api.polymarket.com/events?limit=30&active=true&closed=false&tag_slug={t}&end_date_min={min_dt_str}&order=endDate&ascending=true")
            for t in tags
        ]

        markets = []
        with ThreadPoolExecutor(max_workers=3) as executor:
            futs = [executor.submit(_fetch_tag_events, t, u) for t, u in tareas]
            for fut in as_completed(futs):
                res = fut.result()
                if res:
                    markets.extend(res)

        _SCAN_CACHE["timestamp"] = time.time()
        _SCAN_CACHE["data"] = markets
        gc.collect()
        return markets

def get_polymarket_opportunities(custom_filters=None):
    """
    Devuelve mercados reales de Polymarket con precios exactos de libro de órdenes:
    - asks reales [ask0, ask1] (lo que realmente pagas al comprar)
    - bids reales [bid0, bid1] (lo que realmente cobras si vendes en vivo)
    - cambio en la última hora (oneHourPriceChange) para cazar Rebotes en Vivo (+35% a +80%).
    """
    cfg = load_config()
    max_days = float(custom_filters.get("max_days", cfg.get("MAX_DAYS", 5))) if custom_filters else 5.0

    ahora = datetime.now(timezone.utc)
    markets = _descargar_mercados_deportes_reales()

    oportunidades = []
    vistos_ids = set()

    mapa_deporte = {
        "nba": ("nba", "🏀 NBA"),
        "nhl": ("nhl", "🏒 NHL"),
        "tennis": ("tenis", "🎾 Tenis ATP/WTA"),
        "epl": ("futbol", "⚽ Premier League"),
        "ucl": ("futbol", "⚽ Champions League"),
        "bundesliga": ("futbol", "⚽ Bundesliga"),
        "serie-a": ("futbol", "⚽ Serie A"),
        "ligue-1": ("futbol", "⚽ Ligue 1")
    }

    for m in markets:
        try:
            m_id = m.get("id")
            if not m_id or m_id in vistos_ids:
                continue

            raw_prices = m.get("outcomePrices")
            raw_outcomes = m.get("outcomes")
            if not raw_prices or not raw_outcomes:
                continue

            mids = [float(x) for x in (json.loads(raw_prices) if isinstance(raw_prices, str) else raw_prices)]
            opciones = [str(x) for x in (json.loads(raw_outcomes) if isinstance(raw_outcomes, str) else raw_outcomes)]
            if len(mids) != 2 or len(opciones) != 2:
                continue

            liq = float(m.get("liquidityNum") or 0)
            if liq < 400:
                continue

            game_start_str = m.get("gameStartTime")
            end_date_str = m.get("endDate")
            ref_dt = parse_polymarket_date(game_start_str) if game_start_str else parse_polymarket_date(end_date_str)
            if not ref_dt:
                ref_dt = parse_polymarket_date(end_date_str)
            if not ref_dt:
                continue

            segundos_desde_ahora = (ref_dt - ahora).total_seconds()
            en_vivo_ahora = False
            if segundos_desde_ahora <= 0:
                if abs(segundos_desde_ahora) <= 14400:
                    en_vivo_ahora = True
                    dias_para_filtro = 0.0
                else:
                    continue
            else:
                dias_para_filtro = segundos_desde_ahora / 86400.0

            if dias_para_filtro > (max_days + 0.15):
                continue

            # Calcular precios REALES de Compra (Ask) y Venta (Bid) para ambos lados del libro binario CTF
            b_bid = m.get("bestBid")
            b_ask = m.get("bestAsk")
            if b_bid is not None and b_ask is not None and 0.01 <= b_bid <= b_ask <= 0.99:
                bid0 = round(b_bid, 4)
                ask0 = round(b_ask, 4)
                bid1 = round(max(1.0 - b_ask, 0.01), 4)
                ask1 = round(min(1.0 - b_bid, 0.99), 4)
                spread_val = round(b_ask - b_bid, 4)
            else:
                bid0 = round(max(mids[0] - 0.01, 0.01), 4)
                ask0 = round(min(mids[0] + 0.01, 0.99), 4)
                bid1 = round(max(mids[1] - 0.01, 0.01), 4)
                ask1 = round(min(mids[1] + 0.01, 0.99), 4)
                spread_val = 0.02

            # Descartar libros rotos con spread gigante (>6 centavos) donde te roban al entrar
            if spread_val > 0.06:
                continue

            vistos_ids.add(m_id)
            tag = m.get("_tag") or "nba"
            deporte_key, deporte_label = mapa_deporte.get(tag, ("futbol", "⚽ Fútbol"))

            q = m.get("question") or ""
            m_ou = re.search(r":\s*O/U\s*(\d+\.?\d*)\s*$", q, re.IGNORECASE)
            es_ou = bool(m_ou)
            linea_ou = float(m_ou.group(1)) if m_ou else None

            chg_1h = float(m.get("oneHourPriceChange") or 0.0)
            chg_1d = float(m.get("oneDayPriceChange") or 0.0)

            ev_slug = m.get("event_slug") or m.get("slug") or ""
            link = f"https://polymarket.com/event/{ev_slug}" if ev_slug else "https://polymarket.com"

            oportunidades.append({
                "id": f"poly_{m_id}",
                "market_id": m_id,
                "question": q,
                "event_title": m.get("event_title") or q.split(":")[0].strip(),
                "tag": tag,
                "deporte": deporte_key,
                "deporte_label": deporte_label,
                "es_ou": es_ou,
                "linea_ou": linea_ou,
                "outcomes": opciones,
                "prices": [round(mids[0], 4), round(mids[1], 4)],
                "asks": [ask0, ask1],
                "bids": [bid0, bid1],
                "spread": spread_val,
                "chg_1h": [round(chg_1h, 4), round(-chg_1h, 4)],
                "chg_1d": [round(chg_1d, 4), round(-chg_1d, 4)],
                "event_ts": int(ref_dt.timestamp()),
                "en_vivo_ahora": en_vivo_ahora,
                "days_left": round(dias_para_filtro if not en_vivo_ahora else 0.04, 2),
                "hours_left": max(round(segundos_desde_ahora / 3600.0, 1), 1) if not en_vivo_ahora else 2,
                "liquidity": round(liq, 2),
                "volume_24h": round(float(m.get("volume24hr") or 0), 2),
                "link": link
            })
        except Exception:
            continue

    return oportunidades
