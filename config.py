import os
import json

CONFIG_FILE = os.path.join(os.path.dirname(__file__), "config.json")

DEFAULT_CONFIG = {
    "MIN_PROBABILITY": 0.70,
    "MAX_PROBABILITY": 0.98,
    "MAX_DAYS": 30,
    "MIN_VOLUME_24H": 3000,
    "MIN_LIQUIDITY": 2000,
    "MIN_APR": 25.0,
    "TELEGRAM_BOT_TOKEN": "",
    "TELEGRAM_CHAT_ID": "",
    "GEMINI_API_KEY": "",
    "AUTO_SCAN_MINUTES": 15,
    "PORT": 5050
}

def load_config():
    if not os.path.exists(CONFIG_FILE):
        save_config(DEFAULT_CONFIG)
        return DEFAULT_CONFIG.copy()
    try:
        with open(CONFIG_FILE, "r", encoding="utf-8") as f:
            cfg = json.load(f)
            # Ensure defaults for any missing key
            for k, v in DEFAULT_CONFIG.items():
                if k not in cfg:
                    cfg[k] = v
            return cfg
    except Exception:
        return DEFAULT_CONFIG.copy()

def save_config(new_config):
    with open(CONFIG_FILE, "w", encoding="utf-8") as f:
        json.dump(new_config, f, indent=4, ensure_ascii=False)
