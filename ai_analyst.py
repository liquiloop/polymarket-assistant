import os
import sys
import json
import urllib.request

current_dir = os.path.dirname(os.path.abspath(__file__))
if current_dir not in sys.path:
    sys.path.insert(0, current_dir)

from config import load_config

def call_gemini_api(prompt, api_key):
    """Llama a la API oficial de Google Gemini usando requests/urllib."""
    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={api_key}"
    payload = {
        "contents": [
            {
                "parts": [
                    {"text": prompt}
                ]
            }
        ],
        "generationConfig": {
            "temperature": 0.2,
            "maxOutputTokens": 800
        }
    }
    
    headers = {"Content-Type": "application/json"}
    req = urllib.request.Request(url, data=json.dumps(payload).encode("utf-8"), headers=headers, method="POST")
    with urllib.request.urlopen(req, timeout=15) as resp:
        result = json.loads(resp.read().decode("utf-8"))
        candidates = result.get("candidates", [])
        if candidates and "content" in candidates[0]:
            parts = candidates[0]["content"].get("parts", [])
            if parts:
                return parts[0].get("text", "")
    return "No se pudo obtener respuesta del modelo."

def analizar_oportunidad(market_data):
    """
    Analiza una oportunidad de Polymarket.
    Utiliza Gemini AI si la clave API está configurada; de lo contrario,
    genera una auditoría cuantitativa y de riesgo avanzada.
    """
    cfg = load_config()
    api_key = cfg.get("GEMINI_API_KEY", "").strip()

    q = market_data.get("question", "")
    outcome = market_data.get("outcome", "")
    prob = market_data.get("probability", 0)
    roi = market_data.get("roi", 0)
    days = market_data.get("days_left", 0)
    apr = market_data.get("apr", 0)
    vol = market_data.get("volume_24h", 0)
    liq = market_data.get("liquidity", 0)
    desc = market_data.get("description", "")
    res_source = market_data.get("resolution_source", "")

    if api_key:
        prompt = f"""
Actúa como un experto analista cuantitativo de mercados predictivos (Polymarket / UMA Oracle).
Analiza la siguiente oportunidad de inversión y dame un veredicto estructurado y conciso:

- Mercado / Pregunta: "{q}"
- Opción a Comprar: "{outcome}"
- Probabilidad Implícita del Mercado: {prob}% (Precio: ${prob/100:.2f})
- Retorno Neto Esperado (ROI): +{roi}%
- Tiempo Restante para Resolución: {days} días ({round(days*24, 1)} horas)
- Rendimiento Anualizado (APR): {apr}%
- Volumen 24h: ${vol:,.2f} | Liquidez: ${liq:,.2f}
- Fuente de Resolución: {res_source}
- Descripción / Reglas: {desc[:500]}

Tu análisis debe responder en español con el siguiente formato Markdown:
1. **Evaluación de Probabilidad Real vs Mercado**: ¿Es el {prob}% realista, o el mercado está sobreestimando/subestimando?
2. **Riesgos Ocultos y Reglas de Resolución**: Analiza posibles trampas en la redacción, riesgo de disputa en el oráculo UMA, o empate no contemplado.
3. **Gestión de Riesgo & Kelly Criterion**: Porcentaje máximo de bankroll recomendado arriesgar (1% al 5%).
4. **Veredicto Final**: Elige una de estas 3 etiquetas: [FUERTE OPORTUNIDAD], [COMPRA MODERADA CON PRECAUCIÓN], o [EVITAR - RIESGO ASIMÉTRICO].
"""
        try:
            ai_response = call_gemini_api(prompt, api_key)
            return {
                "fuente": "Gemini AI",
                "analisis": ai_response,
                "status": "success"
            }
        except Exception as e:
            # Fallback a auditoría cuantitativa
            pass

    # Auditoría Cuantitativa Heurística si no hay API Key
    asimetria = (100 - prob) / (roi if roi > 0 else 1)
    
    if days <= 1.0:
        time_verdict = "⚡ Ultracorto plazo (<24 horas). Alto APR por rápida rotación de capital."
    elif days <= 7.0:
        time_verdict = "⏱️ Corto plazo (1 a 7 días). Excelente eficiencia de capital."
    else:
        time_verdict = "⏳ Mediano plazo (>7 días). Evaluar si el capital queda inmovilizado demasiado tiempo."

    if liq >= 20000:
        liq_verdict = "🟢 Liquidez alta. Fácil entrada y salida sin slippage significativo."
    elif liq >= 5000:
        liq_verdict = "🟡 Liquidez moderada. Operar con órdenes limitadas en el libro."
    else:
        liq_verdict = "🔴 Liquidez baja. Riesgo de deslizamiento (slippage) al salir rápido."

    kelly_pct = market_data.get("kelly_pct", 2.0)
    if apr > 500 and liq >= 5000:
        veredicto = "[FUERTE OPORTUNIDAD - ALTO RENDIMIENTO POR TIEMPO]"
        consejo = f"Asignar máximo un {kelly_pct}% de tu capital total usando órdenes límite."
    elif apr > 100:
        veredicto = "[COMPRA MODERADA CON PRECAUCIÓN]"
        consejo = f"Asignar máximo un {min(kelly_pct, 2.5)}% de tu capital. Confirmar fuente oficial antes de comprar."
    else:
        veredicto = "[OPORTUNIDAD ESTÁNDAR]"
        consejo = "El retorno por tiempo es moderado. Compara con otras opciones de mayor rotación."

    analisis_texto = f"""
### 📊 Auditoría Cuantitativa del Asistente

* **Veredicto:** **{veredicto}**
* **Probabilidad del Mercado:** **{prob}%** (Precio: ${market_data.get('price'):.4f})
* **Ganancia Neta (ROI):** **+{roi}%**
* **Rendimiento Anualizado (APR):** **{apr:,.0f}%**

#### 1. Factor Tiempo y Rotación de Capital
{time_verdict} Tiempo estimado para cobro: **{days} días** (~{round(days*24, 0)} horas).

#### 2. Liquidez y Salida
{liq_verdict} (Volumen 24h: **${vol:,.0f}**, Liquidez: **${liq:,.0f}**).

#### 3. Reglas y Fuente de Resolución
* **Fuente:** `{res_source}`
* **Precaución:** Verifica la letra pequeña en Polymarket para comprobar qué pasa en caso de aplazamiento, cancelación o prórroga del evento.

#### 4. Asignación de Capital (Kelly Fraccional)
* **Recomendación:** {consejo}
*(Configura tu GEMINI_API_KEY en los ajustes para activar el análisis contextual en tiempo real con noticias).*
"""
    return {
        "fuente": "Algoritmo Cuantitativo Integrado",
        "analisis": analisis_texto.strip(),
        "status": "success"
    }
