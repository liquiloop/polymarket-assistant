import os
import sys
import json
import urllib.request
import urllib.parse

current_dir = os.path.dirname(os.path.abspath(__file__))
if current_dir not in sys.path:
    sys.path.insert(0, current_dir)

from config import load_config

ALERTED_FILE = os.path.join(current_dir, "alerted_events.json")

def load_alerted():
    if os.path.exists(ALERTED_FILE):
        try:
            with open(ALERTED_FILE, "r", encoding="utf-8") as f:
                return set(json.load(f))
        except Exception:
            return set()
    return set()

def save_alerted(alerted_set):
    try:
        # Guardar solo los últimos 500 para evitar que crezca infinito
        items = list(alerted_set)[-500:]
        with open(ALERTED_FILE, "w", encoding="utf-8") as f:
            json.dump(items, f)
    except Exception:
        pass

def send_telegram_message(text):
    """Envía un mensaje mediante la API oficial de Telegram."""
    cfg = load_config()
    token = cfg.get("TELEGRAM_BOT_TOKEN", "").strip()
    chat_id = cfg.get("TELEGRAM_CHAT_ID", "").strip()

    if not token or not chat_id:
        return False, "Falta TELEGRAM_BOT_TOKEN o TELEGRAM_CHAT_ID en la configuración."

    url = f"https://api.telegram.org/bot{token}/sendMessage"
    payload = {
        "chat_id": chat_id,
        "text": text,
        "parse_mode": "HTML",
        "disable_web_page_preview": False
    }

    try:
        data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            res = json.loads(resp.read().decode("utf-8"))
            if res.get("ok"):
                return True, "Mensaje enviado exitosamente."
            return False, f"Telegram error: {res.get('description')}"
    except Exception as e:
        return False, f"Error al enviar mensaje a Telegram: {str(e)}"

def format_opportunity_alert(op):
    """Formatea la oportunidad en una tarjeta súper fácil de entender para Telegram."""
    centavos = op.get("centavos") or round(op.get("price", 0.75) * 100)
    cobro_10 = op.get("cobro_10") or round(10 * (1 + op.get("roi", 0) / 100), 2)
    ganancia_10 = op.get("ganancia_10") or round(cobro_10 - 10, 2)
    como_ganas = op.get("como_ganas") or f"Ganas si se cumple la opción «{op['outcome']}»."
    instruccion = op.get("instruccion_boton") or f"Toca el botón «{op['outcome']}» de ~{centavos}¢."
    tiempo_txt = f"{int(op['hours_left'])} horas" if op.get("days_left", 1) < 1 else f"{op['days_left']} días"

    texto = (
        f"🎯 <b>SEÑAL FÁCIL POLYMARKET ({op['probability']}% Probabilidad)</b>\n\n"
        f"📌 <b>Evento:</b> {op['question']}\n\n"
        f"🗣️ <b>¿Cómo ganas esta apuesta?</b>\n"
        f"👉 {como_ganas}\n\n"
        f"👆 <b>¿Qué botón tocar en Polymarket?</b>\n"
        f"👉 {instruccion}\n\n"
        f"💵 <b>Ejemplo si metes $10 dólares:</b>\n"
        f"• Pones: <b>$10.00</b>\n"
        f"• Si aciertas cobras: <b>${cobro_10:.2f}</b> (Ganas <b>+${ganancia_10:.2f} limpios</b>)\n"
        f"• Tiempo estimado para cobrar: <b>~{tiempo_txt}</b>\n\n"
        f"🔗 <a href='{op['link']}'>👉 ABRIR EVENTO EN POLYMARKET</a>"
    )
    return texto

def check_and_notify_opportunities(opportunities):
    """Revisa las oportunidades y envía alerta a Telegram para las que no han sido notificadas."""
    alerted = load_alerted()
    notified_count = 0

    for op in opportunities:
        op_id = op.get("id")
        # Solo alertar si no se ha notificado antes y tiene un APR relevante
        if op_id not in alerted and op.get("apr", 0) >= 30:
            msg = format_opportunity_alert(op)
            ok, status = send_telegram_message(msg)
            if ok:
                alerted.add(op_id)
                notified_count += 1
                save_alerted(alerted)

    return notified_count
