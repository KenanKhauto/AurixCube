"""Constants for the Arabic letters category game."""

from __future__ import annotations

ARABIC_LETTERS = [
    "ا", "ب", "ت", "ث", "ج", "ح", "خ", "د", "ر", "ز", "س", "ش", "ص", "ض",
    "ط", "ظ", "ع", "غ", "ف", "ق", "ك", "ل", "م", "ن", "ه", "و", "ي",
]

PRESET_CATEGORIES = [
    {"id": "name", "label": "اسم"},
    {"id": "object", "label": "جماد"},
    {"id": "country", "label": "بلاد"},
    {"id": "animal", "label": "حيوان"},
    {"id": "plant", "label": "نبات"},
    {"id": "job", "label": "مهنة"},
    {"id": "food", "label": "أكلة"},
    {"id": "color", "label": "لون"},
    {"id": "brand", "label": "ماركة"},
    {"id": "movie", "label": "فيلم"},
    {"id": "series", "label": "مسلسل"},
    {"id": "city", "label": "مدينة"},
]

PRESET_CATEGORY_LABELS = {item["id"]: item["label"] for item in PRESET_CATEGORIES}

MAX_ACTIVE_CATEGORIES = 12
MAX_CUSTOM_CATEGORIES = 8
MAX_CATEGORY_LENGTH = 40

CHOOSE_LETTER_TIMEOUT_SECONDS = 25
REVEAL_PHASE_SECONDS = 6
VOTING_PHASE_SECONDS = 30
ROUND_RESULT_SECONDS = 8
