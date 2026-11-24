import os
import sys
from flask import Flask, render_template, request, jsonify

current_dir = os.path.dirname(os.path.abspath(__file__))
if current_dir not in sys.path:
    sys.path.insert(0, current_dir)

from config import load_config, save_config
from scanner import get_polymarket_opportunities
from ai_analyst import analizar_oportunidad

app = Flask(__name__, template_folder=os.path.join(current_dir, "templates"))

@app.route("/")
def index():
    return render_template("index.html")

@app.route("/api/opportunities", methods=["GET"])
def api_opportunities():
    try:
        prob_min = float(request.args.get("prob_min", 0.70))
        max_days = float(request.args.get("max_days", 30))
        min_apr = float(request.args.get("min_apr", 25.0))
        min_vol = float(request.args.get("min_vol", 3000))
        min_liq = float(request.args.get("min_liq", 1200))

        filters = {
            "prob_min": prob_min,
            "max_days": max_days,
            "min_apr": min_apr,
            "min_vol": min_vol,
            "min_liq": min_liq
        }

        opportunities = get_polymarket_opportunities(filters)
        return jsonify({"success": True, "count": len(opportunities), "opportunities": opportunities})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route("/api/analyze", methods=["POST"])
def api_analyze():
    data = request.get_json() or {}
    try:
        resultado = analizar_oportunidad(data)
        return jsonify(resultado)
    except Exception as e:
        return jsonify({"status": "error", "analisis": f"Error al analizar el mercado: {str(e)}", "fuente": "Error"})

@app.route("/api/config", methods=["GET", "POST"])
def api_config():
    if request.method == "POST":
        current = load_config()
        new_data = request.get_json() or {}
        for k, v in new_data.items():
            current[k] = v
        save_config(current)
        return jsonify({"success": True, "config": current})
    else:
        return jsonify(load_config())

STATS_FILE = os.path.join(current_dir, "win_loss_stats.json")

@app.route("/api/stats", methods=["GET", "POST"])
def api_stats():
    import json
    if request.method == "POST":
        data = request.get_json() or {}
        try:
            with open(STATS_FILE, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False)
        except Exception:
            pass
        return jsonify({"success": True})
    else:
        if os.path.exists(STATS_FILE):
            try:
                with open(STATS_FILE, "r", encoding="utf-8") as f:
                    return jsonify(json.load(f))
            except Exception:
                pass
        return jsonify({})

@app.route("/api/check-pinned", methods=["POST"])
def api_check_pinned():
    """
    Recibe una lista de oportunidades de Polymarket fijadas por el usuario (con el switch activo)
    y consulta directamente en Polymarket el precio actual y si ya ganaron (WIN).
    """
    import urllib.request
    import json
    from concurrent.futures import ThreadPoolExecutor

    data = request.get_json() or {}
    items = [it for it in (data.get("items") or []) if not str(it.get("market_id", "")).startswith("bc_")]
    if not items:
        return jsonify({"success": True, "updates": {}})

    def _check_one(item):
        op_id = item.get("id")
        market_id = str(item.get("market_id") or "")
        target_outcome = (item.get("outcome") or "").strip().lower()
        if not op_id or not market_id:
            return op_id, None

        try:
            url = f"https://gamma-api.polymarket.com/markets/{market_id}"
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=6) as resp:
                m = json.loads(resp.read().decode("utf-8"))
            raw_prices = m.get("outcomePrices")
            raw_outcomes = m.get("outcomes")
            precios = json.loads(raw_prices) if isinstance(raw_prices, str) else (raw_prices or [])
            opciones = json.loads(raw_outcomes) if isinstance(raw_outcomes, str) else (raw_outcomes or [])

            current_price = None
            for op_name, p_str in zip(opciones, precios):
                if str(op_name).strip().lower() == target_outcome:
                    current_price = float(p_str)
                    break

            if current_price is None and "_" in str(op_id):
                try:
                    idx = int(str(op_id).split("_")[-1])
                    if 0 <= idx < len(precios):
                        current_price = float(precios[idx])
                except Exception:
                    pass

            if current_price is None:
                return op_id, None

            closed = bool(m.get("closed"))
            estado = "EN_JUEGO"
            if current_price >= 0.985 or (closed and current_price >= 0.90):
                estado = "WIN"
            elif current_price <= 0.015 or (closed and current_price <= 0.10):
                estado = "LOSS"

            return op_id, {
                "current_price": round(current_price, 4),
                "current_centavos": round(current_price * 100, 1),
                "current_probability": round(current_price * 100, 1),
                "closed": closed,
                "estado_resultado": estado
            }
        except Exception:
            return op_id, None

    updates = {}
    with ThreadPoolExecutor(max_workers=4) as executor:
        for op_id, res in executor.map(_check_one, items[:20]):
            if op_id and res:
                updates[op_id] = res

    return jsonify({"success": True, "updates": updates})

if __name__ == "__main__":
    cfg = load_config()
    port = int(os.environ.get("PORT", cfg.get("PORT", 5050)))
    print(f"\n=======================================================")
    print(f"🚀 PolyEdge AI Asistente Ligero Iniciado (Sin procesos en 2do plano)")
    print(f"🌐 Dashboard Web: http://localhost:{port}")
    print(f"=======================================================\n")
    app.run(host="0.0.0.0", port=port, debug=False)
