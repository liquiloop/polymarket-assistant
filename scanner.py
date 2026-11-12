import sys
import os
import json
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

def get_polymarket_opportunities(custom_filters=None):
    """
    Escanea la API pública de Polymarket y filtra las mejores oportunidades
    con probabilidad >= prob_min, calculando ROI, Días restantes, APR y Criterio Kelly.
    """
    cfg = load_config()
    prob_min = custom_filters.get("prob_min", cfg.get("MIN_PROBABILITY", 0.70)) if custom_filters else cfg.get("MIN_PROBABILITY", 0.70)
    prob_max = custom_filters.get("prob_max", cfg.get("MAX_PROBABILITY", 0.98)) if custom_filters else cfg.get("MAX_PROBABILITY", 0.98)
    max_days = custom_filters.get("max_days", cfg.get("MAX_DAYS", 30)) if custom_filters else cfg.get("MAX_DAYS", 30)
    min_vol = custom_filters.get("min_vol", cfg.get("MIN_VOLUME_24H", 3000)) if custom_filters else cfg.get("MIN_VOLUME_24H", 3000)
    min_liq = custom_filters.get("min_liq", cfg.get("MIN_LIQUIDITY", 2000)) if custom_filters else cfg.get("MIN_LIQUIDITY", 2000)
    min_apr = custom_filters.get("min_apr", cfg.get("MIN_APR", 25.0)) if custom_filters else cfg.get("MIN_APR", 25.0)

    url = "https://gamma-api.polymarket.com/markets?limit=250&active=true&closed=false&order=volume24hr&ascending=false"
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"})
    
    try:
        with urllib.request.urlopen(req, timeout=12) as response:
            markets = json.loads(response.read().decode("utf-8"))
    except Exception as e:
        print(f"[Error de conexión con Polymarket API]: {e}")
        return []

    ahora = datetime.now(timezone.utc)
    oportunidades = []

    for m in markets:
        try:
            # Ignorar mercados que no aceptan órdenes
            if m.get("acceptingOrders") is False:
                continue

            vol_24h = float(m.get("volume24hr") or m.get("volumeNum") or 0)
            liq = float(m.get("liquidityNum") or m.get("liquidity") or 0)

            # Filtro de liquidez y volumen para evitar mercados estancados
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

            # Cálculo de tiempo de resolución
            end_date_str = m.get("endDateIso") or m.get("endDate")
            if not end_date_str:
                continue

            end_date = parse_polymarket_date(end_date_str)
            if not end_date:
                continue

            segundos = (end_date - ahora).total_seconds()
            # Descartar mercados cuya fecha estimada ya venció en el pasado (en disputa o sin fecha real)
            if segundos <= 0:
                continue

            dias_restantes = max(segundos / 86400, 0.04)

            if dias_restantes > max_days:
                continue

            # Construir enlace exacto al evento padre en Polymarket (evita errores 404 en sub-mercados)
            events_list = m.get("events") or []
            event_slug = events_list[0].get("slug") if (isinstance(events_list, list) and len(events_list) > 0 and isinstance(events_list[0], dict)) else None
            market_slug = m.get("slug") or ""

            if event_slug and market_slug and event_slug != market_slug:
                link = f"https://polymarket.com/event/{event_slug}/{market_slug}"
            elif event_slug:
                link = f"https://polymarket.com/event/{event_slug}"
            elif market_slug:
                link = f"https://polymarket.com/event/{market_slug}"
            else:
                link = "https://polymarket.com"

            for idx, (opcion, p_str) in enumerate(zip(opciones, precios)):
                p = float(p_str)
                if prob_min <= p <= prob_max:
                    roi = ((1.0 - p) / p) * 100
                    apr = (roi / dias_restantes) * 365

                    if apr < min_apr:
                        continue

                    # Criterio de Kelly (calculando ventaja con probabilidad estimada 2% por encima)
                    p_est = min(p + 0.02, 0.99)
                    b = (1.0 - p) / p
                    kelly_full = (p_est * b - (1.0 - p_est)) / b if b > 0 else 0
                    kelly_quarter = max(round(kelly_full * 0.25 * 100, 1), 0.5)

                    oportunidades.append({
                        "id": f"{m.get('id')}_{idx}",
                        "market_id": m.get("id"),
                        "question": m.get("question"),
                        "description": m.get("description", ""),
                        "resolution_source": m.get("resolutionSource", "UMA Oracle / Reglas Oficiales"),
                        "outcome": opcion,
                        "probability": round(p * 100, 1),
                        "price": round(p, 4),
                        "roi": round(roi, 2),
                        "days_left": round(dias_restantes, 1),
                        "hours_left": max(round(dias_restantes * 24, 0), 1),
                        "apr": round(apr, 1),
                        "volume_24h": round(vol_24h, 2),
                        "liquidity": round(liq, 2),
                        "kelly_pct": kelly_quarter,
                        "slug": event_slug or market_slug,
                        "link": link,
                        "image": m.get("icon") or m.get("image") or ""
                    })
        except Exception:
            continue

    # Ordenar por el mejor rendimiento anualizado (APR)
    oportunidades.sort(key=lambda x: x["apr"], reverse=True)
    return oportunidades

if __name__ == "__main__":
    ops = get_polymarket_opportunities()
    print(f"\n[+] Se encontraron {len(ops)} oportunidades vigentes con probabilidad >= 70%:")
    print("-" * 110)
    for op in ops[:10]:
        print(f"[{op['probability']:>5.1f}%] {op['outcome']:<15} | ROI: {op['roi']:>5.1f}% | Días: {op['days_left']:>4.1f} | APR: {op['apr']:>7.0f}% | {op['question'][:45]}")
        print(f"   -> URL: {op['link']}")
