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
CACHE_TTL_SECONDS = 35

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
        "volume24hr": float(m.get("volume24hr") or m.get("volumeNum") or 0),
        "liquidityNum": float(m.get("liquidityNum") or m.get("liquidity") or 0),
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
        bad_substrings = ("1h", "half", "quarter", "period", "1st", "2nd", "3rd", "both teams", "btts", "spread", "margin", "exact")

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

                # Aceptar:
                # 1) Full-game Over/Under exacto (": O/U <numero>$" sin nombre de equipo intermedio)
                es_ou_full = bool(re.search(r":\s*O/U\s*(\d+\.?\d*)\s*$", q, re.IGNORECASE))
                # 2) Full-game Moneyline 2-way en NBA y NHL (sin ":" en la pregunta)
                es_ml_2way = (tag_name in ("nba", "nhl") and ":" not in ql)

                if not (es_ou_full or es_ml_2way):
                    continue

                extraidos.append(_limpiar_mercado_cruzado(m, tag_name=tag_name, ev_title=ev_title, ev_slug=ev_slug, ev_end=ev_end))

        del raw_data
        return extraidos
    except Exception:
        return []

def _descargar_mercados_deportes_reales():
    """Descarga mercados limpios de deportes reales (NBA, NHL y Ligas Top de Fútbol) con caché ligero."""
    now_ts = time.time()
    if now_ts - _SCAN_CACHE["timestamp"] < CACHE_TTL_SECONDS and _SCAN_CACHE["data"]:
        return _SCAN_CACHE["data"]

    with _SCAN_LOCK:
        now_ts = time.time()
        if now_ts - _SCAN_CACHE["timestamp"] < CACHE_TTL_SECONDS and _SCAN_CACHE["data"]:
            return _SCAN_CACHE["data"]

        min_dt_str = (datetime.now(timezone.utc) - timedelta(hours=5)).strftime("%Y-%m-%dT%H:%M:%SZ")
        tags = ["nba", "nhl", "epl", "ucl", "bundesliga", "serie-a", "ligue-1"]
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
    Devuelve los mercados completos de deportes reales en Polymarket (con AMBOS lados de precio)
    listos para ser cruzados en tiempo real contra BC.GAME en el navegador del usuario (Arbitraje y +EV).
    """
    cfg = load_config()
    max_days = float(custom_filters.get("max_days", cfg.get("MAX_DAYS", 7))) if custom_filters else 7.0

    ahora = datetime.now(timezone.utc)
    markets = _descargar_mercados_deportes_reales()

    oportunidades = []
    vistos_ids = set()

    mapa_deporte = {
        "nba": ("nba", "🏀 NBA Real"),
        "nhl": ("nhl", "🏒 NHL Real"),
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

            precios = [float(x) for x in (json.loads(raw_prices) if isinstance(raw_prices, str) else raw_prices)]
            opciones = [str(x) for x in (json.loads(raw_outcomes) if isinstance(raw_outcomes, str) else raw_outcomes)]
            if len(precios) != 2 or len(opciones) != 2:
                continue

            liq = float(m.get("liquidityNum") or 0)
            if liq < 300:
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

            vistos_ids.add(m_id)
            tag = m.get("_tag") or "nba"
            deporte_key, deporte_label = mapa_deporte.get(tag, ("futbol", "⚽ Fútbol Real"))

            q = m.get("question") or ""
            m_ou = re.search(r":\s*O/U\s*(\d+\.?\d*)\s*$", q, re.IGNORECASE)
            es_ou = bool(m_ou)
            linea_ou = float(m_ou.group(1)) if m_ou else None

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
                "prices": [round(precios[0], 4), round(precios[1], 4)],
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
