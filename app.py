import os
import sys
import time
import threading
from flask import Flask, render_template, request, jsonify

current_dir = os.path.dirname(os.path.abspath(__file__))
if current_dir not in sys.path:
    sys.path.insert(0, current_dir)

from config import load_config, save_config
from scanner import get_polymarket_opportunities
from ai_analyst import analizar_oportunidad
from telegram_notifier import send_telegram_message, check_and_notify_opportunities

app = Flask(__name__, template_folder=os.path.join(current_dir, "templates"))

# Bandera para evitar hilos duplicados si se corre bajo Gunicorn/WSGI
_worker_started = False
_worker_lock = threading.Lock()

def background_scanner_worker():
    print("[*] Servicio de escaneo y alertas automáticas a Telegram ACTIVO...")
    # Espera inicial para dar tiempo a que el servidor web levante
    time.sleep(10)
    while True:
        try:
            cfg = load_config()
            interval = max(int(cfg.get("AUTO_SCAN_MINUTES", 15)), 5) * 60
            token = os.environ.get("TELEGRAM_BOT_TOKEN") or cfg.get("TELEGRAM_BOT_TOKEN", "").strip()
            chat_id = os.environ.get("TELEGRAM_CHAT_ID") or cfg.get("TELEGRAM_CHAT_ID", "").strip()

            if token and chat_id:
                print("[*] [Segundo Plano] Escaneando Polymarket para alertas a Telegram...")
                ops = get_polymarket_opportunities()
                notified = check_and_notify_opportunities(ops)
                if notified > 0:
                    print(f"[+] [Segundo Plano] Se enviaron {notified} alertas nuevas a Telegram.")
            
            time.sleep(interval)
        except Exception as e:
            print(f"[!] Error en escáner de segundo plano: {e}")
            time.sleep(60)

def start_background_thread():
    global _worker_started
    with _worker_lock:
        if not _worker_started:
            t = threading.Thread(target=background_scanner_worker, daemon=True)
            t.start()
            _worker_started = True

# Iniciar hilo tanto para Gunicorn como para ejecución directa
start_background_thread()

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
        min_liq = float(request.args.get("min_liq", 2000))

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
        cfg = load_config()
        # Si existen variables de entorno (como en Render), tomarlas
        if os.environ.get("TELEGRAM_BOT_TOKEN"):
            cfg["TELEGRAM_BOT_TOKEN"] = os.environ.get("TELEGRAM_BOT_TOKEN")
        if os.environ.get("TELEGRAM_CHAT_ID"):
            cfg["TELEGRAM_CHAT_ID"] = os.environ.get("TELEGRAM_CHAT_ID")
        if os.environ.get("GEMINI_API_KEY"):
            cfg["GEMINI_API_KEY"] = os.environ.get("GEMINI_API_KEY")
        return jsonify(cfg)

@app.route("/api/detect-telegram-chat", methods=["POST"])
def api_detect_telegram_chat():
    import urllib.request
    import json
    data = request.get_json() or {}
    token = (data.get("token") or "").strip()
    if not token:
        return jsonify({"ok": False, "message": "Primero pega tu Telegram Bot Token arriba."})
    try:
        url = f"https://api.telegram.org/bot{token}/getUpdates"
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            res = json.loads(resp.read().decode("utf-8"))
        results = res.get("result") or []
        if not results:
            return jsonify({
                "ok": False,
                "message": "No se detectaron mensajes aún. Agrega tu bot al grupo, envía un mensaje como 'Hola' en el grupo y vuelve a pulsar Autodetectar."
            })
        # Buscar primero grupos/canales en los eventos más recientes, o el último chat
        detected_chat = None
        for item in reversed(results):
            msg = item.get("message") or item.get("channel_post") or item.get("my_chat_member") or {}
            chat = msg.get("chat")
            if chat and chat.get("id"):
                detected_chat = chat
                if str(chat.get("type")) in ["group", "supergroup", "channel"]:
                    break
        if detected_chat:
            chat_id = str(detected_chat["id"])
            title = detected_chat.get("title") or detected_chat.get("username") or detected_chat.get("first_name") or "Chat"
            chat_type = detected_chat.get("type", "chat")
            return jsonify({
                "ok": True,
                "chat_id": chat_id,
                "title": title,
                "type": chat_type,
                "message": f"✅ Detectado ({chat_type}): {title} [ID: {chat_id}]"
            })
        return jsonify({"ok": False, "message": "Envía un mensaje en el grupo donde esté el bot y vuelve a intentar."})
    except Exception as e:
        return jsonify({"ok": False, "message": f"Token inválido o error de conexión: {str(e)}"})

@app.route("/api/test-telegram", methods=["POST"])
def api_test_telegram():
    data = request.get_json() or {}
    token = data.get("token")
    chat_id = data.get("chat_id")

    if token and chat_id:
        cfg = load_config()
        cfg["TELEGRAM_BOT_TOKEN"] = token
        cfg["TELEGRAM_CHAT_ID"] = chat_id
        save_config(cfg)

    mensaje_prueba = (
        "🤖 <b>¡Conexión Exitosa con PolyEdge AI!</b>\n\n"
        "Tu asistente de Polymarket está listo. A partir de ahora recibirás aquí "
        "notificaciones instantáneas cuando se detecten oportunidades con probabilidad ≥70% y alto retorno anualizado (APR)."
    )
    ok, msg = send_telegram_message(mensaje_prueba)
    return jsonify({"ok": ok, "message": msg})

if __name__ == "__main__":
    cfg = load_config()
    # Render asigna automáticamente la variable de entorno PORT
    port = int(os.environ.get("PORT", cfg.get("PORT", 5050)))
    print(f"\n=======================================================")
    print(f"🚀 PolyEdge AI Asistente Iniciado")
    print(f"🌐 Dashboard Web: http://localhost:{port}")
    print(f"=======================================================\n")
    app.run(host="0.0.0.0", port=port, debug=False)
