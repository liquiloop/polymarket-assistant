# 🚀 PolyEdge AI — Asistente Cuantitativo de Polymarket

Sistema automatizado de detección de oportunidades de alta probabilidad (≥70%), cálculo de valor esperado (EV), rendimiento anualizado (APR) y gestión de riesgo en Polymarket.

---

## 🌟 Las 3 Funcionalidades Implementadas

1. **📊 Dashboard Web Visual Interactivo (Dark Mode)**
   - Monitoreo en tiempo real de mercados con probabilidad entre 70% y 98%.
   - Filtros dinámicos por probabilidad, tiempo restante de cierre (días/horas) y APR.
   - **Simulador de Criterio de Kelly:** Calcula exactamente cuántos dólares apostar según tu capital total.
   - Enlace directo con 1 clic al mercado en Polymarket.

2. **🧠 Asistente Inteligente con IA (Auditoría Cuantitativa + Gemini)**
   - Evalúa cada oportunidad analizando la fuente de resolución oficial y reglas del oráculo UMA.
   - Detecta asimetría de pérdidas y riesgo de capital inmovilizado.
   - Si introduces tu `GEMINI_API_KEY`, activa un análisis contextual y lectura de noticias con IA generativa.

3. **📲 Bot Notificador a Telegram**
   - Servicio en segundo plano que vigila el libro de órdenes las 24 horas.
   - Te envía una notificación con tarjeta formateada a tu móvil en Telegram cuando surja una oportunidad con alto APR y liquidez confirmada.

---

## 🛠️ Cómo Iniciar

### Opción 1: En 1 Clic (Windows)
Haz doble clic sobre el archivo:
```text
iniciar_polymarket_assistant.bat
```
Y abre en tu navegador: **http://localhost:5050**

### Opción 2: Desde la terminal
```bash
cd polymarket_assistant
python app.py
```

---

## ⚙️ Configuración de Telegram y Gemini

Puedes configurarlo directamente desde el botón **"Ajustes & Telegram"** en el panel web, o editando `config.json`:

1. **Telegram Bot Token:** Habla con `@BotFather` en Telegram, escribe `/newbot` y copia el token generado.
2. **Telegram Chat ID:** Escribe un mensaje a `@userinfobot` en Telegram y copia tu `Id`.
3. Haz clic en **"Probar"** en la web y recibirás un mensaje de confirmación al instante.
